"""The evaluator must REFUSE records whose case definitions the code does not have (#2094).

The capture path has checked this since #958 and the evaluator never did. Measured on the lab
2026-09-23: `runs/screenreader-acceptance/repeat-1.jsonl` held 436 records of which **290 named
`acceptance-b3-*` cases that exist on no branch reachable from `main`** — introduced by `22af7eeb3`,
which never had a pull request. `training:capture` refused the moment a capture was attempted against
that manifest; `job=acceptance` scored the stored records of those same cases and reported a number.
Two rows closed on numbers derived that way (#1852's 436-record floor, #37's 0.873% Wilson bound), and
neither is reproducible from this repository — which is the one property a held-out number exists to have.

**The positive control is the first test below**, and it is named as one: a fixture where a single record
names a case the set does not define, asserting the refusal NAMES that id. Without it the two tests that
assert a clean set passes would both hold against a guard that never fires, which is precisely the
failure being fixed — a check that cannot see the thing it is for.

`defined_case_ids()` is exercised separately and for its own reason: it shells out to node, and a
silently empty result would make every record unknown and fire this refusal over the whole corpus. That
reads as a corpus defect when the fault is that node did not run.

**UPDATE, #2100 (2026-09-23): those 146 pairs are now DEFINED, landed through the reviewed pull request
they never had.** The history above stands exactly as written — it is why this guard exists — but two
things about this file changed with it, and both are the kind of thing that rots quietly:

* **The absence pin became a PRESENCE pin.** `test_the_146_reviewed_held_out_pairs_are_defined` used to
  assert `b3 == []` so that landing these pairs had to be deliberate. It was, so the pin flips rather
  than being deleted: a silent SHRINK of the held-out set is the same defect from the other side.
* **A fixture id must not name a case the project intends to create.** Every "does not exist" fixture
  here named a real `acceptance-b3-*` id, and landing the pairs turned the integration test's unknown
  case into a known one — the test went green-by-absence-of-refusal and had to be repaired in the same
  pull request that broke it. They are `acceptance-sentinel-*` now: ids nothing will ever define, so
  what they stand for cannot be falsified by a later corpus change.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

EVALUATOR = Path(__file__).resolve().parents[1] / "scripts" / "evaluate-screenreader-acceptance.py"

_spec = importlib.util.spec_from_file_location("evaluate_screenreader_acceptance", EVALUATOR)
evaluator = importlib.util.module_from_spec(_spec)
sys.modules["evaluate_screenreader_acceptance"] = evaluator
_spec.loader.exec_module(evaluator)

# The SAME module `main()` loads, so the integration tests below read their fixtures through the real
# `read_records` — its input contract, its forbidden-key check and its grouping-family refusal included.
training = evaluator.load_training_module()

DEFINED = {"acceptance-generic-lantern", "acceptance-filename-orchard"}


def record(case_id, variant="bad"):
    return {"provenance": {"caseId": case_id, "variant": variant}, "target": {"criteria": []}}


KNOWN = [record("acceptance-generic-lantern"), record("acceptance-filename-orchard")]
UNKNOWN = record("acceptance-sentinel-badge")


def test_a_record_naming_an_undefined_case_is_named_in_the_refusal():
    """THE POSITIVE CONTROL. One unknown id among known ones, and the refusal must say which."""
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist({"repeat-1.jsonl": KNOWN + [UNKNOWN]}, DEFINED)
    message = str(refusal.value)
    assert "acceptance-sentinel-badge" in message, (
        f"the refusal must name the case that does not exist, or it cannot be acted on: {message}")
    assert "repeat-1.jsonl" in message, "and which file the records came from"
    assert "1 of 3 records" in message, f"and how much of that file it is: {message}"


def test_a_set_whose_cases_all_exist_is_scored():
    evaluator.assert_cases_exist({"repeat-1.jsonl": KNOWN}, DEFINED)


def test_the_count_is_per_file_and_not_summed_across_repeats():
    """A held-out floor and a Wilson bound are both stated at the size of ONE repeat.

    `resolution()` in the evaluator takes `min(record_counts)` for exactly this reason: two repeats of
    436 are 436 independent observations, not 872. A refusal that reported 580 would be a count of
    nothing any reader compares anything against.
    """
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist(
            {"repeat-1.jsonl": KNOWN + [UNKNOWN], "repeat-2.jsonl": KNOWN + [UNKNOWN]}, DEFINED)
    message = str(refusal.value)
    assert "1 of 3 records" in message and "2 of 6" not in message, (
        f"each repeat is counted on its own: {message}")
    assert message.count("repeat-") >= 2, f"and both are named: {message}"


def test_a_record_with_no_case_id_is_a_finding_and_not_a_skip():
    """Unattributable is the same failure from the reader's side, and skipping it is the subset-scoring
    this guard refuses."""
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist({"repeat-1.jsonl": KNOWN + [{"provenance": {}}]}, DEFINED)
    assert evaluator.NO_CASE_ID in str(refusal.value)


def test_a_null_provenance_is_reported_and_not_a_traceback():
    """`"provenance": null` is a DIFFERENT shape from an absent key, and a default covers only the second.

    THIS TESTS THE HELPER IN ISOLATION, and saying so is the point: `reviewer-2` showed on #2098 that a
    record shaped this way never reaches here through `main()` at all — `training.read_records` refuses
    the whole file first. So this pins the helper for its direct callers, and
    `test_the_loader_refuses_a_null_provenance_by_name_before_the_guard_is_reached` below pins what the
    real chain does. A test that proved only this one would have claimed an end-to-end property the code
    does not have.
    """
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist({"repeat-1.jsonl": KNOWN + [{"provenance": None}]}, DEFINED)
    assert evaluator.NO_CASE_ID in str(refusal.value)


# A record that satisfies `read_records`' whole input contract, so the tests below exercise the REAL
# loading path rather than a shape it would have rejected for some unrelated reason.
def stored_record(case_id, family="acceptance-orchard", provenance=...):
    record = {
        "input": {"inputVersion": 2, "evidenceText": "Orchard map, graphic",
                  "evidenceUnits": [{"channel": "browse", "text": "Orchard map, graphic"}]},
        "target": {"label": "violation", "subtypes": ["1.1.1:filename-alt"], "criteria": ["1.1.1"]},
    }
    record["provenance"] = ({"caseId": case_id, "variant": "bad", "family": family}
                            if provenance is ... else provenance)
    return record


def write_jsonl(directory, name, records):
    path = directory / name
    path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
    return path


def test_the_chain_refuses_an_unknown_case_through_the_real_loader(tmp_path):
    """THE INTEGRATION PATH, not the helper: read the file the way `main()` does, then guard it.

    `reviewer-2`'s blocker on #2098 was that the unit tests above all call `assert_cases_exist` directly,
    so none of them proves the records ever arrive there in the shape they assume. This one goes through
    `load_records_by_path` — the same `training.read_records` the evaluator uses, contract checks and all
    — and is the test that would fail if the guard were wired in at the wrong point in `main()`.
    """
    data = write_jsonl(tmp_path, "repeat-1.jsonl",
                       [stored_record("acceptance-filename-orchard"),
                        stored_record("acceptance-sentinel-badge", family="acceptance-sentinel-badge")])
    by_path = evaluator.load_records_by_path(training, [data])
    assert sum(len(records) for records in by_path.values()) == 2, "the loader accepted both records"
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist(by_path, evaluator.defined_case_ids())
    message = str(refusal.value)
    assert "acceptance-sentinel-badge" in message and "1 of 2 records" in message, message
    assert "acceptance-filename-orchard" not in message, (
        f"the case that DOES exist must not be named — that is the difference between checking and "
        f"counting: {message}")


def test_the_loader_refuses_a_null_provenance_by_name_before_the_guard_is_reached(tmp_path):
    """What a null provenance ACTUALLY does to the chain, which is not what the helper test implies.

    `read_records` already meant to refuse a record with no grouping family and said so by name; with a
    plain `get("provenance", {})` default it raised `AttributeError: 'NoneType' object has no attribute
    'get'` instead — the same refusal wearing a crash, from the one load point every reader shares. Fixed
    there rather than worked around here, because guarding at the call site is the "fix applied at one
    call site" that `read_records`' own comment says has cost this repo four separate defects.
    """
    data = write_jsonl(tmp_path, "repeat-1.jsonl", [stored_record("acceptance-filename-orchard"),
                                                    stored_record("x", provenance=None)])
    with pytest.raises(RuntimeError) as refusal:
        evaluator.load_records_by_path(training, [data])
    assert "no grouping family" in str(refusal.value), str(refusal.value)


def test_unknown_ids_are_counted_per_id():
    """The predicate itself: id -> how many records name it, so a refusal can say whether one case
    drifted or a whole family did."""
    counts = evaluator.unknown_case_ids(KNOWN + [UNKNOWN, UNKNOWN, record("acceptance-sentinel-taxi")],
                                        DEFINED)
    assert counts == {"acceptance-sentinel-badge": 2, "acceptance-sentinel-taxi": 1}


def test_many_unknown_ids_are_truncated_with_the_remainder_stated():
    """Bounded, and the bound is stated — a refusal nobody reads is its own kind of silence."""
    extra = evaluator.NAMED_UNKNOWN_CASES + 3
    with pytest.raises(SystemExit) as refusal:
        evaluator.assert_cases_exist(
            {"repeat-1.jsonl": [record(f"acceptance-sentinel-{n}") for n in range(extra)]}, DEFINED)
    message = str(refusal.value)
    assert f"... and {extra - evaluator.NAMED_UNKNOWN_CASES} more" in message, message


def test_the_defined_set_is_read_from_the_javascript_that_declares_it():
    """The premise, stated as an assertion — the shape `test_grants_map_is_current.py` records.

    If `defined_case_ids` ever returned an empty or tiny set (a renamed export, a moved file), the guard
    would fire over the entire corpus and read as a corpus defect. It refuses loudly instead, and this
    pins that it is reading the real set rather than something that happens not to be empty.
    """
    defined = evaluator.defined_case_ids()
    assert len(defined) >= 50, f"expected the full acceptance set, got {len(defined)}: {sorted(defined)}"
    assert all(case_id.startswith("acceptance-") for case_id in defined), sorted(defined)[:5]


def test_the_146_reviewed_held_out_pairs_are_defined():
    """The 146 pairs are defined HERE, and a silent SHRINK is #2094 from the other direction.

    THIS TEST WAS AN ABSENCE PIN AND ITS OWN INSTRUCTION WAS TO DELETE IT. Until #2100 it asserted
    `b3 == []`, deliberately, so that landing these pairs could not happen by accident — *"that is the
    review this corpus growth never got"*. #2100 is that review, so the condition is spent and the test
    could have gone. **It flips instead, because the mirror failure is live and nothing else would catch
    it:** if these ids are ever removed, `ALL_ACCEPTANCE_CASES` returns to 83, the held-out set returns to
    146 records at a ~2.6% Wilson bound, and **every stored capture in `runs/screenreader-acceptance/`
    still names them** — so `job=acceptance` starts refusing 290 records per repeat again and reads as a
    corpus defect rather than as a deletion. That is the exact shape #2094 was filed on, and the sign of
    the change is the only difference.

    Deleting it and pinning the count in `acceptance-matrix.test.ts` instead would be equivalent and is
    not better: the reason the number matters is what the EVALUATOR does when the definitions and the
    stored records disagree, which is this file's subject.
    """
    defined = evaluator.defined_case_ids()
    b3 = sorted(case_id for case_id in defined if case_id.startswith("acceptance-b3-"))
    assert len(b3) == 146, (
        f"expected the 146 held-out pairs #2100 landed, got {len(b3)}. If pairs were added or removed "
        "deliberately, update this count in the same commit and say what it does to #1852's floor (>= 381 "
        f"records at `main`); if they vanished any other way, the stored captures still name them: {b3[:5]}")
