#!/usr/bin/env python3
"""Evaluate the scorer on a capture set that is disjoint from training.

The acceptance set is never used to fit heads or thresholds. If multiple exported
files are supplied, repeated case/variant records are also used to measure whether
the same NVDA interaction crosses the model threshold between captures.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import json
from collections import defaultdict
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
# The DECISION lives in the scorer package, so this reaches for it rather than reimplementing it. Loaded
# by path for the same reason `score.py` is: this file is not inside that package and must not assume an
# installed one.
sys.path.insert(0, str(SCORER_PACKAGE / "python"))
import applicability  # noqa: E402  (path shim must precede the import)


def load_training_module() -> Any:
    path = Path(__file__).with_name("train-screenreader-model.py")
    spec = importlib.util.spec_from_file_location("screenreader_training", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load training helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_scorer_module() -> Any:
    path = SCORER_PACKAGE / "python" / "score.py"
    spec = importlib.util.spec_from_file_location("screenreader_scorer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load scorer helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", action="append", type=Path)
    parser.add_argument("--training-data", type=Path, default=REPO_ROOT / "runs/screenreader-dataset/screenreader-evidence.jsonl")
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models/encoders/all-MiniLM-L6-v2")
    parser.add_argument("--model", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer", help="scorer directory or model.safetensors path")
    parser.add_argument("--training-report", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer/training-report.json")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "runs/screenreader-acceptance/acceptance-report.json")
    # A gate you cannot run until you have already passed it is not a gate. This evaluator hard-coded
    # `allow_ineligible=False`, so the held-out set could only ever CONFIRM a release decision, never
    # inform one -- and since release-eligibility currently demands zero errors, it could not be used
    # to ask whether that bar is the right one. Diagnostics-only, and the report says so.
    parser.add_argument("--allow-ineligible", action="store_true",
                        help="score a model that is not releaseEligible; for measurement, never for release")
    parser.add_argument("--min-positive", type=int, default=3)
    parser.add_argument("--min-clean", type=int, default=3)
    parser.add_argument("--max-length", type=int, default=256)
    args = parser.parse_args()
    if not args.data:
        args.data = [REPO_ROOT / "runs/screenreader-acceptance/screenreader-evidence.jsonl"]
    return args


def model_directory(path: Path) -> Path:
    """Accept the historical file argument while verifying the complete artifact directory."""
    if path.is_dir() or path.suffix == "":
        return path
    return path.parent


def load_records(training: Any, paths: list[Path]) -> list[dict[str, Any]]:
    records = []
    for path in paths:
        if not path.is_file():
            raise RuntimeError(f"acceptance data is missing: {path}")
        records.extend(training.read_records(path))
    if not records:
        raise RuntimeError("acceptance data is empty")
    return records


def score_subtypes(training: Any, subtype_reports: dict[str, Any], views: dict[str, Any], weights: Any) -> dict[str, Any]:
    """One score per RECORD per SUBTYPE, each head using its own pooling.

    `encode_records` returns a row per EVIDENCE UNIT, not per record. This function used to hand that
    matrix straight to `score_head`, so it produced ~54,000 scores to compare against 120 labels —
    every held-out number it reported after multiple-instance pooling landed was meaningless, and it
    read as the model detecting nothing rather than as a broken comparison. That is the train/inference
    asymmetry this pooling change was warned to watch for, in the one file that measures generalisation.

    It returned `amax` over the heads until now, for one criterion-level threshold to cut. That is the
    same arithmetic `score.py` removed: the heads are on different scales, so one cut over their maximum
    cannot be calibrated. Each head is cut on its own distribution and the criterion is the OR — and when
    the criterion-level `threshold` disappeared from the report, THIS file kept reading it and died with
    `KeyError: 'threshold'`. `release:gate` runs this evaluator, so that gate was broken from the same
    commit, invisibly, because the `releaseEligible` refusal in front of it fired first.
    """

    scores = {}
    for subtype, subtype_details in subtype_reports.items():
        weight = weights[subtype_details["head"] + ".weight"]
        bias = weights[subtype_details["head"] + ".bias"]
        view_features, view_offsets = views[subtype_details.get("pooling", "document-mean")]
        # numpy, matching the featurizer: this script only EVALUATES, so nothing here needs autograd,
        # and `score_bags` returns numpy for exactly that reason.
        scores[subtype] = training.score_bags(view_features, view_offsets, weight, bias)
    return scores


# How many failing cases to name before the list stops being read. Enough to see a pattern -- one subtype
# repeating, or one page family -- without turning a report into a corpus dump.
MAX_NAMED_FAILURES = 12


def case_identity(record: dict[str, Any]) -> str:
    """`caseId/variant` — the same key the stability grouping uses, so a name here matches a name there."""
    provenance = record.get("provenance", {})
    return f"{provenance.get('caseId', '?')}/{provenance.get('variant', '?')}"


def metrics(scores: Any, labels: Any, threshold: float, identities: list[str] | None = None) -> dict[str, Any]:
    """Counts, and WHICH records produced them.

    It returned counts alone, and a count is where an investigation stops rather than starts. Measured
    2026-08-23 against the shipped model on a fresh held-out set: `1.3.1: acceptance false negatives` and
    `2.4.6: acceptance false positives`, two of each. From the report it was impossible to tell whether that
    was one subtype systematically missed or two unlucky pages -- and those need completely different
    responses. Answering it meant re-running the evaluator by hand with print statements.

    This repo already states the rule, in `capture-real-pages`: "Named, not counted. '3 failed' tells you
    nothing about whether the corpus is usable." The same argument that made `crossCheckStructure` report
    `link 51/58` instead of "examination was INCOMPLETE".

    Bounded and marked when truncated, because a report nobody can read is its own kind of silence.
    """
    predicted = scores >= threshold
    true_positive = int((predicted & labels).sum())
    false_positive = int((predicted & ~labels).sum())
    false_negative = int((~predicted & labels).sum())
    clean = int((~labels).sum())
    named: dict[str, Any] = {}
    if identities is not None:
        for key, mask in (("falsePositiveCases", predicted & ~labels), ("falseNegativeCases", ~predicted & labels)):
            # SCORE AND CUT, beside the name. The docstring above says a count is where an investigation
            # stops; a NAME is where the next one stops. Measured 2026-09-01: a candidate that closed every
            # free veto failed here on exactly one case, and the report could not say whether it scored
            # 0.90 against a 0.9153 cut -- threshold variance, and the change should ship -- or 0.30, which
            # would mean the head had genuinely lost it. Those need opposite responses and the difference
            # is one float. Answering it meant reverting the change, which is the expensive direction.
            #
            # DERIVED IN THE SAME LOOP from the same mask, never as a second list. Two structures naming
            # one set of records is this repo's most-recorded defect, and the truncation below would have
            # had to be applied identically to both.
            hits = sorted((identities[i], float(scores[i])) for i in range(len(identities)) if mask[i])
            named[key] = [identity for identity, _ in hits][:MAX_NAMED_FAILURES]
            named[key.replace("Cases", "Scores")] = {
                identity: round(score, 4) for identity, score in hits[:MAX_NAMED_FAILURES]}
            if len(hits) > MAX_NAMED_FAILURES:
                named[key + "Truncated"] = len(hits) - MAX_NAMED_FAILURES
        # The cut those scores are compared against. Without it the numbers above are unanchored, which is
        # the `phys_footprint` lesson in a report: a value is only as good as what it was measured against.
        named["threshold"] = round(float(threshold), 4)
    return {
        **named,
        # numpy uses .size where torch uses .numel(); the whole evaluator moved to numpy with the featurizer.
        "records": int(labels.size),
        "positive": int(labels.sum()),
        "clean": clean,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": true_positive / max(true_positive + false_positive, 1),
        "recall": true_positive / max(true_positive + false_negative, 1),
    }


def stability(scores: Any, records: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    for index, record in enumerate(records):
        key = (record["provenance"]["caseId"], record["provenance"]["variant"])
        groups[key].append(float(scores[index]))
    repeated = {}
    for key, values in groups.items():
        if len(values) < 2:
            continue
        predictions = {value >= threshold for value in values}
        repeated["/".join(key)] = {
            "captures": len(values),
            "scoreMinimum": min(values),
            "scoreMaximum": max(values),
            "unstable": len(predictions) > 1,
        }
    unstable = sum(1 for result in repeated.values() if result["unstable"])
    return {
        "groups": len(groups),
        "repeatedGroups": len(repeated),
        "unstableGroups": unstable,
        "measured": bool(repeated),
        "passed": bool(repeated) and unstable == 0,
        "details": repeated,
    }


# `metrics` takes scores and a threshold, so a decided 1.0/0.0 array with a 0.5 cut reuses it exactly --
# the same device the trainer uses for a criterion that is an OR over its heads.
DECIDED = 0.5


def merge_stability(per_subtype: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A criterion is stable when EVERY head under it is, and the report names the ones that are not.

    Strictly harsher than asking whether the criterion's OR flipped: a head can wobble while another
    keeps the OR true. That is the right bar here, because the question this gate answers is whether
    NVDA's output is repeatable enough for the model to decide the same way twice -- and a head that
    flips is that failure whether or not a sibling happens to mask it.
    """
    measured = [details for details in per_subtype.values() if details["measured"]]
    return {
        "measured": bool(measured),
        "passed": bool(measured) and all(details["passed"] for details in measured),
        "unstableSubtypes": sorted(s for s, d in per_subtype.items() if d["measured"] and not d["passed"]),
        "subtypes": per_subtype,
    }


