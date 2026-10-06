/**
 * #2703 (move 3 of #69): THE EXTRACTION'S OWN TEST for `packages/lab` -> `a11ign/lab` (ADR 0040, M3).
 *
 * The directory keeps its path in the new repository (as M1, M2 and M5 did), so "the first commit's tree" is the tracked files of the package plus
 * a root `LICENSE`, which the package does not carry: the cut copies the core's, so the licence claim is about that root file. Six claims, each
 * with a fixture positive control beside it:
 *
 *   1. The licence: AGPL, the root `LICENSE` is the AGPL text, and the package declares the same.
 *   2. By name, never by a published-package path: the manifest names every `@a11ign/` package the code imports, each at an exact version.
 *   3. NO EDGE LEFT TO DECIDE. The row's "no edge in either direction", read against the layer-edge fence (#3501): the baseline gives no edge to
 *      THIS row (`owned-by:#2703`), because each of the 562 it held has been decided. Every one became `checkout-path`: the repository's own CI lays
 *      the core beside it (ADR 0039 item 6a), since none could be `by-name` (guards is private, and the rest are files no published tarball ships).
 *      A `checkout-path` edge is only a decision if its target EXISTS in the core, so each is resolved. THE CONTROL: one `owned-by:#2703` entry, and
 *      one `checkout-path` edge to a path the core does not have, are each REFUSED.
 *   4. The edges INTO lab are not this row's: they belong to the delete (#3505) or move with lab, never to `#2703`.
 *   5. The tree-wide guards, by count: the ones inside `packages/lab` move, the ones outside stay and are still discovered when lab is absent.
 *   6. The first commit's leak scan: the TREE carries nothing `scripts/history-purge-replacements.txt` would redact and no credential shape, and the
 *      package's history carries neither once the cut's `--replace-text` and `--replace-message` have run (it does need both: 10 diff lines and 7
 *      message lines, each with a positive control). THE CONTROL: an internal address and a token each REFUSE, and the cut removes the first only.
 *
 * Not here, and why: the cut recipe. `git filter-repo --path` alone LOSES FILES on this repository, so the whole tip tree is compared after the cut
 * by the one doing it (`docs/new-code-repository.md`, "The cut"). Not here either: the copy's deletion and the by-published-version consumption
 * (#3505), and the repository's own CI, release and dependency updates, which are pull requests in `a11ign/lab`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { readBaseline } from "../../../guards/src/layer-edges.mjs";
import { MARKER_MODULE, treeWideGuardFiles } from "../../../guards/src/tree-wide-guards.mjs";
import { applyReplacementRules, parseReplacementRules } from "../../../../scripts/history-purge-rehearsal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const LAB = "packages/lab";
const OWN_NAME = "@a11ign/lab";
const THIS_ROW = "owned-by:#2703";

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "lab-extraction-"));
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
const readManifest = (root: string): Manifest => JSON.parse(readFileSync(join(root, LAB, "package.json"), "utf8"));

// ---- 1. the licence ---------------------------------------------------------------------------------------

const LICENCE_FLOOR = 10_000;
const AGPL_TITLE = /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/;

/** The package declares AGPL and the root `LICENSE` of the first commit is the AGPL text (the package ships none of its own: the cut adds the core's). */
function licenceRefusals(root: string): string[] {
  const refusals: string[] = [];
  const declared = readManifest(root).license;
  if (declared !== "AGPL-3.0-or-later") refusals.push(`${LAB}: license ${JSON.stringify(declared)} is not "AGPL-3.0-or-later"`);
  const rootLicence = join(root, "LICENSE");
  if (!existsSync(rootLicence) || readFileSync(rootLicence).length <= LICENCE_FLOOR || !AGPL_TITLE.test(readFileSync(rootLicence, "utf8"))) {
    refusals.push(`LICENSE: missing, truncated, or not ${AGPL_TITLE.source}`);
  }
  return refusals;
}

test("the package declares AGPL and the core's root LICENSE, which the cut copies into the first commit, is the AGPL text", () => {
  assert.deepEqual(licenceRefusals(REPO_ROOT), []);
});

