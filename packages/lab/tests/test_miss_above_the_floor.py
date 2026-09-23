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

AND THE BAND ALONE CANNOT SAY IT. `falseNegativeSubtypeScores` is ungated deliberately, and the
applicability gate vetoes independently of the cut, so a record the GATE refused sits in the same
`[floor, threshold)` band as one the raise refused while no cut would ever have recovered it. The
classification therefore asks `applicability.decide` at the floor rather than comparing the score --
the counterfactual the annotation actually claims. Refused in review at `476547a0`; the control is
`test_a_gate_vetoed_miss_INSIDE_the_band_is_not_blamed_on_the_raise`.

AND IT IS ASKED OF EVERY CAPTURE, NOT OF WHICHEVER REPEAT CAME LAST. `case_identity` is
`caseId/variant`, the acceptance corpus captures each case twice, and both report fields are keyed on
that identity -- so the mapping they are derived from was dropping one repeat of every case. At equal
score, floor and cut, `[READ, UNREAD]` annotated nothing and `[UNREAD, READ]` annotated the case.
`test_acceptance_stability` already pins that a real identity has one applicable and one inapplicable
capture, so this is a population the corpus produces rather than one a fixture invents. Refused in
review at `778cff51d`; the controls are `test_the_annotation_is_THE_SAME_IN_EITHER_CAPTURE_ORDER` and
`test_the_annotation_is_UNANIMOUS_over_the_captures_and_the_positive_control_for_it`.
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


def measured() -> dict:
    """A capture whose form change was READ -- the subject `4.1.3:form-activation-silent` is a claim about.

    `_measured_form_change` is satisfied by any entry without `afterUnresolved`, and `after: ""` is the
    true positive's own shape: the activation happened and said nothing, which is the finding.
    """
    return {"input": {"interaction": {"formChanges": [{"control": "Book", "after": ""}]}}}


def unread() -> dict:
    """The same capture with its one form change never read (`afterUnresolved`, #1105).

    INAPPLICABLE, and inapplicable at every cut -- which is the whole point of it as a fixture. The real
    shape rather than an empty list, because an empty list is also refused by `_has`-style preconditions
    and would not distinguish a gate that reads the entries from one that counts them.
    """
    return {"input": {"interaction": {"formChanges": [{"control": "Book", "after": "unknown",
                                                       "afterUnresolved": True}]}}}


def missed(case: str, scores: dict, record: dict | None = None) -> dict:
    """One missed case, singly captured, as the evaluator hands it over: a LIST of (record, scores)."""
    return {case: [(measured() if record is None else record, scores)]}


def repeats(case: str, *captures: tuple[dict, dict]) -> dict:
    """One missed case captured more than once -- the shape a dict keyed on identity used to discard."""
    return {case: list(captures)}


def test_both_of_the_2152_misses_are_reported_as_the_raise_refusing_them():
    """The POSITIVE CONTROL for every emptiness below, and the measurement the row turned on.

    0.0031 short and 0.0197 short, which read as different diagnoses against the cut and as one state
    against the floor.
    """
    evaluator = load()
    refused = evaluator.misses_the_raise_refused(
        {**missed(TAXI, {SILENT: 0.9607574939727783}), **missed(PLOT, {SILENT: 0.9441697001457214})},
        SUBTYPES)
    assert refused == {TAXI: [SILENT], PLOT: [SILENT]}


def test_a_score_below_the_floor_is_the_head_losing_it_and_is_not_reported():
    """The other half of the population, and the reason this field is worth having at all.

    If everything were reported the field would say nothing. A head scoring under the cut its own bound
    requires did lose the case, and that is features work.
    """
    evaluator = load()
    assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: 0.90}), SUBTYPES) == {}
    assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: 0.0}), SUBTYPES) == {}


