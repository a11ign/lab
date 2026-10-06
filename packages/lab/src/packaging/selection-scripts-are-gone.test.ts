// no-token: gh -- reads tracked files and the workflows and calls pure functions; no `gh` or network is reached
/**
 * #3573: THE HAND-BUILT TEST SELECTORS ARE GONE, AND THE PR `ts` JOB RUNS THE WHOLE SUITE.
 *
 * `rstest run --changed` is the one selector left (`pnpm run verify` runs it). Three things used to choose which tests a
 * PR ran: `scripts/test-changed.mjs`, `scripts/select-changed-tests.mjs`, and the `testPackages` half of `ci-changed.mjs`.
 * This pins that none of them comes back, in the three places one could: a file on disk, a reference in code or a package
 * script, and a workflow that scopes the `ts` job again. Job gating (`classify`: which JOBS run) stays, and so does the
 * constraint that its script runs before `npm ci`.
 *
 * WHAT THE POPULATION READS, said once. Code is read with comments stripped (a comment may still say what was deleted, and
 * five declared copies in `guards/` do, by ruling, because a comment edit there trips the copy-drift guard); workflows
 * with `#` lines dropped; `package.json` and the other JSON raw. A reference is an import, a `node <path>` invocation, or
 * a string that IS the path. Prose that merely names the file is not an invocation of it, and this is NOT a text search
 * over the tree: a string fixture that mentions the name inside a longer sentence is not read.
 *
 * POSITIVE CONTROLS, named where each emptiness is asserted: the walk finds a real population (1) that includes
 * `ci.yml`, `package.json` and a `.mjs` under `scripts/`; the real `ci.yml` has a `ts` job, which is how "unscoped" can be
 * read at all (3); a fixture workflow calling the deleted selector is RED, and one with `ts-test-scope: scoped` is RED (4).
 * The names are built from parts below so this file does not name them in a form it forbids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

const RUNNER = `test-${"changed"}`;
const SELECTOR = `select-${"changed-tests"}`;
const GONE_PATHS = [`scripts/${RUNNER}.mjs`, `scripts/${SELECTOR}.mjs`, `packages/lab/src/packaging/${SELECTOR}.test.ts`];
const NAME = `(?:${RUNNER}|${SELECTOR})`;

/** Records that name the deleted files by design: the RECORD of what was found, the board archive, release notes. */
const RECORDS = [/^docs\/backlog\.md$/, /^docs\/board\//, /(^|\/)CHANGELOG[^/]*$/, /^\.changeset\//, /^docs\/adr\//];
const CODE_EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".ts", ".tsx"]);
const DATA_EXTENSIONS = new Set([".yml", ".yaml", ".json"]);

/** `node <path>`, an import or require of the path, or a quoted string that IS a path ending in the file name. */
const CODE_REFERENCE = new RegExp(
  `\\bnode\\s+\\S*${NAME}\\b|\\b(?:from|import|require)\\b[^\\n]*${NAME}\\.(?:mjs|ts)|["'\`](?:[^"'\`\\s]*/)?${NAME}\\.(?:mjs|test\\.ts)["'\`]`,
);
const ANY_NAME = new RegExp(NAME);

/** Lines of `text` that name a deleted file the way this file's header defines a reference, by what kind of file it is. */
export function referencesIn(path: string, text: string): string[] {
  const ext = extname(path);
  if (CODE_EXTENSIONS.has(ext)) return stripComments(text).split("\n").filter((line) => CODE_REFERENCE.test(line));
  if (DATA_EXTENSIONS.has(ext)) return text.split("\n").filter((line) => !/^\s*#/.test(line) && ANY_NAME.test(line));
  return [];
}

function trackedFiles(): string[] {
  return walkTree({ kind: "all", roots: [] }).map((file) => file.path);
}

// 1. THE FILES ARE GONE, AND THE WALK THAT SAYS SO READ A REAL TREE.
test("the walk reads a real tree: ci.yml, package.json and a script under scripts/ are in it (the positive control)", () => {
  const files = trackedFiles();
  for (const expected of [".github/workflows/ci.yml", "package.json", "scripts/ci-changed.mjs", "scripts/verify.mjs"]) {
    assert.ok(files.includes(expected), `${expected} is not tracked, so every assertion below read the wrong tree`);
  }
});

test("the three selector paths are not tracked and not on disk", () => {
  const files = new Set(trackedFiles());
  assert.deepEqual(GONE_PATHS.filter((path) => files.has(path) || existsSync(`${REPO}${path}`)), []);
});

// 2. NOTHING NAMES THEM.
test("no tracked file outside the records names a deleted selector in code, a workflow or a package script", () => {
  const readable = trackedFiles()
    .filter((path) => !RECORDS.some((record) => record.test(path)))
    .filter((path) => CODE_EXTENSIONS.has(extname(path)) || DATA_EXTENSIONS.has(extname(path)));
  assert.ok(readable.length > 100, "too few files were read for a clean result to say anything -- the walk or the filter is broken");
  const offenders = readable.flatMap((path) => referencesIn(path, read(path)).map((line) => `${path}: ${line.trim().slice(0, 120)}`));
  assert.deepEqual(offenders, []);
});

test("the reader flags each shape it claims to (positive controls for the test above)", () => {
  const shapes: Array<[string, string]> = [
    ["scripts/x.mjs", `import { classify } from "./${SELECTOR}.mjs";`],
    ["scripts/x.mjs", `execFileSync("node", ["scripts/${RUNNER}.mjs"]);`],
    ["package.json", `  "test:changed": "node scripts/${RUNNER}.mjs",`],
    [".github/workflows/x.yml", `        run: node scripts/${SELECTOR}.mjs --base origin/main`],
  ];
  for (const [path, line] of shapes) assert.equal(referencesIn(path, `${line}\n`).length, 1, `${path} did not flag: ${line}`);
  assert.deepEqual(referencesIn("scripts/x.mjs", `// the old ${SELECTOR}.mjs chose tests\n`), [], "a comment must not count");
  assert.deepEqual(referencesIn(".github/workflows/x.yml", `# ${SELECTOR}.mjs is gone\n`), [], "a workflow comment must not count");
});

// 3. THE `ts` JOB IS UNSCOPED.
/** The lines of one top-level job in a workflow, header included, by the 2-space indent the file commits to. */
function jobBlock(workflow: string, job: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start < 0) return [];
  const length = lines.slice(start + 1).findIndex((line) => /^ {2}\S/.test(line));
  return lines.slice(start, length < 0 ? undefined : start + 1 + length);
}

