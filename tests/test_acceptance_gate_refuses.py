"""`training:evaluate-acceptance:*` must NAME its failures and refuse to rewrite released provenance.

Proves two decisions inside the gate `training:evaluate-acceptance:shipped` and its `:candidate` sibling —
the same evaluator runs for both, differing only in which weights it is pointed at.

## Why `metrics` naming its failures is a gate property, not a nicety

It returned counts alone. Measured 2026-08-23 against the shipped model on a fresh held-out set:
`1.3.1: acceptance false negatives` and `2.4.6: acceptance false positives`, two of each. From the report
it was impossible to tell whether that was *one subtype systematically missed* or *two unlucky pages* —
and those need completely different responses. Answering it meant re-running the evaluator by hand with
print statements.

This is the repo's most-repeated rule pointed at its own release gate: a count is where an investigation
stops rather than starts.

## Why the source-tree refusal is the more expensive of the two

Scoring the SHIPPED model is legitimate — it is how you learn whether production weights still pass the
held-out set. Stamping that verdict into the model's own training report is not: it overwrites the record
of what was true when those weights were released with the result of a run that released nothing.

It happened. `training-report.json` came back carrying `generalisationVerified: false` on weights that had
shipped clean — and the second cost was larger: `packages/` is tracked, so the lab checkout was dirty,
`run-job.yml` refused to pull into somebody's work, and **the lab ran 17 commits behind origin for days**
while every job said "Not pulling: the checkout is dirty" and none said what that meant.

## Why this needs neither the acceptance set nor a model

Both are pure: `metrics` over four small arrays, and the refusal over a path. The register's premise —
"needs the held-out acceptance set, which is 104 captured records and not synthesisable" — is true of
producing scores and false of judging them. Ten premises challenged, ten false; see
`docs/proving-a-gate.md`.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "evaluate-screenreader-acceptance.py"
_spec = importlib.util.spec_from_file_location("evaluate_screenreader_acceptance", _PATH)
evaluator = importlib.util.module_from_spec(_spec)
sys.modules["evaluate_screenreader_acceptance"] = evaluator
_spec.loader.exec_module(evaluator)


def test_a_false_positive_is_NAMED_not_merely_counted():
    # Two records, one clean, and the model fires on the clean one.
    scores = np.array([0.9, 0.9])
    labels = np.array([True, False])
    result = evaluator.metrics(scores, labels, 0.5, ["planted-good.good", "planted-clean.good"])
    assert result["falsePositive"] == 1
    assert result["falsePositiveCases"] == ["planted-clean.good"], (
        "a count cannot tell one systematically-missed subtype from two unlucky pages, and those need "
        f"opposite responses: got {result}"
    )


def test_a_false_negative_is_NAMED_too():
    scores = np.array([0.1, 0.9])
    labels = np.array([True, True])
    result = evaluator.metrics(scores, labels, 0.5, ["planted-missed.bad", "planted-caught.bad"])
    assert result["falseNegative"] == 1
    assert result["falseNegativeCases"] == ["planted-missed.bad"]


def test_a_clean_run_names_nothing_and_counts_nothing():
    # The control. Without it every assertion here is satisfied by a function that reports every record as
    # a failure — which would be loud, useless, and bypassed the first time it blocked a release.
    scores = np.array([0.9, 0.1])
    labels = np.array([True, False])
    result = evaluator.metrics(scores, labels, 0.5, ["planted-a.bad", "planted-b.good"])
    assert result["falsePositive"] == 0 and result["falseNegative"] == 0
    assert result["falsePositiveCases"] == [] and result["falseNegativeCases"] == []
    assert result["truePositive"] == 1


def test_the_naming_is_BOUNDED_and_says_when_it_truncated():
    # A report nobody can read is its own kind of silence, so the list is capped — but a silent cap is the
    # defect one layer along, and this repo has paid for that shape more than once.
    count = evaluator.MAX_NAMED_FAILURES + 5
    scores = np.full(count, 0.9)
    labels = np.zeros(count, dtype=bool)
    result = evaluator.metrics(scores, labels, 0.5, [f"planted-{i}.good" for i in range(count)])
    assert len(result["falsePositiveCases"]) == evaluator.MAX_NAMED_FAILURES
    assert result["falsePositiveCasesTruncated"] == 5, (
        f"a truncated list must say how much it dropped, or it reads as complete: {result}"
    )


def test_stamping_a_verdict_into_the_tracked_SOURCE_TREE_is_refused(tmp_path):
    # The guard whose absence cost 17 commits of lab drift. It must refuse by PATH, before any write.
    source_report = Path("packages/scorer/models/screenreader-scorer/training-report.json")
    with pytest.raises(SystemExit) as refusal:
        evaluator.refuse_to_stamp_source_tree(source_report)
    message = str(refusal.value)
    assert "refusing to stamp" in message
    assert "tracked source" in message, (
        f"the refusal must say WHY, or the next reader routes around it: {message}"
    )


def test_stamping_into_run_output_is_allowed(tmp_path):
    # The control, and it matters more than usual: this gate's whole job is scoring the shipped model, so
    # a refusal that also blocked `runs/model-shipped` would make the gate unrunnable.
    evaluator.refuse_to_stamp_source_tree(tmp_path / "model-shipped" / "acceptance-report.json")


def test_the_refusal_is_about_the_DIRECTORY_not_the_filename():
    # `training-report.json` is not a magic name — anything written into packages/ turns a source tree
    # into an output directory, which is what the lab pulls into.
    with pytest.raises(SystemExit):
        evaluator.refuse_to_stamp_source_tree(Path("packages/scorer/models/anything-at-all.json"))


def test_a_named_failure_carries_its_SCORE_and_the_cut_it_missed():
    """A name is where the next investigation stops, and the difference is one float.

    `metrics` already learned that a count is where an investigation stops rather than starts, and began
    naming the records. Measured 2026-09-01, one layer further out: a candidate that closed every free
    veto failed acceptance on exactly one case, and the report could not say whether it scored 0.90
    against a 0.9153 cut — threshold variance, ship it — or 0.30, which would mean the head had genuinely
    lost the finding. Those need opposite responses. Answering it meant reverting the change and reading
    the training report, which is the expensive direction.

    The scores are derived in the SAME loop from the same mask as the names, never as a second list: two
    structures naming one set of records is this repo's most-recorded defect, and the truncation would
    have had to be applied identically to both.
    """
    import numpy as np

    scores = np.array([0.10, 0.95, 0.80])
    labels = np.array([True, False, True])
    result = evaluator.metrics(scores, labels, 0.90, ["missed-low.bad", "alarmed.good", "missed-high.bad"])

    assert result["falseNegativeCases"] == ["missed-high.bad", "missed-low.bad"]
    assert result["falseNegativeScores"] == {"missed-high.bad": 0.8, "missed-low.bad": 0.1}, (
        "each named miss must carry the score it achieved, or 'just under the cut' and 'nowhere near' "
        "stay indistinguishable")
    assert result["falsePositiveScores"] == {"alarmed.good": 0.95}
    assert result["threshold"] == 0.9, (
        "and the cut those scores are measured against — without it the numbers are unanchored")

    # The names and the scores must describe the SAME records. Derived together, so this can only fail if
    # somebody splits them back into two computations.
    assert set(result["falseNegativeCases"]) == set(result["falseNegativeScores"]), \
        "the two views of one failure set must not be able to disagree"


# --- The third exit code: "could not measure" is not "a real regression" ---
#
# `release:gate` (package.json) is a flat `&&` chain and reads this script's bare exit code as its WHOLE
# verdict on this stage. Before this, "capture-to-capture stability could not be measured at all" (too few
# repeated captures -- exactly what a missing or empty `repeat-2.jsonl` produces) and "a real acceptance
# regression" were the identical exit code, 1. These test the two PURE functions the split lives in --
# `stability_failure_reasons` (over the already-computed stability dict, not the model or the encoder) and
# `acceptance_exit_code` (over the booleans/counts those reasons produce) -- so the exact branch this
# incident hit is exercised without a model, an encoder, or any `runs/screenreader-acceptance/repeat-*`
# file, per the brief: use fixtures, never the real evaluator against `runs/`.

def measured(passed: bool) -> dict:
    return {"measured": True, "passed": passed}


def unmeasured() -> dict:
    # What `merge_stability`/`stability` actually produce when NO group had two or more repeated captures
    # to compare -- `measured: bool(repeated)` is False, so `passed` is also False by construction (see
    # `stability()`'s own `"passed": bool(repeated) and unstable == 0`). Read from source, not guessed.
    return {"measured": False, "passed": False}


def test_stability_all_passed_produces_no_failure_reasons():
    reasons, unmeasured_list, unstable_list = evaluator.stability_failure_reasons({
        "4.1.2:unnamed-control": measured(True), "3.3.1:validation-error-silent": measured(True),
    })
    assert reasons == [] and unmeasured_list == [] and unstable_list == []


def test_stability_unmeasured_is_named_UNMEASURED_not_FAILED():
    # This is the branch a missing or empty repeat-2.jsonl reaches: no repeated captures anywhere, so
    # nothing could be compared -- not "compared and found stable", not "compared and found unstable".
    reasons, unmeasured_list, unstable_list = evaluator.stability_failure_reasons({
        "2.4.2:route-title-stale": unmeasured(),
    })
    assert unmeasured_list == ["2.4.2:route-title-stale"]
    assert unstable_list == []
    assert any("NOT MEASURED" in r for r in reasons)
    assert not any("FAILED" in r for r in reasons)


def test_stability_measured_and_unstable_is_named_FAILED_not_unmeasured():
    reasons, unmeasured_list, unstable_list = evaluator.stability_failure_reasons({
        "4.1.2:state-change-silent": measured(False),
    })
    assert unstable_list == ["4.1.2:state-change-silent"]
    assert unmeasured_list == []
    assert any("FAILED" in r for r in reasons)
    assert not any("NOT MEASURED" in r for r in reasons)


def test_exit_code_0_on_a_pass_regardless_of_the_other_arguments():
    # `passed` already means "no failure reasons at all", so the other two must not be consulted.
    assert evaluator.acceptance_exit_code(True, real_failures_before_stability=3, unstable=["x"]) == 0


def test_exit_code_2_when_the_ONLY_problem_is_unmeasured_stability():
    assert evaluator.acceptance_exit_code(False, real_failures_before_stability=0, unstable=[]) == 2


def test_exit_code_1_on_a_real_per_criterion_failure_even_with_no_stability_problem():
    assert evaluator.acceptance_exit_code(False, real_failures_before_stability=1, unstable=[]) == 1


def test_exit_code_1_when_stability_was_MEASURED_and_moved():
    # Measured and moved is a real regression, not an inconclusive check -- must not be softened to 2.
    assert evaluator.acceptance_exit_code(
        False, real_failures_before_stability=0, unstable=["4.1.2:state-change-silent"]) == 1


def test_exit_code_1_when_BOTH_a_real_failure_and_unmeasured_stability_are_present():
    # A real failure must never be masked by an unrelated inconclusive check -- FAIL beats INCONCLUSIVE.
    assert evaluator.acceptance_exit_code(False, real_failures_before_stability=2, unstable=[]) == 1
