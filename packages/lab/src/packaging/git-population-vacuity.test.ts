/**
 * A test that spawns `git` to enumerate a ref/branch/tag/file population and then asserts something about
 * every member of it must first prove that population is non-empty — or it answers correctly about the
 * WRONG population (docs/backlog.md, "a check that answers correctly about the wrong population", named
 * by `ceo` after six instances in one day). `git branch -r --list 'origin/agent/*'` is the sharpest of
 * the six: this repo's agent branches are never pushed, so that check answers "clear" unconditionally,
 * for every branch, forever — the failure mode with teeth, because a false CLEAN is ignored while a false
 * WORK LIST gets acted on.
 *
 * DISCOVERED, never hand-listed, over the identical shape as `git-spawn-classification.test.ts` (env
 * scrubbing) and `exit-code-contract.test.ts`'s Python extension (exit-code classification): every
 * `.test.ts` file spawning git to list branches/tags/log/grep/ls-files/show must be classified here.
 *
 * CLASSIFICATION, not a bare pass/fail, because phrasing varies too much to trust a regex on its own —
 * `.length >= N`, `.size >= N`, a named local (`scanned`, `checked`) compared against a floor, or (for a
 * population used only as a lookup SET rather than iterated) a documented reason no guard is needed. Each
 * classified file's quoted guard expression is checked to literally still appear in the file, so a
 * classification cannot silently drift from what the file actually does.
 *
 * SWEPT AND BOUNDED, not exhaustive: this file's population is git-ref/branch/tag/log/grep/ls-files/show
 * calls specifically (items 1-2 of the six-instance row). `readdirSync`-based discovery was already swept
 * separately (docs/backlog.md, "checked every readdirSync-based discovery test in the tree (55 files)...
 * all but that instance already have one") and is not re-walked here. A broader sweep of every
 * `matchAll`-based population in the tree (~50 files) found two further confirmed gaps outside this
 * file's scope (`criteria-counts-are-not-spelled-out.test.ts`, `candidate-gate-examines-the-candidate.
 * test.ts` — both fixed directly, not folded into this discovery, because each has its own bespoke
 * population shape that a generic classifier could not describe honestly) and two soft gaps also fixed
 * directly (`capture-faults.test.ts`'s negative assertion lacked a positive-count proof that the file it
 * reads is non-trivial; `action-reference.test.ts`'s third test relied on a SIBLING test's guard rather
 * than proving its own population, which `node:test` cannot enforce since one test's failure does not
 * stop a sibling from reporting a false pass). See docs/backlog.md for the full sweep record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * This file itself spawns `git ls-files` to build `tracked()`, which matches `SPAWNS_GIT_POPULATION` --
 * so once committed it discovers ITSELF. Excluded here, in code, rather than by adding a `CLASSIFICATION`
 * entry for it: the honest classification would be true (it IS guarded, by the vacuity-guard test above
 * it) and also a file writing its own exemption into the list it maintains, which a reader has no way to
 * tell apart from an ordinary row. Same device `real-page-corpus-freshness.test.ts` uses for the
 * identical reason.
 */
const SELF = "packages/lab/src/packaging/git-population-vacuity.test.ts";

/** `git branch -r`, `git tag`, `git log`, `git grep`, `git ls-files`, `git show`, `git for-each-ref` --
 * every git subcommand that ENUMERATES a population, comments stripped first so a docstring mentioning
 * one (this file's own header, or the sibling divergence test's) cannot be mistaken for a real call. */
const SPAWNS_GIT_POPULATION =
  /\b(?:execFileSync|spawnSync)\(\s*["']git["'],\s*\[\s*["'](?:branch|tag|log|grep|ls-files|show|for-each-ref)/;

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "*.test.ts"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"));
}

function discoverGitPopulationTests(): string[] {
  return tracked().filter((f) => f !== SELF && SPAWNS_GIT_POPULATION.test(stripComments(read(f))));
}

/**
 * Every discovered file: the quoted guard expression that proves its population non-empty (checked to
 * still literally appear in the file's source below), or `null` with a stated reason no guard applies.
 */
