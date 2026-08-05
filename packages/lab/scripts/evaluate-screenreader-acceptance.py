#!/usr/bin/env python3
"""Evaluate the scorer on a capture set that is disjoint from training.

The acceptance set is never used to fit heads or thresholds. If multiple exported
files are supplied, repeated case/variant records are also used to measure whether
the same NVDA interaction crosses the model threshold between captures.
"""

from __future__ import annotations

import argparse
import importlib.util
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


def score_criterion(training: Any, criterion_report: dict[str, Any], features: Any, weights: Any) -> Any:
    import torch

    subtype_scores = []
    for subtype_details in criterion_report["subtypes"].values():
        weight = weights[subtype_details["head"] + ".weight"]
        bias = weights[subtype_details["head"] + ".bias"]
        subtype_scores.append(training.score_head(features, weight, bias))
    return torch.stack(subtype_scores).amax(dim=0)


def metrics(scores: Any, labels: Any, threshold: float) -> dict[str, Any]:
    predicted = scores >= threshold
    true_positive = int((predicted & labels).sum())
    false_positive = int((predicted & ~labels).sum())
    false_negative = int((~predicted & labels).sum())
    clean = int((~labels).sum())
    return {
        "records": int(labels.numel()),
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


def eligible_records(criterion: str, criterion_report: dict[str, Any], records: list[dict[str, Any]]) -> tuple[list[int], int]:
    eligible_subtypes = set(criterion_report["subtypes"])
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
            allow_ineligible=False,
        ),
        training,
    )
    max_length = int(report["representation"]["maxLength"])
    features, _, _ = training.encode_records(records, args.encoder, max_length)
    import torch

    result: dict[str, Any] = {
        "schema": "a11y-witness/screenreader-scorer-acceptance",
        "data": [{"path": str(path), "records": len(training.read_records(path))} for path in args.data],
        "artifact": artifact,
        "criteria": {},
        "stability": {},
        "passed": False,
        "failureReasons": [],
    }
    scores_by_criterion = {}
    for criterion, criterion_report in report["criteria"].items():
        owner = model_decision_owner(criterion_report)
        if owner != "learned-screenreader-scorer":
            result["criteria"][criterion] = {
                "decisionOwner": owner,
                "modelEvaluated": False,
                "reason": "criterion is evaluated by the authoritative deterministic rule layer",
            }
            continue
        included_indices, excluded = eligible_records(criterion, criterion_report, records)
        labels = torch.tensor(
            [criterion in record["target"].get("criteria", []) for record in records], dtype=torch.bool
        )
        scores = score_criterion(training, criterion_report, features, weights)
        threshold = float(criterion_report["threshold"])
        included_scores = scores[included_indices]
        included_labels = labels[included_indices]
        result["criteria"][criterion] = {
            "threshold": threshold,
            "excluded": excluded,
            **metrics(included_scores, included_labels, threshold),
        }
        scores_by_criterion[criterion] = (included_scores, [records[index] for index in included_indices])
        if result["criteria"][criterion]["positive"] < args.min_positive:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_positive} acceptance positives")
        if result["criteria"][criterion]["clean"] < args.min_clean:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_clean} acceptance clean records")
        if result["criteria"][criterion]["falsePositive"]:
            result["failureReasons"].append(f"{criterion}: acceptance false positives")
        if result["criteria"][criterion]["falseNegative"]:
            result["failureReasons"].append(f"{criterion}: acceptance false negatives")

    result["stability"] = {
        criterion: stability(scores, criterion_records, float(report["criteria"][criterion]["threshold"]))
        for criterion, (scores, criterion_records) in scores_by_criterion.items()
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
    print(json.dumps({"passed": result["passed"], "failureReasons": result["failureReasons"]}, indent=2))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
