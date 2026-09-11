/**
 * #939: `git diff --name-only` DROPS THE SOURCE SIDE OF A RENAME, and nine readers each spelled the diff
 * themselves.
 *
 * Git detects renames by default and prints only where a file WENT. For most readers that is a shorter list
 * than the truth. For the LANE CHECK it was a bypass: a pull request moving a file OUT of another session's
 * lane was not seen by the check that owns that lane. `select-changed-tests.mjs` was fixed alone by #938;
 * this routes the surviving readers through one `changedFiles`, so a tenth reader cannot reintroduce it by
 * writing its own `git diff`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { changedFiles } from "../../../../scripts/changed-files.mjs";
import { laneVerdict, loadLanes } from "../../../../scripts/workflow-lane-check.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");

/** A throwaway repository with one commit that RENAMES a file — the fault, reproduced rather than described. */
function repoWithARename(): string {
  const root = mkdtempSync(join(tmpdir(), "renames-939-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: sandboxGitEnv(), encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/a.mjs"), "export const a = 1;\n".repeat(20));
  git("add", "-A");
  git("commit", "-qm", "first");
  mkdirSync(join(root, "tools"));
  git("mv", "scripts/a.mjs", "tools/a.mjs");
  git("commit", "-qm", "move it");
  return root;
}

test("#939 REPRODUCED: a bare `git diff --name-only` lists only where the file WENT; the helper lists both", () => {
  const root = repoWithARename();
  try {
    const bare = execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"],
      { cwd: root, env: sandboxGitEnv(), encoding: "utf8" }).split("\n").filter(Boolean);
    assert.deepEqual(bare, ["tools/a.mjs"], "if git stopped detecting renames this test would prove nothing");
    assert.deepEqual(changedFiles(["HEAD~1", "HEAD"], { repoRoot: root }).sort(), ["scripts/a.mjs", "tools/a.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#939 THE BYPASS, CLOSED: the lane check sees a file moved OUT of the pipeline lane", () => {
  // `.github/workflows/` belongs to the pipeline lane. A PR from another lane that moves a workflow file OUT
  // of it changed a lane-owned path; with only the destination listed, the check had nothing to refuse.
  const lanes = loadLanes();
  assert.ok(lanes, "lane-ownership.json must be readable, or this test asserts nothing");
  const root = mkdtempSync(join(tmpdir(), "renames-lane-939-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, env: sandboxGitEnv(), encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/moved.yml"), "name: moved\non: push\n");
    git("add", "-A");
    git("commit", "-qm", "first");
    mkdirSync(join(root, "docs"));
    git("mv", ".github/workflows/moved.yml", "docs/moved.yml");
    git("commit", "-qm", "take it out of the lane");
    const seen = changedFiles(["HEAD~1", "HEAD"], { repoRoot: root });
    assert.ok(seen.includes(".github/workflows/moved.yml"), "the source side is what the lane check needs");
    const asked = { changed: seen, branch: "agent/some-capture-row-1", body: "", lanes };
    assert.equal(laneVerdict(asked).code, 1, "a lane-owned path moved away must be refused, not waved through");
    // The control: with only the destination, as before this row, the same PR passes.
    assert.equal(laneVerdict({ ...asked, changed: ["docs/moved.yml"] }).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Every `git diff --name-only` written in a script or a workflow, by file and line. */
function bareDiffSites(): { sites: string[]; scanned: number } {
  const out: string[] = [];
  let scanned = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.(mjs|js|ts|yml|yaml)$/.test(entry.name)) continue;
      scanned += 1;
      readFileSync(path, "utf8").split("\n").forEach((line, i) => {
        // CODE, not prose: this file's own header quotes the bare command, and so do three readers'
        // comments explaining why they stopped using it. A guard that reads its own explanation as a defect
        // is the shape `board-report.mjs` was caught by -- a fixture cannot name itself.
        if (/^\s*(\/\/|\*|#)/.test(line)) return;
        if (!/diff[^\n]*--name-only/.test(line)) return;
        if (/--no-renames/.test(line)) return;
        out.push(`${path.slice(REPO.length + 1)}:${i + 1}`);
      });
    }
  };
  walk(join(REPO, "scripts"));
  walk(join(REPO, ".github/workflows"));
  return { sites: out.sort(), scanned };
}

/**
 * The sites that may still ask bare, each with the reason. `ci.yml`'s `ownedPaths` feed is deliberate: #902
 * removes that job and CODEOWNERS replaces it (#916), and fixing a reader the CI Reset is about to delete is
 * the most expensive kind of row. It is named here so it cannot pass unnoticed once #902 lands — this test
 * fails if it disappears, because an exemption for a site that no longer exists is a claim about nothing.
 */
const BARE_IS_DELIBERATE: Record<string, string> = {
  ".github/workflows/ci.yml": "the /tmp/changed.txt feed for owned-path-signoff, which #902 deletes with the "
    + "ownedPaths job; CODEOWNERS replaces it and #916 carries the same rename question",
};

test("#939 THE SHAPE: no script or workflow asks git for changed paths without --no-renames, bar the named site", () => {
  const { sites: bare, scanned } = bareDiffSites();
  // THE POPULATION FIRST. An empty `unexplained` reads the same whether the tree is clean or the walk
  // never opened a file -- a wrong root, a narrowed extension list, a rename of `scripts/`. 148 files
  // measured 2026-09-11; the floor is a fraction of that, so ordinary churn does not move it.
  assert.ok(scanned >= 100,
    `the walk read ${scanned} files under scripts/ and .github/workflows/ -- the discovery is broken, and `
    + "a clean result here would be a claim about a population it never examined");
  const unexplained = bare.filter((site) => !(site.split(":")[0] in BARE_IS_DELIBERATE));
  assert.deepEqual(unexplained, [],
    "these ask `git diff --name-only` without `--no-renames`, so a file moved OUT of a path they watch is "
    + `invisible to them. Use scripts/changed-files.mjs: ${unexplained.join(", ")}`);
  // And the exemption cannot outlive its site.
  for (const file of Object.keys(BARE_IS_DELIBERATE)) {
    assert.ok(bare.some((site) => site.startsWith(`${file}:`)),
      `${file} is exempted and no longer asks bare -- delete the entry`);
  }
});

test("#939 THE READERS: each surviving one goes through the helper, and board-data asks origin/main", () => {
  const source = (path: string) => readFileSync(join(REPO, path), "utf8");
  for (const reader of ["scripts/ci-changed.mjs", "scripts/changed-packages.mjs", "scripts/changeset-precise.mjs",
    "scripts/board-data.mjs", "scripts/select-changed-tests.mjs"]) {
    assert.match(source(reader), /import \{ changedFiles \} from "\.\/changed-files\.mjs"/,
      `${reader} does not import the shared helper`);
  }
  assert.match(source(".github/workflows/ci.yml"), /node scripts\/changed-files\.mjs origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD > \/tmp\/lane-changed\.txt/,
    "the lane check's own feed must come from the helper");
  // #939's second defect, on the same line: the read-set check compared to LOCAL `main`, which in a shared
  // checkout has been measured over a thousand commits stale.
  assert.match(source("scripts/board-data.mjs"), /changedFiles\(\["origin\/main"\], \{ repoRoot: ROOT, pathspec: \[\.\.\.READ_SET\] \}\)/);
  assert.doesNotMatch(source("scripts/board-data.mjs"), /"diff", "--name-only", "main"/);
});
