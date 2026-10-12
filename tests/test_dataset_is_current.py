"""A derived dataset whose source has moved on must STOP the train, not quietly train on it.

On 2026-08-24 a retrain consumed a `with-realism.jsonl` built before 44 new cases existed: the export held
2,366 records and training reported 2,349. Every step succeeded. The missing one -- `build-realism` --
simply left an older file in place, and a full capture/export/train/sweep cycle produced a model that had
never seen the corpus change it was run to measure, plus a real-page number that meant nothing.

The guard re-hashes the SOURCE rather than trusting the sidecar's own description of it, so it shares no
failure mode with the build. And it hashes rather than comparing mtimes, because timestamps move for
reasons that are not content.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _scorer_python import scorer_python  # noqa: E402

sys.path.insert(0, str(scorer_python()))

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location(
    "trainer", ROOT / "scripts" / "train-screenreader-model.py")
trainer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(trainer)


def _derived(tmp_path: Path, source_text: str, claimed_text: str) -> Path:
    """A derived dataset plus a sidecar describing the source it was built from."""
    source = tmp_path / "screenreader-evidence.jsonl"
    source.write_text(source_text, encoding="utf-8")
    derived = tmp_path / "with-realism.jsonl"
    derived.write_text(claimed_text, encoding="utf-8")
    (tmp_path / "with-realism.jsonl.source.json").write_text(json.dumps({
        "source": "screenreader-evidence.jsonl",
        "sourceSha256": trainer.sha256(_written(tmp_path, claimed_text)),
        "sourceRecords": len(claimed_text.strip().splitlines()),
        "realismRecords": 0,
    }), encoding="utf-8")
    return derived


def _written(tmp_path: Path, text: str) -> Path:
    scratch = tmp_path / "claimed-source.jsonl"
    scratch.write_text(text, encoding="utf-8")
    return scratch


def test_a_source_that_has_changed_refuses_the_train(tmp_path: Path) -> None:
    # The exact 2026-08-24 shape: the export gained records after the derived file was built.
    derived = _derived(tmp_path, source_text='{"a":1}\n{"a":2}\n{"a":3}\n', claimed_text='{"a":1}\n{"a":2}\n')
    with pytest.raises(SystemExit) as refusal:
        trainer.assert_dataset_is_current(derived)
    message = str(refusal.value)
    assert "REFUSING to train" in message
    assert "build-realism" in message, "the refusal must name the command that fixes it"


def test_a_current_source_trains(tmp_path: Path) -> None:
    same = '{"a":1}\n{"a":2}\n'
    derived = _derived(tmp_path, source_text=same, claimed_text=same)
    trainer.assert_dataset_is_current(derived)


def test_no_sidecar_is_a_THIRD_answer_and_says_so(tmp_path: Path, capsys) -> None:
    # Not silence, and not a refusal: an older build wrote no sidecar, and routing "cannot tell" to "fine"
    # is precisely what let the stale file through.
    lonely = tmp_path / "with-realism.jsonl"
    lonely.write_text('{"a":1}\n', encoding="utf-8")
    trainer.assert_dataset_is_current(lonely)
    assert "UNKNOWN" in capsys.readouterr().err


def test_a_missing_source_does_not_crash_the_train(tmp_path: Path) -> None:
    # The source is not always beside the derived file (an acceptance dataset, a copied corpus). Absent is
    # not the same as changed, and treating it as changed would refuse legitimate runs.
    derived = tmp_path / "with-realism.jsonl"
    derived.write_text('{"a":1}\n', encoding="utf-8")
    (tmp_path / "with-realism.jsonl.source.json").write_text(json.dumps({
        "source": "screenreader-evidence.jsonl", "sourceSha256": "deadbeef", "sourceRecords": 1,
    }), encoding="utf-8")
    trainer.assert_dataset_is_current(derived)
