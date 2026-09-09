/**
 * `scripts/ci-changed.mjs`'s `classify()` is the ONE place `.github/workflows/ci.yml`'s jobs decide
 * whether to run — replacing three independent copies of "what changed" (`lint.yml`'s total absence of a
 * filter, `changeset-check.yml`'s inline `git diff`, `ansible-check.yml`'s own `paths:` block). This pins
 * the classification, and separately pins `ci.yml`'s OWN trigger table plus its two Windows siblings'
 * (`action-smoke.yml`, `capture-regression.yml`), so a future "just add the tests to `ci`" — or a
 * `pull_request` trigger creeping back onto a Windows workflow — fails a unit test rather than the PR
 * budget both were rebuilt to protect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { classify, knownPackages, readWorkspaceDependencyGraph, dependentsOf, packedFiles, candidatePackedPaths,
  testDependencyMap, jobsFor }
  from "../../../../scripts/ci-changed.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS = `${REPO}.github/workflows/`;
const readWorkflow = (name: string) => readFileSync(`${WORKFLOWS}${name}`, "utf8");
/**
 * A disposable two-commit repo, so `--base=<first commit>` has something real to diff against without
 * depending on THIS repo's own history depth. `HEAD~1` failed exactly this way in CI (#156): the `ts` job's
 * checkout has no `fetch-depth: 0` (only `changed` needs full history, to diff a real PR), so the runner's
 * shallow clone has no commit before `HEAD` at all -- `git diff HEAD~1...HEAD` is `fatal: ambiguous
 * argument`, not an empty diff. A fixture with its own two commits cannot be shallow.
 */
function twoCommitRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ci-changed-cli-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", workspaces: ["packages/*"] }));
  git("add", "package.json");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "README.md"), "changed\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "a change to classify");
  return { dir, base };
}
// GITHUB_OUTPUT UNSET, DELIBERATELY -- caught by CI itself running THIS test inside a real Actions job:
// `writeOutputs()` appends to that file instead of printing to stdout whenever it is set, so a test that
// merely inherits the ambient environment captures nothing to assert on there while passing everywhere
// else. Deleted rather than passed as `undefined` through `sandboxGitEnv`'s `extra` (typed
// `Record<string, string>`) -- `execFileSync` itself treats an `undefined` value as "omit this key"
// (verified: `"X" in process.env` is false in the child), but the type would not let it in.
const cliEnv = () => {
  const env = sandboxGitEnv();
  delete env.GITHUB_OUTPUT;
  return env;
};
const runCliIn = (dir: string, args: string[]) =>
  execFileSync("node", [join(REPO, "scripts/ci-changed.mjs"), `--repo=${dir}`, ...args],
    { cwd: dir, env: cliEnv(), encoding: "utf8" });

/** A `getPackedFiles` fake, so `classify`'s own tests never shell out to a real `npm pack`. */
const fakePacked = (byPackage: Record<string, string[]>) =>
  (_repoRoot: string, pkgName: string) => new Set(byPackage[pkgName] ?? []);

test("classify: a docs-only change fires only the docs category", () => {
  const result = classify(["docs/known-gaps.md", "README.md"], ["lab", "judge"]);
  assert.deepEqual(result, { ts: false, python: false, ansible: false, docs: true, board: false,
    changeset: false, rulesFitness: false, packages: [], testPackages: [] });
});

test("classify: a source change under one package fires ts, names that package, and nothing else", () => {
  const result = classify(["packages/lab/src/training/case-matrix.mjs"], ["lab", "judge", "cli"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["lab"]);
  assert.equal(result.python, false);
  assert.equal(result.ansible, false);
  assert.equal(result.docs, false);
});

test("classify: a python file under a package fires python, and (bluntly) ts for that package too", () => {
  // Same bluntness as the ansible case above: `changedPackages` does not filter by extension, so a `.py`
  // file under `packages/scorer/` marks `scorer` touched for the scoped unit-test run too. Harmless --
  // scorer's own TS-side tests simply run alongside the Python ones -- and consistent rather than a
  // second, narrower definition of "touched" living beside the one the pre-push hook already uses.
  const result = classify(["packages/scorer/python/score.py"], ["lab", "scorer"], {},
    { getPackedFiles: fakePacked({}) }); // scorer's changeset check runs too; no real npm pack needed here
  assert.equal(result.python, true);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["scorer"]);
});

test("classify: the ansible layer fires ansible, and (bluntly, like changedPackages elsewhere) ts for control", () => {
  // `packages/control/ansible/**` sits INSIDE the `control` workspace, so `changedPackages` -- reused
  // here rather than re-derived, matching the pre-push hook's own "blunt, not dependency-aware"
  // philosophy -- correctly reads it as touching `control` too. Running `control`'s (fast) unit tests
  // alongside the ansible job is a harmless extra, not a wrong answer.
  const result = classify(["packages/control/ansible/deploy.yml"], ["control"]);
  assert.equal(result.ansible, true);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["control"]);
});

test("classify: a private package never demands a changeset, whatever it packs", () => {
  // Short-circuited on `private: true` before `getPackedFiles` is even consulted -- no fake needed here,
  // and none supplied, so a call into it would be a genuine bug rather than a passing accident.
  const priv = classify(["packages/lab/src/training/case-matrix.mjs"], ["lab"]);
  assert.equal(priv.changeset, false, "packages/lab is private: true and must never demand a changeset");
});

/**
 * ISSUE #132, reproduced directly: a TEST FILE under a published package's `src/` must NOT fire
 * `changeset`, because `npm pack` never ships it -- measured on the real PR this blocked,
 * `packages/worker-fleet/src/lab-job.test.ts`. Injected `getPackedFiles`, so this proves `classify`'s OWN
 * logic (asks the packed manifest, not the path) without needing a real `npm pack` per test.
 */
