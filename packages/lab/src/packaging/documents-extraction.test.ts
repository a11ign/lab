/**
 * #2705 (move 5 of #69): THE EXTRACTION'S OWN TEST for `packages/pdf` -> `a11ign/documents` (ADR 0040, M5).
 *
 * `@a11ign/pdf` was never published, so there is no old package to rename on the registry: the rename is
 * a FIRST PUBLISH of `@a11ign/documents`. Four claims, each with a fixture positive control beside it:
 *
 *   1. The package is named `@a11ign/documents`, and so is every import of it.
 *   2. Nothing in this repository names `@a11ign/pdf`, not even `cli` (the row allowed `cli` to keep the old
 *      name until M6; it does not need to, because the workspace link is by name and `cli`'s Region was
 *      already in this row). THE CONTROL: a fixture naming the old name is REFUSED, naming file and line.
 *   3. No edge across the boundary: the package copied out as its own root (what `git filter-repo
 *      --path-rename packages/pdf/:` produces) imports nothing outside itself, and its ONLY dependency is
 *      `pdf-lib`. THE CONTROL: a fixture with one crossing import, and one with a second dependency, REFUSE.
 *   4. The first commit's licence and leak scan: `LICENSE` is the full Apache-2.0 text and `license` says so
 *      (ADR 0040 decision 7, "Apache-2.0 at creation"), no copyleft import, and the tree plus the path's
 *      history carry nothing `scripts/history-purge-replacements.txt` would redact or that looks like a
 *      credential. THE CONTROL: an AGPL fixture, an internal address and a token-shaped string each REFUSE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { internalDependencies } from "../../../guards/src/isolation-gate.mjs";
import { applyReplacementRules, parseReplacementRules } from "../../../../scripts/history-purge-rehearsal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const PACKAGE_DIR = join(REPO_ROOT, "packages/pdf");
const NEW_NAME = "@a11ign/documents";
const OLD_NAME = ["@a11ign", "pdf"].join("/");
/** This file names the old name in its own constants and fixtures, so it cannot be a member of the population it scans. */
const SELF = "packages/lab/src/packaging/documents-extraction.test.ts";

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "documents-extraction-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, posix.dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readManifest(root: string): { name?: string; license?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

const SOURCE_FILE = /\.(mjs|ts|js)$/;
const IMPORT = /(?:from|import\s*\()\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;

function sourceFilesUnder(root: string, dir = "."): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFilesUnder(root, rel);
    return SOURCE_FILE.test(entry.name) ? [rel] : [];
  });
}

// ---- 1. the package is named @a11ign/documents, and so is every import of it ---------------------------

test("the package is named @a11ign/documents, at a version the first publish can start from", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as { name: string; version: string };
  assert.equal(manifest.name, NEW_NAME);
  assert.match(manifest.version, /^0\.0\.0$/, "the changeset (not a hand edit) takes 0.0.0 to the 0.1.0 the row publishes");
});

test("cli imports the package by its new name (positive control for claim 2: the population is not empty)", () => {
  const cli = readFileSync(join(REPO_ROOT, "packages/cli/src/cli.ts"), "utf8");
  assert.ok(cli.includes(`from "${NEW_NAME}"`), "cli.ts no longer imports looksLikePdfUrl/scanPdfTagTree from the new name");
  const deps = readManifest(join(REPO_ROOT, "packages/cli")).dependencies ?? {};
  assert.ok(NEW_NAME in deps, "cli's manifest does not depend on the new name");
});

// ---- 2. nothing names the old name ----------------------------------------------------------------------

type Mention = { file: string; line: number };

/** Every tracked file outside `docs/` and Markdown (the ADRs and rows record the old name as history) naming the old name. */
function oldNameMentions(root: string, files: string[]): Mention[] {
  return files.flatMap((file) => readFileSync(join(root, file), "utf8").split("\n")
    .flatMap((text, i) => (text.includes(OLD_NAME) ? [{ file, line: i + 1 }] : [])));
}

function trackedFilesOutsideDocs(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: sandboxGitEnv() })
    .split("\0").filter(Boolean)
    .filter((file) => !file.startsWith("docs/") && !file.endsWith(".md") && file !== SELF && existsSync(join(REPO_ROOT, file)));
}

