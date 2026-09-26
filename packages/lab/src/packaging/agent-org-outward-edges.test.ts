/**
 * #2658 (child 3g of #69): THE TOOL STOPS IMPORTING THE PRODUCT TREE (ADR 0040, decision 4).
 *
 * `agent-org` imported NINE files from outside its package by relative path or `@a11ign/` specifier, from 69 of its files:
 * `worker-fleet/src/cli-flags`, four of `guards/src`, three of `scripts`, and `lab/src/packaging/leak-patterns`. This row copies
 * seven into `packages/agent-org/src/lib/`, replaces `repo-identity` by the declaration's reader (`project-identity.mjs`), and splits
 * `leak-patterns`. Four claims, each with its control in this file:
 *
 *   1. A WALK of `packages/agent-org/src` (comment lines skipped, tests included) finds NO import that resolves outside the package.
 *      THE CONTROL: the same walk over a fixture package with ONE import across the boundary REFUSES, naming the file and the target,
 *      over a fixture in the shape of the tree at 46b59abf0 it finds exactly the nine, and a boundary import that lives only in a
 *      comment is not one -- so an empty answer on the real tree is not a walk that cannot see.
 *   2. Each of the seven copies is BYTE-IDENTICAL to its original apart from its header and the sanctioned edits below. THE CONTROL:
 *      a one-character change to a copy, and an edit nobody sanctioned, are each reported as a difference.
 *   3. The tool's leak policy holds the two GENERIC patterns and the declaration's `leakPatterns` the two a11ign ones, and their
 *      union equals the product's `LEAK_PATTERNS` by name and by source. THE CONTROL: dropping one of them from the union, or renaming
 *      one, is reported; and the two policies AGREE on a battery of inputs (`allLeaksIn`, `leakRefusalReason`, `assertNoLeakInArgv`),
 *      because a set that is equal but decides differently would change behaviour.
 *   4. The reader's new field refuses what is malformed naming the entry, and reads an absent one as none.
 *
 * WHY THE FIXTURE IS SYNTHETIC AND NOT A CHECKOUT OF 46b59abf0. The acceptance job has no git history (`History: full` is what a job
 * needs to read one), and a test that quietly skipped there would be a control that never runs. The nine targets and the spellings
 * the 69 files used are the ADR's own reading (`outward.mjs`, `nine.sh`), and they are written out below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAK_PATTERNS, allLeaksIn as productAllLeaksIn, leakRefusalReason as productRefusal } from "./leak-patterns.mjs";
import {
  GENERIC_LEAK_PATTERNS,
  allLeaksIn,
  assertNoLeakInArgv,
  leakPatterns,
  leakRefusalReason,
} from "../../../agent-org/src/lib/leak-patterns.mjs";
import {
  PROJECT_DECLARATION_PATH,
  ProjectDeclarationRefusal,
  homeProjectDeclaration,
  parseProjectDeclaration,
} from "../../../agent-org/src/project-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const PACKAGE = "packages/agent-org";
const SOURCE_ROOT = `${PACKAGE}/src`;

// ---- the walk ------------------------------------------------------------------------------------------------------------

/** `from "x"`, `import "x"` and `import("x")` -- the specifier is group 1. The same expression as ADR 0040's `outward.mjs`. */
const IMPORT = /(?:from|import\s*\()\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const SOURCE_FILE = /\.(mjs|ts|js)$/;

type Edge = { file: string; specifier: string; target: string };

function sourceFilesUnder(root: string, dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(root, path));
    else if (SOURCE_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

/** Where an import written in `file` points, as a repo-relative path, or null for a specifier that is not a path (`node:fs`, a package). */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), specifier));
  if (!specifier.startsWith("@a11ign/")) return null;
  const [, name, ...rest] = specifier.split("/");
  return posix.join("packages", name, "src", rest.join("/") || "index");
}

const TEST_FILE = /\.test\.[a-z]+$/;

