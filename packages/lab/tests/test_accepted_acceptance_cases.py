"""The acceptance gate reads the ACCEPTED false-positive and miss set, and removes exactly that set from what fails (#2532).

`ceo` ruled on #2258 (2026-09-25) that two false positives and nine misses under the `4.1.3` status heads are ACCEPTED, and
enumerated them in `docs/known-gaps.md` section 53. The evaluator decides `passed` and had no place to read that ruling, so a
candidate `ceo` had already accepted read `passed: false` for good, `promote:gated` refused it, and the schema migration it
gates could not close.

WHAT THIS PINS IS THE SCOPE, NOT THE PASS. A list that accepted everything would satisfy every "accepted cases pass" assertion,
so the controls that carry the weight are the ones where something OUTSIDE the list still fails, and each names the case:
a tenth miss, a third false positive, the same case id under a DIFFERENT subtype, and an accepted case id on a different
criterion. `ceo` named the three-field key (case id + criterion + subtype) non-negotiable, because an id-only key accepts a
different failure on the same page.

The evaluator is imported by path and driven with small fixtures: `main` needs a model and a corpus, so the decision is a pure
function (`accepted_cases_reading`, `failure_reasons_after_accepting`) and this is what reaches it.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "acceptance_evaluator_accepted", ROOT / "packages/lab/scripts/evaluate-screenreader-acceptance.py")
evaluator = importlib.util.module_from_spec(_spec)
sys.modules["acceptance_evaluator_accepted"] = evaluator
_spec.loader.exec_module(evaluator)

PROGRESS = "4.1.3:status-progress"
WAITING = "4.1.3:status-waiting"
SILENT = "4.1.3:form-activation-silent"
HEADS = {PROGRESS: {"threshold": 0.8744}, WAITING: {"threshold": 0.9201}, SILENT: {"threshold": 0.9639},
         "1.1.1:missing-alt": {"threshold": 0.5}, "2.4.6:regex": {"threshold": 0.605}}

# The real ids, so the fixture cannot drift into a shape the row does not describe.
ACCEPTED_FP = "acceptance-b3-icon-print/good"
ACCEPTED_MISS = "acceptance-b3-status-waiting-badge/bad"


def record(case: str, criteria: list[str], subtypes: list[str]) -> dict:
    case_id, variant = case.rsplit("/", 1)
    return {"provenance": {"caseId": case_id, "variant": variant},
            "target": {"criteria": criteria, "subtypes": subtypes}}


def read(criterion: str, captures: list[tuple[str, list[str], list[str], set[str]]], accepted=None):
    """`(case, criteria, subtypes, heads that FIRED)` per capture -> `(report fields, failing, reasons)`.

    `decided` is the OR of the heads, and the label is "this record is labelled for the criterion", exactly the two
    facts `main` derives, so the fixture cannot describe a state the evaluator cannot reach.
    """
    accepted = evaluator.load_accepted_cases() if accepted is None else accepted
    records = [record(case, criteria, subtypes) for case, criteria, subtypes, _ in captures]
    fired = {subtype: np.array([subtype in heads for *_, heads in captures], dtype=bool) for subtype in HEADS}
    decided = np.array([bool(heads) for *_, heads in captures], dtype=bool)
    labels = np.array([criterion in criteria for _, criteria, _, _ in captures], dtype=bool)
    indices = list(range(len(records)))
    fields, failing = evaluator.accepted_cases_reading(
        criterion, records, indices, labels, decided, fired, HEADS, accepted)
    block = {"falsePositive": int((decided & ~labels).sum()), "falseNegative": int((~decided & labels).sum())}
    return fields, failing, evaluator.failure_reasons_after_accepting(criterion, block, failing)


def accepted_false_positive(repeat: int = 2):
    return [(ACCEPTED_FP, ["4.1.2"], ["4.1.2:unnamed-control"], {PROGRESS})] * repeat


def accepted_miss(case: str = ACCEPTED_MISS, subtype: str = WAITING, repeat: int = 2):
    return [(case, ["4.1.3"], [subtype], set())] * repeat


def test_the_shipped_list_is_the_two_false_positives_and_nine_misses_of_section_53():
    accepted = evaluator.load_accepted_cases()
    assert len(accepted["falsePositives"]) == 2
    assert len(accepted["misses"]) == 9
    for key in accepted["falsePositives"] | accepted["misses"]:
        case, criterion, subtype = key
        assert criterion == "4.1.3" and subtype in evaluator.ACCEPTABLE_SUBTYPES, key
    assert (ACCEPTED_FP, "4.1.3", PROGRESS) in accepted["falsePositives"]
    assert (ACCEPTED_MISS, "4.1.3", WAITING) in accepted["misses"]


def test_exactly_the_accepted_cases_leave_nothing_to_fail_and_are_RECORDED():
    fields, failing, reasons = read("4.1.3", accepted_false_positive() + accepted_miss())
    assert reasons == [], "an accepted case must not appear in failureReasons"
    assert failing["falsePositive"] == 0 and failing["falseNegative"] == 0
    # passed: true must never hide that a ruling was applied
    assert fields["acceptedFalsePositives"] == [ACCEPTED_FP]
    assert fields["acceptedMisses"] == [ACCEPTED_MISS]


def test_every_one_of_the_eleven_shipped_cases_reads_accepted_at_its_own_key():
    """A list that parsed and matched nothing would leave the test above green on the two it happens to use."""
    accepted = evaluator.load_accepted_cases()
    captures = [(case, ["4.1.2"], ["4.1.2:unnamed-control"], {subtype})
                for case, _, subtype in accepted["falsePositives"]]
    captures += [(case, ["4.1.3"], [subtype], set()) for case, _, subtype in accepted["misses"]]
    fields, failing, reasons = read("4.1.3", captures)
    assert reasons == []
    assert len(fields["acceptedFalsePositives"]) == 2 and len(fields["acceptedMisses"]) == 9


def test_a_TENTH_miss_still_fails_and_names_the_case_beside_the_nine():
    accepted = evaluator.load_accepted_cases()
    nine = [(case, ["4.1.3"], [subtype], set()) for case, _, subtype in accepted["misses"]]
    # sorts LAST, so a list capped at MAX_NAMED_FAILURES before the subtraction would lose it
    tenth = ("zz-a-status-page-nobody-accepted/bad", ["4.1.3"], [WAITING], set())
    fields, failing, reasons = read("4.1.3", nine + [tenth])
    assert failing["falseNegative"] == 1
    assert failing["falseNegativeCases"] == ["zz-a-status-page-nobody-accepted/bad"]
    assert len(reasons) == 1 and "zz-a-status-page-nobody-accepted/bad" in reasons[0]
    assert len(fields["acceptedMisses"]) == 9, "the nine stay recorded beside the failure"


def test_a_THIRD_false_positive_still_fails_and_names_the_case():
    third = ("acceptance-b3-icon-help/good", ["4.1.2"], ["4.1.2:unnamed-control"], {PROGRESS})
    fields, failing, reasons = read("4.1.3", accepted_false_positive() + [third] * 2)
    assert failing["falsePositive"] == 2
    assert failing["falsePositiveCases"] == ["acceptance-b3-icon-help/good"]
    assert len(reasons) == 1 and "acceptance-b3-icon-help/good" in reasons[0]
    assert fields["acceptedFalsePositives"] == [ACCEPTED_FP]


def test_the_SAME_false_positive_under_a_DIFFERENT_head_still_fails():
    """`ceo`'s condition 1: an id-only key accepts a different failure on the same page."""
    fields, failing, reasons = read(
        "4.1.3", [(ACCEPTED_FP, ["4.1.2"], ["4.1.2:unnamed-control"], {SILENT})] * 2)
    assert failing["falsePositiveCases"] == [ACCEPTED_FP]
    assert reasons and ACCEPTED_FP in reasons[0]
    assert fields["acceptedFalsePositives"] == []