test("nothing in the repository names the old package, `cli` included", () => {
  const files = trackedFilesOutsideDocs();
  assert.ok(files.length > 1000, "too few tracked files read: the walk read the wrong place");
  assert.deepEqual(oldNameMentions(REPO_ROOT, files), []);
});

test("control: a fixture naming the old name is REFUSED, naming the file and the line", async () => {
  const found = await withFixture({
    "src/ok.ts": `import { a } from "${NEW_NAME}";\n`,
    "src/old.ts": `// header\nimport { a } from "${OLD_NAME}";\n`,
  }, (root) => oldNameMentions(root, ["src/ok.ts", "src/old.ts"]));
  assert.deepEqual(found, [{ file: "src/old.ts", line: 2 }]);
});

// ---- 3. no edge across the boundary; the only dependency is pdf-lib --------------------------------------

type Refusal = { file: string; message: string };

/** What the package, rooted at itself, would have to reach OUTSIDE itself for: a relative path above the root, another `@a11ign/` package, or a dependency other than `pdf-lib`. */
function boundaryRefusals(root: string): Refusal[] {
  const refusals: Refusal[] = [];
  const dependencies = Object.keys(readManifest(root).dependencies ?? {});
  if (dependencies.join() !== "pdf-lib") {
    refusals.push({ file: "package.json", message: `dependencies are ${JSON.stringify(dependencies)}, not ["pdf-lib"]` });
  }
  for (const file of sourceFilesUnder(root)) {
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const [, specifier] of code.matchAll(IMPORT)) {
      const outward = specifier.startsWith(".") && posix.normalize(posix.join(posix.dirname(file), specifier)).startsWith("..");
      const sibling = specifier.startsWith("@a11ign/") && specifier !== NEW_NAME && !specifier.startsWith(`${NEW_NAME}/`);
      if (outward || sibling) refusals.push({ file, message: `imports ${specifier}` });
    }
  }
  return refusals;
}

