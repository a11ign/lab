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

const DEFAULT_ROLE = "training";
const defaultRoleCount = pagesFor(DEFAULT_ROLE).length;
const totalDeclared = REAL_PAGES.length;

/**
 * One line per role: how many, and the window they were captured in. PURE, so it can be tested against
 * the cases that matter without a corpus — the mixed population must WARN and the single run must NOT.
 *
 * @param {{ at: string, role: string }[]} ages
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