test("control: a wrong field and a truncated or absent root text are each REFUSED", async () => {
  const wrong = await withFixture({ [`${LAB}/package.json`]: JSON.stringify({ license: "MIT" }), "LICENSE": "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n" }, licenceRefusals);
  assert.equal(wrong.length, 2);
  assert.match(wrong[0], /^packages\/lab: license "MIT"/);
  assert.match(wrong[1], /^LICENSE:/);
  const absent = await withFixture({ [`${LAB}/package.json`]: JSON.stringify({ license: "AGPL-3.0-or-later" }) }, licenceRefusals);
  assert.deepEqual(absent, [`LICENSE: missing, truncated, or not ${AGPL_TITLE.source}`]);
});

// ---- 2. by name -------------------------------------------------------------------------------------------

type Refusal = { file: string; message: string };

const SOURCE_FILE = /\.(mjs|ts|js)$/;
/** `from "x"`, `import("x")` and the bare side-effect `import "x"` (M1's test learnt the third form). */
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const codeOf = (text: string) => text.split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
/** A dependency range that is a path or the workspace, which no registry resolves, and so cannot be taken from a repository of its own. */
const LOCAL_SPEC = /^(workspace:|file:|link:|portal:)/;

function sourceFilesUnder(root: string, dir = LAB): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFilesUnder(root, rel);
    return SOURCE_FILE.test(entry.name) ? [rel] : [];
  });
}

/** Every `@a11ign/` name the code imports that the manifest does not declare, and every declared dependency that is a path and not a version. */
function nameRefusals(root: string): Refusal[] {
  const manifest = readManifest(root);
  const specs = { ...manifest.dependencies, ...manifest.devDependencies };
  const declared = new Set([...Object.keys(specs), OWN_NAME]);
  const refusals: Refusal[] = Object.entries(specs).filter(([, spec]) => LOCAL_SPEC.test(spec))
    .map(([name, spec]) => ({ file: `${LAB}/package.json`, message: `${name} is "${spec}", a path and not a published version` }));
  for (const file of sourceFilesUnder(root)) {
    for (const [, specifier] of codeOf(readFileSync(join(root, file), "utf8")).matchAll(IMPORT)) {
      const scope = specifier.match(/^(@a11ign\/[^/]+)/)?.[1];
      if (scope !== undefined && !declared.has(scope)) refusals.push({ file, message: `imports ${specifier}, which the manifest does not declare` });
    }
  }
  return refusals;
}

/**
 * Where a test WRITES an `@a11ign/` specifier as text for a case it builds, and it is the fixture's package and not lab's. Fixture trees under
 * `fixtures/` are walked as sources by this scan and are not lab's code; the one template string below is in a real test file.
 */
const WRITTEN_AS_FIXTURE_TEXT = [
  `${LAB}/src/packaging/pre-commit-hook.test.ts`,
] as const;
const isFixtureTree = (file: string) => file.includes("/fixtures/");
/** This file writes `@a11ign/` names as the fixtures of its own controls, so it is left out of its own walk here, in code, with the reason beside it. */
const SELF = `${LAB}/src/packaging/lab-extraction.test.ts`;

test("the manifest names every @a11ign/ package the code imports, each at a published version", () => {
  const refusals = nameRefusals(REPO_ROOT).filter((refusal) => !isFixtureTree(refusal.file) && refusal.file !== SELF);
  assert.deepEqual([...new Set(refusals.map((refusal) => refusal.file))], [...WRITTEN_AS_FIXTURE_TEXT]);
  assert.ok(sourceFilesUnder(REPO_ROOT).length > 500, "too few source files walked: the scan read the wrong place");
});

test("control: an undeclared sibling package and a dependency that is a path are each REFUSED", async () => {
  const refusals = await withFixture({
    [`${LAB}/package.json`]: JSON.stringify({ dependencies: { "@a11ign/judge": "0.2.3", "@a11ign/evidence": "link:../evidence" } }),
    [`${LAB}/src/x.mjs`]: 'import { a } from "@a11ign/judge/rules";\nimport { b } from "@a11ign/cli";\nimport { c } from "@a11ign/lab/x";\n// import "@a11ign/nope";\n',
  }, nameRefusals);
  assert.deepEqual(refusals, [
    { file: `${LAB}/package.json`, message: '@a11ign/evidence is "link:../evidence", a path and not a published version' },
    { file: `${LAB}/src/x.mjs`, message: "imports @a11ign/cli, which the manifest does not declare" },
  ]);
});

