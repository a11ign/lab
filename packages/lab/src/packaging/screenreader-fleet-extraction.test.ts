/**
 * #2702 (move 2 of #69): THE EXTRACTION'S OWN TEST for `packages/worker-fleet` -> `a11ign/screenreader-fleet` (ADR 0040, M2).
 *
 * The directory keeps its path in the new repository (as M1 and M5 did), so "the first commit's tree" is the package plus a root
 * `LICENSE`. Five claims, each with a fixture positive control beside it:
 *
 *   1. The licence: AGPL, with the text, and the root `LICENSE` byte-identical to the package's.
 *   2. By name, never by path: the package depends on `@a11ign/judge` and `@a11ign/screenreader-worker` alone, imports no other
 *      `@a11ign/` package, and the ONLY files with a relative import that leaves the package are the coupled tests of claim 3.
 *      THE CONTROL: a fixture with one relative import across the boundary is REFUSED, naming both ends.
 *   3. The COUPLED tests, which is what the row's "no edge in either direction" turned out to be. Measured by running the package's
 *      53 test files copied out as a repository: 26 fail on a file they cannot have there (control's playbooks, lab, the root
 *      `package.json`, the private `guards`) and 1 more (`worker-url`) fails on what it discovers, not on a path. The set is DERIVED
 *      here from the text, equals the declared list, and each of them stays behind or is ported by the new repository's first pull
 *      request; none of them can be a file a published package ships. THE CONTROL: a file naming `packages/control` is coupled and
 *      one that does not is not.
 *   4. Every edge the layer-edge baseline still gives to THIS row sits in a file named here, so the 28 are a work list and not a
 *      number, and none belongs to a file this test does not know.
 *   5. The first commit's leak scan: the tree and the package's history carry nothing `scripts/history-purge-replacements.txt` would
 *      redact and no credential shape. THE CONTROL: an internal address and a token-shaped string each REFUSE.
 *
 * Not here, and why: the cut recipe. `git filter-repo --path` alone LOSES FILES on this repository (2 of this package's 112, measured on
 * `6655aacea`), so the whole tip tree is compared after the cut by the one doing it (`docs/new-code-repository.md`, "The cut").
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
const FLEET = "packages/worker-fleet";
/** The two names the package may depend on at run time, and the third it may import (its own, through `exports`). */
const RUNTIME_DEPENDENCIES = ["@a11ign/judge", "@a11ign/screenreader-worker"];
const OWN_NAME = "@a11ign/screenreader-fleet";

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "screenreader-fleet-extraction-"));
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
const readManifest = (root: string): Manifest => JSON.parse(readFileSync(join(root, FLEET, "package.json"), "utf8"));

