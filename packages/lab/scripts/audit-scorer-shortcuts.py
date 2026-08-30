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
UNCLOSABLE_MAP = REPO_ROOT / "runs/unclosable-vetoes.json"


def unclosable_vetoes() -> dict[str, dict[str, set[str]]]:
    """Which (subtype, feature) pairs no corpus work can close, and WHY — read, never restated here.

    `audit-corpus-starvation.mjs` has carried `IMPOSSIBLE_BY_DEFINITION` for months with the cost written
    beside it: *"Reporting those put items on a work list that nobody can complete, and inflated the two
    features at the top of the ranking."* This audit never learned it, so it reported 57 veto pairs with
    no way to say which were worth corpus work. A fact learned at one layer and not carried to the next.

    Emitted by `npm run corpus:unclosable-map` rather than duplicated, because neither language can import
    the other — the same route `audit_grants.py` takes for the grants map, and pinned equal by
    `test_unclosable_map_is_current.py`.

    An ABSENT map is not an empty one: forgiving nothing is the honest fallback, since this audit's whole
    job is to report vetoes, and it says so on the report rather than quietly reverting.
    """
    if not UNCLOSABLE_MAP.exists():
        return {}
    raw = json.loads(UNCLOSABLE_MAP.read_text(encoding="utf-8"))
    return {kind: {subtype: set(features) for subtype, features in group.items()}
            for kind, group in raw.items()}
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
    unfeaturizable = 0
    reason = ""
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        subtypes = set(record.get("target", {}).get("subtypes") or [])
        try:
            records.append((features.structured_feature_values(record), subtypes))
        except RuntimeError as error:
            # A record predating the `parsed` block cannot be featurized, and that is a fact about this COPY
            # of runs/ rather than about the corpus. `audit_grants.py` already counts and reports exactly
            # this, and reaching the same condition through a TRACEBACK here sent a reader to the Python
            # rather than to their stale export — the same remedy present at one call site and absent at
            # the sibling, which is this repo's most expensive recurring shape.
            unfeaturizable += 1
            reason = str(error).split(".")[0]
    if unfeaturizable:
        print(f"  {unfeaturizable} of {unfeaturizable + len(records)} record(s) carry no `parsed` block.")
        print(f"  {reason}.")
        print("  This copy of runs/ predates the parse. Re-export, or ask the box that holds the corpus:")
        print("    npm run lab:job -- -e job=shortcuts")
    if not records:
        # Never a pass. A local checkout with a stale corpus must not read as a clean audit — that is the
        # "reports success having examined nothing" failure this file exists to prevent one layer up.
        if unfeaturizable:
            # EXIT 2, not 1, and matching `audit_grants.py`. "This audit found a shortcut" and "this audit
            # could not run" need opposite responses — retrain versus re-export — and collapsing the two
            # into one status is the failure this repo names most often. A caller that stops on any
            # non-zero still stops; a human, and any wrapper that reads the code, learns which happened.
            print(f"\n  REFUSING: no record in {path} could be featurized, so this audit examined nothing.")
            raise SystemExit(2)
        raise SystemExit(f"{path} is empty, so this audit would report a clean fleet having examined nothing")
    if unfeaturizable:
        print(f"  Continuing over the {len(records)} record(s) that CAN be read; counts below are of those.")
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
    unclosable = unclosable_vetoes()
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
                    # WHY it cannot be closed, or None. Kept on the veto rather than filtered out here:
                    # an unclosable veto is still a real negative weight on a real page, and hiding it
                    # would make the model look better than it is. What changes is the WORK LIST.
                    kinds = [kind for kind, group in unclosable.items() if name in group.get(subtype, ())]
                    vetoes.append({"feature": name, "logits": round(logits, 4),
                                   "unclosable": kinds[0] if kinds else None})
            vetoes.sort(key=lambda veto: veto["logits"])
            closable = [veto for veto in vetoes if veto["unclosable"] is None]
            rows.append({"subtype": subtype, "positives": len(positives), "vetoes": vetoes,
                         "closable": closable,
                         "sumLogits": round(sum(veto["logits"] for veto in closable), 2)})
    return rows


