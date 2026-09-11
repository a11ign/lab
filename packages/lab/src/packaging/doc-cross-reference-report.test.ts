/**
 * #905: the nightly doc cross-reference report -- `scripts/doc-cross-reference-report.mjs`.
 *
 * The fourteen checks it runs are the SAME modules the pull-request tests assert on, so this file does not
 * re-test any check's rule. It tests what only the report adds, and the three ways a report like this lies:
 *
 *   - it names a disagreement without saying WHERE, so nobody can act on it;
 *   - it reads nothing and says "clean" -- the examined-nothing failure this repo keeps paying for;
 *   - it goes red, when it is information for a person and never a reason for a job to fail.
 *
 * Every fixture here is a temporary directory handed to `--root`, so no test reads the real tree's docs, and
 * none contains a URL naming the product repository -- `check-transfer-urls` would otherwise fetch it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CHECKS, headline, renderReport, runChecks } from "../../../../scripts/doc-cross-reference-report.mjs";
import {
  alwaysRunTests, discoverTestFiles, discoversFromTree, packageIndex, sourceClosure,
} from "../../../../scripts/select-changed-tests.mjs";
import { knownPackages } from "../../../../scripts/ci-changed.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const REPORT = join(REPO, "scripts/doc-cross-reference-report.mjs");

/** A throwaway tree holding exactly `files`; removed when `body` returns. */
async function withTree(files: Record<string, string>, body: (root: string) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(), "doc-xref-report-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The report as the nightly workflow would post it: the real command, the real exit status. */
function runReport(root: string) {
  return spawnSync(process.execPath, [REPORT, `--root=${root}`], { encoding: "utf8", timeout: 120_000 });
}

/** The rows of one check's disagreement table. */
function sectionRows(report: string, check: string): string[] {
  const start = report.indexOf(`### ${check} -- `);
  if (start === -1) return [];
  const rest = report.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith("| `"));
}

test("the registry is the fourteen, and each check's pull-request test asserts on the same module", () => {
  assert.equal(CHECKS.length, 14, "product-manager's ruling on #905 names fourteen group-3 checks");
  assert.equal(new Set(CHECKS.map((c) => c.name)).size, 14, "a check is registered twice");
  for (const { name, test: testFile } of CHECKS) {
    assert.ok(existsSync(join(REPO, testFile)), `${name}: its test ${testFile} does not exist`);
    // ONE COPY: the test imports the module the report runs -- `doc-checks/<name>.mjs`, or for the two whose
    // module composes an existing script, that script (`scripts/<name>.mjs`).
    const source = readFileSync(join(REPO, testFile), "utf8");
    assert.match(source, new RegExp(`scripts/(?:doc-checks/)?${name}\\.mjs"`),
      `${testFile} does not import the module the report runs for ${name} -- a second copy can drift`);
  }
});

test("every guard origin/main ran on EVERY diff still does -- the walk moved into a module, selection follows it", () => {
  // worker-judge's first head of #960 moved five guards' walks into `scripts/doc-checks/` and CI's selector
  // stopped running them on every diff: it judged the walk by the HELPER rule, where a flat `readdirSync` does
  // not count. `commands-documented` then missed the PRs it exists for (a new command script with no header),
  // which "no guard leaves the PR path" forbids. Found by worker-capture's review, by probe commit.
  const packages = knownPackages(REPO);
  const index = packageIndex(REPO, packages);
  const guards = new Set(alwaysRunTests(discoverTestFiles(REPO, packages), {
    closureOf: (testFile: string) => sourceClosure(join(REPO, testFile), REPO, index), repoRoot: REPO,
  }).map((guard) => guard.test));
  // Measured on origin/main at 45fb4194, the base this row was built on: these eight of the fourteen.
  const onMain = ["adr-index", "adr-status", "check-transfer-urls", "commands-documented", "doc-citation-integrity",
    "env-doc-coverage", "roles-memory", "schema-migration-citations"];
  const lost = CHECKS.filter((c) => onMain.includes(c.name) && !guards.has(c.test)).map((c) => c.name);
  assert.deepEqual(lost, [], "these ran on every diff on origin/main and no longer do");
  // THE CLASS, not only the eight: a check whose module discovers a population from the tree by the TEST's
  // own rule is always-run, whichever check it is -- the next one moved here included.
  for (const { name, test: testFile } of CHECKS) {
    const module = join(REPO, "scripts/doc-checks", `${name}.mjs`);
    if (!discoversFromTree(readFileSync(module, "utf8"))) continue;
    assert.ok(guards.has(testFile), `${name}'s module walks the tree, and ${testFile} is not always-run`);
  }
});

