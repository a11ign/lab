#!/usr/bin/env node
// @ts-check
// command: refuse a release not descended from RELEASE.md's rehearsal marker, or that changed a document the
//          rehearsal exercised since it

/**
 * `#813`'s gate half: `release:gate:ci` calls this, and it refuses `publish-for-real` when the commit
 * about to be released is not the one the most recent V1 rehearsal actually ran against, printing both
 * shas. The runbook half (`RELEASE.md`'s own prose) says the rule; this is what makes the mutation the
 * row names -- a rehearsal that predates the release commit -- fail a COMMAND, not a reader who forgot to
 * check a date.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { rehearsalCurrencyProblems, rehearsalMarkerSha, REHEARSAL_EXERCISES }
  from "../src/packaging/rehearsal-currency.mjs";
import { sandboxGitEnv } from "../../../scripts/git-env.mjs";

refuseUnknownFlags([], { entry: import.meta.url, command: "npm run release:rehearsal-check" });

/**
 * The tree to examine, overridable so this gate can be PROVEN rather than trusted -- `docs/proving-a-
 * gate.md` step 2, the identical convention `check-shipped-provenance.mjs`'s own `A11Y_PROVENANCE_ROOT`
 * uses for the same reason.
 */
const REPO = process.env.A11Y_REHEARSAL_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const RELEASE_MD = resolve(REPO, "RELEASE.md");

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
 * Is `marker` an ancestor of `sha`? `null` on any failure -- the decision treats that as a refusal,
 * never as "must be current". `git merge-base --is-ancestor` exits 1 for "no" and >1 for "could not
 * tell", so the two are separated by the STATUS rather than collapsed into one falsy answer (#1279).
 * @param {string} root @param {string} marker @param {string} sha
 */
function ancestorOf(root, marker, sha) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", marker, sha],
    { cwd: root, encoding: "utf8", env: sandboxGitEnv() });
  if (r.error || r.status === null || r.status > 1) return null;
  return r.status === 0;
}

/**
 * Which of the rehearsal's exercised paths changed between the marker and the release commit.
 *
 * `--no-renames` deliberately, carried from `check-pin`'s own step (#939): with rename detection a file
 * renamed OUT of the pathspec reports as unchanged, which is the one direction that matters here.
 * @param {string} root @param {string} marker @param {string} sha
 * @returns {string[] | null} `null` when the diff could not be taken at all
 */
function changedSince(root, marker, sha) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", marker, sha, "--",
      ...REHEARSAL_EXERCISES], { cwd: root, encoding: "utf8", env: sandboxGitEnv() });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** @returns {number} process exit code */
function main() {
  const releaseMd = existsSync(RELEASE_MD) ? readFileSync(RELEASE_MD, "utf8") : null;
  // `A11Y_REHEARSAL_RELEASE_SHA` lets a test (or a CI job that already knows the release sha some other
  // way) supply it directly, without needing `root` to be a real git checkout at all.
  const releaseSha = process.env.A11Y_REHEARSAL_RELEASE_SHA || currentSha(REPO);
  const marked = rehearsalMarkerSha(releaseMd);
  // The two git facts are gathered HERE and passed in: the decision stays pure, so a spawn cannot end up
  // inside the judgement. A diff that could not be taken is `null`, which reads as "could not tell"
  // rather than as "nothing changed" -- an empty list and a failed read are different answers (#1279).
  const isAncestor = marked && releaseSha ? ancestorOf(REPO, marked, releaseSha) : null;
  const changed = marked && releaseSha && isAncestor === true ? changedSince(REPO, marked, releaseSha) : [];
  const problems = rehearsalCurrencyProblems({ releaseMd, releaseSha, isAncestor,
    changedPaths: changed ?? ["(the diff against the marker could not be taken)"] });

  const marker = rehearsalMarkerSha(releaseMd);
  process.stdout.write(`  rehearsal marker: ${marker ?? "none"}; release commit: ${releaseSha ?? "unknown"}\n`);
  for (const problem of problems) process.stdout.write(`\n  ${problem}\n`);

  // Identical shape to `check-shipped-provenance.mjs`: one artefact (RELEASE.md's own marker), one
  // question (does it name the release commit), so INCONCLUSIVE is unreachable here for the same reason
  // it is unreachable there -- there is no partial examination of one marker.
  const verdict = gateVerdict({
    examined: 1, of: 1,
    source: "RELEASE.md's own rehearsal marker",
    failures: problems.length,
  });
  process.stdout.write(`\n  ${renderVerdict(verdict)}\n`);
  return exitCodeFor(verdict);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