// ---- 3. no edge left to decide ----------------------------------------------------------------------------

type Edge = { from: string; to: string; kind: string; direction: "in" | "out"; disposition: string; reason: string };
const edge = (over: Partial<Edge>): Edge => ({ from: `${LAB}/src/a.test.ts`, to: "scripts/x.mjs", kind: "import", direction: "out", disposition: "checkout-path", reason: "r", ...over });
const baselineOf = (root: string) => readBaseline(root) as Edge[];
const outOfLab = (baseline: Edge[]) => baseline.filter((e) => e.direction === "out" && e.from.startsWith(`${LAB}/`));
const intoLab = (baseline: Edge[]) => baseline.filter((e) => e.direction === "in" && e.to.startsWith(`${LAB}/`) || e.to === LAB && e.direction === "in");

/** An edge this row still owns is a decision nobody made: the row's whole claim is that there are none. */
const undecided = (baseline: Edge[]) => baseline.filter((e) => e.disposition === THIS_ROW).map((e) => `${e.from} -> ${e.to}`);
/** A `checkout-path` edge is resolved by laying the core beside the repository, so its target must be a file or directory the core HAS. */
const unresolvable = (baseline: Edge[], coreHas: (path: string) => boolean) =>
  baseline.filter((e) => e.disposition === "checkout-path" && !coreHas(e.to)).map((e) => `${e.from} -> ${e.to}`);

const coreHas = (path: string) => existsSync(join(REPO_ROOT, path));

test("the baseline gives no edge to #2703: every edge out of lab is decided", () => {
  const baseline = baselineOf(REPO_ROOT);
  assert.deepEqual(undecided(baseline), []);
  assert.ok(outOfLab(baseline).length > 600, "too few edges out of lab read: the baseline was read wrongly");
});

test("every checkout-path edge out of lab names a path the core has, so laying the core beside lab resolves it", () => {
  const baseline = outOfLab(baselineOf(REPO_ROOT));
  assert.ok(baseline.filter((e) => e.disposition === "checkout-path").length > 500, "too few checkout-path edges: this row's decision was not read");
  assert.deepEqual(unresolvable(baseline, coreHas), []);
});

test("control: an edge still owned by #2703 and a checkout-path edge to a path the core lacks are each REFUSED, and a resolvable one is not", () => {
  const baseline = [edge({}), edge({ to: "scripts/gone.mjs" }), edge({ disposition: THIS_ROW, to: "scripts/y.mjs" })];
  assert.deepEqual(undecided(baseline), [`${LAB}/src/a.test.ts -> scripts/y.mjs`]);
  assert.deepEqual(unresolvable(baseline, (path) => path === "scripts/x.mjs"), [`${LAB}/src/a.test.ts -> scripts/gone.mjs`]);
});

// ---- 4. the edges into lab are the delete's ---------------------------------------------------------------

