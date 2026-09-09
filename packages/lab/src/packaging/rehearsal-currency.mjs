// @ts-check

/**
 * Does the commit being released match the one `RELEASE.md`'s own rehearsal entry says it ran against?
 *
 * #813's own rule: a rehearsal covers the ONE commit it ran against, never the tip of a branch by
 * assumption. Written as prose ("whenever the current commit is not the one named above, no rehearsal
 * covers it") that is a rule a human has to remember to apply -- this repo's own definition of a rule
 * that gets broken. `<!-- REHEARSAL:COMMIT <sha> -->` is the machine-readable half: an HTML comment,
 * invisible in rendered markdown, that survives a rewording of the surrounding prose the way a bare regex
 * over "against `a11y-witness@<short-sha>`" would not.
 */

const MARKER = /<!--\s*REHEARSAL:COMMIT\s+([0-9a-f]{7,40})\s*-->/;

/**
 * The sha `RELEASE.md`'s own marker names, or `null` if the marker is absent entirely -- distinct from a
 * mismatch, which needs the actual release commit to detect.
 * @param {string | null} releaseMd
 * @returns {string | null}
 */
export function rehearsalMarkerSha(releaseMd) {
  if (!releaseMd) return null;
  const m = MARKER.exec(releaseMd);
  return m ? m[1] : null;
}

/**
 * THE VERDICT, PURE. `[]` means the rehearsal on record covers the commit being released; anything else
 * is a refusal reason, never inferred silently.
 * @param {{ releaseMd: string | null, releaseSha: string | null }} input
 * @returns {string[]}
 */
export function rehearsalCurrencyProblems({ releaseMd, releaseSha }) {
  const marked = rehearsalMarkerSha(releaseMd);
  if (!marked) {
    return ["RELEASE.md carries no `<!-- REHEARSAL:COMMIT <sha> -->` marker at all -- no rehearsal is on "
      + "record for ANY commit, which is a stronger refusal than a stale one"];
  }
  // FAIL CLOSED on an unresolved release commit -- the opposite of "cannot ask, so let it through". This
  // gate exists specifically to stop an assumption standing in for a measurement; treating "I could not
  // tell" as "must be current" would be exactly that assumption, one layer in.
  if (!releaseSha) {
    return ["could not resolve the commit being released -- refusing rather than guessing whether the "
      + "rehearsal on record is current"];
  }
  // PREFIX-TOLERANT, either direction: a short sha in one and a full sha in the other must still compare
  // equal, the same convention `merge-guard.mjs` uses for the identical reason.
  if (!releaseSha.startsWith(marked) && !marked.startsWith(releaseSha)) {
    return [`RELEASE.md's rehearsal marker names ${marked}, but the commit being released is ${releaseSha}`
      + " -- a rehearsal covers the one commit it ran against, not whatever HEAD has become since. Run "
      + "the rehearsal again and update the marker (and the prose beside it) before this release."];
  }
  return [];
}
