/**
 * #2704 (move 4 of #69): THE EXTRACTION'S OWN TEST for `packages/control` -> `a11ign/control` (ADR 0040, M4).
 *
 * The directory keeps its path in the new repository (as M1, M2 and M5 did), so "the first commit's tree" is the package plus a root
 * `LICENSE`. Four claims, each with a fixture positive control beside it:
 *
 *   1. The licence: `control` declares AGPL but, unlike `worker-fleet`, ships no `LICENSE` of its own, so the root `LICENSE` of the first commit
 *      is the CORE's, and it is the AGPL text.
 *   2. No dependency, and no import that leaves the package except to a place this test names. ADR 0012 keeps `control` free of package-name
 *      imports (`control-has-no-dependencies.test.ts`), so the reach cannot become `by-name`: it is the sibling `packages/worker-fleet` laid
 *      beside it (checkout-path) and the six core reads in `CORE_READS`. THE CONTROL: a fixture with one relative import across the boundary,
 *      to somewhere not declared, is REFUSED naming both ends.
 *   3. The baseline gives NOTHING to #2704 any more: every edge out of `control` is `checkout-path`, `moves-with`, `cut` or `by-name`, and
 *      `checkout-path` is what the 19 that were `owned-by:#2704` became (#2704 decided: the core is laid beside the test, not the test sent to it).
 *      THE CONTROL: a fixture holding one `owned-by:#2704` entry is REFUSED.
 *   4. The first commit's leak scan: the tree and the package's history carry nothing `scripts/history-purge-replacements.txt` would redact and
 *      no credential shape. THE CONTROL: an internal address and a token-shaped string each REFUSE.
 *
 * Not here, and why: the cut recipe. `git filter-repo --path` alone LOSES FILES on this repository (`docs/new-code-repository.md`, "The cut"), so
 * the whole tip tree is compared after the cut by the one doing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { readBaseline } from "../../../guards/src/layer-edges.mjs";
import { applyReplacementRules, parseReplacementRules } from "../../../../scripts/history-purge-rehearsal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const CONTROL = "packages/control";
const SIBLING = "packages/worker-fleet";

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "control-extraction-"));
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

type Manifest = { name?: string; license?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const readManifest = (root: string): Manifest => JSON.parse(readFileSync(join(root, CONTROL, "package.json"), "utf8"));

/** The first commit's tree: the package as `git subtree split` carries it, plus the root `LICENSE` the cut adds (the core's, which `control` lacks). */
function withFirstCommitTree<T>(body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "control-extracted-"));
  try {
    cpSync(join(REPO_ROOT, CONTROL), join(root, CONTROL), { recursive: true, filter: (src) => !/node_modules|\/dist(\/|$)/.test(src) });
    cpSync(join(REPO_ROOT, "LICENSE"), join(root, "LICENSE"));
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- 1. the licence ---------------------------------------------------------------------------------------

const LICENCE_FLOOR = 10_000;
const AGPL_TITLE = /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/;

/** The package declares AGPL and the first commit's root `LICENSE` is the AGPL text, whole (ADR 0039 finding 1). */
function licenceRefusals(root: string): string[] {
  const refusals: string[] = [];
  const declared = readManifest(root).license;
  if (declared !== "AGPL-3.0-or-later") refusals.push(`${CONTROL}: license ${JSON.stringify(declared)} is not "AGPL-3.0-or-later"`);
  const rootLicence = join(root, "LICENSE");
  if (!existsSync(rootLicence) || readFileSync(rootLicence).length <= LICENCE_FLOOR || !AGPL_TITLE.test(readFileSync(rootLicence, "utf8"))) {
    refusals.push(`LICENSE: missing, truncated, or not ${AGPL_TITLE.source}`);
  }
  return refusals;
}

test("the package declares AGPL and the root LICENSE of the first commit is the AGPL text", () => {
  assert.deepEqual(withFirstCommitTree(licenceRefusals), []);
});

test("control: a wrong field and a truncated root text are each REFUSED", async () => {
  const refusals = await withFixture({
    [`${CONTROL}/package.json`]: JSON.stringify({ license: "MIT" }),
    "LICENSE": "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
  }, licenceRefusals);
  assert.equal(refusals.length, 2);
  assert.match(refusals[0], /^packages\/control: license "MIT"/);
  assert.match(refusals[1], /^LICENSE:/);
});

// ---- 2. no dependency, and no import out of the package except to a named place ---------------------------

type Refusal = { file: string; message: string };

const SOURCE_FILE = /\.(mjs|ts|js)$/;
/** `from "x"`, `import("x")` and the bare side-effect `import "x"`, which the first two forms of this pattern missed (M1's test learnt it). */
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const codeOf = (text: string) => text.split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");

function sourceFilesUnder(root: string, dir = CONTROL): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFilesUnder(root, rel);
    return SOURCE_FILE.test(entry.name) ? [rel] : [];
  });
}

