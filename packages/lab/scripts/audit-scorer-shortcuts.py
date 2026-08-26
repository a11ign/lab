#!/usr/bin/env python3
"""Which engineered features can a head penalise for FREE?

A head sees 384 encoder dimensions of one announcement plus 29 document-level engineered features of the
whole capture. When a feature is 0 on *every* training positive of a subtype, the head may give it a large
negative weight at no cost — the training data contains no example that would punish it, and neither does
any held-out split of that data, because the split has the same structure. So no accuracy number we compute
can see it: not held-out acceptance, not `npm run eval`, not `rules:gate`.

Measured cost of exactly that, on the shipped weights (ADR 0015). `4.1.2:unnamed-control` scored the SAME
announcement 0.924042 on two W3C BAD pages and 0.452519 on a third, because the third is built from layout
tables and `table_present`/`table_data_row_present`/`table_position_only` are worth about -3.9 logits
between them. Not one of the 147 training records carrying an unnamed form field has a table. The same
shape in `form_field_named` (-4.33) means the scorer reports an unnamed control only on pages where NO
control is correctly named, which describes almost no real page.

This runs on files already in the repository — the exported corpus and the shipped weights. It needs no
worker, no capture and no retrain, and it was computable at any point in the last month.

The remedy is the CORPUS, not the weights: a page that fails one way must be allowed to carry every other
criterion's evidence. A retrain on unchanged data reproduces the vetoes faithfully.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
SCORER_PACKAGE = Path(__file__).resolve().parents[2] / "scorer"
sys.path.insert(0, str(SCORER_PACKAGE / "python"))

import screenreader_features as features  # noqa: E402  (needs the path above)

# A veto has to be worth something to be worth reporting. 1.0 logits moves a score near the decision
# boundary by about 0.2, which is enough to cross a threshold; below that the feature is noise.
VETO_LOGITS = 1.0
# A feature absent from the positives is only a shortcut if it is COMMON elsewhere. One that barely occurs
# in the corpus is absent from the positives by arithmetic rather than by structure.
MIN_CORPUS_OCCURRENCES = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path,
                        default=REPO_ROOT / "runs/screenreader-dataset/screenreader-evidence.jsonl")
    parser.add_argument("--model", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer")
    parser.add_argument("--baseline", type=Path,
                        default=Path(__file__).with_name("scorer-shortcuts.baseline.json"))
    parser.add_argument("--json", action="store_true")
    # A scratch model trained on scratch data has no baseline to be judged against, and comparing it to
    # the shipped one reports a regression that means nothing. Measuring an experiment is not a gate.
    parser.add_argument("--no-baseline", action="store_true",
                        help="report only; do not compare against the recorded baseline")
    # Writing the baseline is a deliberate act with a flag, never a side effect of running the audit —
    # an audit that rewrites the thing it compares against always passes.
    parser.add_argument("--update-baseline", action="store_true")
    return parser.parse_args()


def read_records(path: Path) -> list[tuple[dict[str, float], set[str]]]:
    if not path.is_file():
        raise SystemExit(f"no exported corpus at {path} — run `npm run training:export` first")
    records = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        subtypes = set(record.get("target", {}).get("subtypes") or [])
        records.append((features.structured_feature_values(record), subtypes))
    if not records:
        raise SystemExit(f"{path} is empty, so this audit would report a clean fleet having examined nothing")
    return records


def effective_weights(head_weight: Any, names: list[str]) -> Any:
    """The logit each feature contributes when it goes 0 -> 1.

    The head's raw weight is not that number: `structured_features` scales every feature by
    `ENGINEERED_FEATURE_SCALE` and its per-feature multiplier before the head ever sees it. Reading the raw
    weight would report a penalty several times smaller than the one actually applied.
    """
    import numpy as np

    multipliers = np.array([features.ENGINEERED_FEATURE_MULTIPLIERS.get(name, 1.0) for name in names],
                           dtype=np.float32)
    structured = head_weight[0, head_weight.shape[1] - len(names):]
    return structured * np.float32(features.ENGINEERED_FEATURE_SCALE) * multipliers


def audit(records: list[tuple[dict[str, float], set[str]]], model_root: Path) -> list[dict[str, Any]]:
    from safetensors.numpy import load_file

    report = json.loads((model_root / "training-report.json").read_text())
    weights = load_file(str(model_root / "model.safetensors"))
    names = features.FEATURE_NAMES
    occurrences = {name: sum(1 for values, _ in records if values[name]) for name in names}

    rows = []
    for criterion_report in report["criteria"].values():
        for subtype, subtype_report in criterion_report["subtypes"].items():
            positives = [values for values, subtypes in records if subtype in subtypes]
            if not positives:
                continue
            effective = effective_weights(weights[subtype_report["head"] + ".weight"], names)
            vetoes = []
            for name in names:
                if occurrences[name] < MIN_CORPUS_OCCURRENCES:
                    continue
                # Constant at ZERO specifically. A feature constant at ONE is the head's own evidence
                # (`form_field_unnamed` is +5.37 on the head that needs it) and is not a shortcut.
                if {values[name] for values in positives} != {0.0}:
                    continue
                logits = float(effective[names.index(name)])
                if logits <= -VETO_LOGITS:
                    vetoes.append({"feature": name, "logits": round(logits, 4)})
            vetoes.sort(key=lambda veto: veto["logits"])
            rows.append({"subtype": subtype, "positives": len(positives), "vetoes": vetoes,
                         "sumLogits": round(sum(veto["logits"] for veto in vetoes), 2)})
    return rows


def render(rows: list[dict[str, Any]]) -> None:
    print("\n  A VETO is a feature that is 0 on every training positive of a subtype, common elsewhere in")
    print("  the corpus, and given a negative weight. The head has never seen a positive carrying it, so")
    print("  the penalty cost nothing to learn — and it silently suppresses a real page that has both.\n")
    print(f"  {'subtype':32} {'positives':>9} {'vetoes':>7} {'sum logits':>11}  worst")
    print("  " + "-" * 88)
    for row in rows:
        worst = f"{row['vetoes'][0]['feature']} ({row['vetoes'][0]['logits']:+.2f})" if row["vetoes"] else "-"
        print(f"  {row['subtype']:32} {row['positives']:9} {len(row['vetoes']):7} "
              f"{row['sumLogits']:11.2f}  {worst}")
    total = sum(len(row["vetoes"]) for row in rows)
    print(f"\n  {total} veto pairs across {len(rows)} heads.")
    print("  The remedy is the CORPUS — see ADR 0015. A retrain on unchanged data reproduces them.\n")


def compare_to_baseline(rows: list[dict[str, Any]], baseline_path: Path, stream: Any) -> int:
    """Fail on a WORSE result, per subtype. Silent on an improvement, which is the direction we want.

    `stream` is stderr under `--json`, so a caller parsing the output is never handed prose mixed into it.
    """
    def note(line: str) -> None:
        print(line, file=stream)

    if not baseline_path.is_file():
        note(f"  no baseline at {baseline_path}; run with --update-baseline to record this one.")
        return 0
    baseline = {row["subtype"]: row for row in json.loads(baseline_path.read_text())["rows"]}
    regressions = []
    unbaselined = []
    rule_decided = rule_decided_subtypes()
    # UNBASELINED and WORSE are different findings, and calling both a regression sends the reader at the
    # wrong thing. A head absent from the baseline may be genuinely new, or may have existed for months
    # and only just become visible to this audit — measured 2026-08-26, when correcting SCORED_CRITERIA
    # to match the shipped model brought five long-standing heads into scope and the report announced
    # them as five regressions that "gained a free veto". They gained nothing; nobody had looked.
    #
    # Both still BLOCK, because an unaudited veto is not a safe one either way. Only the wording differs,
    # and the wording is what decides whether somebody investigates the corpus or records a baseline.
    for row in rows:
        was = baseline.get(row["subtype"])
        if was is None:
            # The two facts that decide whether an unaudited veto is a DEFECT or the corpus's shape, and
            # both were established by hand on 2026-08-26 before this reported them.
            #
            # A head with 4 positives has a free veto on nearly every feature — that is arithmetic, not a
            # corpus fault, and it is why `furniture-spread.test.ts` skips a subtype under six cases. And
            # ADR 0015's harm requires the head to DECIDE: where `rule-ownership.json` says `rules`, the
            # deterministic layer reports the verdict and the veto cannot reach a user.
            #
            # Reported, never used to excuse: it still blocks, and the day ownership moves the veto is
            # waiting. What changes is that the reader is told which question to ask.
            context = []
            if row.get("positives") is not None and row["positives"] < MIN_POSITIVES_TO_JUDGE:
                context.append(f"only {row['positives']} positive(s) — too few to separate anything")
            if row["subtype"] in rule_decided:
                context.append("rule-decided, so this veto cannot reach a user today")
            suffix = f" [{'; '.join(context)}]" if context else ""
            unbaselined.append(
                f"{row['subtype']}: {len(row['vetoes'])} veto(es), never audited{suffix}")
        elif len(row["vetoes"]) > len(was["vetoes"]):
            regressions.append(f"{row['subtype']}: {len(was['vetoes'])} -> {len(row['vetoes'])} vetoes")
    for line in regressions:
        note(f"  REGRESSION  {line}")
    for line in unbaselined:
        note(f"  UNAUDITED   {line}")
    if regressions:
        note("\n  A head gained a free veto. That means the corpus separated two things it should not,")
        note("  or a new feature was added that no positive carries. See ADR 0015.\n")
    if unbaselined:
        note("\n  These heads have never been audited — they are not necessarily WORSE, they were simply")
        note("  outside this audit's scope until now. Read their vetoes against ADR 0015 and, if they are")
        note("  the corpus's shape rather than a defect, record them:")
        note("    npm run lab:job -- -e job=shortcuts-baseline   # deliberate, and it writes\n")
    if regressions or unbaselined:
        return 1
    return 0


#: Below this, a head cannot separate anything and every feature reads as a free veto. Matches the floor
#: `furniture-spread.test.ts` applies for the same reason.
MIN_POSITIVES_TO_JUDGE = 6


def rule_decided_subtypes() -> set[str]:
    """Subtypes the deterministic rules decide, read from the ownership file rather than listed here."""
    path = Path(__file__).resolve().parents[1] / "rule-ownership.json"
    try:
        ownership = json.loads(path.read_text(encoding="utf-8"))["subtypes"]
    except (OSError, KeyError, json.JSONDecodeError):
        # Absent or unreadable means no context to add, never a silent claim that nothing is rule-decided.
        return set()
    return {name for name, entry in ownership.items() if entry.get("decidedBy") == "rules"}


def main() -> int:
    args = parse_args()
    rows = audit(read_records(args.data), args.model)
    if args.json:
        print(json.dumps({"vetoLogits": VETO_LOGITS, "rows": rows}, indent=2))
    else:
        render(rows)
    if args.update_baseline:
        args.baseline.write_text(json.dumps({"vetoLogits": VETO_LOGITS, "rows": rows}, indent=2) + "\n")
        print(f"  baseline written: {args.baseline}")
        return 0
    if args.no_baseline:
        return 0
    return compare_to_baseline(rows, args.baseline, sys.stderr if args.json else sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
