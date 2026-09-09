/**
 * `git checkout -- <path>` restores a path to HEAD, silently discarding every uncommitted change in it —
 * not only the one a caller meant to undo. CLAUDE.md calls it *"the command that once destroyed
 * release-eligible weights in this repo"*, and it destroyed work three more times in one night through
 * the mutation-check workflow, which is the technique this project relies on most (`npm run mutate` now
 * restores from a copy, never this).
 *
 * #637: A GREP GIVES 30 AND ANSWERS NOTHING. Measured 2026-09-09: 12 mentions in `.mjs`/`.sh`/`.yml`
 * files, 18 in `.md` prose. Those two numbers need OPPOSITE treatment — the eighteen are most likely the
 * repository warning about exactly this command, and a sweep that "fixed" them would delete the
 * warnings; the twelve are candidates for the ones that can actually destroy work, and MOST of them turn
 * out to be comments describing the hazard too. This file separates the two by READING, not by counting.
 *
 * PROSE IS EXEMPT BY NAME: `.md` is not walked at all, and this is deliberate — ceo's own framing on
 * #633's identical shape: *"a guard that cannot tell a warning from a weapon gets switched off within a
 * week."* A guard that fired on CLAUDE.md's own warning paragraph would be disabled by the first person
 * it inconvenienced, and the twelve live sites would then be unguarded with nobody aware of it.
 *
 * A COMMENT INSIDE A `.mjs`/`.sh`/`.yml` FILE IS ALSO PROSE, and this is the harder half: of the twelve
 * "in code" mentions measured at filing, all but one turned out to be a comment describing the hazard
 * (`scripts/mutation-check.mjs`, `packages/lab/src/harnesses/capture-fixtures.mjs`,
 * `packages/control/ansible/lab-reset.yml`'s own six explanatory `#` lines). Comments are stripped before
 * matching — JS-aware `stripComments` for `.mjs`/`.ts` (block comments and string literals both handled
 * correctly), a `#`-to-end-of-line strip for `.sh`/`.yml`, which is the one marker both use.
 *
 * THE ONE LIVE SITE FOUND WAS INVISIBLE TO A LITERAL-STRING PATTERN, which is why this file's own
 * discovery includes a second regex alternative. `packages/control/ansible/lab-reset.yml`'s real
 * invocation is Ansible's `argv:` list form — `[git, checkout, "--", "."]` — where the subcommand and
 * the bare `--` are separate ARRAY ELEMENTS, never adjacent as the text `"git checkout --"`. Found by
 * reading the file after `git checkout -- ` (with a trailing space) had already been grepped and come up
 * empty for anything but prose — exactly the shape #637's own acceptance names: *"The live sites
 * separated from the prose, by reading each rather than by pattern."*
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * `#` to end of line — the one comment marker `.sh` and `.yml`/`.yaml` both use. Applied uniformly to
 * both extensions rather than writing a second stripper; `.mjs`/`.ts` sources in this population go
 * through the JS-aware `stripComments` instead, since `#` has no comment meaning there (a shebang line,
 * a template literal) and blanking it would corrupt real code.
 */
