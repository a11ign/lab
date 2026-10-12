"""A test-grade dataset can never produce a releasable model.

Test grade exists so a question can be answered without a four-hour recapture: it accepts captures whose
page has moved, because "did my change move the number?" needs the cases I CHANGED to be current and the
rest to be present at all. A veto, a starvation count and a signal check are all computed per subtype, so
untouched subtypes contribute the same answer either way.

That is a sound way to test and a catastrophic way to ship. Measured 2026-08-26: a corpus change left
1,082 of 1,401 pairs stale, an export dropped them, and a retrain would have used 319 pairs — a worse
model that every gate scores as if it were whole. Test grade makes that dataset usable AND makes the
model it produces structurally unpromotable.

Three independent gates, and this asserts the first two:

  1. The trainer sets `releaseEligible` False at INITIALISATION, before any gate can set it True. An
     eligibility that starts True and is cleared later is one a later branch can quietly restore.
  2. It says WHY, in `releaseBlockedBy`, so the refusal is readable rather than a bare False.
  3. `promote-model.mjs` refuses a model that is not release-eligible — covered by promote-model.test.ts.
"""
import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "train-screenreader-model.py"


def trainer():
    spec = importlib.util.spec_from_file_location("trainer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["trainer"] = module
    spec.loader.exec_module(module)
    return module


def test_any_test_graded_record_makes_the_whole_dataset_test_grade():
    """ANY, not all — one stale pair must not ride into a promoted model.

    Taking the majority, or the first record, would let a single mismatched capture through, and the
    reason the grade exists is precisely that some evidence does not describe its labelled page.
    """
    grade = trainer().dataset_grade
    clean = [{"provenance": {"caseId": "a"}}, {"provenance": {"caseId": "b"}}]
    assert grade(clean) == "release"
    assert grade([]) == "release", "an empty dataset is not test grade; it is a different problem"

    one_bad = [{"provenance": {"caseId": "a"}}, {"provenance": {"caseId": "b", "grade": "test"}}]
    assert grade(one_bad) == "test", "one test-graded record must taint the dataset"
    assert grade(one_bad[::-1]) == "test", "order must not matter"


def test_the_grade_is_read_from_the_records_not_from_a_flag():
    """A grade beside the data is a grade that gets separated from it.

    The stamp is per record, so a dataset cannot arrive at a trainer somebody pointed at it by hand
    having lost its grade in transit — which a summary file or an environment variable would allow.
    """
    grade = trainer().dataset_grade
    assert grade([{"provenance": {"grade": "test"}}]) == "test"
    # Not a top-level key, not a filename convention: provenance, where the rest of the record's identity
    # already lives.
    assert grade([{"grade": "test", "provenance": {}}]) == "release", (
        "a top-level grade is not the contract — it must sit in provenance with the record's identity"
    )
