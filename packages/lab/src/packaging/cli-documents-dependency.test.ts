/**
 * #3125 (move 6 of #69): `cli` TAKES `@a11ign/documents` FROM THE REGISTRY, by a version range.
 *
 * `documents` publishes from `a11ign/documents` (ADR 0040, M5), so the monorepo's `a11ign` is installable only while it names a
 * version that repository released. Two files say so, and they can disagree: the MANIFEST (a range, not an exact pin and not
 * `workspace:`) and the LOCKFILE's `cli` importer (a registry version, not `link:`). The discriminator is the lockfile: `cli`
 * declared `0.1.0` exactly since #3347, which a workspace copy at `0.1.0` satisfies, and `linkWorkspacePackages: true`
 * (`pnpm-workspace.yaml`) links any range the workspace copy satisfies, so the manifest alone never showed the defect.
 *
 * WHERE IT IS DECLARED MOVED IN ROW 4c-a11ign (#3580): the CLI is a bundle that INLINES `@a11ign/documents` (and the `pdf-lib` behind it), so the
 * package is a `devDependency`: a consumer must not install 23 MB of `pdf-lib` for code the bundle already holds. The range and the registry
 * resolution below are unchanged, and `packages/cli/rslib.config.ts` is what makes a `devDependency` get bundled (`autoExternal` leaves only
 * `dependencies` external).
 *
 * Everything is read as TEXT or off the installed tree: this file must not import `cli.ts`, whose closure needs the `corpus`
 * capability the acceptance job lacks (the row's note of 2026-10-03).
 *
 * Each refusal is a function over text, driven against fixtures that break it (the positive control) before the real files are
 * read, so a pass over the real files is not "found nothing" over a parse that read nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PACKAGE = "@a11ign/documents";
const CLI_MANIFEST = "packages/cli/package.json";
const LOCKFILE = "pnpm-lock.yaml";
const CLI_IMPORTER = "packages/cli";
/** A caret or tilde range over a concrete version: not `0.1.0` (exact), not `workspace:^`, not `*`. */
const SEMVER_RANGE = /^[\^~]\d+\.\d+\.\d+$/;
/** The value imports, by file, that must resolve to the published package. */
const IMPORTS: readonly { file: string; names: readonly string[]; typeOnly: boolean }[] = [
  { file: "packages/cli/src/cli.ts", names: ["looksLikePdfUrl", "scanPdfTagTree"], typeOnly: false },
  { file: "packages/cli/src/report.ts", names: ["PdfFinding"], typeOnly: true },
];

interface Lockfile { importers: Record<string, { devDependencies?: Record<string, { specifier: string; version: string }> }> }

/** Why `cli`'s manifest does not declare the package by a range, or null when it does. */
function manifestRefusal(manifestText: string): string | null {
  const declared = (JSON.parse(manifestText) as { devDependencies?: Record<string, string> }).devDependencies?.[PACKAGE];
  if (declared === undefined) return `cli does not declare ${PACKAGE}`;
  if (declared.startsWith("workspace:")) return `cli declares ${PACKAGE} as ${declared}: the workspace protocol, not a published range`;
  if (!SEMVER_RANGE.test(declared)) return `cli declares ${PACKAGE} as "${declared}", which is not a ^ or ~ range over a version (an exact pin or "0.0.0" is the workspace's spelling)`;
  return null;
}

/** Why the lockfile's `cli` importer does not resolve the package from the registry, or null when it does. */
function lockfileRefusal(lockText: string, specifier: string): string | null {
  const entry = (parse(lockText) as Lockfile).importers[CLI_IMPORTER]?.devDependencies?.[PACKAGE];
  if (entry === undefined) return `the lockfile's ${CLI_IMPORTER} importer has no ${PACKAGE}`;
  if (entry.version.startsWith("link:")) return `cli resolves ${PACKAGE} to ${entry.version}: the workspace copy, never the registry`;
  if (entry.specifier !== specifier) return `the lockfile records specifier "${entry.specifier}" for cli and its manifest says "${specifier}": the lockfile is stale`;
  return null;
}

/** Why an import line does not name the published package for what it imports, or null when it does. */
function importRefusal(source: string, spec: { file: string; names: readonly string[]; typeOnly: boolean }): string | null {
  const line = source.split("\n").find((candidate) => candidate.includes(`from "${PACKAGE}"`));
  if (line === undefined) return `${spec.file} does not import from "${PACKAGE}"`;
  const missing = spec.names.filter((name) => !new RegExp(`\\b${name}\\b`).test(line));
  if (missing.length > 0) return `${spec.file} imports "${PACKAGE}" without ${missing.join(", ")}`;
  if (spec.typeOnly && !/^import type\b/.test(line)) return `${spec.file} imports ${spec.names.join(", ")} as a value, but it is a type`;
  return null;
}

// ---- positive controls: each refusal fires on the input that breaks it, and names `cli` ------------------------------------

