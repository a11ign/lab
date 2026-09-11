/**
 * A TREE-WALKING GUARD MAY DECLARE THE SUBTREE IT WALKS, AND ITS OWN RUN MUST PROVE IT — #929.
 *
 * `alwaysRunTests` runs every guard whose population is discovered from the tree, on every pull request,
 * because a file added anywhere can join such a population. That is right for a guard whose population IS
 * the repository, and it stays exactly as it is. Measured by running all 131 always-run guards with their
 * reads observed: 17 walk the whole repository and 83 read inside a product package, but 31 read nothing a
 * product diff can touch — 14 of them nothing outside their own imports at all.
 *
 * So a guard may declare its scope, and `narrowByDeclaredScope` leaves it out of a run whose diff touches
 * none of it. The three properties this file pins are the row's acceptance:
 *
 *   - a declared guard is left out of a diff outside its scope, and kept for one inside it — BOTH directions;
 *   - a guard that declares nothing is kept exactly as today — the safe default, asserted;
 *   - a declaration narrower than what the guard actually reads FAILS THE GUARD'S OWN RUN. Without this the
 *     row ships a promise.
 *
 * The third is tested by RUNNING a fixture guard, not by describing one: a declaration check that has never
 * been seen to fail is the canary that cannot express its fault.
 *
 * This file never declares a scope of its own — it walks every test file in the repository to find the
 * guards that do — and it names the declaration only by concatenation, so the parser it tests does not read
 * this file as a declaration either.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseWalkScope, inScope } from "../../../../scripts/walk-scope.mjs";
import {
  alwaysRunTests, discoverTestFiles, narrowByDeclaredScope, sourceClosure,
} from "../../../../scripts/select-changed-tests.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const W = "WALK" + "_SCOPE";
const declaring = (scope: string) => `import { test } from "node:test";\nexport const ${W} = ${scope};\n`;

// ---------------------------------------------------------------------------------------------------------
// The declaration, read statically.
// ---------------------------------------------------------------------------------------------------------

test("a declaration is read exactly, and trailing slashes do not change the scope", () => {
  assert.deepEqual(parseWalkScope(declaring(`["scripts", "docs/"]`)), ["scripts", "docs"]);
});

test("NOT DECLARED and DECLARED EMPTY are different answers", () => {
  // `null` keeps today's always-run behaviour; `[]` claims the guard reads nothing outside its own imports,
  // which its run then has to prove. Collapsing them is how a guard would stop running with nobody deciding.
  assert.equal(parseWalkScope(`const a = 1;\n`), null);
  assert.deepEqual(parseWalkScope(declaring("[]")), []);
});

test("a mention in a string, a comment, or a fixture inside a template is not a declaration", () => {
  // The selector parses every always-run guard. If a mention counted, a test that merely talks about the
  // declaration would crash selection for every pull request.
  assert.equal(parseWalkScope(`assert.equal(x, "${W} is missing");\n`), null);
  assert.equal(parseWalkScope(`// ${W} would go here\nconst a = 1;\n`), null);
  assert.equal(parseWalkScope("const fixture = `\n" + `export const ${W} = ["docs"];\n` + "`;\n"), null);
});

test("a name in code that is not the one parseable declaration is REFUSED, never guessed", () => {
  // Read as undeclared, a malformed declaration keeps the guard running; read as `[]`, it would stop it.
  assert.throws(() => parseWalkScope(`const ${W} = computeIt();\n`), /refusing to guess/);
  assert.throws(() => parseWalkScope(declaring("[ROOT]")), /not a string literal/);
});

test("a scope entry covers itself and everything under it, and nothing that merely shares a prefix", () => {
  assert.equal(inScope("scripts", ["scripts"]), true);
  assert.equal(inScope("scripts/merge-guard.mjs", ["scripts"]), true);
  assert.equal(inScope("scripts-old/x.mjs", ["scripts"]), false, "a shared prefix is not a subtree");
  assert.equal(inScope("scripts/x.mjs", []), false, "an empty scope covers nothing");
});

// ---------------------------------------------------------------------------------------------------------
// Selection.
// ---------------------------------------------------------------------------------------------------------

const GUARDS = [
  { test: "g/declares-scripts.test.ts", why: "walks the tree itself" },
  { test: "g/declares-nothing.test.ts", why: "walks the tree itself" },
  { test: "g/declares-empty.test.ts", why: "imports the tree walker x" },
];
const SOURCES: Record<string, string> = {
  "g/declares-scripts.test.ts": declaring(`["scripts"]`),
  "g/declares-nothing.test.ts": `const walk = 1;\n`,
  "g/declares-empty.test.ts": declaring("[]"),
};
const readSource = (rel: string) => SOURCES[rel];

test("BOTH DIRECTIONS: a guard declaring scripts/ is left out of a judge diff and kept for a scripts diff", () => {
  const product = narrowByDeclaredScope(GUARDS, ["packages/judge/src/rules.ts"], { readSource });
  assert.ok(product.narrowed.some((n) => n.test === "g/declares-scripts.test.ts"));
  const pipeline = narrowByDeclaredScope(GUARDS, ["scripts/merge-guard.mjs"], { readSource });
  const kept = pipeline.kept.find((g) => g.test === "g/declares-scripts.test.ts");
  assert.ok(kept, "a diff inside the declared scope must keep the guard");
  assert.match(kept!.why, /declared walk scope \(scripts\) is touched/, "and say why it is running");
});

test("THE SAFE DEFAULT: a guard that declares nothing is kept on every diff, exactly as today", () => {
  for (const diff of [["packages/judge/src/rules.ts"], ["scripts/x.mjs"], ["docs/y.md"], []]) {
    const { kept } = narrowByDeclaredScope(GUARDS, diff, { readSource });
    assert.ok(kept.some((g) => g.test === "g/declares-nothing.test.ts" && g.why === "walks the tree itself"),
      `undeclared must be kept unchanged on ${JSON.stringify(diff)}`);
  }
});

test("a guard declaring an EMPTY scope is left out of every diff — its own imports still select it", () => {
  // Precise selection by import closure is untouched by this, so a change to the guard or anything it
  // imports still runs it. `[]` only removes it from the run it was never able to be affected by.
  const { narrowed } = narrowByDeclaredScope(GUARDS, ["scripts/x.mjs", "docs/y.md"], { readSource });
  assert.ok(narrowed.some((n) => n.test === "g/declares-empty.test.ts"));
});

test("with NO declarations anywhere, narrowing changes nothing at all", () => {
  const undeclared = GUARDS.map((g) => ({ ...g }));
  const plain = (rel: string) => (rel ? "const walk = 1;\n" : "");
  const { kept, narrowed } = narrowByDeclaredScope(undeclared, ["packages/judge/src/rules.ts"], { readSource: plain });
  assert.deepEqual(kept, undeclared);
  assert.deepEqual(narrowed, []);
});

// ---------------------------------------------------------------------------------------------------------
// The guard's own run checks its declaration — RUN, not described.
// ---------------------------------------------------------------------------------------------------------

/** Run a fixture guard that declares `scope` and reads `reads`, from the repository root, as CI would. */
function runFixtureGuard(scope: string, reads: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "walk-scope-"));
  // `.mts`, not `.ts`: a temp directory has no `package.json` saying `"type": "module"`, so a `.ts` file
  // there compiles as CommonJS, where the top-level `await` a declaring guard needs is a transform error.
  // The first version of this fixture was `.ts` and "failed" for that reason rather than the one asserted.
  const file = join(dir, "fixture.test.mts");
  const walkScope = pathToFileURL(join(REPO, "scripts/walk-scope.mjs")).href;
  writeFileSync(file, [
    `import { declareWalkScope } from ${JSON.stringify(walkScope)};`,
    `import { test } from "node:test";`,
    `import { readFileSync } from "node:fs";`,
    `export const ${W} = ${scope};`,
    `await declareWalkScope(import.meta.url);`,
    `test("reads", () => { for (const p of ${JSON.stringify(reads)}) readFileSync(p, "utf8"); });`,
    "",
  ].join("\n"));
  // `NODE_TEST_CONTEXT` scrubbed: node sets it for a test's children, and a nested `--test` run then reports
  // over the parent's protocol instead of printing -- empty stdout, exit 0, no error. The first version of
  // this fixture inherited it, and the positive control's exit code said green while its output said
  // nothing had run. Same defect `pre-push-fast-gate.test.ts` records one layer over.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    return spawnSync("npx", ["tsx", "--test", "--test-reporter=spec", file],
      { cwd: REPO, env, encoding: "utf8", timeout: 120_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("A DECLARATION NARROWER THAN THE WALK FAILS THE GUARD'S OWN RUN", () => {
  // The row's mutation, made permanent: declared `docs`, read a product file.
  const run = runFixtureGuard(`["docs"]`, ["packages/judge/src/rules.ts"]);
  assert.notEqual(run.status, 0, "a guard that reads outside its declaration must fail");
  assert.match(`${run.stdout}${run.stderr}`,
    /declares WALK_SCOPE \["docs"\] and read 1 path\(s\) outside it: packages\/judge\/src\/rules\.ts/,
    "and the failure must name what it read, so the fix is followable");
});

test("...and a declaration that covers the walk passes — or the check above could be failing on everything", () => {
  const run = runFixtureGuard(`["packages/judge"]`, ["packages/judge/src/rules.ts"]);
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  // AND IT RAN. Exit 0 alone is not a pass: the first version of this fixture could not compile, and an
  // assertion on the exit code reported the control as green. The fixture's one test must be seen passing.
  assert.match(run.stdout, /ℹ pass 1\b/, "the fixture's own test must have run and passed");
  assert.match(run.stdout, /ℹ fail 0\b/);
});

// ---------------------------------------------------------------------------------------------------------
// The repository as it is.
// ---------------------------------------------------------------------------------------------------------

type Guard = { test: string, why: string };
let repoGuards: Guard[];
let declarers: string[];
before(() => {
  const dirs = readdirSync(join(REPO, "packages"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const packages = new Map<string, { dir: string, exportsMap: Record<string, unknown> }>();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(REPO, "packages", dir, "package.json"), "utf8"));
    packages.set(manifest.name, { dir, exportsMap: manifest.exports ?? {} });
  }
  const every = discoverTestFiles(REPO, dirs);
  repoGuards = alwaysRunTests(every, { closureOf: (t: string) => sourceClosure(join(REPO, t), REPO, packages), repoRoot: REPO });
  declarers = every.filter((t: string) => parseWalkScope(readFileSync(join(REPO, t), "utf8")) !== null);
});

