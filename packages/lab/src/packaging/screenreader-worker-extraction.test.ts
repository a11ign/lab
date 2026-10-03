/**
 * #2701 (move 1 of #69): THE EXTRACTION'S OWN TEST for `packages/nvda-worker` + `packages/nvda-speech` ->
 * `a11ign/screenreader-worker` (ADR 0040, M1; ADR 0039 finding 1).
 *
 * The directories stay under `packages/` until the cut-over, and so do they in the new repository (ADR 0039 finding 1 keeps
 * `packages/nvda-speech` and its own `LICENSE` there), so "the first commit's tree" is the two packages plus a root `LICENSE`.
 * Four claims, each with a fixture positive control beside it:
 *
 *   1. The licence divides the way ADR 0039 finding 1 says: AGPL for the worker (root `LICENSE` byte-identical to the worker's),
 *      GPL for the speech port with its own text and its NVDA-derived notice, and the three tests of `licence-boundary.test.ts`
 *      divide, two with the layer (as layer-sized copies, below) and the permissive-imports-copyleft one staying in core.
 *   2. The layer copied out as its own root reaches nothing outside itself in CODE: no relative import above the root, no
 *      sibling `@a11ign/` package but `evidence` (the allowed direction, a devDependency), and its runtime dependency is
 *      `@guidepup/guidepup` alone. THE CONTROL: a fixture with one relative import across the boundary is REFUSED, naming both ends.
 *   3. What still crosses is exactly what the guard (#2612) baselines, and nothing is left undecided: the OUT direction in the real
 *      tree is the three Windows launcher lines, each `owned-by:#2614`. THIS IS NOT "no edge in either direction", which the row's
 *      Acceptance asks for and which is false today (see the test's own comment).
 *   4. The first commit's leak scan: the tree and the paths' history carry nothing `scripts/history-purge-replacements.txt` would
 *      redact and no credential shape. THE CONTROL: an internal address and a token-shaped string each REFUSE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { findEdges, readBaseline, trackedFiles } from "../../../guards/src/layer-edges.mjs";
import { applyReplacementRules, parseReplacementRules } from "../../../../scripts/history-purge-rehearsal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const LAYER = ["packages/nvda-worker", "packages/nvda-speech"] as const;
const WORKER = LAYER[0];
const SPEECH = LAYER[1];
/** The one sibling a layer package may name: `nvda-worker` depends on `evidence` by name, which is the allowed direction (finding 1). */
const ALLOWED_SIBLING = "@a11ign/evidence";

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "screenreader-worker-extraction-"));
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

type Manifest = { name?: string; license?: string; private?: boolean; dependencies?: Record<string, string> };
const readManifest = (root: string, pkg: string): Manifest => JSON.parse(readFileSync(join(root, pkg, "package.json"), "utf8"));

