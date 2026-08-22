#!/usr/bin/env python3
"""WHICH records does a head fire on wrongly, and what do they have in common?

A training report says a head has 36 false positives. It does not say WHICH, and "36" cannot distinguish
the two explanations that matter:

  - the head lost a veto that was doing real work, so it now fires across the board; or
  - something specific changed about the pages, so it fires on one identifiable group.

Those need opposite fixes, and the second is invisible to every summary statistic. This scores the
development records with a named candidate, finds the clean ones a head fires on, and reports what
separates them from the clean ones it does not fire on — starting with page furniture, since that is what
changed.

Written for ADR 0015's follow-up: `3.3.2:placeholder-only` went from precision 1.000 to 0.368 in one
retrain, and the corpus-side hypothesis is that furniture destroyed the signature it depended on — a
placeholder-only bad page announced NO form field at all, and furniture now puts a labelled field on about
a quarter of every page. That is checkable rather than arguable, and this is the check.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from collections import Counter
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
SCORER = Path(__file__).resolve().parents[2] / "scorer"


def load(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--encoder", type=Path, default=SCORER / "models/encoders/all-MiniLM-L6-v2")
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


# What the FURNITURE puts on a page, by the announcement it produces. Read from the generated pages rather
# than guessed; kept in step with `namedField()`, `dataTable()` and `disclosure()` in case-matrix.mjs.
FURNITURE_MARKS = {
    "named-field": "Reference lookup",
    "data-table": "Reference notes index",
    "disclosure": "Reference notes archive",
}


def furniture_of(record: dict[str, Any]) -> frozenset[str]:
    text = record["input"].get("evidenceText", "")
    return frozenset(name for name, mark in FURNITURE_MARKS.items() if mark in text)


def main() -> int:
    args = parse_args()
    import numpy as np
    from safetensors.numpy import load_file

    features_mod = load(SCORER / "python/screenreader_features.py", "screenreader_features")
    report = json.loads((args.model / "training-report.json").read_text())
    weights = load_file(str(args.model / "model.safetensors"))
    records = [json.loads(line) for line in args.data.read_text().splitlines() if line.strip()]
    max_length = int(report["representation"]["maxLength"])

    features, _, _ = features_mod.encode_records(records, args.encoder, max_length)
    offsets = features_mod.bag_offsets(records)
    documents = features_mod.encode_documents(records, args.encoder, max_length)

    findings: dict[str, Any] = {"model": str(args.model), "records": len(records), "subtypes": {}}
    for criterion in report["criteria"].values():
        for subtype, sub in criterion["subtypes"].items():
            head = sub["head"]
            view = (features, offsets) if sub.get("pooling") == "instance-max" else documents
            scores = features_mod.score_bags(view[0], view[1],
                                             weights[head + ".weight"], weights[head + ".bias"])
            threshold = float(sub["threshold"])
            false_positives, true_positives = [], []
            for index, record in enumerate(records):
                labelled = subtype in (record.get("target", {}).get("subtypes") or [])
                fires = float(scores[index]) >= threshold
                if fires and not labelled:
                    false_positives.append(record)
                elif fires and labelled:
                    true_positives.append(record)
            if not false_positives:
                continue

            # The comparison that separates the two explanations: what furniture do the WRONGLY fired
            # records carry, against every clean record the head correctly stayed silent on?
            silent_clean = [r for i, r in enumerate(records)
                            if float(scores[i]) < threshold
                            and subtype not in (r.get("target", {}).get("subtypes") or [])]
            findings["subtypes"][subtype] = {
                "threshold": threshold,
                "falsePositives": len(false_positives),
                "truePositives": len(true_positives),
                "furnitureOnFalsePositives": Counter(
                    "+".join(sorted(furniture_of(r))) or "(none)" for r in false_positives).most_common(),
                "furnitureOnSilentClean": Counter(
                    "+".join(sorted(furniture_of(r))) or "(none)" for r in silent_clean).most_common(),
                "familiesOnFalsePositives": Counter(
                    r["provenance"]["family"] for r in false_positives).most_common(8),
            }

    text = json.dumps(findings, indent=2)
    if args.out:
        args.out.write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