/** An edge INTO lab is the product reaching for what leaves: the delete's (`owned-by:#<another row>`) or a test that goes with lab, and never a lab-side decision. */
const NOT_THE_PRODUCTS_TO_KEEP = /^(?:owned-by:#(?!2703\b)\d+|moves-with:lab)$/;
const enteringUnowned = (baseline: Edge[]) => intoLab(baseline).filter((e) => !NOT_THE_PRODUCTS_TO_KEEP.test(e.disposition)).map((e) => `${e.from} -> ${e.to}`);

test("an edge INTO lab is another row's (the delete, #3505) or moves with lab, never this row's and never a path the core would resolve", () => {
  const entering = intoLab(baselineOf(REPO_ROOT));
  assert.ok(entering.length > 50, "too few edges into lab read: the baseline was read wrongly");
  assert.deepEqual(enteringUnowned(baselineOf(REPO_ROOT)), []);
});

test("control: an edge into lab held by this row or given a checkout path is REFUSED, and the delete's and a moves-with one are not", () => {
  const into = (disposition: string) => edge({ from: "scripts/x.mjs", to: `${LAB}/src/a.mjs`, direction: "in", disposition });
  const baseline = [into("owned-by:#3505"), into("moves-with:lab"), into(THIS_ROW), into("checkout-path")];
  assert.deepEqual(enteringUnowned(baseline), [`scripts/x.mjs -> ${LAB}/src/a.mjs`, `scripts/x.mjs -> ${LAB}/src/a.mjs`]);
});

// ---- 5. the tree-wide guards, by count ---------------------------------------------------------------------

const inLab = (path: string) => path.startsWith(`${LAB}/`);
const trackedTests = (): string[] => execFileSync("git", ["ls-files", "*.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).split("\n").filter(Boolean);

/** The guards a population over `tracked` finds. `lsFiles` is the seam `treeWideGuardFiles` offers: the discovery is the product's own. */
const guardsOver = (tracked: string[]) => treeWideGuardFiles({ lsFiles: () => tracked.join("\n") });

test("the tree-wide guards outside lab are found without lab present, and the ones inside it are exactly what leaves", () => {
  const tracked = trackedTests();
  const all = guardsOver(tracked);
  const stay = guardsOver(tracked.filter((path) => !inLab(path)));
  const move = guardsOver(tracked.filter(inLab));
  assert.ok(move.length > 15, `only ${move.length} tree-wide guards inside lab: the population was read wrongly`);
  assert.ok(stay.length > 0, "no tree-wide guard outside lab: the product would be left with none");
  assert.deepEqual(stay, all.filter((path) => !inLab(path)));
  assert.deepEqual([...stay, ...move].sort(), all);
  assert.deepEqual(stay.filter(inLab), []);
});

test("control: a guard inside lab is counted as leaving, one outside as staying, and a file that never calls the marker as neither", () => {
  const files: Record<string, string> = {
    [`${LAB}/src/a.test.ts`]: "declareTreeWideGuard();\n",
    "packages/judge/src/b.test.ts": "declareTreeWideGuard();\n",
    [`${LAB}/src/c.test.ts`]: "// declareTreeWideGuard();\n",
  };
  const found = (tracked: string[]) => treeWideGuardFiles({
    lsFiles: () => tracked.join("\n"), readFile: (path) => files[path], imports: () => [MARKER_MODULE],
  });
  const tracked = Object.keys(files);
  assert.deepEqual(found(tracked.filter(inLab)), [`${LAB}/src/a.test.ts`]);
  assert.deepEqual(found(tracked.filter((path) => !inLab(path))), ["packages/judge/src/b.test.ts"]);
});

// ---- 6. the first commit's leak scan ----------------------------------------------------------------------

/** Strings no first commit of a public repository may carry, besides what the purge rules redact: credential shapes. */
const CREDENTIAL_SHAPES: [string, RegExp][] = [
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  // A header AND a body: `history-secret-scan.test.ts` (the secret scanner's own test) writes a header over `abc`, which is a fixture and no key.
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/=]{40,}/],
];

const purge = (() => {
  const { rules, refusals } = parseReplacementRules(readFileSync(join(REPO_ROOT, "scripts/history-purge-replacements.txt"), "utf8"));
  assert.deepEqual(refusals, [], "the purge rules themselves no longer parse");
  return (content: string) => applyReplacementRules(content, rules);
})();
/** Text the rules redact: the cut must run them, so a recipe without them would publish it. */
const needsRedaction = (content: string) => purge(content) !== content;
const credentialRefusals = (content: string, label: string) => CREDENTIAL_SHAPES.filter(([, shape]) => shape.test(content)).map(([what]) => `${label}: looks like ${what}`);

/** A tree the cut copies as it is: nothing in it may need redaction, and no credential. */
const treeRefusals = (content: string, label: string) =>
  [...(needsRedaction(content) ? [`${label}: carries text the purge rules redact`] : []), ...credentialRefusals(content, label)];

/** History, which `filter-repo --replace-text` / `--replace-message` rewrite: what is left after the cut must be neither redactable nor a credential. */
const leftAfterCut = (content: string, label: string) => treeRefusals(purge(content), label);

/** The first commit's tree: the tracked files of the package, as `git subtree split` carries them. Read from git, so a stray local file is not scanned. */
const firstCommitFiles = () => execFileSync("git", ["ls-files", "-z", LAB], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).split("\0").filter(Boolean);
/** A NUL byte in the first 8 KiB marks a binary file, which the rules do not read. */
const isText = (buffer: Buffer) => !buffer.subarray(0, 8192).includes(0);

test("the tree that becomes the first commit carries nothing the purge rules redact and no credential", () => {
  const files = firstCommitFiles();
  assert.ok(files.length > 700, `only ${files.length} files in the tree: the scan read the wrong place`);
  const buffers = files.map((file) => ({ file, buffer: readFileSync(join(REPO_ROOT, file)) })).filter(({ buffer }) => isText(buffer));
  assert.ok(buffers.length > 600, "too few text files in the tree: the binary filter read the wrong thing");
  assert.deepEqual(buffers.flatMap(({ file, buffer }) => treeRefusals(buffer.toString("utf8"), file)), []);
});

test("control: an internal address and a token-shaped string are each REFUSED in a tree, and the cut redacts the address but not the token", () => {
  const address = ["192", "168", "1", "20"].join(".");
  const token = `ghp_${"a".repeat(36)}`;
  assert.deepEqual(treeRefusals(`host = "${address}"`, "a.ts"), ["a.ts: carries text the purge rules redact"]);
  assert.deepEqual(treeRefusals(`const t = "${token}";`, "b.ts"), ["b.ts: looks like a GitHub token"]);
  assert.deepEqual(leftAfterCut(`host = "${address}"`, "a.ts"), []);
  assert.deepEqual(leftAfterCut(`const t = "${token}";`, "b.ts"), ["b.ts: looks like a GitHub token"]);
  assert.deepEqual(treeRefusals("export {};\n", "c.ts"), []);
});

test("control: a private key header over a body is REFUSED, and the same header over a placeholder is not", () => {
  const header = "-----BEGIN OPENSSH PRIVATE KEY-----";
  assert.deepEqual(treeRefusals(`scan("${header}\\nabc\\n-----END OPENSSH PRIVATE KEY-----")`, "c.ts"), []);
  assert.deepEqual(treeRefusals(`${header}\n${"A".repeat(64)}\n`, "d.ts"), ["d.ts: looks like a private key block"]);
});

function labHistory(format: string, ...flags: string[]): string {
  return execFileSync("git", ["log", ...flags, `--format=${format}`, "--", LAB],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: sandboxGitEnv() });
}

