// @ts-check

/**
 * What the commit being released has changed since the one `RELEASE.md`'s own rehearsal entry says it ran against.
 *
 * #813 made this a GATE and #3184 (ADR 0042 decision 6) made it a READING: the outsider job's verdict now stands where the
 * marker stood, so nothing here refuses a publish and a marker that has gone stale is a number, never a failure. The marker
 * stays as the record of the last hand rehearsal (2026-09-20). `<!-- REHEARSAL:COMMIT <sha> -->` is the machine-readable
 * half: an HTML comment, invisible in rendered markdown, that survives a rewording of the surrounding prose the way a bare
 * regex over "against `a11y-witness@<short-sha>`" would not.
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
 * The public documents a V1 rehearsal is run FROM -- RELEASE.md's requirement 2 names the first three --
 * and the Action `docs/github-action.md` tells a reader to install (#1265).
 */
export const REHEARSAL_DOCUMENTS = ["README.md", "docs/try-it.md", "docs/github-action.md", "action.yml"];

/**
 * The packages a consumer installs: every `packages/<dir>/package.json` not marked `private` -- the third
 * thing #1265's done-when names, missing from the first build and found by `worker-capture` on #1291.
 *
 * DERIVED from the manifests rather than listed, so publishing a package widens the gate without anyone
 * remembering to. An over-approximation in the SAFE direction: npm refuses to publish a `private` package,
 * so everything a consumer CAN install is in this set, and a package that is merely never published only
 * makes the gate refuse more. Anything short of the boolean `true` counts as published for the same reason.
 * @param {{ dir: string, manifest: Record<string, unknown> }[]} packages
 * @returns {string[]} one directory pathspec per published package
 */
export function publishedPackagePaths(packages) {
  return packages.filter(({ manifest }) => manifest.private !== true).map(({ dir }) => `packages/${dir}/`);
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from the marker commit's committer date to `nowMs`, or `null` when the date is unreadable: an age nobody could
 * read is "unknown", never 0 days (absence is not proof of freshness).
 * @param {string | null | undefined} committedAt an ISO-8601 date, as `git show -s --format=%cI` prints it
 * @param {number} nowMs
 * @returns {number | null}
 */
export function ageInDays(committedAt, nowMs) {
  const then = Date.parse(committedAt ?? "");
  return Number.isNaN(then) ? null : Math.max(0, Math.floor((nowMs - then) / MS_PER_DAY));
}

/**
 * THE READING, PURE. `readable: false` means a fact could not be read, which is a defect in the reading and is never
 * reported as staleness; `readable: true` means `lines` say how far the marker is behind, and that is ALL they say:
 * a stale marker is not a failure, because the marker no longer gates a publish.
 * @param {{ releaseMd: string | null, releaseSha: string | null, isAncestor?: boolean | null,
 *           changedPaths?: string[] | null, diffError?: string, ageDays?: number | null }} input
 *   `isAncestor` and `changedPaths` are `null` -- or omitted -- when the read could not be made: a caller that forgets to
 *   gather a fact gets `readable: false`, never a clean reading.
 * @returns {{ readable: boolean, lines: string[] }}
 */
export function rehearsalReading(
  { releaseMd, releaseSha, isAncestor = null, changedPaths = null, diffError = "", ageDays = null }) {
  const marked = rehearsalMarkerSha(releaseMd);
  if (!marked) {
    return unreadable("RELEASE.md carries no `<!-- REHEARSAL:COMMIT <sha> -->` marker, so there is no hand rehearsal on record to read");
  }
  if (!releaseSha) return unreadable("could not resolve the commit being released, so nothing was compared");
  if (isAncestor === null) {
    return unreadable(`could not tell whether the rehearsal marker ${marked} is an ancestor of ${releaseSha}`);
  }
  const age = ageDays === null ? "of unknown age" : `${ageDays} day(s) old`;
  if (isAncestor === false) {
    return { readable: true, lines: [`the rehearsal marker ${marked} (${age}) is NOT an ancestor of ${releaseSha}: the hand `
      + "rehearsal ran on a history this release is not descended from"] };
  }
  // A diff that could not be taken is its OWN unreadable state, never a changed path: reported as a change it would state
  // something nobody observed, collapsing the could-not-tell / no split kept for ancestry above (#1291).
  if (changedPaths === null) {
    return unreadable(`could not tell whether anything the rehearsal exercises changed since ${marked}: the diff could not `
      + `be taken${diffError ? `: ${diffError}` : ""}`);
  }
  return { readable: true, lines: [`the rehearsal marker ${marked} (${age}) is an ancestor of ${releaseSha}; the rehearsal `
    + `EXERCISES ${changedPaths.length} path(s) that have changed since it`, ...changedPaths.map((p) => `  ${p}`)] };
}

/** @param {string} line @returns {{ readable: false, lines: string[] }} */
function unreadable(line) {
  return { readable: false, lines: [line] };
}
