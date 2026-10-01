/**
 * NO ROOT LIFECYCLE SCRIPT NAMES A BARE `pnpm` (#2945, the follow-up to #2888).
 *
 * A Windows worker reaches pnpm as `corepack pnpm`; `Get-Command pnpm` is False there (#2299). So
 * `corepack pnpm install` installed correctly and then exited 1, because `prepare` ran `pnpm run build` and the
 * shell said `'pnpm' is not recognized`. Every lifecycle script runs on a box that has only `node` and
 * `corepack`, so one of them in command position naming `pnpm`, `npm` or `npx` is that defect again. The
 * remedy is a `node scripts/...` command, which reaches pnpm through `pnpmCliInvocation` (`npm_execpath` first).
 *
 * The lifecycle names are npm's and pnpm's: the install hooks, the publish/pack hooks, and the `pre`/`post`
 * of `prepare`. Same command-position read as `manifest-runs-pnpm.test.ts`, so `node scripts/pnpm-thing.mjs`
 * (a script ABOUT pnpm) passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BARE_PACKAGE_MANAGERS = new Set(["pnpm", "npm", "npx"]);
const LIFECYCLE_SCRIPTS = new Set([
  "preinstall", "install", "postinstall",
  "preprepare", "prepare", "postprepare",
  "prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postpublish",
]);

type Scripts = Record<string, string>;

/** Each simple command of a shell line, split on `&&`, `||`, `;`, `|`, `&`, newlines and subshell parens. */
function segmentsOf(line: string): string[] {
  return line.split(/&&|\|\||[;|&\n()]/).map((segment) => segment.trim()).filter(Boolean);
}

/** The program a segment runs: its first word once leading `VAR=value` assignments are skipped. */
function commandOf(segment: string): string | undefined {
  return segment.split(/\s+/).find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

/** The lifecycle scripts of a manifest, as `[name, value]`. */
function lifecycleScriptsOf(scripts: Scripts): Array<[string, string]> {
  return Object.entries(scripts).filter(([name]) => LIFECYCLE_SCRIPTS.has(name));
}

/** Every lifecycle script that runs a bare package manager as a command, as `name: command`. */
function bareCallers(scripts: Scripts): string[] {
  return lifecycleScriptsOf(scripts).flatMap(([name, value]) =>
    segmentsOf(value)
      .map(commandOf)
      .filter((command): command is string => command !== undefined && BARE_PACKAGE_MANAGERS.has(command))
      .map((command) => `${name}: ${command}`));
}

const rootScripts = (): Scripts =>
  (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Scripts }).scripts;

test("a fixture whose `prepare` runs `pnpm run build` is REFUSED, naming the script and `pnpm`", () => {
  assert.deepEqual(
    bareCallers({ prepare: "node scripts/install-git-hooks.mjs && pnpm run build" }),
    ["prepare: pnpm"]);
});

test("`npm` and `npx` are refused the same way, in any lifecycle script and after a `VAR=value` prefix", () => {
  assert.deepEqual(bareCallers({ postinstall: "FORCE_COLOR=1 npx patch-package", preinstall: "npm run x" }),
    ["postinstall: npx", "preinstall: npm"]);
});

test("a fixture whose `prepare` runs `node scripts/build-packages.mjs` passes", () => {
  assert.deepEqual(
    bareCallers({ prepare: "node scripts/install-git-hooks.mjs && node scripts/build-packages.mjs" }), []);
});

test("a script ABOUT pnpm passes, and so does a bare `pnpm` in a script that is not a lifecycle script", () => {
  assert.deepEqual(bareCallers({
    prepare: "node scripts/pnpm-doctor.mjs",
    build: "pnpm exec tsc --build",
    test: "pnpm run test:ts",
  }), []);
});

test("THE REAL ROOT MANIFEST has no bare package manager in any lifecycle script", () => {
  const scripts = rootScripts();
  // The positive control for the emptiness below: `prepare` exists today, so a renamed set or an emptied
  // population finds nothing and must not read as a pass.
  assert.ok(lifecycleScriptsOf(scripts).length >= 1, "no lifecycle script read from package.json -- the parse broke");
  assert.deepEqual(bareCallers(scripts), [],
    "a root lifecycle script names a bare `pnpm`/`npm`/`npx`; a worker has only `corepack pnpm`, so the install "
    + "exits 1 AFTER installing. Call `node scripts/...` instead (#2945)");
});
