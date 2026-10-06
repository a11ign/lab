/**
 * #3534 (chairman, via `ceo`, 2026-10-04): A11IGN DOES NOT DEPEND ON `agent-org`, so a second version of the tool is impossible by construction.
 *
 * The host ran `v0.22.0` while this repository's `package.json` pinned `^0.7.0` (locked at 0.7.8): 40 aliases and every workflow that ran
 * `pnpm exec agent-org` executed one version while the gate ran another, and a caret on `0.x` never crosses a minor, so no follower could close it.
 * There is nothing to pin now. This file reads the TRACKED tree and shows five things:
 *
 *   (1) `package.json` has no `agent-org` dependency in any group and no script whose value starts with `agent-org `, and the lockfile has no entry;
 *   (2) `agent-org-bump.yml`, the follower of the pin, is not tracked;
 *   (3) no tracked `.mjs`/`.ts`/`.js`/`.sh` file imports or requires `agent-org` by package name, and no workflow runs it through pnpm or names a pin;
 *   (4) every live workflow step that runs `agent-org` has an earlier step in its job that runs the ONE resolver, which takes the newest STABLE tag
 *       (compared as numbers) and refuses, rather than falling back to a branch, when there is none;
 *   (5) no role brief, unit file or rule tells anyone to run a removed alias as `pnpm run <alias>`.
 *
 * POSITIVE CONTROLS. Each reader below is a function of text, and each is shown to FLAG one alias, one `from "agent-org/..."` import and one
 * `pnpm run row-claim` put back (a fixture holding exactly that), and to pass the same text with it taken out. The real tree's populations are shown
 * non-empty by name (the workflows that run the tool, the role briefs, the files scanned), so a green result is not an empty one. The counts at the
 * commit before this change, MEASURED with the same reads against `6d1bb7f91`: 40 aliases, 38 files naming the package in an import position
 * (37 name-importers plus `ci.yml`'s fixture line), 13 role files naming an alias. A test cannot hold those against `origin/main` once this merges:
 * `main` then has none, which is the point.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";
import { stripComments } from "../../../guards/src/local-import-closure.mjs";
import { main as resolverMain, newestStableTag } from "../../../../scripts/agent-org-newest-tag.mjs";

declareTreeWideGuard();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** This file names every pattern it refuses, so it is left out of its own walk, here and by name (`.claude`'s rule: a guard excludes itself in code). */
const SELF = "packages/lab/src/packaging/no-agent-org-dependency.test.ts";
const RESOLVER = "scripts/agent-org-newest-tag.mjs";

/** The 40 `package.json` aliases #3534 deleted, each `agent-org <command>`: a brief that still says `pnpm run <one of these>` names a command that is gone. */
const REMOVED_ALIASES = [
  "row-claim", "row-file", "board:summary-check", "board:liveness", "workflow:liveness", "ready:audit", "branches:stranded", "queue:table",
  "work:gate", "work:wake", "work:profile", "prompt:session", "messaging:watch", "messaging:pair", "messaging:listen", "chairman:reply",
  "work:tick", "spawn:cycles", "board:document", "tracker:comment", "board:record", "board:report", "board:settle", "hygiene:report", "survey",
  "primary:mark", "rescue:hunk", "worktrees:prune", "primary:update", "fleet:batch-now", "host:check", "host:install", "stash:whose",
  "pr:hold", "pr:release", "pr:open", "pr:edit", "branches:inventory", "worktree:whose", "worktree:stamp",
];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const tracked = () => walkTree({ kind: "all", roots: [] }).map((file) => file.path).filter((path) => path !== SELF);

// --- (1) package.json and the lockfile -------------------------------------------------------------------------------------------------

const DEPENDENCY_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** What in `package.json` text and lockfile text still ties this repository to the tool, one line each. */
export function dependencyOffenders(packageJson: string, lockfile: string): string[] {
  const manifest = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
  const groups = DEPENDENCY_GROUPS.filter((group) => manifest[group] && "agent-org" in (manifest[group] ?? {})).map((group) => `${group}.agent-org`);
  const aliases = Object.entries(manifest.scripts ?? {}).filter(([, value]) => value.startsWith("agent-org ")).map(([name]) => `scripts.${name}`);
  const locked = lockfile.split("\n").filter((line) => /^\s*agent-org(@|:)/.test(line)).map((line) => `pnpm-lock.yaml: ${line.trim()}`);
  return [...groups, ...aliases, ...locked];
}

