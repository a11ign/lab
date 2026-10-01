/**
 * #2623 (child 5 of #69): THE EXTRACTION'S OWN TEST (ADR 0040, decision 8's fixture-project pattern).
 *
 * Five claims the row's Acceptance names, each with a fixture positive control beside it, plus two more
 * (2b, 2c) added 2026-09-28 after live rehearsal dispatches found gaps claim 2 does not cover:
 *
 *   1. No import in the EXTRACTED tree (`packages/agent-org` copied out as its own root, exactly what
 *      `git filter-repo --path-rename` produces) resolves outside it. THE CONTROL: the same walk over a
 *      fixture tree with one import crossing the boundary REFUSES, naming both the file and the target.
 *   2. Nothing outside `packages/agent-org` and `packages/lab` (whose own fate decision 4 already tracks
 *      by a re-run count, amended on this row twice) reaches into the package by a relative path. Measured
 *      today: SIX files do (five at `510f21c4a`, plus `scripts/agent-org-extraction-rehearsal.mjs` once
 *      #2765 landed it), all named below rather than silently allowed --
 *      `@a11ign/agent-org` does not resolve yet (no consumer declares it, so pnpm never links it: checked
 *      directly, no `node_modules/@a11ign/agent-org`), so every current consumer, however permanent,
 *      necessarily reaches it by a relative path, and "the old path LEFT WIRED" (the row's own prose) may
 *      mean this is intentional rather than a defect. None of the six are in this row's
 *      Region. Posted to the row, 2026-09-28: product-manager rules whether the Acceptance bullet means
 *      "zero, always" (these need rewiring, in this row or a sibling one) or "zero NEW ones" (this
 *      list is the transitional baseline).
 *   2b. Claim 2 exempts `packages/lab` wholesale, trusting decision 4's own re-run count to track its
 *      fate -- but that formula (`travellingLabTestFiles()`, `scripts/agent-org-extraction-rehearsal.mjs`,
 *      now committed on `main` as of #2765) only says WHICH lab files travel, not that every one of them
 *      can actually be moved: `extractionPathRenames()` can only rename a travelling file that already
 *      lives under `packages/lab/src/packaging/`. A live rehearsal dispatch (run 36415569320, 2026-09-28)
 *      crashed on `packages/lab/src/training/field-role.test.ts`, which claim 2 could not have caught.
 *      THE CONTROL: `extractionPathRenames()` called directly on a synthetic path outside that directory
 *      REFUSES, naming it.
 *   2c. Claim 2b fixed the CRASH; it does not prove the REWRITE is correct. `git filter-repo --path-rename`
 *      moves a file's PATH, never rewrites what is WRITTEN inside it -- a travelling test moved from
 *      `packages/lab/src/packaging/X.test.ts` to `src/packaging/X.test.ts` still contains the literal
 *      string that resolved to `packages/agent-org/src/Y.mjs` from its OLD location, which resolves
 *      outside the extracted tree entirely from the new one. A live rehearsal dispatch (run 36422620851,
 *      2026-09-28, against the merged `main` this row's own PR #2773 produced) found exactly this: 281
 *      outward imports remained after the rename, 238 of them this exact class. `travellingImportRewrites()`
 *      fixes it with a `git filter-repo --replace-text` pass. THE CONTROL: a fixture pair of files at
 *      DIFFERENT depths gets a DIFFERENT rewrite prefix each, proving the fix is not hardcoded to today's
 *      one shared depth.
 *   3. The package, installed at an arbitrary path and pointed at a project via `host.json`'s `checkout`
 *      (decision 3's actual mechanism -- `HOME_CHECKOUT`'s directory-depth math is explicitly the
 *      transitional in-tree case only, `project-config.mjs`'s own header says so), resolves THAT project's
 *      values and none of a11ign's. THE CONTROL: the fixture project's values are asserted different from
 *      a11ign's own, read through the same reader.
 *   4. The extracted tree carries `LICENSE` and a `license` field of `Apache-2.0`, and ADR 0040 decision
 *      7's relicensing check (no import of a copyleft package, the `license` field itself Apache-2.0) is
 *      re-run over it. THE CONTROL: a fixture tree that still declares `AGPL-3.0-or-later` is REFUSED
 *      naming the field.
 *   5. The numeric pins the move touches are re-derived, not trusted from the ADR or a stale row comment:
 *      `npm run test:org`'s `--min=300` floor (unchanged by this row -- nothing is deleted from `lab` yet,
 *      "the old path LEFT WIRED") is read out of `package.json` and checked against a live count, and
 *      decision 4's own travelling/divided counts are re-run and compared to the row's currently recorded
 *      ones rather than a number typed once.
 *
 * WHY A COPY OF THE REAL TREE, NOT A HAND-WRITTEN FIXTURE, FOR CLAIM 1. `packages/agent-org` is exactly
 * what `git filter-repo --path-rename packages/agent-org/src/:src/ ...` (etc.) produces once run for real
 * (`scripts/agent-org-extraction-rehearsal.mjs`, on `main` via #2765 but still outside this row's own
 * Region): copying it to a fresh root and walking THAT is a truer rehearsal than asserting properties of
 * the source tree in place,
 * and it is what would have caught `git filter-repo`'s own "Unexpected object of type tree" class of defect
 * if this were a content bug rather than a path one (`scripts/history-purge-rehearsal.mjs`'s incident).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { parseHostConfig } from "../../../agent-org/src/host-config.mjs";
import { homeProjectDeclaration, readProjectDeclaration } from "../../../agent-org/src/project-config.mjs";
import {
  extractionPathRenames,
  replaceTextFileContent,
  travellingImportRewrites,
  travellingLabTestFiles,
} from "../../../../scripts/agent-org-extraction-rehearsal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const PACKAGE_DIR = join(REPO_ROOT, "packages/agent-org");

/** ASYNC and awaits `body`: a synchronous `return body(root)` would let `finally` delete `root` before an async body finished using it. */
async function withFixture<T>(files: Record<string, string>, body: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "agent-org-extraction-"));
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

