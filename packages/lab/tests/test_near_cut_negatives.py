"""Held-out negatives that score inside `[floor, threshold)` are REPORTED, so the band is measured on both sides (#2259).

#2152 kept `4.1.3:form-activation-silent`'s applied cut 0.9620 above its NP floor 0.9350 because, on the
DEVELOPMENT sample, the band holds 3 negatives and 0 positives. The held-out report could not say the same:
`falseNegativeSubtypeScores` scores the records that were MISSED and `falsePositiveSubtypeScores` the ones that
FIRED, so `falsePositive 0` on 844 records leaves a negative at 0.95 -- safely under the cut -- indistinguishable
from one at 0.20. `near_cut_negatives` is the field that tells them apart.

THE EMPTY RESULT IS A REAL ANSWER HERE ("no held-out negative sits in the band"), which is why it needs a
positive control: `test_a_negative_inside_the_band_is_reported` is the one, and every emptiness below is a
mirror image of it with exactly one thing changed.

This row moves no cut. Nothing here reads or writes a threshold.
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]

SILENT = "4.1.3:form-activation-silent"
OTHER = "4.1.3:other-head"
# The real shape, to the digits the row quotes, so a fixture cannot drift into a band that does not occur.
FLOOR = 0.934956967830658
CUT = 0.9620040059089661
SUBTYPES = {SILENT: {"threshold": CUT, "guarantee": {"floor": FLOOR}}}


def load():
    spec = importlib.util.spec_from_file_location(
        "acceptance_evaluator", ROOT / "packages/lab/scripts/evaluate-screenreader-acceptance.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator"] = module
    spec.loader.exec_module(module)
    return module


def record(case: str, variant: str = "good") -> dict:
    return {"provenance": {"caseId": case, "variant": variant}, "input": {}}


def band(records: list[dict], scores: list[float], positive: list[bool] | None = None,
         subtypes: dict | None = None, head_scores: dict | None = None) -> dict:
    """`near_cut_negatives` over every record, handing it what `main` hands it."""
    evaluator = load()
    labels = [False] * len(records) if positive is None else positive
    return evaluator.near_cut_negatives(
        records, list(range(len(records))), labels,
        {SILENT: np.array(scores)} if head_scores is None else head_scores,
        SUBTYPES if subtypes is None else subtypes)


def test_a_negative_inside_the_band_is_reported():
    """THE POSITIVE CONTROL: without it every `== {SILENT: {}}` below passes on a field nobody populated."""
    found = band([record("acceptance-b3-status-plot"), record("acceptance-b3-status-taxi")],
                 [0.9531, 0.2])
    assert found == {SILENT: {"acceptance-b3-status-plot/good": 0.9531}}


def test_a_negative_below_the_floor_is_not_reported_and_the_head_still_appears_with_an_empty_map():
    """`{}` under the key says "looked, found none"; a missing key would say nothing at all."""
    assert band([record("a")], [0.20]) == {SILENT: {}}


def test_the_band_is_closed_at_the_floor_and_OPEN_at_the_cut():
    """The head fires at `score >= threshold`, so a negative AT the cut is a false positive, not a near miss.

    Float-for-float rather than at four decimals: a score 0.00005 under the cut must stay in.
    """
    records = [record("at-floor"), record("at-cut"), record("just-under-cut"), record("just-under-floor")]
    found = band(records, [FLOOR, CUT, np.nextafter(CUT, 0.0), np.nextafter(FLOOR, 0.0)])
    assert list(found[SILENT]) == ["at-floor/good", "just-under-cut/good"]


def test_a_labelled_positive_in_the_band_is_a_MISS_and_belongs_to_the_other_field():
    """The two fields partition the band by label, so a positive here would be counted twice."""
    records = [record("positive", "bad"), record("negative")]
    assert band(records, [0.95, 0.95], positive=[True, False]) == {SILENT: {"negative/good": 0.95}}


def test_a_case_captured_twice_reports_its_STRONGEST_capture_once():
    """How close the case came to firing is the question, so the higher repeat, in either file order."""
    records = [record("plot"), record("plot")]
    assert band(records, [0.9400, 0.9600]) == {SILENT: {"plot/good": 0.96}}
    assert band(records, [0.9600, 0.9400]) == {SILENT: {"plot/good": 0.96}}


def test_only_the_records_the_criterion_was_charged_for_are_read():
    """`included_indices` is the caller's filter; a record outside it must not appear, even in the band."""
    evaluator = load()
    records = [record("charged"), record("excluded")]
    found = evaluator.near_cut_negatives(
        records, [0], [False], {SILENT: np.array([0.95, 0.95])}, SUBTYPES)
    assert found == {SILENT: {"charged/good": 0.95}}


def test_a_head_that_records_no_floor_has_no_band_and_is_absent_rather_than_empty():
    """Unrecorded is not "the cut is the floor": an empty map would claim the band was examined."""
    no_floor = {SILENT: {"threshold": CUT}}
    assert band([record("a")], [0.95], subtypes=no_floor) == {}
    assert band([record("a")], [0.95], subtypes={}) == {}


def test_each_head_is_read_on_its_own_scores_and_its_own_band():
    """A second head with a different band and different scores, so a shared loop variable would show."""
    subtypes = {**SUBTYPES, OTHER: {"threshold": 0.5, "guarantee": {"floor": 0.4}}}
    found = band([record("a"), record("b")], [], subtypes=subtypes, head_scores={
        SILENT: np.array([0.95, 0.10]), OTHER: np.array([0.45, 0.95])})
    assert found == {SILENT: {"a/good": 0.95}, OTHER: {"a/good": 0.45}}


def test_the_score_is_rounded_for_the_reader_but_compared_unrounded():
    """0.96199 is in the band and prints as 0.962; a rounded comparison would call 0.96204 in as well."""
    found = band([record("in"), record("out")], [0.9619999, CUT + 0.00001])
    assert found == {SILENT: {"in/good": 0.962}}
