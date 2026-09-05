// @ts-check
/**
 * Did a change to the capture pipeline alter the EVIDENCE, or only its timing?
 *
 * This exists to make capture optimisations affordable. The cache key includes `provisionRevision`
 * and `CAPTURE_PROTOCOL_VERSION`, and changing either invalidates all 2,122 captures — so any Edge or
 * NVDA speed-up "costs a full recapture" before you even know whether it changed what NVDA says. The
 * key is a conservative proxy: it asks whether anything that COULD change the evidence changed, never
 * whether the evidence actually did. Nothing in the tooling could answer the second question --
 * `bench-capture.mjs` reports phrase counts, which `CLAUDE.md` explicitly warns are not enough
 * ("assert what was heard, not how much"), and `check-signals` needs the recapture to have happened.
 *
 * So this compares evidence field by field, on the same pages, and reports one of three verdicts.
 *
 * The comparison is deliberately asymmetric about what matters. Structure and interaction are the
 * fields signals read, so any difference there is a real change. The transcript is subject to NVDA's
 * run-to-run variance, so it is compared as a SET with the drift named rather than as an exact
 * sequence — a capture is allowed to hear the same things in a different order, but not to stop
 * hearing them.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Fields a dataset signal can read. A difference in any of these is a change in evidence. */
/**
 * @typedef {Record<string, any>} EvidenceCapture
 *
 * `any` deliberately, and only here. This module's whole job is walking a parsed capture by field paths
 * held in data (`EVIDENCE_FIELDS` below), so a precise shape would have to be re-stated for every field
 * the table names -- a second spelling of the table, which is the duplication this repo pays most for.
 * The paths are the contract; the object is JSON.
 */

/** @type {[string, string][]} */
export const EVIDENCE_FIELDS = [
  ["structure", "headings"], ["structure", "landmarks"], ["structure", "formFields"],
  ["structure", "tableCells"], ["structure", "links"], ["structure", "lists"],
  ["structure", "graphics"],
  ["interaction", "controls"], ["interaction", "stateChanges"], ["interaction", "formChanges"],
  ["interaction", "postSubmitFields"], ["interaction", "focusOrder"],
  // ADDED 2026-08-29, and both were being read by criteria while this gate ignored them.
  //
  // `routeChange` is the declared evidence channel for 2.4.1 AND 2.4.2 in `criterion-coverage.ts` and
  // `outcomes.ts` — the single-page-app transition that "a static analyser cannot reach at all, because
  // the markup is valid at every instant and the failure is the TRANSITION". `postSubmitNames` is named
  // in capture-core's own protocol note as something "criteria read". Neither was compared, so a change
  // that broke `probeNavigation` would have reported SAME and shipped without a recapture — from the one
  // gate whose entire job is deciding whether 2,122 cached captures may be kept.
  //
  // This is the `repeat-capture` defect at a second tool: "compared ten fields and not `formChanges` or
  // `postSubmitFields` — the two carrying interaction evidence. Ten fields watched, and the ones this
  // fault lives in were not among them." A remedy that reached one of several tools.
  ["interaction", "postSubmitNames"], ["interaction", "routeChange"],
  // ADDED 2026-09-01 with capture-protocol 11, and `evidence-fields.test.ts` is what required it: both
  // appeared on captures the moment the fleet ran the new code, and a field on disk that is neither
  // compared nor excluded is a hole this gate cannot see. `frames` is the iframe sweep; `dialogEscape`
  // is an object, so it goes through the same flattening as `routeChange`.
  ["structure", "frames"], ["interaction", "dialogEscape"],
  // ADDED 2026-09-05, the day `focusReveal` first reached the channel — and `evidence-fields.test.ts`
  // is what required it, within minutes, exactly as designed. The field had existed on the worker
  // since the probe was written; it was dropped at four hops before reaching `interaction`, so no
  // capture carried it and nothing here was missing. The moment the drop was fixed, a field existed
  // on disk that this gate neither compared nor excluded — which means a change altering 1.4.13's
  // evidence would have reported SAME and shipped without a recapture, from the one gate whose job
  // is deciding whether cached captures may be kept. An OBJECT, so it flattens like `routeChange`.
  ["interaction", "focusReveal"],
  // Capture-protocol 13. Both are OBJECTS, so they go through the same flattening as `routeChange` and
  // `dialogEscape` — a list-of-objects read as a count is the defect this file was fixed for today.
  ["interaction", "arrowNavigation"], ["interaction", "typedFeedback"],
  // Capture-protocol 14, for 3.2.1 On Focus. An OBJECT like the four above, so the same flattening
  // applies — and it matters more here than for most, because the whole finding is a pair of strings
  // (`titleBefore`, `titleAfter`) whose EQUALITY is the verdict. Compared by count it would read SAME on
  // a change that inverted the criterion.
  //
  // `typedFeedback` gained `titleBefore`/`titleAfter` in the same protocol for 3.2.2 and is already
  // listed, so the flattening picks those up without a second entry.
  ["interaction", "focusContext"],
];

