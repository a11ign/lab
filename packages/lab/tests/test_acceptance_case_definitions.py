"""The evaluator must REFUSE records whose case DEFINITION has changed since they were captured (#2129).

#2098 taught it to refuse a record whose case id the code no longer has. It compared ids and nothing
else, so REDEFINING a case while keeping its id stayed invisible: the stored records still name a case
that exists, the counts still come out, and the report grades captures of one page against the labels of
another.

**The corpus records its definitions in two files and neither alone is one.** `manifest.json` carries
every field of the case except the two page bodies; `pages/<id>/{good,bad}.html` carry those, written
byte-for-byte from the case's own `good` and `bad`. `title`, `field` and `submit` reach neither
`provenance` nor the manifest — they exist on disk only inside the rendered HTML — so a guard that read
the manifest alone could not see the very redefinition #1918's control rests on.

**The positive control is the first test below**, and the mutation target is the last: a FROZEN witness of
`acceptance-b2-error-plot`'s manifest fields paired with the REAL current definitions, so that renaming
that case's `submit` in `acceptance-matrix.mjs` turns this file red naming the id and the field. That
pairing is the only shape in which a source mutation can bite — a fixture derived from the code at test
time moves with the code and pins nothing.
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
# `read_records` — its input contract and its grouping-family refusal included.
training = evaluator.load_training_module()


def definition(**overrides):
    """A whole case definition in the shape both sides of the comparison arrive in."""
    base = {
        "id": "acceptance-generic-lantern",
        "family": "acceptance-generic-lantern",
        "criterion": "1.1.1",
        "subtype": "generic-alt",
        "task": "Understand what the lantern image shows.",
        "badSignal": {"type": "generic-alt", "control": "Lantern"},
        "good": "<html><title>Lantern</title></html>",
        "bad": "<html><title>Lantern</title></html>",
    }
    base.update(overrides)
    return base


LANTERN = definition()
CAPTURED = {"acceptance-generic-lantern": LANTERN}
UNCHANGED = {"acceptance-generic-lantern": definition()}


def record(case_id="acceptance-generic-lantern"):
    return {"provenance": {"caseId": case_id, "variant": "bad"}, "target": {"criteria": []}}


def refusal_over(records, captured, current, path="repeat-1.jsonl"):
    with pytest.raises(SystemExit) as refused:
        evaluator.assert_case_definitions_unchanged({path: records}, {path: captured}, current)
    return str(refused.value)


def test_a_redefined_case_is_named_with_the_field_that_changed():
    """THE POSITIVE CONTROL, and it is a REDEFINITION rather than an absence.

    An id-absent fixture would prove nothing here: `assert_cases_exist` catches that one first, so a
    control that passes through the old path says nothing about this one.
    """
    current = {"acceptance-generic-lantern": definition(task="Say what the lantern is for.")}
    message = refusal_over([record()], CAPTURED, current)
    assert "acceptance-generic-lantern" in message, f"the refusal must name the case: {message}"
    assert "task" in message, f"and the field that differs, or it cannot be acted on: {message}"
    assert "Understand what the lantern image shows." in message, (
        f"and what it was captured as, so the reader can tell a rename from a rewrite: {message}")
    assert "Say what the lantern is for." in message, f"and what the code means now: {message}"


def test_a_definition_that_has_not_changed_is_scored():
    evaluator.assert_case_definitions_unchanged(
        {"repeat-1.jsonl": [record()]}, {"repeat-1.jsonl": CAPTURED}, UNCHANGED)


def test_a_changed_page_body_is_drift_even_though_no_manifest_field_moved():
    """THE HALF THE MANIFEST CANNOT SEE, which is the reason this guard reads the page files at all.

    `errorPair`'s `title`, `field` and `submit` are rendered into the HTML and recorded nowhere else. Here
    every manifest-carried field is identical and only the page body differs — exactly what renaming a
    `title` does — and it must still refuse.
    """
    current = {"acceptance-generic-lantern": definition(bad="<html><title>Lamp</title></html>")}
    message = refusal_over([record()], CAPTURED, current)
    assert "bad" in message and "acceptance-generic-lantern" in message, message
    assert "task" not in message, f"only the field that moved is named: {message}"


def test_a_field_the_code_added_and_the_corpus_never_recorded_is_drift():
    """The coverage claim, made self-enforcing instead of written in a comment.

    If a new case field reached neither the manifest nor the page bodies it would escape comparison for
    ever, silently. Treating "present now, absent then" as drift means the day someone adds one, this
    refuses loudly over every case rather than quietly narrowing what it checks.
    """
    current = {"acceptance-generic-lantern": definition(probeTables=True)}
    message = refusal_over([record()], CAPTURED, current)
    assert "probeTables" in message, message


def test_a_case_the_manifest_does_not_list_is_named_and_not_skipped():
    """A record whose captured definition is unrecoverable is not a record that passed the check."""
    message = refusal_over([record()], {}, UNCHANGED)
    assert evaluator.UNRECORDED_DEFINITION in message, message
    assert "acceptance-generic-lantern" in message, message


def test_a_case_the_code_no_longer_defines_is_left_to_the_existing_refusal():
    """#2094's refusal fires first and says it better; reporting it twice describes one defect as two."""
    changed = evaluator.changed_case_definitions([record("acceptance-b3-error-badge")], CAPTURED, UNCHANGED)
    assert changed == {}, changed


