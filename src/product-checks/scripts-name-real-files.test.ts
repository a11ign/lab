/**
 * EVERY SCRIPT IN THIS REPOSITORY'S `package.json` RUNS A PROGRAM THAT EXISTS IN IT.
 *
 * ADR 0045 cut 1 (a11ign#5078) gave the lab the 70 scripts the core's `package.json` ran against it, with
 * targets relative to the lab's root. A script whose target is a path that does not exist reads as a command and
 * fails only when someone runs it on the lab host, which is the worst time to learn the path was wrong.
 *
 * A target is a token that names a `.ts`, `.mjs` or `.py` file. `node_modules/` paths are the installed
 * packages' (they exist after an install, not in the tree) and `runs/` paths are the corpus, which a script
 * writes or reads and the tree does not hold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_ROOT } from "./lab-sources.ts";

/** The 70 scripts moved here name well over this many program files; fewer found means the matcher went blind. */
const MIN_PROGRAM_TARGETS = 60;

const PROGRAM = /(?:^|[\s=])([A-Za-z0-9_.][A-Za-z0-9_./-]*\.(?:ts|mjs|py))(?=\s|$)/g;

/** The program files `command` names that should be in the tree, in the order written. */
function targetsOf(command: string): string[] {
  return [...command.matchAll(PROGRAM)].map((m) => m[1])
    .filter((path) => !path.startsWith("node_modules/") && !path.startsWith("runs/") && !path.startsWith("/"));
}

/** `script -> target` for every target of `scripts` that is not a file under `root`. */
function missingTargets(scripts: Record<string, string>, root: string, exists: (path: string) => boolean = existsSync): string[] {
  return Object.entries(scripts).flatMap(([name, command]) =>
    targetsOf(command).filter((path) => !exists(join(root, path))).map((path) => `${name} -> ${path}`));
}

const scripts = (): Record<string, string> =>
  (JSON.parse(readFileSync(join(LAB_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

test("every script names target files that exist in the tree", () => {
  const all = scripts();
  const programs = Object.values(all).flatMap(targetsOf);
  // The population control: a matcher that went blind, or a manifest read as empty, would pass the next line.
  assert.ok(programs.length >= MIN_PROGRAM_TARGETS, `only ${programs.length} program targets found across ${Object.keys(all).length} scripts`);
  assert.deepEqual(missingTargets(all, LAB_ROOT), []);
});

test("the four scripts the row's acceptance names are present", () => {
  const all = scripts();
  for (const name of ["docs:coverage", "training:preflight", "rules:gate", "corpus:release"]) {
    assert.ok(name in all, `${name} is not a script of this repository`);
  }
});

test("a script naming a missing file is reported by name", () => {
  const found = missingTargets({ ok: "node scripts/here.ts", gone: "tsx src/not-here.mjs --flag", venv: "A11Y_PYTHON=.venv/bin/python node scripts/here.ts" },
    "/fixture", (path) => path.endsWith("scripts/here.ts"));
  assert.deepEqual(found, ["gone -> src/not-here.mjs"]);
});

test("a command that names no program yields no target, and an installed package path is not one", () => {
  assert.deepEqual(targetsOf("changeset"), []);
  assert.deepEqual(targetsOf("node node_modules/@a11ign/toolchain/dist/layout-check.mjs"), []);
  assert.deepEqual(targetsOf("pnpm run --silent corpus:unclosable-map && .venv/bin/python scripts/x.py --data runs/a/b.jsonl"), ["scripts/x.py"]);
});