/**
 * Every import under `<root>/packages/agent-org/src` that resolves outside `<root>/packages/agent-org/`, comment lines excluded.
 * `tests` says whether the package's own `*.test.*` files are walked: ADR 0040's `outward.mjs` (Done-when 1) does not walk them, because
 * the org's tests are the EXTRACTION row's (decision 4: 113 travel, 14 are divided, 43 are classified), so the two are read apart below.
 */
function outwardEdges(root: string, { tests = false }: { tests?: boolean } = {}): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFilesUnder(root, SOURCE_ROOT)) {
    if (!tests && TEST_FILE.test(file)) continue;
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const match of code.matchAll(IMPORT)) {
      const target = resolveSpecifier(file, match[1]);
      if (target === null || target.startsWith(`${PACKAGE}/`)) continue;
      const withExtension = [target, `${target}.mjs`, `${target}.ts`].find((candidate) => existsSync(join(root, candidate)));
      edges.push({ file, specifier: match[1], target: withExtension ?? target });
    }
  }
  return edges;
}

/** What a boundary check says when it finds edges: the file that imports and the file it reaches, both named. */
function refusal(edges: Edge[]): string | null {
  if (edges.length === 0) return null;
  return edges.map((edge) => `${edge.file} imports \`${edge.specifier}\`, which reaches ${edge.target}, outside ${PACKAGE}/`).join("\n");
}

function withFixture<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "outward-edges-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, posix.dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- 1. the boundary -----------------------------------------------------------------------------------------------------

test("#2658: no import under packages/agent-org/src resolves outside packages/agent-org/", () => {
  const files = sourceFilesUnder(REPO_ROOT, SOURCE_ROOT);
  assert.ok(files.length > 100, `the walk saw too few files under ${SOURCE_ROOT}, so an empty answer would mean nothing`);
  assert.equal(refusal(outwardEdges(REPO_ROOT)), null);
});

/**
 * THE THREE TESTS THAT STILL REACH OUT, named so a fourth is a failure and not a surprise. Each imports a `guards` module this row does
 * not copy (`git-env` is copied, but these tests reach the ORIGINAL, which is what the test exercises) and moves with the extraction row,
 * which divides the tests. The list may shrink; it may not grow.
 */
const TEST_EDGES_LEFT_FOR_THE_EXTRACTION = [
  "packages/agent-org/src/spawn-memory-floor.test.ts",
  "packages/agent-org/src/wake-reviewer-instance.test.ts",
  "packages/agent-org/src/work-gate-claim-stalled.test.ts",
];

test("#2658: the package's own tests reach outside in no file but the three the extraction row divides", () => {
  const files = [...new Set(outwardEdges(REPO_ROOT, { tests: true }).map((edge) => edge.file))];
  assert.deepEqual(files.filter((file) => !TEST_EDGES_LEFT_FOR_THE_EXTRACTION.includes(file)), []);
});

test("#2658 control: the walk includes a package's own tests only when asked, and a test edge is then found", () => {
  const fixture = {
    "packages/agent-org/src/x.test.ts": 'import { a } from "../../guards/src/thing.mjs";\n',
    "packages/guards/src/thing.mjs": "export const a = 1;\n",
  };
  assert.deepEqual(withFixture(fixture, (root) => outwardEdges(root)), []);
  assert.deepEqual(withFixture(fixture, (root) => outwardEdges(root, { tests: true })).map((edge) => edge.file), ["packages/agent-org/src/x.test.ts"]);
});

test("#2658 control: ONE import across the boundary is REFUSED, naming both ends", () => {
  const reading = withFixture({
    "packages/agent-org/src/inside.mjs": 'import { a } from "./sibling.mjs";\nexport const b = a;\n',
    "packages/agent-org/src/sibling.mjs": "export const a = 1;\n",
    "packages/agent-org/src/deep/reach.mjs": 'import { x } from "../../../guards/src/thing.mjs";\nexport const y = x;\n',
    "packages/guards/src/thing.mjs": "export const x = 1;\n",
  }, (root) => refusal(outwardEdges(root)));
  assert.ok(reading, "a fixture with one outward import must be refused");
  assert.match(reading, /packages\/agent-org\/src\/deep\/reach\.mjs/, "the refusal must name the importing file");
  assert.match(reading, /packages\/guards\/src\/thing\.mjs/, "the refusal must name the file it reaches");
  assert.equal(reading.split("\n").length, 1, "exactly one edge, and the in-package import beside it is not one");
});

