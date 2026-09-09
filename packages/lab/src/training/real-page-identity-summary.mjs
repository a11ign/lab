// @ts-check
/**
 * #780: THE MEASUREMENT #688 MADE BY HAND, MADE DURABLE. #688 asked how often a pre-registered real page
 * serves a document other than the one requested, and answered it once, on 2026-09-09: 0 of 19 `matched`
 * captures, a 15.8% upper bound at 95% by the rule of three. That answer is about one afternoon; the
 * evidence for the next one already sits in every capture this run takes, so it is counted every time
 * the tool runs rather than when somebody remembers to ask.
 *
 * `documentIdentity(capture).targetMatch` is the discriminator (`@a11ign/evidence/document-identity`,
 * #687/#722) — NEVER `domCensus.targetMatch` directly, and the two are different facts that happen to
 * share a name. `domCensus.targetMatch` is ONE mark's own answer: did that single CDP census confirm the
 * target it read (#699)? `documentIdentity(...).targetMatch` (`targetMatchIn` in that module) is the
 * LEAST-CONFIRMED of every census mark the capture carries, `structureCensus` and `domCensus` both — a
 * capture with one confirmed mark and one fallback mark has not confirmed its identity, and reading only
 * `domCensus` would let the weaker read hide behind the stronger one. `"matched"` means every census this
 * capture carries confirmed the CDP target it asked for; `"fallback"` means at least one did not (the
 * four calendly captures on 2026-09-09 describe a Google sign-in wall and a privacy notice the capture
 * had navigated to, never the scheduling page requested).
 *
 * `compareIdentity` is NOT used here: it answers whether two captures' identities MATCH EACH OTHER (an
 * evidence-drift question), and this question has no second capture to compare against — it is asking
 * ONE capture whether it confirmed its OWN target, which `documentIdentity`'s own `targetMatch` already
 * answers directly.
 *
 * `null` IS NOT ZERO, and is never counted toward the denominator. A capture with NEITHER `structureCensus`
 * NOR `domCensus` did not CONFIRM disagreement with what was requested — it recorded nothing to ask the
 * question of, and folding that into "0 of M" would report a capture that was never examined as evidence
 * of matching, the exact silent-pass shape `examinedNothing`-style guards exist to end elsewhere in this
 * repository. Such a capture is named explicitly ("no identity") rather than silently dropped, for the
 * identical reason: silence reads as nothing to report, and this is a fact worth stating.
 */
import { documentIdentity } from "@a11ign/evidence/document-identity";

/**
 * `-.15` for a K=0 rule-of-three upper bound, `~3/n`. Not a general statistics helper — this repository's
 * own convention is to name a bound where it is used, not to build a library nobody else calls.
 * @param {number} m
 * @returns {number}
 */
function ruleOfThreeUpperBoundPercent(m) {
  return (3 / m) * 100;
}

/**
 * @typedef {{ url: string, targetMatch: string | null }} IdentityCheck
 */

/**
 * Pure: derives the identity check for each capture, from the capture record alone.
 * @param {{ url: string, capture: unknown }[]} captures
 * @returns {IdentityCheck[]}
 */
export function identityChecksFor(captures) {
  return captures.map(({ url, capture }) =>
    ({ url, targetMatch: documentIdentity(/** @type {any} */ (capture)).targetMatch }));
}

/**
 * "K of M captures described the page that was requested, by identity." — #780's whole deliverable.
 *
 * `checks` with `targetMatch: null` are EXCLUDED from `M` entirely (see this file's own header) —
 * `identityChecksFor` above is where they enter the pipeline, this function is where they leave it. They
 * are still NAMED, never silently dropped: a capture examined and found to have no identity is a
 * different fact from a capture nobody looked at, and "no identity" says which.
 *
 * When EVERY capture has no identity (including an empty `checks`), prints an explicit "no identity"
 * statement rather than nothing — a blank line reads as "this tool has nothing to say", and a report
 * stating "0 of 0 matched" reads as a measurement when it is not one; both are silence this function
 * refuses to produce.
 *
 * @param {IdentityCheck[]} checks
 * @returns {string}
 */
export function servedRequestedPageLine(checks) {
  const withIdentity = checks.filter((check) => check.targetMatch !== null);
  const noIdentity = checks.filter((check) => check.targetMatch === null);
  const m = withIdentity.length;
  if (m === 0) {
    return "no capture in this run has a document identity to check "
      + "(no structureCensus or domCensus mark).\n";
  }
  const unmatched = withIdentity.filter((check) => check.targetMatch !== "matched");
  const k = m - unmatched.length;
  let line = `${k} of ${m} captures described the page that was requested, by identity.`;
  // NAMED, NOT JUST COUNTED — #780's acceptance 2: a reader can go and look rather than re-derive which
  // capture served something else, the same "named, not counted" rule `capture-real-pages.mjs`'s own
  // failure list already follows two lines below where this is printed.
  if (unmatched.length > 0) {
    line += ` NOT MATCHED: ${unmatched.map((check) => check.url).join(", ")}.`;
  }
  // NAMED, NOT SILENTLY EXCLUDED — #780/ceo: a capture with no identity is a different fact from one that
  // matched or one that did not, and folding it into either (or dropping it without a word) is the exact
  // "counting either way" this row refuses to do.
  if (noIdentity.length > 0) {
    line += ` NO IDENTITY (not counted above): ${noIdentity.map((check) => check.url).join(", ")}.`;
  }
  // THE RULE-OF-THREE BOUND, ONLY WHEN K IS ZERO — #688's own headline number, and the reason this whole
  // row exists: "0 of 19" and "0%" render as the same claim, and only the first says how much it rests
  // on. Printing the bound only at k=0 keeps the ordinary case (some matches) from being crowded by a
  // statistic that describes the OTHER case.
  if (k === 0) {
    line += ` At 95% confidence this bounds the true rate at ${ruleOfThreeUpperBoundPercent(m).toFixed(1)}% `
      + "(rule of three).";
  }
  return `${line}\n`;
}