def test_a_record_with_no_case_id_is_left_to_the_existing_refusal():
    """`assert_cases_exist` counts it under `NO_CASE_ID`; there is no definition here to compare."""
    changed = evaluator.changed_case_definitions(
        [{"provenance": {}}, {"provenance": None}], CAPTURED, UNCHANGED)
    assert changed == {}, changed


def test_the_predicate_reports_the_fields_and_the_record_count_per_id():
    """The predicate on its own: records + what they were captured under + what the code means now."""
    current = {"acceptance-generic-lantern": definition(task="Say what the lantern is for.",
                                                       good="<html><title>Lamp</title></html>")}
    changed = evaluator.changed_case_definitions([record(), record()], CAPTURED, current)
    assert changed == {"acceptance-generic-lantern": {"records": 2, "fields": ["good", "task"]}}, changed


def test_the_count_is_per_file_and_not_summed_across_repeats():
    """A held-out floor is stated at the size of ONE repeat, so a refusal that summed them would report a
    number no reader compares anything against — `assert_cases_exist` refuses for the same reason."""
    current = {"acceptance-generic-lantern": definition(task="Say what the lantern is for.")}
    with pytest.raises(SystemExit) as refused:
        evaluator.assert_case_definitions_unchanged(
            {"repeat-1.jsonl": [record()], "repeat-2.jsonl": [record()]},
            {"repeat-1.jsonl": CAPTURED, "repeat-2.jsonl": CAPTURED}, current)
    message = str(refused.value)
    assert "1 of 1 records" in message and "2 of 2" not in message, message
    assert message.count("repeat-") >= 2, f"and both files are named: {message}"


def test_a_page_body_is_not_dumped_into_the_refusal():
    """A refusal nobody reads is its own kind of silence: two HTML documents per case would be one."""
    current = {"acceptance-generic-lantern": definition(bad="<html>" + "x" * 5000 + "</html>")}
    message = refusal_over([record()], CAPTURED, current)
    assert "xxxx" in message, f"enough of the value to recognise the change: {message}"
    assert "x" * 200 not in message, f"and not the whole page: {message}"
    assert "chars)" in message, f"with the real size stated rather than hidden: {message}"


def test_many_changed_fields_are_truncated_with_the_remainder_stated():
    extra = {f"extraField{n}": n for n in range(evaluator.NAMED_CHANGED_FIELDS + 3)}
    current = {"acceptance-generic-lantern": definition(**extra)}
    message = refusal_over([record()], CAPTURED, current)
    assert f"... and {3} more field(s)" in message, message


# --- what the corpus on disk records, and how it is read back -------------------------------------


def write_run_directory(root, cases, records, manifest_cases=None):
    """A run directory shaped exactly as `training:generate-acceptance` writes one."""
    entries = []
    for case in (manifest_cases if manifest_cases is not None else cases):
        entry = {field: value for field, value in case.items() if field not in ("good", "bad")}
        entry["pages"] = {}
        for variant in ("good", "bad"):
            page = root / "pages" / case["id"] / f"{variant}.html"
            page.parent.mkdir(parents=True, exist_ok=True)
            body = next(c for c in cases if c["id"] == case["id"])[variant]
            page.write_text(body, encoding="utf-8")
            entry["pages"][variant] = str(page.relative_to(root))
        entries.append(entry)
    (root / "manifest.json").write_text(
        json.dumps({"schema": "a11ign/screen-reader-acceptance-manifest", "version": 1,
                    "cases": entries}), encoding="utf-8")
    data = root / "repeat-1.jsonl"
    data.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return data


def test_the_captured_definition_is_the_manifest_entry_plus_the_page_bodies(tmp_path):
    """Neither file is the definition; the union is. `pages` itself is bookkeeping and is not compared."""
    data = write_run_directory(tmp_path, [LANTERN], [record()])
    captured = evaluator.captured_definitions(data)
    assert captured["acceptance-generic-lantern"] == LANTERN, captured
    assert "pages" not in captured["acceptance-generic-lantern"]


def test_an_absent_manifest_is_refused_and_not_treated_as_nothing_drifted(tmp_path):
    """"Cannot tell" and "nothing changed" need opposite responses, and only one of them scores."""
    data = tmp_path / "repeat-1.jsonl"
    data.write_text("\n", encoding="utf-8")
    with pytest.raises(SystemExit) as refused:
        evaluator.captured_definitions(data)
    assert "manifest.json" in str(refused.value), str(refused.value)


