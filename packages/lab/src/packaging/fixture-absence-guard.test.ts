/**
 * A "GUARANTEED ABSENT" FIXTURE SYMBOL IS A CLAIM ABOUT THE REPOSITORY, NOT ABOUT THE STRING — #1038.
 *
 * `#772 CONTROL` asserted a literal was absent from `origin/main`'s tree, from inside a file on its way
 * **into** `origin/main`. At review time `origin/main` is the BASE and structurally cannot contain the file
 * under review, so the claim was checked against the one tree that could not yet disagree with it — and
 * first became false at the merge. Main went red at 03:52:39Z on 2026-09-12 and was green at 04:19:10Z:
 * **0.38 hours**, against #928's 27.8-hour baseline.
 *
 * | where it ran | what it saw | verdict |
 * |---|---|---|
 * | the PR's CI, base `c2efad4a` | `origin/main` does not contain the file under review | green |
 * | `trunk-guard`, after the merge | `origin/main` now IS the merge | red |
 *
 * `refsCarryingSymbol` was correct both times. **The fixture named itself.**
 *
 * A claim about the repository has to be checked against the repository AS IT WILL BE, and the cheapest
 * stand-in is the **working tree** — which does contain the file under review, and would have failed on
 * the branch rather than after it.
 *
 * THE FILE ALREADY CARRIED THE WARNING. The doc comment above `fixtureSymbolName`, eight lines from the
 * defect, spells out this exact trap for the sibling #719 fixture — written by the same session that then
 * wrote the control without taking it. **A comment is not a guard**, which is the whole of #1027 arriving
 * one file over.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { ABSENT_FIXTURE_SYMBOLS, fixtureSymbol } from "../../../../scripts/fixture-symbols.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

type Violation = { symbol: string; claim: string; file: string; line: number };

/**
 * Every declared-absent symbol that is present in the tree `files`/`read` describe.
 *
 * PURE OVER AN INJECTED TREE, so the mutation the row asks for is expressible: point it at a different
 * tree and the first case must stop failing. A guard whose tree is baked in can be shown to pass and
 * cannot be shown to be asking the right question.
 *
 * `examined` is returned beside the violations because **zero violations and zero declarations are
 * different answers** — a registry that stopped being populated would otherwise read as a clean tree,
 * which is the cleanest possible output and the one this repository has paid for most.
 */
function absenceViolations(
  { symbols, files, read }: {
    symbols: Readonly<Record<string, string>>;
    files: string[];
    read: (path: string) => string;
  },
): { violations: Violation[]; examined: { symbols: number; files: number } } {
  const violations: Violation[] = [];
  for (const file of files) {
    const lines = read(file).split("\n");
    for (const [claim, symbol] of Object.entries(symbols)) {
      const index = lines.findIndex((l) => l.includes(symbol));
      if (index !== -1) violations.push({ symbol, claim, file, line: index + 1 });
    }
  }
  return { violations, examined: { symbols: Object.keys(symbols).length, files: files.length } };
}

/**
 * The TRACKED WORKING TREE — `git ls-files` plus a read of each path.
 *
 * Not `HEAD`, and not `origin/main`. A file staged or merely written is exactly the case that must be
 * caught, and a guard reading `HEAD` is **green by construction before the first commit** — the shape
 * `untracked-files-escape-ls-files-guards` already records one field over.
 */
function trackedWorkingTree(repoRoot: string = REPO): { files: string[]; read: (path: string) => string } {
  // EVERY TRACKED FILE, not a glob of the types I expect a fixture symbol to land in. A pathspec is a
  // guess about where the next leak will be, and the leak that started this row was in a `.ts` only by
  // chance -- a workflow, a fixture `.json`, a doc could carry one just as well.
  //
  // AND `--others --exclude-standard`, WHICH THE POSITIVE CONTROL BELOW FORCED. Plain `ls-files` lists
  // TRACKED files only, so a brand-new test file -- the commonest place a fresh fixture symbol is written
  // -- is invisible until its first commit, and the guard is GREEN BY CONSTRUCTION for exactly the file
  // most likely to carry a new leak. `untracked-files-escape-ls-files-guards` records the shape; this is
  // it arriving in a guard written by someone who had it written down. `--exclude-standard` keeps
  // `.gitignore`d build output out.
  const listed = (args: string[]) =>
    execFileSync("git", ["ls-files", ...args], { cwd: repoRoot, encoding: "utf8", env: sandboxGitEnv() })
      .split("\n").filter(Boolean);
  const files = [...new Set([...listed([]), ...listed(["--others", "--exclude-standard"])])]
    .filter((f) => !f.includes("/dist/"));
  return { files, read: (path) => readFileSync(resolve(repoRoot, path), "utf8") };
}

