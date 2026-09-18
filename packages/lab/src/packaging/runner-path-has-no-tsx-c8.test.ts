/**
 * #1321, STEP 5 OF 5, THE LAST STEP OF THE RSTEST ADOPTION (#1317): tsx and c8 are gone from the test and
 * coverage path, and every remaining `tsx` use is named with its purpose so a new one cannot slip back in
 * unnoticed.
 *
 * Steps 3 and 4 (#1319, #1320) moved CI's `ts` job, trunk's unscoped step and coverage onto rstest, but left
 * three places running the OLD runner directly rather than through the floor those steps converted:
 * `guards:sweep` (`xargs npx tsx --test`), and `.github/workflows/reusable-board.yml`'s board-test step,
 * found while building this row and ruled into Region by product-manager (2026-09-18, issue comment on
 * #1321) because nothing about its "no typecheck, no lint" scoping is a reason to keep the old runner. `c8`
 * itself has no real invocation left anywhere — `scripts/coverage.mjs` (#1320) reuses its CONFIG FILE
 * (`.c8rc.json`) and its error WORDING, never the binary — so it leaves the manifest and the lockfile here.
 *
 * THREE PLACES ARE SEARCHED, MATCHING THE ROW'S OWN WORDING EXACTLY: the manifest scripts (`package.json`'s
 * `scripts`), the workflows (`.github/workflows/*.yml`), and the scripts directory (`scripts/**`, source
 * files only — a `.json`/`.txt`/`.md` fixture or an extensionless git hook is not a program this row's
 * Acceptance means to police; see the file-level test below, which floors the population so a filter that
 * quietly narrowed to nothing would fail rather than pass empty).
 *
 * `scripts/git-hooks/pre-push`'s own leak-scan step is NOT in this population and is not a named exception
 * either — it is simply outside the three buckets the row names, because a git hook is not "the manifest
 * scripts, the workflows, or the scripts directory" in the sense used here (extensionless, invoked by git
 * itself rather than by `npm run` or a workflow `run:` step). Its own header already explains why it runs
 * two named files directly rather than through any sweep or floor (`.github/CLAUDE.md`: the one check CI
 * cannot cover, since a push is public at once) — a different, older exception this row does not reach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// #716/#704: this file's own population is computed from the tracked tree (`walkTree`), not a hand-typed
// list, so it is declared here per ceo's ruling (2026-09-09) that population must come from a real import.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** A `tsx --test` spawn -- word-bounded, so `tsx` running a plain script (`tsx packages/.../run.ts`, the
 *  program-mode use every named entry below is) never matches. */
const TSX_TEST = /\btsx\s+--test\b/;

/** A `c8` INVOCATION, not a mention -- either the shell shape this repo's manifest/workflow/`.sh` text uses
 *  (`npx c8 ...`), or the call shape `git-spawn-classification.test.ts` already established for the same
 *  reason (`<identifier>("c8", ...)`, broad enough to catch an indirected spawn wrapper). A bare `\bc8\b`
 *  first version matched `scripts/coverage-failure-classifier.mjs`'s own diagnostic STRING -- "this is a TEST
 *  regression, not a coverage regression -- c8 propagates the test runner's own exit code" -- real code, not
 *  a comment, but prose describing c8's old behaviour rather than invoking it. Caught by the positive
 *  control below failing to distinguish the two; word-boundary alone was never going to. */
const C8_SPAWN = /\bnpx\s+c8\b|[A-Za-z_$][\w$]*\(\s*(['"`])c8\1/;

/** Blank and `#`-comment lines dropped, the same shell-comment discipline `runner-is-rstest.test.ts`'s own
 *  `codeLines` uses for a workflow `run:` block -- a runner named only in a comment must never count. Applied
 *  to whole YAML files too: a YAML key line never happens to match either pattern, so this is safe there as
 *  well as over real shell text. */
function bashCodeLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}

/** One thing whose text this row's Acceptance covers, and the non-blank, comment-stripped lines to search. */
type Source = { label: string; lines: string[] };

/** `package.json`'s own `scripts` map -- read once, reused by the tsx-naming test below. */
function manifestScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> };
  return pkg.scripts;
}

function manifestScriptSources(): Source[] {
  return Object.entries(manifestScripts()).map(([name, cmd]) => ({ label: `package.json#scripts.${name}`, lines: bashCodeLines(cmd) }));
}