test("(1) package.json has no agent-org dependency and no `agent-org <cmd>` alias, and the lockfile has no entry", () => {
  const manifest = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(Object.keys(manifest.scripts).length > 100, "POSITIVE CONTROL: the manifest read really holds the repository's scripts, so no alias is not a miss");
  assert.deepEqual(dependencyOffenders(read("package.json"), read("pnpm-lock.yaml")), []);
});

test("(1) control: one alias, one dependency, one lockfile entry put back are each found, and the clean text is not", () => {
  const clean = JSON.stringify({ scripts: { test: "pnpm test" }, devDependencies: { yaml: "^2" } });
  assert.deepEqual(dependencyOffenders(clean, "importers:\n  .:\n    devDependencies:\n      yaml:\n"), []);
  assert.deepEqual(dependencyOffenders(JSON.stringify({ scripts: { "row-claim": "agent-org row-claim" } }), ""), ["scripts.row-claim"]);
  assert.deepEqual(dependencyOffenders(JSON.stringify({ devDependencies: { "agent-org": "github:a11ign/agent-org#semver:^0.7.0" } }), ""), ["devDependencies.agent-org"]);
  assert.deepEqual(dependencyOffenders(clean, "importers:\n  .:\n      agent-org:\n        specifier: x\n"), ["pnpm-lock.yaml: agent-org:"]);
});

// --- (2) the follower ------------------------------------------------------------------------------------------------------------------

test("(2) agent-org-bump.yml, the follower of the pin, is not tracked", () => {
  const paths = tracked();
  assert.ok(paths.includes(".github/workflows/ci.yml"), "POSITIVE CONTROL: the walk lists the workflows, so the follower's absence is a reading");
  assert.deepEqual(paths.filter((path) => path.endsWith("agent-org-bump.yml") || path.endsWith("agent-org-bump-workflow.test.ts")), []);
});

// --- (3) importers and pins ------------------------------------------------------------------------------------------------------------