/**
 * A phrase's shape, ignoring the wording NVDA varies between runs.
 *
 * Kept crude on purpose: lowercased and whitespace-collapsed only. Normalising harder (stripping
 * punctuation, numbers, role words) would hide exactly the differences this tool exists to find.
 */
/** @param {unknown} phrase */
function normalise(phrase) {
  return String(phrase ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * One list entry's comparable form — a string as itself, an OBJECT as its sorted `key=value` pairs.
 *
 * `String({...})` is `"[object Object]"`, so mapping `normalise` over a list of objects made every entry
 * identical and compared the list BY COUNT. Measured 2026-09-01 on the real function: a `formChanges`
 * entry whose `after` went from `"Error: name is required"` to `""` reported **SAME**.
 *
 * Exactly two compared fields hold objects — `interaction.formChanges` and `interaction.stateChanges` —
 * and they are the evidence for 3.3.1, 4.1.2 and 4.1.3, including the head that gained 7.4 points of
 * recall in v17 by reading `formChanges[].kind`. So the one gate that decides whether 2,122 cached
 * captures may be kept was blind to the content of the channel most likely to move.
 *
 * This is the SAME defect the object branch below was written to fix, one shape along: that branch was
 * added for `routeChange`, a bare object, and objects INSIDE an array went on reading as a count. Its own
 * comment names the principle — *"comparing nothing while appearing to compare something is worse than
 * the omission it fixes"* — and the fix reached one of the two places the shape occurs. This repo's most
 * expensive recurring pattern, in the tool that exists to catch it.
 *
 * Keys are SORTED so a field-order change in capture-core cannot read as an evidence change; `undefined`
 * is written as the literal `undefined` rather than dropped, because a field that stopped being recorded
 * IS an evidence change and dropping it would hide exactly that.
 *
 * @param {unknown} entry @returns {string}
 */
function flatten(entry) {
  if (!entry || typeof entry !== "object") return normalise(entry);
  return Object.entries(entry)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${normalise(value)}`)
    .join(" ");
}

/**
 * @param {EvidenceCapture | null | undefined} capture
 * @param {[string, string]} field
 * @returns {string[]}
 */
function fieldValues(capture, [group, name]) {
  const value = capture?.[group]?.[name];
  if (Array.isArray(value)) return value.map(flatten);
  // AN OBJECT, FLATTENED. `routeChange` is `{control, titleBefore, titleAfter, headingBefore,
  // headingAfter}` rather than a list, and the array-only version returned [] for it — so adding it to
  // the table above without this would have compared nothing while appearing to compare something,
  // which is worse than the omission it fixes. Each entry becomes `key=value`, so a title that stopped
  // changing shows as a lost `titleafter=...` rather than a bare count.
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, entry]) => `${key}=${normalise(entry)}`);
  }
  return [];
}

/**
 * Items in `a` that are absent from `b`, preserving order and duplicates.
 * @param {string[]} a @param {string[]} b @returns {string[]}
 */
function missingFrom(a, b) {
  const remaining = [...b];
  return a.filter((item) => {
    const at = remaining.indexOf(item);
    if (at === -1) return true;
    remaining.splice(at, 1);
    return false;
  });
}

