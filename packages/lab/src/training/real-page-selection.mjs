// @ts-check
// WHICH REAL PAGES EACH NUMBER RESTS ON -- the selections, in one module that reaches no corpus (#955).
//
// Three readers rest a number on the real-page corpus, and each admits pages by its own rule:
//
//   the conformance line   `rules:real-pages` (check-real-page-findings.ts)  a page whose publisher declares
//                                                                            it conformant
//   the figures            `calibrate-abstention.mjs`                       the `calibration` role
//   the training set       `build-realism-tier.mjs`                         the `training` role
//
// `field` (#955) -- pages a stranger is likely to point this tool at, with no conformance claim -- must reach
// none of them. It already reaches none, because each rule admits only its own role or claim. What this
// module adds is that the rules live HERE, each reader imports its own, and `field-role.test.ts` asserts
// through these very functions -- never through a second list of which roles count, which is the list that
// would go stale the next time a role is added.
//
// SPLIT OUT OF THE READERS for a measured reason: all three import `dataset-paths.mjs`, and a test whose
// import graph reaches it is classed as needing a corpus, so the row's own acceptance command would be
// refused by `pr:open`. The same move `board-gates.mjs` made out of `board-data.mjs` (#946). Each reader
// still calls exactly this function, so there is one copy.
import { isRecordedRefusal, realPageFor } from "./real-page-corpus.mjs";

/**
 * The conformance line's answer for one capture's url: the declared, conformant page it is of -- or null,
 * with why. A `field` page is its own answer, decided BEFORE the claim: it makes no claim, so "not
 * conformant" would be true and misleading, since that bucket means a publisher declared the page
 * inaccessible.
 * @param {unknown} url
 * @returns {{ page: NonNullable<ReturnType<typeof realPageFor>>, why: null }
 *   | { page: null, why: "undeclared" | "not conformant" | "field" }}
 */
export function conformanceLineAnswer(url) {
  const page = realPageFor(url);
  if (page?.role === "field") return { page: null, why: "field" };
  if (!page || page.publishedClaim !== "conformant") return { page: null, why: page ? "not conformant" : "undeclared" };
  return { page, why: null };
}

/**
 * THE FIGURES' SELECTION -- asserted-wrongly and referred: captures whose CORPUS role is `calibration`,
 * joined by url, never by the role the capture was stamped with (see `calibrate-abstention.mjs` for what
 * the stamp cost).
 * @template {{ capture?: { url?: string } }} E @param {readonly E[]} entries @returns {E[]}
 */
export function calibrationEntries(entries) {
  return entries.filter((entry) => realPageFor(entry.capture?.url ?? "")?.role === "calibration");
}

/**
 * THE TRAINING SET'S SELECTION: captures whose CORPUS role is `training`, joined by url.
 * @template {{ capture?: { url?: string } }} E @param {readonly E[]} entries @returns {E[]}
 */
export function trainingEntries(entries) {
  return entries.filter((entry) => realPageFor(entry.capture?.url ?? "")?.role === "training");
}

/**
 * RULE COVERAGE'S REAL POPULATION -- `rules:coverage` (`audit-rule-coverage.ts`): every real-page capture
 * except a `field` page's (#955, worker-capture's review of #970). That audit grades a rule "validated on real
 * evidence" when it fires on one, clears a channel's "no-channel" when one carries it, and counts captures
 * toward its completeness floor. A field page claims nothing, so a rule firing there validates nothing, and
 * its captures would inflate the floor with pages the audit cannot judge. A capture no entry claims is still
 * counted, exactly as before: this removes `field` and nothing else.
 * @param {unknown} url @returns {boolean}
 */
export const ruleCoverageAdmits = (url) => realPageFor(url)?.role !== "field";

/**
 * THE FIELD POPULATION, PRINTED APART FROM THE CONFORMANCE LINE (#955, `ceo`'s acceptance). What a reader of
 * `rules:real-pages` needs about pages that claim nothing: which were captured, which are recorded refusals
 * with the outcome a stranger meets, and which have no capture yet -- so a missing capture never reads as a
 * clean page. No line here opens with a verdict word, so the board's headline (`board-gates.mjs`'s
 * `worstVerdict`, which reads the gate's own verdict line) can never take one of these for it.
 * @param {readonly { url: string, refused?: { fault: string, reason: string, observed: string } }[]} fieldPages
 *   the corpus's own `pagesFor("field")`
 * @param {ReadonlySet<string>} captured the declared urls the run found a capture of
 * @returns {string[]}
 */
export function fieldPopulationLines(fieldPages, captured) {
  const refusals = fieldPages.filter(isRecordedRefusal);
  const toCapture = fieldPages.filter((page) => !isRecordedRefusal(page));
  const have = toCapture.filter((page) => captured.has(page.url));
  const lines = [`  field: ${fieldPages.length} page(s) a stranger is likely to point this tool at (#955) -- no `
    + "conformance claim, so not in the line above, the baseline, or any figure:",
  `    ${have.length} of ${toCapture.length} captured${have.length ? "" : " -- none on disk yet"}`];
  for (const page of toCapture.filter((p) => !captured.has(p.url))) lines.push(`      not captured: ${page.url}`);
  lines.push(`    ${refusals.length} recorded refusal(s), never captured -- the outcome is the entry:`);
  for (const { url, refused } of refusals) {
    lines.push(`      ${url} -> ${refused?.fault} (${refused?.reason} to ${refused?.observed})`);
  }
  return lines;
}
