"""A run may write to runs/, never into packages/.

Measured 2026-08-23, and the second consequence was much worse than the first. An acceptance run scored
the SHIPPED model and stamped its verdict into that model's own training report, overwriting the record
of what was true when those weights were released with the result of a run that released nothing.

Then, because `packages/` is tracked, the lab checkout was dirty. `run-job.yml` refuses to pull into
somebody's uncommitted work — correctly — so the lab ran **17 commits behind origin for days**, every job
reporting the true and useless sentence "Not pulling: the checkout is dirty".

Both halves are guarded now: this refuses the write, and `lab-job.test.ts` requires the drift to be
reported as a NUMBER. Two independent guards because they fail independently — a different script writing
into packages/ would recreate the second problem without touching the first.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "evaluate-screenreader-acceptance.py"


def load_evaluator():
    spec = importlib.util.spec_from_file_location("acceptance_evaluator", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator"] = module
    spec.loader.exec_module(module)
    return module


def test_refuses_to_stamp_a_report_inside_packages(tmp_path):
    evaluator = load_evaluator()
    shipped = tmp_path / "packages" / "scorer" / "models" / "screenreader-scorer"
    shipped.mkdir(parents=True)
    report = shipped / "training-report.json"
    report.write_text(json.dumps({"releaseEligible": True, "releaseBlockedBy": []}), encoding="utf-8")

    with pytest.raises(SystemExit) as raised:
        evaluator.stamp_generalisation(report, passed=False, reasons=["1.3.1: false negatives"], diagnostic=False)

    message = str(raised.value)
    assert "tracked source" in message, "the refusal must say WHY, not just refuse"
    assert "runs/model-shipped" in message, "it must name the way to do what the caller wanted"
    # The record is untouched. A refusal that half-wrote would be worse than the bug.
    assert json.loads(report.read_text(encoding="utf-8")) == {"releaseEligible": True, "releaseBlockedBy": []}


def test_still_stamps_a_candidate_under_runs(tmp_path):
    # The guard must not break the thing it is guarding. A candidate in runs/ is exactly what this
    # evaluator exists to stamp, and a guard that blocks the normal path gets deleted within a day.
    evaluator = load_evaluator()
    candidate = tmp_path / "runs" / "model-candidate"
    candidate.mkdir(parents=True)
    report = candidate / "training-report.json"
    report.write_text(json.dumps({"releaseEligible": True, "releaseBlockedBy": []}), encoding="utf-8")

    evaluator.stamp_generalisation(report, passed=False, reasons=["2.4.6: false positives"], diagnostic=False)

    stamped = json.loads(report.read_text(encoding="utf-8"))
    assert stamped["generalisationVerified"] is False
    assert stamped["releaseBlockedBy"] == ["held-out acceptance failed: 2.4.6: false positives"]


def test_a_passing_candidate_is_stamped_verified(tmp_path):
    evaluator = load_evaluator()
    candidate = tmp_path / "runs" / "model-candidate"
    candidate.mkdir(parents=True)
    report = candidate / "training-report.json"
    report.write_text(json.dumps({"releaseBlockedBy": ["calibration: something else"]}), encoding="utf-8")

    evaluator.stamp_generalisation(report, passed=True, reasons=[], diagnostic=False)

    stamped = json.loads(report.read_text(encoding="utf-8"))
    assert stamped["generalisationVerified"] is True
    # Rebuilt, not emptied: a pass here must not erase a blocker some other gate recorded.
    assert stamped["releaseBlockedBy"] == ["calibration: something else"]