/**
 * The core files `control` reads by a relative import, which the new repository's CI lays beside it. Declared, and compared both ways with
 * what the text says. `lab`'s two are #3396's (the layer checkouts); the other four are the test helpers `guards` and `scripts/test-support`
 * hold, in no package a by-name import could reach.
 */
const CORE_READS: Record<string, string> = {
  "packages/control/src/lab-pipeline.test.ts": "packages/lab/src/training/real-page-corpus.mjs",
  "packages/control/src/lab-reset-removal.test.ts": "scripts/test-support/git-sandbox.ts",
  "packages/control/src/layer-checkouts.test.ts": "scripts/test-support/git-sandbox.ts",
  "packages/control/src/layer-launchers.test.ts": "scripts/test-support/stamp-files.ts",
  "packages/control/src/post-qualification-status.mjs": "packages/lab/src/gates/qualification-status.mjs",
  "packages/control/src/pve-key-has-no-default.test.ts": "packages/guards/src/walk-scope.mjs",
};

/** Every relative import in `control` that lands outside it, as `{file, message: "imports <resolved path>"}`. */
function reachesOut(root: string): Refusal[] {
  const reaches: Refusal[] = [];
  for (const file of sourceFilesUnder(root)) {
    for (const [, specifier] of codeOf(readFileSync(join(root, file), "utf8")).matchAll(IMPORT)) {
      if (!specifier.startsWith(".")) continue;
      const reached = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!(reached === CONTROL || reached.startsWith(`${CONTROL}/`))) reaches.push({ file, message: `imports ${reached}` });
    }
  }
  return reaches;
}

/** Reaches that are neither into the sibling laid beside `control` nor one of `declared`, and any `@a11ign/` package-name import. */
function boundaryRefusals(root: string, declared: Record<string, string>): Refusal[] {
  const undeclared = reachesOut(root).filter(({ file, message }) => {
    const reached = message.replace(/^imports /, "");
    return !(reached.startsWith(`${SIBLING}/`) || declared[file] === reached);
  });
  const byName = sourceFilesUnder(root).flatMap((file) => [...codeOf(readFileSync(join(root, file), "utf8")).matchAll(IMPORT)]
    .filter(([, specifier]) => specifier.startsWith("@a11ign/")).map(([, specifier]) => ({ file, message: `imports ${specifier} by name (ADR 0012)` })));
  return [...undeclared, ...byName];
}

test("the package has no dependency, of either kind", () => {
  const manifest = readManifest(REPO_ROOT);
  assert.deepEqual([manifest.dependencies, manifest.devDependencies], [{}, {}]);
});

test("every import out of the package goes to the sibling laid beside it or to a declared core read, and the declared reads are all still there", () => {
  assert.deepEqual(boundaryRefusals(REPO_ROOT, CORE_READS), []);
  const reaches = reachesOut(REPO_ROOT);
  assert.ok(reaches.length >= 30, "too few imports out of the package found: the walk read the wrong place");
  const actual = Object.fromEntries(reaches.filter(({ message }) => !message.startsWith(`imports ${SIBLING}/`))
    .map(({ file, message }) => [file, message.replace(/^imports /, "")]));
  assert.deepEqual(actual, CORE_READS, "a declared core read is gone (drop it) or an undeclared one arrived");
});

test("control: a relative import across the boundary to an undeclared place is REFUSED naming both ends, and the sibling and a declared read are not", async () => {
  const refusals = await withFixture({
    [`${CONTROL}/src/x.mjs`]: 'import { a } from "../../guards/src/walk-scope.mjs";\nimport { b } from "../../worker-fleet/src/fleet-env.mjs";\n'
      + 'import "./own.mjs";\nimport { c } from "@a11ign/lab";\nimport "../../../scripts/side-effect.mjs";\n',
    [`${CONTROL}/src/y.mjs`]: `import { d } from "${["..", "..", "..", "..", "gone", "declared.mjs"].join("/")}";\n// import { e } from "../../lab/src/x.mjs";\n`,
  }, (root) => boundaryRefusals(root, { [`${CONTROL}/src/y.mjs`]: "../gone/declared.mjs" }));
  assert.deepEqual(refusals, [
    { file: `${CONTROL}/src/x.mjs`, message: "imports packages/guards/src/walk-scope.mjs" },
    { file: `${CONTROL}/src/x.mjs`, message: "imports scripts/side-effect.mjs" },
    { file: `${CONTROL}/src/x.mjs`, message: "imports @a11ign/lab by name (ADR 0012)" },
  ]);
});

// ---- 3. the baseline gives nothing to #2704 ---------------------------------------------------------------