test("#1038 ACCEPTANCE: a declared-absent symbol PRESENT in the working tree fails, naming file and line", () => {
  // The case that was green for the whole of #1023's review, and red the moment it merged.
  const symbols = { "a test's claim": fixtureSymbol("present-in-this", "-fake-tree-zzz") };
  const tree = {
    files: ["a.ts", "b.ts"],
    read: (p: string) => (p === "b.ts" ? `x\ny\nconst s = "${symbols["a test's claim"]}";\n` : "nothing here\n"),
  };
  const { violations, examined } = absenceViolations({ symbols, ...tree });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "b.ts");
  assert.equal(violations[0].line, 3, "the LINE, so the reader goes to the claim rather than hunting it");
  assert.equal(violations[0].claim, "a test's claim", "and WHICH claim, since the symbol alone says little");
  assert.deepEqual(examined, { symbols: 1, files: 2 });
});

test("#1038: the same symbol absent from the tree passes", () => {
  const symbols = { "a test's claim": fixtureSymbol("absent-from-this", "-fake-tree-zzz") };
  const { violations, examined } = absenceViolations({
    symbols, files: ["a.ts"], read: () => "nothing resembling it\n",
  });
  assert.deepEqual(violations, []);
  assert.deepEqual(examined, { symbols: 1, files: 1 });
});

test("#1038 MUTATION TARGET: the guard must be able to tell two trees apart -- the same symbols against a "
  + "tree WITHOUT the file under review pass, which is exactly how the defect stayed green", () => {
  // The row's own mutation, expressed as a test rather than left to a reviewer: pointing the guard at a
  // tree that cannot see the change (the BASE, which is what `origin/main` is at review time) makes the
  // first case stop failing. If this ever fails, the guard is reading one tree and cannot demonstrate it.
  const symbols = { "a test's claim": fixtureSymbol("present-in-this", "-fake-tree-zzz") };
  const base = { files: ["a.ts"], read: () => "the base does not contain the file under review\n" };
  assert.deepEqual(absenceViolations({ symbols, ...base }).violations, [],
    "against the base it is clean -- and it was clean for the whole of #1023's review");
});

test("#1038: ZERO DECLARATIONS is not ZERO VIOLATIONS -- the examined count is part of the verdict", () => {
  // A registry that stopped being populated would otherwise read as a clean tree. `examined.symbols` is
  // what separates "nothing is wrong" from "nothing was asked".
  const { violations, examined } = absenceViolations({ symbols: {}, files: ["a.ts"], read: () => "x" });
  assert.deepEqual(violations, []);
  assert.equal(examined.symbols, 0, "and the caller below asserts this is NOT zero for the real registry");
});

test("#1038 THE LIVE ASSERTION: every symbol in ABSENT_FIXTURE_SYMBOLS is absent from the TRACKED WORKING "
  + "TREE -- the tree that contains the file under review", () => {
  const tree = trackedWorkingTree();
  assert.ok(tree.files.length > 500, `only ${tree.files.length} files discovered; the walk is broken`);
  assert.ok(Object.keys(ABSENT_FIXTURE_SYMBOLS).length > 0,
    "the registry must not be empty, or this assertion is the clean output of a question nobody asked");
  const { violations, examined } = absenceViolations({ symbols: ABSENT_FIXTURE_SYMBOLS, ...tree });
  assert.deepEqual(violations, [],
    `these symbols are declared absent and are IN the tree:\n  ${violations
      .map((v) => `${v.claim} -- ${v.symbol} at ${v.file}:${v.line}`).join("\n  ")}`);
  assert.equal(examined.symbols, Object.keys(ABSENT_FIXTURE_SYMBOLS).length);
});

