/**
 * #1983: a trailing slash in `.gitignore` means DIRECTORY, and a symlink is not a directory — so every
 * entry written `name/` silently stops ignoring the moment this repo's own worktree practice makes that
 * path a symlink.
 *
 * The incident: `git add -A && git commit` in `wt-1973` (2026-09-22T19:36Z) staged and committed
 * `node_modules` as a symlink. Nothing refused it; `git status` showed it as an ordinary untracked file.
 * A fresh worktree has no `node_modules`, and the documented route is to symlink the primary's rather than
 * `npm install` (which detaches the shared tree) — so the symlink is what the documented route PRODUCES,
 * not a mistake somebody made.
 *
 * Measured on the agent host 2026-09-22T19:58Z, over `/home/agent/repos/wt-*`: **118 of 118 worktrees with
 * a symlinked `node_modules`, 118 NOT ignored** — and a census of every un-ignored symlink in those trees
 * found a SECOND entry with the same defect, `.venv/`, symlinked in 3 of them onto the primary's. The
 * second one is why this test asserts over the whole file rather than fixing the line the incident named:
 * which paths a worktree happens to symlink is not knowable from `.gitignore`, and a hand-written list of
 * "the ones that can be symlinks" would have missed `.venv` exactly as the original line missed
 * `node_modules`. The rule that IS derivable from the file: no entry may be directory-only.
 *
 * DRIVES REAL `git check-ignore` IN A SANDBOX REPO, materialising each entry on disk, because git consults
 * the filesystem for a directory-only pattern rather than matching the string. Measured with git 2.53.0:
 *
 *     'foo/' + foo is a symlink   -> NOT ignored      'foo' + foo is a symlink   -> IGNORED
 *     'foo/' + foo is a directory -> IGNORED          'foo' + foo is a directory -> IGNORED
 *     'foo/' + no foo on disk     -> NOT ignored      'foo' + no foo on disk     -> IGNORED
 *
 * That third row is why a pattern-only reimplementation of this check would be worthless: with nothing on
 * disk, git reports the directory-only pattern as not matching either, so a test that never created the
 * symlink would "pass" for the wrong reason and go on passing after the fix was reverted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const GITIGNORE = fileURLToPath(new URL("../../../../.gitignore", import.meta.url));

/** The shape a materialised entry takes on disk. Both must end up ignored; only the first ever failed. */
type Shape = "symlink" | "directory";

/**
 * A FLOOR, not the count -- 27 entries at the time of writing, and entries are added routinely. It is
 * here only so a broken parse (an empty list) cannot make the deepEqual below pass over nothing; the
 * check that the population is the RIGHT one is the named-entry loop beside it.
 */
const PARSE_FLOOR = 20;

/** Non-comment, non-blank patterns. Negations are excluded: this file makes no claim about them. */
function entriesOf(gitignore: string): string[] {
  return gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"));
}

/**
 * A concrete relative path the entry must match. `*` becomes a literal segment so a glob entry
 * such as the package build output is driven as a real path rather than skipped — the entries most likely to be
 * written with a trailing slash out of habit are exactly the build-output globs.
 */
function samplePath(entry: string): string {
  return entry.replace(/\/+$/, "").replace(/^\/+/, "").replaceAll("*", "fixture");
}

function materialise(sandbox: GitSandbox, path: string, shape: Shape): void {
  const full = join(sandbox.dir, path);
  if (existsSync(full)) return;
  mkdirSync(dirname(full), { recursive: true });
  if (shape === "directory") { mkdirSync(full); return; }
  // ABSOLUTE, pointing outside its own directory — what a worktree's `node_modules` actually is. A
  // relative target would resolve differently for a nested entry and make the symlink dangling, which
  // git happens to treat the same but which would no longer be the shape the incident had.
  symlinkSync(join(sandbox.dir, ".symlink-target"), full);
}

/**
 * The entries `git check-ignore` does NOT cover once materialised in `shape`. Returned rather than
 * asserted so the same function can be driven against a `.gitignore` known to be broken — an emptiness
 * assertion over a population nothing ever fills is not a check.
 */
function uncovered(gitignore: string, shape: Shape): string[] {
  return withGitSandbox((sandbox) => {
    mkdirSync(join(sandbox.dir, ".symlink-target"));
    writeFileSync(join(sandbox.dir, ".gitignore"), gitignore);
    return entriesOf(gitignore).filter((entry) => {
      const path = samplePath(entry);
      materialise(sandbox, path, shape);
      return !isIgnored(sandbox, path);
    });
  });
}

function isIgnored(sandbox: GitSandbox, path: string): boolean {
  try {
    sandbox.run(["check-ignore", "-q", "--", path]);
    return true;
  } catch (error) {
    // `check-ignore -q` exits 1 for "not ignored" and 128 for a real failure. Only the first is an
    // answer; anything else is a broken sandbox and must not read as a finding.
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

test("#1983 POSITIVE CONTROL: the checker reports a directory-only entry as uncovered", () => {
  assert.deepEqual(uncovered("foo/\n", "symlink"), ["foo/"],
    "if this ever returns [] the check below is asserting emptiness over a population that cannot fill, "
    + "and the shipped `.gitignore` would pass with every line back to `name/`");
});

test("#1983 NEGATIVE CONTROL: the same entry without the slash covers the symlink AND the directory", () => {
  assert.deepEqual(uncovered("foo\n", "symlink"), [],
    "the fix is a one-character deletion and this is the half that makes it safe: slash-less is strictly "
    + "WIDER than directory-only, not different");
  assert.deepEqual(uncovered("foo\n", "directory"), [],
    "dropping the slash must not cost the real-directory case the entry was written for");
});

test("#1983: no entry in `.gitignore` stops working when its path is a symlink", () => {
  const gitignore = readFileSync(GITIGNORE, "utf8");
  const entries = entriesOf(gitignore);
  assert.ok(entries.length >= PARSE_FLOOR,
    `parsed only ${entries.length} entries from .gitignore -- the parse is broken, and an empty ` +
    "population would make the assertion below pass without checking anything");
  for (const name of ["node_modules", ".venv"]) {
    assert.ok(entries.includes(name),
      `${name} is the entry this row was MEASURED on (118 and 3 live symlinks on the agent host) -- ` +
      "if it is gone or back to a trailing slash, that measurement no longer has a line to protect");
  }
  assert.deepEqual(uncovered(gitignore, "symlink"), [],
    "a trailing slash matches a DIRECTORY only, and this repo's worktree practice symlinks these paths "
    + "onto the primary's -- an entry that is directory-only is one `git add -A` from being committed");
});

test("#1983: every entry still covers the real directory it was written for", () => {
  const gitignore = readFileSync(GITIGNORE, "utf8");
  assert.deepEqual(uncovered(gitignore, "directory"), [],
    "the widening must not have lost the original case");
});
