"""The acceptance report states what its own inputs were captured under (#1918).

#1918's fix lands in two halves that meet nowhere in the evaluator: `formChanges[].submitted` is written
at CAPTURE time (`CAPTURE_PROTOCOL_VERSION` 21) and `_is_submit` reads it at SCORING time. So running
`job=acceptance` over an export taken before the recapture reproduces the row's four false negatives on a
codebase where the defect is already fixed -- and reads as "the fix did not work".

The row is explicit that this is **UNMET, not failed**, and equally explicit about how to tell: *"Read it
off the artefact, not off the operator: every evaluated record's `provenance.environment.captureProtocol`
reads 21."* Nothing in the report held that fact, so the only way to read it was by hand, over ssh, with a
script pasted into a row body -- the form this repository loses. It is a field now, which is what makes
the row's precondition a `jq` an Acceptance can declare:

    npm run lab:fetch -- -e artifact=acceptance-report
    jq -e 'all(.data[]; .captureProtocols == {"21": .records})' \
       runs/fetched/candidate.acceptance-report.json

**The positive control is `test_a_stale_export_is_visible_in_the_census`**, and it is named as one: a
fixture whose records carry protocol 20 and no protocol at all, asserting the census SAYS so. Without it
every assertion here would hold against a census that reported `{"21": n}` unconditionally -- a field that
cannot express the finding it exists for, which is the defect one level up from the one being fixed.

A CENSUS AND NOT A FLOOR: which protocol a reading requires belongs to the question, not to the evaluator.
`test_the_census_does_not_refuse_a_stale_export` pins that, because a later reader looking at the refusal
family this file sits beside would reasonably expect one here.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

EVALUATOR = Path(__file__).resolve().parents[1] / "scripts" / "evaluate-screenreader-acceptance.py"


def load():
    spec = importlib.util.spec_from_file_location("acceptance_evaluator_protocol", EVALUATOR)
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator_protocol"] = module
    spec.loader.exec_module(module)
    return module


evaluator = load()


def record(protocol="unset"):
    """A record carrying `protocol`. `"unset"` omits the key; `None` writes a JSON null for it.

    Both spellings exist in the corpus and they are NOT the same record: an export written before
    `export-screenreader-dataset.mjs` began stamping has no key at all, and one written after it against a
    worker that did not report the field has `captureProtocol: null` (`worker.captureProtocol ?? null`).
    A census that sees only one of them would read a stale file as fully protocol-21.
    """
    environment = {} if protocol == "unset" else {"captureProtocol": protocol}
    return {"provenance": {"caseId": "acceptance-sentinel-berth", "environment": environment}}


def census(*records):
    return evaluator.capture_protocol_census(list(records))


def test_a_stale_export_is_visible_in_the_census():
    # THE POSITIVE CONTROL. Delete `captureProtocol` from the census and this is the assertion that fails.
    assert census(record(20), record(20), record(21)) == {"20": 2, "21": 1}


def test_an_absent_protocol_is_counted_under_its_own_name_not_dropped():
    # 3,742 of 3,742 records carried no protocol before the stamp landed on 2026-09-22. Dropping them
    # would make a wholly unstamped export read as an EMPTY census rather than as a stale one, and an
    # Acceptance comparing the census against the record count would then pass on it by comparing nothing.
    assert census(record(), record(), record(21)) == {evaluator.ABSENT_PROTOCOL: 2, "21": 1}


def test_an_explicit_null_protocol_counts_as_absent_not_as_its_own_protocol():
    # `export-screenreader-dataset.mjs:171` writes `worker.captureProtocol ?? null`, so a null is what a
    # worker that did not report the field produces. It means the same thing as the missing key and must
    # not mint a third bucket -- `{"None": 1}` would satisfy neither an equality nor a "21 only" test.
    assert census(record(None), record()) == {evaluator.ABSENT_PROTOCOL: 2}


def test_the_protocol_is_keyed_as_a_string_so_the_census_survives_json():
    # The census reaches its reader through `json.dumps`, which stringifies integer keys on the way out
    # but not on the way in. Keying on the int would make the in-process value and the value a `jq`
    # reads disagree -- and the `jq` is the one an Acceptance declares.
    assert list(census(record(21))) == ["21"]
    assert census(record("21")) == census(record(21))


def test_the_census_is_per_file_and_reaches_the_report_beside_the_record_count():
    report = evaluator.report_skeleton(
        {
            "runs/screenreader-acceptance/repeat-1.jsonl": [record(21)] * 436,
            # The mixed export is the interesting one: it says exactly which half is stale rather than
            # collapsing to a single verdict for the run.
            "runs/screenreader-acceptance/repeat-2.jsonl": [record(21)] * 290 + [record(20)] * 146,
        },
        artifact={},
        diagnostic=False,
    )
    assert [entry["captureProtocols"] for entry in report["data"]] == [{"21": 436}, {"21": 290, "20": 146}]
    # Beside the count, and covering all of it: this is the pair #1918's Acceptance compares.
    assert all(sum(entry["captureProtocols"].values()) == entry["records"] for entry in report["data"])


def test_the_jq_1918_declares_separates_a_recaptured_set_from_a_stale_one():
    """The Acceptance's own predicate, run in Python over both populations.

    Asserted here rather than left to the row's prose because the row is where this check kept being
    written down and lost. `all(.data[]; .captureProtocols == {"21": .records})`.
    """
    def recaptured(report):
        return all(entry["captureProtocols"] == {"21": entry["records"]} for entry in report["data"])

    def skeleton(*files):
        return evaluator.report_skeleton(
            {f"repeat-{i}.jsonl": records for i, records in enumerate(files, 1)},
            artifact={}, diagnostic=False)

    assert recaptured(skeleton([record(21)] * 436, [record(21)] * 436))
    # UNMET, not failed: the export the row warns about, where every criterion reading is about the
    # corpus rather than about the fix.
    assert not recaptured(skeleton([record(21)] * 436, [record(20)] * 436))
    assert not recaptured(skeleton([record()] * 436, [record()] * 436))
    # One stale record in 436 is still not a protocol-21 reading, and the predicate has to say so.
    assert not recaptured(skeleton([record(21)] * 435 + [record(20)], [record(21)] * 436))


def test_the_census_does_not_refuse_a_stale_export():
    # This file sits beside a family of hard refusals (`assert_cases_exist`, `assert_case_definitions_
    # unchanged`), so the absence of one here is deliberate and pinned. Which protocol a reading requires
    # is the question's to state; an evaluator-side floor would refuse every reading legitimately taken
    # at an older protocol, including the shipped baseline's.
    assert census(record(4), record(17)) == {"4": 1, "17": 1}


@pytest.mark.parametrize("broken", [{"provenance": None}, {"provenance": {"environment": None}}, {}])
def test_a_record_with_no_provenance_at_all_is_counted_rather_than_crashing(broken):
    # This runs over every evaluated record before anything is scored, so a traceback here would replace
    # a report with a stack trace on the very record it is for -- `unknown_case_ids`' own reason for
    # `or {}` rather than a default.
    assert census(broken) == {evaluator.ABSENT_PROTOCOL: 1}