/** The first commit's tree: the package as `git subtree split` carries it, plus the root `LICENSE` the cut adds beside it. */
function withFirstCommitTree<T>(body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "screenreader-fleet-extracted-"));
  try {
    cpSync(join(REPO_ROOT, FLEET), join(root, FLEET), { recursive: true, filter: (src) => !/node_modules|\/dist(\/|$)/.test(src) });
    cpSync(join(REPO_ROOT, FLEET, "LICENSE"), join(root, "LICENSE"));
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- 1. the licence ---------------------------------------------------------------------------------------

const LICENCE_FLOOR = 10_000;
const AGPL_TITLE = /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/;

/** The package declares AGPL, ships the text, and the root `LICENSE` is that text byte for byte (ADR 0039 finding 1). */
function licenceRefusals(root: string): string[] {
  const refusals: string[] = [];
  const declared = readManifest(root).license;
  if (declared !== "AGPL-3.0-or-later") refusals.push(`${FLEET}: license ${JSON.stringify(declared)} is not "AGPL-3.0-or-later"`);
  const own = join(root, FLEET, "LICENSE");
  if (!existsSync(own) || readFileSync(own).length <= LICENCE_FLOOR || !AGPL_TITLE.test(readFileSync(own, "utf8"))) {
    refusals.push(`${FLEET}/LICENSE: missing, truncated, or not ${AGPL_TITLE.source}`);
  }
  const rootLicence = join(root, "LICENSE");
  if (!existsSync(rootLicence) || !existsSync(own) || !readFileSync(rootLicence).equals(readFileSync(own))) {
    refusals.push(`LICENSE: the root is missing or is not byte-identical to ${FLEET}/LICENSE`);
  }
  return refusals;
}

test("the package's licence is AGPL with its text, and the root LICENSE of the first commit is that text", () => {
  assert.deepEqual(withFirstCommitTree(licenceRefusals), []);
});

test("control: a wrong field, a truncated text and a root that differs are each REFUSED", async () => {
  const refusals = await withFixture({
    [`${FLEET}/package.json`]: JSON.stringify({ license: "MIT" }),
    [`${FLEET}/LICENSE`]: "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
    "LICENSE": "something else\n",
  }, licenceRefusals);
  assert.equal(refusals.length, 3);
  assert.match(refusals[0], /^packages\/worker-fleet: license "MIT"/);
  assert.match(refusals[1], /^packages\/worker-fleet\/LICENSE:/);
  assert.match(refusals[2], /^LICENSE:/);
});

// ---- 2. by name, never by path ----------------------------------------------------------------------------

type Refusal = { file: string; message: string };

const SOURCE_FILE = /\.(mjs|ts|js)$/;
/** `from "x"`, `import("x")` and the bare side-effect `import "x"`, which the first two forms of this pattern missed (M1's test learnt it). */
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const codeOf = (text: string) => text.split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");

function sourceFilesUnder(root: string, dir = FLEET): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFilesUnder(root, rel);
    return SOURCE_FILE.test(entry.name) ? [rel] : [];
  });
}

/** Files whose code imports across the package boundary by a relative path, and every `@a11ign/` name the manifest does not declare. */
function boundaryRefusals(root: string): Refusal[] {
  const manifest = readManifest(root);
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), OWN_NAME]);
  const refusals: Refusal[] = [];
  for (const file of sourceFilesUnder(root)) {
    for (const [, specifier] of codeOf(readFileSync(join(root, file), "utf8")).matchAll(IMPORT)) {
      const reached = specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : null;
      if (reached !== null && !(reached === FLEET || reached.startsWith(`${FLEET}/`))) refusals.push({ file, message: `imports ${specifier}` });
      const scope = specifier.match(/^(@a11ign\/[^/]+)/)?.[1];
      if (scope !== undefined && !declared.has(scope)) refusals.push({ file, message: `imports ${specifier}, which the manifest does not declare` });
    }
  }
  return refusals;
}

test("the package depends on the judge and the worker by name, and by nothing else at run time", () => {
  assert.deepEqual(Object.keys(readManifest(REPO_ROOT).dependencies ?? {}), RUNTIME_DEPENDENCIES);
});

// ---- 3. the coupled tests ---------------------------------------------------------------------------------

/**
 * What a test file names that a published package cannot ship: another package's directory (`packages/control` and the rest), the
 * private `guards`, a root `scripts/` file, or a path three levels up (the checkout root). Measured against the package run as its own
 * repository: it flags 25 of the 26 files that failed there and no file that passed except `worker-fleet-does-not-read-control`, which
 * passes there because the thing it forbids is absent (it asserts over an empty set), so it is coupled too.
 */
const REACH = new RegExp(
  "packages/(?:control|lab|guards|nvda-worker|nvda-speech|scorer|judge|cli|agent-org|evidence)\\b"
  + "|\\.\\./\\.\\./(?:control|lab|guards|scorer|judge|cli|agent-org|evidence|nvda-worker)/"
  + "|\\.\\./\\.\\./\\.\\./|\"scripts/|/scripts/");