test("the package copied out as its own root crosses no boundary and depends on pdf-lib alone", () => {
  const root = mkdtempSync(join(tmpdir(), "documents-extracted-"));
  try {
    cpSync(PACKAGE_DIR, root, { recursive: true, filter: (src) => !/node_modules|\/dist(\/|$)/.test(src) });
    assert.ok(sourceFilesUnder(root).length >= 3, "too few source files under the copied tree: the walk read the wrong place");
    assert.deepEqual(boundaryRefusals(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("control: one crossing import and a second dependency are each REFUSED, naming where", async () => {
  const refusals = await withFixture({
    "package.json": JSON.stringify({ name: NEW_NAME, dependencies: { "pdf-lib": "^1", yaml: "^2" } }),
    "src/index.ts": 'import { x } from "../../evidence/src/index.js";\nimport { y } from "@a11ign/judge";\nimport "./local.js";\n',
    "src/self.mjs": `import { z } from "${NEW_NAME}";\n`,
  }, boundaryRefusals);
  assert.deepEqual(refusals, [
    { file: "package.json", message: 'dependencies are ["pdf-lib","yaml"], not ["pdf-lib"]' },
    { file: "src/index.ts", message: "imports ../../evidence/src/index.js" },
    { file: "src/index.ts", message: "imports @a11ign/judge" },
  ]);
});

// ---- 4. the first commit's licence and leak scan ---------------------------------------------------------

const COPYLEFT = /^(A?GPL|GPL)-/i;

/** ADR 0040 decision 7: `Apache-2.0` at creation, the first push carrying the full `LICENSE` and the matching field. */
function licenceRefusals(root: string): string[] {
  const refusals: string[] = [];
  const { license } = readManifest(root);
  if (license !== "Apache-2.0") refusals.push(`license: ${JSON.stringify(license)} is not "Apache-2.0"`);
  const licencePath = join(root, "LICENSE");
  if (!existsSync(licencePath) || statSync(licencePath).size < 10_000 || !/Apache License\s+Version 2\.0/.test(readFileSync(licencePath, "utf8"))) {
    refusals.push("LICENSE: missing, truncated, or not the Apache-2.0 text");
  }
  return refusals;
}

/** Strings no first commit of a public repository may carry: what the purge redacts, plus credential shapes. */
const CREDENTIAL_SHAPES: [string, RegExp][] = [
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function leakRefusals(content: string, label: string): string[] {
  const { rules, refusals } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  assert.deepEqual(refusals, [], "the purge rules themselves no longer parse");
  const found: string[] = [];
  if (applyReplacementRules(content, rules) !== content) found.push(`${label}: carries text the purge rules redact`);
  for (const [what, shape] of CREDENTIAL_SHAPES) if (shape.test(content)) found.push(`${label}: looks like ${what}`);
  return found;
}

function treeLeaks(root: string): string[] {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !/node_modules|dist/.test(entry.parentPath))
    .map((entry) => join(entry.parentPath, entry.name));
  return files.filter((file) => file !== join(root, "LICENSE"))
    .flatMap((file) => leakRefusals(readFileSync(file, "utf8"), file.slice(root.length + 1)));
}

test("LICENSE is the full Apache-2.0 text, the license field matches, and nothing imports copyleft code", () => {
  assert.deepEqual(licenceRefusals(PACKAGE_DIR), []);
  assert.ok(!COPYLEFT.test(readManifest(PACKAGE_DIR).license ?? ""), "the license field is copyleft");
});

test("control: an AGPL fixture is REFUSED naming `license`, a truncated LICENSE naming `LICENSE`", async () => {
  const refusals = await withFixture({
    "package.json": JSON.stringify({ name: NEW_NAME, license: "AGPL-3.0-or-later" }),
    "LICENSE": "Apache License Version 2.0\n",
  }, licenceRefusals);
  assert.equal(refusals.length, 2);
  assert.match(refusals[0], /^license:/);
  assert.match(refusals[1], /^LICENSE:/);
});

test("the tree that becomes the first commit carries nothing the purge rules redact and no credential", () => {
  assert.deepEqual(treeLeaks(PACKAGE_DIR), []);
});

test("control: an internal address and a token-shaped string are each REFUSED", async () => {
  const leaks = await withFixture({
    "a.ts": `const host = "${["192", "168", "1", "20"].join(".")}";\n`,
    "b.ts": `const t = "ghp_${"a".repeat(36)}";\n`,
    "c.ts": "export {};\n",
  }, treeLeaks);
  assert.deepEqual(leaks, [
    "a.ts: carries text the purge rules redact",
    "b.ts: looks like a GitHub token",
  ]);
});

test("the path's history, which filter-repo carries across, carries nothing either (needs a full clone)", (t) => {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).trim();
  if (shallow === "true") return void t.skip("shallow clone: the path's history is not all here; CI checks out fetch-depth 0");
  const history = execFileSync("git", ["log", "-p", "--format=%ae%n%B", "--", "packages/pdf"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: sandboxGitEnv() });
  assert.ok(history.includes("diff --git"), "no history read for packages/pdf: the log ran in the wrong place");
  const withoutLicence = history.split(/^diff --git /m).filter((part) => !part.startsWith("a/packages/pdf/LICENSE")).join("diff --git ");
  assert.deepEqual(leakRefusals(withoutLicence, "history of packages/pdf"), []);
});

// ---- the isolation gate finds the package by NAME, because its directory is still packages/pdf -----------

test("the isolation gate resolves cli's @a11ign/documents to packages/pdf, whose directory is not the name's", () => {
  const dirs = internalDependencies(join(REPO_ROOT, "packages/cli")).map((dir) => dir.slice(REPO_ROOT.length + 1));
  assert.ok(dirs.includes("packages/pdf"), `cli's internal dependencies are ${JSON.stringify(dirs)}, without packages/pdf`);
});

test("control: a dependency naming no package is still refused, not guessed at", async () => {
  await withFixture({
    "packages/a/package.json": JSON.stringify({ name: "@a11ign/a", dependencies: { "@a11ign/ghost": "0.0.0" } }),
    "packages/b/package.json": JSON.stringify({ name: "@a11ign/b" }),
  }, (root) => assert.throws(() => internalDependencies(join(root, "packages/a")), /@a11ign\/ghost, which is not a package in this repo/));
});