def test_a_gate_vetoed_miss_INSIDE_the_band_is_not_blamed_on_the_raise():
    """THE DEFECT THIS FILE SHIPPED WITH at `476547a0`, refused in review, and the control against it.

    `floor <= score < threshold` classifies from the cut ALONE. `falseNegativeSubtypeScores` is ungated
    on purpose -- "applying it here would hide the case where a head scored well and the gate suppressed
    it" -- and `applicability.decide` vetoes INDEPENDENTLY of the cut, so a record the GATE refused
    lands inside the band exactly like one the raise refused, and was reported as the raise's. That is a
    failure reason stating a comparison it never made, and worse than silence: the annotation says no
    features work is owed on a record whose subtype the page cannot be judged on at all.

    SAME SCORE, SAME FLOOR, SAME CUT, and only the record differs -- so nothing but the gate can be
    producing the difference. Both of the row's own scores are used, because the defect is not about
    where in the band a score sits.
    """
    evaluator = load()
    # THE FIXTURE'S OWN PREMISE, asserted rather than trusted. If `unread()` were applicable after all,
    # every emptiness below would pass by describing a state it does not contain, and the pair would no
    # longer differ by the gate at all.
    assert evaluator.applicability.applicable(SILENT, unread()) is False
    assert evaluator.applicability.applicable(SILENT, measured()) is True
    for score in (0.9607574939727783, 0.9441697001457214):
        assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: score}, unread()), SUBTYPES) == {}
        assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: score}), SUBTYPES) == {PLOT: [SILENT]}


def test_a_miss_at_or_above_the_applied_cut_is_not_blamed_on_the_raise_either():
    """It cleared the cut and did not fire, so a gate refused it and the raise refused nothing.

    On a real record that state IMPLIES the veto -- there is no other way to miss above the cut -- and
    the gate-vetoed reading is the one that occurs. The applicable pair asserts the classifier does not
    DEPEND on that implication: it is handed a combination the caller's filter cannot produce and still
    answers about the raise correctly, rather than being true only while the filter holds.
    """
    evaluator = load()
    for score in (0.9638848304748535, 0.999):
        assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: score}, unread()), SUBTYPES) == {}
        assert evaluator.misses_the_raise_refused(missed(PLOT, {SILENT: score}), SUBTYPES) == {}


def test_an_unrecorded_floor_classifies_nothing_rather_than_defaulting_to_the_threshold():
    """Absent and equal are different states. A pre-`guarantee` artifact has no floor to compare with."""
    evaluator = load()
    no_floor = {SILENT: head(threshold=0.9638848304748535)}
    assert evaluator.threshold_floor(no_floor[SILENT]) is None
    assert evaluator.threshold_floor(None) is None
    assert evaluator.misses_the_raise_refused(missed(TAXI, {SILENT: 0.9607574939727783}), no_floor) == {}


def test_a_head_the_criterion_does_not_own_is_ignored_rather_than_crashed_on():
    """`falseNegativeSubtypeScores` carries every head that scored the record; `model_subtypes` carries
    only the ones this criterion charges. A rule-decided head appears in the first and not the second."""
    evaluator = load()
    assert evaluator.misses_the_raise_refused(missed(TAXI, {"1.1.1:missing-alt": 0.99}), SUBTYPES) == {}


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


def test_the_missed_cases_carry_the_RECORD_each_score_was_computed_FROM():
    """The caller's half, which no test above can reach: every one of them hands the record in by hand.

    The classification asks the applicability gate and the gate READS the capture, so pairing a score
    with the wrong record -- or with none -- answers about a different page and reports nothing wrong
    while doing it. Measured while building this fix: replacing `records[index]` with `{}` at the call
    site left the whole of `packages/lab/tests` green, which is why the pairing is a named function.

    Identity, not equality: two captures of the same case differ in their interaction and compare equal
    on nothing that matters here, so `==` would accept the wrong repeat.
    """
    evaluator = load()
    records = [
        {"provenance": {"caseId": "acceptance-b3-status-plot", "variant": "good"}, "input": {}},
        {"provenance": {"caseId": "acceptance-b3-status-plot", "variant": "bad"},
         "input": {"interaction": {"formChanges": [{"control": "Book", "after": ""}]}}},
        {"provenance": {"caseId": "acceptance-b3-status-taxi", "variant": "bad"}, "input": {}},
    ]
    scores = {SILENT: [0.1, 0.9441697001457214, 0.5]}

    missed_cases = evaluator.missed_cases(records, [1], scores)

    assert list(missed_cases) == [PLOT], "only the missed records, keyed as the rest of the report keys them"
    (record, head_scores), = missed_cases[PLOT]
    assert record is records[1], "the capture this score was computed from, not another record"
    assert head_scores == {SILENT: 0.9441697001457214}, "unrounded -- the floor is a float32 comparison"