def test_a_page_that_fires_the_accepted_head_AND_another_still_fails():
    fields, failing, reasons = read(
        "4.1.3", [(ACCEPTED_FP, ["4.1.2"], ["4.1.2:unnamed-control"], {PROGRESS, SILENT})] * 2)
    assert failing["falsePositiveCases"] == [ACCEPTED_FP]
    assert fields["acceptedFalsePositives"] == []


def test_the_SAME_miss_labelled_for_a_DIFFERENT_head_still_fails():
    fields, failing, reasons = read("4.1.3", accepted_miss(subtype=SILENT))
    assert failing["falseNegativeCases"] == [ACCEPTED_MISS]
    assert reasons and ACCEPTED_MISS in reasons[0]
    assert fields["acceptedMisses"] == []


def test_an_accepted_case_id_on_a_DIFFERENT_criterion_still_fails():
    """Both directions: the accepted false positive charged to another criterion, and the accepted miss likewise."""
    for capture in (
        (ACCEPTED_FP, ["4.1.2"], ["4.1.2:unnamed-control"], {"1.1.1:missing-alt"}),
        (ACCEPTED_MISS, ["2.4.6"], ["2.4.6:regex"], set()),
    ):
        criterion = "1.1.1" if capture[0] == ACCEPTED_FP else "2.4.6"
        fields, failing, reasons = read(criterion, [capture] * 2)
        named = failing["falsePositiveCases"] + failing["falseNegativeCases"]
        assert named == [capture[0]], (criterion, failing)
        assert reasons and capture[0] in reasons[0]
        assert fields["acceptedFalsePositives"] == fields["acceptedMisses"] == []


