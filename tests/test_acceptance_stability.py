"""Capture-to-capture stability asks whether a head DECIDED the same way twice, not whether its score did.

`stability()` compared raw head scores against the cut while the criterion metrics in the same file compared
`applicability.decide` -- the second copy of the predicate that function's docstring says existed once
already. Measured 2026-09-22 for #1921 on `acceptance-b3-button-market/bad`: repeat-1 read the submit's
navigation, repeat-2 got `afterUnresolved` on its only form change, `_no_unread_activation` made
`3.3.1:validation-error-silent` inapplicable there, and the product said "no finding" on both captures. The
gate still read 0.075 and 0.485 against a 0.452 cut as a head that flips, and failed (#1927).

Driven through the real `applicability.decide` -- a test that restated the gate here would prove nothing
about the one the evaluator calls.
"""
import importlib.util
import sys
from pathlib import Path

EVALUATOR = Path(__file__).resolve().parents[1] / "scripts" / "evaluate-screenreader-acceptance.py"

_spec = importlib.util.spec_from_file_location("evaluate_screenreader_acceptance", EVALUATOR)
evaluator = importlib.util.module_from_spec(_spec)
sys.modules["evaluate_screenreader_acceptance"] = evaluator
_spec.loader.exec_module(evaluator)

SUBTYPE = "3.3.1:validation-error-silent"
CUT = 0.452


def capture(form_change: dict) -> dict:
    """One capture of the same page, applicable to `SUBTYPE` unless `form_change` went unread."""
    return {
        "provenance": {"caseId": "acceptance-b3-button-market", "variant": "bad"},
        "input": {
            "structure": {"formFields": ["Pitch name, edit"]},
            "interaction": {
                "postSubmitFields": ["Pitch name, edit"],
                "formChanges": [form_change],
            },
        },
    }


READ = capture({"control": "Save changes, button", "after": "Market pitch list, document"})
UNREAD = capture({"control": "Save changes, button", "after": "unknown", "afterUnresolved": True})


def test_the_premise_the_unread_capture_is_inapplicable_and_the_read_one_is_not():
    """Without this, the first test below would pass for any reason the gate happened to refuse."""
    assert evaluator.applicability.applicable(SUBTYPE, READ) is True
    assert evaluator.applicability.applicable(SUBTYPE, UNREAD) is False


def test_an_inapplicable_capture_above_the_cut_agrees_with_a_capture_below_it():
    result = evaluator.stability(SUBTYPE, [0.075, 0.485], [READ, UNREAD], CUT)

    assert result["repeatedGroups"] == 1
    assert result["unstableGroups"] == 0
    assert result["passed"] is True
    details = result["details"]["acceptance-b3-button-market/bad"]
    # The raw range survives as a diagnostic: the head DID move, and that is still worth seeing.
    assert (details["scoreMinimum"], details["scoreMaximum"]) == (0.075, 0.485)
    assert details["fired"] == 0


def test_the_positive_control_two_applicable_captures_either_side_of_the_cut_are_unstable():
    result = evaluator.stability(SUBTYPE, [0.075, 0.485], [READ, READ], CUT)

    assert result["repeatedGroups"] == 1
    assert result["unstableGroups"] == 1
    assert result["passed"] is False
    assert result["details"]["acceptance-b3-button-market/bad"]["fired"] == 1
