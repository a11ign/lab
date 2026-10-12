"""The acceptance report states its own resolution, so nobody works it out by hand again.

#37's Acceptance reads "the report states the smallest false-positive rate the set can express, and it is
finer than 1%". On 2026-09-22 the set held 436 clean records with 0 false positives, and the bound, 0.873%,
existed only in a comment where it had been computed by hand (`z²/(n+z²) = 3.8416/439.84`). No field in
the report held it (#1922).
"""
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "evaluate-screenreader-acceptance.py"
Z = 1.96


def load():
    spec = importlib.util.spec_from_file_location("acceptance_evaluator", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["acceptance_evaluator"] = module
    spec.loader.exec_module(module)
    return module


def report_from(*repeats):
    # `report_skeleton` takes the RECORDS per file since #1918, not a count of them, so that the record
    # count and the capture-protocol census cannot be two projections of one thing that disagree. These
    # records carry only what this file's subject needs: `resolution` counts them and reads nothing off
    # them. The census over the same fixtures is pinned in `test_acceptance_states_capture_protocol.py`.
    return load().report_skeleton(
        {f"runs/screenreader-acceptance/repeat-{i}.jsonl": [{}] * n for i, n in enumerate(repeats, 1)},
        artifact={},
        diagnostic=False,
    )


@pytest.mark.parametrize("n", [138, 436])
def test_resolution_is_the_wilson_bound_at_zero_observed(n):
    block = report_from(n, n)["resolution"]
    assert block["records"] == n
    assert block["confidence"] == 0.95
    assert block["atObservedFalsePositives"] == 0
    assert block["falsePositiveUpperBound"] == pytest.approx(Z**2 / (n + Z**2))


def test_resolution_of_436_records_is_finer_than_one_percent():
    # The two sides of #37's line: 436 clears it and 138, the set before #1852 grew it, does not.
    assert report_from(436, 436)["resolution"]["falsePositiveUpperBound"] == pytest.approx(0.00873, abs=5e-6)
    assert report_from(436, 436)["resolution"]["falsePositiveUpperBound"] < 0.01
    assert report_from(138, 138)["resolution"]["falsePositiveUpperBound"] == pytest.approx(0.0271, abs=5e-5)
    assert report_from(138, 138)["resolution"]["falsePositiveUpperBound"] > 0.01


def test_resolution_counts_the_smaller_repeat_not_the_sum():
    # A repeat re-captures the same pages, so it adds no independent observations. Summing would claim
    # 872 records from 436 pages and a bound (0.44%) the set cannot express.
    assert report_from(436, 430)["resolution"]["records"] == 430


def test_resolution_of_an_empty_set_expresses_nothing():
    assert report_from()["resolution"]["falsePositiveUpperBound"] == 1.0