/** The first commit's tree: both packages as filter-repo would carry them, plus the root `LICENSE` the cut-over adds beside them. */
function withFirstCommitTree<T>(body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "screenreader-worker-extracted-"));
  try {
    for (const pkg of LAYER) {
      cpSync(join(REPO_ROOT, pkg), join(root, pkg), { recursive: true, filter: (src) => !/node_modules|\/dist(\/|$)/.test(src) });
    }
    cpSync(join(REPO_ROOT, WORKER, "LICENSE"), join(root, "LICENSE"));
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- 1. the licence divides three ways -------------------------------------------------------------------

const COPYLEFT = /^(A?GPL|GPL)-/i;
const LICENCE_FLOOR = 10_000;
const AGPL_TITLE = /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/;
const GPL_TITLE = /GNU GENERAL PUBLIC LICENSE\s+Version 3/;

function licenceFileRefusal(root: string, pkg: string, title: RegExp): string[] {
  const path = join(root, pkg, "LICENSE");
  const ok = existsSync(path) && readFileSync(path).length > LICENCE_FLOOR && title.test(readFileSync(path, "utf8"));
  return ok ? [] : [`${pkg}/LICENSE: missing, truncated, or not ${title.source}`];
}

/** ADR 0039 finding 1: each package declares its own licence exactly as before, and the root `LICENSE` is the worker's, byte for byte. */
function licenceRefusals(root: string): string[] {
  const refusals: string[] = [];
  const expected: [string, string][] = [[WORKER, "AGPL-3.0-or-later"], [SPEECH, "GPL-3.0-or-later"]];
  for (const [pkg, license] of expected) {
    const declared = readManifest(root, pkg).license;
    if (declared !== license) refusals.push(`${pkg}: license ${JSON.stringify(declared)} is not ${JSON.stringify(license)}`);
  }
  refusals.push(...licenceFileRefusal(root, WORKER, AGPL_TITLE), ...licenceFileRefusal(root, SPEECH, GPL_TITLE));
  const rootLicence = join(root, "LICENSE");
  if (!existsSync(rootLicence) || !readFileSync(rootLicence).equals(readFileSync(join(root, WORKER, "LICENSE")))) {
    refusals.push("LICENSE: the root is missing or is not byte-identical to packages/nvda-worker/LICENSE");
  }
  return refusals;
}

test("the layer's licences divide as ADR 0039 finding 1 says, in the tree that becomes the first commit", () => {
  assert.deepEqual(withFirstCommitTree(licenceRefusals), []);
});

test("control: a wrong field, a truncated text and a root that differs from the worker's are each REFUSED", async () => {
  const refusals = await withFixture({
    [`${WORKER}/package.json`]: JSON.stringify({ license: "MIT" }),
    [`${WORKER}/LICENSE`]: "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
    [`${SPEECH}/package.json`]: JSON.stringify({ license: "GPL-3.0-or-later" }),
    [`${SPEECH}/LICENSE`]: `GNU GENERAL PUBLIC LICENSE\n Version 3\n${"x".repeat(LICENCE_FLOOR)}`,
    "LICENSE": "something else\n",
  }, licenceRefusals);
  assert.equal(refusals.length, 3);
  assert.match(refusals[0], /^packages\/nvda-worker: license "MIT"/);
  assert.match(refusals[1], /^packages\/nvda-worker\/LICENSE:/);
  assert.match(refusals[2], /^LICENSE:/);
});

test("nvda-speech keeps its NVDA-derived notice, and stays private so it is never distributed on its own", () => {
  const readme = readFileSync(join(REPO_ROOT, SPEECH, "README.md"), "utf8");
  assert.match(readme, /derived from NVDA\*\*, which is GPL-2\.0-\*\*or-later\*\*/);
  assert.equal(readManifest(REPO_ROOT, SPEECH).private, true);
});

/** The layer-sized copy of "every package declares a licence": its subject is these two packages, so its floor is 2, not core's. */
function declaredLicences(root: string): string[] {
  return LAYER.flatMap((pkg) => readManifest(root, pkg).license ?? []);
}

/** The layer-sized copy of "every PUBLISHED copyleft package ships its licence text": the layer publishes exactly one, so its count is exact. */
function publishedCopyleft(root: string): string[] {
  return LAYER.filter((pkg) => {
    const manifest = readManifest(root, pkg);
    return manifest.private !== true && COPYLEFT.test(manifest.license ?? "");
  });
}

test("the two layer-sized copies of licence-boundary's tests hold: both declare, and exactly one published copyleft package ships its text", () => {
  withFirstCommitTree((root) => {
    assert.equal(declaredLicences(root).length, LAYER.length, "a layer package declares no licence");
    assert.deepEqual(publishedCopyleft(root), [WORKER], "the layer's published copyleft set is not exactly nvda-worker");
    for (const pkg of publishedCopyleft(root)) assert.ok(existsSync(join(root, pkg, "LICENSE")), `${pkg} ships no LICENSE`);
  });
});

test("licence-boundary.test.ts still holds the three tests this one divides, and core keeps the permissive-imports-copyleft one", () => {
  const source = readFileSync(join(HERE, "licence-boundary.test.ts"), "utf8");
  const names = [...source.matchAll(/^test\("([^"]+)"/gm)].map((match) => match[1]);
  assert.deepEqual(names, [
    "every package declares a licence",
    "no permissively-licensed package imports a copyleft one",
    "every PUBLISHED copyleft package ships its licence text",
  ]);
  const evidence = readManifest(REPO_ROOT, "packages/evidence");
  assert.equal(evidence.license, "Apache-2.0", "the subject of the test that STAYS in core is no longer permissive");
});

// ---- 2. the layer copied out reaches nothing outside itself in code --------------------------------------

type Refusal = { file: string; message: string };

const SOURCE_FILE = /\.(mjs|ts|js)$/;
/** `from "x"`, `import("x")` and the bare side-effect `import "x"`, which the first two forms of this pattern missed. */
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;

function sourceFilesUnder(root: string, dir = "."): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFilesUnder(root, rel);
    return SOURCE_FILE.test(entry.name) ? [rel] : [];
  });
}

