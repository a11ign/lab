#!/usr/bin/env python3
"""Report held-out scorer errors with the underlying NVDA evidence attached.

This is deliberately an analysis tool, not a training input path.  It loads the
same safetensors encoder/head used by training, then joins each false positive
or false negative to its capture provenance and screen-reader-only evidence.
HTML, DOM, URL, and other page-source fields are never used as features.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


# Two different anchors, because this file needs two different things and one variable was doing both jobs:
# the SCORER PACKAGE (a sibling package) and the CORPUS (`runs/`, at the repo root). After M8 moved this file
# into `packages/lab/scripts/`, the single `parents[1]` anchor pointed at `packages/lab` and produced
# `packages/lab/packages/scorer/python/score.py` — a path that does not exist.
REPO_ROOT = Path(__file__).resolve().parents[3]

# The weights, the encoder and the scoring program live in `@a11y-witness/scorer` (PLAN.md M3). Anchored on
# the package directory rather than on `models/` at the repo root, which no longer holds them.
# `packages/lab/scripts/` -> `packages/` -> `packages/scorer`. It was `parents[1] / "packages" / "scorer"`,
# which resolved to `packages/lab/packages/scorer` once M8 moved this file into the lab package — a path that
# does not exist, and the failure was `ModuleNotFoundError: No module named 'screenreader_features'`.
SCORER_PACKAGE = Path(__file__).resolve().parents[2] / "scorer"


def load_training_module() -> Any:
    path = Path(__file__).with_name("train-screenreader-model.py")
    spec = importlib.util.spec_from_file_location("screenreader_training", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load training helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_cache import cached_encode  # noqa: E402  (path shim must precede the import)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=REPO_ROOT / "runs/screenreader-dataset/screenreader-evidence.jsonl")
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models/encoders/all-MiniLM-L6-v2")
    parser.add_argument("--model", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer/model.safetensors")
    parser.add_argument("--training-report", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer/training-report.json")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "runs/screenreader-dataset/screenreader-error-analysis.json")
    parser.add_argument("--split", choices=("train", "validation", "test", "all"), default="test")
    parser.add_argument("--criterion", action="append", help="limit analysis to one or more criteria")
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=250)
    return parser.parse_args()


def evidence(record: dict[str, Any]) -> dict[str, Any]:
    input_data = record["input"]
    return {
        "transcript": input_data.get("transcript", []),
        "evidenceText": input_data.get("evidenceText", ""),
        "structure": input_data.get("structure"),
        "interaction": input_data.get("interaction"),
    }


def diagnosis(record: dict[str, Any], score: float, threshold: float, expected: str, error: str) -> dict[str, Any]:
    provenance = record["provenance"]
    return {
        "caseId": provenance.get("caseId"),
        "family": provenance.get("family"),
        "variant": provenance.get("variant"),
        "source": provenance.get("source"),
        "mutation": provenance.get("mutation"),
        "expected": expected,
        "error": error,
        "score": score,
        "threshold": threshold,
        "evidence": evidence(record),
    }


def subtype_scores(training: Any, subtype_reports: dict[str, Any], views: dict[str, Any], weights: Any) -> dict[str, Any]:
    """One score per RECORD per SUBTYPE, each head on the view it was trained on.

    Two defects fixed here at once, and both made every number this file printed meaningless.

    It called `score_head` on the output of `encode_records`, which is a row per EVIDENCE UNIT — so it
    compared ~54,000 scores against 2,006 per-record labels. That is the same train/inference asymmetry
    `evaluate-screenreader-acceptance.py` documents having hit, in the file whose whole job is to name
    which records the model gets wrong.

    And it took `amax` over the heads to cut with one criterion-level threshold. The heads are on
    different scales, so no such cut is calibratable; `score.py` removed the criterion threshold for that
    reason and this file kept reading it, dying on `KeyError: 'threshold'`.
    """
    return {
        subtype: training.score_bags(
            *views[details.get("pooling", "document-mean")],
            weights[details["head"] + ".weight"],
            weights[details["head"] + ".bias"],
        )
        for subtype, details in subtype_reports.items()
    }


def record_errors(
    records: list[dict[str, Any]],
    indices: list[int],
    scores: Any,
    labels: Any,
    threshold: float,
    error_context: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    false_positives = []
    false_negatives = []
    for index in indices:
        expected = "violation" if labels[index] else "clean"
        predicted = bool(scores[index] >= threshold)
        if predicted and expected == "clean":
            false_positives.append(diagnosis(records[index], float(scores[index]), threshold, expected, error_context + "FalsePositive"))
        elif not predicted and expected == "violation":
            false_negatives.append(diagnosis(records[index], float(scores[index]), threshold, expected, error_context + "FalseNegative"))
    return false_positives, false_negatives


def main() -> None:
    args = parse_args()
    training = load_training_module()
    records = training.read_records(args.data)
    encoder_file = training.assert_encoder(args.encoder)
    report = json.loads(args.training_report.read_text(encoding="utf-8"))

    import torch
    from safetensors.torch import load_file

    split_for_family = training.assign_splits(records)
    # Both views, keyed exactly as the trainer keys them. A document-pooled head sees a bag of one.
    #
    # TORCH on both sides, deliberately. The featurizer returns numpy and the weights here load as torch
    # tensors, and `score_head`'s `features @ weight.T` accepts that mixture right up until it raises
    # `TypeError: unsupported operand type(s) for @`. Unlike the acceptance evaluator -- which is numpy
    # throughout, because it only scores -- this file also RETRAINS heads out of fold, and
    # `out_of_fold_scores` needs autograd. So it converts at this boundary, exactly as the trainer does.
    # Cached, like the trainer: this re-encodes the SAME corpus the trainer just encoded, and the two
    # share a cache entry because the key is the encoder plus the record inputs, not the caller.
    features_np, doc_features_np, doc_offsets, _, _ = cached_encode(
        training, records, args.encoder, args.max_length
    )
    features = torch.from_numpy(features_np)
    views = {
        "instance-max": (features, training.bag_offsets(records)),
        "document-mean": (torch.from_numpy(doc_features_np), doc_offsets),
    }
    weights = load_file(str(args.model))
    selected_splits = ("train", "validation", "test") if args.split == "all" else (args.split,)
    criteria = sorted(report.get("criteria", {}))
    if args.criterion:
        wanted = set(args.criterion)
        criteria = [criterion for criterion in criteria if criterion in wanted]
        missing = wanted.difference(criteria)
        if missing:
            raise RuntimeError("criteria missing from training report: " + ", ".join(sorted(missing)))

    result: dict[str, Any] = {
        "schema": "a11y-witness/screenreader-scorer-error-analysis",
        "dataset": {"path": str(args.data), "sha256": training.sha256(args.data), "records": len(records)},
        "encoder": {"path": str(args.encoder), "sha256": training.sha256(encoder_file)},
        "model": {"path": str(args.model), "sha256": training.sha256(args.model)},
        "split": args.split,
        "criteria": {},
        "summary": {"falsePositives": 0, "falseNegatives": 0, "criteriaWithErrors": 0},
    }

    selected_indices = [
        index for index, record in enumerate(records)
        if split_for_family[record["provenance"]["family"]] in selected_splits
    ]
    # Errors are reported PER SUBTYPE, because that is the granularity a head is trained and cut at, and
    # therefore the only granularity at which "which records does it get wrong" has an answer you can act
    # on. Per criterion, 4.1.2's 22 errors were one undifferentiated pile spanning three heads.
    for criterion in criteria:
        criterion_report = report["criteria"][criterion]
        scores_by_subtype = subtype_scores(training, criterion_report["subtypes"], views, weights)
        for subtype, scores in scores_by_subtype.items():
            details = criterion_report["subtypes"][subtype]
            threshold = float(details["threshold"])
            labels = torch.tensor(
                [int(subtype in record["target"].get("subtypes", [])) for record in records],
                dtype=torch.bool,
            )
            false_positives, false_negatives = record_errors(
                records, selected_indices, scores, labels, threshold, ""
            )
            result["criteria"][subtype] = {
                "criterion": criterion,
                "threshold": threshold,
                "decisionOwner": details.get("decisionOwner", "learned-screenreader-scorer"),
                "falsePositiveCount": len(false_positives),
                "falseNegativeCount": len(false_negatives),
                "falsePositives": false_positives,
                "falseNegatives": false_negatives,
            }
            result["summary"]["falsePositives"] += len(false_positives)
            result["summary"]["falseNegatives"] += len(false_negatives)
            if false_positives or false_negatives:
                result["summary"]["criteriaWithErrors"] += 1

    development_indices = [
        index for index, record in enumerate(records)
        if split_for_family[record["provenance"]["family"]] in {"train", "validation"}
    ]
    calibration_result: dict[str, Any] = {
        "method": "grouped-out-of-fold-threshold-calibration",
        "records": len(development_indices),
        "criteria": {},
        "summary": {"falsePositives": 0, "falseNegatives": 0, "criteriaWithErrors": 0},
    }
    for criterion in criteria:
        criterion_report = report["criteria"][criterion]
        for subtype, details in criterion_report["subtypes"].items():
            subtype_labels = torch.tensor(
                [int(subtype in record["target"].get("subtypes", [])) for record in records],
                dtype=torch.float32,
            )
            # Out-of-fold, on the head's OWN view and its OWN cut. It used to pool `amax` across the
            # criterion's heads and cut with one number, which is the arithmetic the calibration it is
            # reporting on no longer performs -- so this section described a model that does not exist.
            view_features, view_offsets = views[details.get("pooling", "document-mean")]
            calibration_scores = training.out_of_fold_scores(
                view_features, subtype_labels, records, development_indices, args.epochs, view_offsets
            )
            false_positives, false_negatives = record_errors(
                records,
                development_indices,
                calibration_scores,
                subtype_labels.bool(),
                float(details["threshold"]),
                "calibration",
            )
            calibration_result["criteria"][subtype] = {
                "criterion": criterion,
                "threshold": details["threshold"],
                "falsePositiveCount": len(false_positives),
                "falseNegativeCount": len(false_negatives),
                "falsePositives": false_positives,
                "falseNegatives": false_negatives,
            }
            calibration_result["summary"]["falsePositives"] += len(false_positives)
            calibration_result["summary"]["falseNegatives"] += len(false_negatives)
            if false_positives or false_negatives:
                calibration_result["summary"]["criteriaWithErrors"] += 1
    result["calibration"] = calibration_result

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))
    for subtype, details in result["criteria"].items():
        owner = "" if details["decisionOwner"] == "learned-screenreader-scorer" else f"  [{details['decisionOwner']}]"
        print(f"{subtype:32} thr {details['threshold']:.2f}  "
              f"{details['falsePositiveCount']} false positives, {details['falseNegativeCount']} false negatives{owner}")
    print("calibration:", json.dumps(calibration_result["summary"]))


if __name__ == "__main__":
    main()
