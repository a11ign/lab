#!/usr/bin/env python3
"""Train a frozen-encoder, per-criterion screen-reader evidence scorer.

The encoder is never fine-tuned here. It must be a pinned local Hugging Face
checkpoint containing model.safetensors; the only newly trained weights are
the small binary heads, also written as safetensors. The heads receive a
channel-tagged text embedding plus facts derived from screen-reader evidence
such as field naming and table-header announcements. Provenance is metadata,
never a feature.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import random
import sys
from pathlib import Path
from typing import Any

# The feature pipeline lives with the WEIGHTS, in `@a11y-witness/scorer`, not here — a change to it
# invalidates every weight file that does not carry the new `FEATURE_SCHEMA_VERSION`, so the two must version
# together (ADR 0004). This program is the only consumer that also trains; it is deliberately not published,
# because distributing a trainer implies a consumer can reproduce training and they cannot: the corpus is not
# distributed.
# Both cwd-relative defaults below were `Path("models/...")`, so a train run from any other directory wrote
# its weights somewhere the scorer would never look. Anchored on the file, like everything else now.
# `packages/lab/scripts/` -> `packages/` -> `packages/scorer`. It was `parents[1] / "packages" / "scorer"`,
# which resolved to `packages/lab/packages/scorer` once M8 moved this file into the lab package — a path that
# does not exist, and the failure was `ModuleNotFoundError: No module named 'screenreader_features'`.
SCORER_PACKAGE = Path(__file__).resolve().parents[2] / "scorer"
sys.path.insert(0, str(SCORER_PACKAGE / "python"))
from screenreader_features import (  # noqa: E402  (path shim must precede the import)
    ENGINEERED_FEATURE_MULTIPLIERS,
    ENGINEERED_FEATURE_SCALE,
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    assert_encoder,
    encode_records,
    head_key,
    bag_gather,
    bag_offsets,
    encode_documents,
    pooling_for,
    read_records,
    score_bags,
    score_head,
    sha256,
)

SEED = 20260726

TRAIN_RATIO = 0.7

VALIDATION_RATIO = 0.15

DEFAULT_EPOCHS = 250

CALIBRATION_FOLDS = 5


# Criteria decided by a deterministic rule, not by the learned scorer. Their calibration is reported
# but does not gate release, because the rule is the decision.
#
# 2.4.6 and 2.4.4 were moved in here and then moved back out, and the round trip is worth recording.
# The case for reclassifying them was that they had failed the held-out gate while their signals are
# hand-written vocabularies (GENERIC_HEADINGS, VAGUE_LINKS) that the corpus is generated from. Both
# supporting measurements were wrong: the held-out failures came from an evaluator that never pooled
# (see 593e1e0), and the "generic_heading_present discriminates 4 of 30 held-out pairs" figure counted
# all 30 pairs when only ~2 are 2.4.6 cases at all. Measured properly, both reach TP=8 FP=0 FN=0
# held-out. They stay learned.
#
# What remains true, and is UNTESTED rather than refuted: the held-out 2.4.6 pages use 'overview',
# 'more', 'stuff' and 'welcome' -- all four already in the training vocabulary -- because the same
# generator builds both sets from the same 15 words. So the gate proves generalisation to new PAGES
# and says nothing about new VOCABULARY. Holding out WORDS rather than pages is the experiment that
# would answer it, and until it runs, no claim should be made about unseen vague terms.
#
# For the record on prior art, which does not decide this either way: WAVE flags a link whose text is
# "click here" / "here" / "more" / "details" / ..., eslint-plugin-jsx-a11y ships
# DEFAULT_AMBIGUOUS_WORDS on exact match, and axe-core declines to judge text quality at all.
RULE_OWNED_CRITERIA = frozenset({"1.1.1", "4.1.2"})

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("runs/screenreader-dataset/screenreader-evidence.jsonl"))
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models" / "encoders" / "all-MiniLM-L6-v2")
    parser.add_argument("--output", type=Path, default=SCORER_PACKAGE / "models" / "screenreader-scorer")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--max-length", type=int, default=256)
    return parser.parse_args()

def assign_splits(records: list[dict[str, Any]]) -> dict[str, str]:
    families = sorted({record["provenance"]["family"] for record in records})
    assignment = {}
    for family in families:
        bucket = int(hashlib.sha256(family.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
        if bucket < TRAIN_RATIO:
            assignment[family] = "train"
        elif bucket < TRAIN_RATIO + VALIDATION_RATIO:
            assignment[family] = "validation"
        else:
            assignment[family] = "test"
    return assignment

def calibration_fold_for_family(family: str) -> int:
    digest = hashlib.sha256((family + "|threshold-calibration").encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % CALIBRATION_FOLDS

def out_of_fold_scores(
    features: Any,
    labels: Any,
    records: list[dict[str, Any]],
    development_indices: list[int],
    epochs: int,
    offsets: list[int],
) -> Any:
    import torch

    scores = torch.zeros(len(records), dtype=torch.float32)
    development_families = {records[index]["provenance"]["family"] for index in development_indices}
    folds = {
        family: calibration_fold_for_family(family)
        for family in development_families
    }
    for fold in range(CALIBRATION_FOLDS):
        held_out = [
            index for index in development_indices
            if folds[records[index]["provenance"]["family"]] == fold
        ]
        training = [
            index for index in development_indices
            if folds[records[index]["provenance"]["family"]] != fold
        ]
        if not held_out or not training:
            continue
        weight, bias = train_head(features, offsets, labels, training, epochs)
        scores[held_out] = score_bags(features, offsets, weight, bias)[held_out]
    return scores

def metrics(scores: Any, labels: Any, threshold: float) -> dict[str, float | int]:
    import torch

    labels_bool = labels == 1
    predicted = scores >= threshold
    true_positive = int(torch.logical_and(predicted, labels_bool).sum())
    false_positive = int(torch.logical_and(predicted, ~labels_bool).sum())
    false_negative = int(torch.logical_and(~predicted, labels_bool).sum())
    clean = int((labels == 0).sum())
    precision = true_positive / max(true_positive + false_positive, 1)
    recall = true_positive / max(true_positive + false_negative, 1)
    return {
        "records": int(labels.numel()),
        "positive": int(labels.sum()),
        "clean": clean,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / max(precision + recall, 1e-9),
    }

def choose_threshold(scores: Any, labels: Any, criterion: str = "?", warnings: list[str] | None = None) -> float:
    """Lowest threshold reaching zero false positives, by F1.

    The fallback is REPORTED, not silent. When no candidate reaches zero false positives this returns
    0.5 -- a value nobody chose, for a criterion whose calibration just failed -- and a default that
    looks like a decision is how an unexamined number ends up in a release artifact.
    """
    candidates = [i / 100 for i in range(5, 100, 5)]
    valid = []
    for threshold in candidates:
        result = metrics(scores, labels, threshold)
        if result["falsePositive"] == 0:
            valid.append((result["f1"], threshold))
    if not valid:
        if warnings is not None:
            warnings.append(
                f"{criterion}: no threshold reaches zero false positives; falling back to 0.5, which "
                "nobody chose — this criterion is not calibrated"
            )
        return 0.5
    # Once the zero-false-positive guard is satisfied, prefer the lowest
    # threshold among equal-F1 candidates. That preserves recall and follows
    # the model's accessibility safety objective rather than adding a second,
    # undocumented conservatism bias through tuple ordering.
    return max(valid, key=lambda item: (item[0], -item[1]))[1]

def bag_logits(unit_logits: Any, offsets: list[int]) -> Any:
    """Max over each bag's instance logits -> one logit per record.

    On LOGITS rather than probabilities: sigmoid is monotonic, so max-of-sigmoids equals
    sigmoid-of-max, and BCEWithLogitsLoss is numerically safer than sigmoid-then-BCE. This is the
    training-side twin of `score_bags`, and the two must stay in step -- a different aggregation on
    each side yields plausible numbers and wrong findings.
    """
    import torch

    gather, mask = bag_gather(offsets)
    return unit_logits[gather].masked_fill(~mask, float("-inf")).max(dim=1).values


def train_head(features: Any, offsets: list[int], labels: Any, indices: list[int], epochs: int) -> tuple[Any, Any]:
    """Train one subtype head under multiple-instance max pooling.

    Takes the FULL feature matrix plus the record indices to train on, rather than a pre-sliced one:
    features are now per evidence unit, so slicing by record index would cut the rows apart from the
    bags they belong to. Every epoch scores all instances, maxes within each bag, then selects the
    records in this split -- so the gradient reaches only the argmax instance of each record, which is
    what makes this MIL rather than document classification.
    """
    import torch

    torch.manual_seed(SEED)
    head = torch.nn.Linear(features.shape[1], 1)
    selected = torch.tensor(indices, dtype=torch.long)
    split_labels = labels[selected]
    positives = split_labels.sum().item()
    negatives = split_labels.numel() - positives
    positive_weight = max(negatives / max(positives, 1), 1.0)
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=torch.tensor([positive_weight]))
    optimizer = torch.optim.AdamW(head.parameters(), lr=0.02, weight_decay=0.01)
    # Fixed for the whole run, so it is built once here rather than rebuilt on each of 250 epochs.
    gather, mask = bag_gather(offsets)
    for _ in range(epochs):
        optimizer.zero_grad()
        unit_logits = head(features).squeeze(1)
        record_logits = unit_logits[gather].masked_fill(~mask, float("-inf")).max(dim=1).values
        loss = loss_fn(record_logits[selected], split_labels.float())
        loss.backward()
        optimizer.step()
    return head.weight.detach().clone(), head.bias.detach().clone()

def main() -> None:
    args = parse_args()
    random.seed(SEED)
    encoder_file = assert_encoder(args.encoder)
    records = read_records(args.data)
    split_for_family = assign_splits(records)
    features, dimension, structured_dimension = encode_records(records, args.encoder, args.max_length)
    # Derived from the records, never passed between processes: the scorer recomputes it the same way.
    offsets = bag_offsets(records)
    # Both views, computed once. A document-pooled head sees one row per capture with identity
    # offsets, so it runs through the same bag machinery as an instance-pooled one -- a bag of size
    # one. See INSTANCE_POOLED_SUBTYPES for why the choice is per subtype.
    doc_features, doc_offsets = encode_documents(records, args.encoder, args.max_length)
    views = {
        "instance-max": (features, offsets),
        "document-mean": (doc_features, doc_offsets),
    }
    import torch
    from safetensors.torch import save_file

    criteria = sorted({criterion for record in records for criterion in record["target"].get("criteria", [])})
    subtypes_by_criterion = {
        criterion: sorted({
            subtype for record in records
            if criterion in record["target"].get("criteria", [])
            for subtype in record["target"].get("subtypes", [])
            if subtype.startswith(criterion + ":")
        })
        for criterion in criteria
    }
    split_indices = {
        split: [index for index, record in enumerate(records) if split_for_family[record["provenance"]["family"]] == split]
        for split in ("train", "validation", "test")
    }
    development_indices = split_indices["train"] + split_indices["validation"]
    weights = {}
    report: dict[str, Any] = {
        "schema": "a11y-witness/screenreader-scorer-training",
        "encoder": {"path": str(args.encoder), "hiddenSize": dimension, "modelSha256": sha256(encoder_file)},
        "representation": {
            "schema": FEATURE_SCHEMA_VERSION,
            "text": "channel-tagged screen-reader evidenceUnits",
            "embeddingSize": dimension,
            "structuredFeatureSize": structured_dimension,
            "structuredFeatureScale": ENGINEERED_FEATURE_SCALE,
            "structuredFeatureMultipliers": ENGINEERED_FEATURE_MULTIPLIERS,
            "structuredFeatures": list(FEATURE_NAMES),
            "maxLength": args.max_length,
        },
        "dataset": {"path": str(args.data), "sha256": sha256(args.data), "records": len(records)},
        "split": {split: len(indices) for split, indices in split_indices.items()},
        "calibration": {
            "method": "grouped-out-of-fold-threshold-calibration",
            "folds": CALIBRATION_FOLDS,
            "developmentRecords": len(development_indices),
        },
        "criteria": {},
        # What the trainer can actually know: its own calibration, on the DEVELOPMENT split.
        "calibrationClean": True,
        # What it cannot know, and used to imply. `releaseEligible` was set purely from calibration, so
        # it certified a model the held-out set rejects — measured: calibration went perfectly clean
        # while acceptance failed on four criteria, unchanged. A flag computed on the split a model was
        # tuned against cannot detect fitting that split, and `score.py` trusts this field.
        #
        # Stays False until the acceptance evaluator stamps it, and names what is missing so nobody
        # reads absence as a pass. `release:gate` runs that evaluator; nothing else may set this.
        "generalisationVerified": False,
        "releaseBlockedBy": ["held-out acceptance has not been evaluated for these weights"],
        "releaseEligible": True,
        "modelReleaseEligible": True,
        "warnings": [],
    }
    for criterion in criteria:
        criterion_labels = torch.tensor(
            [int(criterion in record["target"].get("criteria", [])) for record in records],
            dtype=torch.float32,
        )
        subtype_oof_scores = []
        subtype_final_scores = []
        subtype_report = {}
        for subtype in subtypes_by_criterion[criterion]:
            subtype_labels = torch.tensor(
                [int(subtype in record["target"].get("subtypes", [])) for record in records],
                dtype=torch.float32,
            )
            subtype_development_labels = subtype_labels[development_indices]
            if int(subtype_development_labels.sum()) < 20:
                report["modelReleaseEligible"] = False
                if criterion not in RULE_OWNED_CRITERIA:
                    report["releaseEligible"] = False
                    report["calibrationClean"] = False
                report["warnings"].append(f"{subtype}: fewer than 20 positive development records")
            pooling = pooling_for(subtype)
            view_features, view_offsets = views[pooling]
            oof_scores = out_of_fold_scores(
                view_features,
                subtype_labels,
                records,
                development_indices,
                args.epochs,
                view_offsets,
            )
            weight, bias = train_head(view_features, view_offsets, subtype_labels, development_indices, args.epochs)
            key = head_key(subtype)
            weights[key + ".weight"] = weight
            weights[key + ".bias"] = bias
            subtype_oof_scores.append(oof_scores)
            subtype_final_scores.append(score_bags(view_features, view_offsets, weight, bias))
            subtype_report[subtype] = {
                "head": key,
                # The view this head was TRAINED on. Inference reads it rather than assuming, because
                # scoring a document-pooled head per announcement (or the reverse) produces confident
                # numbers from the wrong representation -- and nothing downstream could tell.
                "pooling": pooling,
                "development": metrics(oof_scores[development_indices], subtype_development_labels, 0.5),
            }

        criterion_oof_scores = torch.stack(subtype_oof_scores).amax(dim=0)
        criterion_final_scores = torch.stack(subtype_final_scores).amax(dim=0)
        threshold = choose_threshold(
            criterion_oof_scores[development_indices],
            criterion_labels[development_indices],
            criterion,
            report["warnings"],
        )
        criterion_report = {
            "decisionOwner": "deterministic-rules" if criterion in RULE_OWNED_CRITERIA else "learned-screenreader-scorer",
            "threshold": threshold,
            "subtypes": subtype_report,
            "calibration": metrics(
                criterion_oof_scores[development_indices],
                criterion_labels[development_indices],
                threshold,
            ),
        }
        for split, indices in split_indices.items():
            criterion_report[split] = metrics(criterion_final_scores[indices], criterion_labels[indices], threshold)
            if int(criterion_labels[indices].sum()) == 0:
                report["modelReleaseEligible"] = False
                if criterion not in RULE_OWNED_CRITERIA:
                    report["releaseEligible"] = False
                    report["calibrationClean"] = False
                report["warnings"].append(f"{criterion}: {split} split has no positive records")
        calibration_false_positive = criterion_report["calibration"]["falsePositive"]
        calibration_false_negative = criterion_report["calibration"]["falseNegative"]
        if calibration_false_positive or calibration_false_negative:
            report["modelReleaseEligible"] = False
            if criterion not in RULE_OWNED_CRITERIA:
                report["releaseEligible"] = False
                report["calibrationClean"] = False
            report["warnings"].append(
                f"{criterion}: grouped calibration has {calibration_false_positive} false positives "
                f"and {calibration_false_negative} false negatives"
            )
        report["criteria"][criterion] = criterion_report

    args.output.mkdir(parents=True, exist_ok=True)
    save_file(
        weights,
        str(args.output / "model.safetensors"),
        metadata={
            "format": "pt",
            "encoder": "all-MiniLM-L6-v2",
            "encoder_sha256": sha256(encoder_file),
            "representation": FEATURE_SCHEMA_VERSION,
            "structured_features": json.dumps(list(FEATURE_NAMES)),
            "structured_feature_scale": str(ENGINEERED_FEATURE_SCALE),
            "structured_feature_multipliers": json.dumps(ENGINEERED_FEATURE_MULTIPLIERS, sort_keys=True),
            "max_length": str(args.max_length),
        },
    )
    (args.output / "training-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["releaseEligible"]:
        print("WARNING: this is a seed smoke-test artifact, not a release candidate")

if __name__ == "__main__":
    main()