/** Where a layer package, rooted with its sibling beside it, would have to reach OUTSIDE the layer: a relative import leaving both packages, a sibling `@a11ign/` package but `evidence`, or a second runtime dependency. */
function boundaryRefusals(root: string): Refusal[] {
  const refusals: Refusal[] = [];
  const dependencies = Object.keys(readManifest(root, WORKER).dependencies ?? {});
  if (dependencies.join() !== "@guidepup/guidepup") {
    refusals.push({ file: `${WORKER}/package.json`, message: `dependencies are ${JSON.stringify(dependencies)}, not ["@guidepup/guidepup"]` });
  }
  for (const file of sourceFilesUnder(root, "packages")) {
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const [, specifier] of code.matchAll(IMPORT)) {
      const reached = specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : null;
      const outward = reached !== null && !LAYER.some((pkg) => reached === pkg || reached.startsWith(`${pkg}/`));
      const sibling = specifier.startsWith("@a11ign/") && !specifier.startsWith(ALLOWED_SIBLING)
        && !specifier.startsWith("@a11ign/screenreader-worker");
      if (outward || sibling) refusals.push({ file, message: `imports ${specifier}` });
    }
  }
  return refusals;
}

test("the layer copied out as its own root imports nothing outside itself but evidence, and depends on guidepup alone", () => {
  withFirstCommitTree((root) => {
    assert.ok(sourceFilesUnder(root, "packages").length >= 100, "too few source files under the copied tree: the walk read the wrong place");
    assert.deepEqual(boundaryRefusals(root), []);
  });
});

test("control: a relative import across the boundary is REFUSED naming both ends, so are a sibling package and a second dependency", async () => {
  const refusals = await withFixture({
    [`${WORKER}/package.json`]: JSON.stringify({ dependencies: { "@guidepup/guidepup": "0.31.0", yaml: "^2" } }),
    [`${WORKER}/src/x.mjs`]: 'import { a } from "../../lab/src/harnesses/capture-check.mjs";\nimport { b } from "@a11ign/judge";\n'
      + `import { c } from "@a11ign/evidence/verify";\nimport "./own.mjs";\nimport "../../nvda-speech/x.py";\n`
      + 'import "../../worker-fleet/src/side-effect.mjs";\n',
    [`${SPEECH}/package.json`]: JSON.stringify({}),
  }, boundaryRefusals);
  assert.deepEqual(refusals, [
    { file: `${WORKER}/package.json`, message: 'dependencies are ["@guidepup/guidepup","yaml"], not ["@guidepup/guidepup"]' },
    { file: `${WORKER}/src/x.mjs`, message: "imports ../../lab/src/harnesses/capture-check.mjs" },
    { file: `${WORKER}/src/x.mjs`, message: "imports @a11ign/judge" },
    { file: `${WORKER}/src/x.mjs`, message: "imports ../../worker-fleet/src/side-effect.mjs" },
  ]);
});

// ---- 3. what still crosses is what the guard baselines, and nothing is undecided -------------------------

/** The three Windows launcher lines (ADR 0039 item 6): cutting them is a re-provision of every worker box, which is the fleet's row and not this one's. */
const KNOWN_OUT_EDGES = [
  ["packages/nvda-worker/src/run-capture-check.cmd", "packages/lab/src/harnesses/capture-check.mjs"],
  ["packages/nvda-worker/src/run-capture-check.cmd", "packages/worker-fleet/src/provisioning/apply-foreground-lock-timeout.ps1"],
  ["packages/nvda-worker/src/run-server.cmd", "packages/worker-fleet/src/provisioning/apply-foreground-lock-timeout.ps1"],
] as const;