test("#2658 control: a boundary import that lives only in a comment is not an edge, and a multi-line import is", () => {
  const edges = withFixture({
    "packages/agent-org/src/a.mjs": '// import { x } from "../../guards/src/thing.mjs";\n * from "../../guards/src/thing.mjs"\nexport {};\n',
    "packages/agent-org/src/b.mjs": 'import {\n  x,\n  y,\n} from "../../guards/src/thing.mjs";\nexport { x, y };\n',
    "packages/guards/src/thing.mjs": "export const x = 1, y = 2;\n",
  }, outwardEdges);
  assert.deepEqual(edges.map((edge) => edge.file), ["packages/agent-org/src/b.mjs"]);
});

/** The nine targets and the spellings the 69 files used at 46b59abf0 (ADR 0040, decision 4: `outward.mjs`). */
const NINE_TARGETS = [
  "packages/worker-fleet/src/cli-flags.mjs",
  "packages/guards/src/git-env.mjs",
  "scripts/repo-identity.mjs",
  "packages/lab/src/packaging/leak-patterns.mjs",
  "packages/guards/src/changed-files.mjs",
  "packages/guards/src/local-import-closure.mjs",
  "packages/guards/src/worktree-resolution.mjs",
  "scripts/npm-cli-executable.mjs",
  "scripts/product-home.mjs",
];

test("#2658 control: over a tree in the shape of 46b59abf0 the walk finds exactly the nine targets", () => {
  const importers: Record<string, string> = {
    "packages/agent-org/src/a.mjs": 'import { f } from "../../worker-fleet/src/cli-flags.mjs";\nimport { g } from "../../guards/src/git-env.mjs";\n',
    "packages/agent-org/src/b.mjs": 'import { f } from "@a11ign/worker-fleet/cli-flags";\nimport { r } from "../../../scripts/repo-identity.mjs";\n',
    "packages/agent-org/src/merge-guard/c.mjs": 'import { l } from "../../../lab/src/packaging/leak-patterns.mjs";\nimport { c } from "../../../guards/src/changed-files.mjs";\n',
    "packages/agent-org/src/row-claim/d.mjs": 'import { c } from "../../../guards/src/local-import-closure.mjs";\nimport { w } from "../../../guards/src/worktree-resolution.mjs";\n',
    "packages/agent-org/src/work-gate/e.mjs": 'import { n } from "../../../../scripts/npm-cli-executable.mjs";\nimport { p } from "../../../../scripts/product-home.mjs";\n',
  };
  const targets: Record<string, string> = Object.fromEntries(NINE_TARGETS.map((path) => [path, "export {};\n"]));
  const found = withFixture({ ...importers, ...targets }, (root) => outwardEdges(root));
  assert.deepEqual([...new Set(found.map((edge) => edge.target))].sort(), [...NINE_TARGETS].sort());
  assert.equal(found.length, 10, "ten import lines: `cli-flags` is imported twice, once by each spelling");
  assert.equal(new Set(found.map((edge) => edge.file)).size, 5);
});

// ---- 2. the seven copies -------------------------------------------------------------------------------------------------

