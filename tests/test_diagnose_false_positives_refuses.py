"""`diagnose-false-positives.py` must REFUSE an empty --data file, not print {"records": 0}.

`main()` had no refusal at all: given an empty file it printed `{"records": 0, "subtypes": {}}` and
exited 0 -- indistinguishable from "examined everything, found nothing". Today it fails only by
accident, via a numpy broadcast error deep inside scoring -- a traceback rather than a stated verdict.

Tests `parse_records()`, the pure half `main()` calls before anything model-related loads (no encoder,
no safetensors weights, no report) -- exactly so the empty/malformed-input decision can be proved without
either. `PYTHONDONTWRITEBYTECODE=1 pytest -p no:cacheprovider` matters here specifically:
`importlib.util.spec_from_file_location` honours `__pycache__`, and a stale compile decided a mutation
check wrongly once already on 2026-09-03 (see CLAUDE.md).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "diagnose_false_positives",
    Path(__file__).resolve().parents[1] / "scripts" / "diagnose-false-positives.py",
)
diagnose = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(diagnose)


def test_empty_text_produces_zero_records_and_zero_malformed():
    records, malformed = diagnose.parse_records("")
    assert records == []
    assert malformed == 0


def test_whitespace_only_lines_are_not_records_and_not_malformed():
    # Blank lines are formatting, not data -- the same distinction audit_grants.py draws between "no
    # corpus" and "corpus present but nothing usable in it".
    records, malformed = diagnose.parse_records("\n\n   \n\n")
    assert records == []
    assert malformed == 0


def test_well_formed_lines_all_parse():
    text = '{"a": 1}\n{"b": 2}\n{"c": 3}\n'
    records, malformed = diagnose.parse_records(text)
    assert records == [{"a": 1}, {"b": 2}, {"c": 3}]
    assert malformed == 0


def test_a_malformed_line_is_counted_and_skipped_not_crashed_on():
    # A truncated export -- the interrupted-write shape this repo's own capture code guards against
    # elsewhere -- must not crash parsing outright; the WELL-formed lines around it are real records.
    text = '{"a": 1}\n{"b": truncated-mid-write\n{"c": 3}\n'
    records, malformed = diagnose.parse_records(text)
    assert records == [{"a": 1}, {"c": 3}]
    assert malformed == 1


def test_a_file_of_only_malformed_lines_produces_zero_records():
    text = "{not json at all\n{also not json\n"
    records, malformed = diagnose.parse_records(text)
    assert records == []
    assert malformed == 2


def test_diagnose_refuses_on_dev_null_by_hand():
    """The acceptance command from the issue itself, run as a real subprocess so the exit code and the
    stated reason are what an operator actually sees -- not only what the pure function returns."""
    import subprocess
    import sys

    script = Path(__file__).resolve().parents[1] / "scripts" / "diagnose-false-positives.py"
    result = subprocess.run(
        [sys.executable, str(script), "--data", "/dev/null", "--model", "/nonexistent"],
        capture_output=True, text=True,
    )
    assert result.returncode == 2, f"expected refusal (exit 2), got {result.returncode}: {result.stdout}{result.stderr}"
    # The OLD behaviour printed the empty-corpus JSON as its ONLY output and exited 0 -- checked as a
    # parseable, bare JSON document, not a substring, because the new refusal message legitimately
    # QUOTES that old shape while explaining why it is refusing.
    import json
    try:
        parsed = json.loads(result.stdout)
        assert parsed != {"records": 0, "subtypes": {}}, "the OLD silent-success shape must not reappear"
    except json.JSONDecodeError:
        pass  # stdout is prose, not bare JSON -- exactly what the refusal must produce
    assert "REFUSAL" in result.stdout
    assert "examined nothing" in result.stdout