const CLASSIFICATION: Record<string, { guard: string | null; note: string }> = {
  "packages/lab/src/gates/inventory-is-control-plane-only.test.ts": {
    guard: "reaching.length > 0",
    note: "guarded — it walks `git ls-files` for readers of `inventoryWorkerUrls` outside packages/control, "
      + "and the floor asserts the reader is found SOMEWHERE. Without it a rename of that export would "
      + "make the test pass having examined nothing, which is precisely the defect it was written for: "
      + "the question 'does anything on the lab read inventory.yml?' was answered correctly about three "
      + "directories and wrongly about the repository.",
  },
  "packages/worker-fleet/src/protocol-guard.test.ts": {
    guard: "clients.length >= 2",
    note: "guarded — the two known deploy call sites (check-worker-code.mjs, deploy-worker.mjs)",
  },
  "packages/worker-fleet/src/lab-job.test.ts": {
    guard: "referenced.length >= 5",
    note: "guarded — `git grep` for job= references across the tree; comment explicitly names the vacuity risk",
  },
  "packages/lab/src/referenced-scripts.test.ts": {
    guard: "referenced.size >= 10",
    note: "guarded — TWO populations in this file (referenced scripts, tsconfig extends targets); this "
      + "is the referenced-scripts one, the stronger of the two",
  },
  "packages/lab/src/packaging/backlog-ready.test.ts": {
    guard: null,
    note: "NO LONGER A GIT POPULATION, 2026-09-06. It used to run the region-diff claim check over "
      + "unmerged branches, guarded on `branches.length > 0`. The tracker moved to GitHub Issues, "
      + "`docs/backlog-ready.md` became a signpost, and the file was rewritten to assert that the issue "
      + "TEMPLATE requires the three fields the page used to carry. It shells no git and has no "
      + "population to be vacuous over. Kept as an entry rather than deleted so the classification "
      + "records that the guard was RETIRED WITH ITS SUBJECT rather than quietly dropped.",
  },
  "packages/lab/src/packaging/action-reference.test.ts": {
    guard: "lines.length >= 3",
    note: "guarded — FIXED this unit: the ref-existence test computed `usesLines()` independently of the "
      + "sibling test that guards it, so a sibling's guard failing did not stop this one reporting a "
      + "false pass on the same empty population",
  },
  "packages/lab/src/packaging/git-spawn-classification.test.ts": {
    guard: "spawningGit.length >= 18",
    note: "guarded — this file's own discovery, over a different population (files spawning git at all, "
      + "not specifically ref-enumerating ones)",
  },
  "packages/lab/src/gates/verdict-adoption.test.ts": {
    guard: "gates.length >= 10",
    note: "guarded — the discovered gate-script population, walked via `git ls-files packages/lab/scripts`",
  },
  "packages/judge/src/criteria-counts-are-not-spelled-out.test.ts": {
    guard: "files.length >= 40",
    note: "FIXED this unit — `git ls-files` output for packages/judge/src + packages/evidence/src had no "
      + "floor at all; an empty result reported zero offenders having examined nothing",
  },
  "packages/judge/src/rule-oracles.test.ts": {
    guard: "callers.length >= 8",
    note: "guarded — `git grep -l ruleFindings` across packages",
  },
  "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts": {
    guard: "files.length >= MIN_TRACKED_MARKDOWN_FILES",
    note: "guarded — `git ls-files '*.md'` for the repo-wide leak sweep, floored at 50 tracked files",
  },
  "packages/lab/src/packaging/tracked-source-leak-guard.test.ts": {
    guard: "files.length >= MIN_TRACKED_SOURCE_FILES",
    note: "guarded — `git ls-files '*.mjs' '*.ts' '*.py' '*.ps1' '*.sh' '*.yml'` for #83's source-comment "
      + "leak sweep (the sibling `tracked-prose-leak-guard.test.ts` above was scoped to `.md` only), "
      + "floored at 500 tracked files",
  },
};

test("MUTATION: without the SELF exclusion, this file would discover itself", () => {
  // This file's own `tracked()` calls `execFileSync("git", ["ls-files", ...])`, which matches
  // SPAWNS_GIT_POPULATION -- so once committed, the unfiltered walk finds itself. Proven directly against
  // this file's own source, not asserted from memory.
  assert.ok(SPAWNS_GIT_POPULATION.test(stripComments(read(SELF))),
    "this file's own source must still match its own discovery pattern, or the SELF exclusion guards nothing");
  assert.ok(!discoverGitPopulationTests().includes(SELF),
    "the SELF exclusion must keep this file out of its own discovered population");
});

test("the discovery finds a non-trivial population -- vacuity guard for the walk itself", () => {
  const files = tracked();
  assert.ok(files.length > 200, `only found ${files.length} tracked .test.ts files -- the ls-files scan is broken`);
  const discovered = discoverGitPopulationTests();
  // The known census: 9. A floor, not a pin -- a legitimate new git-population test raises it, and the
  // test below is what catches one arriving unclassified. This guard exists only to catch the discovery
  // pattern itself breaking and matching nothing.
  assert.ok(discovered.length >= 8,
    `only found ${discovered.length} git-population test(s), fewer than the known census of 9 -- the `
    + "discovery pattern is probably broken, not the population shrinking");
});

test("every discovered git-population test is classified, and its guard still exists", () => {
  const discovered = discoverGitPopulationTests();
  const unclassified = discovered.filter((f) => !(f in CLASSIFICATION));
  assert.deepEqual(unclassified, [],
    `these tests spawn git to enumerate a population and are classified nowhere -- prove the population `
    + `non-empty before asserting over it, then add an entry to CLASSIFICATION here (never assume a guard `
    + `merely because a sibling test has one):\n${unclassified.map((f) => `  ${f}`).join("\n")}`);

  const missingGuard: string[] = [];
  for (const [file, { guard }] of Object.entries(CLASSIFICATION)) {
    if (guard === null) continue;
    if (!stripComments(read(file)).includes(guard)) missingGuard.push(`${file}: "${guard}"`);
  }
  assert.deepEqual(missingGuard, [],
    `these classifications name a guard expression that no longer appears in the file -- the guard was `
    + `removed, renamed, or the classification is stale:\n${missingGuard.map((m) => `  ${m}`).join("\n")}`);
});

// --- The guard must be shown to fail, in both directions ---

test("MUTATION: a git-population call is discovered even split across lines, comments stripped", () => {
  const fixture = "// mentions execFileSync(\"git\", [\"branch\" in a comment, not real\n"
    + 'execFileSync("git", ["branch", "-r"], opts);\n';
  assert.ok(SPAWNS_GIT_POPULATION.test(stripComments(fixture)),
    "a real call must be discovered even when a comment above it also mentions the shape");
});

test("CONTROL: a docstring MENTION alone, with no real call, is not discovered", () => {
  const fixture = '/** Do not use execFileSync("git", ["branch"...) -- see the sandbox helper instead. */\n'
    + "export const x = 1;\n";
  assert.ok(!SPAWNS_GIT_POPULATION.test(stripComments(fixture)));
});

test("CONTROL: a non-population git call (status, config, rev-parse) is not discovered", () => {
  const fixture = 'execFileSync("git", ["status", "--porcelain"], opts);\n';
  assert.ok(!SPAWNS_GIT_POPULATION.test(stripComments(fixture)),
    "status/config/rev-parse are not population-enumerating commands -- they are out of this file's scope");
});