def test_the_criterion_is_a_field_of_the_key_and_not_only_implied_by_the_subtype_prefix():
    """The same case AND the same head, charged to another criterion: only the criterion field can refuse it."""
    for capture in (
        (ACCEPTED_FP, ["1.1.1"], ["1.1.1:missing-alt"], {PROGRESS}),
        (ACCEPTED_MISS, ["4.1.2"], [WAITING], set()),
    ):
        fields, failing, reasons = read("4.1.2", [capture] * 2)
        assert failing["falsePositiveCases"] + failing["falseNegativeCases"] == [capture[0]], failing
        assert reasons and capture[0] in reasons[0]


def test_one_repeat_covered_and_one_not_is_NOT_covered():
    """A case is accepted only when none of its erring captures fails: repeats are not interchangeable."""
    fields, failing, reasons = read("4.1.3", [
        (ACCEPTED_MISS, ["4.1.3"], [WAITING], set()),
        (ACCEPTED_MISS, ["4.1.3"], [SILENT], set()),
    ])
    assert failing["falseNegative"] == 1 and failing["falseNegativeCases"] == [ACCEPTED_MISS]
    assert fields["acceptedMisses"] == []


def test_an_entry_that_no_longer_errs_is_REPORTED_STALE_and_does_not_fail():
    fixed_fp = (ACCEPTED_FP, ["4.1.2"], ["4.1.2:unnamed-control"], set())
    fixed_miss = (ACCEPTED_MISS, ["4.1.3"], [WAITING], {WAITING})
    fields, failing, reasons = read("4.1.3", [fixed_fp] * 2 + [fixed_miss] * 2)
    assert reasons == [], "a stale entry never fails the report"
    stale = {(entry["kind"], entry["case"], entry["subtype"]) for entry in fields["staleAcceptedCases"]}
    assert stale == {("falsePositives", ACCEPTED_FP, PROGRESS), ("misses", ACCEPTED_MISS, WAITING)}
    assert fields["acceptedFalsePositives"] == fields["acceptedMisses"] == []


def test_an_entry_whose_case_was_never_scored_is_not_called_stale():
    """Absent is not fixed: a partial corpus that lacks the case cannot say it scored correctly."""
    fields, _, reasons = read("4.1.3", [("some-unrelated/good", ["4.1.3"], [WAITING], {WAITING})])
    assert fields["staleAcceptedCases"] == []
    assert reasons == [], "a true positive is neither a failure nor an accepted case"
    assert fields["acceptedMisses"] == fields["acceptedFalsePositives"] == []