def eligible_records(criterion: str, model_subtypes: dict[str, Any], records: list[dict[str, Any]]) -> tuple[list[int], int]:
    """Records this criterion's MODEL heads are answerable for.

    It took the criterion's whole subtype map, which included the ones a deterministic rule substitutes
    for. A record labelled only `3.3.2:unnamed-form-field` then counted as a 3.3.2 positive the model was
    charged a false negative for, while in production that finding comes from the rule layer. Charging a
    head for records it is not asked to decide is the mirror of exempting one that is.
    """
    eligible_subtypes = set(model_subtypes)
    indices = []
    excluded = 0
    for index, record in enumerate(records):
        subtypes = set(record["target"].get("subtypes", []))
        if criterion in record["target"].get("criteria", []) and not subtypes.intersection(eligible_subtypes):
            excluded += 1
            continue
        indices.append(index)
    return indices, excluded


def model_decision_owner(criterion_report: dict[str, Any]) -> str:
    # Reports produced before decision ownership was recorded remain learned
    # scorer reports for backwards compatibility.
    return criterion_report.get("decisionOwner", "learned-screenreader-scorer")


def assert_disjoint(training: Any, acceptance: list[dict[str, Any]], training_data: Path) -> None:
    trained = training.read_records(training_data)
    trained_cases = {record["provenance"].get("caseId") for record in trained}
    trained_families = {record["provenance"].get("family") for record in trained}
    overlap_cases = sorted({record["provenance"].get("caseId") for record in acceptance} & trained_cases)
    overlap_families = sorted({record["provenance"].get("family") for record in acceptance} & trained_families)
    if overlap_cases or overlap_families:
        raise RuntimeError("acceptance data overlaps training: " + json.dumps({"cases": overlap_cases, "families": overlap_families}))