const manifestWith = (range: string | undefined) => JSON.stringify({ devDependencies: range === undefined ? {} : { [PACKAGE]: range } });
const lockWith = (specifier: string, version: string) => `importers:\n  ${CLI_IMPORTER}:\n    devDependencies:\n      '${PACKAGE}':\n        specifier: ${specifier}\n        version: ${version}\n`;

test("control: a manifest declaring the workspace `0.0.0` is REFUSED, naming cli", () => {
  assert.match(manifestRefusal(manifestWith("0.0.0")) ?? "", /^cli declares @a11ign\/documents as "0\.0\.0"/);
});

test("control: an exact pin, the workspace protocol, a wildcard and an absent entry are each REFUSED; a caret and a tilde range are accepted", () => {
  assert.match(manifestRefusal(manifestWith("0.1.0")) ?? "", /not a \^ or ~ range/);
  assert.match(manifestRefusal(manifestWith("workspace:^")) ?? "", /workspace protocol/);
  assert.match(manifestRefusal(manifestWith("*")) ?? "", /not a \^ or ~ range/);
  assert.match(manifestRefusal(manifestWith(undefined)) ?? "", /^cli does not declare/);
  assert.equal(manifestRefusal(manifestWith("^0.1.0")), null);
  assert.equal(manifestRefusal(manifestWith("~0.1.0")), null);
});

test("control: a lockfile linking the workspace copy is REFUSED, naming cli, whatever the manifest says", () => {
  assert.match(lockfileRefusal(lockWith("^0.1.0", "link:../pdf"), "^0.1.0") ?? "", /^cli resolves @a11ign\/documents to link:\.\.\/pdf/);
  assert.equal(lockfileRefusal(lockWith("^0.1.0", "0.1.0"), "^0.1.0"), null);
});

test("control: a lockfile with a stale specifier, or with no entry for the package, is REFUSED", () => {
  assert.match(lockfileRefusal(lockWith("0.1.0", "0.1.0"), "^0.1.0") ?? "", /lockfile is stale/);
  assert.match(lockfileRefusal("importers:\n  packages/cli:\n    devDependencies: {}\n", "^0.1.0") ?? "", /has no @a11ign\/documents/);
});

test("control: an import naming the wrong names, a missing import and a type imported as a value are each REFUSED", () => {
  const spec = IMPORTS[1];
  assert.equal(importRefusal(`import type { PdfFinding } from "${PACKAGE}";`, spec), null);
  assert.match(importRefusal(`import { PdfFinding } from "${PACKAGE}";`, spec) ?? "", /as a value, but it is a type/);
  assert.match(importRefusal(`import type { Other } from "${PACKAGE}";`, spec) ?? "", /without PdfFinding/);
  assert.match(importRefusal("import x from \"y\";", spec) ?? "", /does not import from/);
});

// ---- the real files -----------------------------------------------------------------------------------------------

test("cli declares @a11ign/documents by a semver range", () => {
  assert.equal(manifestRefusal(read(CLI_MANIFEST)), null);
});

test("the lockfile's cli importer resolves @a11ign/documents from the registry, with the manifest's specifier", () => {
  const specifier = (JSON.parse(read(CLI_MANIFEST)) as { devDependencies: Record<string, string> }).devDependencies[PACKAGE];
  assert.equal(lockfileRefusal(read(LOCKFILE), specifier), null);
});

test("no workspace package is named @a11ign/documents, so a range cannot be linked to it", () => {
  const lock = parse(read(LOCKFILE)) as Lockfile;
  const owners = Object.keys(lock.importers).filter((importer) => existsSync(join(ROOT, importer, "package.json"))
    && (JSON.parse(read(`${importer}/package.json`)) as { name?: string }).name === PACKAGE);
  assert.ok(Object.keys(lock.importers).length > 1, "the lockfile's importers parsed as empty, so the claim below stands on nothing");
  assert.deepEqual(owners, []);
});

for (const spec of IMPORTS) {
  test(`${spec.file} imports ${spec.names.join(" and ")} from the package by name`, () => {
    assert.equal(importRefusal(read(spec.file), spec), null);
  });
}

test("the name cli imports resolves to the REGISTRY copy: installed outside the workspace, and exporting what cli imports", () => {
  const installed = join(ROOT, "packages/cli/node_modules", PACKAGE);
  assert.ok(existsSync(installed), `${PACKAGE} is not installed for cli (run pnpm install)`);
  const real = realpathSync(installed);
  assert.ok(real.includes(`${sep}node_modules${sep}.pnpm${sep}`), `${PACKAGE} resolves to ${real}, a path in the workspace and not the store`);
  const declarations = readFileSync(join(real, "dist/index.d.ts"), "utf8");
  for (const name of IMPORTS.flatMap((spec) => spec.names)) {
    assert.match(declarations, new RegExp(`export (?:declare )?(?:function|interface|type|const) ${name}\\b`), `the published package does not export ${name}`);
  }
});