const HEADER_START = /^\/\/ COPIED FROM `([^`]+)` at ([0-9a-f]{9,40}) /;
const HEADER_END = "// ==== end of copy header ====";

/**
 * The lines the copy changes in the original, and why. A copy that moves two directories deeper cannot stay byte-identical where a line
 * NAMES its own location: `changed-files` imports its sibling by a path that began `../../worker-fleet/`, and `product-home` computes the
 * repository root as one level above `scripts/`. Both are the same behaviour from the new place, and each is named in the copy's own header.
 */
type Edit = { from: string; to: string };
const COPIES: ReadonlyArray<{ original: string; edit?: Edit }> = [
  { original: "packages/worker-fleet/src/cli-flags.mjs" },
  { original: "packages/guards/src/git-env.mjs" },
  {
    original: "packages/guards/src/changed-files.mjs",
    edit: { from: '"../../worker-fleet/src/cli-flags.mjs"', to: '"./cli-flags.mjs"' },
  },
  { original: "packages/guards/src/local-import-closure.mjs" },
  { original: "packages/guards/src/worktree-resolution.mjs" },
  { original: "scripts/npm-cli-executable.mjs" },
  {
    original: "scripts/product-home.mjs",
    edit: { from: 'resolve(dirname(fileURLToPath(import.meta.url)), "..")', to: 'resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")' },
  },
];

const copyPath = (original: string) => `${SOURCE_ROOT}/lib/${posix.basename(original)}`;

/** The copy with its header block removed, wherever the block sits (a shebang must stay on line one). Null if there is no complete header. */
function withoutHeader(text: string): { origin: string; commit: string; body: string } | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => HEADER_START.test(line));
  const end = lines.indexOf(HEADER_END);
  if (start < 0 || end < start) return null;
  const [, origin, commit] = HEADER_START.exec(lines[start]) ?? [];
  return { origin, commit, body: [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n") };
}

/** Every way `copy` differs from `original` beyond its header and the one sanctioned edit; empty when it does not. */
function differences(copy: string, original: string, edit?: Edit): string[] {
  const header = withoutHeader(copy);
  if (header === null) return ["no complete copy header"];
  let expected = original;
  if (edit) {
    if (original.split(edit.from).length !== 2) return [`the sanctioned edit's target is not in the original exactly once: ${edit.from}`];
    expected = original.replace(edit.from, edit.to);
  }
  return header.body === expected ? [] : ["the body differs from the original"];
}

for (const { original, edit } of COPIES) {
  test(`#2658: ${copyPath(original)} is ${original} apart from its header${edit ? " and ONE named line" : ""}`, () => {
    const originalText = readFileSync(join(REPO_ROOT, original), "utf8");
    const copyText = readFileSync(join(REPO_ROOT, copyPath(original)), "utf8");
    assert.deepEqual(differences(copyText, originalText, edit), []);
    const header = withoutHeader(copyText);
    assert.equal(header?.origin, original, "the header must name the file it was copied from");
    assert.match(header?.commit ?? "", /^[0-9a-f]{9,40}$/, "the header must name the commit it was copied at");
    assert.equal(
      copyText.includes("CHANGED FROM THE ORIGINAL: NOTHING") !== Boolean(edit),
      true,
      "a copy with a sanctioned edit says ONE line changed, and a copy without one says nothing did",
    );
  });
}

test("#2658 control: a one-character change, an unsanctioned edit, and a missing header are each reported", () => {
  const original = readFileSync(join(REPO_ROOT, "packages/guards/src/git-env.mjs"), "utf8");
  const copy = readFileSync(join(REPO_ROOT, copyPath("packages/guards/src/git-env.mjs")), "utf8");
  assert.deepEqual(differences(copy, original), [], "the unmutated copy passes: the reports below are not true for the wrong reason");
  assert.notDeepEqual(differences(copy.replace("GIT_", "GIT-"), original), [], "one changed character");
  assert.notDeepEqual(differences(copy, `${original}// extra\n`), [], "an edit the copy does not carry");
  assert.notDeepEqual(differences(copy.replace(HEADER_END, "// not the end"), original), [], "a header with no end");
  const sanctioned = { from: "GIT_", to: "GIT-" };
  assert.notDeepEqual(differences(copy, original, sanctioned), [], "a sanctioned edit is applied to the ORIGINAL and the copy must carry it");
  assert.notDeepEqual(differences(copy, original, { from: "not in the file", to: "x" }), [], "a sanctioned edit whose target is absent");
});

test("#2658: the seven copies are the seven files the tool imported, and no other file sits in lib/ but the split leak policy", () => {
  const present = readdirSync(join(REPO_ROOT, SOURCE_ROOT, "lib")).sort();
  const expected = [...COPIES.map(({ original }) => posix.basename(original)), "leak-patterns.mjs"].sort();
  assert.deepEqual(present, expected);
});

