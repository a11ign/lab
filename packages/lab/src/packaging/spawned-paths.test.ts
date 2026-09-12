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

/**
 * #1149: A FILE THAT SPAWNS NOTHING CANNOT SPAWN A PROGRAM BY A BAD PATH.
 *
 * The check above is a text search for a path-shaped literal, and its title is a claim about SPAWNING --
 * so it read `packages/lab/nightly/tenants.mjs`, a frozen manifest of test-file names compared against a
 * `globSync` walk, as two spawn sites. Nothing in that file executes anything. Same shape as #1185:
 * a rule named for a call, implemented as a match on a name.
 *
 * All three offenders this guard was written for (`stability-gate.mjs`, `normalise-fleet.mjs`,
 * `compare-layers.mjs`) are spawn sites by definition, so the narrowing costs none of them. The control
 * test below drives the SAME predicate over a source that spawns a repo-relative literal and one that
 * merely names it, because a narrowing whose only measured effect is to exempt the file that prompted it
 * is a rule fitted to its instance until something shows it still refuses.
 */
const SPAWNS = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;

/** 44 of 211 scanned files spawn something today (measured 2026-09-12); well under half of that is a
 *  broken pattern rather than a quiet week of deletions. */
const FEWEST_CREDIBLE_SPAWNERS = 20;

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

/** The whole verdict, over source text, so the tree walk and the control below share ONE implementation. */
function offendersInSource(source: string, label: string): string[] {
  const stripped = stripComments(source);
  if (!SPAWNS.test(stripped)) return [];
  return stripped.split("\n")
    .filter((line) => !COMPOSED.test(line))
    .flatMap((line) => (line.match(REPO_RELATIVE) ?? []).map((m) => `${label}: ${m}`));
}

test("no package spawns a program by a repo-relative path", () => {
  const files = sourceFiles(packagesDir);
  // Guard the guard: if the walk stopped finding files this would pass having examined nothing.
  assert.ok(files.length > 40, `the scan only found ${files.length} source files; it is broken`);

  const offendersIn = (file: string): string[] =>
    offendersInSource(readFileSync(file, "utf8"), relative(packagesDir, file));

  // Guard the SECOND population the narrowing introduced: if `SPAWNS` ever stops matching, every file is
  // exempt and this test passes having examined none of them -- the `files.length` control above cannot
  // see that, because the walk would still be finding files.
  const spawners = files.filter((file) => SPAWNS.test(stripComments(readFileSync(file, "utf8"))));
  assert.ok(spawners.length > FEWEST_CREDIBLE_SPAWNERS,
    `only ${spawners.length} of ${files.length} files read as spawning anything; the SPAWNS pattern is broken `
    + "and every path literal in the tree is now exempt");

  const offenders = files.flatMap(offendersIn);
  assert.deepEqual(offenders, [],
    `${offenders.length} repo-relative program path(s) — resolve them from import.meta.url:\n  `
    + offenders.join("\n  "));
});

/**
 * #1149 CONTROL: the narrowing above exempts files that spawn nothing, and on today's tree its ONLY
 * measured effect is to exempt the one file that prompted it -- 1 of 211 scanned, 44 of which spawn.
 * That measurement is exactly what a rule fitted to its own instance looks like, so the refusal is
 * asserted here directly rather than inferred from a green tree.
 *
 * The two sources differ in ONE respect: whether the literal is handed to `execFileSync`. Everything
 * else -- the path, the quoting, the extension -- is identical, so a pass on the second cannot be
 * coming from the path shape.
 */
test("#1149: a repo-relative literal is still refused when the file DOES spawn", () => {
  const spawns = [
    'import { execFileSync } from "node:child_process";',
    'execFileSync("node", ["src/training/repeat-capture.mjs"]);',
  ].join("\n");
  assert.deepEqual(offendersInSource(spawns, "fixture.mjs"),
    ['fixture.mjs: "src/training/repeat-capture.mjs"'],
    "the case this guard was written for -- `stability-gate.mjs` spawning the stability gate's own "
    + "program by a cwd guess -- must still be caught after the narrowing");
});

test("#1149: the same literal in a file that spawns nothing is NOT an offender", () => {
  const names = [
    'export const TENANTS = Object.freeze([',
    '  "src/training/repeat-capture.mjs",',
    ']);',
  ].join("\n");
  assert.deepEqual(offendersInSource(names, "fixture.mjs"), [],
    "a frozen list of file NAMES executes nothing; flagging it was the false positive #1149 hit");
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