/**
 * Compare one capture against its baseline.
 *
 * Verdicts, worst first:
 *   CHANGED    — a field a signal reads differs. The cache MUST be invalidated for this change.
 *   DRIFT      — structure and interaction match; the transcript gained or lost phrases.
 *   SAME       — every field matches and the transcript carries the same phrases.
 *
 * DRIFT is the interesting one: it is what NVDA's normal variance looks like, but it is also what
 * evidence rot looks like, so the phrases are named rather than counted. A readiness gate once
 * replaced the first line of every capture and phrase COUNTS did not move — that is precisely the
 * failure a count-based check cannot see.
 */
/**
 * Both are required to be REAL captures: every caller guards first, and the body dereferences
 * `transcript` unguarded, which has been its contract since it was written.
 *
 * @param {EvidenceCapture} baseline
 * @param {EvidenceCapture} candidate
 */
export function compareCapture(baseline, candidate) {
  const changes = [];
  for (const field of EVIDENCE_FIELDS) {
    const before = fieldValues(baseline, field);
    const after = fieldValues(candidate, field);
    const lost = missingFrom(before, after);
    const gained = missingFrom(after, before);
    if (lost.length || gained.length) {
      changes.push({ field: field.join("."), before: before.length, after: after.length, lost, gained });
    }
  }

  const before = (baseline.transcript ?? []).map(normalise);
  const after = (candidate.transcript ?? []).map(normalise);
  const lostPhrases = missingFrom(before, after);
  const gainedPhrases = missingFrom(after, before);

  const verdict = changes.length ? "CHANGED"
    : (lostPhrases.length || gainedPhrases.length) ? "DRIFT"
      : "SAME";
  return {
    verdict, changes,
    phrases: { before: before.length, after: after.length, lost: lostPhrases, gained: gainedPhrases },
  };
}

/**
 * Roll individual comparisons up into a decision about the cache.
 *
 * The rule is the point of the whole tool: **only a CHANGED verdict justifies invalidating the
 * cache.** DRIFT alone does not — NVDA varies between runs, and a recapture would produce drift
 * against itself — but drift on most of the sample is a signal worth a human look, so it is reported
 * with its scale rather than waved through.
 */
/**
 * @param {{ comparison?: { verdict?: string } | null }[]} results
 */