test("a disagreement is named by the file it is in and the reference that dangles", async () => {
  await withTree({
    "CLAUDE.md": "See [the guide](docs/guide.md#gone) and `docs/nowhere.md`.\n",
    "docs/guide.md": "# Present\n",
  }, async (root) => {
    const report = renderReport(await runChecks(root), { root });
    const anchors = sectionRows(report, "claude-md-links");
    assert.equal(anchors.length, 1, `expected the one broken anchor, got:\n${anchors.join("\n")}`);
    assert.match(anchors[0], /^\| `CLAUDE\.md` \| `docs\/guide\.md#gone` \|/);
    const cited = sectionRows(report, "doc-references");
    assert.ok(cited.some((row) => row.startsWith("| `CLAUDE.md` | `docs/nowhere.md` |")),
      `the dangling citation is not named by file and path:\n${cited.join("\n")}`);
  });
});

test("a tree with nothing to check reads as EXAMINED 0, never as clean", async () => {
  // The four top-level docs exist and are empty, so NO check finds a disagreement: this is the exact state in
  // which a report could say "no problems" having read nothing, and the one it must not.
  await withTree({ "README.md": "", "RELEASE.md": "", "PLAN.md": "", "CLAUDE.md": "" }, async (root) => {
    const outcomes = await runChecks(root);
    const report = renderReport(outcomes, { root });
    assert.match(headline(outcomes), /^\*\*0 disagreement\(s\)\*\* .*; 13 of them examined 0 -- a zero from those says nothing/);
    assert.match(report, /\| adr-index \| \*\*examined 0\*\* .* -- nothing to check, so no verdict \| 0 \|/);
    assert.doesNotMatch(report, /no problems|all clean|\bclean\b|\bpassed\b/i,
      "a report that read nothing must never say it found nothing wrong");
    // No git remote in a temporary directory: named, with the reason, rather than a silent zero.
    assert.match(report, /- \*\*action-reference\*\*: no git remote at /);
  });
});

test("it EXITS 0 with disagreements in it and a check that could not run -- a report, never a gate", async () => {
  await withTree({ "CLAUDE.md": "`docs/nowhere.md`\n" }, (root) => {
    const run = runReport(root);
    assert.equal(run.status, 0, `exit ${run.status}; stderr:\n${run.stderr}`);
    assert.match(run.stdout, /^## Doc cross-reference report/);
    assert.match(run.stdout, /\*\*1 could not run\*\*/);
    assert.ok(sectionRows(run.stdout, "doc-references").length > 0, "the disagreement is not in what it printed");
  });
});

test("MUTATION: every reference dangles -- every one is named, and it still exits 0", async () => {
  const paths = Array.from({ length: 12 }, (_, i) => `docs/gone-${i}.md`);
  const anchors = Array.from({ length: 5 }, (_, i) => `docs/gone-${i}.md#section-${i}`);
  await withTree({
    "README.md": "", "RELEASE.md": "", "PLAN.md": "",
    "CLAUDE.md": `${paths.map((p) => `\`${p}\``).join("\n")}\n${anchors.map((a) => `(${a})`).join("\n")}\n`,
  }, (root) => {
    const run = runReport(root);
    assert.equal(run.status, 0, `exit ${run.status}; stderr:\n${run.stderr}`);
    const cited = sectionRows(run.stdout, "doc-references");
    assert.deepEqual(cited.map((row) => /\| `CLAUDE\.md` \| `([^`]+)` \|/.exec(row)?.[1]).sort(), [...paths].sort());
    const broken = sectionRows(run.stdout, "claude-md-links");
    assert.deepEqual(broken.map((row) => /\| `CLAUDE\.md` \| `([^`]+)` \|/.exec(row)?.[1]).sort(), [...anchors].sort());
  });
});

test("a check that THROWS is named as could-not-run, and the others still report", async () => {
  const outcomes = await runChecks("/nowhere", [
    { name: "throws", test: "t.test.ts", check: () => { throw new Error("no network reach"); } },
    { name: "reads", test: "r.test.ts", check: () => ({ examined: 3, unit: "things", disagreements: [] }) },
  ]);
  assert.equal(outcomes.length, 2);
  const report = renderReport(outcomes, { root: "/nowhere" });
  assert.match(report, /- \*\*throws\*\*: no network reach/);
  assert.match(report, /\| reads \| 3 things \| 0 \|/);
  assert.match(headline(outcomes), /\*\*0 disagreement\(s\)\*\* across the 1 of 2 checks that ran; \*\*1 could not run\*\*/);
});

test("a reference carrying a backtick keeps its own cell -- a cited URL can be quoted in source", () => {
  const report = renderReport([{ name: "x", test: "x.test.ts", result: { examined: 1, unit: "urls", disagreements: [
    { where: "a.mjs:1", reference: "https://example.com/a`", why: "answered 404" }] } }], { root: "/r" });
  assert.match(report, /\| `a\.mjs:1` \| `` https:\/\/example\.com\/a` `` \| answered 404 \|/);
});
