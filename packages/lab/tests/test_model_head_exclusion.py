"""`rule-ownership.json`'s `modelHead: false` must produce no trained head — proved on a real artefact.

Two declarations are held pending this mechanism: `1.4.2:autoplay-uncontrollable` (declared `rules`, no
corpus case yet) and `2.4.7:focus-removed-on-receipt` (declared `rules`, nine corpus cases, all sharing
every feature with `2.1.1`'s own positives — a free veto in the making). `assert_declaration_matches_data`
only knew two states before this: a `decidedBy != "unavailable"` key MUST appear in some record's
`target.subtypes`, and a `decidedBy == "unavailable"` key MUST NOT. Both new entries fall in neither box:
1.4.2 is expected-and-absent (crash), 2.4.7 is expected-and-present-but-must-get-no-head (a different
crash, one layer on — a head WOULD be fitted, silently, which is worse).

`modelHead: false` is the third state, and this file proves it two ways for the reason the CEO specified:
"verified by reading safetensors metadata after a train, not by reading the code — a test that
re-implements the exclusion to assert the exclusion proves nothing."

  1. `subtypes_by_criterion_for` (the pure filter `main()`'s per-criterion loop iterates) excludes a
     declared-false subtype, proved directly on fabricated records — no torch, no corpus, no encoder.
  2. A REAL, tiny `train_head` + `save_file` round trip, on synthetic features standing in for the
     encoder's output, proves the excluded subtype's key is ABSENT from the resulting `.safetensors`
     file's own key list — the artefact itself, read back, not the Python dict that built it.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

TRAINER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "train-screenreader-model.py"

_spec = importlib.util.spec_from_file_location("train_screenreader_model", TRAINER_PATH)
trainer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(trainer)


def fake_ownership(**entries):
    """A `RULE_OWNERSHIP`-shaped dict with only the entries a test needs — the real file's 20+ other
    entries are irrelevant noise for a test about ONE mechanism, and including them would make a failure
    here about the wrong subtype look like a failure about this one."""
    return entries


def record(criteria: list[str], subtypes: list[str]) -> dict:
    """The minimal shape `subtypes_by_criterion_for`/`bag_offsets` read. No `evidenceUnits` at all --
    `unit_texts` falls back to one empty-string instance per record, which is enough to exercise the real
    `train_head`/`save_file` machinery without needing the encoder."""
    return {"input": {}, "target": {"criteria": criteria, "subtypes": subtypes}}


def test_excluded_subtype_is_removed_from_the_per_criterion_list(monkeypatch):
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "2.4.7:focus-removed-on-receipt": {
            "decidedBy": "rules", "reportsAs": "2.4.7", "modelHead": False, "why": "shares every feature with 2.1.1",
        },
        "2.4.7:some-other-subtype": {"decidedBy": "rules", "reportsAs": "2.4.7"},
    }))
    records = [
        record(["2.4.7"], ["2.4.7:focus-removed-on-receipt"]),
        record(["2.4.7"], ["2.4.7:some-other-subtype"]),
    ]
    result = trainer.subtypes_by_criterion_for(records, ["2.4.7"])
    assert result == {"2.4.7": ["2.4.7:some-other-subtype"]}, (
        "the excluded subtype must be gone from the list the training loop iterates, and its untouched "
        "sibling must survive -- a filter that removes everything under the criterion would hide this "
        "bug just as effectively as one that removes nothing"
    )


def test_a_subtype_with_no_modelHead_field_is_unaffected(monkeypatch):
    # The overwhelmingly common case: no entry at all, or an entry with no `modelHead` key. Must behave
    # exactly as before this mechanism existed.
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "4.1.2:regex": {"decidedBy": "rules", "reportsAs": "4.1.2"},
    }))
    records = [record(["4.1.2"], ["4.1.2:regex"])]
    assert trainer.subtypes_by_criterion_for(records, ["4.1.2"]) == {"4.1.2": ["4.1.2:regex"]}


def test_declaration_matches_data_no_longer_crashes_on_an_absent_modelHead_false_subtype(monkeypatch):
    # 1.4.2's own shape: declared, `modelHead: false`, and genuinely absent from every record -- the crash
    # this whole mechanism exists to remove.
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "1.4.2:autoplay-uncontrollable": {
            "decidedBy": "rules", "reportsAs": "1.4.2", "modelHead": False, "why": "no corpus case yet",
        },
        "4.1.2:regex": {"decidedBy": "rules", "reportsAs": "4.1.2"},
    }))
    records = [record(["4.1.2"], ["4.1.2:regex"])]
    trainer.assert_declaration_matches_data(records)  # must not raise


def test_declaration_matches_data_still_catches_a_genuinely_missing_declaration(monkeypatch):
    # The guard this mechanism must NOT weaken: a subtype declared WITHOUT modelHead: false and absent
    # from the data is still exactly the defect `assert_declaration_matches_data` exists to catch.
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "4.1.2:regex": {"decidedBy": "rules", "reportsAs": "4.1.2"},
    }))
    try:
        trainer.assert_declaration_matches_data([])
    except SystemExit as exc:
        assert "4.1.2:regex" in str(exc)
    else:
        raise AssertionError("expected SystemExit for a declared, wholly absent subtype")


def test_declaration_matches_data_still_catches_a_broken_unavailable_exclusion(monkeypatch):
    # The OTHER guard this function carries, unrelated to modelHead, which must survive the refactor:
    # an `unavailable` subtype present in the export is a broken exclusion, not a modelHead question.
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "4.1.2:missing-role": {"decidedBy": "unavailable", "reportsAs": "4.1.2"},
    }))
    records = [record(["4.1.2"], ["4.1.2:missing-role"])]
    try:
        trainer.assert_declaration_matches_data(records)
    except SystemExit as exc:
        assert "4.1.2:missing-role" in str(exc)
        assert "unavailable" in str(exc)
    else:
        raise AssertionError("expected SystemExit for an unavailable subtype present in the data")


def test_modelHead_false_and_present_does_not_trip_the_unavailable_guard(monkeypatch):
    # The bug this file's own author caught before it shipped: deriving `forbidden` from `expected`'s
    # complement conflated "excluded because modelHead: false" with "excluded because unavailable". 2.4.7's
    # own shape -- decidedBy: rules, modelHead: false, PRESENT with real records -- must never be reported
    # as a broken `unavailable` exclusion; it is neither unavailable nor broken.
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        "2.4.7:focus-removed-on-receipt": {
            "decidedBy": "rules", "reportsAs": "2.4.7", "modelHead": False, "why": "shares every feature with 2.1.1",
        },
    }))
    records = [record(["2.4.7"], ["2.4.7:focus-removed-on-receipt"]) for _ in range(9)]
    trainer.assert_declaration_matches_data(records)  # must not raise


def test_no_head_exists_in_a_real_safetensors_artefact_for_the_excluded_subtype():
    """The artefact-level proof. Trains two REAL (tiny, synthetic) heads through `train_head` and
    `save_file` -- the exact functions `main()` calls -- and reads the resulting file back with
    `safetensors`'s own loader, never with this test's memory of what it wrote."""
    import pytest
    # LAB ONLY. `requirements-ci.txt` deliberately does not carry torch (the lab's own header explains
    # why: the test suite needs almost none of the lab's ~torch-and-onnxruntime environment, and pinning
    # CI to the full requirements.txt costs minutes and a large download). This is the one test in the
    # 236-strong CI-side suite that genuinely needs it -- `subtypes_by_criterion_for` above proves the
    # PURE half with no torch at all; this proves the ARTEFACT half, which cannot exist without it. An
    # honest skip, not a silent pass: CI reports it, the lab's real environment runs it for real.
    pytest.importorskip("torch")
    import torch
    from safetensors.torch import save_file
    from safetensors import safe_open

    torch.manual_seed(0)

    excluded_subtype = "2.4.7:focus-removed-on-receipt"
    kept_subtype = "2.4.7:some-other-subtype"

    monkeypatch_ownership = {
        excluded_subtype: {
            "decidedBy": "rules", "reportsAs": "2.4.7", "modelHead": False, "why": "shares every feature with 2.1.1",
        },
        kept_subtype: {"decidedBy": "rules", "reportsAs": "2.4.7"},
    }
    original_ownership = trainer.RULE_OWNERSHIP
    trainer.RULE_OWNERSHIP = monkeypatch_ownership
    try:
        n_records = 12
        records = [
            record(["2.4.7"], [excluded_subtype] if i % 2 == 0 else [kept_subtype])
            for i in range(n_records)
        ]
        subtypes_by_criterion = trainer.subtypes_by_criterion_for(records, ["2.4.7"])
        assert subtypes_by_criterion == {"2.4.7": [kept_subtype]}, (
            "the fixture itself is wrong if the excluded subtype survived the filter -- fix the fixture, "
            "not the assertion below"
        )

        # One instance per record (no evidenceUnits -- see `record()`), so a small random feature matrix
        # stands in for the encoder's real output. `train_head` does not care where features came from.
        offsets = trainer.bag_offsets(records)
        features = torch.randn(n_records, 8)
        indices = list(range(n_records))

        weights = {}
        for subtype in subtypes_by_criterion["2.4.7"]:
            labels = torch.tensor(
                [float(subtype in r["target"]["subtypes"]) for r in records], dtype=torch.float32,
            )
            weight, bias = trainer.train_head(features, offsets, labels, indices, epochs=3)
            key = trainer.head_key(subtype)
            weights[key + ".weight"] = weight
            weights[key + ".bias"] = bias

        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            artefact = Path(tmp) / "model.safetensors"
            save_file(weights, str(artefact))

            with safe_open(str(artefact), framework="pt") as handle:
                artefact_keys = set(handle.keys())

        excluded_key = trainer.head_key(excluded_subtype) + ".weight"
        kept_key = trainer.head_key(kept_subtype) + ".weight"
        assert excluded_key not in artefact_keys, (
            f"{excluded_key} is IN the artefact -- a modelHead: false subtype must never reach a saved "
            "head, whatever the corpus contains"
        )
        assert kept_key in artefact_keys, (
            "the fixture itself is wrong if the kept subtype's head never made it into the artefact -- "
            "fix the fixture, not the assertion above"
        )
    finally:
        trainer.RULE_OWNERSHIP = original_ownership


# ---------------------------------------------------------------------------------------------------------
# `--exclude-subtype` (#2304): leave a head out of ONE run, as an experiment.
#
# It is not `modelHead: false`. That moves who decides a subtype for every run and lives in a tracked file;
# this is a per-run lever so #2258's isolating retrain can be dispatched without editing either. Because a
# model missing a head must never pass for a full one, it is also stamped ineligible -- and that stamp is
# only worth asserting against a positive control, hence the eligible run beside it below.
# ---------------------------------------------------------------------------------------------------------

ALPHA = "9.1.1:alpha"
BETA = "9.1.1:beta"
SYNTHETIC_FEATURE_WIDTH = 8


def test_an_exclusion_applies_to_the_call_it_was_passed_to_and_no_other(monkeypatch):
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", fake_ownership(**{
        ALPHA: {"decidedBy": "model", "reportsAs": "9.1.1"},
        BETA: {"decidedBy": "model", "reportsAs": "9.1.1"},
    }))
    records = [record(["9.1.1"], [ALPHA]), record(["9.1.1"], [BETA])]
    assert trainer.subtypes_by_criterion_for(records, ["9.1.1"], exclude=[BETA]) == {"9.1.1": [ALPHA]}
    assert trainer.subtypes_by_criterion_for(records, ["9.1.1"]) == {"9.1.1": [ALPHA, BETA]}, (
        "an exclusion leaked into the next call: it must be an argument, never a change to who decides")
    assert trainer.RULE_OWNERSHIP[BETA] == {"decidedBy": "model", "reportsAs": "9.1.1"}, (
        "the exclusion rewrote the ownership table, which is exactly what this lever exists NOT to do")


def test_an_unknown_or_headless_subtype_is_refused_not_ignored():
    available = {"9.1.1": [ALPHA, BETA]}
    for excluded, culprit in ((["9.1.1:betaa"], "9.1.1:betaa"), ([ALPHA, "9.9.9:nope"], "9.9.9:nope")):
        try:
            trainer.refuse_unknown_exclusions(available, excluded)
        except SystemExit as exc:
            assert culprit in str(exc) and "FULL model" in str(exc), str(exc)
        else:
            raise AssertionError(f"{excluded} was accepted; a typo would train a full model as 'excluded'")
    assert trainer.refuse_unknown_exclusions(available, [BETA, ALPHA, BETA]) == [ALPHA, BETA], (
        "a valid list comes back sorted and deduplicated, which is what the report records")
    assert trainer.refuse_unknown_exclusions(available, []) == []


def test_the_flag_is_repeatable(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["train", "--exclude-subtype", ALPHA, "--exclude-subtype", BETA])
    assert trainer.parse_args().exclude_subtype == [ALPHA, BETA]
    monkeypatch.setattr(sys, "argv", ["train"])
    assert trainer.parse_args().exclude_subtype == [], "no flag must mean no exclusion"


def synthetic_dataset() -> list[dict]:
    """240 records over 40 families; `ALPHA` on every 6th and `BETA` on every 5th, so each has dozens of
    positives and neither is starved of the 20 the trainer wants."""
    return [
        {"input": {}, "provenance": {"family": f"family-{i % 40}"},
         "target": {"criteria": ["9.1.1"] if (i % 6 == 0 or i % 5 == 0) else [],
                    "subtypes": [s for s, every in ((ALPHA, 6), (BETA, 5)) if i % every == 0]}}
        for i in range(240)
    ]


def train_synthetic(monkeypatch, tmp_path, *extra_args: str) -> tuple[dict, set[str]]:
    """Runs the REAL `main()` -- argument parsing, exclusion, calibration, saving -- on synthetic records with
    only the encoder and the corpus reads stubbed, and returns the `training-report.json` and the keys of
    `model.safetensors` READ BACK from disk. Not the dict `main()` built."""
    import pytest
    pytest.importorskip("torch")
    import numpy as np
    from safetensors import safe_open

    generator = np.random.default_rng(0)
    records = synthetic_dataset()

    def fake_encode(_training, recs, _encoder, _max_length):
        features = generator.normal(size=(len(recs), SYNTHETIC_FEATURE_WIDTH)).astype("float32")
        for row, rec in enumerate(recs):
            for column, subtype in enumerate((ALPHA, BETA)):
                if subtype in rec["target"]["subtypes"]:
                    features[row, column] += 3
        return features, features.copy(), list(range(len(recs) + 1)), SYNTHETIC_FEATURE_WIDTH, 0

    tmp_path.mkdir(parents=True, exist_ok=True)
    data, encoder, output = tmp_path / "data.jsonl", tmp_path / "encoder", tmp_path / "model"
    data.write_text("{}\n")
    encoder.write_text("x")
    monkeypatch.setitem(sys.modules, trainer.__name__, trainer)  # `main()` hands its own module to the cache
    monkeypatch.setattr(trainer, "RULE_OWNERSHIP", {})
    monkeypatch.setattr(trainer, "cached_encode", fake_encode)
    monkeypatch.setattr(trainer, "assert_encoder", lambda path: path)
    monkeypatch.setattr(trainer, "assert_dataset_is_current", lambda path: None)
    monkeypatch.setattr(trainer, "read_records", lambda path: records)
    # Tiny synthetic data cannot meet the type-I calibration bound, which would leave EVERY run ineligible
    # and make "an exclusion makes it ineligible" pass having examined nothing. Neutralised so the control
    # run below is eligible, and the exclusion is the only thing that can change that.
    monkeypatch.setattr(trainer, "type_one_error_blocker", lambda *args, **kwargs: None)
    monkeypatch.setattr(sys, "argv", ["train", "--data", str(data), "--encoder", str(encoder),
                                      "--output", str(output), "--epochs", "2", *extra_args])
    trainer.main()
    report = json.loads((output / "training-report.json").read_text(encoding="utf-8"))
    with safe_open(str(output / "model.safetensors"), framework="pt") as handle:
        return report, set(handle.keys())


def test_a_model_trained_with_an_exclusion_has_no_such_head_and_cannot_pass_for_a_full_one(monkeypatch, tmp_path):
    control_report, control_keys = train_synthetic(monkeypatch, tmp_path / "full")
    assert control_report["releaseEligible"] is True, (
        "the POSITIVE CONTROL failed: a run with no exclusion is not eligible, so the assertion below "
        "would pass whatever the exclusion did")
    assert control_report["excludedSubtypes"] == []
    assert trainer.head_key(BETA) + ".weight" in control_keys

    report, keys = train_synthetic(monkeypatch, tmp_path / "left-out", "--exclude-subtype", BETA)
    assert trainer.head_key(BETA) + ".weight" not in keys, "the excluded head is IN the saved artefact"
    assert trainer.head_key(ALPHA) + ".weight" in keys, "the kept head vanished: the filter removed too much"
    assert report["excludedSubtypes"] == [BETA]
    assert report["releaseEligible"] is False and report["modelReleaseEligible"] is False, (
        "a model missing a head the release model has must never be promotable")
    assert any(BETA in blocker and "--exclude-subtype" in blocker for blocker in report["releaseBlockedBy"]), (
        f"the report must SAY why it cannot be released: {report['releaseBlockedBy']}")


def test_a_typo_in_an_exclusion_trains_nothing(monkeypatch, tmp_path):
    try:
        train_synthetic(monkeypatch, tmp_path, "--exclude-subtype", "9.1.1:betaa")
    except SystemExit as exc:
        assert "9.1.1:betaa" in str(exc)
    else:
        raise AssertionError("a name matching no head was accepted")
    assert not (tmp_path / "model").exists(), "the refusal came AFTER output was written"


def test_leaving_out_every_head_of_a_criterion_is_reported_as_an_experiment_not_as_ownership(monkeypatch, tmp_path):
    report, keys = train_synthetic(monkeypatch, tmp_path, "--exclude-subtype", ALPHA, "--exclude-subtype", BETA)
    entry = report["criteria"]["9.1.1"]
    assert entry["subtypes"] == {} and entry["modelHead"] is False, (
        "an emptied criterion must keep the declaration `score.py` needs to LOAD it")
    assert entry["excludedSubtypes"] == [ALPHA, BETA]
    assert "rules decide" not in entry["why"], (
        "the rules do not own this criterion: reading 'no head' as settled ownership is the misreading")
    assert not [key for key in keys if "9_1_1" in key or "alpha" in key or "beta" in key]

