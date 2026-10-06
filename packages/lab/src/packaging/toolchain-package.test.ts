/**
 * #3625, ROW 5 OF ADR 0043 (#3550): `@a11ign/toolchain` is taken BY VERSION from the registry, and `packages/toolchain/` is gone from this repository.
 * #3578 (row 4-0) put the package here and moved it to `a11ign/toolchain`, whose own tests pin its manifest, its entries helper and its base; this file
 * kept only what is still a fact ABOUT THIS REPOSITORY. Each is pinned with a positive control, because an assertion that something is absent passes on an
 * empty population (`.claude/rules/guards-and-assertions.md`):
 *
 * 1. THE DEPENDENCY. The root, `lab` (its tests import the package) and the three packages that build with the presets pin one exact version, and `pnpm-lock.yaml` resolves it from the registry
 *    (`pnpm-workspace.test.ts` pins the same edges as not `link:`). Control: a manifest range, a second version, or a `link:` is RED.
 * 2. THE OLD HOME IS GONE. `packages/toolchain/` holds no manifest and no source (the row's own Acceptance reads git for the tracked listing). Control: the same read finds the thin config.
 * 3. THE BASE. The root base extends the INSTALLED package's, and carries none of `composite`, `outDir`, `rootDir` (row 4c-a11ign, #3580, deleted the
 *    references that needed them). Control: a base that carries `composite` is RED.
 * 4. THE PEERS. `@rstest/core` and `@rslib/core` are peers of the installed package and devDependencies of the root, with ranges that include the versions
 *    `pnpm-lock.yaml` resolved. Control: a range that excludes the locked version is RED.
 * 5. THE THIN CONFIG. `scripts/rstest/rstest.config.mjs` holds no run-record, reporter or alias logic and imports the package by NAME, and the four files
 *    that moved are gone from `scripts/rstest/`. Control: the old body's own lines are RED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { satisfies } from "../../../guards/src/isolation-gate.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const NAME = "@a11ign/toolchain";

type Manifest = {
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type Lock = { importers: Record<string, { devDependencies?: Record<string, { specifier: string; version: string }> }> };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const lock = parseYaml(readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8")) as Lock;
const installed = readJson<Manifest & { version: string }>(join(REPO, "node_modules", NAME, "package.json"));

/** A tsconfig's own `compilerOptions`, comments allowed, WITHOUT following `extends`: what this file itself says. */
function ownCompilerOptions(path: string): Record<string, unknown> {
  const { config, error } = ts.readConfigFile(path, (file) => readFileSync(file, "utf8"));
  assert.equal(error, undefined, `${path} does not parse`);
  return (config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
}

// 1. THE DEPENDENCY -------------------------------------------------------------------------------------------------------------

/** Every importer that declares the package, as the lockfile records it. The packages build with its presets, `lab`'s tests import it, and the root runs its test config. */
const CONSUMERS = [".", "packages/cli", "packages/judge", "packages/lab", "packages/scorer"];

/** What is wrong with the way a set of importers takes the package: one exact registry version, the same everywhere, and never a link. */
function dependencyProblems(consumers: Record<string, { specifier: string; version: string } | undefined>): string[] {
  const entries = Object.entries(consumers);
  const versions = new Set(entries.map(([, dep]) => dep?.specifier));
  return [
    ...entries.filter(([, dep]) => dep === undefined).map(([importer]) => `${importer} does not declare ${NAME}`),
    ...entries.filter(([, dep]) => dep !== undefined && !/^\d+\.\d+\.\d+$/.test(dep.specifier)).map(([importer]) => `${importer} does not pin an exact version`),
    ...entries.filter(([, dep]) => dep?.version.startsWith("link:")).map(([importer]) => `${importer} resolves ${NAME} to a workspace link`),
    ...(versions.size > 1 ? [`the importers pin ${versions.size} different versions`] : []),
  ];
}

const lockedConsumers = () => Object.fromEntries(CONSUMERS.map((importer) => [importer, lock.importers[importer].devDependencies?.[NAME]]));

test("the root, lab and the three building packages pin one exact registry version of the toolchain, and the lockfile resolves it without a link", () => {
  assert.equal(CONSUMERS.length, 5, "the positive control for the loop below: five importers are read");
  assert.deepEqual(dependencyProblems(lockedConsumers()), []);
  for (const importer of CONSUMERS) {
    const manifest = readJson<Manifest>(join(REPO, importer === "." ? "package.json" : `${importer}/package.json`));
    assert.equal(manifest.devDependencies?.[NAME], lock.importers[importer].devDependencies?.[NAME]?.specifier, `${importer}'s manifest and lockfile disagree`);
  }
  assert.ok(installed.version.length > 0 && lockedConsumers()["."]?.version.startsWith(installed.version), "the installed copy is not the version the lockfile resolved");
});

test("control: a range, a second version, a link and a missing declaration are each RED", () => {
  const sound = { a: { specifier: "0.1.2", version: "0.1.2(peers)" }, b: { specifier: "0.1.2", version: "0.1.2(peers)" } };
  assert.deepEqual(dependencyProblems(sound), []);
  assert.deepEqual(dependencyProblems({ ...sound, a: { specifier: "^0.1.2", version: "0.1.2" } }), ["a does not pin an exact version", "the importers pin 2 different versions"]);
  assert.deepEqual(dependencyProblems({ ...sound, a: { specifier: "0.1.3", version: "0.1.3" } }), ["the importers pin 2 different versions"]);
  assert.deepEqual(dependencyProblems({ ...sound, a: { specifier: "0.1.2", version: "link:../toolchain" } }), ["a resolves @a11ign/toolchain to a workspace link"]);
  assert.deepEqual(dependencyProblems({ ...sound, a: undefined }), ["a does not declare @a11ign/toolchain", "the importers pin 2 different versions"]);
});

// 2. THE OLD HOME IS GONE -------------------------------------------------------------------------------------------------------

test("the package has no manifest under packages/toolchain/, and the same read finds one where a package lives", () => {
  assert.ok(existsSync(join(REPO, "scripts/rstest/rstest.config.mjs")), "the positive control: the same read finds a file that is in the tree");
  assert.equal(existsSync(join(REPO, "packages/toolchain/package.json")), false);
  assert.equal(existsSync(join(REPO, "packages/toolchain/src")), false);
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

test("the root base extends the installed package's and carries none of composite, outDir or rootDir", () => {
  const root = ownCompilerOptions(join(REPO, "tsconfig.base.json"));
  assert.deepEqual(baseProblems({ ...root, declarationMap: false, sourceMap: false }), [], "the root base carries an emit setting: nothing here builds with `tsc` any more (row 4c-a11ign)");
  const rootConfig = ts.readConfigFile(join(REPO, "tsconfig.base.json"), (file) => readFileSync(file, "utf8")).config as { extends?: string };
  assert.equal(rootConfig.extends, `${NAME}/tsconfig.base.json`, "the root base does not extend the installed package's");
  assert.deepEqual(baseProblems(ownCompilerOptions(join(REPO, "node_modules", NAME, "tsconfig.base.json"))), [], "the installed package's own base is not one a published package can extend");
});

test("control: a base that carries composite is RED, and so is one with declarationMap on", () => {
  const sound = { declarationMap: false, sourceMap: false };
  assert.deepEqual(baseProblems(sound), []);
  assert.deepEqual(baseProblems({ ...sound, composite: true }), ["composite is set"]);
  assert.deepEqual(baseProblems({ ...sound, declarationMap: true }), ["declarationMap is not false"]);
});

// 4. THE PEERS ------------------------------------------------------------------------------------------------------------------

const PEERS = ["@rstest/core", "@rslib/core"];

/** The version `pnpm-lock.yaml` resolved for a root devDependency, without its peer suffix. */
function lockedVersion(name: string): string {
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

test("@rstest/core and @rslib/core are peers of the installed package and root devDependencies, with ranges that include the locked versions", () => {
  assert.deepEqual(peerProblems(installed, readJson<Manifest>(join(REPO, "package.json")), lockedVersion), []);
});

test("control: a range that excludes the locked version is RED, and so is a dependency the root does not hold", () => {
  const root = readJson<Manifest>(join(REPO, "package.json"));
  const narrowed = { ...installed, peerDependencies: { ...installed.peerDependencies, "@rstest/core": "^0.11.0" } };
  assert.equal(peerProblems(narrowed, root, lockedVersion).length, 1);
  const rootWithout = { ...root, devDependencies: { ...root.devDependencies, "@rslib/core": undefined as unknown as string } };
  assert.deepEqual(peerProblems(installed, rootWithout, lockedVersion), ["@rslib/core is not a root devDependency"]);
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

test("the thin config at the old path contains no run-record, reporter or alias logic, and imports the package by name", () => {
  const source = readFileSync(join(REPO, "scripts/rstest/rstest.config.mjs"), "utf8");
  assert.deepEqual(logicIn(source), []);
  assert.match(source, /from "@a11ign\/toolchain\/rstest-config"/, "the thin config does not import the installed package");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /packages\/toolchain/, "the thin config still reads the old path in code");
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
