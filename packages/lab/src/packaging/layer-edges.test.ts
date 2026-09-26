/**
 * #2612, child 1 of #69: `packages/guards/src/layer-edges.mjs`, the guard that makes the boundary of `nvda-worker` and
 * `nvda-speech` a thing a machine can read, and refuses a reach across it that the baseline does not name.
 *
 * EVERY FIXTURE IS A REPOSITORY OF ITS OWN under `fixtures/layer-edges/<case>/`, holding a real `packages/other/src/x.mjs`.
 * That file is the CONFOUND control: a fixture that names it in a comment or as data passes because of the comment or the
 * data, and never because the target was missing (`a-negative-fixture-needs-the-confound-in-it`). Each such case asserts the
 * target exists and that the mention is really there, so a fixture emptied by accident is not read as a pass.
 *
 * THE POSITIVE CONTROLS ARE IN THIS FILE, by name, because `assert.deepEqual(edges, [])` passes over an empty population:
 *   - the clean fixture is asserted to hold scanned files, so "no edges" is a scan that looked and found none;
 *   - the declared layer list is asserted to hold both packages, and the real tree's baseline to be NON-EMPTY and to hold
 *     the deploy path, so a guard that discovers nothing is not read as a tree with no edges;
 *   - a baseline entry for an edge that does not exist is asserted REFUSED as stale, and an edge the baseline lacks REFUSED
 *     as new, so an allowlist the subject can join has no reading in which it passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASELINE_PATH, LAYER_PACKAGES, countByDisposition, describeVerdict, findEdges, isScanned, judgeEdges, packageOf,
  readBaseline, trackedFiles,
} from "../../../guards/src/layer-edges.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const GUARD = join(ROOT, "packages/guards/src/layer-edges.mjs");
const FIXTURES = join(ROOT, "packages/lab/src/packaging/fixtures/layer-edges");

const fixture = (name: string) => join(FIXTURES, name);
const edgesOf = (name: string) => findEdges({ root: fixture(name), tracked: trackedFiles(fixture(name)) });
const textOf = (name: string, path: string) => readFileSync(join(fixture(name), path), "utf8");
const cli = (...args: string[]) => spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8" });

const TARGET = "packages/other/src/x.mjs";
const LAYER_FILE = "packages/nvda-worker/src/x.mjs";

// ------------------------------------------------------------------ the declared layers

test("the layer packages are DECLARED, both of them, and packageOf reads the directory under packages/", () => {
  assert.deepEqual([...LAYER_PACKAGES], ["nvda-worker", "nvda-speech"]);
  assert.equal(packageOf("packages/nvda-worker/src/server.mjs"), "nvda-worker");
  assert.equal(packageOf("packages/nvda-speech"), "nvda-speech");
  assert.equal(packageOf("scripts/x.mjs"), null, "the repository root and scripts/ are in no package");
});

// ------------------------------------------------------------------ the clean fixture PASSES

test("a clean layer package PASSES: its own imports, a bare package import, and another package reaching it by NAME", () => {
  const scanned = trackedFiles(fixture("clean")).filter((path) => isScanned(path));
  assert.deepEqual(scanned.sort(), [
    "packages/nvda-worker/src/own.mjs", "packages/nvda-worker/src/x.mjs", "packages/other/src/x.mjs", "packages/other/src/y.mjs",
  ], "POSITIVE CONTROL: the clean fixture is scanned, so no edges is a scan that found none");
  assert.deepEqual(edgesOf("clean"), []);
});

// ------------------------------------------------------------------ the refusals, one fixture each

test("an import that leaves the layer is REFUSED, naming both ends", () => {
  const edges = edgesOf("imports-across");
  assert.deepEqual(edges, [{ from: LAYER_FILE, to: TARGET, kind: "import", direction: "out" }]);
  const message = describeVerdict(judgeEdges(edges, [])).join("\n");
  assert.match(message, /NEW EDGE out: packages\/nvda-worker\/src\/x\.mjs -> packages\/other\/src\/x\.mjs/);
});

test("a `new URL(..., import.meta.url)` read that leaves the layer is REFUSED", () => {
  assert.deepEqual(edgesOf("url-read"), [{ from: LAYER_FILE, to: TARGET, kind: "path-literal", direction: "out" }]);
});

test("a `.cmd` launcher naming another package's path is REFUSED", () => {
  assert.deepEqual(edgesOf("launcher"), [
    { from: "packages/nvda-worker/src/run.cmd", to: TARGET, kind: "launcher", direction: "out" },
  ]);
});

test("a path named once in a constant and read through the variable is REFUSED", () => {
  assert.deepEqual(edgesOf("bound-literal"), [{ from: LAYER_FILE, to: TARGET, kind: "path-literal", direction: "out" }]);
});

test("a git `<rev>:<path>` read of another package is REFUSED", () => {
  assert.deepEqual(edgesOf("git-show"), [{ from: LAYER_FILE, to: TARGET, kind: "path-literal", direction: "out" }]);
});

test("the OTHER direction: a package that imports into the layer by path is REFUSED", () => {
  assert.deepEqual(edgesOf("reach-in"), [
    { from: "packages/other/src/y.mjs", to: "packages/nvda-worker/src/own.mjs", kind: "import", direction: "in" },
  ]);
});

test("a workflow and a config file naming a layer path are REFUSED, as `in` edges of their own kinds", () => {
  const kinds = edgesOf("workflow-config").map((e) => `${e.direction} ${e.kind} ${e.from}`).sort();
  assert.deepEqual([...new Set(kinds)], [
    "in config .c8rc.json",
    "in workflow .github/workflows/w.yml",
  ]);
});

// ------------------------------------------------------------------ the passes that must stay passes

test("a path mentioned ONLY in a comment PASSES, with the real target and the comment both present", () => {
  assert.ok(existsSync(join(fixture("comment-only"), TARGET)), "CONTROL: the target exists, so this passes because it is a comment");
  assert.match(textOf("comment-only", "packages/nvda-worker/src/x.mjs"), /\/\/ import \{ X \} from "\.\.\/\.\.\/other\/src\/x\.mjs"/);
  assert.match(textOf("comment-only", "packages/nvda-worker/src/run.cmd"), /^rem node "packages\\other\\src\\x\.mjs"/m);
  assert.deepEqual(edgesOf("comment-only"), []);
});

test("a path handed to a parser as DATA PASSES: a region body and a fixture list are named, never read", () => {
  assert.ok(existsSync(join(fixture("data-only"), TARGET)), "CONTROL: the target exists, so this passes because it is data");
  assert.match(textOf("data-only", LAYER_FILE), /REGION_BODY = "packages\/other\/src\/x\.mjs/);
  assert.match(textOf("data-only", LAYER_FILE), /parseRegion\("packages\/other\/src\/x\.mjs"\)/, "and a path literal is handed to a call");
  assert.deepEqual(edgesOf("data-only"), []);
});

test("`${name}/package.json` is not the repository's package.json: a template that begins with an interpolation PASSES", () => {
  assert.ok(existsSync(join(fixture("dynamic-template"), "package.json")), "CONTROL: a root package.json exists to be falsely read");
  assert.match(textOf("dynamic-template", LAYER_FILE), /require\.resolve\(`\$\{name\}\/package\.json`\)/);
  assert.deepEqual(edgesOf("dynamic-template"), []);
});

// ------------------------------------------------------------------ the baseline is not an allowlist the subject can join

const ENTRY = {
  from: LAYER_FILE, to: TARGET, kind: "import", direction: "out" as const, disposition: "owned-by:#2614", reason: "a stated reason",
};

test("an edge the baseline names is not new, and the same baseline over a tree without it is STALE", () => {
  const edges = edgesOf("imports-across");
  assert.equal(edges.length, 1, "POSITIVE CONTROL: the fixture has the edge, so the empty result below is the baseline's doing");
  assert.deepEqual(judgeEdges(edges, [ENTRY]), { unlisted: [], stale: [], malformed: [] });
  const stale = judgeEdges(edgesOf("clean"), [ENTRY]);
  assert.deepEqual(stale.stale, [ENTRY]);
  assert.match(describeVerdict(stale).join("\n"), /STALE ENTRY: packages\/nvda-worker\/src\/x\.mjs -> packages\/other\/src\/x\.mjs/);
});

test("an entry the baseline cannot honour is MALFORMED: no reason, `cut`, a bare owned-by, or not a list", () => {
  const malformed = (entry: object) => judgeEdges([], [entry]).malformed;
  assert.deepEqual(malformed(ENTRY), [], "CONTROL: the well-formed entry is accepted");
  assert.match(malformed({ ...ENTRY, reason: "" })[0], /missing reason/);
  assert.match(malformed({ ...ENTRY, disposition: "cut" })[0], /REMOVES its entry/);
  assert.match(malformed({ ...ENTRY, disposition: "owned-by:2614" })[0], /not by-name, travels or owned-by:#<row>/);
  assert.match(malformed({ ...ENTRY, kind: "vibes" })[0], /kind "vibes"/);
  assert.match(judgeEdges([], { not: "a list" }).malformed[0], /not a JSON array/);
});

test("counts by disposition are the hand count", () => {
  const entries = [
    { ...ENTRY }, { ...ENTRY, to: "b" }, { ...ENTRY, direction: "in" as const, disposition: "owned-by:#2613" },
    { ...ENTRY, direction: "in" as const, disposition: "travels" }, { ...ENTRY, direction: "in" as const, disposition: "by-name" },
  ];
  assert.deepEqual(countByDisposition(entries), { "out:owned-by": 2, "in:owned-by": 1, "in:travels": 1, "in:by-name": 1 });
});

// ------------------------------------------------------------------ the real tree

test("the real tree agrees with the committed baseline: no new edge, no stale entry, every entry well-formed", () => {
  const baseline = readBaseline(ROOT);
  const verdict = judgeEdges(findEdges({ root: ROOT, tracked: trackedFiles(ROOT) }), baseline);
  assert.deepEqual(describeVerdict(verdict), []);
});

test("the real baseline is NON-EMPTY and records the deploy path, so a guard that found nothing is not read as a fenced layer", () => {
  const baseline = readBaseline(ROOT);
  assert.ok(existsSync(join(ROOT, BASELINE_PATH)));
  assert.ok(baseline.length > 0, "the baseline is empty: the scan or the baseline has broken");
  const froms: string[] = baseline.map((e: { from: string }) => e.from);
  assert.ok(froms.includes("packages/nvda-worker/src/run-capture-check.cmd"), "the launcher that runs on the worker is recorded");
  assert.ok(froms.some((f) => f.startsWith("packages/control/ansible/")), "the Ansible files that place it are recorded");
  assert.ok(froms.some((f) => f.startsWith("packages/worker-fleet/src/")), "the fleet's own reaches are recorded");
});

test("done-when 1: no file inside a layer reaches out by path unless a named row owns the edge", () => {
  const out = readBaseline(ROOT).filter((e: { direction: string }) => e.direction === "out");
  assert.ok(out.length > 0, "POSITIVE CONTROL: the launchers are recorded as leaving edges, so this loop has entries to refuse");
  for (const entry of out) {
    assert.match(entry.disposition, /^owned-by:#\d+$/, `${entry.from} -> ${entry.to} leaves a layer and is owned by no row`);
    assert.ok(LAYER_PACKAGES.includes(packageOf(entry.from) ?? ""), `${entry.from} is not inside a layer, so it is not an out entry`);
  }
});

// ------------------------------------------------------------------ the command

test("`--check` exits 0 over the real tree, and non-zero, naming both ends, over a tree with a new edge", () => {
  const real = cli("--check");
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /baseline agrees/);
  assert.equal(cli("--check", `--root=${fixture("clean")}`).status, 0, "CONTROL: a clean tree is not refused");
  const crossing = cli("--check", `--root=${fixture("imports-across")}`);
  assert.equal(crossing.status, 1);
  assert.match(crossing.stderr, /NEW EDGE out: packages\/nvda-worker\/src\/x\.mjs -> packages\/other\/src\/x\.mjs/);
});

test("`--check` over a tree whose only baseline entry names an edge that is gone exits non-zero as STALE", () => {
  const baseline = JSON.parse(readFileSync(join(fixture("stale-baseline"), BASELINE_PATH), "utf8"));
  assert.equal(baseline.length, 1, "POSITIVE CONTROL: the fixture's baseline names an edge");
  assert.deepEqual(edgesOf("stale-baseline"), [], "and the fixture's tree no longer has it");
  const stale = cli("--check", `--root=${fixture("stale-baseline")}`);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /STALE ENTRY: packages\/nvda-worker\/src\/x\.mjs -> packages\/other\/src\/x\.mjs/);
});

test("a mistyped flag is refused rather than run as the default, and no mode is a usage error", () => {
  assert.notEqual(cli("--chek").status, 0, "an unknown flag must not run the default and report success");
  assert.equal(cli().status, 2, "no mode is a usage error, not a pass");
});
