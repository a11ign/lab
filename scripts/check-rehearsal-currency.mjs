#!/usr/bin/env node
// @ts-check
// command: print how far RELEASE.md's rehearsal marker is behind the commit about to be released: the marker, its age, and the exercised paths changed since. Never blocks a publish

/**
 * A READING since #3184 (it was `#813`'s gate, in `release:gate:ci` and `release:gate`). The outsider job's verdict
 * (`registry-consumer-gate.yml`, ADR 0042) took the gate's place, so this prints the marker's commit, its age in days
 * and how many exercised paths changed since -- the marker's ANCESTRY and the exercised set are still what #1265 settled
 * -- and exits 0 whatever it found. It exits 2 (could not tell) only when it could not read: a stale marker is a number, not a failure.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { rehearsalReading, rehearsalMarkerSha, ageInDays, REHEARSAL_DOCUMENTS, publishedPackagePaths }
  from "../src/packaging/rehearsal-currency.mjs";
import { sandboxGitEnv } from "../../guards/src/git-env.mjs";

refuseUnknownFlags([], { entry: import.meta.url, command: "npm run release:rehearsal-check" });

/**
 * The tree to examine, overridable so this gate can be PROVEN rather than trusted -- `docs/proving-a-
 * gate.md` step 2, the identical convention `check-shipped-provenance.mjs`'s own `A11Y_PROVENANCE_ROOT`
 * uses for the same reason.
 */
const REPO = process.env.A11Y_REHEARSAL_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const RELEASE_MD = resolve(REPO, "RELEASE.md");

/** `ls-tree -r` over `packages/` is thousands of lines; spawnSync's 1 MB default would truncate it into ENOBUFS. */
const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * `git rev-parse HEAD` at `root`, scrubbed of every `GIT_*` variable -- an inherited `GIT_DIR` redirecting
 * this onto a different repository would make the comparison meaningless silently. `null` on any failure,
 * never a guess: `rehearsalCurrencyProblems` treats that as a refusal, not as "must be current".
 * @param {string} root
 * @returns {string | null}
 */
function currentSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", env: sandboxGitEnv() }).trim();
  } catch {
    return null;
  }
}

/**
 * `git` at `root` with every `GIT_*` scrubbed, keeping the STATUS and STDERR that a pipe or a bare `catch`
 * would discard (#1279): the status says whether a read happened, stderr says why it did not.
 * @param {string} root @param {string[]} args
 */
