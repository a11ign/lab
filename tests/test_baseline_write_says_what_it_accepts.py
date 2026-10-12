"""Writing the baseline must SAY which rows it changes, because it rewrites the whole file.

`--update-baseline` is documented as "a deliberate act with a flag, never a side effect of running the
audit", and that protects against an ACCIDENTAL write. It does not tell whoever performs it what they are
signing, and the two are different guarantees.

MEASURED 2026-09-05, and this is a defect that already happened. The tracked baseline was written to record
`1.4.13`'s eight new vetoes — all on a rules-decided subtype, so all shielded. The same write silently
accepted `form_change_observed_absent` on `3.3.1:validation-error-silent` and
`4.1.3:form-activation-silent`, neither of which has a `rule-ownership.json` entry, so both are
MODEL-decided and both can reach a report. That is precisely the ADR 0015 harm this audit exists to catch,
and `not-working.md` §2 went on reading "CLOSED — ZERO free vetoes can now reach a report" for five days.

The gate itself cannot catch it: `compare_to_baseline` fails on `closable_count(row) > closable_count(was)`,
and once a veto is IN the baseline there is nothing to exceed. A metric computed against a baseline that
absorbed the flaw cannot see the flaw — CLAUDE.md's own sentence, one layer out.

Nothing here blocks. This runs at the moment somebody has already decided to accept; what it removes is the
ability to accept something without being shown it. Same shape as `promote:model` printing the provenance
it is about to write.
"""
from __future__ import annotations

import io
import json
import contextlib
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "audit_scorer_shortcuts",
    Path(__file__).resolve().parents[1] / "scripts" / "audit-scorer-shortcuts.py",
)
audit_shortcuts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_shortcuts)


def row(subtype: str, closable: int, unclosable: int = 0) -> dict:
    """A row shaped only as far as `closable_count` and the report read it."""
    return {
        "subtype": subtype,
        "positives": 50,
        "vetoes": [{"feature": f"free_{i}", "logits": -1.0} for i in range(closable)]
        + [{"feature": f"fixed_{i}", "logits": -1.0, "unclosable": "by-definition"}
           for i in range(unclosable)],
        "sumLogits": -1.0 * (closable + unclosable),
    }


def write_baseline(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"vetoLogits": 1, "rows": rows}))
    return path


def report(rows: list[dict], baseline: Path) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        audit_shortcuts.report_what_is_being_accepted(rows, baseline)
    return out.getvalue()


def test_a_row_that_gained_a_closable_veto_is_named(tmp_path: Path) -> None:
    baseline = write_baseline(tmp_path, [row("1.1.1:missing-alt", 0)])
    text = report([row("1.1.1:missing-alt", 2)], baseline)
    assert "1.1.1:missing-alt" in text
    assert "0 -> 2" in text
    assert "CHANGED" in text


def test_a_MODEL_DECIDED_row_is_called_out_separately_from_a_shielded_one(tmp_path: Path) -> None:
    """The distinction the harm turns on. A rules-decided subtype's veto cannot reach a user; a
    model-decided one's is the thing ADR 0015 is about, and a reader must not have to look it up."""
    def changed_line(text: str) -> str:
        # The ROW's own line, not the closing paragraph — which mentions MODEL-DECIDED to explain what it
        # means, and matching that would make this test pass on a report that labelled nothing.
        return next(line for line in text.splitlines() if "CHANGED" in line)

    baseline = write_baseline(tmp_path, [row("3.3.1:validation-error-silent", 0)])
    line = changed_line(report([row("3.3.1:validation-error-silent", 1)], baseline))
    assert "MODEL-DECIDED" in line, "a veto that can reach a report must say so at the moment of acceptance"

    shielded = write_baseline(tmp_path, [row("4.1.2:unnamed-control", 0)])
    line = changed_line(report([row("4.1.2:unnamed-control", 1)], shielded))
    assert "rule-decided" in line
    assert "MODEL-DECIDED" not in line


def test_an_unchanged_write_says_so_rather_than_printing_an_empty_heading(tmp_path: Path) -> None:
    # Re-recording an identical baseline is a real thing to do (a corpus rebuild that changed nothing), and
    # a heading with nothing under it reads like a report that failed rather than one with nothing to say.
    baseline = write_baseline(tmp_path, [row("1.1.1:missing-alt", 1)])
    text = report([row("1.1.1:missing-alt", 1)], baseline)
    assert "nothing changed" in text
    assert "ACCEPTING" not in text


def test_an_improvement_is_shown_too_because_the_write_records_it_either_way(tmp_path: Path) -> None:
    # `compare_to_baseline` is deliberately silent on improvements — that is the direction we want, and a
    # gate should not block on it. This is not the gate: it states what the file will hold afterwards, and
    # a veto that GOES AWAY is part of that.
    baseline = write_baseline(tmp_path, [row("1.1.1:missing-alt", 3)])
    text = report([row("1.1.1:missing-alt", 1)], baseline)
    assert "3 -> 1" in text


def test_the_first_ever_write_is_not_reported_as_a_pile_of_changes(tmp_path: Path) -> None:
    text = report([row("1.1.1:missing-alt", 2)], tmp_path / "does-not-exist.json")
    assert "first time" in text
    assert "CHANGED" not in text


def test_an_unclosable_veto_does_not_read_as_something_to_accept(tmp_path: Path) -> None:
    """`closable_count` is the quantity the gate moved to for a documented reason: a veto nothing can close
    blocks a release for ever, and a gate that cannot be satisfied is one that gets bypassed. The
    acceptance report must count the same thing, or the two disagree about what a write means."""
    baseline = write_baseline(tmp_path, [row("1.3.1:no-headings", 1)])
    text = report([row("1.3.1:no-headings", 1, unclosable=4)], baseline)
    assert "nothing changed" in text