/** Every tracked `.yml` workflow, whole-file text -- comments stripped the same way as a `run:` step's shell. */
function workflowSources(): Source[] {
  const files = walkTree({ kind: "all", roots: [".github/workflows"] }).map((f) => f.path).filter((p) => p.endsWith(".yml"));
  return files.map((file) => ({ label: file, lines: bashCodeLines(readFileSync(join(REPO, file), "utf8")) }));
}

/** Every tracked file under `scripts/` whose extension marks it as a program rather than data or a git hook. */
const SCRIPT_EXTENSIONS = /\.(mjs|cjs|js|ts|sh)$/;
const JS_LIKE_EXTENSIONS = /\.(mjs|cjs|js|ts)$/;

function scriptsDirectorySources(): Source[] {
  const files = walkTree({ kind: "all", roots: ["scripts"] }).map((f) => f.path).filter((p) => SCRIPT_EXTENSIONS.test(p));
  return files.map((file) => {
    const text = readFileSync(join(REPO, file), "utf8");
    // JS/TS/CJS/MJS gets the real comment-aware strip (a `//` inside a string literal, e.g. a URL, must
    // survive); a `.sh` file has no such literal risk this repo's shell scripts rely on, so the cheaper
    // line-comment strip is enough for it.
    const source = JS_LIKE_EXTENSIONS.test(file) ? stripComments(text) : text;
    return { label: file, lines: bashCodeLines(source) };
  });
}

function tsxTestSpawns(lines: string[]): string[] {
  return lines.filter((line) => TSX_TEST.test(line));
}

function c8Spawns(lines: string[]): string[] {
  return lines.filter((line) => C8_SPAWN.test(line));
}

// --- the detector, proven on a fixture before it is trusted on the real tree ----------------------------

test("positive control: a fixture invocation of `tsx --test` is caught, and the same words in a comment are not", () => {
  const lines = bashCodeLines('run: npx tsx --test "a.test.ts"\n# npx tsx --test, mentioned in a comment\n'
    + "run: npx rstest run --include a.test.ts");
  assert.deepEqual(tsxTestSpawns(lines), ['run: npx tsx --test "a.test.ts"']);
});

test("positive control: a fixture invocation of `c8` (shell or a spawn call) is caught, and prose mentioning "
  + "it -- a comment, or a diagnostic STRING like coverage-failure-classifier.mjs's own -- is not", () => {
  const lines = bashCodeLines('run: npx c8 npm test\n# reads .c8rc.json for c8\'s own thresholds\n'
    + 'execFileSync("c8", ["--reporter=json"]);\n'
    + 'detail: "not a coverage regression -- c8 propagates the test runner\'s own exit code"\n'
    + "run: node scripts/coverage.mjs");
  assert.deepEqual(c8Spawns(lines), ['run: npx c8 npm test', 'execFileSync("c8", ["--reporter=json"]);']);
});

// --- the real tree -------------------------------------------------------------------------------------

// Floors, not exact counts (#1321's own "a floor cannot hold a count" lesson) -- each read well under the
// real population today (manifest ~150, workflows 13, scripts/ 74) so ordinary growth never trips this.
const MIN_MANIFEST_SCRIPTS = 50;
const MIN_WORKFLOW_FILES = 5;
const MIN_SCRIPTS_DIR_FILES = 30;

test("ANTI-VACUITY: the three populations are non-empty, so a filter that quietly narrowed to nothing fails here", () => {
  const manifest = manifestScriptSources();
  const workflows = workflowSources();
  const scriptsDir = scriptsDirectorySources();
  assert.ok(manifest.length >= MIN_MANIFEST_SCRIPTS, `only ${manifest.length} manifest script(s) -- the scan is broken`);
  assert.ok(workflows.length >= MIN_WORKFLOW_FILES, `only ${workflows.length} workflow file(s) -- the scan is broken`);
  assert.ok(scriptsDir.length >= MIN_SCRIPTS_DIR_FILES, `only ${scriptsDir.length} scripts/ file(s) -- the scan is broken`);
});

// EMPTINESS ASSERTION -- its positive control is the two fixture tests directly above, which prove the
// detector itself catches a real spawn; this proves the real tree has none for it to catch. The population
// floor is INLINE (not only in the ANTI-VACUITY test above) so a filter that quietly narrowed `sources` to
// nothing cannot pass this test empty either -- local/uncontrolled-emptiness (#1123).
test("ACCEPTANCE: no test or coverage invocation in the manifest scripts, the workflows, or the scripts "
  + "directory spawns `tsx --test`, comments stripped", () => {
  const sources = [...manifestScriptSources(), ...workflowSources(), ...scriptsDirectorySources()];
  assert.ok(sources.length > 0, "the population is empty -- this would pass vacuously");
  const offenders = sources.flatMap((source) => tsxTestSpawns(source.lines).map((line) => `${source.label}: ${line}`));
  assert.deepEqual(offenders, []);
});

