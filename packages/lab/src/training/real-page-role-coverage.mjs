// @ts-check
/**
 * A partial real-page refresh looks complete, at the moment it happens -- #314.
 *
 * `capture-real-pages.mjs` takes `--role=calibration|training` and defaults to one of them, so a run that
 * refreshes one role and leaves the others untouched produces the same "N/N captured" success line as a
 * run that refreshed everything. Nothing in the run's own output says which roles it did not touch.
 *
 * `rules:real-pages` eventually says so -- *"role 'training' was LEFT BEHIND by the last refresh"* -- but
 * only at the gate, against a baseline that is by then however many days wide, and only for a reader who
 * runs it. This module makes the same fact visible in the CAPTURE's own output, at the time.
 *
 * `discoverRoles` reads the corpus itself rather than a hand-written list of role names, for the reason
 * this repository keeps re-learning: *"a hand-written list is the shape that let this through"* -- a role
 * added to the corpus without also being added to a separate enumeration is invisible to a check built
 * from the enumeration, and would report every run touching it as leaving it behind forever.
 */

/**
 * Every role the corpus actually declares, discovered rather than enumerated.
 * @param {{role: string}[]} pages
 * @returns {string[]}
 */
export function discoverRoles(pages) {
  return [...new Set(pages.map((page) => page.role))].sort();
}

/**
 * One line naming which roles this run touched and which it left behind. `refreshed`/`leftBehind` are
 * partitions of `allRoles`, never independently supplied, so the two can never disagree about a role's
 * membership -- the same shape `resumePlan`'s single `skip` set uses for the identical reason.
 *
 * @param {{allRoles: string[], touchedRoles: string[]}} input
 * @returns {string}
 */
export function roleCoverageLine({ allRoles, touchedRoles }) {
  const touched = new Set(touchedRoles);
  const leftBehind = allRoles.filter((role) => !touched.has(role));
  const refreshedPart = touchedRoles.length
    ? `refreshed ${touchedRoles.join(", ")}`
    : "refreshed nothing";
  if (!leftBehind.length) return `  ${refreshedPart}; every role in the corpus was touched by this run\n`;
  return `  ${refreshedPart}; LEFT BEHIND: ${leftBehind.join(", ")} -- this run did not touch `
    + `${leftBehind.length === 1 ? "that role" : "those roles"}, and its captures will age relative to `
    + "what this run just took\n";
}