/** What stops a workflow's `ts` job being the whole suite: a scope input, a base or package list handed to it, a selector run. */
export function scopingIn(workflow: string): string[] {
  const live = workflow.split("\n").filter((line) => !/^\s*#/.test(line));
  const ts = jobBlock(live.join("\n"), "ts");
  const problems = ts.filter((line) => /\bts-test-scope\b|\bbase-ref\b|\btest-packages\b|\btestPackages\b/.test(line));
  return [...problems, ...live.filter((line) => ANY_NAME.test(line))].map((line) => line.trim());
}

test("ci.yml has a ts job, and it runs the whole suite", () => {
  assert.ok(jobBlock(CI(), "ts").length > 3, "ci.yml has no `ts` job, so `unscoped` is read off nothing");
  assert.deepEqual(scopingIn(CI()), []);
});

test("neither reusable workflow takes a scope input, a base ref or a package list any more", () => {
  for (const file of [".github/workflows/reusable-build-test.yml", ".github/workflows/trunk.yml"]) {
    const live = read(file).split("\n").filter((line) => !/^\s*#/.test(line));
    assert.deepEqual(live.filter((line) => /\bts-test-scope\b|\btest-packages\b|\btestPackages\b/.test(line)), [], file);
  }
});

test("a fixture workflow calling the deleted selector is refused", () => {
  const fixture = CI().replace("run-ts-tests: true", `run-ts-tests: true\n  # x\n  step: node scripts/${SELECTOR}.mjs`);
  assert.notEqual(fixture, CI(), "the fixture edit did not apply");
  assert.equal(scopingIn(fixture).length, 1);
});

test("a fixture workflow whose ts job is `ts-test-scope: scoped` is refused", () => {
  const fixture = CI().replace("run-ts-tests: true", "run-ts-tests: true\n      ts-test-scope: scoped");
  assert.notEqual(fixture, CI(), "the fixture edit did not apply");
  assert.deepEqual(scopingIn(fixture), ["ts-test-scope: scoped"]);
});

function CI(): string {
  return read(".github/workflows/ci.yml");
}

// 4. THE `changed` JOB'S SCRIPT STILL RUNS BEFORE `npm ci`.
/** Every file `entry` imports by relative path, and every bare specifier on the way: the static view the runner has. */
function importsOf(entry: string): { files: string[]; bare: string[] } {
  const files = new Set<string>();
  const bare: string[] = [];
  const visit = (abs: string): void => {
    if (files.has(abs) || !existsSync(abs)) return;
    files.add(abs);
    const source = stripComments(readFileSync(abs, "utf8"));
    for (const match of source.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = match[1] ?? match[2];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) visit(resolve(dirname(abs), spec));
      else bare.push(`${abs.slice(REPO.length)} -> ${spec}`);
    }
  };
  visit(resolve(REPO, entry));
  return { files: [...files], bare };
}

test("the changed job runs scripts/ci-changed.mjs before any install, and nothing it imports needs node_modules", () => {
  const job = jobBlock(CI(), "changed");
  assert.ok(job.length > 3, "ci.yml has no `changed` job");
  const script = job.map((line) => /\bnode\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/.exec(line)?.[1]).find(Boolean);
  assert.equal(script, "scripts/ci-changed.mjs");
  assert.ok(!job.some((line) => /\b(?:npm|pnpm)\s+(?:ci|install)\b/.test(line)), "the changed job installs, so it is no longer the cheap first job");
  const { files, bare } = importsOf(script as string);
  assert.ok(files.length >= 2, "the walk reached no import of ci-changed.mjs, so `bare` is empty by not looking");
  assert.deepEqual(bare, []);
});
