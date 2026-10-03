/**
 * NOTHING IN `scripts/` OR `packages/*` SPAWNS `npm` OR `npx` BUT THE FILES NAMED BELOW (#2889, row 2 of 10 of "Finish the
 * move to pnpm", #57's follow-through).
 *
 * The package manager is `pnpm`. A script that runs `npm run x` inside node is the same defect as one in a brief, and the
 * one nobody sees by reading a manifest, so the programs this repo writes are held to it by a walk of their source.
 * `npm-cli-windows-spawn.test.ts` asks a DIFFERENT question of the same population (is the spawn safe on Windows, however
 * it is spelled?); this one asks whether it should be a spawn of npm at all.
 *
 * THE ALLOWLIST IS THE ONES WHERE npm IS THE POINT, not a convenience. Each is the consumer's experience or the registry's:
 *
 *   - `scripts/registry-consumer-gate.mjs`: `npm install a11ign` IS what a user runs, so a gate that installed with pnpm would
 *     test a different install than the one they get. `npm view` and `npx --no-install` are registry reads.
 *   - `scripts/release-publish-rehearsal.mjs`: trusted publishing is bound to npm's OIDC, and `pnpm publish` shells out to
 *     `npm publish`, so the rehearsal reads the npm the publish would use.
 *   - `packages/guards/src/isolation-gate.mjs`: the CONSUMER half of the isolation gate installs the packed tarballs with npm
 *     into a directory that is not a workspace, for the registry gate's reason (its header, "Two package managers, on
 *     purpose", and `pnpm-publish-path.test.ts` pin it). The row named two files; this is a third, found by reading the
 *     Region and reported on #2889 rather than silently widened or silently ported.
 *
 * Each carries a one-line `STAYS npm` comment saying why, and THIS FILE pins that by file name, so the reason sits where a
 * reader changing the file meets it.
 *
 * Nothing else is exempt, and a new spawn anywhere else is refused naming file and line. (A `PENDING` list once exempted rows
 * still owing a port, the tool's directory last, until #2976 deleted that directory and the list with it.)
 *
 * WHAT THIS CANNOT SEE: a command assembled at run time (`spawn(tool, ...)` with `tool = "npm"`), or `npm` handed to a shell
 * as part of a longer string such as `sh -c "npm run x"`. It reads the literal at the call, which is the shape every spawn
 * in this tree has, and the Windows guard beside it covers the rest of the shapes.
 *
 * Test files are not scanned: a fixture is a STRING holding a spawn, as this file's own are, and a test that drives npm on
 * purpose (the consumer-side assertions in `pnpm-publish-path.test.ts`) is observing the registry, not choosing a manager.
 * This file READS source as text and imports no script, so it carries no corpus requirement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** The named files that keep npm, and why. The reason is for a reader; the test pins the FILE NAMES. */
const ALLOWED: Record<string, string> = {
  "scripts/registry-consumer-gate.mjs": "`npm install a11ign` is the consumer's experience; `npm view` reads the registry",
  "scripts/release-publish-rehearsal.mjs": "trusted publishing is bound to npm's OIDC, and `pnpm publish` shells out to `npm publish`",
  "packages/guards/src/isolation-gate.mjs": "the consumer half installs the packed tarballs with npm, outside any workspace",
};

/** Every comment in an allowlisted file that says why, matched by this exact opening. */
const STAYS_MARKER = /\/\/ STAYS npm\b/;

/**
 * Callee and literal, in the two shapes a spawn of the old tool takes in this tree:
 *   - the argv shape, `anything("npm", ...)` / `npmCliInvocation("npx", ...)`, which catches the helper and a local `run`;
 *   - the command-string shape, `execSync("npm run x")`, on the `child_process` names only, so an error message that begins
 *     with the word `npm` is not mistaken for one;
 *   - the argv shape in a LATER position, `stage(label, "npm", ["run", "x"])`, which a wrapper around `spawnSync` takes
 *     (`lab-pipeline.mjs` did, and the first version of this guard missed it). The literal must be followed by an argv array,
 *     so `join(dir, "node_modules", "npm", "bin")` is not mistaken for one.
 * And a bare `pnpm`, which is the Windows hazard the helper exists for, spelled the new way.
 */