def render(rows: list[dict[str, Any]]) -> None:
    print("\n  A VETO is a feature that is 0 on every training positive of a subtype, common elsewhere in")
    print("  the corpus, and given a negative weight. The head has never seen a positive carrying it, so")
    print("  the penalty cost nothing to learn — and it silently suppresses a real page that has both.\n")
    # `closable` is the COLUMN AND THE HEADLINE, because it is the number somebody can act on. The
    # unclosable ones are still counted and still named — they are real negative weights on real pages —
    # but a work list that includes them displaces the items nobody is stopping you from doing.
    print(f"  {'subtype':32} {'positives':>9} {'closable':>8} {'total':>6} {'sum logits':>11}  worst closable")
    print("  " + "-" * 96)
    for row in rows:
        first = row["closable"][0] if row["closable"] else None
        worst = f"{first['feature']} ({first['logits']:+.2f})" if first else "-"
        print(f"  {row['subtype']:32} {row['positives']:9} {len(row['closable']):8} "
              f"{len(row['vetoes']):6} {row['sumLogits']:11.2f}  {worst}")
    closable = sum(len(row["closable"]) for row in rows)
    total = sum(len(row["vetoes"]) for row in rows)
    print(f"\n  {closable} CLOSABLE veto pairs across {len(rows)} heads ({total} in total).")
    print("  The remedy is the CORPUS — see ADR 0015. A retrain on unchanged data reproduces them.")
    render_unclosable(rows, total - closable)
    print()


def render_unclosable(rows: list[dict[str, Any]], count: int) -> None:
    """The vetoes no corpus work can close, grouped by WHY — because the two reasons differ in kind.

    `by-definition` means the subtype IS the absence of that announcement, so no page can carry both:
    nothing to build, ever. `perturbs-measurement` means the page could carry it and capturing it would
    destroy the evidence — a statement about THIS probe, which could change if the probe did.

    Printed rather than silently forgiven. A count that quietly shrank would be indistinguishable from
    progress, which is the failure this whole audit exists to prevent one level up.
    """
    if count == 0:
        return
    reasons = {
        "by-definition": "the subtype IS the absence of that announcement, so no page can carry both",
        "perturbs-measurement": "capturing it would destroy the channel the subtype is measured on",
    }
    print(f"\n  {count} further veto pair(s) are UNCLOSABLE and excluded from the counts above:")
    for kind, why in reasons.items():
        pairs = [(row["subtype"], veto["feature"]) for row in rows for veto in row["vetoes"]
                 if veto["unclosable"] == kind]
        if not pairs:
            continue
        print(f"    {kind} — {why}")
        for subtype, feature in pairs[:8]:
            print(f"      {subtype:38} {feature}")
        if len(pairs) > 8:
            print(f"      ... and {len(pairs) - 8} more")


def closable_count(row: dict[str, Any]) -> int:
    """Vetoes a corpus change could actually remove.

    A row records every veto with its `unclosable` classification, so both quantities are readable from
    one file. `None` means closable — the field is absent on a pair no map entry covers.
    """
    return sum(1 for veto in row.get("vetoes", []) if not veto.get("unclosable"))


def compare_to_baseline(rows: list[dict[str, Any]], baseline_path: Path, stream: Any) -> int:
    """Fail on a WORSE result, per subtype. Silent on an improvement, which is the direction we want.

    COMPARES CLOSABLE VETOES since 2026-08-30 — the deliberate change the previous docstring named, made
    on the condition it set. It read:

        COMPARES TOTAL VETOES ... The baseline is a TRACKED file recorded before the closable/unclosable
        split existed; switching the gate to a different quantity would make every stored number
        incomparable while the file still looked current ... Moving the gate to `closable` is a deliberate
        change that must rewrite the baseline in the same commit.

    That reason has lapsed: the baseline was re-recorded on the protocol-8 corpus, so every row now carries
    its `unclosable` classification and the two quantities are both readable from it. The rewrite is in
    this commit, as required.

    WHY IT HAD TO MOVE. On totals, a veto NOTHING CAN CLOSE blocks a release for ever, and two arrived in
    one afternoon by the corpus getting BETTER: `table_header_associated` on `1.3.1:unassociated-table`
    (visible only once §19 gave those cases the table evidence their label claimed) and `heading_present`
    on `1.3.1:no-headings` (a page with no headings, 29 of 29 positives). Blocking on those is exactly what
    `IMPOSSIBLE_BY_DEFINITION` exists to prevent — "reporting those put items on a work list that nobody
    can complete" — and a gate that cannot be satisfied is one that gets bypassed.

    WHAT IS GIVEN UP, stated rather than glossed: an unclosable veto is still a negative weight on a real
    page, so this can no longer catch a regression that hides inside a misclassified pair. The protection
    is that the map is small, hand-written, requires a measured justification per entry, and is pinned by
    `test_unclosable_map_is_current.py` — which caught a stale entry naming a feature the pipeline never
    computed, on its first run. A wrong entry is now a release-gate hole, which is a real cost and the
    reason that test matters more than it did yesterday.

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
        elif closable_count(row) > closable_count(was):
            regressions.append(
                f"{row['subtype']}: {closable_count(was)} -> {closable_count(row)} closable veto(es)")
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