function skipIfShallow(t: { skip: (why: string) => void }): boolean {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() }).trim();
  if (shallow === "true") t.skip("shallow clone: the package's history is not all here; CI checks out fetch-depth 0");
  return shallow === "true";
}

test("the package's history, which the cut carries across, is clean once --replace-text has run (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const diffs = labHistory("", "-p");
  assert.ok(diffs.includes("diff --git"), "no history read for the package: the log ran in the wrong place");
  assert.deepEqual(leftAfterCut(diffs, "file contents in the history of the package"), []);
  // POSITIVE CONTROL for "the cut MUST pass --replace-text": the package's old file contents carry text the rules redact (10 lines when written,
  // measured over `git log -p`), so a recipe without it would publish them. A history that grows clean makes this fail, and that is the day to drop it.
  assert.equal(needsRedaction(diffs), true, "no raw file content needs redaction any more: the --replace-text requirement is moot");
});

test("the package's commit messages, once --replace-message has run, are clean too (needs a full clone)", (t) => {
  if (skipIfShallow(t)) return;
  const messages = labHistory("%ae%n%B", "-s");
  assert.ok(messages.split("\n").length > 3000, "too few commit messages read: the log ran in the wrong place");
  assert.deepEqual(leftAfterCut(messages, "a commit message after --replace-message"), []);
  // POSITIVE CONTROL for "the cut MUST pass --replace-message": `--replace-text` rewrites file contents only, and 7 message lines carry text the rules redact.
  assert.equal(needsRedaction(messages), true, "no raw message needs redaction any more: the --replace-message requirement is moot");
});