# `packages/` is source: tracked, reviewed, and released. `runs/` is where a run's output belongs.
TRACKED_SOURCE_DIR = "packages"


def refuse_to_stamp_source_tree(report_path: Path) -> None:
    """A measurement may not rewrite released provenance, or dirty the checkout it ran from.

    Scoring the SHIPPED model is a legitimate thing to do — it is how you find out whether the weights in
    production still pass the held-out set. Stamping the verdict into that model's own training report is
    not: it overwrites the record of what was true when the weights were released, with the result of a
    run that released nothing.

    Measured 2026-08-23. `packages/scorer/models/screenreader-scorer/training-report.json` came back
    modified, carrying `generalisationVerified: false` and two held-out blockers, on weights that had
    shipped clean. The second cost was larger than the first: `packages/` is tracked, so the lab checkout
    was dirty, `run-job.yml` refused to pull into somebody's work — correctly — and the lab silently ran
    **17 commits behind origin** for days. Every job said "Not pulling: the checkout is dirty" and none
    said what that meant.

    So this is not really about one file. Anything writing into `packages/` from a run turns a source tree
    into an output directory, and this repo reaches its lab exclusively by pulling into that tree.
    """
    parts = report_path.resolve().parts
    if TRACKED_SOURCE_DIR not in parts:
        return
    raise SystemExit(
        f"refusing to stamp a verdict into {report_path}: it is inside {TRACKED_SOURCE_DIR}/, which is "
        "tracked source, not run output.\n"
        "Scoring the shipped model is fine; rewriting its release record is not — that record describes "
        "what was true when those weights shipped.\n"
        "Copy the model to runs/ and score the copy:\n"
        "  cp -r packages/scorer/models/screenreader-scorer runs/model-shipped\n"
        "  ... --model runs/model-shipped --training-report runs/model-shipped/training-report.json\n"
        "A dirty packages/ also stops the lab pulling, which is how it ran 17 commits behind for days."
    )


