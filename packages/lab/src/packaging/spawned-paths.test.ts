/**
 * No package may name another program by a REPO-RELATIVE path.
 *
 * A literal like `"src/training/repeat-capture.mjs"` in a spawn is a guess about the caller's working
 * directory. It is right when the cwd happens to be the repo root and wrong everywhere else — and it goes
 * silently wrong the moment the file moves, because nothing type-checks a string.
 *
 * The package split found three of these, and the worst one mattered: `stability-gate.mjs` spawned
 * `src/training/repeat-capture.mjs`, so `gate:stability` — the check that must pass before any corpus run —
 * would have died with "Command failed" and nothing to read. It passed during M5 only because M8 had not moved
 * the pipeline yet. The other two were `normalise-fleet.mjs` (`scripts/guest-run.mjs`) and `compare-layers.mjs`
 * (`src/cli.ts`).
 *
 * The rule is simple enough to check mechanically: a program path is resolved from `import.meta.url`, or it is
 * a guess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const packagesDir = fileURLToPath(new URL("../../../../packages/", import.meta.url));

/** Anything that looks like a repo-relative path to a program. */
const REPO_RELATIVE = /"(?:src|scripts|packages)\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts|py|sh|ps1)"/g;

/** Composing a path from a resolved base is fine; only a bare literal is a cwd guess. */
const COMPOSED = /\b(?:join|resolve|readFileSync|existsSync|statSync|new URL)\s*\(/;

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "dist" || entry.name === "node_modules" ? [] : sourceFiles(full);
    if (!/\.(mjs|ts)$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    return [full];
  });
}

test("no package spawns a program by a repo-relative path", () => {
  const files = sourceFiles(packagesDir);
  // Guard the guard: if the walk stopped finding files this would pass having examined nothing.
  assert.ok(files.length > 40, `the scan only found ${files.length} source files; it is broken`);

  const offendersIn = (file: string): string[] =>
    stripComments(readFileSync(file, "utf8")).split("\n")
      .filter((line) => !COMPOSED.test(line))
      .flatMap((line) => (line.match(REPO_RELATIVE) ?? []).map((m) => `${relative(packagesDir, file)}: ${m}`));

  const offenders = files.flatMap(offendersIn);
  assert.deepEqual(offenders, [],
    `${offenders.length} repo-relative program path(s) — resolve them from import.meta.url:\n  `
    + offenders.join("\n  "));
});

test("every package ships a smoke test, or is private", () => {
  // The isolation gate skips private packages, so a package that is neither private nor smoke-tested is
  // invisible to it — the gate would report full coverage over a package it never installed.
  const missing = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const manifest = join(packagesDir, entry.name, "package.json");
      try { statSync(manifest); } catch { return false; }
      if (JSON.parse(readFileSync(manifest, "utf8")).private) return false;
      try { statSync(join(packagesDir, entry.name, "isolation-smoke.mjs")); return false; } catch { return true; }
    })
    .map((entry) => entry.name);
  assert.deepEqual(missing, [], `publishable package(s) with no isolation-smoke.mjs: ${missing.join(", ")}`);
});