test("every declaring guard imports walk-scope FIRST and runs its own check", () => {
  // The observer sees only reads made after it is imported, so a declaration whose import comes second
  // could pass having missed the reads above it. And a declaration without the call is a promise nobody
  // checks — the version of this row that must not ship.
  assert.ok(declarers.length > 0, "no guard declares a scope — this check examined nothing");
  for (const file of declarers) {
    const source = readFileSync(join(REPO, file), "utf8");
    const firstImport = source.split("\n").find((line) => line.startsWith("import "));
    assert.match(firstImport ?? "", /walk-scope\.mjs"/, `${file}: the walk-scope import must be the FIRST import`);
    assert.match(source, /await declareWalkScope\(import\.meta\.url\)/, `${file}: declares a scope and never checks it`);
  }
});

test("THE FAILURE SIGNATURE: on the four measured product diffs, only DECLARING guards are left out", () => {
  // A drop larger than the declared population would mean something other than a declaration narrowed the
  // run. Measured on the same four diffs that refuted #904.
  const readReal = (rel: string) => readFileSync(join(REPO, rel), "utf8");
  for (const diff of ["packages/judge/src/rules.ts", "packages/evidence/src/conformance.ts",
    "packages/nvda-worker/src/capture-probes.mjs", "packages/scorer/src/index.ts"]) {
    const { kept, narrowed } = narrowByDeclaredScope(repoGuards, [diff], { readSource: readReal });
    assert.equal(kept.length + narrowed.length, repoGuards.length, "every guard is kept or narrowed, never lost");
    for (const n of narrowed) assert.ok(declarers.includes(n.test), `${n.test} was narrowed without declaring a scope`);
  }
});

test("this file declares no scope of its own — it walks every test file to find the ones that do", () => {
  assert.equal(parseWalkScope(readFileSync(fileURLToPath(import.meta.url), "utf8")), null);
});
