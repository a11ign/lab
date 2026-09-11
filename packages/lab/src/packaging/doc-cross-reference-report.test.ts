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

import {
  CHECKS, COMMENT_LIMIT, fitToComment, headline, renderReport, runChecks,
} from "../../../../scripts/doc-cross-reference-report.mjs";
import {
  alwaysRunTests, discoverTestFiles, packageIndex, sourceClosure,
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

/**
 * THE SIX #954 TOOK OFF THE PULL-REQUEST PATH, named here so the retirement cannot quietly grow.
 *
 * A guard may only be retired if this report reads its rule -- that is #954's whole safety argument, and
 * #928's rule behind it: no watcher retires before its replacement has reported. The first nightly comment
 * posted 2026-09-11T07:22:56Z with all fourteen checks and their examined counts
 * (https://github.com/DanBeckDev/a11y-witness/issues/928#issuecomment-5630944729).
 *
 * The other eight keep a test on the pull-request path, because each also proves something the report does
 * not: the check's own logic against fixtures, or a rule that is not a cross-reference at all.
 */
const RETIRED_TO_THE_NIGHTLY_REPORT = [
  "action-reference", "adr-status", "doc-citation-integrity", "doc-references", "env-doc-coverage",
  "not-working-numbering",
];

test("every guard retired from the pull-request path is one this report reads, and its file is gone", () => {
  const covered = new Map(CHECKS.map((c) => [c.name, c]));
  for (const name of RETIRED_TO_THE_NIGHTLY_REPORT) {
    const check = covered.get(name);
    // THE ASSERTION #954 EXISTS FOR: retiring a guard the report does not run leaves the rule unchecked
    // everywhere, which is the failure main sat red for 27.8 hours over.
    assert.ok(check, `${name} was retired from the PR path and this report does not run it`);
    assert.equal(check!.test, null, `${name} is retired, so the registry must not name a PR-path test for it`);
    assert.equal(existsSync(join(REPO, `packages/lab/src/packaging/${name}.test.ts`)), false,
      `${name}.test.ts is back on the pull-request path; the registry still says it is nightly-only`);
  }
  const nulls = CHECKS.filter((c) => c.test === null).map((c) => c.name).sort();
  assert.deepEqual(nulls, [...RETIRED_TO_THE_NIGHTLY_REPORT].sort(),
    "a check's test went null without being listed here, so nothing asserts its file is actually gone");
});

test("the registry is the fourteen, and each surviving pull-request test asserts on the same module", () => {
  assert.equal(CHECKS.length, 14, "product-manager's ruling on #905 names fourteen group-3 checks");
  assert.equal(new Set(CHECKS.map((c) => c.name)).size, 14, "a check is registered twice");
  for (const { name, test: testFile } of CHECKS) {
    if (testFile === null) continue; // retired above, and asserted there
    assert.ok(existsSync(join(REPO, testFile)), `${name}: its test ${testFile} does not exist`);
    // ONE COPY: the test imports the module the report runs -- `doc-checks/<name>.mjs`, or for the two whose
    // module composes an existing script, that script (`scripts/<name>.mjs`).
    const source = readFileSync(join(REPO, testFile), "utf8");
    assert.match(source, new RegExp(`scripts/(?:doc-checks/)?${name}\\.mjs"`),
      `${testFile} does not import the module the report runs for ${name} -- a second copy can drift`);
  }
});

/**
 * #954: THE SELECTOR'S DOC-CHECK EXEMPTION IS GONE, and this is the test that was pinning it.
 *
 * #905 made `scripts/doc-checks/` modules judged by the TEST's rule in `alwaysRunTests`, so the wrappers
 * stayed always-run. The wrappers are what #954 deleted, and the eight files that remain assert fixture
 * logic rather than the tree, so the exemption became a rule about files that no longer exist. What is
 * asserted instead is that it is really gone -- a rule left behind quietly re-selects tests nobody meant.
 */
test("#954: `scripts/doc-checks/` gets no special case in the selector any more", () => {
  const selector = readFileSync(join(REPO, "scripts/select-changed-tests.mjs"), "utf8");
  assert.doesNotMatch(selector, /asHelper: !.*DOC_CHECKS/,
    "the doc-checks exemption is still in `alwaysRunTests`, and the wrappers it was written for are gone");
  const packages = knownPackages(REPO);
  const index = packageIndex(REPO, packages);
  const guards = new Set(alwaysRunTests(discoverTestFiles(REPO, packages), {
    closureOf: (testFile: string) => sourceClosure(join(REPO, testFile), REPO, index), repoRoot: REPO,
  }).map((guard) => guard.test));
  for (const name of RETIRED_TO_THE_NIGHTLY_REPORT) {
    assert.equal(guards.has(`packages/lab/src/packaging/${name}.test.ts`), false,
      `${name} is retired and still selected as an always-run guard`);
  }
  // The class the selector still serves: a test that walks the tree ITSELF is always-run, doc check or not.
  assert.ok(guards.size > 10, `only ${guards.size} always-run guards found; the selector is not reading the tree`);
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

/**
 * #954: WHAT IT READ, IN TERMS A READER CAN CHECK OUT.
 *
 * The first nightly comment said `Read against /home/runner/work/a11y-witness/a11y-witness at 464edf9cd3ae`.
 * The path is where the job's checkout happened to sit and names nothing anyone can fetch; the commit alone
 * does not say whether it was `main` or a branch. Both halves are needed, and a fixture tree -- the one case
 * with no ref at all -- still has to say which tree it read.
 */
test("#954: the report names the ref and the commit, and falls back to the path only for a fixture", () => {
  const outcome = [{ name: "x", test: "x.test.ts",
    result: { examined: 1, unit: "things", disagreements: [] } }];
  assert.match(renderReport(outcome, { root: "/anywhere", commit: "464edf9cd3ae", ref: "origin/main" }),
    /Read against `origin\/main` at `464edf9cd3ae`\./);
  assert.doesNotMatch(renderReport(outcome, { root: "/home/runner/work/a11y-witness/a11y-witness", commit: "abc", ref: "origin/main" }),
    /home\/runner/, "the runner's path is exactly what this stopped printing");
  assert.match(renderReport(outcome, { root: "/anywhere", commit: "abc123456789", ref: null }),
    /Read against `a detached HEAD` at `abc123456789`\./);
  assert.match(renderReport(outcome, { root: "/tmp/fixture-tree" }), /Read against `\/tmp\/fixture-tree`\./);
});

/**
 * #954: A COMMENT GITHUB WILL ACCEPT -- and the failure this prevents is total, not cosmetic.
 *
 * `gh issue comment` over 65,536 characters answers 422 and posts NOTHING, so the night the report has the
 * most to say would be the night it says nothing at all. What survives is chosen rather than sliced: the
 * headline, the per-check table with every count, and the could-not-run section, which is the only part that
 * says a check did not happen.
 */
test("#954: an over-long report keeps the summary and the could-not-run section, and says how many rows went", () => {
  const disagreements = Array.from({ length: 4000 }, (_, i) => ({
    where: `docs/file-${i}.md:${i}`, reference: `docs/gone-${i}.md`, why: "no such file -- the citation is stale",
  }));
  const report = renderReport([
    { name: "doc-references", test: null, result: { examined: 4000, unit: "paths", disagreements } },
    { name: "check-transfer-urls", test: "x.test.ts", error: "no network reach" },
  ] as never, { root: "/r", commit: "abc", ref: "origin/main" });
  assert.ok(report.length > COMMENT_LIMIT, `the fixture is only ${report.length} characters; it proves nothing`);

  const fitted = fitToComment(report);
  assert.ok(fitted.length <= COMMENT_LIMIT, `still ${fitted.length} characters -- GitHub refuses it`);
  assert.match(fitted, /\| doc-references \| 4000 paths \| 4000 \|/, "the per-check counts must survive whole");
  assert.match(fitted, /### Could not run/, "the section saying a check did not run must survive");
  assert.match(fitted, /- \*\*check-transfer-urls\*\*: no network reach/);
  const notice = /_TRUNCATED: (\d+) of (\d+) disagreement row\(s\) are not shown/.exec(fitted);
  assert.ok(notice, "a truncated report must say so, or its reader believes it is the whole list");
  assert.equal(Number(notice![2]), 4000, "the notice must name the TOTAL the report found, not what fitted");
  assert.ok(Number(notice![1]) > 0 && Number(notice![1]) < 4000,
    `dropped ${notice![1]} of 4000 -- it should keep the rows that fit, not all or nothing`);
  // Some rows DO survive: a cap that shows the summary and no detail at all would pass every assertion above.
  assert.ok(fitted.includes("| `docs/file-0.md:0` |"), "no detail row survived; the budget arithmetic is wrong");
});

test("#954: a report that already fits is returned untouched", () => {
  const short = renderReport([{ name: "x", test: "x.test.ts", result: { examined: 1, unit: "things", disagreements: [] } }],
    { root: "/r", commit: "abc", ref: "origin/main" });
  assert.equal(fitToComment(short), short);
});
