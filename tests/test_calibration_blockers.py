"""A blocker list must contain only things that block.

`releaseBlockedBy` was derived by promoting EVERY warning once calibration was unclean. So a purely
informational note — "23 development record(s) masked as unknown by their publisher's claim", which
`known_indices` has already handled by excluding those records from the head entirely — appeared as
something standing between the model and a release.

Measured 2026-08-23: 40 blockers, 12 of them that note. Comparing 0 blockers on the shipped model against
40 on a candidate, a reader cannot tell a corpus that grew from a model that got worse — and I nearly drew
exactly that conclusion before checking that the candidate covered 13 criteria to the shipped model's 8.

The distinction already existed and was discarded at the last step: a blocking note flips
`calibrationClean`, an informational one does not. `note()` records it where the decision is made.
"""
import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "train-screenreader-model.py"


def load():
    spec = importlib.util.spec_from_file_location("trainer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["trainer"] = module
    spec.loader.exec_module(module)
    return module


def blank():
    return {"warnings": [], "calibrationBlockers": []}


def test_an_informational_note_is_readable_but_never_blocking():
    trainer = load()
    report = blank()
    trainer.note(report, "1.1.1:missing-alt: 23 development record(s) masked as unknown", blocking=False)
    assert report["warnings"] == ["1.1.1:missing-alt: 23 development record(s) masked as unknown"]
    assert report["calibrationBlockers"] == [], "an informational note must not reach the blocker list"


def test_a_blocking_note_appears_in_both():
    # Both, deliberately: the warnings list stays the complete record of what calibration observed, and the
    # blocker list is the subset that decides. A blocker missing from warnings would make the two disagree.
    trainer = load()
    report = blank()
    trainer.note(report, "2.4.3: validation split has no positive records", blocking=True)
    assert report["warnings"] == ["2.4.3: validation split has no positive records"]
    assert report["calibrationBlockers"] == ["2.4.3: validation split has no positive records"]


def test_the_two_lists_cannot_drift_because_one_call_writes_both():
    # The failure this replaces was a SECOND derivation of the same fact: warnings appended at four call
    # sites, blockers computed once at the end by promoting all of them. One function, one decision.
    trainer = load()
    report = blank()
    for i, blocking in enumerate([True, False, True, False, False]):
        trainer.note(report, f"note-{i}", blocking=blocking)
    assert len(report["warnings"]) == 5
    assert report["calibrationBlockers"] == ["note-0", "note-2"]
    assert set(report["calibrationBlockers"]) <= set(report["warnings"])