// ---- 3. the split leak policy --------------------------------------------------------------------------------------------

type Pattern = { name: string; source: string };
const asSet = (patterns: ReadonlyArray<{ name: string; pattern: RegExp }>): Pattern[] =>
  patterns.map(({ name, pattern }) => ({ name, source: pattern.source })).sort((a, b) => a.name.localeCompare(b.name));

/** Two pattern sets are the same when they hold the same names with the same sources; the report says which side lacks what. */
function setDifferences(left: Pattern[], right: Pattern[]): string[] {
  const key = (p: Pattern) => `${p.name} :: ${p.source}`;
  const l = new Set(left.map(key));
  const r = new Set(right.map(key));
  return [...[...l].filter((k) => !r.has(k)).map((k) => `only in the first: ${k}`), ...[...r].filter((k) => !l.has(k)).map((k) => `only in the second: ${k}`)];
}

test("#2658: the tool's leak policy holds the generic two, the declaration's leakPatterns the a11ign two, and the union is the product's four", () => {
  const generic = asSet(GENERIC_LEAK_PATTERNS);
  assert.deepEqual(generic.map((p) => p.name), ["a named SSH private key file", "private LAN IPv4 address"]);
  const declared = homeProjectDeclaration().leakPatterns.map(({ name, pattern }) => ({ name, source: new RegExp(pattern).source }));
  assert.deepEqual(declared.map((p) => p.name).sort(), ["a live pct exec container-hop command", "a named credential file on a fleet host"]);
  const product = asSet(LEAK_PATTERNS);
  assert.equal(product.length, 4, "the product's set is the four this row splits, so a fifth is a decision to make here");
  assert.deepEqual(setDifferences([...generic, ...declared], product), []);
  assert.deepEqual(setDifferences(asSet(leakPatterns()), product), [], "leakPatterns() is that union, generic first");
  assert.deepEqual(leakPatterns().slice(0, 2).map((p) => p.name), GENERIC_LEAK_PATTERNS.map((p) => p.name));
});

test("#2658 control: a set missing one pattern, or with one renamed, is reported as different", () => {
  const product = asSet(LEAK_PATTERNS);
  assert.notDeepEqual(setDifferences(product.slice(1), product), [], "one pattern dropped");
  assert.notDeepEqual(setDifferences(product.map((p, i) => (i === 0 ? { ...p, name: `${p.name}!` } : p)), product), [], "one renamed");
  assert.notDeepEqual(setDifferences(product.map((p, i) => (i === 0 ? { ...p, source: `${p.source}x` } : p)), product), [], "one source changed");
  assert.deepEqual(setDifferences(product, [...product].reverse()), [], "order alone is not a difference");
});

/**
 * The battery is BUILT from parts, never typed whole: this file is a tracked source file, and the leak guards that walk every one
 * (`tracked-source-leak-guard.test.ts`, `fleet-key-name-is-one-fact.test.ts`) would rightly report a real-looking address or key name in it.
 * A value assembled at run time is not in the text they read, and it is the same string the patterns are shown.
 */
const ip = (...octets: number[]) => octets.join(".");
const SSH_DIR = `.${"ssh"}/`;
const CREDENTIAL_DIR = `.config/a11y-${"witness"}/`;
const CONTAINER_HOP = `pct ${"exec"}`;

/** Each of the four patterns, an address and key that is not one, and the exempt bridge: the inputs on which the two policies must agree. */
const BATTERY = [
  `the host is at ${ip(10, 1, 2, 3)} today`,
  `and ${ip(192, 168, 1, 20)}, and ${ip(172, 16, 0, 9)}, and ${ip(172, 32, 0, 9)} which is public`,
  `the UTM bridge ${ip(192, 168, 64, 5)} is exempt in a tracker body`,
  `npm semver ${ip(10, 0, 0)} and an INF decoration NTamd64.${ip(10, 0, 1)}..17763 are not addresses`,
  `scp ~/${SSH_DIR}fleet_${"ed25519"} there, and ${SSH_DIR}id_rsa too`,
  `the token sits in ${CREDENTIAL_DIR}gh-token on the box`,
  `run ${CONTAINER_HOP} 101 -- bash, never \`${CONTAINER_HOP}\` alone`,
  "a clean sentence about nothing",
];

