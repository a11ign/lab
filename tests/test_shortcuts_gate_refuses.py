"""`scorer:shortcuts` must refuse a head that GAINED a free veto, and one nobody has audited.

Proves the VERDICT shared by `scorer:shortcuts` and `scorer:shortcuts:candidate` — the same
`compare_to_baseline` runs for both, differing only in which weights produced the rows.

## What a free veto is, and why no accuracy number can see it

A veto is a feature that is 0 on every training positive of a subtype. A linear head may give it a large
negative weight at no cost, because nothing in training punishes it — and no held-out split can punish it
either, because the split has the same structure. ADR 0015 measured the shipped weights: 225 such vetoes,
the worst being `form_field_named` at -4.33, which means the scorer reports an unnamed control **only on a
page where nothing is correctly named** — a description of almost no real site.

Held-out acceptance (58 TP / 0 FP / 0 FN), `npm run eval` and `rules:gate` are all blind to this *by
construction*. This gate is the only thing that is not.

## Two findings that must not be collapsed

**REGRESSION** — a head with more vetoes than the baseline. The corpus separated two things it should not,
or a feature was added that no positive carries.

**UNAUDITED** — a head absent from the baseline. Measured 2026-08-26: correcting `SCORED_CRITERIA` to
match the shipped model brought five long-standing heads into scope and the report announced them as five
regressions that "gained a free veto". *They gained nothing; nobody had looked.* Both still block — an
unaudited veto is not a safe one — but the wording decides whether somebody investigates the corpus or
records a baseline, and sending them at the wrong one costs a day.

## Why this needs neither weights nor corpus

`compare_to_baseline()` is pure over a list of rows and a baseline path. `audit()` needs the model; the
VERDICT does not. The register's premise for this gate — "needs trained weights AND the exported corpus,
because a veto is a property of the two together" — is true of producing the rows and false of judging
them. That premise has now been wrong nine times running; see `docs/proving-a-gate.md`.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "audit_scorer_shortcuts",
    Path(__file__).resolve().parents[1] / "scripts" / "audit-scorer-shortcuts.py",
)
audit_shortcuts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_shortcuts)


def row(subtype: str, vetoes: int, positives: int = 50) -> dict:
    """A row shaped only as far as `compare_to_baseline` reads it."""
    return {
        "subtype": subtype,
        "positives": positives,
        "vetoes": [{"feature": f"planted_feature_{i}", "logit": -1.0} for i in range(vetoes)],
        "sumLogits": -1.0 * vetoes,
    }


def baseline_file(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"rows": rows}))
    return path


def run(rows: list[dict], baseline: Path) -> tuple[int, str]:
    out = io.StringIO()
    code = audit_shortcuts.compare_to_baseline(rows, baseline, out)
    return code, out.getvalue()


def test_a_head_that_gained_a_veto_is_refused_and_named(tmp_path):
    base = baseline_file(tmp_path, [row("2.4.4:regex", 1)])
    code, output = run([row("2.4.4:regex", 4)], base)
    assert code != 0, "more vetoes than the baseline is a regression and must block"
    assert "REGRESSION" in output
    assert "1 -> 4" in output, f"the refusal must show the movement, not just a count: {output}"
    assert "2.4.4:regex" in output, "and it must name the head"


def test_a_head_that_LOST_vetoes_is_silent(tmp_path):
    # Silent on an improvement, which is the direction we want. Without this the gate would block every
    # corpus fix that worked, which is how a gate gets switched off.
    base = baseline_file(tmp_path, [row("2.4.4:regex", 4)])
    code, output = run([row("2.4.4:regex", 1)], base)
    assert code == 0, f"fewer vetoes is the fix landing, not a failure: {output}"
    assert "REGRESSION" not in output


def test_an_unchanged_head_is_silent(tmp_path):
    # The control. Without it, everything here is satisfied by a gate that blocks unconditionally.
    base = baseline_file(tmp_path, [row("2.4.4:regex", 2)])
    code, output = run([row("2.4.4:regex", 2)], base)
    assert code == 0, f"an unchanged head must not block: {output}"


def test_an_UNAUDITED_head_blocks_but_is_worded_differently(tmp_path):
    # The distinction that cost a day when it did not exist: five heads came into scope and were announced
    # as five regressions. They gained nothing; nobody had looked.
    base = baseline_file(tmp_path, [row("2.4.4:regex", 1)])
    code, output = run([row("2.4.4:regex", 1), row("1.1.1:missing-alt", 3)], base)
    assert code != 0, "an unaudited veto is not a safe one; it must still block"
    assert "UNAUDITED" in output
    assert "REGRESSION" not in output, (
        "an unaudited head must NOT be called a regression — that sends the reader to the corpus when the "
        "answer is to record a baseline"
    )
    assert "shortcuts-baseline" in output, "and the refusal must name the command that resolves it"


def test_an_unaudited_head_says_when_it_is_too_small_to_judge(tmp_path):
    # A head with 4 positives has a free veto on nearly every feature — arithmetic, not a corpus fault.
    # Reported so the reader knows which question to ask; it still blocks.
    base = baseline_file(tmp_path, [])
    code, output = run([row("2.1.2:focus-trapped", 9, positives=4)], base)
    assert code != 0
    assert "too few to separate anything" in output, (
        f"a tiny head's vetoes are arithmetic and the report must say so: {output}"
    )


def test_a_rule_decided_head_says_the_veto_cannot_reach_a_user(tmp_path):
    # ADR 0015's harm requires the head to DECIDE. Where rule-ownership.json says `rules`, the
    # deterministic layer reports the verdict and the veto is inert — reported, never used to excuse.
    base = baseline_file(tmp_path, [])
    code, output = run([row("1.3.1:no-headings", 5, positives=29)], base)
    assert code != 0, "still blocks — the day ownership moves, the veto is waiting"
    assert "cannot reach a user" in output, f"the reader must be told which question to ask: {output}"


def test_a_subtype_that_lost_all_its_positives_blocks_as_LOST_COVERAGE(tmp_path):
    # The gap this file's own header did not have a name for until now: `audit()` used to SKIP a subtype
    # silently when `positives` was empty, so a corpus that lost a subtype's only evidence between one run
    # and the next simply vanished from `rows` -- and `compare_to_baseline` only ever asked "is this row
    # worse than the baseline", never "did a baseline row disappear". `audit()` now emits an explicit
    # `positives: 0` row instead of omitting it, which is what lets this test call `compare_to_baseline`
    # directly with a shape `audit()` would actually produce.
    base = baseline_file(tmp_path, [row("2.4.2:route-title-stale", 1, positives=25)])
    code, output = run([row("2.4.2:route-title-stale", 0, positives=0)], base)
    assert code != 0, "a subtype with zero positives cannot be vouched for, whatever its vetoes read"
    assert "LOST COVERAGE" in output
    assert "25 positive(s) at baseline, 0 now" in output, f"the shortfall must be named, not just flagged: {output}"
    assert "REGRESSION" not in output, "0 vetoes is not a smaller number of vetoes, it is no evidence at all"
    assert "UNAUDITED" not in output, "this subtype WAS audited before -- it did not newly come into scope"


def test_a_never_audited_subtype_with_zero_positives_is_UNAUDITED_not_LOST_COVERAGE(tmp_path):
    # The adversarial direction the fix above must not get wrong: a subtype with NO baseline entry at all
    # (never audited) that also happens to have zero positives right now is a brand-new, thin head -- not
    # coverage that was LOST, since there is no prior positives count to have lost it FROM. A version of
    # the fix that checked only `row["positives"] == 0` without first confirming a baseline entry existed
    # would either crash reading `was["positives"]` on a `None`, or silently misclassify this as coverage
    # loss -- caught here rather than by mutation alone, since neither existing test exercised the case.
    base = baseline_file(tmp_path, [row("2.4.4:regex", 1)])
    code, output = run([row("2.4.4:regex", 1), row("9.9.9:brand-new", 0, positives=0)], base)
    assert code != 0
    assert "UNAUDITED" in output
    assert "9.9.9:brand-new" in output
    assert "LOST COVERAGE" not in output, (
        f"never having been audited is not the same as having lost coverage: {output}"
    )


def test_a_subtype_with_positives_both_sides_is_judged_normally_despite_the_new_check(tmp_path):
    # The control for the fix above: an ordinary comparison (positives present on both sides) must not be
    # swept into LOST COVERAGE just because the new check runs first.
    base = baseline_file(tmp_path, [row("2.4.4:regex", 1)])
    code, output = run([row("2.4.4:regex", 4)], base)
    assert code != 0
    assert "REGRESSION" in output
    assert "LOST COVERAGE" not in output


def test_no_baseline_at_all_is_not_a_refusal(tmp_path):
    # The first run has nothing to compare against. Blocking here would make the gate unbootstrappable.
    code, output = run([row("2.4.4:regex", 3)], tmp_path / "does-not-exist.json")
    assert code == 0
    assert "no baseline" in output and "--update-baseline" in output, (
        "and it must say how to create one, or the operator is stuck"
    )
