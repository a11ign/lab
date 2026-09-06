#!/usr/bin/env python3
"""Train a frozen-encoder, per-criterion screen-reader evidence scorer.

The encoder is never fine-tuned here. It must be a pinned local Hugging Face
checkpoint containing model.safetensors; the only newly trained weights are
the small binary heads, also written as safetensors. The heads receive a
channel-tagged text embedding plus facts derived from screen-reader evidence
such as field naming and table-header announcements. Provenance is metadata,
never a feature.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import shutil
import random
import sys
from pathlib import Path
from typing import Any

# The feature pipeline lives with the WEIGHTS, in `@a11y-witness/scorer`, not here — a change to it
# invalidates every weight file that does not carry the new `FEATURE_SCHEMA_VERSION`, so the two must version
# together (ADR 0004). This program is the only consumer that also trains; it is deliberately not published,
# because distributing a trainer implies a consumer can reproduce training and they cannot: the corpus is not
# distributed.
# Both cwd-relative defaults below were `Path("models/...")`, so a train run from any other directory wrote
# its weights somewhere the scorer would never look. Anchored on the file, like everything else now.
# `packages/lab/scripts/` -> `packages/` -> `packages/scorer`. It was `parents[1] / "packages" / "scorer"`,
# which resolved to `packages/lab/packages/scorer` once M8 moved this file into the lab package — a path that
# does not exist, and the failure was `ModuleNotFoundError: No module named 'screenreader_features'`.
SCORER_PACKAGE = Path(__file__).resolve().parents[2] / "scorer"
sys.path.insert(0, str(SCORER_PACKAGE / "python"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_cache import cached_encode  # noqa: E402  (path shim must precede the import)
from screenreader_features import (  # noqa: E402  (path shim must precede the import)
    ENGINEERED_FEATURE_MULTIPLIERS,
    ENGINEERED_FEATURE_SCALE,
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    assert_encoder,
    encode_records,
    head_key,
    bag_gather,
    bag_offsets,
    encode_documents,
    pooling_for,
    read_records,
    score_bags,
    score_head,
    sha256,
)

SEED = 20260726

# Type I error control, Neyman-Pearson style. See ADR 0022.
#
# `NP_ALPHA` is a PROMISE about pages nobody has seen: the population false-positive rate of a head,
# held with confidence 1 - `NP_DELTA`. It replaces "zero false positives on the development set", which
# is free, unfalsifiable, and was never a measurement -- the threshold was chosen to make it true, so
# every head reported precision 1.000 by construction.
#
# Tong, Feng & Li (Science Advances, 2018) show the naive procedure -- pick the cut where the EMPIRICAL
# type I error meets the target -- leaves the POPULATION error above target roughly half the time, and
# that cross-validating it does not help. Our old cut escaped that only by sitting at the extreme
# `r = n` order statistic, which bought alpha <= 0.16% and cost 10-25 recall points across six heads
# while lurching a whole 0.05 grid step whenever one conformant record moved.
#
# 0.005 is ten times stricter than the paper's default. It is affordable because of WHO ERRS: the rules
# layer ASSERTS (conformance-mapped `failed`) and is deterministic, carrying no threshold at all, while
# a model head only REFERS (`cantTell`). A model false positive costs a human a look at a page that
# turns out fine -- see ADR 0021 for why that division is the right one.
NP_ALPHA = 0.005

NP_DELTA = 0.05

TRAIN_RATIO = 0.7

VALIDATION_RATIO = 0.15

DEFAULT_EPOCHS = 250

CALIBRATION_FOLDS = 5

# How many training embeddings to ship as the out-of-distribution reference. 512 x 384 floats is
# well under a megabyte and describes the support adequately; the full corpus is not needed.
OOD_REFERENCE_SAMPLES = 512


# Criteria decided by a deterministic rule, not by the learned scorer. Their calibration is reported
# but does not gate release, because the rule is the decision.
#
# 2.4.6 and 2.4.4 were moved in here and then moved back out, and the round trip is worth recording.
# The case for reclassifying them was that they had failed the held-out gate while their signals are
# hand-written vocabularies (GENERIC_HEADINGS, VAGUE_LINKS) that the corpus is generated from. Both
# supporting measurements were wrong: the held-out failures came from an evaluator that never pooled
# (see 593e1e0), and the "generic_heading_present discriminates 4 of 30 held-out pairs" figure counted
# all 30 pairs when only ~2 are 2.4.6 cases at all. Measured properly, both reach TP=8 FP=0 FN=0
# held-out. They stay learned.
#
# What remains true, and is UNTESTED rather than refuted: the held-out 2.4.6 pages use 'overview',
# 'more', 'stuff' and 'welcome' -- all four already in the training vocabulary -- because the same
# generator builds both sets from the same 15 words. So the gate proves generalisation to new PAGES
# and says nothing about new VOCABULARY. Holding out WORDS rather than pages is the experiment that
# would answer it, and until it runs, no claim should be made about unseen vague terms.
#
# For the record on prior art, which does not decide this either way: WAVE flags a link whose text is
# "click here" / "here" / "more" / "details" / ..., eslint-plugin-jsx-a11y ships
# DEFAULT_AMBIGUOUS_WORDS on exact match, and axe-core declines to judge text quality at all.
# Ownership is per SUBTYPE, because that is where the division of labour actually falls. It was
# `RULE_OWNED_CRITERIA = {"1.1.1", "4.1.2"}` -- whole criteria -- and that one granularity mistake caused
# three separate symptoms:
#
#   1. One threshold was fitted per criterion, over `amax` across heads with different score
#      distributions. No cut separates them, so 4.1.2 fell back to 0.5 "which nobody chose".
#   2. A criterion marked rule-owned is exempt from blocking release, so that failure could only ever
#      warn -- including for subtypes the rules do not decide.
#   3. `local-judge` suppresses the model for a rule-owned CRITERION, so subtypes the rules never look
#      at were decided by neither layer.
#
# Declared ONCE, in `packages/lab/rule-ownership.json`, and read here. It used to be a frozenset in this
# file and an array in `score-rules.ts` -- two encodings of one fact, which is what Secure by Design 12.5
# calls the false-negative DRY violation: no text is repeated, a duplication tool sees nothing, and the two
# copies "evolve inconsistently". They had, in both directions, before anyone compared them. The file
# carries the argument; this is only the reader.
#
# Measured by `npm run rules:score`, which reports the same boundary from the other side:
#
#   1.1.1:filename-alt          31/31    rules: EXACT
#   1.1.1:generic-alt            0/31    rules: none -- the model's heads own this subtype
#   1.1.1:missing-alt           88/88    rules: EXACT
#   2.4.4:regex                19/100    rules: declared OVERLAP -- the head owns the other 81
#   3.3.2:unnamed-form-field   115/115   rules: EXACT
#   4.1.2:missing-role         115/189   rules: EXACT on the 115 co-labelled; the head alone owns 74
#   4.1.2:regex                 32/32    rules: EXACT
#   4.1.2:state-change-silent    0/69    rules: none -- the model's heads own this subtype
#
# Rules are 100% precise where they look (0 false positives over 1001 conformant records), so where a
# rule decides, it is the answer.
#
# Only `decidedBy: "rules"` exempts a head from blocking release. An `overlap` subtype must NOT be
# exempt: the rules cover 19 of 2.4.4's 100 records and the head is the only decider for the other 81,
# so treating the whole subtype as the rules' would silence the layer that does most of the work -- the
# criterion-level mistake this whole change exists to stop, one granularity down.
RULE_OWNERSHIP_FILE = Path(__file__).resolve().parents[1] / "rule-ownership.json"

def read_rule_ownership() -> dict[str, dict[str, Any]]:
    """The declaration, whole. Raises rather than defaulting to empty: an unreadable declaration is not
    an absent boundary, and a silent {} would exempt nothing while reporting every head as the model's --
    a wrong answer that looks like a clean one."""
    return json.loads(RULE_OWNERSHIP_FILE.read_text(encoding="utf-8"))["subtypes"]

RULE_OWNERSHIP = read_rule_ownership()

# ONE condition, used for BOTH consequences, because they are the same question asked twice: does the
# rule's finding SUBSTITUTE for this head's? A rule substitutes only when it reports the head's own
# criterion. If it answers a different one, the head is still the only thing that can produce a finding
# for its criterion, so it must neither be suppressed in production nor excused from blocking release.
#
# `3.3.2:unnamed-form-field` is the case that forced this. The rules decide that evidence exactly --
# 115/115 -- and report it as **4.1.2**. Nothing emits a 3.3.2 finding for it except this head. Marking
# it rule-owned gave it the worst possible pair of properties: load-bearing in production (the judge
# correctly declines to suppress it) while exempt from the release gate. A head that decides real
# findings and cannot block a release is exactly the hole the per-subtype work was opened to close.
RULE_SUBSTITUTED_SUBTYPES = frozenset(
    subtype for subtype, entry in RULE_OWNERSHIP.items()
    if entry["decidedBy"] == "rules" and subtype.startswith(entry["reportsAs"] + ":")
)

def note(report: dict[str, Any], message: str, *, blocking: bool) -> None:
    """Record a calibration note, and say whether it can stop a release.

    Every note used to land in one `warnings` list, and `releaseBlockedBy` was then derived by promoting
    ALL of them. So a purely informational line -- "23 development record(s) masked as unknown by their
    publisher's claim", which `known_indices` has already handled correctly by excluding those records from
    the head entirely -- appeared in a report as something standing between the model and release.

    Measured 2026-08-23: 40 blockers, of which 12 were that note. A reader comparing 0 blockers on the
    shipped model against 40 on a candidate cannot tell a corpus that grew from a model that got worse, and
    I nearly drew exactly that conclusion.

    The distinction already existed and was thrown away at the last step: a blocking note flips
    `calibrationClean`, an informational one does not. Recording it at the call site means the two lists
    cannot disagree -- the repo's standing fix for a fact derived twice.
    """
    report["warnings"].append(message)
    if blocking:
        report["calibrationBlockers"].append(message)


def refuse_to_destroy_release_weights(args: argparse.Namespace) -> None:
    """Do not overwrite a release-eligible model without being told to.

    `--output` defaults into `packages/scorer/models/screenreader-scorer`, a GIT-TRACKED build artifact, and
    that is deliberate rather than an oversight: four downstream scripts default to reading that same path
    (`evaluate-screenreader-acceptance.py`, `check-screenreader-hardening.py`,
    `report-screenreader-errors.py`, and `score.py` at inference). Moving the default out of the tree would
    decouple train from evaluate, so the acceptance gate would measure the OLD shipped model while the new
    one sat elsewhere -- a gate reporting on weights nobody is about to ship, which is worse than the
    problem it would solve.

    So the write stays where the chain expects it and the DESTRUCTION is what gets guarded. A
    release-eligible model in the output directory is the expensive thing: it passed calibration and
    held-out acceptance, and one was already lost once to a `git checkout` on the assumption that a tracked
    file is always recoverable. It is not, if it was never committed.

    Same shape and same reasoning as `worker:deploy --allow-protocol-change`, which guards 2,122 cached
    captures: refuse by default, name the thing at risk, and say the one flag that proceeds.
    """
    report_path = args.output / "training-report.json"
    if args.allow_overwrite or not report_path.exists():
        return
    try:
        existing = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # An unreadable report is not a release-eligible model, and refusing on it would block a retrain
        # after a half-written artifact -- the very situation a retrain fixes.
        return
    if not existing.get("releaseEligible"):
        return
    floor = (existing.get("outOfDistribution") or {}).get("inDistributionFloor")

    # ROTATE, rather than refuse. The release directory keeps the hard refusal below; a SCRATCH directory
    # gets its predecessor moved aside instead.
    #
    # Refusing everywhere made the training job single-use: the first train succeeded and every one after
    # it died in under two seconds with "REFUSING to overwrite", so a repeatable pipeline was impossible
    # and the workaround on offer was `--allow-overwrite` — a flag a job would then pass every time, which
    # is a guard nobody has. Measured 2026-08-23 on the first candidate anyone trained twice.
    #
    # Same shape as NVDA's own log, which this project already depends on: it rotates on every start, and
    # `/diagnostics` exposes `previousLog` precisely because "a session that went mute only exists in the
    # old file". Nothing is lost and nothing blocks.
    release_directory = SCORER_PACKAGE / "models" / "screenreader-scorer"
    if args.output.resolve() != release_directory.resolve():
        previous = args.output.with_name(args.output.name + ".previous")
        if previous.exists():
            shutil.rmtree(previous)
        shutil.move(str(args.output), str(previous))
        print(f"Rotated the previous release-eligible model to {previous} "
              f"(generalisationVerified={existing.get('generalisationVerified')}, floor={floor}). "
              "Nothing was lost; one generation is kept.", file=sys.stderr)
        return

    print(
        f"REFUSING to overwrite {args.output}: it holds a RELEASE-ELIGIBLE model"
        f" (generalisationVerified={existing.get('generalisationVerified')}, floor={floor}).\n"
        "\n"
        "This is the SHIPPED model's directory. Promotion is a separate, deliberate step that also writes\n"
        "the changeset recording it:\n"
        "  npm run promote:model -- --from=<candidate>\n"
        "\n"
        "To train, name a scratch directory — those rotate rather than refuse:\n"
        "  --output runs/model-candidate\n",
        file=sys.stderr,
    )
    raise SystemExit(3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("runs/screenreader-dataset/screenreader-evidence.jsonl"))
    parser.add_argument("--encoder", type=Path, default=SCORER_PACKAGE / "models" / "encoders" / "all-MiniLM-L6-v2")
    parser.add_argument("--output", type=Path, default=SCORER_PACKAGE / "models" / "screenreader-scorer")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--max-length", type=int, default=256)
    # The OPERATING floor, when one has been chosen from held-out data. Absent, the trainer derives a
    # bootstrap floor from the training set's own nearest-neighbour minimum -- which is all it can see, and
    # which the report has always labelled "NOT conformally calibrated".
    #
    # It needs to be an input because the derived value is not the right operating point and cannot be:
    # measured on the 22-page calibration set, the derived 0.5587 scored 21 of 22 real pages with 0 false
    # positives but turned an honest abstention into a MISS on W3C's own "purchase form, broken" demo, while
    # 0.70 scored 20 of 22 with 0 false positives and caught it. For an accessibility tool "I cannot assess
    # this page" is a safe answer and "no findings" on a broken form is a wrong one, so the floor is a
    # calibration decision and belongs here as a value somebody chose and recorded.
    parser.add_argument("--in-distribution-floor", type=float, default=None)
    # See `refuse_to_destroy_release_weights`. Named like `worker:deploy --allow-protocol-change`, which
    # guards the capture cache for the same reason: the thing being overwritten is expensive and its loss
    # is not obvious afterwards.
    parser.add_argument("--allow-overwrite", action="store_true",
                        help="overwrite a release-eligible model in the output directory")
    return parser.parse_args()

def assign_splits(records: list[dict[str, Any]]) -> dict[str, str]:
    families = sorted({record["provenance"]["family"] for record in records})
    assignment = {}
    for family in families:
        bucket = int(hashlib.sha256(family.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
        if bucket < TRAIN_RATIO:
            assignment[family] = "train"
        elif bucket < TRAIN_RATIO + VALIDATION_RATIO:
            assignment[family] = "validation"
        else:
            assignment[family] = "test"
    return assignment

def calibration_fold_for_family(family: str) -> int:
    digest = hashlib.sha256((family + "|threshold-calibration").encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % CALIBRATION_FOLDS

def out_of_fold_scores(
    features: Any,
    labels: Any,
    records: list[dict[str, Any]],
    development_indices: list[int],
    epochs: int,
    offsets: list[int],
) -> Any:
    import torch

    scores = torch.zeros(len(records), dtype=torch.float32)
    development_families = {records[index]["provenance"]["family"] for index in development_indices}
    folds = {
        family: calibration_fold_for_family(family)
        for family in development_families
    }
    for fold in range(CALIBRATION_FOLDS):
        held_out = [
            index for index in development_indices
            if folds[records[index]["provenance"]["family"]] == fold
        ]
        training = [
            index for index in development_indices
            if folds[records[index]["provenance"]["family"]] != fold
        ]
        if not held_out or not training:
            continue
        weight, bias = train_head(features, offsets, labels, training, epochs)
        scores[held_out] = score_bags(features, offsets, weight, bias)[held_out]
    return scores

def metrics(scores: Any, labels: Any, threshold: float) -> dict[str, float | int]:
    import torch

    labels_bool = labels == 1
    predicted = scores >= threshold
    true_positive = int(torch.logical_and(predicted, labels_bool).sum())
    false_positive = int(torch.logical_and(predicted, ~labels_bool).sum())
    false_negative = int(torch.logical_and(~predicted, labels_bool).sum())
    clean = int((labels == 0).sum())
    precision = true_positive / max(true_positive + false_positive, 1)
    recall = true_positive / max(true_positive + false_negative, 1)
    return {
        "records": int(labels.numel()),
        "positive": int(labels.sum()),
        "clean": clean,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / max(precision + recall, 1e-9),
    }

def np_minimum_negatives(alpha: float = NP_ALPHA, delta: float = NP_DELTA) -> int:
    """Fewest held-out negatives for which ANY order statistic can control `alpha` at `delta`.

    From Proposition 1: the most conservative cut, r = n, has violation rate (1 - alpha)^n, so control
    needs (1 - alpha)^n <= delta, i.e. n >= log(delta) / log(1 - alpha). Below it the guarantee is not
    merely weak, it is unavailable -- and a head that cannot be calibrated must say so rather than
    quietly return a number that looks like one.
    """
    return math.ceil(math.log(delta) / math.log(1 - alpha))

def np_violation_rate(n: int, r: int, alpha: float = NP_ALPHA) -> float:
    """P[population type I error of `1(score > s_(r))` > alpha], the bound of Proposition 1.

    v(r) = SUM_{j=r..n} C(n,j) (1-alpha)^j alpha^(n-j) -- the upper tail of Binomial(n, 1-alpha).
    Summed in log space: C(2000, 1000) is an exact integer with 600 digits and the factors it multiplies
    underflow, so the direct form loses the answer in both directions at once. There is no scipy on the
    lab and this needs none.
    """
    log_p, log_q = math.log1p(-alpha), math.log(alpha)
    log_n = math.lgamma(n + 1)
    total = 0.0
    for j in range(r, n + 1):
        total += math.exp(log_n - math.lgamma(j + 1) - math.lgamma(n - j + 1)
                          + j * log_p + (n - j) * log_q)
    return total

def np_rank(n: int, alpha: float = NP_ALPHA, delta: float = NP_DELTA) -> int | None:
    """r* = min{r : v(r) <= delta}, or None when `n` is below the minimum sample size.

    Walked down from r = n accumulating the tail, because r* sits within a few ranks of n at these
    alphas -- a binary search would evaluate more terms, not fewer.
    """
    log_p, log_q = math.log1p(-alpha), math.log(alpha)
    log_n = math.lgamma(n + 1)
    total = 0.0
    for r in range(n, 0, -1):
        total += math.exp(log_n - math.lgamma(r + 1) - math.lgamma(n - r + 1)
                          + r * log_p + (n - r) * log_q)
        if total > delta:
            return r + 1 if r < n else None
    return 1

def float32_above(value: float) -> float:
    """The smallest float32-representable number strictly greater than `value`.

    Not `math.nextafter`, which works in float64: head scores live in a `torch.float32` tensor during
    training and as Python floats at inference, and a float64 nudge is rounded back onto `value` by the
    float32 cast. A float32 step is strictly greater under BOTH dtypes, which is the only property that
    makes one threshold correct in both places.
    """
    import numpy

    return float(numpy.nextafter(numpy.float32(value), numpy.float32(numpy.inf)))

def raise_to_same_power(floor: float, positive_scores: list[float] | None) -> float:
    """The highest cut that admits exactly the positives `floor` admits. PURE.

    Inference compares ``score >= threshold``, so the count of admitted positives is unchanged for every
    cut up to and including the smallest positive score at or above the floor. Raising to exactly that
    value keeps it (``p >= p``) and drops every negative below it.

    With no positives at or above the floor there is nothing to preserve and nothing to gain: the cut
    stays where the bound put it rather than being raised to an arbitrary place.
    """
    if not positive_scores:
        return floor
    admitted = [score for score in positive_scores if score >= floor]
    return min(admitted) if admitted else floor


def np_threshold(negative_scores: list[float], criterion: str,
                 warnings: list[str] | None,
                 positive_scores: list[float] | None = None) -> tuple[float, dict[str, Any]]:
    """The Neyman-Pearson cut: the r*-th order statistic of the held-out NEGATIVE scores.

    Returned alongside what it promises, because a threshold whose guarantee is not recorded is how
    `precision 1.000` came to be read as evidence for five months.

    Two exactness notes, both deliberate and neither hidden:

    - Inference compares `score >= threshold` while Proposition 1 is stated for `score > s_(r)`, so the
      cut must be the next value ABOVE the order statistic -- and it must be nudged in FLOAT32, not
      float64. Head scores are a `torch.float32` tensor here and Python floats in `score.py`, and a
      float64 `math.nextafter` rounds straight back onto the value it was meant to clear the moment it
      meets the float32 tensor. Measured: that put exactly one extra false positive on every one of the
      seventeen heads, which is what a uniform off-by-one looks like from the outside. A float32 nudge
      is strictly greater in both dtypes, so it survives the round trip in either direction.
    - The scores are OUT-OF-FOLD, so each comes from a model that did not see its own record but not
      all from ONE model, as the proposition assumes. That makes this the cross-validated approximation
      rather than the exact split guarantee -- the same gap cross-conformal methods carry against split
      conformal. `exact: false` records it. Closing it needs negatives held back from training entirely.
    """
    ordered = sorted(negative_scores)
    n = len(ordered)
    needed = np_minimum_negatives()
    rank = np_rank(n) if n >= needed else None
    if rank is None:
        # Not calibratable at this alpha. Take the most conservative cut there is and report the alpha it
        # DOES buy, rather than the one that was asked for and cannot be had.
        achievable = 1 - NP_DELTA ** (1 / n) if n else 1.0
        if warnings is not None:
            warnings.append(
                f"{criterion}: {n} held-out negative(s), below the {needed} needed to control a "
                f"false-positive rate of {NP_ALPHA} at confidence {1 - NP_DELTA}. Using the most "
                f"conservative cut, which controls only {achievable:.4f}. NOT calibrated to target."
            )
        rank, alpha = n, achievable
    else:
        alpha = NP_ALPHA
    floor = min(float32_above(ordered[rank - 1]), 1.0) if n else 0.5
    # THE ORDER STATISTIC IS A FLOOR, NOT THE ANSWER -- and taking it as the answer shipped a strictly
    # dominated cut.
    #
    # `s_(r*)` is by construction the LOWEST cut satisfying the bound, which is right in the continuous
    # idealisation where a lower cut always buys power. In a finite sample it often buys none: recall goes
    # flat below some point, and the whole false-positive budget is then spent for nothing.
    #
    # Measured 2026-08-25 on 2.4.4:regex. Chosen cut 0.0694 gave TP 144, FP 4. The sweep at 0.25 and at
    # 0.75 gave TP 144, FP 0 -- identical recall, no false positives, a cut an order of magnitude higher.
    # That head then fired 2.4.4 on `acceptance-b2-generic-kiln/good`, a page with NO LINK ON IT, and
    # failed the held-out gate.
    #
    # So the cut is raised to the highest value that admits the same positives. The guarantee survives a
    # fortiori: a higher cut admits weakly fewer negatives, so `P[type-I error > alpha] <= delta` still
    # holds, and `permittedFalsePositives` still reports what the BOUND allows rather than what this cut
    # spends. This is the same call the fallback path already made -- "the fewest-false-positive cut, ties
    # broken by recall" -- applied to the main path, which kept the flaw.
    cut = raise_to_same_power(floor, positive_scores)
    # Verified by COUNTING, not by trusting the arithmetic that produced it. The float32 trap above
    # defeated a `nextafter` that reads correctly, and the released weights would have carried a cut
    # that quietly admitted one more negative than it promised.
    admitted = sum(1 for score in ordered if score >= cut)
    if n and admitted > n - rank:
        raise RuntimeError(
            f"{criterion}: the cut at {cut!r} admits {admitted} of {n} negatives where rank {rank} "
            f"permits {n - rank}. The threshold and the scores disagree; do not ship these weights."
        )
    return cut, {
        "method": "neyman-pearson-order-statistic",
        "falsePositiveRate": alpha,
        "confidence": 1 - NP_DELTA,
        "rank": rank,
        "negatives": n,
        "permittedFalsePositives": n - rank,
        # What the bound ALLOWS versus what this cut actually spends. Reported separately because they
        # are different facts and the gate compares against the first: a cut raised off the floor uses
        # less of its budget, and hiding that would make the improvement invisible in the report.
        "admittedFalsePositives": admitted,
        "floor": floor,
        "exact": False,
        "atTarget": alpha == NP_ALPHA,
    }

def dataset_grade(records: list) -> str:
    """"test" if any record carries that stamp, otherwise "release".

    ANY, not all: a dataset that mixes graded and ungraded records is a test dataset, because the reason
    the grade exists is that some of its evidence does not describe the page it is labelled against.
    Taking the majority, or the first record, would let one stale pair ride into a promoted model.
    """
    for record in records:
        if (record.get("provenance") or {}).get("grade") == "test":
            return "test"
    return "release"


def type_one_error_blocker(name: str, development: dict, guarantee: dict | None) -> str | None:
    """Does this head's TYPE-I ERROR block a release? Returns a message, or None.

    THE SAME RULE `releasability.mjs` APPLIES, deliberately, and pinned to it by
    `scripts/fixtures/calibration-verdicts.json`, which both this module's tests and
    `releasability.test.ts` read. Python and JavaScript cannot import each other, so the duplication is
    forced; CLAUDE.md's remedy for a forced duplication is to pin the copies equal with a test.

    They HAD drifted. This module blocked on ``if falsePositive or falseNegative`` -- zero tolerance, left
    over from before Neyman-Pearson calibration -- while the gate had moved to the bound the threshold was
    actually chosen for. Measured 2026-08-25: a candidate was declared ineligible by SIX criteria and FIVE
    were inside their own guarantee. Retraining to satisfy them would have been tuning against a rule that
    should not exist, while the one genuine failure stayed buried among the five.

    Two things this rule deliberately does NOT do:

    - It does not block on false negatives. NP bounds type-I error and trades recall on purpose, and
      development recall is computed on a corpus particular to one model, so its absolute value cannot
      support a gate. A head that genuinely weakens is caught on held-out acceptance, where two models are
      comparable. `releasability.test.ts` has pinned this since before the drift.
    - It works per SUBTYPE, never per criterion. The guarantee is computed per subtype, so that is the only
      level at which `permittedFalsePositives` means anything. Aggregating to the criterion and comparing
      against no bound at all was the second half of the same defect.
    """
    false_positive = int(development.get("falsePositive", 0))
    if guarantee is None:
        # An uncalibrated head makes no claim about unseen pages, so the only defensible bar is the old
        # one. This is the pre-NP path and stays strict.
        if false_positive:
            return f"{name}: {false_positive} false positive(s) and no calibrated guarantee to permit them"
        return None
    if guarantee.get("atTarget") is False:
        return (f"{name}: NOT calibrated to the target false-positive rate. It needs more conformant "
                f"records; no threshold can fix this.")
    permitted = int(guarantee.get("permittedFalsePositives", 0))
    if false_positive > permitted:
        return (f"{name}: {false_positive} false positive(s) where the calibrated rank permits "
                f"{permitted} -- the threshold and the scores disagree, which is a fault in the "
                f"calibration itself rather than a weak head")
    return None


def threshold_sweep(scores: Any, labels: Any) -> list[dict[str, float | int]]:
    """Every candidate cut and what it would cost, recorded in the report.

    The chosen threshold alone cannot tell "this head got worse" from "one negative record crossed a
    line and pinned the cut a step higher". Those need opposite responses -- retrain the head, versus
    look at the one record -- and on 2026-08-24 the second was nearly read as the first: 3.3.1 went
    from 15 missed findings at 0.90 to 24 at 0.95 when one LINK-TEXT feature was removed. Every head
    reads the same shared feature vector, so that removal does re-fit this head too; but the feature
    describes link text and this head reads validation messages, so a nine-finding swing wanted
    explaining rather than accepting.
    The cut it diagnosed was chosen by a hard zero-false-positive constraint over ~1,900 negatives, so a
    SINGLE borderline negative moved it a whole 0.05 step and took recall with it. `np_threshold`
    retired that rule, which is the real fix -- but the sweep stays, because the scores it is computed
    from are out-of-fold and then discarded, and it is still the only way to see the shape of a head
    rather than one number from it.
    """
    return [{"threshold": t, **metrics(scores, labels, t)} for t in (i / 100 for i in range(5, 100, 5))]

def bag_gather_tensors(offsets: list[int]) -> tuple[Any, Any]:
    """`bag_gather` as torch tensors — the training-side conversion boundary.

    The shared featurizer returns numpy so inference never imports torch. Torch can index with a numpy
    array, but `masked_fill` rejects a numpy mask, so the conversion happens once, here, next to the
    `torch.from_numpy` that converts the features. Deriving the indices is still the shared function's
    job: only the container changes, so train and inference cannot pool differently.
    """
    import torch

    gather, mask = bag_gather(offsets)
    return torch.from_numpy(gather), torch.from_numpy(mask)


def bag_logits(unit_logits: Any, offsets: list[int]) -> Any:
    """Max over each bag's instance logits -> one logit per record.

    On LOGITS rather than probabilities: sigmoid is monotonic, so max-of-sigmoids equals
    sigmoid-of-max, and BCEWithLogitsLoss is numerically safer than sigmoid-then-BCE. This is the
    training-side twin of `score_bags`, and the two must stay in step -- a different aggregation on
    each side yields plausible numbers and wrong findings.
    """
    import torch

    gather, mask = bag_gather_tensors(offsets)
    return unit_logits[gather].masked_fill(~mask, float("-inf")).max(dim=1).values


def train_head(features: Any, offsets: list[int], labels: Any, indices: list[int], epochs: int) -> tuple[Any, Any]:
    """Train one subtype head under multiple-instance max pooling.

    Takes the FULL feature matrix plus the record indices to train on, rather than a pre-sliced one:
    features are now per evidence unit, so slicing by record index would cut the rows apart from the
    bags they belong to. Every epoch scores all instances, maxes within each bag, then selects the
    records in this split -- so the gradient reaches only the argmax instance of each record, which is
    what makes this MIL rather than document classification.
    """
    import torch

    torch.manual_seed(SEED)
    head = torch.nn.Linear(features.shape[1], 1)
    selected = torch.tensor(indices, dtype=torch.long)
    split_labels = labels[selected]
    positives = split_labels.sum().item()
    negatives = split_labels.numel() - positives
    positive_weight = max(negatives / max(positives, 1), 1.0)
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=torch.tensor([positive_weight]))
    optimizer = torch.optim.AdamW(head.parameters(), lr=0.02, weight_decay=0.01)
    # Fixed for the whole run, so it is built once here rather than rebuilt on each of 250 epochs.
    gather, mask = bag_gather_tensors(offsets)
    for _ in range(epochs):
        optimizer.zero_grad()
        unit_logits = head(features).squeeze(1)
        record_logits = unit_logits[gather].masked_fill(~mask, float("-inf")).max(dim=1).values
        loss = loss_fn(record_logits[selected], split_labels.float())
        loss.backward()
        optimizer.step()
    return head.weight.detach().clone(), head.bias.detach().clone()

def ood_reference_indices(total: int, torch: Any) -> Any:
    """Evenly spaced row indices spanning the WHOLE dataset, capped at OOD_REFERENCE_SAMPLES.

    A named function rather than three lines inside `main` because the arithmetic is where the bug was and
    the correctness condition is worth stating: the span must reach `total - 1` at every dataset size.

    Verified by execution at n = 300 / 512 / 1858 / 1877 / 20000 -- 512 unique rows and span 0..n-1 in each
    case. NOT covered by a regression test: this repo has no Python test harness, and adding one is a
    bigger decision than this fix. That is a real gap, and it is the gap that let the previous version
    survive.
    """
    count = min(OOD_REFERENCE_SAMPLES, total)
    return torch.linspace(0, total - 1, count).round().long()


def assert_dataset_is_current(data: Path) -> None:
    """Refuse a DERIVED dataset whose source has moved on since it was built.

    `with-realism.jsonl` is produced by `build-realism-tier.mjs` from the export. On 2026-08-24 a retrain
    consumed one built before 44 new cases existed -- the export held 2,366 records, training reported
    2,349 -- so a full capture/export/train cycle produced a model that had never seen the corpus change
    it was run to measure. Every step succeeded. The missing one simply left an older file in place, and a
    stale input is indistinguishable from a current one at the point of use.

    Re-hashes the SOURCE here rather than trusting anything the builder wrote about it, so this check
    shares no failure mode with the build -- the rule this repo already applies to deploys, where reading
    the guest's hash through the same channel that pushed the file verifies nothing.

    A hash, never an mtime: timestamps move for reasons that are not content -- a checkout, a copy, an
    rsync -- so they answer a different question from the one being asked.
    """
    sidecar = data.with_name(data.name + ".source.json")
    if not sidecar.exists():
        # No claim to check. Reported rather than assumed either way: this is the third answer, and routing
        # it to "fine" is what let the stale file through.
        print(
            f"  dataset provenance UNKNOWN: no {sidecar.name} beside {data.name}, so whether it is current "
            f"cannot be decided here.\n"
            f"  Rebuild it to find out: npm run lab:job -- -e job=build-realism",
            file=sys.stderr,
        )
        return

    claim = json.loads(sidecar.read_text(encoding="utf-8"))
    source = (data.parent / Path(claim["source"]).name)
    if not source.exists():
        return

    actual = sha256(source)
    if actual == claim.get("sourceSha256"):
        return

    raise SystemExit(
        f"REFUSING to train: {data.name} was built from a {source.name} that has since changed.\n"
        f"  built from : {claim.get('sourceSha256', '?')[:16]}  ({claim.get('sourceRecords', '?')} records)\n"
        f"  on disk now: {actual[:16]}\n"
        f"  So this dataset is missing whatever the export has gained, and a model trained on it cannot "
        f"measure the change you made.\n"
        f"  Rebuild it: npm run lab:job -- -e job=build-realism"
    )


def assert_declaration_matches_data(records: list[dict[str, Any]]) -> None:
    """Fail if `rule-ownership.json` names a subtype the corpus does not have.

    A declared key that matches nothing enforces nothing, and it fails SILENTLY in the direction that
    matters: `4.1.2:unnamed-form-field` sat in the old hardcoded map for as long as it existed, exempting
    a head from blocking release that was never the head it named. `rules:score` asserts the same thing
    from the other side; this one runs at training time, which is when the exemption is actually applied.

    `modelHead: false` entries are exempt from the "must be present" half: `1.4.2:autoplay-uncontrollable`
    is declared today with no corpus case at all, by design, and a declaration that a head must never
    exist is not a claim that the corpus already carries evidence for it. `score-rules.ts`'s
    `ownershipFailures` carries the identical exemption for the identical reason; the two must move
    together.
    """
    present = {subtype for record in records for subtype in record["target"].get("subtypes", [])}
    expected = {
        s for s, e in RULE_OWNERSHIP.items()
        if e["decidedBy"] != "unavailable" and e.get("modelHead") is not False
    }
    # `unavailable` is asserted the other way round: those records are excluded from the export on
    # purpose (MODEL_EXCLUDED_SUBTYPES), so their PRESENCE means the exclusion has stopped working and a
    # head is about to be fitted to evidence that cannot express its failure.
    #
    # Computed from `decidedBy` DIRECTLY, never from `expected`'s complement -- `expected` now also
    # excludes `modelHead: false` entries, which (2.4.7's own case) can be `decidedBy: "rules"` AND
    # present with real records. Deriving `forbidden` from "not in expected" would flag a subtype like
    # that as a broken `unavailable` exclusion when it is neither unavailable nor broken.
    unavailable = {s for s, e in RULE_OWNERSHIP.items() if e["decidedBy"] == "unavailable"}
    forbidden = sorted(unavailable & present)
    unknown = sorted(expected - present)
    if unknown:
        raise SystemExit(
            f"rule ownership: {', '.join(unknown)} declared in {RULE_OWNERSHIP_FILE.name} and present in "
            f"none of {len(records)} records. Either the corpus vocabulary moved or the key was never "
            "right; the keys are `target.subtypes` values such as '4.1.2:regex'."
        )
    if forbidden:
        raise SystemExit(
            f"rule ownership: {', '.join(forbidden)} is declared `unavailable` and yet present in the "
            f"export. The model exclusion has stopped working, so a head would be trained on evidence "
            "that cannot express its failure."
        )

def subtypes_by_criterion_for(records: list[dict[str, Any]], criteria: list[str]) -> dict[str, list[str]]:
    """Which subtypes get a trained HEAD, per criterion -- the single choke point `main()`'s per-criterion
    loop iterates, so a subtype absent here can never be fitted, whatever the corpus contains.

    Extracted out of `main()` so this is unit-testable without the encoder, the corpus, or torch: it is a
    pure function of `records`. `packages/lab/tests/test_model_head_exclusion.py` calls this directly on
    fabricated records, and separately trains a REAL (tiny, synthetic) head through this exact function's
    output to prove the excluded subtype's key is absent from a real safetensors artefact -- not merely
    absent from this dict.

    `rule-ownership.json`'s `modelHead: false` entries are removed here, before the loop ever sees them --
    the rules decide these subtypes and a head must never be fitted for them, whatever the corpus
    contains. See `Ownership.modelHead`'s own doc for why two different reasons (no corpus case yet;
    a head that would be a free veto) share one field: what is true of both is "no head", never
    "no corpus case".
    """
    return {
        criterion: sorted({
            subtype for record in records
            if criterion in record["target"].get("criteria", [])
            for subtype in record["target"].get("subtypes", [])
            if subtype.startswith(criterion + ":")
            and RULE_OWNERSHIP.get(subtype, {}).get("modelHead") is not False
        })
        for criterion in criteria
    }


def known_indices(records: list[dict[str, Any]], subtype: str, candidates: list[int]) -> list[int]:
    """`candidates`, minus the records whose status for `subtype` is UNKNOWN.

    A record labelled `clean` is a hard negative for EVERY head, which is only sound when the label's source
    actually claimed every criterion. W3C publishes a site-wide WCAG 2 AA conformance claim, so for its
    pages it does. Almost nobody else does: a public sector accessibility statement is typically "partially
    compliant" with an ENUMERATED list of failures, which is a richer label than a bare "fully compliant" --
    it says what is good and what is not, from the publisher's own mouth -- but only if the enumerated
    criteria can be marked unknown rather than silently trained as clean.

    Without this, one real page with a genuinely unlabelled image injects a false negative into
    `1.1.1:missing-alt` (88 positives), at the exact place the "0 false positives" claim lives. With it, the
    publishers who describe real APPLICATIONS become usable, and those are where the structural variety is:
    the full-compliance claims cluster almost entirely in accessibility-led documentation sites, which share
    the homogeneity the realism tier exists to break.
    """
    # Matches a bare CRITERION as well as an exact subtype, because that is the granularity publishers
    # write in. An accessibility statement says "WCAG 2.4.4 (Level A) - Link Purpose", never
    # "2.4.4:regex" -- so a criterion-level exception has to mask every subtype under it or it masks
    # nothing at all, silently, which is the failure mode this whole mask exists to prevent.
    criterion = subtype.split(":")[0]
    excluded = {subtype, criterion}
    unknown = {
        index for index in candidates
        if excluded.intersection(records[index]["target"].get("unknownSubtypes", []))
    }
    return [index for index in candidates if index not in unknown]


def main() -> None:
    # Imported HERE and not at module scope on purpose: inference must never pull in torch (a ~400 MB
    # wheel on every Action run), and training is the only caller that needs autograd. It must also be
    # the FIRST statement -- a later `import torch` inside this function makes the name local for the
    # whole body, so an earlier use raises UnboundLocalError rather than resolving a global.
    import torch
    args = parse_args()
    # BEFORE the work, not at save time. A guard that fires after training has already spent two minutes
    # (and, on a cold embedding cache, closer to seven) teaches you to pass the override reflexively, which
    # is how a guard stops being read.
    refuse_to_destroy_release_weights(args)
    random.seed(SEED)
    encoder_file = assert_encoder(args.encoder)
    assert_dataset_is_current(args.data)
    records = read_records(args.data)
    assert_declaration_matches_data(records)
    split_for_family = assign_splits(records)
    # The featurizer returns NUMPY now, so inference needs no torch — a 400 MB wheel removed from every
    # Action run. Training does need autograd, so it converts here, at its own boundary, and this is the
    # ONLY place the conversion happens. One featurizer, one contract: train and inference cannot drift
    # into different feature values, because they compute them with the same code and differ only in the
    # container they are handed back in.
    # Cached. The encoder is FROZEN and sees only `input`, so its output is a deterministic function of
    # unchanged bytes -- and it is 245.8 s of a ~290 s run, measured. Iterating on labels or pooling
    # recomputes it identically every time; see `embedding_cache.py` for the key and why `target` is
    # deliberately not in it.
    features_np, doc_features_np, doc_offsets, dimension, structured_dimension = cached_encode(
        sys.modules[__name__], records, args.encoder, args.max_length
    )
    features = torch.from_numpy(features_np)
    # Derived from the records, never passed between processes: the scorer recomputes it the same way.
    offsets = bag_offsets(records)
    # Both views, computed once. A document-pooled head sees one row per capture with identity
    # offsets, so it runs through the same bag machinery as an instance-pooled one -- a bag of size
    # one. See INSTANCE_POOLED_SUBTYPES for why the choice is per subtype.
    doc_features = torch.from_numpy(doc_features_np)
    views = {
        "instance-max": (features, offsets),
        "document-mean": (doc_features, doc_offsets),
    }
    from safetensors.torch import save_file

    criteria = sorted({criterion for record in records for criterion in record["target"].get("criteria", [])})
    subtypes_by_criterion = subtypes_by_criterion_for(records, criteria)
    split_indices = {
        split: [index for index, record in enumerate(records) if split_for_family[record["provenance"]["family"]] == split]
        for split in ("train", "validation", "test")
    }
    development_indices = split_indices["train"] + split_indices["validation"]
    weights = {}
    report: dict[str, Any] = {
        "schema": "a11y-witness/screenreader-scorer-training",
        "encoder": {"path": str(args.encoder), "hiddenSize": dimension, "modelSha256": sha256(encoder_file)},
        "representation": {
            "schema": FEATURE_SCHEMA_VERSION,
            "text": "channel-tagged screen-reader evidenceUnits",
            "embeddingSize": dimension,
            "structuredFeatureSize": structured_dimension,
            "structuredFeatureScale": ENGINEERED_FEATURE_SCALE,
            "structuredFeatureMultipliers": ENGINEERED_FEATURE_MULTIPLIERS,
            "structuredFeatures": list(FEATURE_NAMES),
            "maxLength": args.max_length,
        },
        "dataset": {"path": str(args.data), "sha256": sha256(args.data), "records": len(records),
                    # Read from the RECORDS, not from a flag or a filename. A test-grade export stamps
                    # every record, so a dataset cannot arrive here having lost its grade in transit —
                    # which is the whole reason the stamp is per record rather than in a summary file.
                    "grade": dataset_grade(records)},
        "split": {split: len(indices) for split, indices in split_indices.items()},
        "calibration": {
            "method": "grouped-out-of-fold-threshold-calibration",
            "folds": CALIBRATION_FOLDS,
            "developmentRecords": len(development_indices),
        },
        "criteria": {},
        # What the trainer can actually know: its own calibration, on the DEVELOPMENT split.
        "calibrationClean": True,
        # What it cannot know, and used to imply. `releaseEligible` was set purely from calibration, so
        # it certified a model the held-out set rejects — measured: calibration went perfectly clean
        # while acceptance failed on four criteria, unchanged. A flag computed on the split a model was
        # tuned against cannot detect fitting that split, and `score.py` trusts this field.
        #
        # Stays False until the acceptance evaluator stamps it, and names what is missing so nobody
        # reads absence as a pass. `release:gate` runs that evaluator; nothing else may set this.
        "generalisationVerified": False,
        "releaseBlockedBy": ["held-out acceptance has not been evaluated for these weights"]
        + (["dataset is TEST GRADE: some captures do not describe the page they are labelled against, "
            "so this model exists to answer a question and can never be promoted. Recapture and export "
            "without A11Y_DATASET_GRADE=test to produce a releasable one."]
           if dataset_grade(records) == "test" else []),
        # A TEST-GRADE DATASET CAN NEVER PRODUCE A RELEASABLE MODEL, and this is where that is enforced
        # rather than promised. Test grade means some captures do not describe the page they are labelled
        # against — deliberately, so a question can be answered without a four-hour recapture — and a
        # model fitted to that must not be promotable however good its numbers look.
        #
        # Set at INITIALISATION, before any gate can set it True: an eligibility that starts True and is
        # cleared later is one a later branch can quietly restore. `promote-model.mjs` refuses a model
        # that is not release-eligible, so this is the first of three independent gates and the only one
        # that cannot be argued with.
        "releaseEligible": dataset_grade(records) != "test",
        "modelReleaseEligible": dataset_grade(records) != "test",
        "warnings": [],
        # Notes that can actually stop a release, kept apart from notes worth reading. See `note()`.
        "calibrationBlockers": [],
    }
    for criterion in criteria:
        criterion_labels = torch.tensor(
            [int(criterion in record["target"].get("criteria", [])) for record in records],
            dtype=torch.float32,
        )
        subtype_oof_scores = []
        subtype_final_scores = []
        subtype_report = {}
        subtype_names: list[str] = []
        subtype_thresholds: dict[str, float] = {}
        for subtype in subtypes_by_criterion[criterion]:
            subtype_labels = torch.tensor(
                [int(subtype in record["target"].get("subtypes", [])) for record in records],
                dtype=torch.float32,
            )
            # Records whose status for THIS subtype is unknown are excluded from its head entirely --
            # training, threshold and metrics -- rather than counted as negatives. See `known_indices`.
            subtype_indices = known_indices(records, subtype, development_indices)
            masked = len(development_indices) - len(subtype_indices)
            if masked:
                # Informational: `known_indices` above has already excluded these records from this head's
                # training, threshold and metrics. It is worth knowing the development set is smaller than it
                # looks; it is not a reason to refuse a release.
                note(report, f"{subtype}: {masked} development record(s) masked as unknown by their "
                     "publisher's claim", blocking=False)
            subtype_development_labels = subtype_labels[subtype_indices]
            if int(subtype_development_labels.sum()) < 20:
                report["modelReleaseEligible"] = False
                if subtype not in RULE_SUBSTITUTED_SUBTYPES:
                    report["releaseEligible"] = False
                    report["calibrationClean"] = False
                note(report, f"{subtype}: fewer than 20 positive development records",
                     blocking=subtype not in RULE_SUBSTITUTED_SUBTYPES)
            pooling = pooling_for(subtype)
            view_features, view_offsets = views[pooling]
            oof_scores = out_of_fold_scores(
                view_features,
                subtype_labels,
                records,
                subtype_indices,
                args.epochs,
                view_offsets,
            )
            weight, bias = train_head(view_features, view_offsets, subtype_labels, subtype_indices, args.epochs)
            key = head_key(subtype)
            weights[key + ".weight"] = weight
            weights[key + ".bias"] = bias
            subtype_oof_scores.append(oof_scores)
            subtype_final_scores.append(score_bags(view_features, view_offsets, weight, bias))
            # Each head is calibrated on its own out-of-fold distribution. A subtype the RULES decide
            # still gets a threshold -- the report describes what the head would do, and the judge is
            # what declines to use it -- so the two layers can be compared on the same records instead
            # of one of them being invisible.
            subtype_development_scores = oof_scores[subtype_indices]
            sweep = threshold_sweep(subtype_development_scores, subtype_development_labels)
            # The cut is an order statistic of the NEGATIVE scores only -- the positives play no part in
            # choosing it. That is what makes the type I error bound hold without knowing anything about
            # how the positives are distributed, and it is why recall is now an OUTCOME to be reported
            # rather than something the threshold was traded against.
            negative_scores = [
                float(score) for score, label
                in zip(subtype_development_scores.tolist(), subtype_development_labels.tolist())
                if label == 0
            ]
            positive_scores = [
                float(score) for score, label
                in zip(subtype_development_scores.tolist(), subtype_development_labels.tolist())
                if label == 1
            ]
            subtype_threshold, subtype_guarantee = np_threshold(
                negative_scores, subtype, report["warnings"], positive_scores
            )
            subtype_names.append(subtype)
            subtype_thresholds[subtype] = subtype_threshold
            subtype_report[subtype] = {
                "head": key,
                # The view this head was TRAINED on. Inference reads it rather than assuming, because
                # scoring a document-pooled head per announcement (or the reverse) produces confident
                # numbers from the wrong representation -- and nothing downstream could tell.
                "pooling": pooling,
                # Calibrated on ITS OWN out-of-fold scores. This used to be a hardcoded 0.5, so every
                # per-subtype number in the report described an arbitrary cut rather than the one that
                # would be used -- which is how 4.1.2 came to report 13 false positives that no shipped
                # threshold had ever produced.
                "threshold": subtype_threshold,
                # What this cut PROMISES about pages nobody has seen. The whole point of moving to an
                # order statistic: `precision` on the development set is the constraint restated, and
                # only this is a claim that can be wrong.
                "guarantee": subtype_guarantee,
                # What every other cut would have cost. See `threshold_sweep` for why the chosen
                # number alone is not enough to diagnose a recall change.
                "thresholdSweep": sweep,
                # Who decides this subtype in production. Recorded here rather than on the criterion
                # because `rules:score` measures coverage per subtype, and the criterion-level answer
                # is wrong for every criterion the two layers share.
                "decisionOwner": (
                    "deterministic-rules" if subtype in RULE_SUBSTITUTED_SUBTYPES
                    else "learned-screenreader-scorer"
                ),
                # The criterion the RULE reports this subtype under, which is not always the criterion
                # the subtype is named for. `score.py` needs it to decide whether the rule's finding
                # actually SUBSTITUTES for the model's: an unnamed form field is `3.3.2:unnamed-form-field`
                # in the corpus and a 4.1.2 finding from the rules, so suppressing the model's 3.3.2 would
                # leave that criterion decided by neither layer -- the exact failure this file's
                # per-subtype ownership was written to stop, one granularity down.
                #
                # Absent for a model-owned subtype, and absent from older artifacts, where `score.py`
                # falls back to the subtype's own criterion. That fallback IS the old behaviour, so this
                # is additive on the wire like `fault` is.
                **({"ruleReportsAs": RULE_OWNERSHIP[subtype]["reportsAs"]}
                   if RULE_OWNERSHIP.get(subtype, {}).get("decidedBy") == "rules" else {}),
                # NOTE WHAT `precision` HERE CAN AND CANNOT TELL YOU. The threshold was chosen from
                # these same out-of-fold scores under a zero-false-positive constraint, so whenever
                # calibration SUCCEEDS this precision is 1.000 by construction -- the constraint
                # restated, not a measurement. Recall and the threshold are the informative columns.
                #
                # The contrapositive is the useful part, and it is stronger than it looks: a precision
                # below 1.000 can ONLY mean the fallback fired, so the head has no clean cut anywhere on
                # the grid and is not calibrated at all. "2 false positives" reads like a head that is
                # slightly over-eager; it actually means a head that cannot be separated.
                "development": metrics(
                    oof_scores[subtype_indices], subtype_development_labels, subtype_threshold
                ),
            }

        # A criterion fails when ANY of its subtypes does. It used to be `amax` over the subtype scores
        # followed by ONE threshold -- a single cut applied to a maximum over heads whose scores are on
        # different scales, so a high-scoring subtype dragged the cut up and no value reached zero false
        # positives. Each head is now cut on its own distribution and the criterion is the OR of those
        # decisions, which is what "any of these failures counts" actually means.
        criterion_oof_predicted = torch.stack(
            [scores >= subtype_thresholds[name] for name, scores in zip(subtype_names, subtype_oof_scores)]
        ).any(dim=0).float()
        criterion_final_predicted = torch.stack(
            [scores >= subtype_thresholds[name] for name, scores in zip(subtype_names, subtype_final_scores)]
        ).any(dim=0).float()
        # `metrics` takes scores and a threshold, so a decided 1.0/0.0 with a 0.5 cut reuses it exactly.
        DECIDED = 0.5
        # No criterion-level `threshold` any more, deliberately: there is no single number that means
        # anything once each subtype is cut on its own scale, and leaving a stale one in the report is
        # how a consumer keeps using the thing that was wrong. Consumers read the subtypes.
        model_owned = [name for name in subtype_names if name not in RULE_SUBSTITUTED_SUBTYPES]
        criterion_report = {
            # Kept for readability, but it is now DERIVED from the subtypes rather than declared over
            # them. "mixed" is the honest answer for 1.1.1 and 4.1.2, and saying so is the whole point:
            # calling those criteria "deterministic-rules" is what silenced the model on 174 records the
            # rules never look at.
            "decisionOwner": (
                "deterministic-rules" if not model_owned
                else "learned-screenreader-scorer" if len(model_owned) == len(subtype_names)
                else "mixed"
            ),
            "subtypes": subtype_report,
            "calibration": metrics(
                criterion_oof_predicted[development_indices],
                criterion_labels[development_indices],
                DECIDED,
            ),
        }
        for split, indices in split_indices.items():
            criterion_report[split] = metrics(criterion_final_predicted[indices], criterion_labels[indices], DECIDED)
            if int(criterion_labels[indices].sum()) == 0:
                report["modelReleaseEligible"] = False
                if model_owned:
                    report["releaseEligible"] = False
                    report["calibrationClean"] = False
                note(report, f"{criterion}: {split} split has no positive records", blocking=bool(model_owned))
        # PER SUBTYPE, against the bound that subtype was calibrated to -- the same rule and the same axis
        # `releasability.mjs` uses, pinned to it by scripts/fixtures/calibration-verdicts.json.
        #
        # This read the CRITERION-level aggregate and blocked on `falsePositive or falseNegative`, which
        # was wrong twice over. Zero tolerance predates Neyman-Pearson calibration, where bounded type-I
        # error is the point rather than a defect; and the criterion has no guarantee to compare against,
        # because the guarantee is computed per subtype. Measured 2026-08-25: six criteria declared
        # ineligible, five of them inside their own bound, and blocking on false negatives contradicted a
        # rule `releasability.test.ts` had pinned for weeks.
        for subtype_name, subtype_report in criterion_report["subtypes"].items():
            blocker = type_one_error_blocker(
                subtype_name,
                subtype_report.get("development") or {},
                subtype_report.get("guarantee"),
            )
            if not blocker:
                continue
            report["modelReleaseEligible"] = False
            # Blocks release when ANY subtype of this criterion is the model's to decide. Previously a
            # criterion labelled rule-owned was excused wholesale, so a model-owned subtype inside it
            # could fail calibration and only ever produce a warning.
            if model_owned:
                report["releaseEligible"] = False
                report["calibrationClean"] = False
            note(report, blocker, blocking=bool(model_owned))
        report["criteria"][criterion] = criterion_report

    # `releaseBlockedBy` must name the blockers that ACTUALLY exist, and it did not.
    #
    # It was set once, at initialisation, to the single line "held-out acceptance has not been evaluated
    # for these weights" -- true, but never updated when calibration then failed. So a report blocked by
    # 22 calibration errors on 4.1.2 announced acceptance as the only thing standing in the way, and the
    # errors sat in `warnings`, which nothing reads as blocking. That cost real time: it sent the next
    # step after an acceptance run that could not have helped, because acceptance is downstream of the
    # calibration this report was failing.
    #
    # Derived from the same `warnings` that made the decision, so the two cannot disagree.
    # From `calibrationBlockers`, NOT from every warning. Promoting all of them put 12 informational
    # "masked as unknown" notes into a 40-line blocker list, where a reader cannot tell a corpus that grew
    # from a model that got worse.
    if not report["calibrationClean"]:
        report["releaseBlockedBy"] = ([f"calibration: {w}" for w in report["calibrationBlockers"]]
                                      + report["releaseBlockedBy"])

    # A reference sample of the training distribution, so inference can tell whether a page resembles
    # anything this scorer was trained on. Measured need: every corpus record sits at cosine 0.847-0.99
    # from its nearest neighbour, while 28 of 32 real eval pages sit at 0.50-0.84 — outside the support
    # entirely. A linear head on a frozen embedding does not know it is extrapolating and returned 0.97
    # and 0.99 on two CONFORMANT W3C pages. For an accessibility tool that is an accusation, so the
    # scorer must be able to decline instead.
    #
    # k-nearest-neighbour distance in feature space, per Sun et al. (ICML 2022): non-parametric, no
    # distributional assumption, and stronger than the Mahalanobis alternative. Subsampled to keep the
    # artifact small; the whole training set is not needed to describe its support.
    #
    # `inDistributionFloor` is DERIVED, not chosen: it is the smallest nearest-neighbour similarity any
    # training record has. A page less similar to this corpus than the corpus is to itself is outside
    # what was validated. Provisional — the defensible form is conformal calibration against a stated
    # error rate on a real-page set, which does not exist yet (see docs/adr/0009-dataset-tiers.md).
    reference = doc_features[:, :dimension]
    # Evenly spaced across the WHOLE dataset. It was `reference[::step][:OOD_REFERENCE_SAMPLES]`, which
    # applies a stride AND a head-slice and therefore double-truncates: at 1,877 records the stride yields
    # 626 rows and the slice keeps the first 512, so indices 1534-1876 -- the last 18.3% -- never entered
    # the reference at all.
    #
    # That is not a rounding detail, it silently voided an experiment. The realism tier appends real-page
    # records to the END of the dataset, so NONE of them reached the reference, and the calibration pages'
    # novelty scores came back byte-identical to the baseline run: 0.6624, 0.6605, 0.6576... to four
    # decimal places. It read exactly like "19 real pages make no difference" and the real finding was
    # that the mechanism deciding novelty had never seen them.
    #
    # Same shape as this codebase's recurring fault: a step that produces plausible output -- a 512-row
    # reference and a derived floor -- while ignoring part of its input, with nothing to say it did.
    #
    # `floor` below is computed over the full `reference`, not the sample, so it was never affected. The
    # truncation only ever corrupted the reference SHIPPED for inference, which is the half that decides
    # whether a real page is called novel.
    # Two further corrections, both of which made the reference describe something other than what it
    # claims. Neither is a rounding detail either.
    #
    # **The test split was in it.** `reference` was every record, so 300 of 1,858 rows -- 16% -- described
    # captures no head ever trained on. "This page resembles what we trained on" is the whole claim, and a
    # sixth of the evidence for it came from the split held back to check that claim.
    #
    # **Records, not page STRUCTURES, set the floor.** The floor is a minimum over nearest-neighbour
    # similarity, so a cluster of near-identical records gives each of its members a near-twin and the
    # minimum cannot move. Measured three ways: 19 real pages from one publisher moved it not at all; 12
    # GOV.UK pages produced NINE identical cosines to four decimal places; and a good/bad pair differing by
    # one removed `alt` attribute sits at ~0.99 from its own sibling. Since `family` is exactly "records
    # that share a template", one row per family makes the floor a statement about distinct structures --
    # which is what it is supposed to mean, and it stops the statistic being gameable by adding duplicates.
    development_set = set(development_indices)
    seen_families = set()
    reference_rows = []
    for index, record in enumerate(records):
        if index not in development_set:
            continue
        family = record["provenance"]["family"]
        if family in seen_families:
            continue
        seen_families.add(family)
        reference_rows.append(index)
    structures = reference[torch.tensor(reference_rows, dtype=torch.long)]
    sample = structures[ood_reference_indices(structures.shape[0], torch)].contiguous()
    neighbours = structures @ structures.t()
    neighbours.fill_diagonal_(-1.0)
    floor = float(neighbours.max(dim=1).values.min())
    weights["ood_reference"] = sample
    # The derived floor is kept and reported alongside, so a reader can always see both what the data
    # implied and what was chosen. Reporting only the winner is how a number nobody chose ends up looking
    # like a measurement.
    chosen_floor = args.in_distribution_floor if args.in_distribution_floor is not None else floor

    report["outOfDistribution"] = {
        "method": "knn-cosine-document-embedding",
        "reference": "ood_reference",
        "referenceCount": int(sample.shape[0]),
        # What the floor is a statement ABOUT, so a reader never has to guess whether it counts records or
        # structures. It counted records until 2026-08-20, which is why adding duplicates could not move it.
        "distinctStructures": len(reference_rows),
        "splits": ["train", "validation"],
        "inDistributionFloor": round(chosen_floor, 4),
        "derivedFloor": round(floor, 4),
        "floorSource": "calibration-set" if args.in_distribution_floor is not None else "training-set-minimum",
        "calibration": (
            "chosen on the held-out calibration set and passed in with --in-distribution-floor; the "
            f"training set's own nearest-neighbour minimum was {round(floor, 4)}. Still NOT conformally "
            "calibrated against a stated error rate -- 22 calibration pages can express about 4.3% and no "
            "finer (see docs/adr/0010)."
            if args.in_distribution_floor is not None else
            "derived from the training set's own nearest-neighbour minimum; NOT conformally calibrated "
            "against a target error rate, and NOT the operating point chosen from held-out data. Pass "
            "--in-distribution-floor to set one."
        ),
    }

    args.output.mkdir(parents=True, exist_ok=True)
    save_file(
        weights,
        str(args.output / "model.safetensors.tmp"),
        metadata={
            "format": "pt",
            "encoder": "all-MiniLM-L6-v2",
            "encoder_sha256": sha256(encoder_file),
            "representation": FEATURE_SCHEMA_VERSION,
            "structured_features": json.dumps(list(FEATURE_NAMES)),
            "structured_feature_scale": str(ENGINEERED_FEATURE_SCALE),
            "structured_feature_multipliers": json.dumps(ENGINEERED_FEATURE_MULTIPLIERS, sort_keys=True),
            "max_length": str(args.max_length),
        },
    )
    # Temp + rename, so an interrupted train leaves the PREVIOUS weights intact instead of a truncated
    # file where a release-eligible model used to be. `save_file` writes in place, and this output
    # directory is a git-tracked build artifact — so a run killed at the wrong moment did not merely fail,
    # it destroyed something that took a fleet to produce. `rename` within one directory is atomic on
    # POSIX, which is the same guarantee `capture-progress.mjs` relies on.
    #
    # The report is written second and renamed second, deliberately: a reader that finds new weights and an
    # old report sees a version mismatch it can detect, whereas a new report promising a floor that the
    # weights beside it do not implement is a lie with no symptom.
    (args.output / "model.safetensors.tmp").replace(args.output / "model.safetensors")
    report_tmp = args.output / "training-report.json.tmp"
    report_tmp.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report_tmp.replace(args.output / "training-report.json")
    print(json.dumps(report, indent=2))
    if not report["releaseEligible"]:
        print("WARNING: this is a seed smoke-test artifact, not a release candidate")

if __name__ == "__main__":
    main()