/** The tests the scan finds, named without `.test.ts`. Declared, and compared both ways with what the text says. */
const COUPLED = [
  "capture-body-owner", "cli-flags", "display-mode", "doctor", "edge-pin-parity", "entry-points", "fleet-consistency", "fleet-env",
  "fleet-scripts", "git-safe-env", "lab-job-lock-two-rows", "lab-job-params-reach-the-command", "lab-job", "no-win32-imports",
  "node-pin-parity", "npm-cli-executable", "playbook-variables", "profile-origin-writer", "protocol-guard", "provision-stamp-inputs",
  "provision-stamp", "update-deferral-policy", "worker-code-check", "worker-fleet-does-not-read-control", "worker-http-client-owner",
  "worker-port",
] as const;
/** Coupled by what it DISCOVERS and not by a path: "only found 0 --worker clients" when the clients live in `lab`. The scan cannot see it. */
const MISSED_BY_THE_SCAN = ["worker-url"] as const;
const coupledPath = (name: string) => `${FLEET}/src/${name}.test.ts`;

function reachingTests(root: string): string[] {
  return sourceFilesUnder(root).filter((file) => file.endsWith(".test.ts") && REACH.test(codeOf(readFileSync(join(root, file), "utf8")))).sort();
}

test("the tests that reach outside the package are exactly the declared COUPLED set, so a new one cannot arrive unclassified", () => {
  const found = reachingTests(REPO_ROOT);
  assert.deepEqual(found, COUPLED.map(coupledPath).sort());
  for (const name of MISSED_BY_THE_SCAN) assert.ok(existsSync(join(REPO_ROOT, coupledPath(name))), `${name} is declared and absent`);
  assert.ok(sourceFilesUnder(REPO_ROOT).filter((file) => file.endsWith(".test.ts")).length >= 50, "too few test files walked: the scan read the wrong place");
});

test("control: a file naming another package's directory is coupled, a comment about one and a file that names none are not", async () => {
  const found = await withFixture({
    [`${FLEET}/src/a.test.ts`]: 'const p = "packages/control/ansible/x.yml";\n',
    [`${FLEET}/src/b.test.ts`]: '// reads packages/control/ansible in the monorepo\nexport const own = "./b.mjs";\n',
    [`${FLEET}/src/c.test.ts`]: 'import { x } from "../../guards/src/walk-scope.mjs";\n',
    [`${FLEET}/src/d.test.ts`]: 'export const ok = true;\n',
  }, reachingTests);
  assert.deepEqual(found, [`${FLEET}/src/a.test.ts`, `${FLEET}/src/c.test.ts`]);
});

test("every file with a relative import out of the package is a coupled test, and every other file imports inside it", () => {
  const coupled = new Set([...COUPLED, ...MISSED_BY_THE_SCAN].map(coupledPath));
  const stray = boundaryRefusals(REPO_ROOT).filter((refusal) => !coupled.has(refusal.file));
  assert.deepEqual(stray, []);
  assert.ok(boundaryRefusals(REPO_ROOT).length > 0, "no import out of the package was found at all: the walk read the wrong place");
});

test("control: a relative import across the boundary is REFUSED naming both ends, and so is an undeclared sibling package", async () => {
  const refusals = await withFixture({
    [`${FLEET}/package.json`]: JSON.stringify({ dependencies: { "@a11ign/judge": "0.1.0" } }),
    [`${FLEET}/src/x.mjs`]: 'import { a } from "../../guards/src/walk-scope.mjs";\nimport { b } from "@a11ign/lab";\n'
      + 'import { c } from "@a11ign/judge/rules";\nimport "./own.mjs";\nimport "../../control/src/side-effect.mjs";\n'
      + 'import { d } from "@a11ign/screenreader-fleet/health";\n',
  }, boundaryRefusals);
  assert.deepEqual(refusals, [
    { file: `${FLEET}/src/x.mjs`, message: "imports ../../guards/src/walk-scope.mjs" },
    { file: `${FLEET}/src/x.mjs`, message: "imports @a11ign/lab, which the manifest does not declare" },
    { file: `${FLEET}/src/x.mjs`, message: "imports ../../control/src/side-effect.mjs" },
  ]);
});

// ---- 4. the baseline's edges that are this row's ----------------------------------------------------------

/**
 * Runtime files and two tests that read "the workspace root": `packages/`, `scripts/`, the root `package.json`, or the scorer a bootstrap
 * script fetches. In the new repository the root is its own, laid out the same way, so they run; nothing they read is in another package.
 * They stay `owned-by:#2702` until the copy is deleted (#3504), which takes the entries with the files.
 */