type BaselineEntry = { from: string; direction: string; disposition: string };

/** Edges out of `control` that a row still owns for #2704, or whose disposition is not one a finished move may leave. */
function unresolvedEdges(baseline: BaselineEntry[]): string[] {
  return baseline.filter((edge) => edge.from.startsWith(`${CONTROL}/`) && edge.direction === "out"
    && (edge.disposition === "owned-by:#2704" || !/^(?:checkout-path|by-name|cut|moves-with:[\w-]+|owned-by:#\d+)$/.test(edge.disposition)))
    .map((edge) => `${edge.from}: ${edge.disposition}`);
}

test("the baseline holds no edge out of control that #2704 still owns", () => {
  const baseline = readBaseline(REPO_ROOT) as BaselineEntry[];
  assert.deepEqual(unresolvedEdges(baseline), []);
  const resolved = baseline.filter((edge) => edge.from.startsWith(`${CONTROL}/`) && edge.direction === "out" && edge.disposition === "checkout-path");
  assert.ok(resolved.length >= 60, "too few checkout-path edges out of control: the baseline was read wrongly");
});

test("control: an owned-by:#2704 entry is REFUSED, and so is a word outside the vocabulary", () => {
  assert.deepEqual(unresolvedEdges([
    { from: `${CONTROL}/src/a.mjs`, direction: "out", disposition: "owned-by:#2704" },
    { from: `${CONTROL}/src/b.mjs`, direction: "out", disposition: "later" },
    { from: `${CONTROL}/src/c.mjs`, direction: "out", disposition: "checkout-path" },
    { from: `${CONTROL}/src/d.mjs`, direction: "out", disposition: "owned-by:#3396" },
    { from: "packages/lab/src/e.ts", direction: "out", disposition: "owned-by:#2704" },
  ]), [`${CONTROL}/src/a.mjs: owned-by:#2704`, `${CONTROL}/src/b.mjs: later`]);
});

// ---- 4. the first commit's leak scan ----------------------------------------------------------------------

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

/** The licence text is long, public and not ours to scan: the same exemption `screenreader-worker-extraction.test.ts` makes. */
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

/** `git filter-repo --replace-text` rewrites FILE CONTENTS only; commit messages need `--replace-message`, and the history may carry messages with an internal address. */
function messageLeaks(messages: string): string[] {
  const { rules } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  return leakRefusals(applyReplacementRules(messages, rules), "a commit message after --replace-message");
}

function controlHistory(format: string, ...flags: string[]): string {
  return execFileSync("git", ["log", ...flags, `--format=${format}`, "--", CONTROL],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: sandboxGitEnv() });
}

function skipIfShallow(t: { skip: (why: string) => void }): boolean {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).trim();
  if (shallow === "true") t.skip("shallow clone: the package's history is not all here; CI checks out fetch-depth 0");
  return shallow === "true";
}

/** What `--replace-text` leaves of the file contents in the history. */
function contentLeaks(diffs: string): string[] {
  const { rules } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  return leakRefusals(applyReplacementRules(diffs, rules), "file contents in the history of the package after --replace-text");
}

test("the package's history, once --replace-text has run, has clean file contents (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const diffs = controlHistory("", "-p");
  assert.ok(diffs.includes("diff --git"), "no history read for the package: the log ran in the wrong place");
  assert.deepEqual(contentLeaks(diffs), []);
  // POSITIVE CONTROL for "the cut MUST pass --replace-text": measured 2026-10-05, 46 lines of the package's history carry an address the rules
  // redact, all of them `10.0.0.x` worker addresses in the fixtures of `fleet-wake.test.ts` (36) and `fleet-watch.test.ts` (10); no credential among them. A cut that
  // skipped the flag would publish them. A history that grows clean makes this fail, and that is the day to drop it.
  assert.ok(leakRefusals(diffs, "raw history").length > 0, "no raw history line needs redaction any more: the --replace-text requirement is moot");
});

test("the package's commit messages, once --replace-message has run, carry nothing either (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const messages = controlHistory("%ae%n%B", "-s");
  assert.ok(messages.split("\n").length > 300, "too few commit messages read: the log ran in the wrong place");
  assert.deepEqual(messageLeaks(messages), []);
});

test("control: an internal address in a commit message is REFUSED raw, and a token in one is REFUSED even after redaction", () => {
  const address = ["192", "168", "1", "15"].join(".");
  assert.deepEqual(leakRefusals(`fix for ${address}`, "m"), ["m: carries text the purge rules redact"]);
  assert.deepEqual(messageLeaks(`fix for ${address}`), []);
  assert.deepEqual(messageLeaks(`ghp_${"a".repeat(36)}`), ["a commit message after --replace-message: looks like a GitHub token"]);
});
