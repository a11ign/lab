// @ts-check
/**
 * Report how old the real-page captures a reader is about to use are — the only staleness signal there
 * is, and the reason every reader of `runs/real-page-corpus/` needs to say it.
 *
 * ## Why this exists, and why it moved here
 *
 * `capture-real-pages` DEFAULTS to `--role=training`, which is 39 of the 98 declared pages (the other 59
 * split `calibration` 49 and `fixture` 10). So the ordinary way to refresh the corpus refreshes well under
 * half of it, and a reader that treats every file it finds as equally current is comparing a MIXED
 * population without knowing it. `check-real-page-findings.ts` (`rules:real-pages`) measured the cost of
 * this directly: a run reported 42 new findings over captures spanning 01:54 to 03:55, and reading one of
 * the OLDER ones produced a confident wrong conclusion about a diagnostic field being absent on fallback
 * pages specifically — it was absent because that capture predated the field. One timestamp settled what
 * a mechanism argument had got wrong.
 *
 * `captureAgeLines` was written there first and exported PURE specifically so a second reader could use
 * it rather than restate it. It moved here, to its own `.mjs` module, because the readers that needed it
 * next -- `lab-inventory.mjs`, `calibrate-abstention.mjs` and `build-realism-tier.mjs`, all plain `node`
 * -- cannot import a `.ts` file the way `check-real-page-findings.ts` (run under `tsx`) can. A `.ts` file
 * importing a plain `.mjs` module has never been a problem; the reverse is. So this is the "derive one
 * from the other" remedy CLAUDE.md prefers, applied at the layer that makes both directions work.
 *
 * ## The two facts a reader must not pretend to have
 *
 * A real-page capture records `capturedAt` and `role` and NO `codeVersion` at all — unlike the synthetic
 * corpus, there is no way to tell "captured across a worker change" from "captured an hour apart by one
 * pipeline". Age is the only signal available, so this reports it honestly rather than implying more:
 * a spread is not automatically wrong (one pipeline capturing every role back to back is the NORMAL case
 * and must not warn), and the absence of any `capturedAt` at all must print as NOT RECORDED, never as a
 * clean age — the same rule `capture:explain` already applies to a mark that was never asked for.
 *
 * ## The role counts are DERIVED, not restated
 *
 * This function used to hardcode "39 of the 85" in its own warning text, and `capture-age-spread.test.ts`
 * asserted on that literal string. The corpus has since grown a THIRD role (`fixture`, 4 -> 10) and the
 * total to 98, and neither the prose nor the test noticed — "39 of the 85" was quietly wrong the whole
 * time this module was being written. Read from `real-page-corpus.mjs`'s own `REAL_PAGES` instead, so the
 * next role added or page retired cannot leave a stale number sitting in a warning nobody re-reads.
 */
import { REAL_PAGES, pagesFor } from "./real-page-corpus.mjs";

/**
 * How far apart two captures may be before the spread is worth saying out loud.
 *
 * Six hours: comfortably longer than a full multi-role capture of the corpus across the fleet and far
 * shorter than the gap a half-refreshed corpus produces. A threshold rather than any difference, because
 * one pipeline capturing every role back to back is the NORMAL case and must not warn.
 */
export const ROLE_SPREAD_WARN_MS = 6 * 60 * 60 * 1000;

/** How many missing pages to NAME before falling back to a count -- the count is never truncated. */
const NAMED_MISSING = 10;

const DEFAULT_ROLE = "training";
const defaultRoleCount = pagesFor(DEFAULT_ROLE).length;
const totalDeclared = REAL_PAGES.length;

/**
 * #1181: WHICH DECLARED PAGES NOTHING CAPTURED — pure, so the reconciliation is testable without a corpus.
 *
 * Every reader here reports on the captures it FOUND. A page declared in `REAL_PAGES` that was never
 * captured contributes no entry, so it is absent from the ages, absent from the role counts, and absent
 * from the spread — **invisible to every line this module prints.** The reporter says the corpus is fresh
 * because everything it can see is fresh, and what it cannot see is the thing that went wrong.
 *
 * That is this repository's own most expensive shape: *an absence has many causes*, and a reader that only
 * ever enumerates what exists cannot distinguish "not captured" from "not declared". The comparison has to
 * run the other way round — from the DECLARED list, which is the only place that knows a page should exist.
 *
 * **THE TWO ADDRESSES ARE NOT GUARANTEED EQUAL, and that is the limit of this comparison.** A capture is
 * written under the DECLARED address, but `capture.url` is the one it LANDED ON -- `real-page-corpus.mjs`'s
 * own typedef says nothing records where a capture was requested from. So a page that redirects (a slash
 * added, `http` upgraded, a locale prefix) is named here as having no capture while its capture is on
 * disk. The direction is safe -- a false alarm, never a false clean -- but the sentence it prints is one
 * this row taught people to believe, so: **check for a redirect before checking for a capture.**
 *
 * The key that cannot drift is `slug(page.url)`, which is what captures are WRITTEN under and is derived
 * from the declared address by construction. It is not exported today; exporting it is its own row.
 *
 * @param {readonly string[]} declared every url `REAL_PAGES` names
 * @param {readonly string[]} found every url a capture was read for
 * @returns {string[]} declared urls with no capture, sorted
 */