const WORKSPACE_ROOT_READERS = [
  `${FLEET}/src/command-line-census.mjs`, `${FLEET}/src/doctor.mjs`, `${FLEET}/src/source-walk.mjs`,
  `${FLEET}/src/mjs-parses.test.ts`, `${FLEET}/src/worker-precedence.test.ts`, `${FLEET}/src/provisioning/bootstrap-control-plane.sh`,
];

function filesOwnedByThisRow(): string[] {
  const baseline = readBaseline(REPO_ROOT) as { from: string; direction: string; disposition: string }[];
  return [...new Set(baseline.filter((edge) => edge.direction === "out" && edge.from.startsWith(`${FLEET}/`)
    && edge.disposition === "owned-by:#2702").map((edge) => edge.from))].sort();
}

test("every file the baseline still gives to #2702 is a coupled test or a workspace-root reader, and each reader still has an edge", () => {
  const owned = filesOwnedByThisRow();
  const known = new Set([...COUPLED, ...MISSED_BY_THE_SCAN].map(coupledPath).concat(WORKSPACE_ROOT_READERS));
  assert.deepEqual(owned.filter((file) => !known.has(file)), [], "an edge this row owns sits in a file the test does not classify");
  assert.deepEqual(WORKSPACE_ROOT_READERS.filter((file) => !owned.includes(file)), [], "a listed reader has no edge left: drop it");
  assert.ok(owned.length >= 15, "too few owned files read: the baseline was read wrongly");
});

// ---- 5. the first commit's leak scan ----------------------------------------------------------------------

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

/** `git filter-repo --replace-text` rewrites FILE CONTENTS only; commit messages need `--replace-message`, and the history carries messages with an internal address. */
function messageLeaks(messages: string): string[] {
  const { rules } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  return leakRefusals(applyReplacementRules(messages, rules), "a commit message after --replace-message");
}

function fleetHistory(format: string, ...flags: string[]): string {
  return execFileSync("git", ["log", ...flags, `--format=${format}`, "--", FLEET],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: sandboxGitEnv() });
}

function skipIfShallow(t: { skip: (why: string) => void }): boolean {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).trim();
  if (shallow === "true") t.skip("shallow clone: the package's history is not all here; CI checks out fetch-depth 0");
  return shallow === "true";
}

test("the package's history, which the cut carries across, has clean file contents (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const diffs = fleetHistory("", "-p");
  assert.ok(diffs.includes("diff --git"), "no history read for the package: the log ran in the wrong place");
  const withoutLicence = diffs.split(/^diff --git /m).filter((part) => !/^a\/packages\/worker-fleet\/LICENSE/.test(part)).join("diff --git ");
  assert.deepEqual(leakRefusals(withoutLicence, "file contents in the history of the package"), []);
});

test("the package's commit messages, once --replace-message has run, carry nothing either (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const messages = fleetHistory("%ae%n%B", "-s");
  assert.ok(messages.split("\n").length > 300, "too few commit messages read: the log ran in the wrong place");
  assert.deepEqual(messageLeaks(messages), []);
  // POSITIVE CONTROL for "the cut MUST pass --replace-message": today the package's messages carry internal addresses, so a recipe with
  // `--replace-text` alone would publish them. A history that grows clean makes this fail, and that is the day to drop it.
  assert.ok(leakRefusals(messages, "raw messages").length > 0, "no raw message needs redaction any more: the --replace-message requirement is moot");
});

test("control: an internal address in a commit message is REFUSED raw, and a token in one is REFUSED even after redaction", () => {
  const address = ["192", "168", "1", "15"].join(".");
  assert.deepEqual(leakRefusals(`fix for ${address}`, "m"), ["m: carries text the purge rules redact"]);
  assert.deepEqual(messageLeaks(`fix for ${address}`), []);
  assert.deepEqual(messageLeaks(`ghp_${"a".repeat(36)}`), ["a commit message after --replace-message: looks like a GitHub token"]);
});
