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
const EVIDENCE_FIELDS = [
  ["structure", "headings"], ["structure", "landmarks"], ["structure", "formFields"],
  ["structure", "tableCells"], ["structure", "links"], ["structure", "lists"],
  ["structure", "graphics"],
  ["interaction", "controls"], ["interaction", "stateChanges"], ["interaction", "formChanges"],
  ["interaction", "postSubmitFields"], ["interaction", "focusOrder"],
];

/**
 * A phrase's shape, ignoring the wording NVDA varies between runs.
 *
 * Kept crude on purpose: lowercased and whitespace-collapsed only. Normalising harder (stripping
 * punctuation, numbers, role words) would hide exactly the differences this tool exists to find.
 */
function normalise(phrase) {
  return String(phrase ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function fieldValues(capture, [group, name]) {
  const value = capture?.[group]?.[name];
  return Array.isArray(value) ? value.map(normalise) : [];
}

/** Items in `a` that are absent from `b`, preserving order and duplicates. */
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
export function summarise(results) {
  // SKIPPED is a verdict about the CHECK, not the evidence: the page title could not be read, so the
  // capture could not be gated and must not be compared. It was added when a down page server made
  // every title read fail, the gate was bypassed, and 48 captures of Edge's error page were reported
  // as changed evidence -- a recommendation to recapture 2,122 captures.
  const counts = { SAME: 0, DRIFT: 0, CHANGED: 0, REJECTED: 0, SKIPPED: 0 };
  // Count defensively. An unknown verdict used to land as `undefined + 1` -> NaN, which propagates
  // through `compared`, the drift share and the recommendation, so a new verdict silently turned the
  // whole summary into nonsense rather than failing.
  for (const { comparison } of results) {
    const verdict = comparison?.verdict;
    if (!Object.hasOwn(counts, verdict)) throw new Error(`unknown evidence verdict ${JSON.stringify(verdict)}`);
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
  return {
    counts, compared, examinedNothing,
    evidenceChanged: counts.CHANGED > 0,
    // Named threshold rather than a bare number: below this, drift is NVDA being NVDA.
    driftIsWidespread: driftShare > WIDESPREAD_DRIFT_SHARE,
    recommendation: (examinedNothing
      ? "NOTHING WAS COMPARED — this is not a pass. Every capture failed or was excluded, so the "
        + "evidence is UNKNOWN. Check the worker is reachable and the dataset pages are being served."
      : counts.CHANGED > 0
        ? "evidence CHANGED — triage each one: a field a signal reads may have moved. If real, bump CAPTURE_PROTOCOL_VERSION and recapture."
        : driftShare > WIDESPREAD_DRIFT_SHARE
          ? "no field changed, but most of the sample drifted — re-run to separate NVDA variance from a real effect before trusting this."
          : "evidence unchanged — safe to ship WITHOUT invalidating the cache.") + rejectedNote,
  };
}

/** Above this share of drifting captures, stop calling it NVDA variance and look again. */
const WIDESPREAD_DRIFT_SHARE = 0.5;

/** Read a capture, or null when the baseline has no such case. */
export function readCapture(dir, id, variant) {
  const path = resolve(dir, `${id}.${variant}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read ${path}: ${error.message}`, { cause: error });
  }
}
