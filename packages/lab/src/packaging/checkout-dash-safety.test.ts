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
 *
 * THIS GUARD CANNOT BECOME AN ESLINT RULE, and #1133 exists to say so where the next reader meets it.
 * #908 proposes converting the process-rule pins into lint rules, on the argument that a rule runs in
 * seconds and REPORTS AT THE LINE. That argument holds only where ESLint can see the file. Measured
 * 2026-09-12:
 *
 *     this guard's population          365 files   { mjs: 292, yml: 63, sh: 10 }
 *     reachable by eslint.config.js    292         files: ["**\/*.{ts,mjs,js}"]
 *     NOT reachable                     73
 *
 *     $ npx eslint --no-ignore packages/control/ansible/lab-reset.yml
 *       0:0  warning  File ignored because no matching configuration was supplied
 *
 * **And the only live site this guard has ever found is one of the 73.** `lab-reset.yml`'s Ansible
 * `argv:` list is the entire `CLASSIFICATION` table below. A converted rule would cover 80% of the
 * population and NONE of the sites it has ever caught -- which is worse than no rule, because the guard
 * it replaced would be gone.
 *
 * #908's exits are convert, or delete with the reason. This guard takes NEITHER, and that third outcome
 * is what this paragraph records. The test at the bottom of this file is what stops it going stale: if
 * `eslint.config.js` ever grows a glob covering every walked file -- a YAML plugin is a normal thing to
 * add -- the paragraph becomes false and nothing else would notice.
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
import { declareTreeWideGuard, walkTree } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

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
  return walkTree({ kind: "all", roots: [] }).map((f) => f.path)
    .filter((f) => /\.(mjs|sh|ya?ml)$/.test(f) && !f.includes("/dist/") && !f.includes("/node_modules/"));
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

/**
 * #1133: THE REASON THIS GUARD CANNOT CONVERT, HELD RATHER THAN WRITTEN DOWN.
 *
 * The header records why #908 must not turn this file into an ESLint rule: 73 of its 365 files are
 * unlintable and the only live site it has ever found is one of them. **That is a fact about
 * `eslint.config.js`, not about this file**, so it can stop being true without anyone touching either
 * paragraph — a YAML plugin is an ordinary thing to add, and the day it lands the reason above becomes
 * false silently. A reason nothing checks is #1123's shape.
 *
 * DERIVED FROM THE REAL CONFIG, never from a typed list of extensions. `eslint.config.js` is imported
 * and its `files:` globs are read, so this compares the guard's population against what ESLint is
 * actually configured to see rather than against what this test remembers it seeing.
 */
const ESLINT_GLOB = /^\*\*\/\*\.(?:\{([\w,]+)\}|(\w+))$/;

/** The extensions ESLint is configured to lint, from its own `files:` globs. */
async function eslintExtensions(): Promise<Set<string>> {
  const config = (await import("../../../../eslint.config.js")).default as { files?: string[] }[];
  const globs = [...new Set(config.flatMap((block) => block.files ?? []))];
  const extensions = new Set<string>();
  for (const glob of globs) {
    const parsed = ESLINT_GLOB.exec(glob);
    // REFUSING an unrecognised glob rather than skipping it: a shape this parser does not know could
    // widen ESLint's reach, and reading it as "no extensions" would make the comparison below pass for
    // the wrong reason -- which is the exact failure this test exists to prevent one level down.
    assert.ok(parsed, `eslint.config.js uses a files glob this test cannot parse (${glob}). Widen the `
      + "parser deliberately: an unparsed glob could be the one that makes this guard convertible, and "
      + "silently ignoring it would let the header's reason go stale unnoticed");
    for (const ext of (parsed[1] ?? parsed[2]).split(",")) extensions.add(ext);
  }
  return extensions;
}

test("#1133: ESLint still cannot see this guard's population — the header's reason is still true", async () => {
  const population = tracked();
  const lintable = await eslintExtensions();
  const unreachable = population.filter((f) => !lintable.has(f.split(".").pop() ?? ""));

  assert.ok(unreachable.length > 0,
    `every one of this guard's ${population.length} files is now lintable by eslint.config.js `
    + `(${[...lintable].sort().join(", ")}), so the header's reason for not converting this guard to an `
    + "ESLint rule is FALSE. Re-open #908's decision for this guard rather than leaving the paragraph");

  // AND THE LIVE SITE SPECIFICALLY, because "some file is unreachable" is not the argument. The argument
  // is that the ONE site this guard has ever caught is unreachable, and that is what makes converting a
  // net loss rather than a partial one.
  const liveSites = Object.keys(CLASSIFICATION);
  assert.ok(liveSites.length > 0, "the classification table is empty, so this assertion compares nothing");
  const reachableLiveSites = liveSites.filter((f) => lintable.has(f.split(".").pop() ?? ""));
  assert.deepEqual(reachableLiveSites, [],
    `these live sites ARE lintable: ${reachableLiveSites.join(", ")}. If every site this guard has found `
    + "sits inside ESLint's reach, converting stops being a net loss and #908's decision changes");
});