function stripHashComments(text: string): string {
  return text.replace(/#[^\n]*/g, (m) => " ".repeat(m.length));
}

function stripFor(path: string, text: string): string {
  return path.endsWith(".mjs") ? stripComments(text) : stripHashComments(text);
}

/**
 * Every tracked `.mjs`/`.sh`/`.yml`/`.yaml` file — the live-code population `git checkout --` can
 * actually run from. `.md` is out of scope BY EXTENSION, never walked: prose is exempt by name, which is
 * the whole thing that makes this guard usable rather than switched off within a week.
 */
function tracked(): string[] {
  return execFileSync("git", ["ls-files", "*.mjs", "*.sh", "*.yml", "*.yaml"],
    { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"));
}

/**
 * The destructive pathspec-restore, in its two real shapes:
 *  - a literal shell invocation, `git checkout --` NOT followed immediately by a flag character — so
 *    `git checkout --quiet <ref>` and `git checkout --detach <ref>` (checking out a REF, an unrelated
 *    and non-destructive operation) do not match. This is deliberately narrow: a broader `checkout --`
 *    match caught both `fleet-playbook.mjs` and `lab-pipeline.mjs`'s real `--quiet` ref-checkouts on the
 *    first pass, which is exactly the "answers nothing" grep #637 opens with.
 *  - an Ansible `argv:` list, where the subcommand and the bare `--` are separate array elements
 *    (`[git, checkout, "--", "."]`) rather than adjacent text — invisible to the first pattern alone,
 *    which is how `lab-reset.yml`'s own live site was found: by reading, after the literal-string grep
 *    had already come up empty for anything but prose.
 */
const DESTRUCTIVE_CHECKOUT = /git\s+checkout\s+--(?![\w-])|checkout['"]?\s*,\s*['"]--['"]/;

function discoverCheckoutDashSites(): string[] {
  return tracked().filter((f) => DESTRUCTIVE_CHECKOUT.test(stripFor(f, read(f))));
}

/**
 * Every discovered live site: the quoted guard expression that proves it cannot destroy unrecoverable
 * work (checked to still literally appear in the file below), so a classification cannot silently drift
 * from what the file actually does — the identical device `git-population-vacuity.test.ts`'s
 * `CLASSIFICATION` table uses.
 */
const CLASSIFICATION: Record<string, { guard: string; note: string }> = {
  "packages/control/ansible/lab-reset.yml": {
    guard: "Refuse to discard work origin does not have",
    note: "SAFE — the one live site in the tree. Runs only when `apply=true` AND the task quoted here has "
      + "already run and NOT failed: every dirty path is diffed against `origin/<ref>` first, and the "
      + "play FAILS outright unless every dirty path's content already exists on origin — so nothing this "
      + "checkout discards is ever unrecoverable by pulling. `-e remove=<path>` is the one deliberate "
      + "override, and it requires a human to have named the path having looked at it first.",
  },
};

test("the discovery finds a non-trivial population — vacuity guard for the walk itself", () => {
  const files = tracked();
  assert.ok(files.length > 100,
    `only found ${files.length} tracked .mjs/.sh/.yml/.yaml files — the ls-files scan is broken`);
});

test("every discovered live site is classified, and its guard still exists", () => {
  const discovered = discoverCheckoutDashSites();
  // The known census: 1 (packages/control/ansible/lab-reset.yml, #637). A floor, not a pin — a
  // legitimate new destructive-checkout site raises it, and this same assertion is what catches one
  // arriving unclassified: an unclassified site fails the deepEqual below, named.
  assert.ok(discovered.length >= 1,
    `found ${discovered.length} live site(s), fewer than the known census of 1 — the discovery pattern `
    + "is probably broken (it has stopped finding the real Ansible argv: site), not the population emptying");

  const unclassified = discovered.filter((f) => !(f in CLASSIFICATION));
  assert.deepEqual(unclassified, [],
    "these files reach `git checkout --` for real and are classified nowhere — prove nothing "
    + "unrecoverable can be lost there, then add an entry to CLASSIFICATION here:\n"
    + unclassified.map((f) => `  ${f}`).join("\n"));

  const missingGuard: string[] = [];
  for (const [file, { guard }] of Object.entries(CLASSIFICATION)) {
    if (!stripHashComments(read(file)).includes(guard)) missingGuard.push(`${file}: "${guard}"`);
  }
  assert.deepEqual(missingGuard, [],
    "these classifications name a guard expression that no longer appears in the file — the guard was "
    + `removed, renamed, or the classification is stale:\n${missingGuard.map((m) => `  ${m}`).join("\n")}`);
});

// --- The pattern itself: both real shapes discovered, prose never mistaken for either ---

test("MUTATION: a literal `git checkout -- <path>` invocation is discovered, comments stripped", () => {
  const fixture = "// never git checkout -- a tracked file with uncommitted changes\n"
    + 'execFileSync("git", ["checkout", "--", path], opts);\n' // string-array form is NOT the pattern's
    // target (it is caught by the argv: alternative only for YAML flow lists) -- this line proves the
    // COMMENT above it is correctly ignored; the real target is the shell-string form directly below.
    + 'run("bash", ["-c", "git checkout -- " + path]);\n';
  assert.ok(DESTRUCTIVE_CHECKOUT.test(stripComments(fixture)),
    "a real shell-string invocation must be discovered even with a comment describing the hazard above it");
});

test("MUTATION: the Ansible argv: list form is discovered — the shape a literal-string pattern alone "
  + "cannot see, which is how lab-reset.yml's own live site was actually found", () => {
  const fixture = "    # git checkout -- destroys uncommitted work, only run this after proving recoverable\n"
    + "    ansible.builtin.command:\n"
    + '      argv: [git, checkout, "--", "."]\n';
  assert.ok(DESTRUCTIVE_CHECKOUT.test(stripHashComments(fixture)),
    "the argv: list form -- subcommand and -- as separate array elements -- must be discovered");
});

test("CONTROL: `git checkout --quiet <ref>`/`--detach <ref>` are NOT discovered — checking out a ref is "
  + "a different, non-destructive operation from restoring a path", () => {
  // NO `cd ${dir}` PREFIX HERE, DELIBERATELY -- an earlier draft had one, and it made THIS FIXTURE
  // STRING (never executed, describing hypothetical code) trip control-plane-checkout-is-one-fact.test.
  // ts's own tree-wide `cd`-discovery sweep, which cannot tell a fixture literal from a real directory
  // entry. The `--quiet` question this test asks needs no `cd` at all; removed rather than worked
  // around, matching this repo's own precedent for a guard tripped by a fixture rather than a fault.
  const quiet = 'run(`git checkout --quiet ${ref}`);\n';
  const detach = '      argv: [git, checkout, --detach, "{{ ref }}"]\n';
  assert.ok(!DESTRUCTIVE_CHECKOUT.test(stripComments(quiet)),
    "--quiet is a flag, not the bare -- pathspec separator — this was the first pass's own false match");
  assert.ok(!DESTRUCTIVE_CHECKOUT.test(stripHashComments(detach)),
    "--detach is a flag too; checking out a ref by name is not the file-restore hazard this file guards");
});

test("CONTROL: a docstring MENTION alone, with no real call, is not discovered", () => {
  const fixture = "/**\n * Never `git checkout --` mid mutation-check — copy the file aside instead.\n */\n"
    + "export const x = 1;\n";
  assert.ok(!DESTRUCTIVE_CHECKOUT.test(stripComments(fixture)));
});

test("CONTROL: `.md` files are never walked at all — prose is exempt by extension, not by pattern, which "
  + "is what makes the guard usable", () => {
  const files = tracked();
  assert.ok(!files.some((f) => f.endsWith(".md")),
    "a .md file appeared in the live-code population -- the glob has widened and prose is no longer exempt");
});

// --- #637's own required mutation, both directions ---

/**
 * Direction 1: a script reaching `git checkout --` really can destroy an uncommitted change, demonstrated
 * against a real throwaway repository rather than argued — the same discipline #633's own mutation used.
 * `sandboxGitEnv()` scrubs `GIT_*`, the discipline `test-support/git-sandbox.ts` documents at length:
 * `cwd` is not isolation for a spawned git process, `GIT_DIR` is.
 */
function destroysUncommittedWork(): { before: string; after: string } {
  const dir = mkdtempSync(join(tmpdir(), "checkout-dash-danger-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
    git("init", "--quiet");
    writeFileSync(join(dir, "file.txt"), "committed content\n");
    git("add", "file.txt");
    git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "one real commit");
    // THE UNCOMMITTED CHANGE, present when the destructive command runs -- this is the state #637's own
    // acceptance names: "a script reaching for `git checkout --` in a recovery path" with real work
    // sitting in the file it is about to restore.
    writeFileSync(join(dir, "file.txt"), "uncommitted work nobody has anywhere else\n");
    const before = readFileSync(join(dir, "file.txt"), "utf8");
    git("checkout", "--", "file.txt");
    const after = readFileSync(join(dir, "file.txt"), "utf8");
    return { before, after };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#637 MUTATION direction 1: `git checkout -- <file>` really discards an uncommitted change silently "
  + "— demonstrated, not argued. An unclassified live site reaching this command is the danger this "
  + "file's CLASSIFICATION table exists to name", () => {
  const { before, after } = destroysUncommittedWork();
  assert.equal(before, "uncommitted work nobody has anywhere else\n",
    "sanity: the uncommitted change must genuinely be present before the destructive command runs");
  assert.equal(after, "committed content\n",
    "the uncommitted change is gone, replaced by HEAD's content, with no error and no warning — this is "
    + "the exact silent destruction CLAUDE.md and #637 both name, proven live rather than assumed");
  assert.notEqual(before, after,
    "the whole hazard, restated as one assertion: the file's content changed under a command with no "
    + "flag or prompt announcing that it would");
});

test("#637 MUTATION direction 2: the same string in a `.md` file changes nothing — `tracked()` never "
  + "returns it, so an unclassified prose mention cannot make the classification test above fail", () => {
  // Direct proof against the real discovery function, not a description of the glob: this repository's
  // OWN docs (CLAUDE.md, docs/operational-lessons.md, six files under docs/roles/) already carry the
  // exact string "git checkout --" as a warning, right now, and none of them appears in `tracked()` or
  // in `discoverCheckoutDashSites()`'s result.
  const discovered = discoverCheckoutDashSites();
  assert.ok(!discovered.some((f) => f.endsWith(".md")),
    "no .md file can appear in the discovered set -- tracked() never globs for one");
  assert.ok(!discovered.includes("CLAUDE.md"),
    "CLAUDE.md itself carries the warning text this file's own header quotes, and must never be flagged");
});
