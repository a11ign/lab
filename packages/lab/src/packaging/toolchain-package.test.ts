/**
 * #3578, ROW 4-0 OF ADR 0043: `@a11ign/toolchain` is a package, and a11ign's own test config is a thin call into it.
 *
 * Five things are pinned, and each has a positive control in this file, because an assertion that something is absent passes
 * on an empty population (`.claude/rules/guards-and-assertions.md`):
 *
 * 1. THE MANIFEST. Every file a worker loads by path, the base, the presets and the entries helper are in `exports`, and `files`
 *    ships no `src/`. A worker loads the alias hook by `--import <path>` out of `node_modules`, where Node refuses to strip types,
 *    so a file loaded by path is a BUILT entry. Control: a manifest with `src` in `files` is RED.
 * 2. THE ENTRIES HELPER. One entry per built `exports` key, in both directions. Control: a fixture package with a subpath that has
 *    no entry is RED, and so is one with an entry that has no subpath.
 * 3. THE BASE. The package's `tsconfig.base.json` turns `declarationMap` and `sourceMap` off and carries no `composite`, `outDir`
 *    or `rootDir`; a11ign's root base still carries those three. Control: a base that carries `composite` is RED.
 * 4. THE PEERS. `@rstest/core` and `@rslib/core` are peers of the package and devDependencies of the root, with ranges that include
 *    the versions `pnpm-lock.yaml` resolved. Control: a range that excludes the locked version is RED.
 * 5. THE THIN CONFIG. `scripts/rstest/rstest.config.mjs` holds no run-record, reporter or alias logic, and the four files that moved
 *    are gone from `scripts/rstest/`, so a copy left beside the package cannot pass. Control: the old body's own lines are RED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { satisfies } from "../../../guards/src/isolation-gate.mjs";
import { entriesFromExports, entryProblems, type PackageExports } from "../../../toolchain/src/entries.ts";
import { libraryPreset } from "../../../toolchain/src/rslib-presets.ts";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGE = join(REPO, "packages/toolchain");

type Manifest = PackageExports & {
  files?: string[];
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const manifest = readJson<Manifest>(join(PACKAGE, "package.json"));

/** A tsconfig's own `compilerOptions`, comments allowed, WITHOUT following `extends`: what this file itself says. */
function ownCompilerOptions(path: string): Record<string, unknown> {
  const { config, error } = ts.readConfigFile(path, (file) => readFileSync(file, "utf8"));
  assert.equal(error, undefined, `${path} does not parse`);
  return (config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
}

// 1. THE MANIFEST ---------------------------------------------------------------------------------------------------------------

/** The `exports` subpaths a consumer needs, by name: what a worker loads by path, the base, the presets and the helper. */
const REQUIRED_SUBPATHS = [
  "./rstest-config", "./verdict-reporter", "./node-test-shim", "./register-node-test-alias", "./merge-child-coverage",
  "./entries", "./rslib-presets", "./tsconfig.base.json",
];

/** What is wrong with a manifest as a package that ships no source. Empty is agreement. */
function manifestProblems(pkg: Manifest): string[] {
  const exported = Object.keys(pkg.exports ?? {});
  const missing = REQUIRED_SUBPATHS.filter((subpath) => !exported.includes(subpath)).map((subpath) => `exports has no ${subpath}`);
  const shipsSource = (pkg.files ?? []).filter((entry) => entry === "src" || entry.startsWith("src/")).map((entry) => `files ships ${entry}`);
  return [...missing, ...shipsSource];
}

test("the package's exports name each file a worker loads by path, the base, the presets and the helper, and its files ship no src/", () => {
  assert.deepEqual(manifestProblems(manifest), []);
  assert.ok(Object.keys(manifest.exports ?? {}).length >= REQUIRED_SUBPATHS.length, "the manifest exports nothing, so the check above proved nothing");
});

test("control: a manifest with src in files is RED, and so is one missing the hook", () => {
  assert.deepEqual(manifestProblems({ ...manifest, files: [...(manifest.files ?? []), "src"] }), ["files ships src"]);
  const withoutHook = Object.fromEntries(Object.entries(manifest.exports ?? {}).filter(([subpath]) => subpath !== "./register-node-test-alias"));
  assert.deepEqual(manifestProblems({ ...manifest, exports: withoutHook }), ["exports has no ./register-node-test-alias"]);
});

// 2. THE ENTRIES HELPER ---------------------------------------------------------------------------------------------------------

/** The entries the package builds today (its seven built `exports` keys): the positive control that the comparison below is not over nothing. */
const BUILT_ENTRY_FLOOR = 7;

/** A throwaway package on disk: `sources` are the files under `src/`, `exports` its map. */
function fixturePackage(sources: string[], exports: PackageExports["exports"]): { dir: string; pkg: PackageExports } {
  const dir = mkdtempSync(join(tmpdir(), "toolchain-entries-"));
  mkdirSync(join(dir, "src"));
  for (const source of sources) writeFileSync(join(dir, "src", source), "export {};\n");
  return { dir, pkg: { exports } };
}

test("the entries helper gives one entry per exports key of the real package, in both directions", () => {
  const entries = entriesFromExports(manifest, { dir: PACKAGE });
  assert.deepEqual(entryProblems(manifest, entries), []);
  // `./tsconfig.base.json` is shipped as it is and is not built, so it has no entry.
  const built = Object.keys(manifest.exports ?? {}).filter((subpath) => subpath !== "./tsconfig.base.json");
  assert.equal(Object.keys(entries).length, built.length);
  assert.ok(built.length >= BUILT_ENTRY_FLOOR, `the package builds fewer than ${BUILT_ENTRY_FLOOR} entries, so the count above is not the population`);
  assert.deepEqual(libraryPreset(manifest, { dir: PACKAGE }).lib[0].source.entry, entries, "the preset hands Rslib other entries than the helper made");
});

test("control: a fixture with a subpath that has no entry is RED, and one with an entry that has no subpath is RED", () => {
  const { dir, pkg } = fixturePackage(["index.ts", "verify.ts"], {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
    "./verify": { types: "./dist/verify.d.ts", default: "./dist/verify.mjs" },
    "./package.json": "./package.json",
  });
  try {
    const entries = entriesFromExports(pkg, { dir });
    assert.deepEqual(Object.keys(entries).sort(), ["index", "verify"], "a plain file target such as ./package.json is not an entry");
    assert.deepEqual(entryProblems(pkg, entries), []);
    const withoutVerify = Object.fromEntries(Object.entries(entries).filter(([name]) => name !== "verify"));
    assert.deepEqual(entryProblems(pkg, withoutVerify), ['exports "./verify" builds "verify", which has no entry']);
    assert.deepEqual(entryProblems(pkg, { ...entries, extra: "./src/extra.ts" }), ['entry "extra" is built but no exports subpath points at it']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the helper refuses an exports key with no source file, rather than building nothing", () => {
  const { dir, pkg } = fixturePackage(["index.ts"], {
    ".": "./dist/index.mjs",
    "./forgotten": "./dist/forgotten.mjs",
  });
  try {
    assert.throws(() => entriesFromExports(pkg, { dir }), /no source for entry "forgotten"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a source may be .mjs beside the .ts ones, the first extension that exists wins, and a nested target keeps its path", () => {
  const { dir, pkg } = fixturePackage(["hook.mjs", "both.ts", "both.mjs"], {
    "./hook": "./dist/hook.mjs",
    "./both": "./dist/both.mjs",
  });
  try {
    assert.deepEqual(entriesFromExports(pkg, { dir }), { hook: "./src/hook.mjs", both: "./src/both.ts" });
    const nested = fixturePackage([], { "./deep/leaf": "./dist/deep/leaf.mjs" });
    mkdirSync(join(nested.dir, "src", "deep"));
    writeFileSync(join(nested.dir, "src", "deep", "leaf.ts"), "export {};\n");
    try {
      assert.deepEqual(entriesFromExports(nested.pkg, { dir: nested.dir }), { "deep/leaf": "./src/deep/leaf.ts" });
    } finally {
      rmSync(nested.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 3. THE BASE -------------------------------------------------------------------------------------------------------------------

const PUBLISHED_ONLY_OFF = ["declarationMap", "sourceMap"];
const REFERENCES_ONLY = ["composite", "outDir", "rootDir"];

/** What a package's own base says that a PUBLISHED package must not. */
function baseProblems(options: Record<string, unknown>): string[] {
  const on = PUBLISHED_ONLY_OFF.filter((key) => options[key] !== false).map((key) => `${key} is not false`);
  const references = REFERENCES_ONLY.filter((key) => key in options).map((key) => `${key} is set`);
  return [...on, ...references];
}

test("the package's base turns declarationMap and sourceMap off and carries no composite, outDir or rootDir; the root base still carries the three", () => {
  assert.deepEqual(baseProblems(ownCompilerOptions(join(PACKAGE, "tsconfig.base.json"))), []);
  const root = ownCompilerOptions(join(REPO, "tsconfig.base.json"));
  for (const key of REFERENCES_ONLY) assert.ok(key in root, `the root base lost ${key}, which a11ign's project references still need until row 4c-a11ign`);
  const rootConfig = ts.readConfigFile(join(REPO, "tsconfig.base.json"), (file) => readFileSync(file, "utf8")).config as { extends?: string };
  assert.equal(rootConfig.extends, "./packages/toolchain/tsconfig.base.json", "the root base does not extend the package's");
});

test("control: a base that carries composite is RED, and so is one with declarationMap on", () => {
  const sound = ownCompilerOptions(join(PACKAGE, "tsconfig.base.json"));
  assert.deepEqual(baseProblems({ ...sound, composite: true }), ["composite is set"]);
  assert.deepEqual(baseProblems({ ...sound, declarationMap: true }), ["declarationMap is not false"]);
});

// 4. THE PEERS ------------------------------------------------------------------------------------------------------------------

const PEERS = ["@rstest/core", "@rslib/core"];

/** The version `pnpm-lock.yaml` resolved for a root devDependency, without its peer suffix. */
function lockedVersion(name: string): string {
  const lock = parseYaml(readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8")) as {
    importers: Record<string, { devDependencies?: Record<string, { version: string }> }>;
  };
  const locked = lock.importers["."].devDependencies?.[name]?.version;
  assert.ok(locked, `${name} is not a root devDependency in pnpm-lock.yaml`);
  return locked.split("(")[0];
}

/** What is wrong between the package's peer ranges, the root's devDependencies and the locked versions. */
function peerProblems(pkg: Manifest, root: Manifest, locked: (name: string) => string): string[] {
  return PEERS.flatMap((name) => {
    const range = pkg.peerDependencies?.[name];
    if (range === undefined) return [`${name} is not a peerDependency`];
    const problems = root.devDependencies?.[name] === undefined ? [`${name} is not a root devDependency`] : [];
    return satisfies(locked(name), range) === true ? problems : [...problems, `${name} ${range} does not include the locked ${locked(name)}`];
  });
}

test("@rstest/core and @rslib/core are peers of the package and root devDependencies, with ranges that include the locked versions", () => {
  assert.deepEqual(peerProblems(manifest, readJson<Manifest>(join(REPO, "package.json")), lockedVersion), []);
});

test("control: a range that excludes the locked version is RED, and so is a dependency the root does not hold", () => {
  const root = readJson<Manifest>(join(REPO, "package.json"));
  const narrowed = { ...manifest, peerDependencies: { ...manifest.peerDependencies, "@rstest/core": "^0.11.0" } };
  assert.equal(peerProblems(narrowed, root, lockedVersion).length, 1);
  const rootWithout = { ...root, devDependencies: { ...root.devDependencies, "@rslib/core": undefined as unknown as string } };
  assert.deepEqual(peerProblems(manifest, rootWithout, lockedVersion), ["@rslib/core is not a root devDependency"]);
});

// 5. THE THIN CONFIG ------------------------------------------------------------------------------------------------------------

/** What the thin config would hold if it still carried the logic the package owns: each marker is something only that logic writes. */
const LOGIC_MARKERS: [string, RegExp][] = [
  ["a reporter list", /\breporters\s*:/],
  ["the verdict reporter", /createVerdictReporter|verdict-reporter/],
  ["the run record", /rstest-run-records|outputPath/],
  ["the alias hook", /register-node-test-alias|registerHooks/],
  ["a worker import", /["']--import["']/],
  ["the CI switch", /\bisCi\b|process\.env\.CI\b/],
];

/** The logic markers in a config's source, comments removed (a header may NAME the logic it no longer holds). */
function logicIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return LOGIC_MARKERS.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
}

test("the thin config at the old path contains no run-record, reporter or alias logic, and calls the package's source", () => {
  const source = readFileSync(join(REPO, "scripts/rstest/rstest.config.mjs"), "utf8");
  assert.deepEqual(logicIn(source), []);
  assert.match(source, /from "\.\.\/\.\.\/packages\/toolchain\/src\/rstest-config\.mjs"/, "the thin config does not import the package's source by relative path");
  assert.doesNotMatch(source, /@a11ign\/toolchain["']/, "a specifier that resolves to the package's dist turns a fresh tree red until it is built");
});

test("the four other files are gone from scripts/rstest/, so a copy beside the package cannot pass", () => {
  assert.deepEqual(readdirSync(join(REPO, "scripts/rstest")), ["rstest.config.mjs"]);
});

test("control: the old config body's own lines are RED", () => {
  const oldBody = [
    'const registerHook = fileURLToPath(new URL("./register-node-test-alias.mjs", import.meta.url));',
    'function isCi(env) { return env.CI !== undefined && env.CI !== "" && env.CI !== "false"; }',
    'const record = run.env.RSTEST_WORKER_ID ? [] : [["json", { outputPath: runRecordPathFor(run) }]];',
    'pool: { type: "forks", execArgv: ["--import", registerHook, "--import", walkScope] },',
    'reporters: reportersFor({ root, env: process.env, now: new Date(), pid: process.pid }),',
    'const verdict = agent ? [createVerdictReporter({ hint })] : [];',
  ].join("\n");
  assert.deepEqual(logicIn(oldBody).sort(),
    ["a reporter list", "a worker import", "the CI switch", "the alias hook", "the run record", "the verdict reporter"].sort());
  assert.deepEqual(logicIn("/* reporters: the header may say so */\n// registerHooks too\nexport default {};\n"), [],
    "a comment that names the logic is not the logic");
});
