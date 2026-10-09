"""WHAT DID THE MODEL SEE on one held-out acceptance case? Its label, each head's score against its cut, and
the value of every document feature -- so a vetoed feature is readable BY NAME on the case it was supposed to
have vetoed.

    npm run scorer:explain -- --model=candidate --case=acceptance-b3-status-taxi

Written for #2258 (#2334). `scorer:explain --criterion=4.1.3` names the cases the model got wrong and the cut
that decided them, and no feature value; `scorer:explain-feature` reads the TRAINING export, which does not
hold the acceptance cases. Between the two, "does a missed case carry `form_change_nonempty`?" had no
instrument, and a retrain was on the table for want of one. This is the reading, and it changes nothing: no
weights, no corpus, no write.

TWO PHASES, AND THE SPLIT IS THE POINT. The feature values and the label need only the featurizer, which is
standard library; the head scores also need the encoder, the weights and numpy. So the values print WITHOUT a
model (`--model` omitted, and the output says the scores were not computed), which is what lets a machine
with no encoder -- CI -- pin that the reader reads the RECORD.

THE VALUES COME FROM THE FEATURIZER THE EVALUATOR SCORES WITH. `structured_feature_values` is what
`structured_features` maps over, which is what `encode_documents` and `encode_records` concatenate onto the
text, which is what `evaluate-screenreader-acceptance.py` scores. A second implementation of a feature is
this repo's most expensive recurring shape: it would report confidently about values the model never saw.
The scores come through the evaluator's own `pooled_views` and `score_subtypes`, for the same reason.

A case id ABSENT from the records is REFUSED BY NAME rather than printed as an empty block. "No such case" and
"the case has no features" must not read alike -- an empty block is exactly what a mistyped id produced.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parent
SCORER_PYTHON = SCRIPTS.parents[1] / "scorer" / "python"
sys.path.insert(0, str(SCORER_PYTHON))

import screenreader_features as features  # noqa: E402  (path shim must precede the import)

DEFAULT_MAX_LENGTH = 256


class UnknownCase(Exception):
    """A requested case id that no record names. Carries the ids the records DO hold, so the refusal is usable."""


def case_and_variant(record: dict[str, Any]) -> tuple[str, str]:
    provenance = record.get("provenance", {})
    return str(provenance.get("caseId", "?")), str(provenance.get("variant", "?"))


def selects(wanted: str, record: dict[str, Any]) -> bool:
    """`caseId` reads every variant of the case; `caseId/variant` reads that one, as `--criterion` prints it."""
    case, variant = case_and_variant(record)
    return wanted in (case, f"{case}/{variant}")


def select_records(by_path: dict[str, list[dict[str, Any]]], wanted: list[str]) -> list[tuple[str, dict[str, Any]]]:
    """EVERY record of each wanted case, in every file it appears in -- the repeats are separate observations.

    Kept whole rather than collapsed to one per case: the evaluator's own report collapses repeats onto the
    weakest or strongest capture, and the feature a head saw on ONE repeat is the reading this exists for.
    """
    selected: list[tuple[str, dict[str, Any]]] = []
    absent = []
    for name in wanted:
        hits = [(path, record) for path, records in by_path.items() for record in records if selects(name, record)]
        if not hits:
            absent.append(name)
        selected.extend(hits)
    if absent:
        held = sorted({case_and_variant(r)[0] for records in by_path.values() for r in records})
        raise UnknownCase(
            f"no acceptance record names case {', '.join(repr(a) for a in absent)}. "
            f"Nothing was printed, which is not the same as the case having no features.\n"
            f"  the {len(held)} case id(s) these records hold: {', '.join(held[:12])}"
            + (f", ... and {len(held) - 12} more" if len(held) > 12 else "")
        )
    return selected


def label_line(record: dict[str, Any]) -> str:
    target = record.get("target", {})
    criteria = ", ".join(target.get("criteria") or []) or "(none)"
    subtypes = ", ".join(target.get("subtypes") or []) or "(none)"
    return f"    label: criteria {criteria}; subtypes {subtypes}"


def feature_lines(record: dict[str, Any]) -> list[str]:
    """EVERY feature the model has, by the export's name -- never a chosen few, because the ones worth reading
    are the ones nobody thought to ask for. Zero prints as `0`, so a vetoed feature reads as plainly as a live one."""
    values = features.structured_feature_values(record)
    width = max(len(name) for name in features.FEATURE_NAMES)
    return [f"      {name.ljust(width)}  {values[name]:g}" for name in features.FEATURE_NAMES]


def head_lines(heads: list[dict[str, Any]] | None) -> list[str]:
    if heads is None:
        return ["    head scores: not computed (no --model given, so no weights were read)"]
    if not heads:
        return ["    head scores: this model has no head for that criterion"]
    lines = ["    head scores (raw score against that head's own cut; `fires` is the decision the evaluator makes,"
             " gate included):"]
    width = max(len(head["subtype"]) for head in heads)
    for head in heads:
        lines.append(f"      {head['subtype'].ljust(width)}  score {head['score']:.4f}  cut {head['cut']:.4f}  "
                     + ("fires" if head["fires"] else "does not fire"))
    return lines


def describe(source: str, record: dict[str, Any], heads: list[dict[str, Any]] | None) -> str:
    case, variant = case_and_variant(record)
    lines = [f"case {case}/{variant}   ({source})", label_line(record), *head_lines(heads),
             f"    document features ({len(features.FEATURE_NAMES)}):", *feature_lines(record)]
    return "\n".join(lines)


def load_evaluator() -> Any:
    """The evaluator, by path -- its filename has hyphens, and this file must not assume an installed package."""
    path = SCRIPTS / "evaluate-screenreader-acceptance.py"
    spec = importlib.util.spec_from_file_location("screenreader_acceptance_evaluator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load the evaluator from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def head_scores(selected: list[tuple[str, dict[str, Any]]], args: argparse.Namespace) -> list[list[dict[str, Any]]]:
    """Per selected record, every model head of the criteria asked about, scored the way the evaluator scores."""
    evaluator = load_evaluator()
    training = evaluator.load_training_module()
    scorer = evaluator.load_scorer_module()
    report, weights, _ = scorer.verify_artifact(
        argparse.Namespace(model=evaluator.model_directory(args.model), training_report=args.training_report,
                           encoder=args.encoder, allow_ineligible=False),
        training, require_release_eligible=False)
    records = [record for _, record in selected]
    views = evaluator.pooled_views(training, records, args.encoder, int(report["representation"]["maxLength"]))
    per_record: list[list[dict[str, Any]]] = [[] for _ in records]
    for criterion, block in report["criteria"].items():
        model_subtypes = {name: sub for name, sub in block["subtypes"].items()
                          if sub.get("decisionOwner", "learned-screenreader-scorer") == "learned-screenreader-scorer"}
        scores = evaluator.score_subtypes(training, model_subtypes, views, weights)
        for index, record in enumerate(records):
            if not asked_about(criterion, record, args.criterion):
                continue
            for subtype, sub in model_subtypes.items():
                cut = float(sub["threshold"])
                score = float(scores[subtype][index])
                per_record[index].append({
                    "criterion": criterion, "subtype": subtype, "score": score, "cut": cut,
                    "fires": bool(evaluator.applicability.decide(subtype, score, cut, record))})
    return per_record


def asked_about(criterion: str, record: dict[str, Any], requested: str | None) -> bool:
    """`--criterion`, else the criteria the record is LABELLED with, else every criterion -- a clean record
    carries no label, and printing nothing for the false alarm the reader came to look at would be the empty block."""
    if requested:
        return criterion == requested
    labelled = record.get("target", {}).get("criteria") or []
    return criterion in labelled if labelled else True


def read_by_path(paths: list[Path]) -> dict[str, list[dict[str, Any]]]:
    by_path: dict[str, list[dict[str, Any]]] = {}
    for path in paths:
        if not path.is_file():
            raise RuntimeError(f"acceptance data is missing: {path}")
        by_path[path.name] = features.read_records(path)
    return by_path


def parse_args() -> argparse.Namespace:
    scorer = SCORER_PYTHON.parent
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", action="append", type=Path, required=True,
                        help="an acceptance repeat file; repeat the flag for each, as the evaluator's --data")
    parser.add_argument("--case", required=True, help="comma-separated case ids (`caseId` or `caseId/variant`)")
    parser.add_argument("--criterion", help="only this criterion's heads (default: the record's labelled criteria)")
    parser.add_argument("--model", type=Path, help="scorer directory; omitted, only label and features print")
    parser.add_argument("--training-report", type=Path)
    parser.add_argument("--encoder", type=Path, default=scorer / "models/encoders/all-MiniLM-L6-v2")
    args = parser.parse_args()
    if args.model and not args.training_report:
        args.training_report = args.model / "training-report.json"
    return args


def main() -> int:
    args = parse_args()
    wanted = [name.strip() for name in args.case.split(",") if name.strip()]
    try:
        selected = select_records(read_by_path(args.data), wanted)
    except UnknownCase as refusal:
        print(str(refusal), file=sys.stderr)
        return 2
    heads: list[list[dict[str, Any]]] | list[None] = (
        head_scores(selected, args) if args.model else [None] * len(selected))
    print("\n\n".join(describe(source, record, head) for (source, record), head in zip(selected, heads)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