test("the guard's OUT direction from the layer is exactly the three launcher lines, each baselined owned-by:#2614", () => {
  // The row's Acceptance says the guard "finds no edge in either direction". It cannot today, and the guard says why in its own
  // baseline: 3 out and 32 in (read with `node packages/guards/src/layer-edges.mjs --check`), every one given a disposition by
  // #2612/#2613 (`owned-by:#2614`, `travels`, `by-name`). This test pins the part that decides whether the PACKAGES can leave
  // (out), and the baseline test in layer-edges.test.ts pins the rest; it does not assert an emptiness the tree does not have.
  const edges = findEdges({ root: REPO_ROOT, tracked: trackedFiles(REPO_ROOT) });
  const out = edges.filter((edge) => edge.direction === "out" && LAYER.some((pkg) => edge.from.startsWith(`${pkg}/`)));
  assert.deepEqual(out.map((edge) => [edge.from, edge.to]), KNOWN_OUT_EDGES.map((edge) => [...edge]));
  assert.ok(out.every((edge) => edge.kind === "launcher"), "an out edge that is not a launcher line is code, which would leave with the layer");
  const baseline = readBaseline(REPO_ROOT) as { from: string; to: string; direction: string; disposition: string }[];
  for (const edge of out) {
    const entry = baseline.find((row) => row.from === edge.from && row.to === edge.to && row.direction === "out");
    assert.equal(entry?.disposition, "owned-by:#2614", `${edge.from} -> ${edge.to} has no owner in the baseline`);
  }
  const layerEdges = edges.filter((edge) => LAYER.some((pkg) => edge.from.startsWith(`${pkg}/`) || edge.to.startsWith(`${pkg}/`)));
  assert.ok(layerEdges.length > out.length, "no IN edge read: the guard looked at the wrong tree, so the out reading above is not evidence");
});

// ---- 4. the first commit's leak scan ---------------------------------------------------------------------

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

/** The licence texts are long, public and not ours to scan: the same exemption `documents-extraction.test.ts` makes. */
const isLicenceText = (file: string) => file.endsWith("LICENSE");

function treeLeaks(root: string): string[] {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !/node_modules|dist/.test(entry.parentPath))
    .map((entry) => join(entry.parentPath, entry.name));
  return files.filter((file) => !isLicenceText(file))
    .flatMap((file) => leakRefusals(readFileSync(file, "utf8"), file.slice(root.length + 1)));
}

test("the tree that becomes the first commit carries nothing the purge rules redact and no credential", () => {
  withFirstCommitTree((root) => {
    assert.ok(readdirSync(root, { recursive: true }).length > 100, "too few files in the copied tree: the scan read the wrong place");
    assert.deepEqual(treeLeaks(root), []);
  });
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

/** `git filter-repo --replace-text` rewrites FILE CONTENTS only; commit messages need `--replace-message`, and the history carries two with an internal address. */
function messageLeaks(messages: string): string[] {
  const { rules } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  return leakRefusals(applyReplacementRules(messages, rules), "a commit message after --replace-message");
}

function layerHistory(format: string, ...flags: string[]): string {
  return execFileSync("git", ["log", ...flags, `--format=${format}`, "--", ...LAYER],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: sandboxGitEnv() });
}

function skipIfShallow(t: { skip: (why: string) => void }): boolean {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).trim();
  if (shallow === "true") t.skip("shallow clone: the paths' history is not all here; CI checks out fetch-depth 0");
  return shallow === "true";
}

test("the paths' history, which filter-repo carries across, has clean file contents (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const diffs = layerHistory("", "-p");
  assert.ok(diffs.includes("diff --git"), "no history read for the layer: the log ran in the wrong place");
  const withoutLicences = diffs.split(/^diff --git /m).filter((part) => !/^a\/packages\/nvda-(worker|speech)\/LICENSE/.test(part)).join("diff --git ");
  assert.deepEqual(leakRefusals(withoutLicences, "file contents in the history of the layer"), []);
});

test("the paths' commit messages, once --replace-message has run, carry nothing either (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const messages = layerHistory("%ae%n%B", "-s");
  assert.ok(messages.split("\n").length > 300, "too few commit messages read: the log ran in the wrong place");
  assert.deepEqual(messageLeaks(messages), []);
  // POSITIVE CONTROL for "the cut-over MUST pass --replace-message": today two messages carry an internal address, so a
  // recipe with `--replace-text` alone would publish them. A history that grows clean makes this fail, and that is the day to drop it.
  assert.ok(leakRefusals(messages, "raw messages").length > 0, "no raw message needs redaction any more: the --replace-message requirement is moot");
});

test("control: an internal address in a commit message is REFUSED raw, and a token in one is REFUSED even after redaction", () => {
  const address = ["192", "168", "1", "15"].join(".");
  assert.deepEqual(leakRefusals(`fix for ${address}`, "m"), ["m: carries text the purge rules redact"]);
  assert.deepEqual(messageLeaks(`fix for ${address}`), []);
  assert.deepEqual(messageLeaks(`ghp_${"a".repeat(36)}`), ["a commit message after --replace-message: looks like a GitHub token"]);
});