// ---- 1. no import in the extracted tree resolves outside it --------------------------------------------

const IMPORT = /(?:from|import\s*\()\s*["']([^"']+)["']/g;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const SOURCE_FILE = /\.(mjs|ts|js)$/;

type Edge = { file: string; specifier: string };

function sourceFilesUnder(root: string, dir = "."): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...sourceFilesUnder(root, rel));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

/** Whether an import written in `file` (repo-relative to a tree ROOTED at itself) reaches outside that tree. */
function crossesTreeBoundary(file: string, specifier: string): boolean {
  if (specifier.startsWith("@a11ign/")) return true; // an extracted single-package tree publishes nothing under it
  if (!specifier.startsWith(".")) return false; // node: builtin, or a real npm dependency
  return posix.normalize(posix.join(posix.dirname(file), specifier)).startsWith("..");
}

/** Every import in a tree rooted at `root` itself that resolves outside `root`. */
function outsideTreeEdges(root: string): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFilesUnder(root)) {
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const match of code.matchAll(IMPORT)) {
      if (crossesTreeBoundary(file, match[1])) edges.push({ file, specifier: match[1] });
    }
  }
  return edges;
}

test("decision 4's walk, over the EXTRACTED tree (packages/agent-org copied out as its own root): 0 edges", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-org-extracted-"));
  try {
    cpSync(PACKAGE_DIR, root, { recursive: true });
    const files = sourceFilesUnder(root);
    assert.ok(files.length > 100, `too few files under the copied tree (${files.length}): the walk read the wrong place`);
    assert.deepEqual(outsideTreeEdges(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("control: a fixture tree with ONE import crossing the boundary is found, naming the file and the target", async () => {
  const edges = await withFixture({
    "src/inside.mjs": 'import { a } from "./sibling.mjs";\nexport const b = a;\n',
    "src/sibling.mjs": "export const a = 1;\n",
    "src/deep/reach.mjs": 'import { x } from "../../../outside.mjs";\nexport const y = x;\n',
  }, outsideTreeEdges);
  assert.deepEqual(edges, [{ file: "src/deep/reach.mjs", specifier: "../../../outside.mjs" }]);
});

test("control: an `@a11ign/` specifier is an edge even with no relative path, and a comment-only mention is not", async () => {
  const edges = await withFixture({
    "src/a.mjs": 'import { f } from "@a11ign/worker-fleet/cli-flags";\nexport { f };\n',
    "src/b.mjs": '// import { g } from "../../outside.mjs";\nexport {};\n',
  }, outsideTreeEdges);
  assert.deepEqual(edges, [{ file: "src/a.mjs", specifier: "@a11ign/worker-fleet/cli-flags" }]);
});

// ---- 2. nothing outside agent-org+lab reaches in by a relative path ------------------------------------

/** Repo-relative source files outside `packages/agent-org` and `packages/lab` (lab's fate is decision 4's own count). */
function productSourceFiles(): string[] {
  const roots = readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name === "packages")
    .flatMap((entry) => readdirSync(join(REPO_ROOT, entry.name), { withFileTypes: true })
      .filter((pkg) => pkg.isDirectory() && !["agent-org", "lab"].includes(pkg.name))
      .map((pkg) => posix.join(entry.name, pkg.name)));
  roots.push("scripts", ".github");
  return roots.filter((dir) => existsSync(join(REPO_ROOT, dir))).flatMap((dir) => sourceFilesUnder(REPO_ROOT, dir));
}

const REACHES_IN = /(?:from|import\s*\()\s*["'](\.[^"']*agent-org\/(?:src|host)[^"']*)["']/;

/** Every product file that imports `packages/agent-org` by a relative path (never `@a11ign/agent-org`, which does not resolve yet -- finding 2 on the row). */
function relativeImportersOfAgentOrg(): string[] {
  return productSourceFiles().filter((file) => {
    const code = readFileSync(join(REPO_ROOT, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    return REACHES_IN.test(code);
  }).sort();
}

/**
 * Measured 2026-09-28 at `510f21c4a` (row comment, same timestamp): five files, none in this row's Region,
 * so named and bounded rather than silently allowed to grow. A sixth, `scripts/agent-org-extraction-
 * rehearsal.mjs`, landed on `main` afterward (#2765, decision 6's own rehearsal script) -- same category
 * as the other four `scripts/*.mjs` entries here, so added rather than treated as a new class of finding.
 */
const KNOWN_RELATIVE_IMPORTERS = [
  "packages/control/src/fleet-playbook.mjs",
  "scripts/agent-org-extraction-rehearsal.mjs",
  "scripts/npm-token-liveness.mjs",
  "scripts/release-reuses-verdict.mjs",
  "scripts/repo-identity.mjs",
  "scripts/split-baseline.mjs",
].sort();

test("nothing outside packages/agent-org and packages/lab imports the package by a relative path, beyond the named exception", () => {
  const found = relativeImportersOfAgentOrg();
  assert.ok(found.length > 0, "the scan found nothing: POSITIVE CONTROL below proves it can, so an empty real reading here is suspicious");
  assert.deepEqual(found, KNOWN_RELATIVE_IMPORTERS, `a NEW relative importer appeared, or the known one was fixed: ${found.join(", ")}`);
});

test("control: the relative-import scan finds a fixture violator and ignores a comment-only mention", async () => {
  const found = await withFixture({
    "packages/widgets/src/a.mjs": 'import { x } from "../../agent-org/src/thing.mjs";\nexport { x };\n',
    "packages/widgets/src/b.mjs": '// import { y } from "../../agent-org/src/other.mjs";\nexport {};\n',
  }, (root) => sourceFilesUnder(root, "packages/widgets").filter((file) => {
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    return REACHES_IN.test(code);
  }));
  assert.deepEqual(found, ["packages/widgets/src/a.mjs"]);
});

// ---- 2b. every file decision 4's own formula selects to TRAVEL can actually be path-renamed --------------
//
// Claim 2 above deliberately exempts `packages/lab` (its own fate is decision 4's re-run count, not this
// file's business) -- but decision 4's formula (`travellingLabTestFiles()`) does not itself guarantee that
// every file it selects lives under `packages/lab/src/packaging/`, the one directory
// `extractionPathRenames()` (both in `scripts/agent-org-extraction-rehearsal.mjs`) knows how to rename.
// Found the hard way, not by inspection: the real rehearsal dispatch (run 36415569320, row #2623,
// 2026-09-28) CRASHED on `packages/lab/src/training/field-role.test.ts`, a leftover relative import
// (`9eb846790`'s WIP move) that claim 2's own exemption let through silently. This is the permanent,
// repo-wide version of that catch -- run at every claim, not discovered again by a live dispatch.

test("every file travellingLabTestFiles() selects already lives under packages/lab/src/packaging/, so extractionPathRenames() does not crash", () => {
  const travelling = travellingLabTestFiles(REPO_ROOT);
  assert.ok(travelling.length > 50, `too few travelling files (${travelling.length}): the scan is reading the wrong tree`);
  const misplaced = travelling.filter((file) => !file.startsWith("packages/lab/src/packaging/"));
  assert.deepEqual(misplaced, [],
    "a packages/lab file imports agent-org by a relative path and does NOT live under "
    + "packages/lab/src/packaging/ -- the field-role.test.ts/board-gates.mjs defect (row #2623) again: "
    + "either give it a local copy of what it imports, or move it under packages/lab/src/packaging/ if it "
    + "genuinely belongs to the extracted tree");
  assert.doesNotThrow(() => extractionPathRenames(travelling));
});

test("control: extractionPathRenames() REFUSES a travelling file outside packages/lab/src/packaging/, naming it", () => {
  assert.throws(
    () => extractionPathRenames(["packages/lab/src/training/not-packaging.mjs"]),
    /not a packages\/lab\/src\/packaging\/ path: packages\/lab\/src\/training\/not-packaging\.mjs/,
  );
});

// ---- 2c. the travelling files' own relative imports get rewritten to their NEW depth, not just moved ----
//
// `extractionPathRenames()` (claim 2b) only proves the FILE can be renamed without crashing -- it says
// nothing about what is written INSIDE it. Found live, not by inspection: run 36422620851 (2026-09-28,
// against the `main` PR #2773 of this same row produced) applied the rename for real via `git filter-repo`
// and found 238 of 281 outward imports were exactly this -- a travelling test's own `../../../agent-org/
// src/...` import, unchanged by the path rename, now resolving outside the tree from its new home.

test("travellingImportRewrites() computes the live tree's one shared depth correctly", () => {
  const labFiles = travellingLabTestFiles(REPO_ROOT);
  assert.ok(labFiles.length > 50, `too few travelling files (${labFiles.length}): reading the wrong tree`);
  const rewrites = travellingImportRewrites(labFiles);
  assert.deepEqual(rewrites, [{ old: "../../../agent-org/src/", replacement: "../" }]);
});

test("applying the live rewrite to every travelling file's real content leaves zero agent-org-outward imports", () => {
  const labFiles = travellingLabTestFiles(REPO_ROOT);
  const rewrites = travellingImportRewrites(labFiles);
  const stillOutward: string[] = [];
  for (const file of labFiles) {
    let code = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const { old, replacement } of rewrites) code = code.split(old).join(replacement);
    const newFile = `src/packaging/${file.replace(/^packages\/lab\/src\/packaging\//, "")}`;
    const lines = code.split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const match of lines.matchAll(IMPORT)) {
      const specifier = match[1];
      // claim 2c is about THIS class only (agent-org's OWN src/host); guards/scripts/`.agent-org/` are a
      // separate, already-reported finding -- `agent-org\/(?:src|host)` (not bare "agent-org/") keeps the
      // hidden `.agent-org/plugins/` config directory out, which the substring "agent-org/" alone would catch.
      if (!/agent-org\/(?:src|host)\//.test(specifier)) continue;
      const target = posix.normalize(posix.join(posix.dirname(newFile), specifier));
      if (target.startsWith("..")) stillOutward.push(`${newFile} -> ${specifier}`);
    }
  }
  assert.deepEqual(stillOutward, []);
});

test("control: travellingImportRewrites() gives files at DIFFERENT depths their OWN rewrite, not one hardcoded prefix", () => {
  const rewrites = travellingImportRewrites([
    "packages/lab/src/packaging/a.test.ts",
    "packages/lab/src/packaging/sub/b.test.ts",
  ]);
  assert.deepEqual(
    [...rewrites].sort((left, right) => left.old.length - right.old.length),
    [
      { old: "../../../agent-org/src/", replacement: "../" },
      { old: "../../../../agent-org/src/", replacement: "../../" },
    ],
  );
});

test("replaceTextFileContent() renders one `old==>replacement` line per pair, literal, for git filter-repo --replace-text", () => {
  assert.equal(
    replaceTextFileContent([{ old: "../../../agent-org/src/", replacement: "../" }]),
    "../../../agent-org/src/==>../\n",
  );
});

// ---- 3. installed at a scratch path, pointed at a project by host.json's checkout ----------------------

const FIXTURE_PROJECT = {
  schema: 1,
  tracker: [{ key: "", repo: "acme-corp/widgets", board: { owner: "acme-corp", number: 7 } }],
  code: [{ key: "", repo: "acme-corp/widgets" }],
};

// Deliberately NOT under `/home/` -- control-plane-checkout-is-one-fact.test.ts reads any
// `/home/<account>/<segment>` literal in tracked source as a possible hardcoded real machine path
// (#1990: the account is matched, not named), and this fixture represents no real machine at all.
const FIXTURE_HOST = {
  schema: 1,
  home: "/fixture-root",
  binDir: "/fixture-root/.local/bin",
  primary: "fixture",
  projects: [{ id: "fixture", checkout: "" }], // filled in per-test with the scratch checkout
  gh: { workers: "/fixture-root/gh-workers", leads: "/fixture-root/gh-leads", leadsHeader: [], leadsWorkspaces: [] },
};

/** A scratch checkout: its own `.agent-org/project.json`, nothing else -- decision 3's "pointed at a project". */
function withScratchProject<T>(body: (checkout: string) => T | Promise<T>): Promise<T> {
  return withFixture({ ".agent-org/project.json": JSON.stringify(FIXTURE_PROJECT) }, body);
}

test("a project reached through host.json's checkout resolves ITS values, read by the real installed module", async () => {
  await withScratchProject((checkout) => {
    const host = parseHostConfig(JSON.stringify({ ...FIXTURE_HOST, projects: [{ id: "fixture", checkout }] }), "fixture/host.json");
    const project = host.projects.find((p) => p.id === host.primary);
    assert.ok(project, "the fixture host must declare its own primary project");
    const declaration = readProjectDeclaration(project.checkout);
    assert.equal(declaration.repo, "acme-corp/widgets");
    assert.equal(declaration.boardOwner, "acme-corp");
    assert.equal(declaration.boardNumber, 7);
  });
});

test("control: the fixture project's values are asserted different from a11ign's own, read through the same reader", async () => {
  const a11ign = homeProjectDeclaration();
  await withScratchProject((checkout) => {
    const fixture = readProjectDeclaration(checkout);
    assert.notEqual(fixture.repo, a11ign.repo);
    assert.notEqual(fixture.boardOwner, a11ign.boardOwner);
    assert.notEqual(fixture.boardNumber, a11ign.boardNumber);
    assert.ok(!JSON.stringify(fixture).includes("a11ign"), "the fixture project's answer must carry nothing of a11ign's");
  });
});

test("the reader is INDEPENDENT of where it is installed: a copy of the real module, placed at an arbitrary path, resolves the same values", async () => {
  await withScratchProject(async (checkout) => {
    const installDir = mkdtempSync(join(tmpdir(), "agent-org-installed-"));
    try {
      const modulePath = join(installDir, "project-config.mjs");
      cpSync(join(PACKAGE_DIR, "src/project-config.mjs"), modulePath);
      const installed = await import(pathToFileURL(modulePath).href);
      const declaration = installed.readProjectDeclaration(checkout);
      assert.equal(declaration.repo, "acme-corp/widgets");
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });
});

// ---- 4. LICENSE, the `license` field, and decision 7's relicensing re-check -----------------------------

/** SPDX identifiers a package copied out under Apache-2.0 must not import. Mirrors `licence-boundary.test.ts`'s COPYLEFT set. */
const COPYLEFT_PACKAGES = ["guards", "lab", "control", "worker-fleet", "nvda-speech"];

type RelicensingRefusal = { field: string; message: string };

/** ADR 0040 decision 7's re-check: the manifest's `license` field, and no import of a copyleft package -- either REFUSES naming the field. */
function relicensingCheck(root: string): RelicensingRefusal | null {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { license?: string };
  if (manifest.license !== "Apache-2.0") {
    return { field: "license", message: `package.json's \`license\` is ${JSON.stringify(manifest.license)}, not "Apache-2.0"` };
  }
  for (const file of sourceFilesUnder(root, "src")) {
    const code = readFileSync(join(root, file), "utf8").split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
    for (const match of code.matchAll(IMPORT)) {
      const hit = COPYLEFT_PACKAGES.find((name) => match[1].includes(`/${name}/`) || match[1] === `@a11ign/${name}`);
      if (hit) return { field: file, message: `${file} imports \`${match[1]}\`, a copyleft (${hit}) package` };
    }
  }
  return null;
}

test("the extracted tree carries LICENSE (Apache-2.0, not truncated) and package.json's license field matches", () => {
  const licensePath = join(PACKAGE_DIR, "LICENSE");
  assert.ok(existsSync(licensePath), "packages/agent-org/LICENSE is missing");
  assert.ok(statSync(licensePath).size > 10_000, "packages/agent-org/LICENSE looks truncated, not the full Apache-2.0 text");
  assert.match(readFileSync(licensePath, "utf8"), /Apache License\s+Version 2\.0/);
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as { license?: string };
  assert.equal(manifest.license, "Apache-2.0");
});

test("decision 7's relicensing check, re-run over packages/agent-org today: no AGPL/copyleft import, refuses nothing", () => {
  assert.equal(relicensingCheck(PACKAGE_DIR), null);
});

test("control: a fixture tree still declaring AGPL-3.0-or-later is REFUSED naming `license`", async () => {
  const refusal = await withFixture({
    "package.json": JSON.stringify({ name: "@a11ign/agent-org", license: "AGPL-3.0-or-later" }),
    "src/a.mjs": "export const x = 1;\n",
  }, relicensingCheck);
  assert.equal(refusal?.field, "license");
});

test("control: a fixture tree with the right license field but a copyleft import is REFUSED naming the file", async () => {
  const refusal = await withFixture({
    "package.json": JSON.stringify({ name: "@a11ign/agent-org", license: "Apache-2.0" }),
    "src/a.mjs": 'import { x } from "../../guards/src/thing.mjs";\nexport { x };\n',
  }, relicensingCheck);
  assert.equal(refusal?.field, "src/a.mjs");
});

// ---- 5. the numeric pins the move touches, re-derived ----------------------------------------------------

test("npm run test:org's --min floor, read out of package.json, is still met by a live count (this row deletes nothing from lab yet)", () => {
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
  const script = scripts["test:org"];
  assert.ok(script, "package.json lost its test:org script");
  const min = Number(/--min=(\d+)/.exec(script)?.[1]);
  assert.ok(Number.isInteger(min) && min > 0, `could not read a --min=<n> floor out of: ${script}`);
  const glob = /"([^"]+\.test\.ts)"/.exec(script)?.[1];
  assert.ok(glob, `could not read the glob out of: ${script}`);
  const packagesInGlob = glob.split("/").slice(1)[0]?.replace(/[{}]/g, "").split(",") ?? [];
  const liveCount = packagesInGlob
    .flatMap((name) => sourceFilesUnder(REPO_ROOT, `packages/${name}/src`))
    .filter((file) => file.endsWith(".test.ts")).length;
  assert.ok(liveCount >= min, `live count ${liveCount} is BELOW the declared floor ${min}: the floor is already broken, independent of this row`);
});

/** Decision 4's own re-runnable population, re-derived here rather than trusted from the row body's prose. */
function decision4Counts(): { total: number; divided: number } {
  const productPattern = /(\.\.\/)+(evidence|judge|cli|worker-fleet|nvda-worker|nvda-speech|scorer|control|pdf)\/|@a11ign\/(evidence|judge|cli|worker-fleet|nvda-worker|scorer|control|pdf)/;
  const files = sourceFilesUnder(REPO_ROOT, "packages/lab").filter((file) => {
    const code = readFileSync(join(REPO_ROOT, file), "utf8");
    return /(from|import\().*agent-org\/(src|host)/.test(code);
  });
  const divided = files.filter((file) => productPattern.test(readFileSync(join(REPO_ROOT, file), "utf8"))).length;
  return { total: files.length, divided };
}

/**
 * Recorded 2026-09-28 after PR #2772 (shape 1, ceo's ruling on this row): 140 total, 16 divided (124
 * travel = 140 - 16). One less total than the prior reading (141/16) because `field-role.test.ts` no
 * longer imports `agent-org/src` by a relative path -- it now imports the local copy at
 * `packages/lab/src/training/board-gates.mjs` -- and so drops out of the t-import population entirely.
 * `divided` is unchanged: that file never matched the product pattern either before or after. This
 * file itself still counts once toward each: it imports `agent-org/src` (t-import) and, in its own
 * fixture string for the `@a11ign/` control above, the literal `"@a11ign/worker-fleet/cli-flags"`
 * (t-product) -- the same "matches inside a fixture string, not a real import" false positive the
 * row's finding 1 already named.
 * 2026-09-30, #2729: 141 total, 17 divided. ONE file, `lab-job-finished.test.ts`, is both: it imports `agent-org/src` (the gate's
 * reader and order builder) and reads `control/ansible/tasks/run-job.yml` by relative path (the playbook whose record they
 * consume). It is a REAL divided file rather than a fixture-string false positive -- the two packages cannot import each other,
 * so a contract between them can only be tested from `lab`. Re-derived by running this test, not inferred.
 * 2026-09-30, #2793, on top of #2729's (child 5b of #2623): 142 total, 17 divided. One MORE total, because the row's own
 * Acceptance names a new test, `host-tool-install.test.ts`, which imports `agent-org/src` (t-import) and matches no product pattern, so
 * `divided` is unchanged. A test of the tool's source cannot avoid this edge, so the count moves with the row that adds the test.
 * 2026-09-30, #2799 (child 5c of #2623): 143 total, 17 divided. One MORE total, `host-state-dir-wiring.test.ts`, which imports `agent-org/src`
 * (t-import) and matches no product pattern -- the same reason as #2793's line above. Re-derived by running this test, not inferred.
 * 2026-10-01, #2849 (child 5d-0 of #69), on top of #2848's 144: 146 total, 17 divided. Two MORE totals, `shadow-reads.test.ts` and `shadow-reads-round-trip.test.ts`, which each import `agent-org/src` (t-import) and
 * match no product pattern -- the same reason as #2793's and #2799's lines above. Re-derived by running this test, not inferred.
 * Grows or shrinks with real PRs; a mismatch here means product-manager owes another amendment, not that
 * this test is wrong.
 */
// 2026-10-01, #2848: 144 total, 17 divided. One MORE total, `repeating-lines.test.ts`, which imports `agent-org/src` (the detector and the gate) and
// nothing from the product, so it is not divided. A test of the tool's source cannot avoid the edge, so the count moves with the row that adds it.
const RECORDED_DECISION_4 = { total: 146, divided: 17 };

test("decision 4's total/divided counts, re-derived, match the row's currently-amended reading", () => {
  const counts = decision4Counts();
  assert.ok(counts.total > 100, `too few files found (${counts.total}): the scan is reading the wrong tree`);
  assert.deepEqual(counts, RECORDED_DECISION_4, "decision 4's population drifted again: report to the row before trusting this file's other assertions");
});

// ---- 6. the workflow's push job (#2789) ---------------------------------------------------------------
//
// Run 36676106251 (2026-09-30, the real push) failed at step 3b with HTTP 422 `Invalid property /rules/0:
// data matches no possible input`: the ruleset body carried `pull_request` with one parameter and
// `merge_queue` with none, where GitHub requires the full set. It had also pushed `--all`, putting 20
// non-`main` branches into the PUBLIC repository, and a second dispatch would have pushed into a
// non-empty one. Nothing here can run the workflow, so each claim is pinned against its TEXT, with a
// control that the reader notices the defect it exists for.

const WORKFLOW = ".github/workflows/agent-org-extraction.yml";
const RULESET_FIXTURE = join(HERE, "fixtures/merge-queue-main-ruleset-rules.json");

type WorkflowStep = { name?: string; run?: string };

function pushJobSteps(workflowText: string): WorkflowStep[] {
  const steps = (parse(workflowText) as { jobs?: { push?: { steps?: WorkflowStep[] } } }).jobs?.push?.steps;
  assert.ok(steps && steps.length > 0, "the workflow has no `push` job steps: the reader is looking at the wrong shape");
  return steps;
}

function stepIndex(steps: WorkflowStep[], namePrefix: string): number {
  const index = steps.findIndex((step) => step.name?.startsWith(namePrefix));
  assert.ok(index >= 0, `no push-job step is named "${namePrefix}..."`);
  return index;
}

/** The JSON a step feeds `gh api --input -` through a quoted heredoc. */
function heredocJson(step: WorkflowStep): { rules: unknown[] } {
  const body = /<<'JSON'\n([\s\S]*?)\n\s*JSON\s*$/.exec(step.run ?? "")?.[1];
  assert.ok(body, `step "${step.name}" has no <<'JSON' heredoc`);
  return JSON.parse(body) as { rules: unknown[] };
}

/** Rules compared as a set by `type`: GitHub does not order them and neither should this test. */
function rulesByType(rules: unknown[]): unknown[] {
  return [...(rules as { type: string }[])].sort((a, b) => a.type.localeCompare(b.type));
}

function step3bRules(workflowText: string): unknown[] {
  const steps = pushJobSteps(workflowText);
  return heredocJson(steps[stepIndex(steps, "Step 3b")]).rules;
}

const fixtureRules = (): unknown[] => JSON.parse(readFileSync(RULESET_FIXTURE, "utf8")) as unknown[];

test("step 3b's ruleset rules are exactly a11ign/a11ign's ruleset 23681721 (the fixture), parameters and all", () => {
  const rules = step3bRules(readFileSync(join(REPO_ROOT, WORKFLOW), "utf8"));
  assert.deepEqual(rulesByType(rules), rulesByType(fixtureRules()));
});

test("control: the fixture is not vacuous, and the ABBREVIATED body that got a 422 is refused by the same comparison", () => {
  const fixture = fixtureRules() as { type: string; parameters?: Record<string, unknown> }[];
  assert.deepEqual(fixture.map((rule) => rule.type).sort(), ["merge_queue", "pull_request"]);
  assert.ok(Object.keys(fixture.find((rule) => rule.type === "merge_queue")?.parameters ?? {}).length > 1, "the fixture's merge_queue lost its parameters");
  const abbreviated = readFileSync(join(REPO_ROOT, WORKFLOW), "utf8").replace(
    /"rules": \[[\s\S]*?\n\s*\]\n(\s*\}\n\s*JSON)/,
    `"rules": [
              { "type": "pull_request", "parameters": { "required_approving_review_count": 1 } },
              { "type": "merge_queue" }
            ]
$1`,
  );
  assert.notEqual(abbreviated, readFileSync(join(REPO_ROOT, WORKFLOW), "utf8"), "the control's rewrite did not apply, so it proves nothing");
  assert.notDeepEqual(rulesByType(step3bRules(abbreviated)), rulesByType(fixtureRules()));
});

/** The `git push` line of the step named `Step 2`, flattened across its `\` continuations. */
function step2PushCommand(workflowText: string): string {
  const steps = pushJobSteps(workflowText);
  const run = (steps[stepIndex(steps, "Step 2")].run ?? "").replace(/\\\n\s*/g, " ");
  const push = run.split("\n").find((line) => /\bgit\b.*\bpush\b/.test(line));
  assert.ok(push, "step 2 has no `git push` line");
  return push;
}

/** The refspecs a push command names: everything after the URL that is not a flag. */
function pushedRefs(command: string): string[] {
  return command.split(/\s+/).slice(command.split(/\s+/).findIndex((word) => word.startsWith('"https://')) + 1).filter((word) => !word.startsWith("-"));
}

test("step 2 pushes ONE ref, refs/heads/main, and names no flag that pushes more (never --all, --mirror, --tags)", () => {
  const command = step2PushCommand(readFileSync(join(REPO_ROOT, WORKFLOW), "utf8"));
  assert.deepEqual(pushedRefs(command), ["refs/heads/main:refs/heads/main"]);
  assert.doesNotMatch(command, /--(all|mirror|tags|follow-tags)\b/);
});

test("control: the push reader refuses `--all`, a mirror push, and a second refspec", () => {
  const url = '"https://x-access-token:${T}@github.com/a11ign/agent-org.git"';
  const allBranches = `git -C /tmp/x push ${url} --all`;
  assert.deepEqual(pushedRefs(allBranches), [], "`--all` names no ref, so the ONE-ref assertion must fail on it");
  assert.match(allBranches, /--(all|mirror|tags|follow-tags)\b/);
  assert.match(`git push ${url} --mirror`, /--(all|mirror|tags|follow-tags)\b/);
  assert.deepEqual(pushedRefs(`git push ${url} refs/heads/main:refs/heads/main refs/heads/agent/x:refs/heads/agent/x`).length, 2);
});

test("the push job refuses a non-empty a11ign/agent-org BEFORE its first write, and a failed read refuses too", () => {
  const steps = pushJobSteps(readFileSync(join(REPO_ROOT, WORKFLOW), "utf8"));
  const refuse = stepIndex(steps, "Refuse when a11ign/agent-org is not empty");
  for (const write of ["Step 1", "Step 2", "Step 3a", "Step 3b"]) {
    assert.ok(refuse < stepIndex(steps, write), `the emptiness refusal must run before ${write}`);
  }
  const run = steps[refuse].run ?? "";
  assert.match(run, /git ls-remote\b/, "the refusal must READ the target's refs");
  assert.match(run, /if ! FOUND=\$\(git ls-remote/, "a failed read must be caught, not treated as empty");
  assert.match(run, /if \[ -n "\$FOUND" \]/, "any ref found must refuse");
  assert.equal((run.match(/exit 1/g) ?? []).length, 2, "both the failed read and the non-empty target must exit non-zero");
  assert.match(run, /\$FOUND"?\n/, "the refusal must NAME what it found");
});

test("control: a workflow that drops the emptiness refusal is noticed by the ordering read", () => {
  const text = readFileSync(join(REPO_ROOT, WORKFLOW), "utf8").replace("Refuse when a11ign/agent-org is not empty", "Some other step");
  assert.throws(() => stepIndex(pushJobSteps(text), "Refuse when a11ign/agent-org is not empty"), /no push-job step is named/);
});
