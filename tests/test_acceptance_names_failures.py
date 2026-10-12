"""An acceptance failure must name the cases that failed, not just count them.

Measured 2026-08-23 against the shipped model on a fresh held-out set: `1.3.1: acceptance false negatives`
and `2.4.6: acceptance false positives`, two of each. From the report it was impossible to tell whether
that was one subtype systematically missed or two unlucky pages — and those need completely different
responses. Answering it meant re-running the evaluator by hand with print statements.

The repo already states the rule, in `capture-real-pages`: "Named, not counted. '3 failed' tells you
nothing about whether the corpus is usable."
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "evaluate-screenreader-acceptance.py"


def load():
    spec = importlib.util.spec_from_file_location("acceptance_evaluator", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator"] = module
    spec.loader.exec_module(module)
    return module


def test_names_both_kinds_of_failure():
    ev = load()
    # index:      0     1     2     3
    # label:      T     T     F     F
    # score:    0.9   0.1   0.8   0.1   threshold 0.5
    # so: 0 TP, 1 FN, 2 FP, 3 TN
    block = ev.metrics(
        np.array([0.9, 0.1, 0.8, 0.1]),
        np.array([True, True, False, False]),
        0.5,
        identities=["good-case/bad", "missed-case/bad", "flagged-case/good", "clean-case/good"],
    )
    assert block["truePositive"] == 1 and block["falseNegative"] == 1 and block["falsePositive"] == 1
    assert block["falseNegativeCases"] == ["missed-case/bad"]
    assert block["falsePositiveCases"] == ["flagged-case/good"]


def test_a_clean_criterion_names_nothing_rather_than_omitting_the_keys():
    # Absent and empty must not look alike: an empty list says "we looked and there were none", a missing
    # key says nothing at all, and a consumer cannot tell the second from an older report.
    ev = load()
    block = ev.metrics(np.array([0.9, 0.1]), np.array([True, False]), 0.5, identities=["a/bad", "b/good"])
    assert block["falsePositiveCases"] == []
    assert block["falseNegativeCases"] == []


def test_without_identities_the_report_keeps_its_old_shape():
    # The parameter is optional so every other caller is unchanged; a naming feature must not become a
    # required argument that breaks the callers it was meant to help.
    ev = load()
    block = ev.metrics(np.array([0.9]), np.array([True]), 0.5)
    assert "falsePositiveCases" not in block
    assert block["truePositive"] == 1


def test_the_list_is_bounded_and_says_when_it_truncated():
    # A report nobody can read is its own kind of silence. Truncation must be visible, or 12 of 400 reads
    # as 12 of 12.
    ev = load()
    n = ev.MAX_NAMED_FAILURES + 5
    block = ev.metrics(
        np.zeros(n), np.ones(n, dtype=bool), 0.5, identities=[f"case-{i:03d}/bad" for i in range(n)]
    )
    assert len(block["falseNegativeCases"]) == ev.MAX_NAMED_FAILURES
    assert block["falseNegativeCasesTruncated"] == 5


def test_case_identity_is_the_same_key_the_stability_grouping_uses():
    ev = load()
    assert ev.case_identity({"provenance": {"caseId": "form-error", "variant": "bad"}}) == "form-error/bad"
    # A record missing provenance must not crash a report that exists to explain a failure.
    assert ev.case_identity({}) == "?/?"


# --- The false-POSITIVE half: a head's own score, not the criterion's binary decision (#2201) ---
#
# The report printed `@1.000` for a false positive. That is `decided` -- the criterion's 0/1 decision, the OR of its
# heads -- passed through `metrics`, and two rows read it as the model's confidence within one hour (#2187, #2188).
# The real `2.4.6:regex` scores were 0.980 and 0.870, which differ by 0.11; the report said 1.000 for both.

HEAD = "2.4.6:regex"
OTHER_HEAD = "2.4.6:generic"


def record(case: str, variant: str) -> dict:
    return {"provenance": {"caseId": case, "variant": variant}}


def fp_scores(ev, *, records, decided, labels, scores):
    """`false_positive_subtype_scores` for records that are ALL included, with `scores` keyed by head."""
    return ev.false_positive_subtype_scores(
        records, list(range(len(records))), np.array(labels, dtype=bool), np.array(decided, dtype=bool),
        {head: np.array(values) for head, values in scores.items()})


def test_a_false_positive_reports_the_HEAD_score_not_the_criterions_binary_decision():
    ev = load()
    #             0: FP     1: FP     2: clean  3: true positive
    records = [record("icon-help", "good"), record("icon-help", "bad"), record("quiet", "good"), record("real", "bad")]
    result = fp_scores(
        ev, records=records, decided=[True, True, False, True], labels=[False, False, False, True],
        scores={HEAD: [0.98, 0.87, 0.10, 0.99], OTHER_HEAD: [0.10, 0.20, 0.30, 0.40]})
    assert result == {
        "icon-help/bad": {HEAD: 0.87, OTHER_HEAD: 0.2},
        "icon-help/good": {HEAD: 0.98, OTHER_HEAD: 0.1},
    }, f"the two false positives, each with EVERY head's raw score, and not the clean or true-positive record: {result}"
    # THE MUTATION, stated as an assertion: feed the field from `decided` and both read 1.0. Two cases that differ by
    # 0.11 must not read identically -- that reading is what cost two rows.
    assert result["icon-help/good"][HEAD] != result["icon-help/bad"][HEAD]
    assert 1.0 not in {score for heads in result.values() for score in heads.values()}


def test_a_criterion_with_no_false_positives_reports_an_EMPTY_map_not_a_missing_one():
    # The neighbouring rule (`test_a_clean_criterion_names_nothing_rather_than_omitting_the_keys`), for the new field:
    # an empty map says "we looked and found none". A dropped field says nothing, and reads the same.
    ev = load()
    result = fp_scores(ev, records=[record("a", "bad"), record("b", "good")], decided=[True, False],
                       labels=[True, False], scores={HEAD: [0.9, 0.1]})
    assert result == {}
    assert result is not None


def test_a_case_captured_twice_reports_its_strongest_FIRING_capture_and_ignores_one_that_did_not_fire():
    ev = load()
    # Three captures of one case. Capture 0 fired at 0.91, capture 1 fired at 0.97, capture 2 scored 0.99 but the
    # applicability gate vetoed it (decided False). The case is a false positive because 0 and 1 fired: the answer to
    # "narrowly or hard" is 0.97, and 0.99 is not a capture that made it a false positive.
    same = [record("flaky", "good")] * 3
    result = fp_scores(ev, records=same, decided=[True, True, False], labels=[False, False, False],
                       scores={HEAD: [0.91, 0.97, 0.99]})
    assert result == {"flaky/good": {HEAD: 0.97}}


def test_a_head_that_only_a_later_capture_scored_is_still_reported():
    ev = load()
    same = [record("flaky", "good")] * 2
    result = fp_scores(ev, records=same, decided=[True, True], labels=[False, False],
                       scores={HEAD: [0.60, 0.70], OTHER_HEAD: [0.20, 0.10]})
    assert result == {"flaky/good": {HEAD: 0.7, OTHER_HEAD: 0.2}}


def failing_block(**extra) -> dict:
    return {
        "falsePositive": 2,
        "falsePositiveCases": ["icon-help/bad", "icon-help/good"],
        "falsePositiveSubtypeScores": {
            "icon-help/bad": {HEAD: 0.87, OTHER_HEAD: 0.2},
            "icon-help/good": {HEAD: 0.98, OTHER_HEAD: 0.1},
        },
        "falsePositivesBySubtype": {HEAD: ["icon-help/bad", "icon-help/good"]},
        "subtypeThresholds": {HEAD: 0.605, OTHER_HEAD: 0.9},
        **extra,
    }


def test_the_failure_line_names_the_head_that_fired_its_score_and_its_own_cut():
    ev = load()
    line = ev.false_positive_reason("2.4.6", failing_block())
    assert line == (
        "2.4.6: 2 acceptance false positive(s): icon-help/bad [2.4.6:regex 0.870 vs cut 0.605], "
        "icon-help/good [2.4.6:regex 0.980 vs cut 0.605]"), line
    assert "@" not in line and "1.000" not in line, "the criterion's binary decision must not be printed as a score"
    assert OTHER_HEAD not in line, "a head that did not fire is not named as the reason the criterion did"


def test_two_heads_that_both_fired_are_both_named_with_their_own_cuts():
    ev = load()
    block = failing_block(falsePositivesBySubtype={HEAD: ["icon-help/good"], OTHER_HEAD: ["icon-help/good"]},
                          falsePositiveCases=["icon-help/good"], falsePositive=1)
    line = ev.describe_false_positive("icon-help/good", block)
    assert line == "icon-help/good [2.4.6:generic 0.100 vs cut 0.900] [2.4.6:regex 0.980 vs cut 0.605]", line


def test_a_repeated_case_name_is_listed_once():
    # `metrics` names a record per capture, so a case captured twice appears twice in `falsePositiveCases`.
    ev = load()
    block = failing_block(falsePositiveCases=["icon-help/good", "icon-help/good"], falsePositive=2)
    assert ev.false_positive_reason("2.4.6", block).count("icon-help/good") == 1


def test_a_report_without_the_new_fields_still_names_the_case_and_does_not_crash():
    # An older report, or a block built by hand: a failure reason exists to explain a failure and must not become one.
    ev = load()
    assert ev.describe_false_positive("old/good", {"falsePositiveCases": ["old/good"]}) == "old/good"


def test_the_acceptance_block_no_longer_carries_the_criterions_decision_dressed_as_a_score():
    ev = load()
    block = ev.metrics(np.array([1.0, 0.0]), np.array([False, True]), 0.5, identities=["fp/good", "fn/bad"])
    # CONTROL: `metrics` itself still writes them, for a caller that holds real scores.
    assert block["falsePositiveScores"] == {"fp/good": 1.0} and block["falseNegativeScores"] == {"fn/bad": 0.0}
    reported = ev.without_binary_criterion_scores(block)
    assert "falsePositiveScores" not in reported and "falseNegativeScores" not in reported
    assert reported["falsePositiveCases"] == ["fp/good"] and reported["falseNegativeCases"] == ["fn/bad"]
    assert reported["threshold"] == 0.5