def stamp_generalisation(report_path: Path, passed: bool, reasons: list[str], diagnostic: bool) -> None:
    """Write the held-out verdict back into the training report beside the weights it describes.

    Kept next to the weights deliberately: a verdict in a separate file is a verdict that can be lost,
    and `score.py` reads the training report. Retraining rewrites the report and resets this to False,
    which is correct — new weights have not been evaluated.

    A DIAGNOSTIC run may not stamp a pass, and this is not a formality. `--allow-ineligible` exists to
    score weights the calibration gate has already rejected; letting such a run write
    `generalisationVerified: true` would put the release stamp on weights that failed the gate in front
    of it, and nothing in the artifacts recorded that the flag had been used. A diagnostic failure IS
    recorded — an absent verdict and a failed one must not look the same, which is this file's own rule.

    `releaseBlockedBy` is REBUILT rather than emptied. It used to be set to `[]` on a pass, which erased
    the calibration blockers the trainer had put there and left a report saying nothing blocks release
    while `releaseEligible` was still false.
    """
    if not report_path.exists():
        return
    refuse_to_stamp_source_tree(report_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    blockers = [b for b in report.get("releaseBlockedBy", []) if not b.startswith("held-out acceptance")]
    if diagnostic:
        report["generalisationVerified"] = False
        blockers.append(
            "held-out acceptance was run with --allow-ineligible, which is a measurement, not a verdict"
            + ("" if passed else f"; it also failed: {'; '.join(reasons)}")
        )
    else:
        report["generalisationVerified"] = bool(passed)
        if not passed:
            blockers += [f"held-out acceptance failed: {r}" for r in reasons]
    report["releaseBlockedBy"] = blockers
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    training = load_training_module()
    scorer = load_scorer_module()
    records = load_records(training, args.data)
    assert_disjoint(training, records, args.training_data)
    report, weights, artifact = scorer.verify_artifact(
        argparse.Namespace(
            model=model_directory(args.model),
            training_report=args.training_report,
            encoder=args.encoder,
            allow_ineligible=args.allow_ineligible,
        ),
        training,
        # This tool DECIDES eligibility, so requiring it would be circular: the trainer marks every fresh
        # candidate ineligible BECAUSE acceptance has not run. See `verify_artifact`'s docstring.
        require_release_eligible=False,
    )
    max_length = int(report["representation"]["maxLength"])
    features, _, _ = training.encode_records(records, args.encoder, max_length)
    # Both views, keyed exactly as the trainer keys them. A document-pooled head sees a bag of one.
    views = {
        "instance-max": (features, training.bag_offsets(records)),
        "document-mean": training.encode_documents(records, args.encoder, max_length),
    }
    import numpy as np

    result: dict[str, Any] = {
        "schema": "a11y-witness/screenreader-scorer-acceptance",
        "data": [{"path": str(path), "records": len(training.read_records(path))} for path in args.data],
        "artifact": artifact,
        "criteria": {},
        "stability": {},
        "passed": False,
        "failureReasons": [],
        # Recorded, so a measurement taken on rejected weights can never be mistaken for a release
        # verdict by anything reading this file later.
        "diagnostic": bool(args.allow_ineligible),
    }
    stability_inputs: dict[str, list[tuple[str, Any, float]]] = {}
    stability_records: dict[str, list[dict[str, Any]]] = {}
    for criterion, criterion_report in report["criteria"].items():
        # PER SUBTYPE, not per criterion. This skipped any criterion whose `decisionOwner` was not
        # `learned-screenreader-scorer`, which silently dropped 1.1.1, 3.3.2 and 4.1.2 the moment that
        # field started reporting the honest answer, "mixed" -- and those three carry 8 of the 14 heads.
        # The held-out gate would have reported a clean pass having evaluated barely half the model.
        model_subtypes = {
            subtype: subtype_report
            for subtype, subtype_report in criterion_report["subtypes"].items()
            if subtype_report.get("decisionOwner", "learned-screenreader-scorer") == "learned-screenreader-scorer"
        }
        if not model_subtypes:
            result["criteria"][criterion] = {
                "decisionOwner": model_decision_owner(criterion_report),
                "modelEvaluated": False,
                "reason": "every subtype of this criterion is decided by the authoritative deterministic rule layer",
            }
            continue
        included_indices, excluded = eligible_records(criterion, model_subtypes, records)
        labels = np.array(
            [criterion in record["target"].get("criteria", []) for record in records], dtype=bool
        )
        subtype_scores = score_subtypes(training, model_subtypes, views, weights)
        # The criterion is the OR of its heads' own decisions -- what "any of these failures counts"
        # actually means, and the only formulation that survives the heads being on different scales.
        decided = np.zeros(len(records), dtype=bool)
        subtype_fired: dict[str, Any] = {}
        for subtype, scores in subtype_scores.items():
            # THE SAME DECISION `score.py` MAKES, including the applicability gate. This compared
            # `scores >= threshold` directly, which is how the gate came to be live in the product and
            # absent from the measurement that judges it -- the held-out set went on scoring pages the
            # product rules inapplicable, and the resulting failure read as the fix not working.
            threshold = float(model_subtypes[subtype]["threshold"])
            # WHICH SUBTYPE fired, not just that the criterion did. A criterion-level false positive names
            # a page and leaves the head unidentified, and 1.3.1 has two heads that need opposite fixes --
            # `fake-heading` reads the transcript, `unassociated-table` reads table announcements.Three wrong
            # theories on 2026-08-25 came from not knowing which. Recorded per subtype so the report can
            # say it.
            fired = np.array(
                [applicability.decide(subtype, float(score), threshold, record)
                 for score, record in zip(scores, records)],
                dtype=bool,
            )
            subtype_fired[subtype] = fired
            decided |= fired
        included_labels = labels[included_indices]
        result["criteria"][criterion] = {
            "decisionOwner": model_decision_owner(criterion_report),
            "modelEvaluated": True,
            # No criterion-level threshold, deliberately: there is no single number that means anything
            # once each head is cut on its own scale. The cuts that were actually applied, instead.
            "subtypeThresholds": {s: float(r["threshold"]) for s, r in model_subtypes.items()},
            "ruleDecidedSubtypes": sorted(set(criterion_report["subtypes"]) - set(model_subtypes)),
            "excluded": excluded,
            # WHICH HEAD produced each false positive. The criterion-level list names a page and leaves
            # the head unidentified, and a criterion with two heads needs opposite fixes depending on
            # which one fired -- `1.3.1:fake-heading` reads the transcript, `1.3.1:unassociated-table`
            # reads table announcements. Three wrong theories on 2026-08-25 came from not knowing which,
            # and each cost a round trip to the lab to find out by hand.
            "falsePositivesBySubtype": {
                subtype: sorted({
                    case_identity(records[index])
                    for position, index in enumerate(included_indices)
                    if fired[index] and not included_labels[position]
                })
                for subtype, fired in subtype_fired.items()
                if any(fired[index] and not included_labels[position]
                       for position, index in enumerate(included_indices))
            },
            # AND THE RAW HEAD SCORE FOR EACH MISS, which is the only number that can settle one.
            #
            # `metrics` reports the CRITERION score, and that is binary — the criterion is the OR of its
            # heads' decisions, so a false negative always reads `0.0` against a `0.5` cut, which merely
            # restates "false negative". Measured 2026-09-01: a candidate that closed every free veto
            # missed one case, and the criterion score said `0.000` while the question was whether the
            # HEAD scored 0.90 against its own 0.9153 cut (threshold variance, ship it) or near zero (the
            # head genuinely lost it). Those need opposite work and only this number separates them.
            #
            # Ungated, deliberately: `applicability.decide` is what turned the score into "did not fire",
            # so applying it here would hide the case where a head scored well and the gate suppressed it.
            # Compare against `subtypeThresholds` above, which are the cuts actually applied.
            #
            # This is the sibling of `falsePositivesBySubtype` directly above, whose comment records what
            # not having it cost: "three wrong theories on 2026-08-25 came from not knowing which [head],
            # and each cost a round trip to the lab to find out by hand."
            "falseNegativeSubtypeScores": {
                case_identity(records[index]): {
                    subtype: round(float(scores[index]), 4) for subtype, scores in subtype_scores.items()
                }
                for position, index in enumerate(included_indices)
                if included_labels[position] and not decided[index]
            },
            **metrics(decided[included_indices].astype(float), included_labels, DECIDED,
                      identities=[case_identity(records[index]) for index in included_indices]),
        }
        stability_inputs[criterion] = [
            (subtype, scores[included_indices], float(model_subtypes[subtype]["threshold"]))
            for subtype, scores in subtype_scores.items()
        ]
        included_records = [records[index] for index in included_indices]
        if result["criteria"][criterion]["positive"] < args.min_positive:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_positive} acceptance positives")
        if result["criteria"][criterion]["clean"] < args.min_clean:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_clean} acceptance clean records")
        block = result["criteria"][criterion]
        if block["falsePositive"]:
            result["failureReasons"].append(
                f"{criterion}: {block['falsePositive']} acceptance false positive(s)"
                + (": " + ", ".join(
                    f"{name} @{block.get('falsePositiveScores', {}).get(name, float('nan')):.3f}"
                    for name in block.get("falsePositiveCases", [])) if block.get("falsePositiveCases") else "")
            )
        if block["falseNegative"]:
            result["failureReasons"].append(
                f"{criterion}: {block['falseNegative']} acceptance false negative(s)"
                + (": " + ", ".join(
                    name + " " + " ".join(
                        f"[{subtype} {score:.3f} vs cut "
                        f"{block.get('subtypeThresholds', {}).get(subtype, float('nan')):.3f}]"
                        for subtype, score in sorted(
                            block.get("falseNegativeSubtypeScores", {}).get(name, {}).items()))
                    for name in block.get("falseNegativeCases", [])) if block.get("falseNegativeCases") else "")
            )
        stability_records[criterion] = included_records

    # Stability is measured PER HEAD, on that head's own scores and its own cut. Measuring it on the
    # criterion's OR would hide the thing worth knowing: which head wobbles. It also keeps the reported
    # score range meaningful -- a decided 0/1 array has a min of 0 and a max of 1 and says nothing.
    result["stability"] = {
        criterion: merge_stability({
            subtype: stability(scores, stability_records[criterion], threshold)
            for subtype, scores, threshold in subtypes
        })
        for criterion, subtypes in stability_inputs.items()
    }
    if not all(details["passed"] for details in result["stability"].values()):
        # NOT MEASURED and UNSTABLE need different responses, so they get different messages. One
        # combined string sent `release:gate` chasing an instability that did not exist: the gate invoked
        # this evaluator with no --data, so there were no repeated captures to compare and stability could
        # not be measured at all -- reported as though a field had varied. A gate whose message cannot
        # distinguish "I could not check" from "the check failed" is the same defect this pipeline keeps
        # finding elsewhere.
        unmeasured = [c for c, d in result["stability"].items() if not d.get("measured")]
        unstable = [c for c, d in result["stability"].items() if d.get("measured") and not d.get("passed")]
        if unmeasured:
            result["failureReasons"].append(
                "capture-to-capture stability was NOT MEASURED for "
                + ", ".join(sorted(unmeasured))
                + " — pass two or more capture runs with repeated --data files (see runs/screenreader-acceptance/repeat-*.jsonl)"
            )
        if unstable:
            result["failureReasons"].append(
                "capture-to-capture stability FAILED for " + ", ".join(sorted(unstable))
            )
    result["passed"] = not result["failureReasons"]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    # This is the ONLY place allowed to claim generalisation, because it is the only thing that measures
    # it. The trainer sets `generalisationVerified: False` and cannot do better: its calibration runs on
    # the split the model was tuned against, and it once reported a perfectly clean calibration for
    # weights this evaluator rejected on four criteria. Recorded on failure too — an absent stamp and a
    # failed one must not look the same.
    stamp_generalisation(args.training_report, result["passed"], result["failureReasons"], args.allow_ineligible)
    print(json.dumps({"passed": result["passed"], "failureReasons": result["failureReasons"]}, indent=2))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
