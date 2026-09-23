"""A miss that cleared its head's Neyman-Pearson floor was refused by the raise, not by the head.

`falseNegativeSubtypeScores` exists so a reader can tell threshold variance from a head that lost a
case, and its own comment names the two states it separates: "the HEAD scored 0.90 against its own
0.9153 cut (threshold variance, ship it) or near zero (the head genuinely lost it)".

THERE IS A THIRD, and printing the applied cut alone hides it. The cut is RAISED off the floor the
guarantee rests on, so a score inside `[floor, threshold)` already satisfies the bound the whole
calibration is derived from. No work on the features would recover it and none is owed.

Measured 2026-09-23 (#2152) on `4.1.3:form-activation-silent`, floor 0.9344 against an applied cut of
0.9639: `acceptance-b3-status-taxi/bad` scored 0.9608 and `acceptance-b3-status-plot/bad` 0.9442, and
all four of the criterion's missed records were in that band. Read against the cut alone the two were
given opposite diagnoses on the same row -- 0.0031 short was called threshold variance, 0.0197 short
"no longer a threshold-variance candidate at all". They are one state, and this is what says so.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHIPPED_TRAINING_REPORT = ROOT / "packages/scorer/models/screenreader-scorer/training-report.json"


def load():
    spec = importlib.util.spec_from_file_location(
        "acceptance_evaluator", ROOT / "packages/lab/scripts/evaluate-screenreader-acceptance.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator"] = module
    spec.loader.exec_module(module)
    return module


def head(threshold: float, floor: float | None = None) -> dict:
    guarantee = {} if floor is None else {"guarantee": {"floor": floor}}
    return {"threshold": threshold, **guarantee}


# The real shape, to three of its real digits, so the fixture cannot drift into a band that does not occur.
TAXI = "acceptance-b3-status-taxi/bad"
PLOT = "acceptance-b3-status-plot/bad"
SILENT = "4.1.3:form-activation-silent"
SUBTYPES = {SILENT: head(threshold=0.9638848304748535, floor=0.9344233870506287)}


def test_both_of_the_2152_misses_are_reported_as_the_raise_refusing_them():
    """The POSITIVE CONTROL for every emptiness below, and the measurement the row turned on.

    0.0031 short and 0.0197 short, which read as different diagnoses against the cut and as one state
    against the floor.
    """
    evaluator = load()
    refused = evaluator.misses_the_raise_refused(
        {TAXI: {SILENT: 0.9607574939727783}, PLOT: {SILENT: 0.9441697001457214}}, SUBTYPES)
    assert refused == {TAXI: [SILENT], PLOT: [SILENT]}


def test_a_score_below_the_floor_is_the_head_losing_it_and_is_not_reported():
    """The other half of the population, and the reason this field is worth having at all.

    If everything were reported the field would say nothing. A head scoring under the cut its own bound
    requires did lose the case, and that is features work.
    """
    evaluator = load()
    assert evaluator.misses_the_raise_refused({PLOT: {SILENT: 0.90}}, SUBTYPES) == {}
    assert evaluator.misses_the_raise_refused({PLOT: {SILENT: 0.0}}, SUBTYPES) == {}


def test_a_miss_the_applicability_gate_vetoed_is_not_blamed_on_the_raise():
    """It scored AT or ABOVE the applied cut and still did not fire, so the raise refused nothing.

    `falseNegativeSubtypeScores` is ungated on purpose -- "applying it here would hide the case where a
    head scored well and the gate suppressed it" -- so this state reaches the classifier and must be
    excluded by the upper bound rather than by never arriving. A threshold question and a gate question
    need opposite work.
    """
    evaluator = load()
    assert evaluator.misses_the_raise_refused({PLOT: {SILENT: 0.9638848304748535}}, SUBTYPES) == {}
    assert evaluator.misses_the_raise_refused({PLOT: {SILENT: 0.999}}, SUBTYPES) == {}


def test_an_unrecorded_floor_classifies_nothing_rather_than_defaulting_to_the_threshold():
    """Absent and equal are different states. A pre-`guarantee` artifact has no floor to compare with."""
    evaluator = load()
    no_floor = {SILENT: head(threshold=0.9638848304748535)}
    assert evaluator.threshold_floor(no_floor[SILENT]) is None
    assert evaluator.threshold_floor(None) is None
    assert evaluator.misses_the_raise_refused({TAXI: {SILENT: 0.9607574939727783}}, no_floor) == {}


def test_a_head_the_criterion_does_not_own_is_ignored_rather_than_crashed_on():
    """`falseNegativeSubtypeScores` carries every head that scored the record; `model_subtypes` carries
    only the ones this criterion charges. A rule-decided head appears in the first and not the second."""
    evaluator = load()
    assert evaluator.misses_the_raise_refused({TAXI: {"1.1.1:missing-alt": 0.99}}, SUBTYPES) == {}


def test_the_floors_are_reported_beside_the_cuts_and_an_unrecorded_one_is_absent_not_guessed():
    evaluator = load()
    assert evaluator.threshold_floors(SUBTYPES) == {SILENT: 0.9344233870506287}
    assert evaluator.threshold_floors({SILENT: head(threshold=0.96)}) == {}, (
        "an unrecorded floor must be absent from the report, never defaulted to the applied cut")
    assert evaluator.threshold_floors({}) == {}


def test_the_failure_reason_names_the_floor_only_for_the_misses_it_explains():
    evaluator = load()
    block = {
        "falseNegativeSubtypeScores": {TAXI: {SILENT: 0.9608}, PLOT: {SILENT: 0.5}},
        "subtypeThresholds": {SILENT: 0.9638848304748535},
        "subtypeThresholdFloors": {SILENT: 0.9344233870506287},
        "falseNegativesAboveFloor": {TAXI: [SILENT]},
    }
    raised = evaluator.describe_miss(TAXI, block)
    assert "0.961 vs cut 0.964" in raised
    assert "above its 0.934 NP floor -- refused by the raise, not the head" in raised

    lost = evaluator.describe_miss(PLOT, block)
    assert "0.500 vs cut 0.964" in lost
    assert "NP floor" not in lost, "a head that genuinely lost the case must not be excused"


def test_the_shipped_model_really_does_carry_a_band_for_this_to_describe():
    """THE PREMISE, against the tracked artifact rather than a fixture.

    If every head's applied cut equalled its floor there would be no band, nothing could land in one,
    and every test above would be describing a state the calibration cannot produce. Asserted as a
    property and not as a list: which heads have the widest band changes with every retrain.
    """
    report = json.loads(SHIPPED_TRAINING_REPORT.read_text())
    banded = {
        subtype: (entry["guarantee"]["floor"], entry["threshold"])
        for criterion in report["criteria"].values()
        for subtype, entry in criterion.get("subtypes", {}).items()
        if entry.get("guarantee", {}).get("floor") is not None
        and entry["guarantee"]["floor"] < entry["threshold"]
    }
    assert banded, (
        "no shipped head has an applied cut above its own Neyman-Pearson floor, so there is no band for "
        "a miss to be refused by and this whole guard examines nothing")