const SPAWN_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "an npm/npx spawn", pattern: /\b[\w$.]+\(\s*["'`](npm|npx)["'`]\s*[,)]/g },
  { name: "an npm/npx command with an argv array", pattern: /(?<=,\s*)["'`](npm|npx)["'`]\s*,\s*\[/g },
  { name: "an npm/npx command string", pattern: /\b(?:execSync|exec|execFileSync|execFile|spawnSync|spawn)\(\s*["'`](npm|npx)\s/g },
  { name: "a bare pnpm spawn", pattern: /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*["'`](pnpm)["'`]/g },
];

type Hit = { line: number; spelling: string; shape: string };

/** Every spawn of the old tool in `source` (comments stripped first, so prose cannot trip it), with its line. */
function spawnsOf(source: string): Hit[] {
  const code = stripComments(source);
  return SPAWN_SHAPES.flatMap(({ name, pattern }) =>
    [...code.matchAll(pattern)].map((match) => ({
      line: code.slice(0, match.index).split("\n").length,
      spelling: match[1],
      shape: name,
    })));
}

/** `file:line: shape` for every spawn in a file that is not allowlisted. */
function refusals(sources: Record<string, string>, allowed: readonly string[] = Object.keys(ALLOWED)): string[] {
  return Object.entries(sources)
    .filter(([path]) => !allowed.includes(path))
    .flatMap(([path, source]) => spawnsOf(source).map((hit) => `${path}:${hit.line}: ${hit.shape} (\`${hit.spelling}\`)`));
}

// ---- the detector, on fixtures ---------------------------------------------------------------------------------------------

test("a fixture spawnSync(\"npm\", ...) is REFUSED, naming the file and the line", () => {
  const source = 'import { spawnSync } from "node:child_process";\n\nspawnSync("npm", ["run", "build"]);\n';
  assert.deepEqual(refusals({ "scripts/new-script.mjs": source }), ["scripts/new-script.mjs:3: an npm/npx spawn (`npm`)"]);
});

test("the same spelling in an allowlisted file passes, and in the same file under another name it does not", () => {
  const source = 'spawnSync("npm", ["view", "a11ign"]);\n';
  assert.deepEqual(refusals({ "scripts/registry-consumer-gate.mjs": source }), []);
  assert.equal(refusals({ "scripts/registry-consumer-gate-copy.mjs": source }).length, 1);
});

test("an npx call is REFUSED, whether through the helper or a child_process call or a command string", () => {
  assert.deepEqual(refusals({ "packages/lab/src/a.mjs": 'const x = npmCliInvocation("npx", ["tsx", f]);' }),
    ["packages/lab/src/a.mjs:1: an npm/npx spawn (`npx`)"]);
  assert.deepEqual(refusals({ "packages/lab/src/b.mjs": 'execFileSync("npx", ["tsx"]);' }), ["packages/lab/src/b.mjs:1: an npm/npx spawn (`npx`)"]);
  assert.deepEqual(refusals({ "scripts/c.mjs": 'execSync("npm run x");' }), ["scripts/c.mjs:1: an npm/npx command string (`npm`)"]);
  assert.deepEqual(refusals({ "scripts/d.mjs": "execSync(`npx tsx ${f}`);" }), ["scripts/d.mjs:1: an npm/npx command string (`npx`)"]);
});

test("an npm spawn handed to a wrapper in a LATER argument is REFUSED (the `stage()` shape), and a path join is not one", () => {
  const wrapped = 'const labJob = (job) => stage(job, "npm", ["run", "lab:job", "--", "-e", `job=${job}`]);';
  assert.deepEqual(refusals({ "packages/control/src/h.mjs": wrapped }), ["packages/control/src/h.mjs:1: an npm/npx command with an argv array (`npm`)"]);
  assert.deepEqual(refusals({ "packages/control/src/i.mjs": 'run(label, "npx", ["tsc"]);' }), ["packages/control/src/i.mjs:1: an npm/npx command with an argv array (`npx`)"]);
  assert.deepEqual(refusals({ "scripts/j.mjs": 'join(nodeDir, "node_modules", "npm", "bin", script);' }), []);
  assert.equal(refusals({ "scripts/k.mjs": 'spawnSync("npm", ["ci"]);' }).length, 1, "a first-argument spawn is one hit, not two");
});

test("a bare pnpm spawn is REFUSED too: it is `pnpm.cmd` on Windows, which CVE-2024-27980 refuses, and the helper is the way", () => {
  assert.deepEqual(refusals({ "scripts/e.mjs": 'spawnSync("pnpm", ["run", "x"]);' }), ["scripts/e.mjs:1: a bare pnpm spawn (`pnpm`)"]);
  assert.deepEqual(refusals({ "scripts/f.mjs": 'const p = pnpmCliInvocation(["run", "x"]); spawnSync(p.command, p.args);' }), []);
});

test("prose and messages that merely name npm are not spawns", () => {
  const source = [
    '// run `spawnSync("npm", ["run", "x"])` -- a comment',
    'const message = "npm run build failed";',
    'warn("npm run build is retired");',
    'throw new Error(`npm ${what} failed`);',
    "",
  ].join("\n");
  assert.deepEqual(refusals({ "scripts/g.mjs": source }), []);
});

test("doctor.mjs is not exempt: row 3 landed, so a spawn there is refused like any other file's", () => {
  assert.equal(refusals({ "packages/worker-fleet/src/doctor.mjs": 'spawnSync("npm", ["ci"]);' }).length, 1);
});

// ---- the real tree ------------------------------------------------------------------------------------------------------------

/** Tracked source this guard covers: `scripts/`, and each package's `src/` and `scripts/`, never a test or a build output. */
function scannedSources(): Record<string, string> {
  const covered = /^(scripts\/|packages\/[^/]+\/(src|scripts)\/)/;
  const paths = walkTree({ kind: "both", roots: [] }).map((file) => file.path)
    .filter((path) => covered.test(path) && /\.(mjs|cjs|js|ts)$/.test(path) && !/\.test\./.test(path))
    .filter((path) => !path.includes("/dist/") && !path.includes("/node_modules/"));
  return Object.fromEntries(paths.map((path) => [path, readFileSync(`${REPO}${path}`, "utf8")]));
}

test("the real tree: no spawn of npm or npx outside the named allowlist", () => {
  assert.deepEqual(refusals(scannedSources()), []);
});

test("positive control: the walk is not empty, and finds the spawns that ARE allowed, in each allowlisted file", () => {
  const sources = scannedSources();
  assert.ok(Object.keys(sources).length > 200, "too few files scanned: the walk is broken, and an empty walk passes everything");
  for (const path of Object.keys(ALLOWED)) {
    assert.ok(path in sources, `${path} is not in the scanned population`);
    assert.ok(spawnsOf(sources[path]).length > 0, `${path} no longer spawns npm: it is a stale allowlist entry, delete it`);
  }
});

test("the allowlist is EXACTLY these named files (the two registry gates and the isolation gate), so a fourth is a decision made here", () => {
  assert.deepEqual(Object.keys(ALLOWED).sort(), [
    "packages/guards/src/isolation-gate.mjs",
    "scripts/registry-consumer-gate.mjs",
    "scripts/release-publish-rehearsal.mjs",
  ]);
});

test("each allowlisted file says in a `STAYS npm` comment why it does", () => {
  for (const path of Object.keys(ALLOWED)) {
    assert.match(readFileSync(`${REPO}${path}`, "utf8"), STAYS_MARKER, `${path} keeps npm without saying why`);
  }
  assert.doesNotMatch("// stays a normal comment", STAYS_MARKER, "the marker is not satisfied by any comment");
});