function gitAt(root, args) {
  return spawnSync("git", args,
    { cwd: root, encoding: "utf8", env: sandboxGitEnv(), maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
}

/**
 * One line naming a git read that did not happen, and git's own reason.
 * @param {string} what @param {import("node:child_process").SpawnSyncReturns<string>} r
 */
function gitFailure(what, r) {
  const reason = (r.stderr || r.error?.message || "no stderr").trim();
  return `git ${what} exited ${r.status ?? "without a status"}: ${reason}`;
}

/**
 * Is `marker` an ancestor of `sha`? `null` on any failure -- the decision treats that as a refusal,
 * never as "must be current". `git merge-base --is-ancestor` exits 1 for "no" and >1 for "could not
 * tell", so the two are separated by the STATUS rather than collapsed into one falsy answer (#1279).
 * @param {string} root @param {string} marker @param {string} sha
 */
function ancestorOf(root, marker, sha) {
  const r = gitAt(root, ["merge-base", "--is-ancestor", marker, sha]);
  if (r.error || r.status === null || r.status > 1) return null;
  return r.status === 0;
}

/**
 * The published packages AS OF THE RELEASE COMMIT, read from its tree rather than the working tree: the
 * release sha can be supplied (`A11Y_REHEARSAL_RELEASE_SHA`) and need not be what is checked out.
 * @param {string} root @param {string} sha
 * @returns {{ paths: string[] } | { error: string }}
 */
function publishedAt(root, sha) {
  const listing = gitAt(root, ["ls-tree", "-r", "--name-only", sha, "--", "packages/"]);
  if (listing.error || listing.status !== 0) return { error: gitFailure("ls-tree", listing) };
  const manifests = listing.stdout.split("\n").filter((p) => /^packages\/[^/]+\/package\.json$/.test(p));
  const packages = [];
  for (const path of manifests) {
    const shown = gitAt(root, ["show", `${sha}:${path}`]);
    if (shown.error || shown.status !== 0) return { error: gitFailure("show", shown) };
    try {
      packages.push({ dir: path.split("/")[1], manifest: JSON.parse(shown.stdout) });
    } catch (cause) {
      return { error: `${path} at ${sha} is not JSON: ${String(cause)}` };
    }
  }
  return { paths: publishedPackagePaths(packages) };
}

/**
 * Which exercised paths changed between the marker and the release commit: `{ paths }`, or `{ error }`
 * carrying git's own reason -- an empty list and a failed read are different answers (#1279), and an
 * operator handed only the refusal cannot act on it.
 *
 * `--no-renames` is carried from `check-pin`'s step (#939), but it is NOT what makes a rename OUT of the
 * pathspec visible: on git 2.53.0 a pathspec-limited diff reports that rename as a deletion with or without
 * the flag, because the pathspec filters before renames are paired (`worker-capture` on #1291, reproduced).
 * What the flag does is list a rename BETWEEN two exercised paths under both names, not only the new one.
 * @param {string} root @param {string} marker @param {string} sha @param {string[]} pathspecs
 * @returns {{ paths: string[] } | { error: string }}
 */
function changedSince(root, marker, sha, pathspecs) {
  const r = gitAt(root, ["diff", "--name-only", "--no-renames", marker, sha, "--", ...pathspecs]);
  if (r.error || r.status !== 0) return { error: gitFailure("diff", r) };
  return { paths: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) };
}

/**
 * The two git facts the decision needs, gathered HERE so the decision stays pure and a spawn never ends up
 * inside the judgement (#1265): ancestry, then -- for an ancestor only -- which exercised paths changed.
 * Each is `null` when it could not be read, which the decision refuses.
 * @param {string | null} marked @param {string | null} releaseSha
 * @returns {{ isAncestor: boolean | null, changedPaths: string[] | null, diffError: string }}
 */
function gitFacts(marked, releaseSha) {
  if (!marked || !releaseSha) return { isAncestor: null, changedPaths: null, diffError: "" };
  const isAncestor = ancestorOf(REPO, marked, releaseSha);
  if (isAncestor !== true) return { isAncestor, changedPaths: null, diffError: "" };
  const published = publishedAt(REPO, releaseSha);
  const changed = "error" in published
    ? published
    : changedSince(REPO, marked, releaseSha, [...REHEARSAL_DOCUMENTS, ...published.paths]);
  return "error" in changed
    ? { isAncestor, changedPaths: null, diffError: changed.error }
    : { isAncestor, changedPaths: changed.paths, diffError: "" };
}

/**
 * The marker commit's age in days, from its committer date: `null` when git could not say (an unknown age is printed as
 * unknown, never as zero).
 * @param {string | null} marked @returns {number | null}
 */
function markerAgeDays(marked) {
  if (!marked) return null;
  const shown = gitAt(REPO, ["show", "-s", "--format=%cI", marked]);
  return shown.status === 0 ? ageInDays(shown.stdout.trim(), Date.now()) : null;
}

/** @returns {number} process exit code: 0 for a reading, 2 only when the reading could not be made */
function main() {
  const releaseMd = existsSync(RELEASE_MD) ? readFileSync(RELEASE_MD, "utf8") : null;
  // `A11Y_REHEARSAL_RELEASE_SHA` lets a test (or a CI job that already knows the release sha some other
  // way) supply it directly, without needing `root` to be a real git checkout at all.
  const releaseSha = process.env.A11Y_REHEARSAL_RELEASE_SHA || currentSha(REPO);
  const marked = rehearsalMarkerSha(releaseMd);
  const reading = rehearsalReading({ releaseMd, releaseSha, ageDays: markerAgeDays(marked), ...gitFacts(marked, releaseSha) });

  process.stdout.write(`  rehearsal marker: ${marked ?? "none"}; release commit: ${releaseSha ?? "unknown"}\n`);
  process.stdout.write(`\n  ${reading.lines.join("\n  ")}\n`);
  // THE EXIT CODE IS ABOUT THE READING, NOT THE MARKER (#3184). A marker 190 paths behind is a number and exits 0: the
  // outsider job's verdict (`registry-consumer-gate.yml`) is what stands where this stood, and no publish chain names this
  // command. A fact that could not be read is INCONCLUSIVE (exit 2, the repo's "could not tell"), never a fresh marker. The
  // verdict is built with `gateVerdict` so a reading that examined nothing cannot exit 0, but only INCONCLUSIVE is rendered:
  // "PASS ... clean" beside 190 changed paths would read as a claim about the marker that nobody is making.
  const verdict = gateVerdict({ examined: reading.readable ? 1 : 0, of: 1, source: "RELEASE.md's own rehearsal marker" });
  process.stdout.write(verdict.verdict === "PASS"
    ? "\n  READING ONLY: this never blocks a publish (ADR 0042 decision 6).\n"
    : `\n  NOT READ: ${renderVerdict(verdict)}. This is not a staleness result.\n`);
  return exitCodeFor(verdict);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