test("#2658: the tool's policy and the product's AGREE on every input of a battery (allLeaksIn and leakRefusalReason)", () => {
  let flagged = 0;
  for (const text of BATTERY) {
    assert.deepEqual(allLeaksIn(text), productAllLeaksIn(text), `allLeaksIn disagrees on: ${text}`);
    assert.equal(leakRefusalReason(text), productRefusal(text), `leakRefusalReason disagrees on: ${text}`);
    if (allLeaksIn(text).length > 0) flagged += 1;
  }
  assert.ok(flagged >= 6, "too few battery inputs were flagged, so agreement on the rest could be agreement on nothing");
  assert.equal(leakRefusalReason(BATTERY[2]), null, "the tracker's one exempt /24 still passes");
  assert.equal(leakRefusalReason(BATTERY[7]), null);
});

test("#2658: assertNoLeakInArgv throws for a leaking `gh` body and not for another program or a clean body", () => {
  assert.throws(() => assertNoLeakInArgv("gh", ["issue", "comment", "--body", `see ${CREDENTIAL_DIR}gh-token`]), /REFUSING/);
  assert.throws(() => assertNoLeakInArgv("gh", ["api", "-f", `body=run ${CONTAINER_HOP} 101`]), /REFUSING/);
  assert.doesNotThrow(() => assertNoLeakInArgv("svn", ["commit", "-m", ip(10, 1, 2, 3)]), "another program's argv is not a body");
  assert.doesNotThrow(() => assertNoLeakInArgv("gh", ["issue", "comment", "--body", "a clean sentence"]));
});

// ---- 4. the reader's new field -------------------------------------------------------------------------------------------

const DECLARATION_TEXT = readFileSync(join(REPO_ROOT, PROJECT_DECLARATION_PATH), "utf8");
const declarationWith = (change: (declaration: Record<string, unknown>) => void): string => {
  const declaration = JSON.parse(DECLARATION_TEXT) as Record<string, unknown>;
  change(declaration);
  return JSON.stringify(declaration);
};

function refusedField(text: string): string | null {
  try {
    parseProjectDeclaration(text, "fixture/project.json");
    return null;
  } catch (error) {
    if (error instanceof ProjectDeclarationRefusal) return error.field;
    throw error;
  }
}

test("#2658: the declaration's leakPatterns are read, an absent field is an empty list, and each malformed one is refused naming the entry", () => {
  assert.equal(refusedField(DECLARATION_TEXT), null, "the unmutated base is valid: each refusal below is for its own change");
  assert.equal(parseProjectDeclaration(DECLARATION_TEXT).leakPatterns.length, 2);
  assert.deepEqual(parseProjectDeclaration(declarationWith((d) => delete d.leakPatterns)).leakPatterns, []);
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = "pct exec"; })), "leakPatterns");
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = ["pct exec"]; })), "leakPatterns[0]");
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = [{ pattern: "x" }]; })), "leakPatterns[0].name");
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = [{ name: "", pattern: "x" }]; })), "leakPatterns[0].name");
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = [{ name: "n", pattern: 3 }]; })), "leakPatterns[0].pattern");
  assert.equal(refusedField(declarationWith((d) => { d.leakPatterns = [{ name: "n", pattern: "(" }]; })), "leakPatterns[0].pattern");
});

test("#2658: a second project's declaration carries none of a11ign's leak patterns", () => {
  const second = declarationWith((d) => { d.leakPatterns = [{ name: "an internal host", pattern: "corp\\.internal" }]; });
  const patterns = parseProjectDeclaration(second).leakPatterns;
  assert.deepEqual(patterns, [{ name: "an internal host", pattern: "corp\\.internal" }]);
  assert.ok(!JSON.stringify(patterns).includes("a11y-witness"));
});
