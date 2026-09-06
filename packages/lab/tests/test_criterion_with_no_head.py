"""A criterion whose every subtype is `modelHead: false` must be REPORTED, never crashed on.

`modelHead: false` removes a subtype from `subtypes_by_criterion_for`. When it removes a criterion's ONLY
subtype, `main()`'s per-criterion loop reached `torch.stack([])` and died:

    RuntimeError: stack expects a non-empty TensorList

Measured 2026-09-06 on the first train after `1.4.2:autoplay-uncontrollable` and
`2.4.7:focus-removed-on-receipt` were declared. Both are the SOLE subtype of their criterion, so both
criteria emptied at once, and the train failed after the encoder pass -- having already rotated the previous
release-eligible model aside. The message says nothing about the cause and points at torch.

This is the `modelHead` deadlock one layer along: the exemption was threaded through five sites and the
per-criterion loop was the sixth, because a criterion with no subtypes had been impossible until that
field existed. `subtype-vocabulary.test.ts` records the same lesson from the other side -- redefine what
"real subtype" means once, rather than exempt at each site.

Tested against `subtypes_by_criterion_for` directly, which is a pure function of `records` and needs no
encoder, corpus or torch -- the reason it was extracted from `main()` in the first place.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

_spec = importlib.util.spec_from_file_location(
    "train_model", ROOT / "packages" / "lab" / "scripts" / "train-screenreader-model.py")
train = importlib.util.module_from_spec(_spec)
sys.modules["train_model"] = train
_spec.loader.exec_module(train)

OWNERSHIP = json.loads((ROOT / "packages" / "lab" / "rule-ownership.json").read_text())


def declared_no_head() -> list[str]:
    entries = OWNERSHIP.get("subtypes", OWNERSHIP)
    return [k for k, v in entries.items() if isinstance(v, dict) and v.get("modelHead") is False]


def test_the_real_declarations_do_empty_at_least_one_criterion():
    """The premise. If no criterion is emptied by the real declarations this test proves nothing, and the
    crash it guards against could not happen -- so say that out loud rather than pass vacuously."""
    no_head = declared_no_head()
    assert no_head, "no subtype is declared `modelHead: false`, so this guard examines nothing"
    criteria = {s.split(":")[0] for s in no_head}
    entries = OWNERSHIP.get("subtypes", OWNERSHIP)
    emptied = [
        c for c in criteria
        if all(v.get("modelHead") is False
               for k, v in entries.items() if isinstance(v, dict) and k.startswith(c + ":"))
    ]
    assert emptied, (
        "no criterion has ALL of its subtypes declared `modelHead: false`, so the empty-list case cannot "
        "arise from the real declarations. Keep this test; it becomes live again the moment one does.")


def test_a_criterion_whose_only_subtype_is_headless_maps_to_an_empty_list():
    # Not to a MISSING key: the loop iterates `criteria` and indexes this dict, so a missing key would be a
    # KeyError rather than the reportable "no head" state.
    records = [{"target": {"criteria": ["9.9.9"], "subtypes": ["9.9.9:only"]}}]
    train.RULE_OWNERSHIP["9.9.9:only"] = {"decidedBy": "rules", "reportsAs": "9.9.9", "modelHead": False}
    try:
        mapped = train.subtypes_by_criterion_for(records, ["9.9.9"])
    finally:
        train.RULE_OWNERSHIP.pop("9.9.9:only", None)
    assert mapped == {"9.9.9": []}, (
        f"expected the criterion to map to an EMPTY list, got {mapped!r} -- the per-criterion loop indexes "
        "this dict, so a missing key is a KeyError rather than a state anything can report")


def test_the_loop_skips_an_empty_criterion_and_says_so():
    """Asserted on the SOURCE: reaching the loop needs the encoder, the corpus and torch, and this repo's
    own rule is that a guard which cannot run is not a guard. What is pinned is the two things that make
    the skip honest -- it is `continue`d rather than crashed on, and it is RECORDED rather than omitted.

    "This criterion has no trained head" and "this criterion was never considered" are different states, and
    a report that drops the criterion entirely cannot tell them apart. Same rule `printCoverage` follows for
    `decidedBy: "unavailable"`: the map of who decides what, where "nobody" is the answer most worth seeing.
    """
    source = (ROOT / "packages" / "lab" / "scripts" / "train-screenreader-model.py").read_text()
    assert "if not subtypes_by_criterion[criterion]:" in source, (
        "the per-criterion loop no longer checks for an empty subtype list, so torch.stack([]) is "
        "reachable again")
    guard = source.split("if not subtypes_by_criterion[criterion]:", 1)[1].split("continue", 1)[0]
    assert 'report["criteria"][criterion]' in guard, (
        "the skipped criterion must still appear in the report; omitting it makes 'no head' and 'never "
        "considered' the same silence")
    assert '"modelHead": False' in guard, "the report entry must say WHY there is no head"
    assert "note(report," in guard, "and it must be said in the notes a human reads, not only in JSON"
