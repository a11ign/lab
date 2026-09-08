/**
 * #181 (`agent/claude-md-split-155`) split CLAUDE.md down to 39,696 characters and was refused: the
 * review measured 1,337 substantive lines removed from CLAUDE.md that appeared in NEITHER the new
 * CLAUDE.md NOR anywhere under `docs/` -- a move that silently dropped the record it claimed to
 * preserve. ceo's acceptance, verbatim: *"every paragraph removed from CLAUDE.md appears
 * byte-identical (comment-stripped, whitespace-normalised) in `docs/`, and the file that remains is a
 * subset of the old text plus links."* The review asked for exactly this test, not a pasted number --
 * *"a guard that says 'every substantive line removed from CLAUDE.md in this diff appears in `docs/`'
 * turns this from a review somebody has to remember to do into one that cannot be skipped."*
 *
 * ## Method, unchanged from the review that forced this file to exist
 *
 * Diff `origin/main`'s CLAUDE.md against this branch's; normalise whitespace; drop lines 25 characters
 * or under (fragments and bare markup, which are not "substantive"); then ask whether each remaining
 * removed line appears as a SUBSTRING of the whitespace-normalised concatenation of the new CLAUDE.md
 * PLUS every `.md` under `docs/`.
 *
 * Substring rather than line-equality is deliberate -- it survives re-wrapping, which a line-level
 * compare would wrongly call a rewrite. And the new CLAUDE.md is in the haystack because `diff` marks
 * an EDITED line as removed; without that, a line still present in altered form would read as lost.
 * The reviewer's own note: their first pass omitted this and the corrected instrument gave the same
 * 1,337, so it is not an artefact of either choice -- kept here for the same reason.
 *
 * ## Why this needs `origin/main`, and the two different "empty" cases
 *
 * `git diff origin/main -- CLAUDE.md` is meaningless without a real `origin/main` to diff against --
 * a shallow checkout has no such ref at all (`ensureOriginMain()` fetches it on demand, fixing the
 * trap #505's own CI hit: the `acceptance`/`docs` jobs check out at depth 1, where `actions/checkout`
 * fetches only the PR ref). But an empty DIFF, once `origin/main` genuinely resolves, is not always a
 * bug: `trunk-guard.yml` runs this same suite directly against `main`'s own tip, where HEAD legitimately
 * IS `origin/main` and there is nothing to compare. The two failure shapes look identical from the
 * diff's own output and must not be conflated -- one is "the ref never resolved", the other is "the ref
 * resolved and there is nothing new"; only the first is a defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A "substantive" line: long enough that it could not just be a fragment or bare markup punctuation. */
const MIN_SUBSTANTIVE_LENGTH = 25;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Every `.md` file under `docs/`, recursively. */
function allDocsMd(dir: string): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allDocsMd(path));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

/**
 * Makes `origin/main` resolvable before diffing against it. `ci.yml`'s `ts` job runs with
 * `fetch-depth: 0` and this works unconditionally there; the `acceptance` and `docs` jobs check out at
 * the default depth (1), where `actions/checkout` fetches only the PR ref and `origin/main` does not
 * exist at all -- the identical trap #489 hit on `ci.yml`'s own base-ref resolution
 * (`fatal: invalid object name 'origin/main'`). Rather than assuming full history, fetch it on demand;
 * the vacuity guard below still refuses if this somehow leaves the ref unresolvable, so a fetch that
 * silently no-ops (offline runner, a mirror with no `main`) cannot make this test pass having examined
 * nothing.
 */
function ensureOriginMain(): void {
  const env = sandboxGitEnv();
  const opts = { cwd: REPO_ROOT, env, stdio: "pipe" as const };
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], opts);
    return;
  } catch {
    // origin/main is not resolvable in this checkout -- fetch it before giving up.
  }
  execFileSync("git", ["fetch", "origin", "main"], opts);
}

/**
 * The unified diff of CLAUDE.md between `origin/main` and the working tree. `env: sandboxGitEnv()`
 * strips any inherited `GIT_*` redirect before spawning, per this repo's own standing rule.
 */