export function missingCaptures(declared, found) {
  const seen = new Set(found);
  return [...new Set(declared)].filter((url) => !seen.has(url)).sort();
}

/**
 * One line per role: how many, and the window they were captured in. PURE, so it can be tested against
 * the cases that matter without a corpus — the mixed population must WARN and the single run must NOT.
 *
 * @param {{ at: string, role: string, url?: string }[]} ages
 * @returns {string[]}
 */

export function captureAgeLines(ages) {
  if (ages.length === 0) {
    // Absent prints as NOT RECORDED, never as OK — `capture:explain`'s rule. A corpus of captures too old
    // to carry `capturedAt` must not read as a corpus captured just now.
    return ["  capture ages: NOT RECORDED — no scored capture carries `capturedAt`"];
  }
  const byRole = new Map();
  for (const { at, role } of ages) byRole.set(role, [...(byRole.get(role) ?? []), at]);
  const lines = ["  the captures this scored were taken:"];
  for (const [role, times] of [...byRole].sort()) {
    const sorted = [...times].sort();
    const [oldest, newest] = [sorted[0], sorted[sorted.length - 1]];
    lines.push(`    ${role}: ${times.length} capture(s), `
      + (oldest === newest ? oldest : `${oldest} .. ${newest}`));
  }
  // #1181: THE RECONCILIATION, and it runs only when the caller can supply urls. A caller that passes
  // none gets silence rather than "0 missing" -- `could not ask` and `the answer is none` are different
  // facts, and printing the second for the first is how this module came to say a half-captured corpus
  // was fresh.
  const urls = ages.flatMap((c) => (typeof c.url === "string" ? [c.url] : []));
  // AN ENTRY WITH NO URL IS UNREADABLE, NOT MISSING -- worker-judge on #1183, and it is this repo's
  // most-recorded distinction: "could not ask" must not render as "the answer is no". Without this
  // branch a capture whose `url` did not survive its write is named as a page nobody captured, which
  // sends the reader to the fleet for a file that is on disk.
  const unreadable = ages.length - urls.length;
  // ABOVE the reconciliation guard, not inside it -- worker-judge on #1183. Gated on `urls.length > 0`,
  // this line vanished in the ONE state where the reader most needs it: every capture lacking a url, which
  // is what a shape change or an older corpus produces, all at once. A branch added to end silence that is
  // itself silent on its own worst input is the defect this row is about, three lines under the comment
  // stating the rule it broke.
  if (unreadable > 0) {
    lines.push(`  *** ${unreadable} capture(s) carry NO url, so they could not be reconciled at all. `
      + "They are neither present nor missing below -- this is `could not ask`, not `the answer is no`.");
  }
  if (urls.length > 0) {
    const missing = missingCaptures(REAL_PAGES.map((p) => p.url), urls);
    if (missing.length > 0) {
      // THE COUNT FIRST, then names, capped. A reader that printed all of them would bury the number in a
      // wall on the run where the number is largest -- and the largest number is the one that matters most.
      lines.push(`  *** ${missing.length} of ${REAL_PAGES.length} DECLARED page(s) have NO capture here, `
        + "so every count above excludes them. Nothing else reports this: a page with no capture "
        + "contributes no age, no role and no spread, and is invisible to every line of this report.");
      for (const url of missing.slice(0, NAMED_MISSING)) lines.push(`      ${url}`);
      if (missing.length > NAMED_MISSING) {
        lines.push(`      ... and ${missing.length - NAMED_MISSING} more`);
      }
    }
  }
  const all = ages.map((c) => c.at).sort();
  const newestOverall = Date.parse(all[all.length - 1]);
  const spreadMs = newestOverall - Date.parse(all[0]);
  // WHICH ROLE WAS LEFT BEHIND, BY NAME, not just that the ages differ.
  //
  // `--role` is a free string filter, so every role is technically reachable; what a bare spread number
  // does not say is which one the last refresh MISSED. DERIVED from the timestamps rather than from a
  // list of roles, deliberately: a hand-written "roles that matter" list is the fact-stated-twice shape,
  // and it would go stale the first time a role is added — which is exactly the event this exists to make
  // visible without anyone updating a list.
  const behind = [...byRole]
    .filter(([, times]) => newestOverall - Date.parse([...times].sort().pop() ?? "") > ROLE_SPREAD_WARN_MS)
    .map(([role]) => role);
  if (spreadMs > ROLE_SPREAD_WARN_MS) {
    lines.push(`  *** ${Math.round(spreadMs / 3600000)} hour(s) between the oldest and newest, so this `
      + "compares a MIXED population against one baseline.");
    lines.push(`  *** \`capture-real-pages\` defaults to --role=${DEFAULT_ROLE}, which refreshes `
      + `${defaultRoleCount} of the ${totalDeclared}. To refresh every role:  `
      + "npm run lab:pipeline -- --pipeline=real-pages");
  }
  for (const role of behind) {
    lines.push(`  *** role '${role}' was LEFT BEHIND by the last refresh — every one of its captures `
      + `predates the newest. Refresh it:  npm run lab:job -- -e job=capture-real-pages -e role=${role}`);
  }
  return lines;
}