test("#1038 POSITIVE CONTROL: the tree this guard reads CONTAINS THE FILE UNDER REVIEW -- without this, "
  + "pointing it at `origin/main` changes nothing and the whole row is undemonstrated", () => {
  // I ran the row's own mutation on the live assertion above -- swap `ls-files` for `ls-tree origin/main`
  // -- and it turned **0 red**, because every declared symbol is absent from both trees. A guard that
  // cannot tell the two trees apart is exactly the defect this row exists to remove, and mine could not.
  //
  // So: a marker that is in the WORKING TREE and, at review time, not in `origin/main` -- this file, which
  // does not exist on the base. The guard must FIND it. Assembled, so the marker is not itself a leak.
  // WRITTEN WHOLE, deliberately, unlike every declared-absent symbol in this file. A positive control has
  // to be a string the tree really contains, and assembling it is what makes the others absent -- my first
  // version assembled this one too and found nothing, which is a control that cannot be the thing.
  const marker = "#1038 POSITIVE CONTROL";
  const tree = trackedWorkingTree();
  const { violations } = absenceViolations({ symbols: { "the positive control": marker }, ...tree });
  assert.equal(violations.length, 1,
    "the guard must find a string that exists only in the file under review -- if it does not, it is "
    + "reading a tree that cannot see this branch, which is the base, which is the defect");
  assert.equal(violations[0].file, "packages/lab/src/packaging/fixture-absence-guard.test.ts",
    "and find it HERE, in the file the base does not have");
});

test("#1038: the registry module does not itself contain any symbol whole -- it assembles them", () => {
  // The registry lives in the tree the guard searches, so a symbol written whole THERE would fail the live
  // assertion above. `fixtureSymbol(...)` splitting the parts is what keeps the one file allowed to name
  // every symbol from being the file that leaks them.
  const source = readFileSync(resolve(REPO, "scripts/fixture-symbols.mjs"), "utf8");
  for (const [claim, symbol] of Object.entries(ABSENT_FIXTURE_SYMBOLS)) {
    assert.ok(!source.includes(symbol), `${claim}: written whole in the registry itself`);
  }
});

test("#1046 ACCEPTANCE: the walk examines BOTH tracked and untracked files, driven over a real repository "
  + "rather than over whatever state my own checkout happened to be in", () => {
  // worker-capture's blocker, and it is my own finding pointed at the guard that fixes it. My table said
  // dropping `--others --exclude-standard` turned 1 red. It did -- IN MY WORKING TREE, where this file was
  // still untracked. At any head where it IS tracked, plain `ls-files` finds the positive control anyway
  // and the mutation turns **0**. So in CI the flag could be deleted in silence, and it is the half that
  // does the work: an untracked file is where a fresh fixture symbol is commonest.
  //
  // **A measurement of a tree state the checker will not be in when it matters** -- the same object as my
  // `{ready, screenReader}` fixture two reviews ago, and as worker-capture's fresh clone carrying
  // committed history and not their uncommitted edit. All three are a probe that cannot observe the thing.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "a11y-fixture-absence-")));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe", env: sandboxGitEnv() });
    git("init", "--quiet");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeFileSync(resolve(repo, "tracked.ts"), "const a = 1;\n");
    git("add", "tracked.ts");
    git("commit", "--quiet", "-m", "one");
    writeFileSync(resolve(repo, "untracked.ts"), "const b = 2;\n");

    const tree = trackedWorkingTree(repo);
    assert.ok(tree.files.includes("tracked.ts"), "a committed file must be examined");
    assert.ok(tree.files.includes("untracked.ts"),
      "AND an uncommitted one -- `ls-files` alone is blind to it, and that is where a new fixture lives");
    assert.equal(tree.files.length, 2, "and nothing else, so the assertion is about these two");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