def test_a_criterion_with_no_accepted_case_reads_exactly_as_it_did_before_the_list():
    """Item 5: nothing else about `passed` moves. The text a reader met, byte for byte, for a case the list does not cover."""
    block = {
        "falsePositive": 2, "falsePositiveCases": ["acceptance-b3-icon-help/good"],
        "falsePositivesBySubtype": {"2.4.6:regex": ["acceptance-b3-icon-help/good"]},
        "falsePositiveSubtypeScores": {"acceptance-b3-icon-help/good": {"2.4.6:regex": 0.98}},
        "subtypeThresholds": {"2.4.6:regex": 0.605},
        "falseNegative": 1, "falseNegativeCases": ["acceptance-b3-heading-taxi/bad"],
        "falseNegativeSubtypeScores": {"acceptance-b3-heading-taxi/bad": {"2.4.6:regex": 0.2}},
    }
    failing = {key: block[key] for key in ("falsePositive", "falsePositiveCases", "falseNegative", "falseNegativeCases")}
    assert evaluator.failure_reasons_after_accepting("2.4.6", block, failing) == [
        evaluator.false_positive_reason("2.4.6", block),
        "2.4.6: 1 acceptance false negative(s): "
        + evaluator.describe_miss("acceptance-b3-heading-taxi/bad", block),
    ]
    assert evaluator.false_positive_reason("2.4.6", block).startswith("2.4.6: 2 acceptance false positive(s): ")


def write_list(tmp_path: Path, mutate) -> Path:
    document = json.loads(evaluator.ACCEPTED_CASES_FILE.read_text(encoding="utf-8"))
    mutate(document)
    path = tmp_path / "accepted.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


@pytest.mark.parametrize("name,mutate", [
    ("another criterion", lambda d: d["misses"][0].update(criterion="2.4.6", subtype="2.4.6:regex")),
    ("a 4.1.3 head that is not a status head", lambda d: d["misses"][0].update(subtype=SILENT)),
    ("an entry twice", lambda d: d["misses"].append(dict(d["misses"][0]))),
    ("an unknown field on an entry", lambda d: d["misses"][0].update(note="x")),
    ("an unknown top-level key", lambda d: d.update(everything=[])),
])
def test_the_loader_REFUSES_a_widened_or_malformed_list(tmp_path, name, mutate):
    with pytest.raises(RuntimeError):
        evaluator.load_accepted_cases(write_list(tmp_path, mutate))


def test_the_loader_REFUSES_a_missing_file_rather_than_accepting_nothing(tmp_path):
    with pytest.raises(RuntimeError, match="missing"):
        evaluator.load_accepted_cases(tmp_path / "absent.json")


def test_the_report_records_which_list_it_was_judged_against():
    accepted = evaluator.load_accepted_cases()
    provenance = evaluator.accepted_cases_provenance(evaluator.ACCEPTED_CASES_FILE, accepted)
    assert provenance["falsePositives"] == 2 and provenance["misses"] == 9
    assert len(provenance["sha256"]) == 64
    assert provenance["source"] == "packages/lab/src/training/accepted-acceptance-cases.json"


def test_main_reads_the_list_and_subtracts_it_before_passed_is_decided():
    """WIRING ONLY. `main` needs a model and a corpus, so no unit reaches it; this pins that the three calls are still there.

    It is a source check, which proves the calls exist and not that they are right: the behaviour is the tests above.
    """
    import inspect
    source = inspect.getsource(evaluator.main)
    for call in ("load_accepted_cases(", "accepted_cases_reading(", "failure_reasons_after_accepting(", "accepted_cases_provenance("):
        assert call in source, f"main no longer calls {call}"
    assert source.index("failure_reasons_after_accepting(") < source.index('result["passed"] = '), (
        "the accepted list must be applied BEFORE `passed` is decided")