test("classify: a file NOT in the packed manifest does not fire changeset, even under src/", () => {
  const getPackedFiles = fakePacked({ "worker-fleet": ["dist/index.js", "src/local-worker/build-vm.sh"] });
  const result = classify(["packages/worker-fleet/src/lab-job.test.ts"], ["worker-fleet"], {}, { getPackedFiles });
  assert.equal(result.changeset, false,
    "src/lab-job.test.ts is not in the packed manifest (raw) and its built form (dist/lab-job.test.js) "
    + "is not either -- npm never ships it, so it cannot reach a consumer");
});

test("classify: a RAW-shipped file under a published package's own files entry fires changeset", () => {
  const getPackedFiles = fakePacked({ "worker-fleet": ["dist/index.js", "src/provisioning/deploy.ps1"] });
  const result = classify(["packages/worker-fleet/src/provisioning/deploy.ps1"], ["worker-fleet"], {}, { getPackedFiles });
  assert.equal(result.changeset, true, "this exact path is in the packed manifest -- it reaches a consumer");
});

test("classify: a BUILT (tsc) source file fires changeset via its dist/ counterpart, not its own path", () => {
  // `src/cli.ts` is never itself in a packed manifest -- only `dist/cli.js` is. If `classify` checked the
  // changed file's own path literally, this would report `changeset: false` for the single most common
  // real change a published TS package sees, which is the opposite of this row's intent.
  const getPackedFiles = fakePacked({ cli: ["dist/cli.js", "dist/cli.d.ts"] });
  const result = classify(["packages/cli/src/cli.ts"], ["cli"], {}, { getPackedFiles });
  assert.equal(result.changeset, true);
});

test("classify: a TEST FILE beside a BUILT source file does not fire changeset — tsconfig excludes it", () => {
  // Same package, same directory, only the built counterpart differs: cli.ts -> dist/cli.js (packed);
  // cli.test.ts -> dist/cli.test.js, which tsconfig's own `exclude` never produces, so `npm pack` never
  // ships it either. `classify` must tell these apart from the packed manifest alone, never by name.
  const getPackedFiles = fakePacked({ cli: ["dist/cli.js", "dist/cli.d.ts"] }); // note: no dist/cli.test.js
  const result = classify(["packages/cli/src/cli.test.ts"], ["cli"], {}, { getPackedFiles });
  assert.equal(result.changeset, false);
});

test("candidatePackedPaths: raw path always included; .ts additionally maps to its dist/ counterpart", () => {
  assert.deepEqual(candidatePackedPaths("src/provisioning/deploy.ps1"), ["src/provisioning/deploy.ps1"]);
  assert.deepEqual(candidatePackedPaths("src/cli.ts"), ["src/cli.ts", "dist/cli.js", "dist/cli.d.ts"]);
  assert.deepEqual(candidatePackedPaths("src/action/run.tsx"),
    ["src/action/run.tsx", "dist/action/run.js", "dist/action/run.d.ts"]);
  // A .ts file OUTSIDE src/ (there are none in this repo, but the mapping must not guess for one) gets no
  // dist/ candidate at all -- only a package's own rootDir gets built there.
  assert.deepEqual(candidatePackedPaths("scripts/build.ts"), ["scripts/build.ts"]);
});

/**
 * THE REAL THING, ONCE: `packedFiles` against `packages/cli` itself, proving the injected fakes above
 * describe a shape npm actually produces rather than a convenient guess. Slower (a real `npm pack --dry-
 * run`, which runs `prepack`/`tsc --build` if `dist` is stale) and deliberately the only test here that
 * pays that cost.
 */
test("packedFiles + candidatePackedPaths against the REAL packages/cli: src/cli.ts reaches a consumer", () => {
  const packed = packedFiles(REPO.replace(/\/$/, ""), "cli");
  assert.ok(packed.size > 0, "npm pack --dry-run reported an empty manifest for packages/cli -- broken build?");
  const hit = candidatePackedPaths("src/cli.ts").some((p) => packed.has(p));
  assert.ok(hit, `none of src/cli.ts's candidate paths were packed; packed set was: ${[...packed].slice(0, 10).join(", ")}...`);
});

