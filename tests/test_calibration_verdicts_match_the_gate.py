"""The trainer and `releasability.mjs` must apply ONE rule for type-I error.

The rule exists twice because it must: the trainer decides `releaseEligible` in Python at train time and
the gate decides the release in JavaScript at promote time, and neither language can import the other. So
CLAUDE.md's first two remedies for a fact stated twice -- delete a copy, derive one from the other -- are
unavailable, and the third applies: pin them equal with a test.

They HAD drifted, and it cost a diagnosis on 2026-08-25. The trainer blocked on
``if falsePositive or falseNegative``, zero tolerance left over from before Neyman-Pearson calibration,
while the gate had moved to the bound the threshold was actually chosen for. BOTH TEST SUITES PASSED --
`releasability.test.ts` covers the gate thoroughly and `test_np_threshold.py` covers the NP maths
thoroughly, and the contradiction lived between them where no compiler could see it.

The cases live in `scripts/fixtures/calibration-verdicts.json`, read here and by `releasability.test.ts`.
Neither side may edit them alone: a change that makes one implementation pass will fail the other.
"""
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "train-screenreader-model.py"
FIXTURE = REPO / "scripts" / "fixtures" / "calibration-verdicts.json"


def load():
    spec = importlib.util.spec_from_file_location("trainer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["trainer"] = module
    spec.loader.exec_module(module)
    return module


def cases():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def test_the_fixture_is_real_and_covers_both_verdicts():
    """A guard that reads an empty or one-sided fixture passes while examining nothing."""
    loaded = cases()
    assert len(loaded) >= 6, f"only {len(loaded)} shared cases; the fixture shrank"
    assert any(c["blocks"] for c in loaded), "no blocking case — the rule could return None always"
    assert any(not c["blocks"] for c in loaded), "no passing case — the rule could block always"


def test_the_trainer_agrees_with_the_shared_contract():
    trainer = load()
    for case in cases():
        blocker = trainer.type_one_error_blocker(
            "subtype", case["development"], case["guarantee"]
        )
        assert bool(blocker) == case["blocks"], (
            f"{case['name']}: trainer {'blocked' if blocker else 'passed'} where the shared contract says "
            f"{'block' if case['blocks'] else 'pass'}. {case['why']}"
        )


def test_false_negatives_alone_never_block_however_many():
    """The drift itself, asserted directly as well as through the fixture.

    NP bounds type-I error and trades recall deliberately. Development recall is computed on a corpus
    particular to one model, so its absolute value cannot support a gate -- a head that genuinely weakens
    is caught on held-out acceptance, where two models ARE comparable.
    """
    trainer = load()
    guarantee = {"permittedFalsePositives": 4, "atTarget": True}
    for missed in (1, 13, 100, 1000):
        assert trainer.type_one_error_blocker(
            "s", {"falsePositive": 0, "falseNegative": missed}, guarantee
        ) is None, f"{missed} false negatives blocked; that bar is unclearable and was never the point"


def test_the_bound_is_read_from_the_guarantee_rather_than_hardcoded():
    """A rule with a constant in it would pass the fixture and be wrong on every other head."""
    trainer = load()
    for permitted in (0, 1, 4, 17):
        guarantee = {"permittedFalsePositives": permitted, "atTarget": True}
        assert trainer.type_one_error_blocker(
            "s", {"falsePositive": permitted}, guarantee) is None
        assert trainer.type_one_error_blocker(
            "s", {"falsePositive": permitted + 1}, guarantee) is not None
