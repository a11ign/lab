"""The unclosable-veto map the Python audit reads must match the JavaScript that declares it.

`audit-scorer-shortcuts.py` reports which vetoes no corpus work can close, and the two tables that say so
live in `audit-corpus-starvation.mjs` — JavaScript, because that is where the corpus-side audit already
used one of them. Neither language can import the other, so the map is emitted to
`runs/unclosable-vetoes.json` by `npm run corpus:unclosable-map` and read there.

CLAUDE.md's remedies for a fact stated twice are, in order: delete a copy, derive one from the other, pin
them equal with a test. The first two are unavailable across the language boundary; this is the third, and
it is modelled on `test_grants_map_is_current.py` — which itself existed only as a promise in a docstring
for months before anyone built it.

What it pins:

- **Every feature named is one the pipeline actually computes.** A table naming a feature that no longer
  exists would forgive a veto that cannot occur, and quietly shrink the work list by pretending an item
  was impossible rather than done.
- **Every subtype named is one the trained model actually has a head for.** The same failure keyed the
  other way: forgiving a subtype nobody trains is forgiving nothing, and reads as coverage.
- **The two categories stay SEPARATE.** `by-definition` is about meaning and is permanent;
  `perturbs-measurement` is about this probe and could change if the probe did. A reader acts on them
  differently, so a merged map would be a worse fact than two.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

LAB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _scorer_python import scorer_python  # noqa: E402

sys.path.insert(0, str(scorer_python()))

import screenreader_features as features  # noqa: E402

EXPECTED_KINDS = {"by-definition", "perturbs-measurement"}

# The emitter is a `.ts` script, which Node runs by stripping types. The distro's `/usr/bin/node` does not do
# that reliably, so use the upstream Node 24 at `~/.local/bin/node` (#4388) when it is there, and the PATH's
# `node` otherwise (CI's setup-node).
_UPSTREAM_NODE = Path.home() / ".local/bin/node"
NODE = str(_UPSTREAM_NODE) if _UPSTREAM_NODE.exists() else "node"


def emitted_map() -> dict[str, dict[str, list[str]]]:
    """Run the emitter and read what it wrote — never a checked-in copy, which would be a third source."""
    # `RUNS_ROOT` points the emitter at a directory of this test's own, so the run writes nothing into a
    # `runs/` that a corpus or a peer's checkout may be using, and reads back exactly what it wrote.
    with tempfile.TemporaryDirectory() as runs:
        subprocess.run([NODE, "scripts/emit-unclosable-vetoes.ts"], cwd=LAB, check=True,
                       capture_output=True, env={**os.environ, "RUNS_ROOT": runs})
        return json.loads((Path(runs) / "unclosable-vetoes.json").read_text(encoding="utf-8"))


def test_both_categories_are_present_and_separate() -> None:
    emitted = emitted_map()
    assert set(emitted) == EXPECTED_KINDS, (
        "the two kinds of unclosable veto must stay separate: `by-definition` is permanent and "
        "`perturbs-measurement` is a statement about this probe, and a reader acts on them differently")
    # Neither may be empty: an empty category reads as "nothing here" when it means "nobody filled it in",
    # and this whole map exists because a missing distinction looked like a clean result.
    for kind, group in emitted.items():
        assert group, f"{kind} is empty — declare an entry or delete the category"


def test_every_named_feature_is_one_the_pipeline_computes() -> None:
    # The canonical list, read from the module rather than restated. A table naming a feature that no
    # longer exists forgives a veto that cannot occur, and shrinks the work list by pretending an item was
    # impossible rather than done — which is the same shape as `audit_grants.py`'s STALE declarations.
    computed = set(getattr(features, "FEATURE_NAMES", ()) or ())
    assert computed, "the featurizer exposes no FEATURE_NAMES, so this test would examine nothing"
    unknown = sorted({name for group in emitted_map().values() for names in group.values()
                      for name in names} - computed)
    assert unknown == [], (
        f"{len(unknown)} feature(s) are declared unclosable but are not in the feature vector: {unknown}. "
        "Fix the declaration; the model is not implicated.")


@pytest.mark.parametrize("kind", sorted(EXPECTED_KINDS))
def test_every_named_subtype_looks_like_a_subtype(kind: str) -> None:
    # `criterion:subtype`, which is the key shape everything else in this pipeline uses. A typo here
    # forgives nothing and reads as coverage — the failure keyed the other way from the one above.
    import re
    for subtype in emitted_map()[kind]:
        assert re.fullmatch(r"\d+\.\d+\.\d+:[a-z0-9-]+", subtype), (
            f"{subtype!r} in {kind} is not a `criterion:subtype` key, so it can never match a head")