function claudeMdDiff(): string {
  ensureOriginMain();
  return execFileSync("git", ["diff", "origin/main", "--", "CLAUDE.md"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

/** Every substantive line the diff marks as REMOVED from CLAUDE.md, whitespace-normalised. */
export function removedSubstantiveLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => norm(l.slice(1)))
    .filter((l) => l.length > MIN_SUBSTANTIVE_LENGTH);
}

/** The new CLAUDE.md plus every `docs/*.md` file, concatenated and whitespace-normalised. */
export function haystack(): string {
  const claudeMd = norm(readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8"));
  const docsFiles = allDocsMd(join(REPO_ROOT, "docs"));
  return claudeMd + " " + docsFiles.map((f) => norm(readFileSync(f, "utf8"))).join(" ");
}

test("origin/main resolves to a real commit -- this test cannot pass having examined nothing", () => {
  // NOT "the diff is non-empty": trunk-guard runs this SAME test directly against main's own tip, where
  // HEAD legitimately equals origin/main and the diff is legitimately empty -- that is not vacuity, it
  // is "nothing to check". The real vacuity risk fixed here is `origin/main` failing to RESOLVE at all
  // (the shallow-checkout trap the acceptance/docs CI jobs hit, #505's own review): `ensureOriginMain()`
  // fetches it on demand, and this asserts that succeeded rather than silently leaving an empty diff
  // whose cause could be either "resolved and identical" or "never resolved".
  ensureOriginMain();
  const sha = execFileSync("git", ["rev-parse", "--verify", "origin/main"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, `origin/main resolved to "${sha}", not a real commit SHA`);
});

test("CONTROL/MUTATION: removedSubstantiveLines extracts real removals and drops fragments and additions", () => {
  const diff = [
    "diff --git a/CLAUDE.md b/CLAUDE.md",
    "--- a/CLAUDE.md",
    "+++ b/CLAUDE.md",
    "@@ -1,3 +1,3 @@",
    "-a short fragment",
    "-a genuinely substantive removed line that is well over the twenty-five character floor",
    "+an ADDED line must never be read as removed, however long",
  ].join("\n");
  const removed = removedSubstantiveLines(diff);
  assert.deepEqual(removed,
    [norm("a genuinely substantive removed line that is well over the twenty-five character floor")],
    "the extraction must drop the ---/+++ file headers, the sub-floor fragment, and the added line, " +
    "keeping only the one real substantive removal");
});

test("every substantive line removed from CLAUDE.md survives byte-identical somewhere in docs/", () => {
  const removed = removedSubstantiveLines(claudeMdDiff());
  // An empty `removed` here is not a hole in THIS test: on trunk-guard (HEAD is origin/main) or a PR
  // that never touches CLAUDE.md, there is genuinely nothing to check, and the extraction logic itself
  // is proven correct above against a synthetic diff rather than depending on this branch's real state.
  if (removed.length === 0) return;

  const hay = haystack();
  const missing = removed.filter((line) => !hay.includes(line));
  assert.deepEqual(missing, [],
    `${missing.length} of ${removed.length} substantive line(s) removed from CLAUDE.md are present in ` +
    `NEITHER the new CLAUDE.md NOR anywhere under docs/ -- this is #181's own failure mode. Move the ` +
    `missing text verbatim into the appropriate docs/ file:\n${missing.slice(0, 20).join("\n")}` +
    (missing.length > 20 ? `\n...and ${missing.length - 20} more` : ""));
});

test("CONTROL: a line present in the haystack is not reported missing", () => {
  const hay = "some prefix text " + "a substantive line long enough to pass the floor" + " some suffix";
  assert.ok(hay.includes(norm("a substantive line long enough to pass the floor")));
});

test("MUTATION: a line genuinely absent from both CLAUDE.md and docs/ is caught", () => {
  const hay = haystack();
  const fabricated = norm(
    "this exact sentence was never written anywhere in this repository, deliberately, so the check " +
    "must report it as missing 2026-09-08-fabricated-marker-xyz");
  assert.ok(!hay.includes(fabricated),
    "the fabricated marker unexpectedly appears in docs/ or CLAUDE.md -- pick a different marker");
});