// Same population, same positive control (the second fixture test above), for `c8`.
test("ACCEPTANCE: no test or coverage invocation in the manifest scripts, the workflows, or the scripts "
  + "directory spawns `c8`, comments stripped", () => {
  const sources = [...manifestScriptSources(), ...workflowSources(), ...scriptsDirectorySources()];
  assert.ok(sources.length > 0, "the population is empty -- this would pass vacuously");
  const offenders = sources.flatMap((source) => c8Spawns(source.lines).map((line) => `${source.label}: ${line}`));
  assert.deepEqual(offenders, []);
});

test("`c8` has no remaining use, so it leaves the manifest and the lockfile", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as
    { dependencies?: Record<string, string>, devDependencies?: Record<string, string>, optionalDependencies?: Record<string, string> };
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    assert.ok(!("c8" in (pkg[bucket] ?? {})), `c8 must not be a ${bucket} entry`);
  }
  const lock = JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")) as { packages: Record<string, unknown> };
  const lockEntries = Object.keys(lock.packages).filter((path) => path === "node_modules/c8" || path.endsWith("/node_modules/c8"));
  assert.deepEqual(lockEntries, []);
});

// --- every remaining `tsx` use, named --------------------------------------------------------------------

/**
 * Every manifest script that still runs through `tsx`, named with why it stays. Every one of these is `tsx`
 * running ONE FILE AS A PROGRAM (its own entry point), never the test runner (`--test`, pinned empty above)
 * -- the distinction the whole rstest adoption turns on. A new, undocumented `tsx` use fails the test right
 * below rather than slipping in unnamed; one that stops using `tsx` fails the same way, so this cannot go
 * stale in either direction.
 */
const NAMED_TSX_USES: Record<string, string> = {
  spike: "a lab spike harness entry point",
  witness: "the product CLI entry point",
  eval: "the eval harness entry point",
  "eval:gate": "the eval harness, gated for release",
  "rules-check": "a rules report/CLI script",
  scan: "the axe scan CLI",
  "training:capture-acceptance": "a training-dataset capture harness",
  "training:capture": "a training-dataset capture harness",
  "evidence:check": "an evidence consistency check (needs a running worker, not a unit test)",
  "gate:stability": "a stability-gate report (needs the lab)",
  "training:repeat": "a training-dataset capture harness",
  "rules:score": "a rules-scoring report",
  "rules:gate": "the rules-scoring report, gated for release",
  "rules:coverage": "a rule-coverage audit report",
  "rules:real-pages": "a real-page findings report",
  "docs:coverage": "the coverage-doc generator",
  "capture:check": "a capture consistency check (needs a running worker)",
  "identity:rate": "a page-identity-rate harness",
  "verdict:stability": "an occurrence-verdict-stability harness",
};

test("every remaining manifest `tsx` use is named with its purpose, and none of them is `--test`", () => {
  const actual = Object.entries(manifestScripts()).filter(([, cmd]) => /\btsx\b/.test(cmd));
  assert.deepEqual(actual.map(([name]) => name).sort(), Object.keys(NAMED_TSX_USES).sort(),
    "a tsx use appeared or disappeared in package.json without NAMED_TSX_USES being updated to match");
  for (const [name, cmd] of actual) {
    assert.doesNotMatch(cmd, /--test\b/, `${name} runs tsx in --test mode, which the acceptance test above must then catch`);
  }
});

// `test:nightly` is the one place a test runs through `tsx` by DEFAULT rather than by name in its own
// command text (`assert-glob-not-empty.mjs` defaults `--runner` to `tsx` when the caller names none) --
// `runner-is-rstest.test.ts` already pins that this is deliberate (#1319) and out of this row's scope, so
// it is not retested here; it carries no literal "tsx" word for the scan above to see either way.
test("`test:nightly` names no --runner, so it stays on the floor's tsx default -- not renamed by this row", () => {
  assert.doesNotMatch(manifestScripts()["test:nightly"], /\btsx\b/, "no literal tsx word; the default runner is implicit");
  assert.doesNotMatch(manifestScripts()["test:nightly"], /--runner=/);
});
