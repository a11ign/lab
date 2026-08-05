#!/usr/bin/env python3
"""Run non-training hardening checks for the local screen-reader scorer.

The checks deliberately do not fit weights or thresholds. They verify artifact
integrity, grouped-data boundaries, acceptance disjointness, capture-environment
coverage, and invariance under harmless transcript formatting changes.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import re
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
TRAINING_SCRIPT = REPO_ROOT / "scripts" / "train-screenreader-model.py"
SCORER_SCRIPT = SCORER_PACKAGE / "python" / "score.py"
MIN_TEST_POSITIVES = 10


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--training-data", type=Path, default=REPO_ROOT / "runs/screenreader-dataset/screenreader-evidence.jsonl")
    parser.add_argument("--acceptance-data", action="append", type=Path)
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models/encoders/all-MiniLM-L6-v2")
    parser.add_argument("--model", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer")
    parser.add_argument(
        "--allow-ineligible",
        action="store_true",
        help="run diagnostics against an ineligible artifact; never treats it as release-ready",
    )
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "runs/screenreader-hardening.json")
    return parser.parse_args()


def lower_strings(value: Any) -> Any:
    if isinstance(value, str):
        return value.lower()
    if isinstance(value, list):
        return [lower_strings(item) for item in value]
    if isinstance(value, dict):
        return {key: lower_strings(item) for key, item in value.items()}
    return value


def normalize_whitespace(value: Any) -> Any:
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    if isinstance(value, list):
        return [normalize_whitespace(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_whitespace(item) for key, item in value.items()}
    return value


def known_version(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value.strip().lower() != "unknown"


def family_overlap(training: Any, acceptance: Any) -> list[str]:
    trained = {record["provenance"].get("family") for record in training}
    accepted = {record["provenance"].get("family") for record in acceptance}
    return sorted(value for value in trained & accepted if value)


def nvda_marker_features(training_module: Any) -> dict[str, Any]:
    """Keep the runtime meaning of NVDA's object-boundary marker explicit."""
    record = {
        "input": {
            "transcript": ["button, ￼"],
            "structure": {"formFields": ["￼, button"]},
            "interaction": {},
        }
    }
    features = training_module.structured_feature_values(record)
    return {
        "formFieldUnnamed": features["form_field_unnamed"],
        "formFieldNamed": features["form_field_named"],
        "passed": features["form_field_unnamed"] == 1.0 and features["form_field_named"] == 0.0,
    }


def coverage(training: Any, report: dict[str, Any], training_module: Any) -> dict[str, Any]:
    split = report["split"]
    split_for_family = training_module.assign_splits(training)
    criteria = sorted(report["criteria"])
    result: dict[str, Any] = {}
    for criterion in criteria:
        positive = [record for record in training if criterion in record["target"].get("criteria", [])]
        by_split = {
            name: sum(split_for_family[record["provenance"]["family"]] == name for record in positive)
            for name in ("train", "validation", "test")
        }
        result[criterion] = {
            "positiveRecords": len(positive),
            "positiveFamilies": len({record["provenance"]["family"] for record in positive}),
            "positiveBySplit": by_split,
            "minimumTestPositivesMet": by_split["test"] >= MIN_TEST_POSITIVES,
        }
    return {"splitSizes": split, "criteria": result}


def main() -> None:
    training_module = load_module(TRAINING_SCRIPT, "screenreader_training")
    scorer_module = load_module(SCORER_SCRIPT, "screenreader_scorer")
    args = parse_args()
    training = training_module.read_records(args.training_data)
    acceptance_paths = args.acceptance_data or [
        REPO_ROOT / "runs/screenreader-acceptance/screenreader-evidence.jsonl",
        REPO_ROOT / "runs/screenreader-acceptance/repeat-1.jsonl",
        REPO_ROOT / "runs/screenreader-acceptance/repeat-2.jsonl",
    ]
    acceptance = []
    for path in acceptance_paths:
        acceptance.extend(training_module.read_records(path))
    report, weights, artifact = scorer_module.verify_artifact(
        argparse.Namespace(
            model=args.model,
            training_report=None,
            encoder=args.encoder,
            allow_ineligible=args.allow_ineligible,
        ),
        training_module,
    )
    baseline = scorer_module.score_records(training, report, weights, training_module, args)
    version_metadata_records = sum(
        known_version(record["provenance"].get("environment", {}).get("screenReaderVersion")) and
        known_version(record["provenance"].get("environment", {}).get("browserVersion"))
        for record in training
        if isinstance(record["provenance"].get("environment"), dict)
    )
    checks: dict[str, Any] = {
        "artifact": artifact,
        "trainingRecords": len(training),
        "acceptanceRecords": len(acceptance),
        "acceptanceDisjoint": not family_overlap(training, acceptance),
        "overlappingFamilies": family_overlap(training, acceptance),
        "coverage": coverage(training, report, training_module),
        "environment": {
            "screenReaders": sorted({record["input"].get("screenReader") for record in training}),
            "captureProfiles": sorted({record["provenance"].get("environment", {}).get("profile") for record in training if isinstance(record["provenance"].get("environment"), dict)}),
            "versionMetadataRecords": version_metadata_records,
        },
        "adversarial": {},
        "passed": True,
    }
    if not checks["acceptanceDisjoint"]:
        checks["passed"] = False
    if not all(value["minimumTestPositivesMet"] for value in checks["coverage"]["criteria"].values()):
        checks["passed"] = False

    for name, transform in (("casefold", lower_strings), ("whitespace", normalize_whitespace)):
        mutated = []
        for record in training:
            candidate = copy.deepcopy(record)
            candidate["input"] = transform(candidate["input"])
            mutated.append(candidate)
        transformed = scorer_module.score_records(mutated, report, weights, training_module, args)
        baseline_predictions = {item["caseId"]: item["predictions"] for item in baseline["records"]}
        transformed_predictions = {item["caseId"]: item["predictions"] for item in transformed["records"]}
        flips = [
            case_id for case_id in baseline_predictions
            if baseline_predictions[case_id] != transformed_predictions.get(case_id)
        ]
        checks["adversarial"][name] = {"predictionFlips": len(flips), "examples": flips[:10]}
        if flips:
            checks["passed"] = False

    checks["adversarial"]["nvdaObjectReplacementMarker"] = nvda_marker_features(training_module)
    if not checks["adversarial"]["nvdaObjectReplacementMarker"]["passed"]:
        checks["passed"] = False

    checks["environment"]["warning"] = (
        "Training exports do not contain exact NVDA/browser version metadata; recapture "
        "through a worker with self-reported provenance before treating cross-version "
        "generalisation as complete."
        if checks["environment"]["versionMetadataRecords"] == 0 else None
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(checks, indent=2))
    if not checks["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
