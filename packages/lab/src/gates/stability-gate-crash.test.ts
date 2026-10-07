/**
 * a11ign/a11ign#3977: THE STABILITY GATE EXITS THROUGH `crashVerdict` WHEN ITS HARNESS THROWS, AND ITS PAGE SERVER NEEDS NO
 * WORKSPACE PROJECT.
 *
 * Both are WIRING in scripts whose import closure reaches the corpus (`dataset-paths.mjs`), so, as in
 * `stability-gate-keeps-variants.test.ts`, the wiring is read from SOURCE and the readers are proved able to fail.
 * `verdict.test.ts` drives `crashVerdict` itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/stability-gate.mjs");
const PAGE_SERVER = resolve(import.meta.dirname, "../training/page-server.mjs");

/** The entry line: `main` runs only when the file is the entry point, and a rejection from it must reach `exitOnCrash`. */
function mainIsGuardedByCrashExit(source: string): boolean {
  const entry = source.split("\n").find((line) => line.includes("import.meta.url === pathToFileURL"));
  return Boolean(entry && /await main\(\)\.catch\(exitOnCrash\)/.test(entry));
}

/** `exitOnCrash` must go through `crashVerdict` and `exitCodeFor`, never a literal exit code that could drift to 1. */
function crashExitUsesTheVerdict(source: string): boolean {
  const body = /function exitOnCrash\([^)]*\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  return /crashVerdict\(/.test(body) && /process\.exit\(exitCodeFor\(verdict\)\)/.test(body);
}

/** The arguments `leasePageServer` hands to pnpm: the array literal in the `pnpmCliInvocation(` call. */
function spawnedPnpmArgs(source: string): string {
  return /pnpmCliInvocation\((\[[^\]]*\])\)/.exec(source)?.[1] ?? "";
}

test("#3977 the gate's entry point turns a throw from main into the crash exit, not Node's exit 1", () => {
  assert.ok(mainIsGuardedByCrashExit(readFileSync(SCRIPT, "utf8")));
  assert.ok(crashExitUsesTheVerdict(readFileSync(SCRIPT, "utf8")));
});

test("#3977 negative control: the readers notice the bare entry line and a hardcoded exit", () => {
  const bare = 'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();';
  assert.equal(mainIsGuardedByCrashExit(bare), false);
  const hardcoded = "function exitOnCrash(error) {\n  console.error(error);\n  crashVerdict(\"g\", error);\n  process.exit(1);\n}";
  assert.equal(crashExitUsesTheVerdict(hardcoded), false);
});

test("#3977 the page server is started with `pnpm exec serve`, which needs no `@a11ign/lab` workspace project", () => {
  const args = spawnedPnpmArgs(readFileSync(PAGE_SERVER, "utf8"));
  assert.match(args, /^\["exec", "serve",/, `found: ${args}`);
  assert.doesNotMatch(args, /--filter/, "a filter matches only a workspace project, and a laid lab has none");
});

test("#3977 negative control: the reader notices the filtered spawn that failed on the lab", () => {
  const filtered = 'const pnpm = pnpmCliInvocation(["--filter", "@a11ign/lab", "exec", "serve", resolve(root)]);';
  assert.match(spawnedPnpmArgs(filtered), /--filter/);
  assert.equal(spawnedPnpmArgs("nothing here"), "", "no call found is an empty reading, which the positive test above refuses");
});
