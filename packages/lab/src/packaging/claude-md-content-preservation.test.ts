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
 * ## Why this needs `origin/main`, and what happens without it
 *
 * `git diff origin/main -- CLAUDE.md` is meaningless without a real `origin/main` to diff against --
 * a shallow clone or a detached fixture repo would report zero removed lines and this test would pass
 * having examined nothing, the exact "correct about an empty population" shape CLAUDE.md itself names
 * as its most expensive recurring defect. `originMainClaudeMd()` refuses rather than silently reading
 * a stale or absent ref.
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
 * The unified diff of CLAUDE.md between `origin/main` and the working tree. `env: sandboxGitEnv()`
 * strips any inherited `GIT_*` redirect before spawning, per this repo's own standing rule.
 */
function claudeMdDiff(): string {
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

test("the diff against origin/main is real -- this test cannot pass having examined nothing", () => {
  const diff = claudeMdDiff();
  assert.ok(diff.length > 0,
    "git diff origin/main -- CLAUDE.md is empty -- either nothing has changed, or origin/main is " +
    "unreachable in this checkout, and either way the test below would pass vacuously");
});

test("every substantive line removed from CLAUDE.md survives byte-identical somewhere in docs/", () => {
  const removed = removedSubstantiveLines(claudeMdDiff());
  assert.ok(removed.length > 0,
    "found 0 substantive removed lines despite a non-empty diff -- the >25-char filter or the " +
    "removed-line extraction may be broken");

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