export function summarise(results) {
  // SKIPPED is a verdict about the CHECK, not the evidence: the page title could not be read, so the
  // capture could not be gated and must not be compared. It was added when a down page server made
  // every title read fail, the gate was bypassed, and 48 captures of Edge's error page were reported
  // as changed evidence -- a recommendation to recapture 2,122 captures.
  // `Record<string, number>` rather than the inferred five-key object. The guard below is precisely a
  // check for a verdict NOT among those five, so a type that admits only the five makes the recovery
  // path unexpressible -- the shape of "a check must never reject evidence whose absence is the finding",
  // applied to a lookup.
  /** @type {Record<string, number>} */
  const counts = { SAME: 0, DRIFT: 0, CHANGED: 0, REJECTED: 0, SKIPPED: 0 };
  // Count defensively. An unknown verdict used to land as `undefined + 1` -> NaN, which propagates
  // through `compared`, the drift share and the recommendation, so a new verdict silently turned the
  // whole summary into nonsense rather than failing.
  for (const { comparison } of results) {
    const verdict = comparison?.verdict;
    // `typeof !== "string"` FIRST, and it is not ceremony: a missing verdict is precisely the unknown
    // verdict this guard exists for, and folding it in is what lets the compiler agree the line below
    // is safe. The runtime answer is unchanged -- `hasOwn(counts, undefined)` was already false.
    if (typeof verdict !== "string" || !Object.hasOwn(counts, verdict)) {
      throw new Error(`unknown evidence verdict ${JSON.stringify(verdict)}`);
    }
    counts[verdict] += 1;
  }
  // REJECTED captures are excluded from the denominator, not counted against the change. A capture the
  // pipeline itself would throw away says nothing about whether the evidence moved -- it says the
  // capture failed, which a real run answers by retrying. Including them would let a flaky worker
  // masquerade as an evidence change, and that is how a good optimisation gets blamed for a bad guest.
  const compared = counts.SAME + counts.DRIFT + counts.CHANGED;
  const driftShare = counts.DRIFT / (compared || 1);
  const rejectedNote = (counts.REJECTED
    ? ` ${counts.REJECTED} capture(s) were rejected by the pipeline's own gates and excluded; re-run if that is most of the sample.`
    : "")
    // Never silent. A check that quietly examined less than it was asked to is how "unchanged" comes
    // to mean "unexamined", which is the failure this whole verdict exists to prevent.
    + (counts.SKIPPED
      ? ` ${counts.SKIPPED} capture(s) could not be gated (page title unreadable) and were NOT compared.`
      : "");
  // Zero comparisons is NOT "unchanged". `evidenceChanged: counts.CHANGED > 0` is false when
  // nothing was compared at all, so a run in which every capture failed reported "evidence
  // unchanged — safe to ship" and exited 0. Observed: 48 of 48 captures failed with
  // EHOSTUNREACH because the worker had gone to sleep, and this said the evidence was fine.
  //
  // The note above already says a check that examined less than it was asked to must never be
  // silent — it just did not cover examining NOTHING, which is the extreme case rather than a
  // different one.
  const examinedNothing = compared === 0;
  // PARTIAL COVERAGE IS NOT A PASS EITHER, and the comment above stopped one step short of saying so:
  // it fixed the extreme (nothing compared) and left the middle open. Measured 2026-08-21 -- a concurrent
  // run stopped the page server 2 captures in, and this reported
  //
  //     2 compared: 2 same, 0 drift, 0 changed
  //     evidence unchanged -- safe to ship WITHOUT invalidating the cache
  //
  // on 2 of 48, exiting 0. The skip note was printed and true, and the verdict above it still said ship.
  //
  // The sample is STRATIFIED one case per family precisely so no family goes unexamined, so a skipped
  // capture is not a smaller sample -- it is a family about which this tool now has no opinion, while
  // answering a question ("may I keep 2,122 cached captures?") whose wrong answer is expensive. Full
  // coverage or no verdict; a re-run costs minutes.
  const attempted = compared + counts.SKIPPED + counts.REJECTED;
  const coverage = attempted ? compared / attempted : 0;
  const inconclusive = compared === 0 || compared < attempted;
  return {
    counts, compared, attempted, coverage, inconclusive, examinedNothing,
    evidenceChanged: counts.CHANGED > 0,
    // Named threshold rather than a bare number: below this, drift is NVDA being NVDA.
    driftIsWidespread: driftShare > WIDESPREAD_DRIFT_SHARE,
    recommendation: (examinedNothing
      ? "NOTHING WAS COMPARED — this is not a pass. Every capture failed or was excluded, so the "
        + "evidence is UNKNOWN. Check the worker is reachable and the dataset pages are being served."
      : inconclusive
        ? `INCONCLUSIVE — only ${compared} of ${attempted} captures could be compared, so whole families `
          + "went unexamined and this cannot say whether the evidence moved. Fix the cause below and re-run; "
          + "do NOT read the comparisons that did land as a verdict on the ones that did not."
      : counts.CHANGED > 0
        ? "evidence CHANGED — triage each one: a field a signal reads may have moved. If real, bump CAPTURE_PROTOCOL_VERSION and recapture."
        : driftShare > WIDESPREAD_DRIFT_SHARE
          ? "no field changed, but most of the sample drifted — re-run to separate NVDA variance from a real effect before trusting this."
          : "evidence unchanged — safe to ship WITHOUT invalidating the cache.") + rejectedNote,
  };
}

/** Above this share of drifting captures, stop calling it NVDA variance and look again. */
const WIDESPREAD_DRIFT_SHARE = 0.5;

/**
 * Read a capture, or null when the baseline has no such case.
 * @param {string} dir @param {string} id @param {string} variant
 */
export function readCapture(dir, id, variant) {
  const path = resolve(dir, `${id}.${variant}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read ${path}: ${/** @type {Error} */ (error).message}`, { cause: error });
  }
}