/** A package-name reference to the tool in code position: `from "agent-org/..."`, `import("agent-org/...")`, `require("agent-org")`. */
const IMPORTS_BY_NAME = /(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*["']agent-org(?:["'/])/;
/** A workflow line that runs the tool through pnpm, or names a version pin of it. */
const PINNED_RUN = /pnpm (?:exec|dlx) agent-org\b|github:a11ign\/agent-org#|agent-org#(?:semver:|v\d)/;

/** Files, among `files` (path -> text), that import the tool by name; comments are not code. */
export function namedImporters(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([path, text]) => [".mjs", ".ts", ".js", ".sh"].includes(extname(path)) && IMPORTS_BY_NAME.test(stripComments(text)))
    .map(([path]) => path);
}

/** Workflows, among `files`, with a line that runs the tool through pnpm or pins it. */
export function pinnedRuns(files: Record<string, string>): string[] {
  return Object.entries(files).filter(([path, text]) => /\.ya?ml$/.test(path)
    && text.split("\n").some((line) => !line.trim().startsWith("#") && PINNED_RUN.test(line))).map(([path]) => path);
}

const sourceFiles = () => Object.fromEntries(tracked()
  .filter((path) => [".mjs", ".ts", ".js", ".sh", ".yml", ".yaml"].includes(extname(path)) || /(^|\/)pre-push$|\/reference-transaction$/.test(path))
  .map((path) => [path, read(path)]));

test("(3) no tracked source file imports agent-org by package name, and no workflow runs it through pnpm or pins it", () => {
  const files = sourceFiles();
  assert.ok(Object.keys(files).length > 1000, "POSITIVE CONTROL: the walk read the repository's sources, so an empty offender list is a reading");
  assert.ok(Object.values(files).some((text) => /toolModule\(/.test(text)), "and the importers it looks for were replaced by the path form, not by nothing");
  assert.deepEqual(namedImporters(files), []);
  assert.deepEqual(pinnedRuns(files), []);
});

test("(3) control: one `from \"agent-org/...\"` import, one require, one `pnpm exec agent-org` and one pin put back are each found", () => {
  const imports = { "a.mjs": 'import { x } from "agent-org/src/row-claim.mjs";\n', "b.ts": 'const m = await import("agent-org/src/x.mjs");\n',
    "c.js": 'const m = require("agent-org");\n', "d.mjs": 'import { toolModule } from "./agent-org-newest-tag.mjs";\n// from "agent-org/src/x.mjs" in a comment\n' };
  assert.deepEqual(namedImporters(imports), ["a.mjs", "b.ts", "c.js"]);
  assert.deepEqual(pinnedRuns({ "w.yml": "jobs:\n  j:\n    steps:\n      - run: pnpm exec agent-org arm-pr\n", "x.yml": "# pnpm exec agent-org is gone\nrun: agent-org arm-pr\n" }), ["w.yml"]);
  assert.deepEqual(pinnedRuns({ "y.yml": '        run: pnpm add -D "github:a11ign/agent-org#semver:^0.7.0"\n' }), ["y.yml"]);
});

// --- (4) the one resolver --------------------------------------------------------------------------------------------------------------

type Step = { run?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

/** A step that runs the tool: `agent-org <command>` in command position, whether or not it follows `;`, `&&`, `||`, `|`, `(`, `then` or `do`. */
const RUNS_THE_TOOL = /(^|&&|\|\||;|\||\(|\bthen\b|\bdo\b)\s*agent-org\s+[a-z]/m;
const RUNS_THE_RESOLVER = /node scripts\/agent-org-newest-tag\.mjs\b/;

/** `job.step` of every step that runs the tool with no earlier step in its job that runs the resolver. */
export function toolStepsWithoutResolver(doc: Workflow): string[] {
  const offenders: string[] = [];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    let resolved = false;
    for (const [index, step] of (job.steps ?? []).entries()) {
      const run = step.run ?? "";
      if (RUNS_THE_TOOL.test(run) && !resolved) offenders.push(`${jobName}.steps[${index}]`);
      if (RUNS_THE_RESOLVER.test(run)) resolved = true;
    }
  }
  return offenders;
}

const workflows = () => tracked().filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
  .map((path) => ({ path, doc: parseYaml(read(path)) as Workflow }));

test("(4) every workflow step that runs `agent-org` has an earlier step in its job that runs the one resolver", () => {
  const live = workflows();
  const stepsRunningTheTool = live.reduce((sum, { doc }) => sum + Object.values(doc.jobs ?? {})
    .flatMap((job) => job.steps ?? []).filter((step) => RUNS_THE_TOOL.test(step.run ?? "")).length, 0);
  assert.ok(stepsRunningTheTool >= 15, "POSITIVE CONTROL: fewer than 15 steps read as running the tool: the pattern is broken, not the workflows");
  assert.deepEqual(live.flatMap(({ path, doc }) => toolStepsWithoutResolver(doc).map((where) => `${path}: ${where}`)), []);
});

test("(4) control: a job with no resolver, one that resolves AFTER the tool, and a prose mention are told apart from one that resolves first", () => {
  const job = (...runs: string[]): Workflow => ({ jobs: { j: { steps: runs.map((run) => ({ run })) } } });
  const tool = "agent-org merge-guard --ci-gate 1";
  const resolve = 'node scripts/agent-org-newest-tag.mjs --dest="$RUNNER_TEMP/agent-org"';
  assert.deepEqual(toolStepsWithoutResolver(job(tool)), ["j.steps[0]"]);
  assert.deepEqual(toolStepsWithoutResolver(job(tool, resolve)), ["j.steps[0]"], "the resolver comes too late to help the step above it");
  assert.deepEqual(toolStepsWithoutResolver(job("pnpm install --frozen-lockfile", tool)), ["j.steps[1]"], "an install is not the resolver");
  assert.deepEqual(toolStepsWithoutResolver(job(resolve, tool)), []);
  assert.deepEqual(toolStepsWithoutResolver(job("echo agent-org is a word in prose")), []);
});

test("(4) the resolver takes the newest STABLE tag, compared as numbers, from each of the three lists the row names", () => {
  assert.equal(newestStableTag(["v0.7.9", "v0.22.0"]), "v0.22.0");
  assert.equal(newestStableTag(["v0.22.0", "v0.22.1", "v0.9.0"]), "v0.22.1", "v0.9.0 is older than v0.22.0, which a string sort gets backwards");
  assert.equal(newestStableTag(["v0.22.0-rc.1", "v0.21.3"]), "v0.21.3", "a prerelease is not a release");
  assert.equal(newestStableTag(["v0.22.0", "v0.22.0"]), "v0.22.0");
});

test("(4) the resolver REFUSES with no stable tag at all, and never falls back to a branch", () => {
  assert.throws(() => newestStableTag(["main", "v0.22.0-rc.1", "v1.0"]), /none of the 3 tag\(s\) is a stable release/);
  assert.throws(() => newestStableTag([]), /none of the 0 tag\(s\)/);
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => { printed.push(line); };
  try {
    assert.equal(resolverMain(["--tags=v0.9.0,v0.22.0"]), 0);
    assert.throws(() => resolverMain(["--tags=main"]), /stable release/);
  } finally {
    console.log = log;
  }
  assert.deepEqual(printed, ["v0.22.0"], "the CLI prints the tag it chose, and prints nothing when it refuses");
});

test("(4) the workflows that resolve the tool are named: the resolver is run in every job that installs the workspace or runs the tool", () => {
  const resolving = workflows().filter(({ doc }) => Object.values(doc.jobs ?? {}).some((job) => (job.steps ?? []).some((step) => RUNS_THE_RESOLVER.test(step.run ?? ""))));
  assert.ok(resolving.length >= 10, "POSITIVE CONTROL: fewer than 10 workflows run the resolver, where the row counted 10 that named the tool");
  assert.ok(read(RESOLVER).includes("newestStableTag"), "and the resolver file is the one these steps name");
});

// --- (5) briefs, units and rules -------------------------------------------------------------------------------------------------------

const ALIAS_ALTERNATION = REMOVED_ALIASES.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
/** `pnpm run <alias>`, `npm run <alias>`, `pnpm <alias>` or the unit's `%h/.local/bin/pnpm run <alias>`: a command that is no longer there. */
const REMOVED_ALIAS_CALL = new RegExp(`\\b(?:pnpm|npm)(?: run)?(?: --silent)? (?:${ALIAS_ALTERNATION})(?![\\w:-])`);

/** Files, among `files` (path -> text), that tell a reader to run a removed alias, with the line. */
export function removedAliasCalls(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([path, text]) => text.split("\n")
    .flatMap((line, index) => (REMOVED_ALIAS_CALL.test(line) ? [`${path}:${index + 1}: ${line.trim().slice(0, 100)}`] : [])));
}

const LIVE_INSTRUCTIONS = /^(\.agent-org\/(roles|units)\/|\.claude\/rules\/|(.*\/)?CLAUDE\.md$)/;
const instructionFiles = () => Object.fromEntries(tracked().filter((path) => LIVE_INSTRUCTIONS.test(path)).map((path) => [path, read(path)]));

test("(5) no role brief, unit file or rule names a removed alias as `pnpm run <alias>`", () => {
  const files = instructionFiles();
  const briefs = Object.keys(files).filter((path) => path.startsWith(".agent-org/roles/") && path.endsWith(".md"));
  assert.ok(briefs.length >= 13, "POSITIVE CONTROL: fewer than 13 role briefs read, where 13 of them named an alias before this change");
  assert.ok(Object.keys(files).some((path) => path.startsWith(".agent-org/units/")) && Object.keys(files).some((path) => path.startsWith(".claude/rules/")),
    "and the units and the rules are in the population too");
  assert.ok(Object.values(files).some((text) => /\bagent-org (row-claim|work:gate|pr:open|prompt:session)\b/.test(text)),
    "and the briefs say the new form, so the old form's absence is not an empty file");
  assert.deepEqual(removedAliasCalls(files), []);
});

test("(5) control: one `pnpm run row-claim`, one `npm run work:gate` and one unit line put back are each found; a command that is still a script is not", () => {
  assert.equal(REMOVED_ALIASES.length, 40, "the list is the 40 the row counted");
  assert.deepEqual(removedAliasCalls({ "a.md": "Run `pnpm run row-claim check 1` first.\n" }), ["a.md:1: Run `pnpm run row-claim check 1` first."]);
  assert.equal(removedAliasCalls({ "b.md": "`npm run work:gate -- --json`\n" }).length, 1);
  assert.equal(removedAliasCalls({ "c.service": "ExecStartPre=-%h/.local/bin/pnpm run primary:update\n" }).length, 1);
  assert.deepEqual(removedAliasCalls({ "d.md": "`pnpm run verify`, `pnpm test`, `agent-org row-claim check 1`, `pnpm run work:gate-x`\n" }), [],
    "verify and test are still scripts, the new form is the new form, and a longer name is not the alias");
});