def test_a_missing_page_file_reads_as_drift_and_not_a_traceback(tmp_path):
    data = write_run_directory(tmp_path, [LANTERN], [record()])
    (tmp_path / "pages" / "acceptance-generic-lantern" / "bad.html").unlink()
    captured = evaluator.captured_definitions(data)
    changed = evaluator.changed_case_definitions([record()], captured, UNCHANGED)
    assert changed["acceptance-generic-lantern"]["fields"] == ["bad"], changed


# --- against the definitions the code really has ---------------------------------------------------


def test_the_definitions_are_read_whole_from_the_javascript_that_declares_them():
    """The premise of everything above: the node call returns cases, not names.

    Until #2129 it projected `.id` and threw the rest away, which is the entire blind spot. If it ever
    narrows again — or returns an empty or tiny set from a renamed export — this says so here rather than
    letting the guard quietly compare nothing.
    """
    cases = evaluator.defined_cases()
    assert len(cases) >= 50, f"expected the full acceptance set, got {len(cases)}"
    assert set(cases) == evaluator.defined_case_ids(), "the id-only view is the same set"
    lantern = cases["acceptance-generic-lantern"]
    assert {"task", "badSignal", "good", "bad"} <= set(lantern), sorted(lantern)
    assert lantern["good"].startswith("<!doctype html>") or "<html" in lantern["good"], lantern["good"][:80]


# THE FROZEN WITNESS, and the mutation target for this row.
#
# Every manifest-carried field of `acceptance-b2-error-plot` as it stood at `b1a076747`, 2026-09-23 —
# written out rather than derived, because a fixture computed from `acceptance-matrix.mjs` at test time
# moves with the code and can pin nothing. `badSignal.control` IS that case's `submit` (`errorPair` puts
# it there), which is why renaming `submit` turns the two tests below red naming the case and the field.
#
# IF YOU CHANGED THIS CASE ON PURPOSE, that is what a recapture is for: the stored corpus was taken under
# the definition frozen here, so update this block in the same commit that changes the case, and say in
# the commit message that the corpus needs recapturing. That obligation is the finding, not a chore.
FROZEN_B2_ERROR_PLOT = {
    "id": "acceptance-b2-error-plot",
    "family": "acceptance-b2-error-plot",
    "criterion": "3.3.1",
    "subtype": "validation-error-silent",
    "task": "Submit the allotment request without a plot number.",
    "source": "independent acceptance instrument",
    "mutation": "The validation message appears visually but is not announced.",
    "badSignal": {"type": "validation-error-silent", "control": "Request the plot"},
    "probeForms": True,
    "probeTables": False,
    "alsoFails": [],
}


def stored_record(case_id, family):
    """A record that satisfies `read_records`' whole input contract, so the chain below is the real one."""
    return {
        "input": {"inputVersion": 2, "evidenceText": "Plot number, edit",
                  "evidenceUnits": [{"channel": "browse", "text": "Plot number, edit"}]},
        "target": {"label": "violation", "subtypes": ["3.3.1:validation-error-silent"],
                   "criteria": ["3.3.1"]},
        "provenance": {"caseId": case_id, "variant": "bad", "family": family},
    }


def run_directory_for_frozen_case(tmp_path, manifest_entry):
    cases = [dict(evaluator.defined_cases()["acceptance-b2-error-plot"])]
    return write_run_directory(
        tmp_path, cases,
        [stored_record("acceptance-b2-error-plot", "acceptance-b2-error-plot")],
        manifest_cases=[manifest_entry])


def test_the_real_definitions_still_match_the_corpus_this_file_freezes(tmp_path):
    """THE MUTATION TARGET: real definitions on one side, a frozen corpus on the other, through the real
    loader.

    Change one field of `acceptance-b2-error-plot` in `acceptance-matrix.mjs` — `submit` is the sharpest,
    because it is the string #1918's control rests on — and this goes red naming that case. Green means
    the stored captures of it were taken under the definition the code still has.
    """
    data = run_directory_for_frozen_case(tmp_path, FROZEN_B2_ERROR_PLOT)
    by_path = evaluator.load_records_by_path(training, [data])
    evaluator.assert_case_definitions_unchanged(
        by_path, {str(data): evaluator.captured_definitions(data)}, evaluator.defined_cases())


def test_that_witness_can_fail_and_names_the_case_and_the_field(tmp_path):
    """The control for the test above: it must be capable of going red, and of saying what moved.

    Without this, a witness that silently matched everything — an empty manifest, a comparison against
    nothing — would read exactly like a corpus that had not drifted.
    """
    renamed = dict(FROZEN_B2_ERROR_PLOT,
                   badSignal={"type": "validation-error-silent", "control": "Submit the request"})
    data = run_directory_for_frozen_case(tmp_path, renamed)
    by_path = evaluator.load_records_by_path(training, [data])
    with pytest.raises(SystemExit) as refused:
        evaluator.assert_case_definitions_unchanged(
            by_path, {str(data): evaluator.captured_definitions(data)}, evaluator.defined_cases())
    message = str(refused.value)
    assert "acceptance-b2-error-plot" in message and "badSignal" in message, message
    assert "Request the plot" in message, f"and the value the code has now: {message}"
    assert "1 of 1 records" in message, message