def test_missed_cases_KEEPS_EVERY_REPEAT_of_a_case_rather_than_the_last_one_in_the_file():
    """THE DEFECT THIS FILE SHIPPED WITH at `778cff51d`, refused in review by `reviewer-2`.

    `case_identity` is `caseId/variant` and the corpus captures each case more than once, so a dict
    comprehension keyed on it kept the LAST repeat and dropped the rest -- silently, because the result
    is a well-formed mapping of exactly the right identities. Identity and not equality on the members:
    two captures of one case differ only in their interaction, and `==` would accept either for both.
    """
    evaluator = load()
    first = {"provenance": {"caseId": "acceptance-b3-status-plot", "variant": "bad"}, **measured()}
    second = {"provenance": {"caseId": "acceptance-b3-status-plot", "variant": "bad"}, **unread()}
    scores = {SILENT: [0.9441697001457214, 0.9607574939727783]}

    grouped = evaluator.missed_cases([first, second], [0, 1], scores)

    assert list(grouped) == [PLOT], "one key, because it is one case"
    assert [record for record, _ in grouped[PLOT]] == [first, second]
    assert grouped[PLOT][0][0] is first and grouped[PLOT][1][0] is second, "both captures, each with its own"
    assert [scores_[SILENT] for _, scores_ in grouped[PLOT]] == [0.9441697001457214, 0.9607574939727783]


def test_the_annotation_is_THE_SAME_IN_EITHER_CAPTURE_ORDER():
    """The reviewer's counterexample at `778cff51d`, run in both orders at ONE score, floor and cut.

    `test_acceptance_stability` pins that this population is real rather than hypothetical:
    `acceptance-b3-button-market/bad` read its form change on repeat-1 and got `afterUnresolved` on
    repeat-2, so one capture of an identity is applicable and the other is not. Before the fix
    `[READ, UNREAD]` annotated nothing and `[UNREAD, READ]` annotated the case -- the report depended on
    the file order, and could either omit a genuinely raise-refused capture or excuse a gate-vetoed one.

    The answer is the same both ways AND it is the narrow one: the captures disagree about whether the
    page can be judged at all, so the case is not excused.
    """
    evaluator = load()
    score = 0.9607574939727783
    read, unread_ = (measured(), {SILENT: score}), (unread(), {SILENT: score})

    forwards = evaluator.misses_the_raise_refused(repeats(TAXI, read, unread_), SUBTYPES)
    backwards = evaluator.misses_the_raise_refused(repeats(TAXI, unread_, read), SUBTYPES)

    assert forwards == backwards, "the report must not depend on which repeat the corpus wrote last"
    assert forwards == {}, "one capture the gate vetoed means the case is not excused"


def test_the_annotation_is_UNANIMOUS_over_the_captures_and_the_positive_control_for_it():
    """A case is excused only if EVERY capture of it would have fired at the floor.

    Both captures applicable here, so nothing but the SCORES can produce the difference -- the sibling
    of the gate-vetoed pair above, and the half that says the rule is about the claim rather than about
    applicability. The positive control is in the same test: two captures that both clear the floor ARE
    annotated, in both orders, so the emptiness above is not passing by refusing everything.
    """
    evaluator = load()
    above = (measured(), {SILENT: 0.9607574939727783})
    lost = (measured(), {SILENT: 0.10})
    other = (measured(), {SILENT: 0.9441697001457214})

    assert evaluator.misses_the_raise_refused(repeats(TAXI, above, lost), SUBTYPES) == {}
    assert evaluator.misses_the_raise_refused(repeats(TAXI, lost, above), SUBTYPES) == {}
    assert evaluator.misses_the_raise_refused(repeats(TAXI, above, other), SUBTYPES) == {TAXI: [SILENT]}
    assert evaluator.misses_the_raise_refused(repeats(TAXI, other, above), SUBTYPES) == {TAXI: [SILENT]}
    assert evaluator.misses_the_raise_refused({TAXI: []}, SUBTYPES) == {}, (
        "`all([])` is true; a case with no captures must not be excused vacuously")


