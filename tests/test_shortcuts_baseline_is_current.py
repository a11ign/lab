"""The tracked shortcuts baseline must name only features the pipeline still computes.

`scripts/scorer-shortcuts.baseline.json` records the free vetoes a human has looked at and
accepted; `audit-scorer-shortcuts.py --update-baseline` writes it, and every other run compares against it
via `compare_to_baseline`. A row's veto list is built once, by a human, and never revisited except by that
comparison — and the comparison is COUNT-based per subtype (`closable_count(row) > closable_count(was)`),
never a per-feature identity check against the baseline's own entries.

That gap is real and was measured, not assumed: withdrawing a feature from `FEATURE_NAMES` removes it from
every freshly-computed row (`audit()` only ever iterates `features.FEATURE_NAMES`), which can only ever
equal or LOWER a subtype's closable count relative to what the baseline recorded — never raise it. So a
stale feature name is invisible to `compare_to_baseline` in both directions: not a regression (count did
not increase), not even a printed note (the function emits nothing for an unchanged or improved count).
Confirmed empirically against the real tracked baseline: simulating today's computation by removing
`post_submit_observed_present` (withdrawn in the v19 postSubmit cross, commit `f61d325`) from the two rows
that named it and calling `compare_to_baseline` on the result returns exit code 0 with no output at all —
the exact "NOTHING NOTICED" this test exists to end.

This is the identical shape `test_unclosable_map_is_current.py` already guards at the sibling site
(`runs/unclosable-vetoes.json`, emitted from `audit-corpus-starvation.mjs`'s `IMPOSSIBLE_BY_DEFINITION`
table) -- that test's own docstring records it catching a stale entry on its first real run. The baseline
had no equivalent, so this is modelled directly on it: read the canonical feature list from the module
rather than restating it, and refuse silently rather than passing having examined nothing.

Deliberately narrower than `test_unclosable_map_is_current.py`'s three checks: that file also asserts on
two CATEGORIES staying separate and non-empty, which has no analogue here -- `scorer-shortcuts.baseline.json`
is a flat `rows` array, not a two-kind map. The subtype-shape check DOES have an analogue and is included
for the same reason: a malformed subtype key can never match a real head, which is the same failure kept
from a different angle.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
BASELINE_PATH = LAB / "scripts/scorer-shortcuts.baseline.json"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _scorer_python import scorer_python  # noqa: E402

sys.path.insert(0, str(scorer_python()))

import screenreader_features as features  # noqa: E402


def baseline() -> dict:
    """Read the TRACKED file, never a copy. Writing this file is a deliberate acceptance of vetoes per
    CLAUDE.md's own rule for it -- a test must not construct its own stand-in and call that coverage."""
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def test_the_baseline_and_the_feature_list_are_both_real() -> None:
    # A vacuity guard: if either side is empty, every assertion below would pass having examined nothing,
    # which is precisely the failure mode this file exists to end one layer up.
    rows = baseline()["rows"]
    assert rows, "scorer-shortcuts.baseline.json has no rows -- this test would examine nothing"
    total_vetoes = sum(len(row.get("vetoes", [])) for row in rows)
    assert total_vetoes > 10, (
        f"only {total_vetoes} veto(es) across {len(rows)} row(s) -- too few to trust the population; "
        "the baseline's shape may have changed")
    computed = set(getattr(features, "FEATURE_NAMES", ()) or ())
    assert computed, "the featurizer exposes no FEATURE_NAMES, so this test would examine nothing"


def test_every_named_feature_is_one_the_pipeline_computes() -> None:
    # The canonical list, read from the module rather than restated -- the same remedy
    # `test_unclosable_map_is_current.py` uses for the sibling map, for the identical reason: a table
    # naming a feature that no longer exists is invisible to `compare_to_baseline` (see this file's own
    # header), so it silently forgives fewer vetoes than it appears to.
    computed = set(features.FEATURE_NAMES)
    unknown = sorted({
        (row["subtype"], veto["feature"])
        for row in baseline()["rows"]
        for veto in row.get("vetoes", [])
        if veto["feature"] not in computed
    })
    assert unknown == [], (
        f"{len(unknown)} baseline veto(es) name a feature the pipeline no longer computes: "
        f"{unknown}. Fix scorer-shortcuts.baseline.json (drop the stale row/entry, or re-run "
        "`npm run lab:job -- -e job=shortcuts-baseline` to record a fresh one) -- the model is not "
        "implicated, and this is not a training regression.")


def test_every_named_subtype_looks_like_a_subtype() -> None:
    # `criterion:subtype`, the key shape every consumer of this file assumes. A typo here can never match
    # a real head, which forgives nothing and is the same failure as an unknown feature name, kept from
    # the other side.
    offenders = [row["subtype"] for row in baseline()["rows"]
                 if not re.fullmatch(r"\d+\.\d+\.\d+:[a-z0-9-]+", row["subtype"])]
    assert offenders == [], (
        f"these baseline subtype key(s) are not `criterion:subtype` shaped: {offenders}")