test("classify: a root config file touches EVERY known package, never just the ones that happened to change", () => {
  const result = classify(["package.json"], ["lab", "judge", "cli", "scorer"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["cli", "judge", "lab", "scorer"].sort());
});

test("classify: a scripts/*.mjs change also touches EVERY known package, for the identical reason", () => {
  // `scripts/git-env.mjs` alone is imported by dozens of packaging tests directly -- a scoped-to-nothing
  // run here is exactly the "empty must read as run everything" defect the pre-push hook already names.
  const result = classify(["scripts/git-env.mjs"], ["lab", "judge"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["judge", "lab"]);
});

test("classify: an unrelated file changes nothing", () => {
  const result = classify([".gitignore"], ["lab"]);
  assert.deepEqual(result, { ts: false, python: false, ansible: false, docs: false, board: false,
    changeset: false, rulesFitness: false, packages: [], testPackages: [] });
});

test("classify: a multi-package, multi-category diff sets every category it touches, independently", () => {
  const getPackedFiles = fakePacked({ judge: ["dist/rules.js", "dist/rules.d.ts"] });
  const result = classify([
    "packages/lab/src/training/case-matrix.mjs",
    "packages/judge/src/rules.ts",
    "docs/known-gaps.md",
    "packages/control/ansible/deploy.yml",
    "packages/scorer/tests/test_runtime_versions.py",
  ], ["lab", "judge", "control", "scorer"], {}, { getPackedFiles });
  assert.equal(result.ts, true);
  // `control` is here too -- the ansible file sits inside `packages/control/`, same as the test above.
  assert.deepEqual(result.packages, ["control", "judge", "lab", "scorer"]);
  assert.equal(result.docs, true);
  assert.equal(result.ansible, true);
  assert.equal(result.python, true);
  assert.equal(result.changeset, true, "packages/judge/src is published");
});

test("knownPackages finds the real repo's workspace directories, and refuses a second workspace glob", () => {
  const packages = knownPackages(REPO);
  // A floor, not a target -- matches the same convention `control-plane-hygiene.test.ts` uses for the
  // same reason: adding or retiring a package must not itself break this guard.
  assert.ok(packages.length >= 8, `found ${packages.length} package(s); the packages/* walk is broken`);
  assert.ok(packages.includes("lab") && packages.includes("judge"));
  // `packages/README.md` is a real tracked file directly under `packages/`, two path segments deep -- not
  // a package directory. `readWorkspaceDependencyGraph` is the first consumer that ever tried to read
  // `packages/<name>/package.json` for every returned name, and crashed on exactly this
  // (`ENOTDIR: not a directory, open './packages/README.md/package.json'`) the first time it ran for real.
  assert.ok(!packages.includes("README.md"),
    "a bare file tracked directly under packages/ must not be reported as a package directory");

  // NO git repo needed here: the workspace-glob check runs, and throws, before `knownPackages` ever
  // shells out to `git ls-files` -- a plain directory with a package.json proves the refusal.
  const dir = mkdtempSync(join(tmpdir(), "ci-changed-workspaces-"));
  try {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", workspaces: ["packages/*", "tools/*"] }));
    assert.throws(() => knownPackages(dir), /single "packages\/\*" workspace glob/,
      "a second workspace glob must be refused loudly, not silently examine only the first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------------
// TESTPACKAGES AND RULESFITNESS -- chairman's follow-up, 2026-09-06, cutting `ci/ts`'s measured 269s to a
// sixty-second budget. `testPackages` is touched packages plus every workspace DEPENDENT, transitively;
// `rulesFitness` fires the rules-fitness gate only when packages/judge or packages/evidence changed.
// -------------------------------------------------------------------------------------------------------

test("classify: board fires, and docs does not, when EVERY doc-touching file is a board file", () => {
  // chairman's follow-up, same day: docs/board/summaries/*.md and docs/board/reported.json are edited far
  // more often than anything else under docs/, and each edit used to pay the full docs job.
  const summary = classify(["docs/board/summaries/2026-09-07.md"], ["lab"]);
  assert.equal(summary.board, true);
  assert.equal(summary.docs, false, "board and docs are mutually exclusive -- a board-only diff must not "
    + "also pay for the wider docs job");

  const reported = classify(["docs/board/reported.json"], ["lab"]);
  assert.equal(reported.board, true);
  assert.equal(reported.docs, false);
});

// -------------------------------------------------------------------------------------------------------
// #283: a file named by a test declaration in the `file:`-keyed SITES convention must run THAT test's
// job, even when `board`'s narrower glob (`board-*.test.ts` + `public-claim.test.ts`) would otherwise skip
// it entirely. `main` went red on exactly this shape: `repo-identity-consolidated.test.ts` named
// `docs/board/reported.json`, #270 was a board-only diff, and neither `board` nor (since `docs` is false
// whenever `board` is true) `docs` ran it.
//
// THE MECHANISM IS TESTED WITH AN INJECTED MAP, NOT AGAINST THAT REAL EXAMPLE -- deliberately. Fixing
// #283 also meant asking whether `reported.json` needed to name the repo at all (a separate, sibling
// finding); the answer was no, so `repo-identity-consolidated.test.ts` no longer names it, and the map
// this file derives from the real repo no longer contains that entry either. Pinning THESE tests to that
// specific, now-resolved example would be exactly the fragile coupling the sibling finding warns against
// -- a real anchor here proves the class fix works today, but any real site can be resolved out from under
// it the same way `reported.json`'s was. `testDependencyMap`'s own anti-vacuity check below still proves
// the derivation examines the real repo and finds SOMETHING; the mechanism tests below it prove the FOLD
// logic against a map built by hand, so they cannot go stale when an unrelated SITES entry changes.
// -------------------------------------------------------------------------------------------------------

test("testDependencyMap: the ANTI-VACUITY check -- a real minimum, not just non-empty", () => {
  // A bare `size > 0` would pass on ONE stray match and read as proof this derivation has live input --
  // exactly the `landmark_present`/`rules:coverage` shape CLAUDE.md warns about, a mechanism correct,
  // tested and answering about an empty set. Measured 2026-09-07, after #283's part 1 removed
  // `docs/board/reported.json` from the one SITES list that used to name it: 103 literal->package
  // entries total, contributed by all four known `file:`-convention guards (repo-identity-consolidated
  // 26, tracked-source-leak-guard 52, fetch-wrapper-coverage 8, backlog-file-facts 6) plus
  // audit-findings-dispositioned. 50 is a floor well under that, chosen to fail loudly on a real
  // regression (one guard's `file:` sites silently stop being read) without being pinned to today's exact
  // count, which will drift as those guards' own SITES lists grow or shrink.
  const map = testDependencyMap(REPO);
  assert.ok(map.size >= 50, `only ${map.size} literal->package entries derived -- expected at least 50 `
    + "from the known file:-convention guards; either one stopped contributing or the derivation broke");
  // README.md, not docs/board/reported.json -- see this block's own header comment for why that anchor
  // moved. README.md is named by repo-identity-consolidated.test.ts's OWN vacuity-guarded SITES list, so
  // it cannot go stale the way a single retired achievement's incidental mention did.
  assert.ok(map.get("README.md")?.has("lab"),
    "repo-identity-consolidated.test.ts lives under packages/lab -- the map must attribute the claim to "
    + "the package whose ts-job glob actually covers that test file");
});

/** A fake `getTestDependencyMap`, so the fold's OWN logic is provable without any real SITES entry. */
const fakeTestDeps = (byFile: Record<string, string[]>) => () =>
  new Map(Object.entries(byFile).map(([f, pkgs]) => [f, new Set(pkgs)]));

test("classify: a board-only diff also fires ts, because a NON-board test names the file", () => {
  const getTestDependencyMap = fakeTestDeps({ "docs/board/reported.json": ["lab"] });
  const result = classify(["docs/board/reported.json"], ["lab"], {}, { getTestDependencyMap });
  assert.equal(result.board, true, "still routes to board -- this fix adds ts, it does not remove board");
  assert.equal(result.ts, true, "a non-board test names this file; ts must fire so SOME job actually "
    + "runs it");
  assert.ok(result.packages.includes("lab"), "the owning package must be pulled in, or ts=true would run "
    + "with an empty glob list and crash the ts job's own loud-refusal check");
});

test("classify: the fold is GATED on board, so an unrelated file's OTHER site does not widen ts for free", () => {
  // README.md is ALSO named by a real `file:` site (see the anti-vacuity test above), but a README.md-only
  // diff classifies docs (not board) and is therefore already covered by the wide docs job in full -- the
  // fold must not fire here, or every README.md edit would pay for both docs AND ts with nothing gained.
  const result = classify(["docs/known-gaps.md", "README.md"], ["lab", "judge"]);
  assert.deepEqual(result, { ts: false, python: false, ansible: false, docs: true, board: false,
    changeset: false, rulesFitness: false, packages: [], testPackages: [] });
});

test("classify: an injected empty test-dependency map reproduces the pre-#283 bug -- the guard BITES", () => {
  const result = classify(["docs/board/reported.json"], ["lab"], {}, { getTestDependencyMap: () => new Map() });
  assert.equal(result.board, true);
  assert.equal(result.ts, false, "with no test-dependency map, nothing tells classify() this file is "
    + "named elsewhere -- board fires alone, exactly like the diff that shipped #270");
});

test("jobsFor: agrees with classify() on the same input, by construction", () => {
  const files = ["README.md"];
  const viaJobsFor = new Set(jobsFor(files, REPO));
  const viaClassify = classify(files, knownPackages(REPO), {}, { repoRoot: REPO });
  const jobKeys = ["ts", "python", "ansible", "docs", "board", "changeset", "rulesFitness"] as const;
  for (const job of jobKeys) {
    assert.equal(viaJobsFor.has(job), Boolean(viaClassify[job]),
      `jobsFor and classify disagree on "${job}" for the same file list`);
  }
});

test("classify: mixing a board file with ANY other doc file falls back to the wider docs job", () => {
  // Narrower-than-usual needs its own argument, and a mixed diff has not made it -- the wider docs job
  // covers the guards a non-board doc file could plausibly need.
  const result = classify(["docs/board/summaries/2026-09-07.md", "docs/known-gaps.md"], ["lab"]);
  assert.equal(result.docs, true);
  assert.equal(result.board, false);
});

test("classify: rulesFitness fires on packages/judge or packages/evidence, and nothing else", () => {
  assert.equal(classify(["packages/judge/src/rules.ts"], ["judge"]).rulesFitness, true);
  assert.equal(classify(["packages/evidence/src/announcement.ts"], ["evidence"]).rulesFitness, true);
  assert.equal(classify(["packages/lab/src/training/case-matrix.mjs"], ["lab"]).rulesFitness, false,
    "a change outside judge/evidence must not fire the rules fitness gate");
  assert.equal(classify(["package.json"], ["judge", "lab"]).rulesFitness, false,
    "unlike ts, a root config change does NOT imply rulesFitness -- it cannot move the rule engine's or "
    + "the announcement grammar's own behaviour");
});

test("classify: testPackages defaults to exactly packages when no dependency graph is supplied", () => {
  // The default parameter -- every call site written before testPackages existed keeps working unchanged.
  const result = classify(["packages/evidence/src/foo.ts"], ["evidence", "judge"]);
  assert.deepEqual(result.testPackages, result.packages);
});

test("classify: testPackages is packages PLUS every transitive dependent, from a real dependency graph", () => {
  const graph = { evidence: [], judge: ["evidence"], lab: ["judge"] };
  const result = classify(["packages/evidence/src/foo.ts"], ["evidence", "judge", "lab"], graph);
  assert.deepEqual(result.packages, ["evidence"]);
  assert.deepEqual(result.testPackages, ["evidence", "judge", "lab"],
    "lab depends on judge, which depends on evidence -- both must be pulled in, not just judge");
});

test("dependentsOf: a package with no dependents returns just itself", () => {
  assert.deepEqual(dependentsOf(["standalone"], { evidence: [], judge: ["evidence"], standalone: [] }),
    ["standalone"]);
});

test("dependentsOf: the closure is transitive, not merely direct", () => {
  const graph = { a: [], b: ["a"], c: ["b"], d: ["c"] };
  assert.deepEqual(dependentsOf(["a"], graph), ["a", "b", "c", "d"],
    "d depends on c depends on b depends on a -- changing a must test the whole chain");
});

test("dependentsOf: two independently changed packages union their dependents", () => {
  const graph = { a: [], b: [], x: ["a"], y: ["b"] };
  assert.deepEqual(dependentsOf(["a", "b"], graph), ["a", "b", "x", "y"]);
});

test("readWorkspaceDependencyGraph: resolves by each package's REAL declared name, not by directory "
  + "convention", () => {
  // packages/cli's own package.json name is the UNSCOPED "a11ign", not "@a11ign/cli" -- and
  // packages/lab genuinely depends on it. A graph builder that assumed the `@a11ign/<dir>` pattern
  // would silently drop this edge.
  const dir = mkdtempSync(join(tmpdir(), "ci-changed-graph-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    const pkgs: Record<string, object> = {
      cli: { name: "a11ign", dependencies: {} },
      lab: { name: "@a11ign/lab", dependencies: { "a11ign": "0.1.0", "@a11ign/evidence": "0.1.0" } },
      evidence: { name: "@a11ign/evidence", dependencies: {} },
      // an external, non-workspace dependency must be silently DROPPED, not crash or appear as a phantom
      // package named after an npm package this repo does not own.
      judge: { name: "@a11ign/judge", dependencies: { "@a11ign/evidence": "0.1.0", "typescript": "^6.0.0" } },
    };
    for (const [name, manifest] of Object.entries(pkgs)) {
      const pkgDir = join(dir, "packages", name);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest));
    }
    const graph = readWorkspaceDependencyGraph(dir, ["cli", "lab", "evidence", "judge"]);
    assert.deepEqual([...graph.lab].sort(), ["cli", "evidence"],
      "lab must resolve BOTH its unscoped 'a11ign' dependency (-> cli) and its scoped one (-> "
      + "evidence), by reading each package's real name rather than assuming a naming convention");
    assert.deepEqual(graph.judge, ["evidence"], "typescript is not a workspace package and must be dropped");
    assert.deepEqual(graph.cli, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------------
// #156: THE CLI ITSELF, spawned for real. `classify()` above is pure and never sees `--event`/`--base` at
// all, so the flag validation and the base-shape guard can only be proven by actually running the script.
// -------------------------------------------------------------------------------------------------------

test("CLI: --event=merge_group classifies, it does not refuse", () => {
  // Acceptance step 3, verbatim: a merge_group event with a real base must be treated exactly like a
  // pull_request one, not rejected for using the newer event name.
  const { dir, base } = twoCommitRepo();
  try {
    const out = runCliIn(dir, ["--event=merge_group", `--base=${base}`]);
    assert.match(out, /^ts=(true|false)$/m, "expected classification output, got: " + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: an empty base (the unhandled merge_group shape) is refused by NAME, not left to crash on git", () => {
  // The exact trap ci.yml's own `base` step comment documents: an unhandled empty `github.base_ref`
  // arrives here as a bare "origin/" once the workflow's own string concatenation has run. Proven against
  // the REAL CLI rather than only against `classify()`, because the guard lives in `main()`, which
  // `classify()`'s own tests structurally cannot reach.
  const { dir } = twoCommitRepo();
  try {
    assert.throws(() => runCliIn(dir, ["--event=merge_group", "--base=origin/"]),
      /empty or a bare prefix/, "a bare 'origin/' base must be refused by name, not crash inside git");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: --event=push is still refused -- widening to merge_group must not silently widen further", () => {
  const { dir, base } = twoCommitRepo();
  try {
    assert.throws(() => runCliIn(dir, ["--event=push", `--base=${base}`]),
      /--event must be "pull_request" or "merge_group"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// -------------------------------------------------------------------------------------------------------
// --precise -- the `changed` job (no `npm ci`) must never actually shell out to `npm pack`, because a
// package with a `prepack` script (`cli` and `judge` both run `tsc --build`) fails without `node_modules`.
// `orchestrator` reproduced exactly this: `classify()` calling the real `packedFiles()` inside `changed`
// crashed on every PR touching a published package. Reproduced here with a package whose `prepack` is
// guaranteed to fail regardless of environment, so the property under test is "never even attempted",
// not "happened to succeed because this dev machine has node_modules".
// -------------------------------------------------------------------------------------------------------

/** A workspace with one published package whose `prepack` script cannot succeed anywhere, ever -- the
 *  sharpest stand-in for "a package needing `npm ci` first" available without actually deleting
 *  `node_modules` out from under the whole test run. */
function repoWithCrashingPrepack() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ci-changed-prepack-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", workspaces: ["packages/*"] }));
  const pkgDir = join(dir, "packages", "foo");
  execFileSync("mkdir", ["-p", pkgDir]);
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
    name: "foo", version: "1.0.0", files: ["dist"],
    scripts: { prepack: "definitely-not-a-real-command-ci-changed-test-xyz" },
  }));
  execFileSync("mkdir", ["-p", join(pkgDir, "dist")]);
  writeFileSync(join(pkgDir, "dist", "index.js"), "module.exports = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(pkgDir, "dist", "index.js"), "module.exports = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "touch the package with the crashing prepack");
  return { dir, base };
}

test("CLI without --precise: a published package's own prepack script is never run", () => {
  const { dir, base } = repoWithCrashingPrepack();
  try {
    // Must NOT throw. If `classify()` had called the real `packedFiles`, `npm pack --dry-run` would have
    // run `foo`'s `prepack` and failed on the unresolvable command -- this succeeding is the proof it
    // never tried.
    const out = runCliIn(dir, ["--event=pull_request", `--base=${base}`]);
    assert.match(out, /^changeset=true$/m,
      "the cheap over-approximation must still say a published package changed, or the `changeset` job "
      + "would never even run to find out precisely: " + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI with --precise: the same package's prepack script DOES run, and its failure surfaces", () => {
  // The mirror image, proving `--precise` is not a no-op: once `npm ci` has made `npm pack` safe (in the
  // real `changeset` job, never here), the CLI must actually consult the manifest -- and this fixture's
  // package cannot ever produce one, so this must fail rather than quietly falling back to the cheap
  // answer. A `--precise` that silently reused `everythingIsPacked` would pass every test above and this
  // one both, which is exactly the "guard covers nothing" shape a PROOF test exists to catch.
  const { dir, base } = repoWithCrashingPrepack();
  try {
    assert.throws(() => runCliIn(dir, ["--event=pull_request", `--base=${base}`, "--precise"]),
      /definitely-not-a-real-command-ci-changed-test-xyz/,
      "--precise must actually call npm pack, surfacing this package's own prepack failure");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// -------------------------------------------------------------------------------------------------------
// THE TRIGGER TABLE. `.github/workflows/on:` blocks, pinned so a future accidental trigger addition (the
// exact shape point 5 of the CI rebuild names: "mutation-checked by adding a pull_request trigger to
// action-smoke") fails here rather than costing real Windows minutes on every PR again.
// -------------------------------------------------------------------------------------------------------

test("ci.yml triggers on pull_request AND merge_group -- no push trigger at all, on main or anywhere else", () => {
  // Chairman's direction, 2026-09-06: the flow is PR then merge, and a check that runs after a merge
  // cannot stop it -- a `push: branches: [main]` trigger is a gate with the barn door already open.
  // Branch protection (checks green AND up to date with main) is what makes the tested commit the one
  // that lands, so NOTHING here may run post-merge.
  //
  // #156: merge_group must sit ALONGSIDE pull_request, never in place of it -- a PR still needs its own
  // run before it can be added to the queue at all, and GitHub's own docs are explicit that a merge queue
  // whose workflow lacks this trigger times every queued entry out silently, with no error anywhere.
  const doc = parseYaml(readWorkflow("ci.yml"));
  assert.ok(doc.on.pull_request, "ci.yml must trigger on pull_request -- that is the whole of the rebuild");
  assert.ok(doc.on.merge_group, "ci.yml must ALSO trigger on merge_group, or a merge queue times every "
    + "entry out silently -- #156");
  assert.ok(!("push" in doc.on),
    "ci.yml must not trigger on push at all -- a check that runs after the merge cannot stop it");
  assert.equal(Object.keys(doc.on).length, 2,
    `ci.yml declares triggers ${Object.keys(doc.on).join(", ")} -- only pull_request and merge_group are expected`);
});

/**
 * A CLOSED PR IS NOT A PR TO TEST, and `edited` is how one gets tested anyway.
 *
 * #690 merged at 11:12:18Z on a fully green run (`gate` success at 11:12:16Z, two seconds earlier). Its
 * author then edited the BODY at 11:14:00Z to record how a verification had been run -- no push, no
 * commit. `edited` fired `ci.yml` against a merged PR whose branch had been deleted, and three checks
 * went red on the merged head:
 *
 *   mergeSafety  "could not read the branch's real tip (`git ls-remote`, #294). This is INCONCLUSIVE"
 *   changed      "`git diff --name-only origin/main...HEAD` returned nothing"
 *   gate         "a job reported 'failure'"
 *
 * NEITHER GUARD IS WRONG. The branch really was gone, and after the merge HEAD really IS an ancestor of
 * `origin/main`, so the three-dot diff is `diff(B, B)` -- empty by construction, the shape recorded in
 * `docs/pipeline.md` under testing a check in the direction it will run. The RUN is what should not
 * exist.
 *
 * It matters because those checks land in the report of non-success checks on merged PR heads -- the view
 * the chairman reads. A check that CANNOT pass is not a signal, and a section full of permanent red
 * trains people to skip it, which is exactly how one real red sat on seven merged PRs for ninety minutes.
 *
 * `edited` STAYS. The acceptance job reads `github.event.pull_request.body`, so a body edit must re-run
 * it while the PR is open; the state check narrows only the case where there is no PR left to gate.
 */
test("#690: every pull_request job is gated on the PR still being OPEN -- `edited` fires after a merge too", () => {
  const doc = parseYaml(readWorkflow("ci.yml"));
  assert.deepEqual(doc.on.pull_request.types, ["opened", "synchronize", "reopened", "edited"],
    "`edited` is deliberate -- acceptance reads the PR body -- and it is what reaches a closed PR");

  const jobs = /** @type {Record<string, {if?: string, needs?: unknown}>} */ (doc.jobs);
  const reachableOnPullRequest = Object.entries(jobs)
    .filter(([name]) => name !== "gate")
    .filter(([, job]) => job.if === undefined || !String(job.if).includes("merge_group"));

  const unguarded = reachableOnPullRequest
    .filter(([, job]) => !String(job.if ?? "").includes("pull_request.state == 'open'"))
    .filter(([, job]) => job.needs === undefined || !String(job.needs).includes("changed"))
    .map(([name]) => name);

  assert.deepEqual(unguarded, [],
    `these jobs run on a CLOSED pull request: ${unguarded.join(", ")}. Either gate them on `
    + "`github.event.pull_request.state == 'open'` or make them need `changed`, which is gated.");

  // `gate` is DELIBERATELY not gated: `if: always()`, and with every upstream job skipped it passes on
  // "success or skipped". A required context that reports SKIPPED and one that reports SUCCESS are not
  // the same thing to branch protection, and this is the required one.
  assert.equal(jobs.gate.if, "always()", "gate stays unconditional -- it is the required context");
});

test("action-smoke.yml and capture-regression.yml trigger on workflow_call and workflow_dispatch only", () => {
  // Both left `main` entirely, chairman's direction: they are release-time gates now, called as jobs from
  // `release.yml` (workflow_call) or run on demand (workflow_dispatch) -- never on a push or a PR, so
  // Windows/NVDA minutes are spent once, before a release, rather than on every commit.
  for (const file of ["action-smoke.yml", "capture-regression.yml"]) {
    const doc = parseYaml(readWorkflow(file));
    assert.ok(!("pull_request" in doc.on), `${file} must not trigger on pull_request`);
    assert.ok(!("push" in doc.on), `${file} must not trigger on push`);
    assert.ok("workflow_call" in doc.on,
      `${file} must declare workflow_call, or release.yml has no way to run it as a job`);
    assert.ok("workflow_dispatch" in doc.on, `${file} must keep workflow_dispatch for an on-demand run`);
  }
});

test("PROOF: the trigger-table guard bites -- a synthetic push block on a pull_request-only workflow fails", () => {
  // Driven directly against a FIXTURE rather than by mutating a real file on disk, for the reason every
  // other MUTATION test in this repo gives when the real check is cheap enough to reproduce inline: the
  // property under test is "does parsing a `push:` key make `\"push\" in doc.on` true", and a fixture
  // proves that without touching a tracked file at all.
  const withPush = parseYaml([
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  x:",
    "    runs-on: ubuntu-latest",
  ].join("\n"));
  assert.ok("push" in withPush.on,
    "the fixture itself must carry a push trigger, or this proves nothing about the real assertion");
});

test("lint.yml, ansible-check.yml and changeset-check.yml are retired, not merely unused", () => {
  for (const retired of ["lint.yml", "ansible-check.yml", "changeset-check.yml"]) {
    assert.throws(() => readWorkflow(retired), /ENOENT/,
      `${retired} still exists on disk -- it was meant to be folded into ci.yml and removed`);
  }
});

/**
 * `gate` IS THE ONE CONTEXT BRANCH PROTECTION MAY REQUIRE, not the six scoped jobs above it -- see
 * `ci.yml`'s own header. Requiring `ts`/`python`/`ansible`/`docs`/`changeset`/`rulesFitness` directly means
 * a required check with no run against a docs-only PR's commit, and GitHub treats a job SKIPPED by its own
 * `if:` as satisfying a required check only because it still posts a real check run concluding `skipped`
 * -- an implicit platform behaviour, not a fact this repo's own tests can see. `gate` computes the
 * identical answer explicitly and is what these tests pin.
 */
test("ci.yml has a gate job needing every scoped job, running even when one of them failed", () => {
  const doc = parseYaml(readWorkflow("ci.yml")) as { jobs: Record<string, { needs?: unknown; if?: string }> };
  const gate = doc.jobs.gate;
  assert.ok(gate, "ci.yml must declare a job named 'gate' -- branch protection has nothing else it can "
    + "require that reports on every PR regardless of which path-scoped jobs a diff happened to trigger");
  // DERIVED FROM THE FILE, NEVER A LITERAL. This assertion carried a hand-typed job list until #356 added
  // `ownedPaths`, and a literal answers "does gate need the jobs somebody typed here", which is not the
  // question -- the question is whether it needs the jobs this workflow ACTUALLY declares.
  const scopedJobs = Object.keys(doc.jobs).filter((name) => name !== "gate");
  assert.deepEqual([...gate.needs as string[]].sort(), scopedJobs.sort(),
    "gate must need every other job in this file, or a job could fail silently with gate still passing");

  // AND `needs:` IS ONLY HALF OF IT -- the gap #356 fell into, and the reason this is asserted rather than
  // read. Naming a job in `needs:` makes gate WAIT for it; it does not make gate FAIL for it. The verdict
  // is the shell loop below, which reads `needs.<job>.result` one job at a time, so a job present in
  // `needs:` and absent from the loop is waited for and then ignored -- gate goes green on its failure.
  // Two lists of the same fact with nothing comparing them, which is this repo's most expensive shape.
  const loop = /for result in \\[\s\S]*?\n\s*done/.exec(readWorkflow("ci.yml"));
  assert.ok(loop, "could not find gate's result-checking loop in the real workflow");
  const checked = [...loop[0].matchAll(/needs\.([\w-]+)\.result/g)].map((m) => m[1]);
  assert.deepEqual([...checked].sort(), [...gate.needs as string[]].sort(),
    "every job gate NEEDS must also have its result READ by gate's loop. A job in `needs:` but not in the "
    + "loop is one gate waits for and never judges, so its failure leaves gate green -- which is exactly "
    + "the silent pass the whole job exists to prevent.");
  assert.equal(gate.if, "always()",
    "gate must run with if: always() -- without it, a failing upstream job would SKIP gate too (a job's "
    + "default if is success() on its dependencies), and the one context branch protection requires would "
    + "then report nothing on exactly the commit most in need of a red mark");
});

test("PROOF: gate's own check fails when a needed job's result is neither success nor skipped", () => {
  // Extracts the real shell loop from ci.yml's gate job (never re-typed) and drives it with real GitHub
  // Actions job-result values, proving the loop actually discriminates rather than merely looking like it
  // does. The COUNT of placeholders is read off the loop itself, never hand-typed here -- a hand-typed
  // count is exactly the "fact stated twice" shape this repo names as its most expensive recurring
  // defect, and this file already had to bump it three times as `gate`'s own `needs:` list grew.
  const workflow = readWorkflow("ci.yml");
  const loopMatch = /for result in \\[\s\S]*?\n\s*done/.exec(workflow);
  assert.ok(loopMatch, "could not find gate's result-checking loop in the real workflow to drive");
  const placeholderCount = (loopMatch[0].match(/\$\{\{ needs\.[\w-]+\.result \}\}/g) ?? []).length;
  assert.ok(placeholderCount > 0, "found no needs.*.result placeholders in the loop -- the regex above no "
    + "longer matches the real file's shape");

  const runWith = (results: string[]) => {
    const script = loopMatch[0]
      .replace(/"\$\{\{ needs\.[\w-]+\.result \}\}"/g, () => `"${results.shift()}"`)
      + "\necho LOOP_OK";
    return execFileSync("bash", ["-c", script], { encoding: "utf8" });
  };
  const allGood: string[] = Array.from({ length: placeholderCount },
    (_, i) => (i % 2 === 0 ? "success" : "skipped"));
  const withOneReplaced = (index: number, value: string) => {
    const results = [...allGood];
    results[index] = value;
    return results;
  };

  assert.equal(runWith([...allGood]).trim(), "LOOP_OK",
    "all success/skipped must pass -- this is the ordinary shape of a docs-only or single-package PR");
  assert.throws(() => runWith(withOneReplaced(1, "failure")),
    /Command failed/, "a single 'failure' among the results must fail the loop, or gate cannot do its job");
  assert.throws(() => runWith(withOneReplaced(1, "cancelled")),
    /Command failed/, "'cancelled' must also fail the loop -- an aborted run is not a passed one");
});

test("ci.yml's board job runs exactly the board guards and the claim guard, and DOES build", () => {
  const doc = parseYaml(readWorkflow("ci.yml")) as {
    jobs: Record<string, { if?: string; uses?: string; steps?: Array<Record<string, unknown>> }>;
  };
  const board = doc.jobs.board;
  assert.ok(board, "ci.yml must declare a job named 'board'");
  assert.equal(board.if, "needs.changed.outputs.board == 'true'");
  // A1 (#452): board is now a CALLER, not a step list of its own -- see reusable-board.yml for the
  // actual steps this test goes on to check.
  assert.equal(board.uses, "./.github/workflows/reusable-board.yml",
    "ci.yml's board job must call the extracted reusable-board.yml, not carry its own steps");

  const reusable = parseYaml(readWorkflow("reusable-board.yml")) as {
    jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
  };
  const runLines = Object.values(reusable.jobs).flatMap((j) => j.steps ?? [])
    .map((s) => String(s.run ?? "")).join("\n");
  assert.match(runLines, /packages\/lab\/src\/packaging\/board-\*\.test\.ts/,
    "the board job must run the board-*.test.ts glob -- board-liveness, board-schedule, board-markdown, "
    + "board-achievement-staleness, board-style and board-summary-origin, discovered rather than "
    + "hand-listed");
  assert.match(runLines, /packages\/lab\/src\/packaging\/public-claim\.test\.ts/,
    "the board job must also run public-claim.test.ts -- \"the claim guard\", which reads "
    + "docs/board/reported.json but does not match the board-*.test.ts glob by name");
  // A BUILD IS NEEDED, and the first version of this test asserted the opposite on the strength of a grep
  // that checked only these files' own top-level imports. Running the job's real command with no build
  // present (not reading it) found that board-liveness/board-markdown/board-style/board-summary-origin
  // each drive a scripts/board-*.mjs script that imports @a11ign/worker-fleet/cli-flags -- the
  // stale-dist trap one hop further than the grep looked.
  assert.match(runLines, /npm run build/,
    "the board job must build -- several of its test files drive a scripts/board-*.mjs script that "
    + "imports @a11ign/worker-fleet, which resolves to dist and does not exist unbuilt");
});

test("coverage.yml reports its own failure on the tracking issue -- a nightly nobody reads fails quietly", () => {
  // dispatcher's review of #166: "a gate that does not exercise what ships is not a gate" applies to who
  // is WATCHING a nightly job too, not only to what it exercises. Same pattern board-liveness.yml already
  // uses against #20.
  const doc = parseYaml(readWorkflow("coverage.yml")) as {
    permissions?: Record<string, string>;
    jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
  };
  assert.equal(doc.permissions?.issues, "write",
    "coverage.yml needs issues: write to comment on a failure, or the step below can never run");
  const runLines = (doc.jobs.coverage.steps ?? []).map((s) => String(s.run ?? "")).join("\n");
  const ifs = (doc.jobs.coverage.steps ?? []).map((s) => String(s.if ?? "")).join("\n");
  assert.match(ifs, /failure\(\)/, "the comment step must be gated on if: failure(), or it posts every run");
  assert.match(runLines, /gh issue comment 169/,
    "coverage.yml must comment on #169 (the coverage tracking issue) when the nightly run fails");
});

test("PROOF: readWorkspaceDependencyGraph rendered from the REAL repo has no cycle -- cli and lab in "
  + "particular", () => {
  // #199, chairman's ruling: `a11ign` (cli, published) and `@a11ign/lab` (private, never
  // published) used to depend on EACH OTHER -- a real boundary defect (ADR 0004), not merely a CI-scoping
  // inconvenience. Closed by making `cli.test.ts` compute its own repo-root/captures-path locally instead
  // of importing from `lab` (the same pattern worker-fleet/nvda-worker/judge already use for the identical
  // reason) and dropping `@a11ign/lab` from `cli`'s `devDependencies` entirely. `lab -> cli` (one
  // direction, via `public-api.test.ts` testing the published surface) is legitimate and stays -- a single
  // edge is not a cycle. Driven against the REAL manifests, not a synthetic fixture, so a reintroduced
  // `@a11ign/lab` dependency in `packages/cli/package.json` fails this test rather than silently
  // widening every scoped CI run back to the pair.
  const packages = knownPackages(REPO);
  const graph = readWorkspaceDependencyGraph(REPO, packages);
  assert.ok(!graph.cli.includes("lab"), "cli must not depend on lab -- that is the boundary #199 closed");
  assert.deepEqual(dependentsOf(["lab"], graph), ["lab"],
    "lab must have zero workspace dependents -- if this fails, something (most likely cli again) now "
    + "depends on lab, and testPackages for a lab-only change would widen back to a pair or more");
});
