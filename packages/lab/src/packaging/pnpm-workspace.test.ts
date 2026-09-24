/**
 * WHAT A pnpm INSTALL DOES IN A WORKTREE, PINNED (#2297, child 1 of #57).
 *
 * Two facts, each of which is a way for the migration to look done and not be:
 *
 *   - Internal dependencies are pinned `"0.0.0"`, not `workspace:*` (npm cannot read that protocol, and
 *     `package-lock.json` stays while the sibling rows land). pnpm resolves a bare version from the REGISTRY
 *     unless `linkWorkspacePackages` is on, so an install can succeed while every `@a11ign/*` import reads a
 *     downloaded copy -- the false green this migration exists to remove. Measured 2026-09-24: with the
 *     setting off, `pnpm import` went to the registry and stopped on a 404 for the unpublished
 *     `@a11ign/pdf`; a PUBLISHED package would have installed without complaint. So every internal entry in
 *     the lockfile must be a `link:`.
 *
 *   - Most worktrees on the agent host have `node_modules` as a symlink into the primary checkout, and pnpm
 *     follows it and rewrites what it points at (~21,000 entries changed in the measurement). `.pnpmfile.cjs`
 *     refuses first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface Importer { [section: string]: Record<string, { specifier: string; version: string }> | undefined }
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
/** Below this, the parse has broken rather than the repo having shrunk: it has dozens of internal edges. */
const MIN_INTERNAL_EDGES = 20;
const isInternal = (name: string) => name === "a11ign" || name.startsWith("@a11ign/");

/** Every internal dependency edge the lockfile records, as `importer -> name = version`. */
function internalEdges(): { edge: string; version: string }[] {
  const lock = parse(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")) as { importers: Record<string, Importer> };
  return Object.entries(lock.importers).flatMap(([importer, sections]) =>
    DEPENDENCY_SECTIONS.flatMap((section) => Object.entries(sections[section] ?? {})
      .filter(([name]) => isInternal(name))
      .map(([name, { version }]) => ({ edge: `${importer} -> ${name}`, version }))));
}

test("EVERY INTERNAL DEPENDENCY IN pnpm-lock.yaml IS A LINK, never a registry copy", () => {
  const edges = internalEdges();
  // The positive control for the emptiness below: a parse that found none would pass over nothing.
  assert.ok(edges.length >= MIN_INTERNAL_EDGES, `only ${edges.length} internal edges read from pnpm-lock.yaml -- the parse broke`);
  assert.deepEqual(edges.filter(({ version }) => !version.startsWith("link:")), [],
    "an @a11ign/* dependency resolved from the registry, not from packages/ -- check linkWorkspacePackages "
    + "in pnpm-workspace.yaml and that the pinned version matches the workspace package's own");
});

/** A directory holding a copy of the guard, with `node_modules` set up by `arrange`. */
function withGuardIn(arrange: (dir: string) => void): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "pnpmfile-guard-"));
  try {
    cpSync(join(ROOT, ".pnpmfile.cjs"), join(dir, ".pnpmfile.cjs"));
    arrange(dir);
    try {
      execFileSync(process.execPath, ["-e", `require(${JSON.stringify(join(dir, ".pnpmfile.cjs"))})`],
        { stdio: "pipe", encoding: "utf8" });
      return { code: 0, output: "" };
    } catch (refused) {
      const { status, stderr } = refused as { status: number; stderr: string };
      return { code: status, output: stderr };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(".pnpmfile.cjs REFUSES a symlinked node_modules, and names the remedy", () => {
  const { code, output } = withGuardIn((dir) => {
    const behind = join(dir, "behind");
    mkdirSync(behind);
    symlinkSync(behind, join(dir, "node_modules"));
  });
  assert.notEqual(code, 0);
  assert.match(output, /node_modules is a symlink to .*behind/);
  assert.match(output, /rm '.*node_modules'/);
});

test(".pnpmfile.cjs lets a REAL node_modules and an ABSENT one through -- the guard has a green state", () => {
  assert.equal(withGuardIn((dir) => mkdirSync(join(dir, "node_modules"))).code, 0);
  assert.equal(withGuardIn(() => undefined).code, 0);
});

test("yaml AND axe-core are hoisted to the root, because no manifest declares them and package-lock.json must not change", () => {
  const workspace = parse(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")) as { publicHoistPattern?: string[] };
  assert.deepEqual(workspace.publicHoistPattern, ["yaml", "axe-core"]);
  // The positive control: the hoist is what makes them resolvable, so they must be in pnpm's root layout.
  const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  assert.match(lock, /^ {2}yaml@2\.\d+\.\d+:/m);
  assert.match(lock, /^ {2}axe-core@\d+\.\d+\.\d+:/m);
});
