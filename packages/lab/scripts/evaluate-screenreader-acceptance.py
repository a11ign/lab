#!/usr/bin/env python3
"""Evaluate the scorer on a capture set that is disjoint from training.

The acceptance set is never used to fit heads or thresholds. If multiple exported
files are supplied, repeated case/variant records are also used to measure whether
the same NVDA interaction crosses the model threshold between captures.
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


# Two different anchors, because this file needs two different things and one variable was doing both jobs:
# the SCORER PACKAGE (a sibling package) and the CORPUS (`runs/`, at the repo root). After M8 moved this file
# into `packages/lab/scripts/`, the single `parents[1]` anchor pointed at `packages/lab` and produced
# `packages/lab/packages/scorer/python/score.py` — a path that does not exist.
REPO_ROOT = Path(__file__).resolve().parents[3]

# The weights, the encoder and the scoring program live in `@a11ign/scorer` (PLAN.md M3). Anchored on
# the package directory rather than on `models/` at the repo root, which no longer holds them.
# `packages/lab/scripts/` -> `packages/` -> `packages/scorer`. It was `parents[1] / "packages" / "scorer"`,
# which resolved to `packages/lab/packages/scorer` once M8 moved this file into the lab package — a path that
# does not exist, and the failure was `ModuleNotFoundError: No module named 'screenreader_features'`.
SCORER_PACKAGE = Path(__file__).resolve().parents[2] / "scorer"
# The DECISION lives in the scorer package, so this reaches for it rather than reimplementing it. Loaded
# by path for the same reason `score.py` is: this file is not inside that package and must not assume an
# installed one.
sys.path.insert(0, str(SCORER_PACKAGE / "python"))
import applicability  # noqa: E402  (path shim must precede the import)


def load_training_module() -> Any:
    path = Path(__file__).with_name("train-screenreader-model.py")
    spec = importlib.util.spec_from_file_location("screenreader_training", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load training helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_scorer_module() -> Any:
    path = SCORER_PACKAGE / "python" / "score.py"
    spec = importlib.util.spec_from_file_location("screenreader_scorer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load scorer helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", action="append", type=Path)
    parser.add_argument("--training-data", type=Path, default=REPO_ROOT / "runs/screenreader-dataset/screenreader-evidence.jsonl")
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models/encoders/all-MiniLM-L6-v2")
    parser.add_argument("--model", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer", help="scorer directory or model.safetensors path")
    parser.add_argument("--training-report", type=Path, default=SCORER_PACKAGE / "models/screenreader-scorer/training-report.json")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "runs/screenreader-acceptance/acceptance-report.json")
    # A gate you cannot run until you have already passed it is not a gate. This evaluator hard-coded
    # `allow_ineligible=False`, so the held-out set could only ever CONFIRM a release decision, never
    # inform one -- and since release-eligibility currently demands zero errors, it could not be used
    # to ask whether that bar is the right one. Diagnostics-only, and the report says so.
    parser.add_argument("--allow-ineligible", action="store_true",
                        help="score a model that is not releaseEligible; for measurement, never for release")
    parser.add_argument("--min-positive", type=int, default=3)
    parser.add_argument("--min-clean", type=int, default=3)
    parser.add_argument("--max-length", type=int, default=256)
    args = parser.parse_args()
    if not args.data:
        args.data = [REPO_ROOT / "runs/screenreader-acceptance/screenreader-evidence.jsonl"]
    return args


def model_directory(path: Path) -> Path:
    """Accept the historical file argument while verifying the complete artifact directory."""
    if path.is_dir() or path.suffix == "":
        return path
    return path.parent


def load_records_by_path(training: Any, paths: list[Path]) -> dict[str, list[dict[str, Any]]]:
    """The records of each `--data` file, kept SEPARATE rather than concatenated.

    Every reader below wants the flat list, and `flatten` gives it — but two do not, and both were
    re-reading the files to get what this already had: the per-file record counts in `report_skeleton`,
    and the case-existence refusal, which must name a count PER REPEAT because that is the number a
    reader compares against the floor (#1852 read `repeat-1.jsonl has 436 records`, not the sum).
    """
    by_path: dict[str, list[dict[str, Any]]] = {}
    for path in paths:
        if not path.is_file():
            raise RuntimeError(f"acceptance data is missing: {path}")
        by_path[str(path)] = training.read_records(path)
    if not any(by_path.values()):
        raise RuntimeError("acceptance data is empty")
    return by_path


def flatten(by_path: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [record for records in by_path.values() for record in records]


# The case definitions the code has, asked of the code. `packages/lab/src/training/acceptance-matrix.mjs`
# is JavaScript and this evaluator is Python, so neither can import the other — the same bind
# `audit_grants.py` is in, and this is its answer: ask node, rather than re-parsing the source with a
# regex. A regex over an `id: "..."` literal would be a SECOND definition of the case set that can match
# nothing and still pass, which is the defect class this guard exists to close, one level up.
ACCEPTANCE_MATRIX = "./packages/lab/src/training/acceptance-matrix.mjs"


def defined_cases() -> dict[str, dict[str, Any]]:
    """Every case `ALL_ACCEPTANCE_CASES` defines RIGHT NOW, WHOLE — the id and every other field.

    IT ASKED FOR `.id` ALONE UNTIL #2129, AND THAT ONE PROJECTION WAS THE WHOLE BLIND SPOT: a case can be
    REDEFINED while keeping its id, and every stored record of it still reads as valid. The capture path
    has compared definitions since #958 (`manifest-matches-cases.mjs`); this evaluator compared names.
    Widening it here rather than at the call site, because a caller that asks for ids cannot later decide
    it wanted more.

    Derived at evaluation time and never cached to a file on purpose. A generated artefact under `runs/`
    would be the transport `corpus:grants-audit` uses — and `lab-job.yml` records what that costs:
    "The audit refuses an ABSENT map and cannot see a STALE one, so the failure is silent by
    construction." A stale copy of exactly this fact is what this row is about, so the copy does not exist.

    LOUD ON FAILURE, never an empty result. An empty set makes every stored record unknown and the refusal
    below fires on the whole corpus, which reads as a corpus defect when the real fault is that node did
    not run. `CANNOT_TELL` loudly beats a wrong verdict in either direction.
    """
    script = (
        f'import {{ ALL_ACCEPTANCE_CASES }} from "{ACCEPTANCE_MATRIX}";'
        'process.stdout.write(JSON.stringify(Object.fromEntries('
        'ALL_ACCEPTANCE_CASES.map((testCase) => [testCase.id, testCase]))));'
    )
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT, capture_output=True, text=True,
        )
    except FileNotFoundError as missing:
        raise SystemExit(
            "cannot read the acceptance case definitions: `node` is not on PATH, and this evaluator has "
            "no other way to ask JavaScript what cases it defines.\n"
            "Run it from a checkout with node available — the lab has one, and every other route to this "
            "fact is a second copy of it that can go stale."
        ) from missing
    if result.returncode != 0:
        raise SystemExit(
            f"cannot read the acceptance case definitions from {ACCEPTANCE_MATRIX}: node exited "
            f"{result.returncode}.\n{result.stderr.strip()}\n"
            "This evaluator refuses rather than scoring without them: it cannot tell a record whose case "
            "was deleted from one whose case is merely unreadable, and those need opposite responses."
        )
    cases = json.loads(result.stdout)
    if not cases:
        raise SystemExit(
            f"{ACCEPTANCE_MATRIX} defines no acceptance cases. That is not a corpus this evaluator can "
            "judge anything against — every stored record would read as unknown."
        )
    return cases


def defined_case_ids() -> set[str]:
    """The id-only view of `defined_cases`, which is all `assert_cases_exist` needs.

    KEPT AS ITS OWN NAME, and derived rather than asked for separately: #2098's question is "does this
    case exist", #2129's is "is it the same case", and the second subsumes the first without replacing
    it. `main()` calls `defined_cases()` once and passes both views on, so the node subprocess runs once
    per evaluation whichever question is being asked.
    """
    return set(defined_cases())


# What an absent `provenance.caseId` is reported as. A name, not `None`, so the message reads as a finding
# rather than as the guard having crashed on a null.
NO_CASE_ID = "<no caseId>"


def unknown_case_ids(records: list[dict[str, Any]], defined: set[str]) -> dict[str, int]:
    """The case ids these records name that the code does not define, and how many records name each.

    Pure, and separate from both the node call above and the refusal below, so the question it answers —
    "which of these records describe a case that no longer exists?" — is testable with a plain fixture.

    A record with NO `caseId` is counted too, under `NO_CASE_ID`. It is the same failure from the reader's
    side: a record this evaluator cannot attribute to a case definition. Silently skipping it would be the
    subset-scoring this whole guard refuses.
    """
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        # `or {}` and not a default, because a record CAN carry `"provenance": null` -- a default only
        # covers the absent key, and this guard runs before anything else touches the records, so an
        # AttributeError here would replace the refusal with a traceback on the very record it is for.
        case_id = (record.get("provenance") or {}).get("caseId") or NO_CASE_ID
        if case_id not in defined:
            counts[case_id] += 1
    return dict(counts)


# Enough ids to see the pattern — one family, one id prefix — without turning a refusal into a corpus dump.
# The same bound, for the same reason, as `assertManifestMatchesCases`'s `NAMED`.
NAMED_UNKNOWN_CASES = 8


def assert_cases_exist(by_path: dict[str, list[dict[str, Any]]], defined: set[str]) -> None:
    """REFUSE to score records whose case definitions the code does not have.

    The capture path has checked this since #958 (`assertManifestMatchesCases`) and this evaluator never
    did, and that asymmetry is the whole of #2094: `training:capture` refused outright the moment a
    capture was attempted against a manifest naming cases that had left `CASES`, while `job=acceptance`
    went on scoring the STORED records of those same cases and reporting a number. Measured on the lab
    2026-09-23: 290 of 436 records per repeat named `acceptance-b3-*` cases introduced by a commit that
    reached no branch on `main` and never had a pull request. Every held-out reading taken between
    2026-09-21 and then — including the two that closed #1852's record floor and #37's resolution bound —
    was computed mostly from cases this repository does not contain.

    FAIL-CLOSED, and with no fixture escape. `manifestDrift` has one — a manifest sharing NO id with
    `CASES` is a deliberately different set (a test fixture, an archived corpus under `DATASET_ROOT`), and
    comparing it would report every id missing. There is no such reading here: this evaluator scores the
    held-out acceptance set against the case definitions that set was built from, so a record it cannot
    attribute is exactly the thing it must not quietly leave out of a denominator.

    PER FILE, because the number that matters is per repeat. A sum across repeats describes no set: two
    repeats of 436 are 436 independent observations (`resolution`'s own argument), so "580 records" would
    be a count of nothing a floor or a Wilson bound is ever stated at.
    """
    unknown_by_path = {path: unknown_case_ids(records, defined) for path, records in by_path.items()}
    if not any(unknown_by_path.values()):
        return
    lines = []
    for path, unknown in unknown_by_path.items():
        if not unknown:
            continue
        lines.append(f"  {path}: {sum(unknown.values())} of {len(by_path[path])} records, "
                     f"{len(unknown)} distinct case id(s)")
        for case_id in sorted(unknown)[:NAMED_UNKNOWN_CASES]:
            lines.append(f"    {case_id}: named by {unknown[case_id]} record(s), not in ALL_ACCEPTANCE_CASES")
        if len(unknown) > NAMED_UNKNOWN_CASES:
            lines.append(f"    ... and {len(unknown) - NAMED_UNKNOWN_CASES} more")
    raise SystemExit(
        "refusing to score: these acceptance records name case definitions this code does not have, so "
        "the report would be a number computed from a corpus the repository cannot reproduce.\n"
        + "\n".join(lines)
        + f"\n({len(defined)} case(s) defined in {ACCEPTANCE_MATRIX}.)\n"
        "Either the cases they were captured under were never merged, or they have since been removed. "
        "Both are the same problem for a held-out number: it cannot be re-derived. Land the definitions, "
        "or recapture at this commit — never evaluate the subset, because a floor or a false-positive "
        "bound stated over an unknown denominator is not a measurement."
    )


# WHERE A STORED CORPUS RECORDS WHAT IT WAS CAPTURED UNDER. Two files, because one case definition is
# written to disk in two pieces and neither piece alone is the definition:
#
#   manifest.json        every field of the case EXCEPT the two page bodies, plus `pages` (their paths)
#   pages/<id>/*.html    the page bodies, written byte-for-byte from the case's own `good` and `bad`
#                        (`writeCasePages`: `writeFileSync(path, testCase[variant], "utf8")`)
#
# THE UNION IS THE WHOLE DEFINITION, and that is not a convenience — it is why this guard can see the
# redefinition #2129 was filed on. `title`, `field` and `submit` reach neither `provenance` nor the
# manifest: they exist on disk only inside the rendered HTML. #1918's control rests on
# `acceptance-b2-error-plot`'s `submit`, and renaming it changes `badSignal.control` in the manifest AND
# both page bodies, while every stored record stays byte-identical. A guard that read the manifest alone
# would catch that one by luck, through `badSignal`; it would not catch a changed `title` at all.
MANIFEST_NAME = "manifest.json"

# `pages` is the manifest's own bookkeeping — where the page bodies were written, relative to the run
# root. It is not part of the case (`ALL_ACCEPTANCE_CASES` has no such field) and comparing it would
# report every case as drifted. `manifestDrift` excepts it for the same reason and says so.
MANIFEST_ONLY_FIELDS = frozenset({"pages"})

# What a case is reported as when the corpus records no definition for it at all -- the manifest beside
# the records does not list it, so there is nothing to compare and nothing that can be concluded. A named
# finding rather than a silent skip: a record whose captured definition is unrecoverable is exactly the
# thing this evaluator must not quietly leave in a denominator.
UNRECORDED_DEFINITION = "<not in the manifest beside these records>"


def captured_definitions(data_path: Path) -> dict[str, dict[str, Any]]:
    """The case definitions the corpus beside `data_path` was captured under, id -> definition.

    REFUSES AN ABSENT MANIFEST rather than skipping the check. A missing manifest is not "nothing
    drifted", it is "this evaluator cannot tell" — and those need opposite responses. The same reading
    `defined_cases` refuses node's silence for.

    A page file that is missing reads as `None` for that variant, which differs from any string the code
    can define, so it surfaces as drift naming that variant rather than as a traceback.
    """
    root = data_path.parent
    manifest_path = root / MANIFEST_NAME
    if not manifest_path.is_file():
        raise SystemExit(
            f"refusing to score: {data_path} has no {MANIFEST_NAME} beside it, so there is no record of "
            "the case definitions these captures were taken under.\n"
            "The evaluator can tell that a case still EXISTS (#2094) but not that it is still the SAME "
            "case, and a held-out number computed over silently redefined cases is not reproducible.\n"
            f"Point --data at a run directory written by `training:generate-acceptance` (it writes "
            f"{MANIFEST_NAME} at the run root), or regenerate and recapture."
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    captured: dict[str, dict[str, Any]] = {}
    for entry in manifest.get("cases", []):
        definition = {field: value for field, value in entry.items() if field not in MANIFEST_ONLY_FIELDS}
        for variant, relative_path in (entry.get("pages") or {}).items():
            page = root / relative_path
            definition[variant] = page.read_text(encoding="utf-8") if page.is_file() else None
        captured[entry["id"]] = definition
    return captured


def _canonical(value: Any) -> str:
    """Key-sorted JSON, so two definitions differing only in key order compare equal.

    Both sides arrive as parsed JSON — the manifest from disk, the current cases from node — so this is a
    like-for-like comparison of content and not a second implementation of anyone's serialisation.
    """
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def changed_case_definitions(records: list[dict[str, Any]], captured: dict[str, dict[str, Any]],
                             current: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Which cases these records name whose DEFINITION has changed since they were captured, and how.

    Pure, and separate from both the node call above and the refusal below, exactly as
    `unknown_case_ids` is: records + what they were captured under + what the code means now -> id ->
    the fields that differ and how many records carry it.

    A FIELD THE CURRENT CASE HAS AND THE CAPTURED ONE DOES NOT IS DRIFT, not a gap to skip. That is what
    makes the coverage claim above self-enforcing rather than a comment: add a field to a case that the
    manifest does not carry and every case reads as drifted on it, loudly, instead of the new field
    silently escaping comparison for ever.

    CASES WHOSE ID IS NOT DEFINED AT ALL ARE LEFT ALONE — that is `assert_cases_exist`'s refusal (#2094),
    it fires first, and reporting them twice would describe one corpus defect as two.
    """
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        # `or {}` and not a default, for the reason `unknown_case_ids` states: a record CAN carry
        # `"provenance": null`.
        case_id = (record.get("provenance") or {}).get("caseId")
        if case_id:
            counts[case_id] += 1
    changed: dict[str, dict[str, Any]] = {}
    for case_id, count in counts.items():
        now = current.get(case_id)
        if now is None:
            continue
        was = captured.get(case_id)
        fields = ([UNRECORDED_DEFINITION] if was is None else
                  sorted(field for field in set(was) | set(now)
                         if _canonical(was.get(field)) != _canonical(now.get(field))))
        if fields:
            changed[case_id] = {"records": count, "fields": fields}
    return changed


# How much of a differing value to show. Enough to recognise WHICH change it is -- a renamed control, a
# reworded task -- without printing a page body: `good` and `bad` are whole HTML documents, and a refusal
# that dumps two of them per case is one nobody reads.
SHOWN_VALUE = 60

# Enough fields per case to see whether one string moved or the whole case was rewritten.
NAMED_CHANGED_FIELDS = 6


def _shown(value: Any) -> str:
    text = _canonical(value)
    return text if len(text) <= SHOWN_VALUE else text[:SHOWN_VALUE] + f"… ({len(text)} chars)"


def _changed_field_lines(case_id: str, fields: list[str], captured: dict[str, dict[str, Any]],
                         current: dict[str, dict[str, Any]]) -> list[str]:
    lines = []
    for field in fields[:NAMED_CHANGED_FIELDS]:
        if field == UNRECORDED_DEFINITION:
            lines.append(f"      {UNRECORDED_DEFINITION}")
            continue
        was = captured.get(case_id, {}).get(field)
        now = current.get(case_id, {}).get(field)
        lines.append(f"      {field}: captured={_shown(was)} CASES={_shown(now)}")
    if len(fields) > NAMED_CHANGED_FIELDS:
        lines.append(f"      ... and {len(fields) - NAMED_CHANGED_FIELDS} more field(s)")
    return lines


def assert_case_definitions_unchanged(by_path: dict[str, list[dict[str, Any]]],
                                      captured_by_path: dict[str, dict[str, dict[str, Any]]],
                                      current: dict[str, dict[str, Any]]) -> None:
    """REFUSE to score records whose case definitions have CHANGED since they were captured.

    `assert_cases_exist` refuses a record whose case the code no longer has; this refuses one whose case
    the code still has under the same id and no longer means the same thing. The second is the quieter
    failure of the two: nothing about the record, the id or the count looks wrong, and the number comes
    out — computed over pages the model never saw, or labelled against a `badSignal` that has moved.

    PER FILE and fail-closed, for the reasons `assert_cases_exist` states: the number that matters is per
    repeat, and a subset scored silently is the defect this whole family exists to close.

    THE REMEDY IT PRINTS IS A FULL, BOTH-REPEAT RECAPTURE, AND SAYS SO (#2168). It named the TRAINING
    jobs (`generate`, `capture`), which write `runs/screenreader-dataset` and leave this refusal
    byte-identical, and it said "recapture the cases named above" although no job can do that: the
    acceptance capture never caches, and its catalogue entries take no `only`. SCOPING IS REFUSED, NOT
    MISSING: a corpus part-recaptured on a later day holds two populations that nothing records
    (`lab:inventory` found four worker-code populations and two Edge builds in the training corpus on
    2026-08-25, and its cache key exists for that), and this corpus is the one that decides whether a
    candidate ships. So the message states the real cost instead of implying a cheaper one.
    `acceptance-remedy-names-its-own-jobs.test.ts` reads the job names back out of this message.
    """
    changed_by_path = {path: changed_case_definitions(records, captured_by_path.get(path, {}), current)
                       for path, records in by_path.items()}
    if not any(changed_by_path.values()):
        return
    lines = []
    for path, changed in changed_by_path.items():
        if not changed:
            continue
        affected = sum(case["records"] for case in changed.values())
        lines.append(f"  {path}: {affected} of {len(by_path[path])} records, "
                     f"{len(changed)} redefined case(s)")
        for case_id in sorted(changed)[:NAMED_UNKNOWN_CASES]:
            case = changed[case_id]
            lines.append(f"    {case_id}: {case['records']} record(s), "
                         f"{len(case['fields'])} field(s) differ")
            lines.extend(_changed_field_lines(case_id, case["fields"],
                                              captured_by_path.get(path, {}), current))
        if len(changed) > NAMED_UNKNOWN_CASES:
            lines.append(f"    ... and {len(changed) - NAMED_UNKNOWN_CASES} more")
    raise SystemExit(
        "refusing to score: these acceptance records were captured under case definitions that no longer "
        "match the ones this code has, so the report would grade captures of one page against the labels "
        "of another.\n"
        + "\n".join(lines)
        + "\nRecapture the HELD-OUT ACCEPTANCE corpus at this commit, on the box that owns it. There is no"
        "\nscoped form: acceptance runs never cache, so this is EVERY case, twice, whatever the number named"
        "\nabove:"
        "\n  npm run lab:job -- -e job=generate-acceptance"
        "\n  npm run lab:job -- -e job=capture-acceptance     # repeat-1"
        "\n  npm run lab:job -- -e job=capture-acceptance-2   # repeat-2"
        "\n  npm run lab:job -- -e job=export-acceptance      # rewrites both repeat-N.jsonl files above"
        "\nNever evaluate the rest and report a number: a held-out reading states what the corpus IS, and "
        "a corpus the repository cannot reproduce states nothing."
    )


def pooled_views(training: Any, records: list[dict[str, Any]], encoder: Path, max_length: int) -> dict[str, Any]:
    """Both views of the records, keyed exactly as the trainer keys them. A document-pooled head sees a bag of one.

    EXTRACTED so `explain-case.py` asks the SAME question the evaluator does: a second copy of these
    four lines is a second way to featurize a record, and it would answer confidently about features the
    model never saw the day one of them changed.
    """
    features, _, _ = training.encode_records(records, encoder, max_length)
    return {
        "instance-max": (features, training.bag_offsets(records)),
        "document-mean": training.encode_documents(records, encoder, max_length),
    }


def score_subtypes(training: Any, subtype_reports: dict[str, Any], views: dict[str, Any], weights: Any) -> dict[str, Any]:
    """One score per RECORD per SUBTYPE, each head using its own pooling.

    `encode_records` returns a row per EVIDENCE UNIT, not per record. This function used to hand that
    matrix straight to `score_head`, so it produced ~54,000 scores to compare against 120 labels —
    every held-out number it reported after multiple-instance pooling landed was meaningless, and it
    read as the model detecting nothing rather than as a broken comparison. That is the train/inference
    asymmetry this pooling change was warned to watch for, in the one file that measures generalisation.

    It returned `amax` over the heads until now, for one criterion-level threshold to cut. That is the
    same arithmetic `score.py` removed: the heads are on different scales, so one cut over their maximum
    cannot be calibrated. Each head is cut on its own distribution and the criterion is the OR — and when
    the criterion-level `threshold` disappeared from the report, THIS file kept reading it and died with
    `KeyError: 'threshold'`. `release:gate` runs this evaluator, so that gate was broken from the same
    commit, invisibly, because the `releaseEligible` refusal in front of it fired first.
    """

    scores = {}
    for subtype, subtype_details in subtype_reports.items():
        weight = weights[subtype_details["head"] + ".weight"]
        bias = weights[subtype_details["head"] + ".bias"]
        view_features, view_offsets = views[subtype_details.get("pooling", "document-mean")]
        # numpy, matching the featurizer: this script only EVALUATES, so nothing here needs autograd,
        # and `score_bags` returns numpy for exactly that reason.
        scores[subtype] = training.score_bags(view_features, view_offsets, weight, bias)
    return scores


# How many failing cases to name before the list stops being read. Enough to see a pattern -- one subtype
# repeating, or one page family -- without turning a report into a corpus dump.
MAX_NAMED_FAILURES = 12


def case_identity(record: dict[str, Any]) -> str:
    """`caseId/variant` — the same key the stability grouping uses, so a name here matches a name there."""
    provenance = record.get("provenance", {})
    return f"{provenance.get('caseId', '?')}/{provenance.get('variant', '?')}"


def metrics(scores: Any, labels: Any, threshold: float, identities: list[str] | None = None) -> dict[str, Any]:
    """Counts, and WHICH records produced them.

    It returned counts alone, and a count is where an investigation stops rather than starts. Measured
    2026-08-23 against the shipped model on a fresh held-out set: `1.3.1: acceptance false negatives` and
    `2.4.6: acceptance false positives`, two of each. From the report it was impossible to tell whether that
    was one subtype systematically missed or two unlucky pages -- and those need completely different
    responses. Answering it meant re-running the evaluator by hand with print statements.

    This repo already states the rule, in `capture-real-pages`: "Named, not counted. '3 failed' tells you
    nothing about whether the corpus is usable." The same argument that made `crossCheckStructure` report
    `link 51/58` instead of "examination was INCOMPLETE".

    Bounded and marked when truncated, because a report nobody can read is its own kind of silence.
    """
    predicted = scores >= threshold
    true_positive = int((predicted & labels).sum())
    false_positive = int((predicted & ~labels).sum())
    false_negative = int((~predicted & labels).sum())
    clean = int((~labels).sum())
    named: dict[str, Any] = {}
    if identities is not None:
        for key, mask in (("falsePositiveCases", predicted & ~labels), ("falseNegativeCases", ~predicted & labels)):
            # SCORE AND CUT, beside the name. The docstring above says a count is where an investigation
            # stops; a NAME is where the next one stops. Measured 2026-09-01: a candidate that closed every
            # free veto failed here on exactly one case, and the report could not say whether it scored
            # 0.90 against a 0.9153 cut -- threshold variance, and the change should ship -- or 0.30, which
            # would mean the head had genuinely lost it. Those need opposite responses and the difference
            # is one float. Answering it meant reverting the change, which is the expensive direction.
            #
            # DERIVED IN THE SAME LOOP from the same mask, never as a second list. Two structures naming
            # one set of records is this repo's most-recorded defect, and the truncation below would have
            # had to be applied identically to both.
            hits = sorted((identities[i], float(scores[i])) for i in range(len(identities)) if mask[i])
            named[key] = [identity for identity, _ in hits][:MAX_NAMED_FAILURES]
            named[key.replace("Cases", "Scores")] = {
                identity: round(score, 4) for identity, score in hits[:MAX_NAMED_FAILURES]}
            if len(hits) > MAX_NAMED_FAILURES:
                named[key + "Truncated"] = len(hits) - MAX_NAMED_FAILURES
        # The cut those scores are compared against. Without it the numbers above are unanchored, which is
        # the `phys_footprint` lesson in a report: a value is only as good as what it was measured against.
        named["threshold"] = round(float(threshold), 4)
    return {
        **named,
        # numpy uses .size where torch uses .numel(); the whole evaluator moved to numpy with the featurizer.
        "records": int(labels.size),
        "positive": int(labels.sum()),
        "clean": clean,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": true_positive / max(true_positive + false_positive, 1),
        "recall": true_positive / max(true_positive + false_negative, 1),
    }


def stability(subtype: str, scores: Any, records: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    """Did this head DECIDE the same way on every capture of one page?

    Decided by `applicability.decide`, the same definition the criterion metrics above use. This compared
    raw scores against the cut, so a capture the product rules INAPPLICABLE still counted as firing when
    its score crossed: on `acceptance-b3-button-market/bad` (#1921) one repeat read the submit's outcome and
    the other got `afterUnresolved`, `_no_unread_activation` made 3.3.1 inapplicable on the second, and the
    product said "no finding" on both -- while this reported 0.075 and 0.485 against a 0.452 cut as a head
    that flips. The second copy of the predicate `applicability.decide`'s own docstring records (#1927).

    The raw score range stays in `details`: it is still the number that shows a head moving, even when the
    decision it feeds did not.
    """
    groups: dict[tuple[str, str], list[tuple[float, bool]]] = defaultdict(list)
    for index, record in enumerate(records):
        key = (record["provenance"]["caseId"], record["provenance"]["variant"])
        score = float(scores[index])
        groups[key].append((score, applicability.decide(subtype, score, threshold, record)))
    repeated = {}
    for key, captures in groups.items():
        if len(captures) < 2:
            continue
        values = [score for score, _ in captures]
        fired = [decision for _, decision in captures]
        repeated["/".join(key)] = {
            "captures": len(captures),
            "fired": sum(fired),
            "scoreMinimum": min(values),
            "scoreMaximum": max(values),
            "unstable": len(set(fired)) > 1,
        }
    unstable = sum(1 for result in repeated.values() if result["unstable"])
    return {
        "groups": len(groups),
        "repeatedGroups": len(repeated),
        "unstableGroups": unstable,
        "measured": bool(repeated),
        "passed": bool(repeated) and unstable == 0,
        "details": repeated,
    }


# `metrics` takes scores and a threshold, so a decided 1.0/0.0 array with a 0.5 cut reuses it exactly --
# the same device the trainer uses for a criterion that is an OR over its heads.
DECIDED = 0.5


def merge_stability(per_subtype: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A criterion is stable when EVERY head under it is, and the report names the ones that are not.

    Strictly harsher than asking whether the criterion's OR flipped: a head can wobble while another
    keeps the OR true. That is the right bar here, because the question this gate answers is whether
    NVDA's output is repeatable enough for the model to decide the same way twice -- and a head that
    flips is that failure whether or not a sibling happens to mask it.
    """
    measured = [details for details in per_subtype.values() if details["measured"]]
    return {
        "measured": bool(measured),
        "passed": bool(measured) and all(details["passed"] for details in measured),
        "unstableSubtypes": sorted(s for s, d in per_subtype.items() if d["measured"] and not d["passed"]),
        "subtypes": per_subtype,
    }


def stability_failure_reasons(stability_by_criterion: dict[str, dict[str, Any]]) -> tuple[list[str], list[str], list[str]]:
    """Turn a `{criterion: mergeStability(...)}` mapping into failure-reason lines, split by CAUSE.

    PURE over the already-computed stability dict, so a "no repeated captures" scenario (`measured: False`
    on every subtype) is testable with a plain fixture -- no model, no encoder, no `runs/screenreader-
    acceptance/repeat-*.jsonl` files needed to exercise the exact branch `release:gate` hit when it invoked
    this evaluator with too few repeats to compare.

    NOT MEASURED and UNSTABLE need different responses, so they get different messages. One combined
    string sent `release:gate` chasing an instability that did not exist: the gate invoked this evaluator
    with no repeated captures to compare, and stability could not be measured at all -- reported as though
    a field had varied. A gate whose message cannot distinguish "I could not check" from "the check failed"
    is the same defect this pipeline keeps finding elsewhere.

    @returns (failure_reason_lines, unmeasured_criteria, unstable_criteria) -- the last two are what
      `acceptance_exit_code` needs to tell "only unmeasured" from "a real regression", so they travel out
      rather than being re-derived from the rendered strings.
    """
    if all(details["passed"] for details in stability_by_criterion.values()):
        return [], [], []
    unmeasured = sorted(c for c, d in stability_by_criterion.items() if not d.get("measured"))
    unstable = sorted(c for c, d in stability_by_criterion.items() if d.get("measured") and not d.get("passed"))
    reasons = []
    if unmeasured:
        reasons.append(
            "capture-to-capture stability was NOT MEASURED for "
            + ", ".join(unmeasured)
            + " — pass two or more capture runs with repeated --data files (see runs/screenreader-acceptance/repeat-*.jsonl)"
        )
    if unstable:
        reasons.append("capture-to-capture stability FAILED for " + ", ".join(unstable))
    return reasons, unmeasured, unstable


def acceptance_exit_code(passed: bool, real_failures_before_stability: int, unstable: list[str]) -> int:
    """0 PASS, 1 a real regression, 2 the ONLY reason failed is that stability could not be measured.

    `release:gate` (package.json) is a flat `&&` chain and reads this exit code as its WHOLE verdict on
    this stage, with nothing in between reading `failureReasons` -- so before this split, "could not
    measure" and "a real regression" were the identical integer. That is evidence-check's founding
    incident (`2 compared: 2 same, exit 0 on 2 of 48`) arriving on the promotion path instead of a capture
    comparison.

    A REAL failure always wins, matching `gateVerdict`'s own FAIL-beats-INCONCLUSIVE ordering: a false
    positive/negative, too few acceptance records, OR stability that WAS measured and moved (`unstable`
    non-empty) all force exit 1, whatever else is also true. Only when NEITHER of those fired -- every
    failure reason is "the stability check could not run at all" -- does the softer code apply.
    """
    if passed:
        return 0
    return 1 if (real_failures_before_stability > 0 or unstable) else 2


def eligible_records(criterion: str, model_subtypes: dict[str, Any], records: list[dict[str, Any]]) -> tuple[list[int], int]:
    """Records this criterion's MODEL heads are answerable for.

    It took the criterion's whole subtype map, which included the ones a deterministic rule substitutes
    for. A record labelled only `3.3.2:unnamed-form-field` then counted as a 3.3.2 positive the model was
    charged a false negative for, while in production that finding comes from the rule layer. Charging a
    head for records it is not asked to decide is the mirror of exempting one that is.
    """
    eligible_subtypes = set(model_subtypes)
    indices = []
    excluded = 0
    for index, record in enumerate(records):
        subtypes = set(record["target"].get("subtypes", []))
        if criterion in record["target"].get("criteria", []) and not subtypes.intersection(eligible_subtypes):
            excluded += 1
            continue
        indices.append(index)
    return indices, excluded


def threshold_floor(subtype_report: dict[str, Any] | None) -> float | None:
    """The Neyman-Pearson order statistic this head's guarantee actually rests on, or None if unrecorded.

    `threshold` is the cut that was APPLIED; `guarantee.floor` is the cut the bound REQUIRES. They are
    not the same number, because `raise_to_same_power` lifts the applied cut off the floor through the
    negatives it can clear for free. Everything between the two is conservatism the guarantee does not
    ask for -- and a miss that lands there is one NO amount of work on the features was owed for,
    PROVIDED the applicability gate would have let it fire at all. The floor answers the threshold
    question only; `refused_only_by_the_raise` is where the two are put together.

    None for an artifact trained before `guarantee` was recorded, which is a different state from "the
    floor is the threshold" and must not be collapsed into it.
    """
    floor = (subtype_report or {}).get("guarantee", {}).get("floor")
    return None if floor is None else float(floor)


def threshold_floors(model_subtypes: dict[str, Any]) -> dict[str, float]:
    """Every head's floor, by subtype, OMITTING the heads that do not record one.

    Omitted rather than defaulted to the threshold: an artifact trained before `guarantee` existed has
    no floor, and "unrecorded" reading as "the cut is the floor" would report every one of its misses as
    the head's own -- the exact conflation this field was added to end.
    """
    floors = {}
    for subtype, subtype_report in model_subtypes.items():
        floor = threshold_floor(subtype_report)
        if floor is not None:
            floors[subtype] = floor
    return floors


def refused_only_by_the_raise(subtype: str, score: float, subtype_report: dict[str, Any],
                              record: dict[str, Any]) -> bool:
    """WOULD this record have fired at the cut the guarantee requires, having not fired at the cut applied?

    THE COUNTERFACTUAL, NOT THE BAND, and both halves are `applicability.decide` -- the one definition,
    asked twice at two cuts. `floor <= score < threshold` was wrong, and wrong in the direction that
    makes a reader stop work: `falseNegativeSubtypeScores` is ungated on purpose, and
    `applicability.decide` vetoes INDEPENDENTLY of the cut, so a record the GATE refused lands in that
    band exactly like one the raise refused. `4.1.3:form-activation-silent` on a capture whose only form
    change was never read (`afterUnresolved`, #1105) is inapplicable at EVERY cut -- lowering the
    threshold to the floor recovers nothing -- and the band reported it as the raise's, which is a
    failure reason stating a comparison it never made.

    Asking the gate at the floor answers both halves at once and needs no private comparison: a record
    that fires at the floor and not at the applied cut lost to the distance between them and to nothing
    else. The second half is not redundant even though every input is a miss -- it keeps the answer true
    of any record, rather than true only while the caller's filter holds.
    """
    floor = threshold_floor(subtype_report)
    if floor is None:
        return False
    applied = float(subtype_report["threshold"])
    return (applicability.decide(subtype, score, floor, record)
            and not applicability.decide(subtype, score, applied, record))


def missed_cases(records: list[dict[str, Any]], missed_indices: list[int],
                 subtype_scores: dict[str, Any]) -> dict[str, list[tuple[dict[str, Any], dict[str, float]]]]:
    """EVERY missed capture, grouped by case identity, each beside the scores computed FROM IT. PURE.

    NAMED AND EXTRACTED so the pairing can be tested. It was a comprehension inline in `main`, which no
    unit can reach without a model and a corpus: replacing `records[index]` there with `{}` left the
    whole of `packages/lab/tests` green, because every test of the classifier hands the record in by
    hand. The classification asks the applicability gate and the gate READS the capture, so a caller
    that pairs a score with the wrong record -- or with none -- answers about a different page and says
    nothing while doing it.

    A LIST PER IDENTITY, not one capture. `case_identity` is `caseId/variant` and the acceptance corpus
    captures each case more than once, so a dict comprehension keyed on it silently kept the LAST repeat
    and discarded the rest. Repeats of one case are not interchangeable here: `test_acceptance_stability`
    pins the population this fails on -- `acceptance-b3-button-market/bad` read its form change on
    repeat-1 and got `afterUnresolved` on repeat-2, so one capture is applicable and the other is not at
    the same score. Reproduced at `778cff51d` before this fix, equal score/floor/cut: `[READ, UNREAD]`
    annotated nothing and `[UNREAD, READ]` annotated the case, off the file order alone. Refused in
    review by `reviewer-2`; the controls are the two `..._in_either_capture_order` tests.

    Scores are float-ed here, not rounded: `falseNegativeSubtypeScores` rounds to 4dp for a human, while
    the classification compares against a float32 floor, and a miss 0.00005 above its floor must not be
    classified off a rounded copy of its own score. Both report fields are derived from this one mapping
    so they cannot disagree about which captures they describe.
    """
    grouped: dict[str, list[tuple[dict[str, Any], dict[str, float]]]] = {}
    for index in missed_indices:
        grouped.setdefault(case_identity(records[index]), []).append((
            records[index],
            {subtype: float(scores[index]) for subtype, scores in subtype_scores.items()},
        ))
    return grouped


def weakest_miss_scores(captures: list[tuple[dict[str, Any], dict[str, float]]]) -> dict[str, float]:
    """The LOWEST score each head gave any capture of this case. PURE.

    One number per head for a case captured more than once, and the choice is explicit because the
    alternative was implicit: the comprehension this replaces kept whichever repeat came last in the
    file. The weakest capture, because this field exists to answer "did the head lose this case, or did
    the cut refuse it" -- and a case is only ship-able on the repeat that went worst. It also keeps the
    number honest beside `falseNegativesAboveFloor`, which is unanimous over the same captures: a case
    annotated as refused by the raise fired at its floor on EVERY capture, so its weakest score is at or
    above that floor and `describe_miss` cannot print a sub-floor score beside "above its NP floor".

    The spread this collapses is not lost -- `stability` reports `scoreMinimum` and `scoreMaximum` per
    identity group, which is the field that exists to say a head moved between captures.
    """
    subtypes = {subtype for _, scores in captures for subtype in scores}
    return {subtype: min(scores[subtype] for _, scores in captures if subtype in scores)
            for subtype in subtypes}


def misses_the_raise_refused(missed: dict[str, list[tuple[dict[str, Any], dict[str, float]]]],
                             model_subtypes: dict[str, Any]) -> dict[str, list[str]]:
    """Per missed case, the heads that would have fired at their own floor on EVERY capture of it. PURE.

    THE THIRD STATE THE MISS SCORES CANNOT EXPRESS. `falseNegativeSubtypeScores` was added so a reader
    could tell "0.90 against a 0.9153 cut" (threshold variance) from "near zero" (the head lost it).
    Measured 2026-09-23 on 4.1.3:form-activation-silent, all four of its missed records scored ABOVE the
    head's 0.9344 floor -- 0.9608 and 0.9442 against a 0.9639 cut. Read against the cut alone those two
    look like different diagnoses, and they were read that way: one was called threshold variance and
    the other "no longer a threshold-variance candidate at all". They are the same state.

    `missed` carries the RECORDS beside the scores because the classification needs them: the gate is
    asked at the floor and cannot be, from a score alone.

    UNANIMOUS OVER THE CAPTURES, and that is a policy rather than an accident -- the shape it replaces
    had no policy at all, it read whichever repeat the file ended with. This field is a claim that NO
    features work is owed on the case, so one capture the raise did not refuse falsifies it: a repeat
    that scored under the floor is the head losing that capture, and a repeat the GATE vetoed is a case
    whose captures do not agree on whether it can be judged at all. Unanimity can only ever narrow the
    annotation, never add to it, which is the direction an excuse must fail in. `captures and` is not
    redundant: `all([])` is true, and a vacuous annotation is exactly what this field must not emit.
    """
    refused = {}
    for case, captures in missed.items():
        subtypes = sorted(
            subtype for subtype, subtype_report in model_subtypes.items()
            if captures and all(
                subtype in scores
                and refused_only_by_the_raise(subtype, scores[subtype], subtype_report, record)
                for record, scores in captures)
        )
        if subtypes:
            refused[case] = subtypes
    return refused


def describe_miss(name: str, block: dict[str, Any]) -> str:
    """One missed case as a failure reason reads it: every head's score, its cut, and who refused it."""
    scores = block.get("falseNegativeSubtypeScores", {}).get(name, {})
    raised = set(block.get("falseNegativesAboveFloor", {}).get(name, []))
    parts = []
    for subtype, score in sorted(scores.items()):
        cut = block.get("subtypeThresholds", {}).get(subtype, float("nan"))
        floor = block.get("subtypeThresholdFloors", {}).get(subtype)
        note = (f", above its {floor:.3f} NP floor -- refused by the raise, not the head"
                if subtype in raised and floor is not None else "")
        parts.append(f"[{subtype} {score:.3f} vs cut {cut:.3f}{note}]")
    return " ".join([name] + parts)


def false_positive_subtype_scores(records: list[dict[str, Any]], included_indices: list[int], included_labels: Any,
                                  decided: Any, subtype_scores: dict[str, Any]) -> dict[str, dict[str, float]]:
    """The raw head score of every head, for each case the criterion FIRED on and should not have. PURE.

    THE SIBLING OF `falseNegativeSubtypeScores`, WHICH THE FALSE-POSITIVE HALF NEVER HAD. The report printed
    `@1.000` for a false positive, and that number is `decided` -- the criterion's own 0/1 decision, the OR of its
    heads -- passed through `metrics` against a 0.5 cut. It is not a confidence, it names no head, and it cannot be
    compared to `subtypeThresholds`. Two rows read it as the model's confidence within one hour on 2026-09-23 (#2187,
    #2188); the real `2.4.6:regex` scores were 0.980 and 0.870, which differ by 0.11, and the report said 1.000 for both.

    Fed from `subtype_scores`, never from `decided`: the mutation is the whole of what this field is for.

    UNGATED, for the reason `falseNegativeSubtypeScores` states -- `applicability.decide` is what turned a score into a
    decision, and every head's raw score stays visible beside it. WHICH heads fired is `falsePositivesBySubtype`, and
    `describe_false_positive` joins the two.

    The STRONGEST capture of a case captured more than once, the mirror of `weakest_miss_scores`: a case is a false
    positive if ANY capture fired, so the question the number answers -- did the head fire narrowly, or hard -- is
    answered by the capture that fired hardest. Only captures the criterion FIRED on are read: a repeat that scored low
    and did not fire is not what made this a false positive, and would only pull a minimum toward a lie. Keyed by
    case identity, which repeats collapse onto, so the summary is chosen here rather than fallen into.

    Rounded to 4dp for a human, as `falseNegativeSubtypeScores` is. An EMPTY map, never an absent one, when nothing
    fired wrongly: an empty map says "looked and found none", and a missing key says nothing.
    """
    strongest: dict[str, dict[str, float]] = {}
    for position, index in enumerate(included_indices):
        if not decided[index] or included_labels[position]:
            continue
        heads = strongest.setdefault(case_identity(records[index]), {})
        for subtype, scores in subtype_scores.items():
            heads[subtype] = max(float(scores[index]), heads.get(subtype, float("-inf")))
    return {case: {subtype: round(score, 4) for subtype, score in heads.items()}
            for case, heads in sorted(strongest.items())}


def near_cut_negatives(records: list[dict[str, Any]], included_indices: list[int], included_labels: Any,
                       subtype_scores: dict[str, Any], model_subtypes: dict[str, Any]) -> dict[str, dict[str, float]]:
    """The held-out NEGATIVES that scored inside `[floor, threshold)`, per head that records a floor. PURE.

    THE HALF OF THE BAND THE REPORT COULD NOT SEE. `falseNegativeSubtypeScores` records a score for every record
    that was MISSED, and `falsePositiveSubtypeScores` for every record that FIRED wrongly, so a negative that
    scored 0.95 and stayed under the cut is recorded nowhere: it is indistinguishable from one that scored 0.20.
    That is exactly the population #2152's ruling rests on. The applied cut sits above two misses that both lie in
    `[floor, threshold)`, and the argument for keeping it is that the same band holds negatives -- but that was
    measured on the DEVELOPMENT sample alone (3 negatives, 0 positives in `0.95-0.962`). This is the number that
    would confirm it on independent data, or show a lower cut is cheaper than it looks.

    THE COUNTERFACTUAL, NOT THE BAND: `refused_only_by_the_raise` asks `applicability.decide` at the floor and at
    the applied cut, and a negative that fires at the first and not the second is in `[floor, threshold)` and
    would have been a false positive at the floor. `floor <= score < threshold` is the private comparison
    `test_decision_has_one_definition.py` forbids, and this function first shipped it (#2431 red on it). It is
    GATED as a consequence: a negative on a page the applicability gate rules out never fires at ANY cut, so a
    cut moved to the floor would not have acted on it, and reporting it as near the cut would state a comparison
    the product never makes. The band is closed below and open above as before -- a negative AT the cut fired
    and is a false positive, not a near miss.

    Per SUBTYPE, and only for a head that records a floor: an artifact trained before `guarantee` has no band, and
    "unrecorded" must not read as an empty one. A head that HAS a floor and no negative in its band maps to an
    EMPTY dict, never an absent key -- an empty map says "looked and found none", a missing key says nothing.

    A NEGATIVE is a record the criterion was not labelled for, the same population `falsePositiveSubtypeScores`
    reads, so the two fields partition the criterion's negatives by score rather than counting different things.
    The STRONGEST capture of a case captured more than once, as that sibling does, because the question is how
    close the case came to firing. Rounded to 4dp for a human; the comparison is made on the float.
    """
    floors = threshold_floors(model_subtypes)
    banded: dict[str, dict[str, float]] = {subtype: {} for subtype in floors}
    for subtype in floors:
        for position, index in enumerate(included_indices):
            score = float(subtype_scores[subtype][index])
            if included_labels[position] or not refused_only_by_the_raise(
                    subtype, score, model_subtypes[subtype], records[index]):
                continue
            case = case_identity(records[index])
            banded[subtype][case] = max(score, banded[subtype].get(case, float("-inf")))
    return {subtype: {case: round(score, 4) for case, score in sorted(cases.items())}
            for subtype, cases in banded.items()}


def describe_false_positive(name: str, block: dict[str, Any]) -> str:
    """One false positive as a failure reason reads it: each head that FIRED, its raw score, and its own cut.

    `acceptance-b3-icon-help/good [2.4.6:regex 0.980 vs cut 0.605]`, the shape `describe_miss` prints for the other
    direction, and not `@1.000` -- the criterion's binary decision, which a reader took for a confidence.
    """
    scores = block.get("falsePositiveSubtypeScores", {}).get(name, {})
    fired = sorted(subtype for subtype, cases in block.get("falsePositivesBySubtype", {}).items() if name in cases)
    parts = [f"[{subtype} {scores.get(subtype, float('nan')):.3f} vs cut "
             f"{block.get('subtypeThresholds', {}).get(subtype, float('nan')):.3f}]" for subtype in fired]
    return " ".join([name] + parts)


def false_positive_reason(criterion: str, block: dict[str, Any]) -> str:
    """The failure reason for a criterion that fired where it should not have: a count, then each case named. PURE.

    Named here rather than inline so the line a reader meets is testable -- it was an f-string in `main` that printed
    `@1.000`, and nothing short of a model and a corpus could reach it.
    """
    names = list(dict.fromkeys(block.get("falsePositiveCases", [])))
    return (f"{criterion}: {block['falsePositive']} acceptance false positive(s)"
            + (": " + ", ".join(describe_false_positive(name, block) for name in names) if names else ""))


# `metrics` reports these against the criterion's own 0/1 decision (`DECIDED`), which is right for a caller holding
# real scores and wrong for the acceptance report, where `1.000` and `0.000` are the decision restated and were read
# as a confidence. The head scores are `falsePositiveSubtypeScores` and `falseNegativeSubtypeScores`.
BINARY_CRITERION_SCORES = ("falsePositiveScores", "falseNegativeScores")


def without_binary_criterion_scores(block: dict[str, Any]) -> dict[str, Any]:
    """`metrics`' result without the two maps that restate the criterion's decision as a score. PURE."""
    return {key: value for key, value in block.items() if key not in BINARY_CRITERION_SCORES}


def model_decision_owner(criterion_report: dict[str, Any]) -> str:
    # Reports produced before decision ownership was recorded remain learned
    # scorer reports for backwards compatibility.
    return criterion_report.get("decisionOwner", "learned-screenreader-scorer")


def assert_disjoint(training: Any, acceptance: list[dict[str, Any]], training_data: Path) -> None:
    trained = training.read_records(training_data)
    trained_cases = {record["provenance"].get("caseId") for record in trained}
    trained_families = {record["provenance"].get("family") for record in trained}
    overlap_cases = sorted({record["provenance"].get("caseId") for record in acceptance} & trained_cases)
    overlap_families = sorted({record["provenance"].get("family") for record in acceptance} & trained_families)
    if overlap_cases or overlap_families:
        raise RuntimeError("acceptance data overlaps training: " + json.dumps({"cases": overlap_cases, "families": overlap_families}))


# `packages/` is source: tracked, reviewed, and released. `runs/` is where a run's output belongs.
TRACKED_SOURCE_DIR = "packages"


def refuse_to_stamp_source_tree(report_path: Path) -> None:
    """A measurement may not rewrite released provenance, or dirty the checkout it ran from.

    Scoring the SHIPPED model is a legitimate thing to do — it is how you find out whether the weights in
    production still pass the held-out set. Stamping the verdict into that model's own training report is
    not: it overwrites the record of what was true when the weights were released, with the result of a
    run that released nothing.

    Measured 2026-08-23. `packages/scorer/models/screenreader-scorer/training-report.json` came back
    modified, carrying `generalisationVerified: false` and two held-out blockers, on weights that had
    shipped clean. The second cost was larger than the first: `packages/` is tracked, so the lab checkout
    was dirty, `run-job.yml` refused to pull into somebody's work — correctly — and the lab silently ran
    **17 commits behind origin** for days. Every job said "Not pulling: the checkout is dirty" and none
    said what that meant.

    So this is not really about one file. Anything writing into `packages/` from a run turns a source tree
    into an output directory, and this repo reaches its lab exclusively by pulling into that tree.
    """
    parts = report_path.resolve().parts
    if TRACKED_SOURCE_DIR not in parts:
        return
    raise SystemExit(
        f"refusing to stamp a verdict into {report_path}: it is inside {TRACKED_SOURCE_DIR}/, which is "
        "tracked source, not run output.\n"
        "Scoring the shipped model is fine; rewriting its release record is not — that record describes "
        "what was true when those weights shipped.\n"
        "Copy the model to runs/ and score the copy:\n"
        "  cp -r packages/scorer/models/screenreader-scorer runs/model-shipped\n"
        "  ... --model runs/model-shipped --training-report runs/model-shipped/training-report.json\n"
        "A dirty packages/ also stops the lab pulling, which is how it ran 17 commits behind for days."
    )


def stamp_generalisation(report_path: Path, passed: bool, reasons: list[str], diagnostic: bool) -> None:
    """Write the held-out verdict back into the training report beside the weights it describes.

    Kept next to the weights deliberately: a verdict in a separate file is a verdict that can be lost,
    and `score.py` reads the training report. Retraining rewrites the report and resets this to False,
    which is correct — new weights have not been evaluated.

    A DIAGNOSTIC run may not stamp a pass, and this is not a formality. `--allow-ineligible` exists to
    score weights the calibration gate has already rejected; letting such a run write
    `generalisationVerified: true` would put the release stamp on weights that failed the gate in front
    of it, and nothing in the artifacts recorded that the flag had been used. A diagnostic failure IS
    recorded — an absent verdict and a failed one must not look the same, which is this file's own rule.

    `releaseBlockedBy` is REBUILT rather than emptied. It used to be set to `[]` on a pass, which erased
    the calibration blockers the trainer had put there and left a report saying nothing blocks release
    while `releaseEligible` was still false.
    """
    if not report_path.exists():
        return
    refuse_to_stamp_source_tree(report_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    blockers = [b for b in report.get("releaseBlockedBy", []) if not b.startswith("held-out acceptance")]
    if diagnostic:
        report["generalisationVerified"] = False
        blockers.append(
            "held-out acceptance was run with --allow-ineligible, which is a measurement, not a verdict"
            + ("" if passed else f"; it also failed: {'; '.join(reasons)}")
        )
    else:
        report["generalisationVerified"] = bool(passed)
        if not passed:
            blockers += [f"held-out acceptance failed: {r}" for r in reasons]
    report["releaseBlockedBy"] = blockers
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


# WHAT AN ABSENT `captureProtocol` IS REPORTED AS. A name, not `None`, for `NO_CASE_ID`'s reason one
# section up: the census is read by `jq` out of the report, and a JSON `null` key is not expressible while
# a missing key reads as "no such records" rather than as the finding. Absence IS the finding here —
# `export-screenreader-dataset.mjs` only began stamping the protocol on 2026-09-22, and 3,742 of 3,742
# records carried none before it.
ABSENT_PROTOCOL = "absent"


def capture_protocol_census(records: list[dict[str, Any]]) -> dict[str, int]:
    """How many of these records were captured under each `captureProtocol`, keyed by the protocol.

    THE REPORT COULD NOT SAY WHAT ITS OWN INPUTS WERE CAPTURED UNDER, and #1918 is what that costs. Its
    fix lands in two halves that meet nowhere in this file: `formChanges[].submitted` is written at
    CAPTURE time (protocol 21), and `_is_submit` reads it at SCORING time. Run the evaluator over an
    export taken before the recapture and every result is what a broken fix looks like — the same false
    negatives, on a codebase where the defect is already fixed. The row spent three paragraphs of prose
    telling a later reader not to make that mistake, which is the form this repository loses.

    A CENSUS AND NOT A FLOOR, deliberately. Which protocol a reading REQUIRES is the question's, not this
    evaluator's: #1918 wants 21, a reading taken in August legitimately wanted 17, and a hard minimum here
    would be this file guessing at the caller's question and refusing every other one. What the evaluator
    owes the reader is the fact; the Acceptance that needs 21 asserts on it (`jq`, off
    `lab:fetch -e artifact=acceptance-report`) and can then tell **UNMET** — not yet recaptured — from
    **FAILED**, which is the distinction the whole row turns on.

    PER FILE, for `assert_cases_exist`'s reason: a repeat is an independent observation of the same pages,
    so a census summed across repeats describes no set. A mixed export is the interesting case and it
    survives the counting — `{"21": 290, "20": 146}` says exactly which half is stale.
    """
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        # `or {}` twice, and not `.get(k, {})`: a record can carry `"provenance": null` or
        # `"environment": null`, and a default covers only the absent key. This runs over every evaluated
        # record, so an AttributeError here would replace a report with a traceback.
        environment = (record.get("provenance") or {}).get("environment") or {}
        protocol = environment.get("captureProtocol")
        counts[ABSENT_PROTOCOL if protocol is None else str(protocol)] += 1
    return dict(counts)


# The z of a two-sided 95% interval. Named because #37's Acceptance is stated at 95% and a reader of the
# report must be able to see which confidence the bound below was computed at.
RESOLUTION_CONFIDENCE = 0.95
RESOLUTION_Z = 1.96


def resolution(record_counts: list[int]) -> dict[str, Any]:
    """The smallest false-positive rate this acceptance set can express: the Wilson upper bound at 0 observed.

    #37's Acceptance asks the REPORT to state this, and until #1922 nothing did -- it was worked out by hand
    in a comment (`z²/(n+z²) = 3.8416/439.84`), and every later growth decision would have had to redo it.

    `records` is the SMALLER repeat, not the sum: a repeat captures the same pages again, so two repeats of
    436 are 436 independent observations, not 872, and counting both would claim a resolution the set does
    not have. Stated once for the whole set rather than per criterion, because the per-criterion `clean`
    counts span both repeats and would carry exactly that double count.
    """
    records = min(record_counts, default=0)
    z_squared = RESOLUTION_Z ** 2
    return {
        "records": records,
        "confidence": RESOLUTION_CONFIDENCE,
        # The bound assumes NONE were observed, and says so: with any false positive the report has already
        # failed, and this number is then the set's resolution rather than the model's measured rate.
        "atObservedFalsePositives": 0,
        "falsePositiveUpperBound": z_squared / (records + z_squared),
    }


def report_skeleton(by_path: dict[str, list[dict[str, Any]]], artifact: dict[str, Any],
                    diagnostic: bool) -> dict[str, Any]:
    """The report before any criterion is measured: what was read, from which weights, at what resolution.

    TAKES THE RECORDS, NOT A COUNT OF THEM, since #1918. It took `{path: count}` while the only per-file
    fact it reported was the count; `captureProtocols` is a second fact about the same files, and handing
    this function a count plus a census would be two projections of one thing that can disagree.
    """
    record_counts = {path: len(records) for path, records in by_path.items()}
    return {
        "schema": "a11ign/screenreader-scorer-acceptance",
        # `captureProtocols` beside `records` and not in a block of its own: they answer one question --
        # what was read -- and a reader asserting on the protocol of a file wants its record count in the
        # same object to see whether the census covers all of it.
        "data": [
            {"path": path, "records": record_counts[path], "captureProtocols": capture_protocol_census(records)}
            for path, records in by_path.items()
        ],
        "artifact": artifact,
        "resolution": resolution(list(record_counts.values())),
        "criteria": {},
        "stability": {},
        "passed": False,
        "failureReasons": [],
        # Recorded, so a measurement taken on rejected weights can never be mistaken for a release
        # verdict by anything reading this file later.
        "diagnostic": diagnostic,
    }


def main() -> None:
    args = parse_args()
    training = load_training_module()
    scorer = load_scorer_module()
    by_path = load_records_by_path(training, args.data)
    records = flatten(by_path)
    # FIRST, before the weights are even opened. Whether these records describe cases the code has is a
    # question about the corpus, not about the model, and answering it after scoring would mean the run
    # that refuses and the run that passes do the same half-hour of work.
    #
    # ONE node CALL, TWO QUESTIONS, AND IN THIS ORDER. "Does this case exist" (#2094) has to be answered
    # before "is it the same case" (#2129): a record naming a case the code lacks has no current
    # definition to differ from, so asking the second first would report one corpus defect as silence.
    current_cases = defined_cases()
    assert_cases_exist(by_path, set(current_cases))
    assert_case_definitions_unchanged(
        by_path, {str(path): captured_definitions(path) for path in args.data}, current_cases)
    assert_disjoint(training, records, args.training_data)
    report, weights, artifact = scorer.verify_artifact(
        argparse.Namespace(
            model=model_directory(args.model),
            training_report=args.training_report,
            encoder=args.encoder,
            allow_ineligible=args.allow_ineligible,
        ),
        training,
        # This tool DECIDES eligibility, so requiring it would be circular: the trainer marks every fresh
        # candidate ineligible BECAUSE acceptance has not run. See `verify_artifact`'s docstring.
        require_release_eligible=False,
    )
    max_length = int(report["representation"]["maxLength"])
    views = pooled_views(training, records, args.encoder, max_length)
    import numpy as np

    result = report_skeleton(by_path, artifact, diagnostic=bool(args.allow_ineligible))
    stability_inputs: dict[str, list[tuple[str, Any, float]]] = {}
    stability_records: dict[str, list[dict[str, Any]]] = {}
    for criterion, criterion_report in report["criteria"].items():
        # PER SUBTYPE, not per criterion. This skipped any criterion whose `decisionOwner` was not
        # `learned-screenreader-scorer`, which silently dropped 1.1.1, 3.3.2 and 4.1.2 the moment that
        # field started reporting the honest answer, "mixed" -- and those three carry 8 of the 14 heads.
        # The held-out gate would have reported a clean pass having evaluated barely half the model.
        model_subtypes = {
            subtype: subtype_report
            for subtype, subtype_report in criterion_report["subtypes"].items()
            if subtype_report.get("decisionOwner", "learned-screenreader-scorer") == "learned-screenreader-scorer"
        }
        if not model_subtypes:
            result["criteria"][criterion] = {
                "decisionOwner": model_decision_owner(criterion_report),
                "modelEvaluated": False,
                "reason": "every subtype of this criterion is decided by the authoritative deterministic rule layer",
            }
            continue
        included_indices, excluded = eligible_records(criterion, model_subtypes, records)
        labels = np.array(
            [criterion in record["target"].get("criteria", []) for record in records], dtype=bool
        )
        subtype_scores = score_subtypes(training, model_subtypes, views, weights)
        # The criterion is the OR of its heads' own decisions -- what "any of these failures counts"
        # actually means, and the only formulation that survives the heads being on different scales.
        decided = np.zeros(len(records), dtype=bool)
        subtype_fired: dict[str, Any] = {}
        for subtype, scores in subtype_scores.items():
            # THE SAME DECISION `score.py` MAKES, including the applicability gate. This compared
            # `scores >= threshold` directly, which is how the gate came to be live in the product and
            # absent from the measurement that judges it -- the held-out set went on scoring pages the
            # product rules inapplicable, and the resulting failure read as the fix not working.
            threshold = float(model_subtypes[subtype]["threshold"])
            # WHICH SUBTYPE fired, not just that the criterion did. A criterion-level false positive names
            # a page and leaves the head unidentified, and 1.3.1 has two heads that need opposite fixes --
            # `fake-heading` reads the transcript, `unassociated-table` reads table announcements.Three wrong
            # theories on 2026-08-25 came from not knowing which. Recorded per subtype so the report can
            # say it.
            fired = np.array(
                [applicability.decide(subtype, float(score), threshold, record)
                 for score, record in zip(scores, records)],
                dtype=bool,
            )
            subtype_fired[subtype] = fired
            decided |= fired
        included_labels = labels[included_indices]
        # A LABELLED RECORD THIS CRITERION WAS CHARGED FOR AND NO HEAD DECIDED. Hoisted out of the two
        # literals below because both read it and they must not disagree -- see `missed_cases`, which
        # is a named function rather than a comprehension here precisely so that pairing is testable.
        missed_indices = [index for position, index in enumerate(included_indices)
                          if included_labels[position] and not decided[index]]
        missed = missed_cases(records, missed_indices, subtype_scores)
        miss_scores = {case: weakest_miss_scores(captures) for case, captures in missed.items()}
        result["criteria"][criterion] = {
            "decisionOwner": model_decision_owner(criterion_report),
            "modelEvaluated": True,
            # No criterion-level threshold, deliberately: there is no single number that means anything
            # once each head is cut on its own scale. The cuts that were actually applied, instead.
            "subtypeThresholds": {s: float(r["threshold"]) for s, r in model_subtypes.items()},
            # AND THE CUT EACH GUARANTEE ACTUALLY REQUIRES, which is not the same number. The applied
            # cut is raised off this floor through whatever negatives that buys for free, so the gap
            # between the two is conservatism nothing bounds -- and a report that prints only the
            # applied cut cannot tell a head that lost a case from a raise that refused one.
            #
            # Omitted per subtype rather than defaulted: an artifact trained before `guarantee` was
            # recorded has no floor, and "unrecorded" must not read as "equal to the threshold".
            "subtypeThresholdFloors": threshold_floors(model_subtypes),
            "ruleDecidedSubtypes": sorted(set(criterion_report["subtypes"]) - set(model_subtypes)),
            "excluded": excluded,
            # WHICH HEAD produced each false positive. The criterion-level list names a page and leaves
            # the head unidentified, and a criterion with two heads needs opposite fixes depending on
            # which one fired -- `1.3.1:fake-heading` reads the transcript, `1.3.1:unassociated-table`
            # reads table announcements. Three wrong theories on 2026-08-25 came from not knowing which,
            # and each cost a round trip to the lab to find out by hand.
            "falsePositivesBySubtype": {
                subtype: sorted({
                    case_identity(records[index])
                    for position, index in enumerate(included_indices)
                    if fired[index] and not included_labels[position]
                })
                for subtype, fired in subtype_fired.items()
                if any(fired[index] and not included_labels[position]
                       for position, index in enumerate(included_indices))
            },
            # AND THE RAW HEAD SCORE FOR EACH MISS, which is the only number that can settle one.
            #
            # `metrics` reports the CRITERION score, and that is binary — the criterion is the OR of its
            # heads' decisions, so a false negative always reads `0.0` against a `0.5` cut, which merely
            # restates "false negative". Measured 2026-09-01: a candidate that closed every free veto
            # missed one case, and the criterion score said `0.000` while the question was whether the
            # HEAD scored 0.90 against its own 0.9153 cut (threshold variance, ship it) or near zero (the
            # head genuinely lost it). Those need opposite work and only this number separates them.
            #
            # Ungated, deliberately: `applicability.decide` is what turned the score into "did not fire",
            # so applying it here would hide the case where a head scored well and the gate suppressed it.
            # Compare against `subtypeThresholds` above, which are the cuts actually applied.
            #
            # This is the sibling of `falsePositivesBySubtype` directly above, whose comment records what
            # not having it cost: "three wrong theories on 2026-08-25 came from not knowing which [head],
            # and each cost a round trip to the lab to find out by hand."
            #
            # The WEAKEST capture of a case captured more than once -- see `weakest_miss_scores`. Keyed
            # by case identity, which repeats collapse onto, so the summary has to be chosen rather than
            # fallen into: this read whichever repeat came last in the file until #2152's review.
            "falseNegativeSubtypeScores": {
                case: {subtype: round(score, 4) for subtype, score in scores.items()}
                for case, scores in miss_scores.items()
            },
            # THE RAW HEAD SCORE FOR EACH FALSE POSITIVE, the half of the pair this report lacked. The
            # criterion-level `falsePositiveScores` `metrics` writes is the binary decision, and read as `@1.000`
            # by two rows in one hour (#2187, #2188), so it is dropped below and this stands in its place.
            # Compare with `subtypeThresholds`; which heads fired is `falsePositivesBySubtype`.
            "falsePositiveSubtypeScores": false_positive_subtype_scores(
                records, included_indices, included_labels, decided, subtype_scores),
            # WHICH MISSES THE HEAD DID NOT LOSE. A record that WOULD HAVE FIRED at the cut its own
            # Neyman-Pearson bound requires was refused by the raise above it, so no amount of work on
            # the features would recover it and none is owed. Measured 2026-09-23 (#2152): every one of
            # 4.1.3's four missed records cleared that floor, and read against the applied cut alone the
            # two cases looked like different diagnoses -- 0.9608 "threshold variance", 0.9442 "not a
            # threshold-variance candidate at all". Both were the raise.
            #
            # "Would have fired", not "sits in [floor, threshold)": the band reads the cut and nothing
            # else, while the applicability gate vetoes independently of it, so a record the GATE
            # refused lands in the same band and would be excused here for a reason that is not true of
            # it. This field is a claim that no features work is owed; making it about a record whose
            # subtype the page cannot even be judged on is worse than printing nothing.
            #
            # Unanimous over the captures of a case, for the same reason and in the same direction: one
            # repeat the raise did not refuse falsifies the claim, so it can only narrow.
            "falseNegativesAboveFloor": misses_the_raise_refused(missed, model_subtypes),
            # THE NEGATIVES IN THE SAME BAND (#2259), beside the misses in it. Reported, never acted on: this
            # field moves no cut and gates nothing -- it is the number a ruling on the cut would need. Gated
            # by `applicability.decide` at both cuts, unlike its two ungated siblings.
            "nearCutNegatives": near_cut_negatives(
                records, included_indices, included_labels, subtype_scores, model_subtypes),
            **without_binary_criterion_scores(
                metrics(decided[included_indices].astype(float), included_labels, DECIDED,
                        identities=[case_identity(records[index]) for index in included_indices])),
        }
        stability_inputs[criterion] = [
            (subtype, scores[included_indices], float(model_subtypes[subtype]["threshold"]))
            for subtype, scores in subtype_scores.items()
        ]
        included_records = [records[index] for index in included_indices]
        if result["criteria"][criterion]["positive"] < args.min_positive:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_positive} acceptance positives")
        if result["criteria"][criterion]["clean"] < args.min_clean:
            result["failureReasons"].append(f"{criterion}: fewer than {args.min_clean} acceptance clean records")
        block = result["criteria"][criterion]
        if block["falsePositive"]:
            result["failureReasons"].append(false_positive_reason(criterion, block))
        if block["falseNegative"]:
            result["failureReasons"].append(
                f"{criterion}: {block['falseNegative']} acceptance false negative(s)"
                + (": " + ", ".join(describe_miss(name, block)
                                     for name in block.get("falseNegativeCases", []))
                   if block.get("falseNegativeCases") else "")
            )
        stability_records[criterion] = included_records

    # Counted BEFORE the stability block, so a real per-criterion regression (false positive/negative, or
    # too few acceptance records to judge) is never mistaken for "the only problem is unmeasured stability"
    # below -- see the exit-code split at the end of this function for why that distinction has to survive
    # past `passed`, which correctly collapses both into one boolean but must not be the only signal left.
    real_failures_before_stability = len(result["failureReasons"])

    # Stability is measured PER HEAD, on that head's own scores and its own cut. Measuring it on the
    # criterion's OR would hide the thing worth knowing: which head wobbles. It also keeps the reported
    # score range meaningful -- a decided 0/1 array has a min of 0 and a max of 1 and says nothing.
    result["stability"] = {
        criterion: merge_stability({
            subtype: stability(subtype, scores, stability_records[criterion], threshold)
            for subtype, scores, threshold in subtypes
        })
        for criterion, subtypes in stability_inputs.items()
    }
    stability_reasons, _unmeasured, unstable = stability_failure_reasons(result["stability"])
    result["failureReasons"].extend(stability_reasons)
    result["passed"] = not result["failureReasons"]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    # This is the ONLY place allowed to claim generalisation, because it is the only thing that measures
    # it. The trainer sets `generalisationVerified: False` and cannot do better: its calibration runs on
    # the split the model was tuned against, and it once reported a perfectly clean calibration for
    # weights this evaluator rejected on four criteria. Recorded on failure too — an absent stamp and a
    # failed one must not look the same.
    stamp_generalisation(args.training_report, result["passed"], result["failureReasons"], args.allow_ineligible)
    print(json.dumps({"passed": result["passed"], "failureReasons": result["failureReasons"]}, indent=2))
    code = acceptance_exit_code(result["passed"], real_failures_before_stability, unstable)
    if code:
        raise SystemExit(code)


if __name__ == "__main__":
    main()