def test_the_reported_score_is_the_weakest_capture_and_cannot_contradict_the_annotation():
    """`falseNegativeSubtypeScores` is keyed by identity too, so it had the same last-repeat-wins defect.

    The weakest capture, chosen rather than fallen into, and the invariant it buys: because the
    annotation is unanimous, an excused case cleared its floor on every capture, so the number
    `describe_miss` prints beside "above its NP floor" is itself at or above that floor. A summary that
    could sit below the floor it is annotated as clearing would be the same class of defect one level on.
    """
    evaluator = load()
    strong, weak = (measured(), {SILENT: 0.96, "1.1.1:missing-alt": 0.4}), (measured(), {SILENT: 0.10})

    assert evaluator.weakest_miss_scores([strong, weak]) == {SILENT: 0.10, "1.1.1:missing-alt": 0.4}
    assert evaluator.weakest_miss_scores([weak, strong]) == {SILENT: 0.10, "1.1.1:missing-alt": 0.4}
    assert evaluator.weakest_miss_scores([strong]) == {SILENT: 0.96, "1.1.1:missing-alt": 0.4}

    excused = repeats(TAXI, (measured(), {SILENT: 0.9607574939727783}),
                      (measured(), {SILENT: 0.9441697001457214}))
    assert evaluator.misses_the_raise_refused(excused, SUBTYPES) == {TAXI: [SILENT]}
    assert evaluator.weakest_miss_scores(excused[TAXI])[SILENT] >= evaluator.threshold_floor(SUBTYPES[SILENT])


def test_the_pairing_reaches_the_classification_rather_than_only_the_report():
    """THE JOIN, end to end from the evaluator's own two steps, because each is green on its own.

    `missed_cases` could pair correctly and `misses_the_raise_refused` classify correctly while the
    report passed the classifier something else entirely -- which is the shape the caller mutation
    above found. Same score in both records; only the gate differs.
    """
    evaluator = load()
    applicable, vetoed = measured(), unread()
    records = [
        {"provenance": {"caseId": "acceptance-b3-status-plot", "variant": "bad"}, **applicable},
        {"provenance": {"caseId": "acceptance-b3-status-taxi", "variant": "bad"}, **vetoed},
    ]
    scores = {SILENT: [0.9441697001457214, 0.9441697001457214]}

    classified = evaluator.misses_the_raise_refused(
        evaluator.missed_cases(records, [0, 1], scores), SUBTYPES)

    assert classified == {PLOT: [SILENT]}, (
        "the raise refused the applicable capture and the GATE refused the other, at one score")


def test_the_pairing_reaches_the_classification_for_REPEATS_OF_ONE_CASE_in_either_order():
    """The same join where the two records share an identity, which is where the grouping earns its keep.

    The test above uses two different cases, so a mapping that kept one capture per identity passed it.
    Here both captures are the same case: at `778cff51d` the classification read whichever the corpus
    wrote last, and the two orders disagreed. Same score in both; only the gate differs.
    """
    evaluator = load()
    identity = {"caseId": "acceptance-b3-status-plot", "variant": "bad"}
    applicable = {"provenance": identity, **measured()}
    vetoed = {"provenance": identity, **unread()}
    scores = {SILENT: [0.9441697001457214, 0.9441697001457214]}

    forwards = evaluator.misses_the_raise_refused(
        evaluator.missed_cases([applicable, vetoed], [0, 1], scores), SUBTYPES)
    backwards = evaluator.misses_the_raise_refused(
        evaluator.missed_cases([vetoed, applicable], [0, 1], scores), SUBTYPES)

    assert forwards == backwards == {}, "end to end, the report does not depend on the corpus file order"
