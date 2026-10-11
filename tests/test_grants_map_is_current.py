"""The `grants` map the Python audit reads must match the JavaScript that declares it.

`audit_grants.py`'s docstring has named this file since it was written:

    `ACCOMPANYING_DEFECTS` is JavaScript and the features are Python, so neither can import the other. The
    map is emitted to `runs/accompanying-grants.json` by `npm run corpus:grants-map` and read here, with
    `test_grants_map_is_current.py` asserting the file matches the source. Deleting a copy is unavailable;
    CLAUDE.md's remedy for a forced duplication is to pin the copies equal with a test.

**The test did not exist.** A forced duplication with its pin described and never built — which is the
same class as every other defect found on 2026-08-27: a safeguard that is documented, believed in, and
absent. Found by asking what proves each gate, rather than by anything failing.

What it pins, and why each half matters:

- **Every declared feature is one the pipeline actually computes.** A declaration naming a feature that no
  longer exists makes the audit report `STALE` for 52 records with nothing wrong with them, beside a real
  `FAIL` for records genuinely missing evidence. Those need opposite fixes and one of them is not in the
  corpus at all — the audit prints them differently precisely because that distinction cost a diagnosis.
- **Every accompanying defect declares one.** A defect with no `grants` is invisible to the audit, so a
  page labelled for it is never checked for the evidence the label claims.

Deliberately NOT asserting against `runs/accompanying-grants.json`: that file is generated, gitignored,
and its absence is what `corpus:grants-audit` already refuses on. Pinning the SOURCES to each other is the
claim that matters; the emitted file is a transport.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _scorer_python import scorer_python  # noqa: E402

sys.path.insert(0, str(scorer_python()))

import screenreader_features as features  # noqa: E402

LAB = Path(__file__).resolve().parents[1]

# The lab's scripts are `.ts` and Node loads them by stripping types, which the distro's `/usr/bin/node` does
# not do reliably. The upstream Node 24 at `~/.local/bin/node` (#4388) does, so prefer it over whatever `node`
# the PATH happens to resolve to, and fall back to the PATH where that file is absent (CI's setup-node).
_UPSTREAM_NODE = Path.home() / ".local/bin/node"
NODE = str(_UPSTREAM_NODE) if _UPSTREAM_NODE.exists() else "node"


def grants_from_javascript() -> dict[str, str]:
    """Ask the JS for its map, rather than re-parsing the source with a regex.

    A regex over `case-matrix.mjs` would be a THIRD copy of the same fact, and this repo's notes are
    explicit that a test deriving its expectations from source TEXT can match nothing and pass — measured
    twice, on the signal-type scrape and on a `sweepLog` guard.
    """
    script = (
        'import { ACCOMPANYING_DEFECTS } from "./src/training/case-matrix.mjs";'
        'import { grantsMap } from "./scripts/emit-grants-map.ts";'
        'process.stdout.write(JSON.stringify(grantsMap(ACCOMPANYING_DEFECTS)));'
    )
    out = subprocess.run(
        [NODE, "--input-type=module", "-e", script],
        cwd=LAB, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def test_every_granted_feature_is_one_the_pipeline_computes():
    granted = grants_from_javascript()
    assert granted, "the map is empty, so this test would examine nothing"
    computed = set(features.FEATURE_NAMES)
    stale = {name: feature for name, feature in granted.items() if feature not in computed}
    assert not stale, (
        f"accompanying defect(s) declare a feature the featurizer no longer computes: {stale}. "
        "The audit reports these as STALE rather than FAIL, which is correct and still means the "
        "declaration is lying about what its markup produces."
    )


def test_every_accompanying_defect_declares_a_feature():
    granted = grants_from_javascript()
    missing = [name for name, feature in granted.items() if not feature]
    assert not missing, (
        f"accompanying defect(s) grant nothing: {missing}. A defect with no `grants` is invisible to "
        "`corpus:grants-audit`, so a page labelled for it is never checked for the evidence its label claims."
    )


def test_the_map_is_read_from_the_source_and_not_from_a_stale_export():
    """The premise, stated as an assertion.

    If `grants_from_javascript` ever silently returned `{}` — a renamed export, a moved file — both tests
    above would pass having examined nothing. That is the failure this whole file is an instance of.
    """
    granted = grants_from_javascript()
    assert len(granted) >= 5, f"expected the full accompanying-defect set, got {len(granted)}: {granted}"
    assert "fake-heading" in granted, "the defect that has cost the most diagnoses must be in the map"
