/**
 * `docs/backlog.md` states file line counts as facts, and nothing checked whether they stayed facts.
 *
 * Found 2026-09-06 auditing the backlog for staleness (a peer's own audit, done in about ten minutes,
 * found the same class of drift without trying): `rules.ts` was recorded at 1,993 lines and marked
 * "in flight" long after `9b13696` had split it to 1,381; `capture-core.mjs` was recorded at "4,856" after
 * it had already been split three ways down to 334. A tracker whose own numbers drift is the shape
 * CLAUDE.md already warns about for worker VMs and the page server, applied to its own text.
 *
 * ## #703: EVERY CLAIM NOW NAMES THE COMMIT IT WAS MEASURED AT
 *
 * The first version of this file compared the doc's number to the file's size AT HEAD, which made every
 * claim false the moment the file changed length for any reason at all. That is not a hypothetical: a
 * push was refused for a change to `capture-probes.mjs` that touched nothing the backlog documents, and
 * the file's own row records the count passing through 3,182 -> 3,205 -> 3,223 -> 3,242 -> 3,248 ->
 * 3,231 -> 3,258 in two days. Measured across the six pinned files, 1-9 September: 39 commits to
 * `case-matrix.mjs`, 32 to `capture-core.mjs`, 21 to `rules.ts`, 16 to `capture-probes.mjs`. **Four of
 * the six churn hard, so the cost was not one bad pin.**
 *
 * A claim about a NAMED COMMIT cannot be falsified by later work, and it is still a claim: change the
 * number, or name a different commit, and this fails. That is the repo's own rule for a reproduction --
 * what you ran, what it said, and as of which commit -- applied to a document.
 *
 * **AND IT SPLITS IN TWO, BECAUSE CI CANNOT REACH HISTORY.** `actions/checkout@v4` clones at depth 1 and
 * the `docs` job -- the one that runs this directory whenever a document changes -- does not deepen. So
 * the count half SKIPS there, loudly, naming the commit it could not reach and the line that would let it
 * (`History: full` in the PR body); and the half that needs no history at all -- every pinned file still
 * exists -- runs everywhere. Found by CI rather than by reading: the first version THREW on a shallow
 * clone, which would have refused every docs change over a question it never asked.
 *
 * **What was kept, deliberately.** The doc's row defends its pin: two 2026-09-06 bundle branches
 * CONFLICTED on exactly these numbers, and "a pinned number turned a silent drift into a merge conflict"
 * three times. That property is NOT the assertion -- it is two branches editing the same prose line, and
 * a dated number still conflicts exactly as an undated one did. The check that fires on correct work was
 * removed; the check that fires on divergence was not (#637's shape, and this row was written to avoid
 * it).
 *
 * ## Why a handful of hard checks rather than a markdown parser
 *
 * The backlog is free-form prose by design — "the file whose entire purpose is honesty about coverage"
 * elsewhere in this repo reads worse as a rigid schema. Parsing every row generally would be the "esoteric
 * language" trap the SRE Workbook names for YAML+Jinja, applied to Markdown. So this pins a SMALL, NAMED
 * set of claims that are cheap, unambiguous, and were actually found stale — not a general prose grammar.
 * Each pin fails LOUDLY if the exact phrase it looks for has moved, rather than silently matching nothing:
 * a regex that finds zero matches is a vacuity bug in this test, not a fact about the codebase, so every
 * check asserts it found the phrase before comparing the number inside it.
 *
 * **This file is the whole enforced population**, discovered rather than recalled: of every `*.test.ts`
 * and `*.test.mjs` in the tree that reads `docs/` and computes a line count, this is the only one, and it
 * holds six pins. `docs/` states an "N lines" figure in 20 places across five files; the other fourteen
 * are prose about a measurement, enforced by nothing.
 *
 * Extending this file: add a new file-fact pin only for a claim that is genuinely a single number tied to
 * one file's size AT A NAMED COMMIT. Leave everything else — "is this cycle actually closed", "does this
 * test still pass" — to reading the code, which is what this same audit pass did for the majority of its
 * findings.
 */
// requires: history
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKLOG = readFileSync(`${REPO}docs/backlog.md`, "utf8");

/**
 * `wc -l` counts newlines, not array-split length — a file ending without a trailing newline would
 * otherwise be over-counted by one, and this repo's own files are newline-terminated.
 */
function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

/**
 * THE FILE AS IT WAS AT THE COMMIT THE CLAIM NAMES — the whole point of #703. `null` when this checkout
 * cannot reach that commit, which is a different answer from "the claim is wrong" and must not render as
 * one: a missing object read as a mismatch reports all six claims broken on every shallow clone.
 */
function fileAtCommit(sha: string, relativePath: string): string | null {
  try {
    return execFileSync("git", ["-C", REPO, "show", `${sha}:${relativePath}`],
      { encoding: "utf8", env: sandboxGitEnv(), maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * WHY THIS SKIPS RATHER THAN FAILS, AND WHY IT SAYS SO LOUDLY.
 *
 * `actions/checkout@v4` clones at depth 1, so CI's `docs` job — which runs this whole directory — cannot
 * reach a historical commit, and the acceptance job reaches one only when the PR body carries the bare
 * line `History: full`. A test that FAILED there would refuse every docs change over a question it never
 * asked, which is #703's own defect wearing different clothes.
 *
 * The repo's precedent, from CLAUDE.md: the pre-push hook "SKIPS corpus-dependent checks LOUDLY when
 * `runs/` is absent, rather than passing quietly", and `verify.corpus.test.ts` "skips honestly in CI".
 * A skip naming what it could not ask is honest; a pass is not.
 *
 * What runs everywhere regardless is `every pinned file exists` below: a rename or a deletion is a
 * documented fact changing, and it is caught at depth 1 with no history at all.
 */
const NO_HISTORY = (sha: string, file: string) =>
  `SKIPPED, NOT PASSED: this checkout cannot reach ${sha}, so ${file}'s claim could not be asked. `
  + "Locally: `git fetch --unshallow origin main`. In CI: put the bare line `History: full` in the PR "
  + "body — that is what `acceptance-commands.mjs` reads. (`requires: history` is the TEST FILE header "
  + "convention, not the PR one; this message named the wrong one until CI said so.)";

interface FileFactPin {
  /**
   * What the backlog claims, and where — quoted verbatim, not summarised, so a diff of this file shows
   * the English too. IT CARRIES NO NUMBER. Restating the count here is what made the old version of this
   * test wrong about five of its own six pins: the label was a second copy nobody compared, and
   * `case-matrix.mjs` read "4,074" while the doc said 4,272 and the file was 4,272.
   */
  claim: string;
  /** A regex over `docs/backlog.md`, capturing `count` and the `sha` that count was measured at. */
  pattern: RegExp;
  /** The real file the claim is about. */
  file: string;
}

const PINS: FileFactPin[] = [
  {
    claim: "case-matrix.mjs's size after the two-cuts split",
    pattern: /`case-matrix\.mjs` \| 5,699 \| almost entirely DATA[^|]*\| \*\*(?<count>[\d,]+)\*\* — checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`/,
    file: "packages/lab/src/training/case-matrix.mjs",
  },
  {
    claim: "capture-core.mjs's size after the three-way split",
    pattern: /the three-way split below: `capture-core\.mjs` (?<count>[\d,]+),[^)]*?checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`/,
    file: "packages/nvda-worker/src/capture-core.mjs",
  },
  {
    claim: "capture-setup.mjs's size after the three-way split",
    pattern: /`capture-setup\.mjs` (?<count>[\d,]+), `capture-probes\.mjs`[^)]*?checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`/,
    file: "packages/nvda-worker/src/capture-setup.mjs",
  },
  {
    claim: "capture-probes.mjs's size after the three-way split",
    pattern: /`capture-probes\.mjs` (?<count>[\d,]+) \(checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`/,
    file: "packages/nvda-worker/src/capture-probes.mjs",
  },
  {
    claim: "rules.ts's size after 9b13696 split out channel-comparison.ts",
    pattern: /Checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`: `rules\.ts` (?<count>[\d,]+),/,
    file: "packages/judge/src/rules.ts",
  },
  {
    claim: "channel-comparison.ts's size after 9b13696",
    pattern: /Checked `wc -l` at `(?<sha>[0-9a-f]{7,40})`: `rules\.ts` [\d,]+, `channel-comparison\.ts` (?<count>[\d,]+)\./,
    file: "packages/judge/src/channel-comparison.ts",
  },
];

for (const { claim, pattern, file } of PINS) {
  test(`backlog.md's claim survives: ${claim}`, (t) => {
    const match = BACKLOG.match(pattern);
    // The vacuity guard this file's header promises: a pattern matching nothing means the WORDING moved,
    // which is a reason to fix the pattern, not a reason to skip the check silently.
    assert.ok(match?.groups, `could not find the phrase this pin looks for in docs/backlog.md -- the row's `
      + `wording changed and this pattern needs updating, not removing: ${pattern}`);
    const { count, sha } = match!.groups!;
    const blob = fileAtCommit(sha!, file);
    if (blob === null) return t.skip(NO_HISTORY(sha!, file));
    const claimed = Number(count!.replace(/,/g, ""));
    const actual = countLines(blob);
    assert.equal(claimed, actual,
      `docs/backlog.md claims ${file} was ${claimed} lines (\`wc -l\`) at ${sha}, and at that commit it `
      + `was actually ${actual}. This is a claim about a FIXED commit, so the file's size today cannot `
      + `have broken it -- either the number is wrong or the commit named is not the one it was measured `
      + "at. Do not 'fix' this by re-measuring against HEAD; re-date the claim instead.");
  });
}

test("every pinned file exists — the half that runs with no history at all", () => {
  // A rename or a deletion IS a documented fact changing, and it is the half of #703's mutation that
  // needs no historical commit: catchable on the depth-1 clone CI's `docs` job has.
  for (const { claim, file } of PINS) {
    assert.ok(existsSync(`${REPO}${file}`),
      `docs/backlog.md's claim "${claim}" is about ${file}, which does not exist. Either the file moved `
      + "and the row should say so, or the row names a path that was never right.");
  }
});

test("no pin's claim restates the number, because the copy nobody compares is the one that drifts", () => {
  // 2026-09-09, #703: five of six `claim` strings carried a stale integer -- 4,074 for a 4,272-line file,
  // 1,381 for a 1,588-line one -- inside the guard whose entire purpose is stopping that drift. A number
  // stated twice with nothing comparing the copies is this repo's most-repeated defect, and this pins the
  // remedy rather than trusting the next author to remember it.
  // A COUNT, not any digit: `9b13696` is a commit and naming one here is exactly right. The shape
  // forbidden is a standalone integer -- `4,074`, `1381` -- which is the thing that had drifted.
  const looksLikeACount = /\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/;
  for (const { claim } of PINS) {
    assert.doesNotMatch(claim, looksLikeACount,
      `the pin "${claim}" states a count. The number belongs in docs/backlog.md, where the test reads it `
      + "and compares it against the commit it names -- not here, where nothing checks it. A commit sha "
      + "is fine.");
  }
});

test("every pinned claim names a commit, so a later length change cannot falsify it", () => {
  // #703's whole point: a claim keyed on HEAD fails whenever the file changes length for an unrelated
  // reason -- measured, `capture-probes.mjs` took 16 commits in eight days and `case-matrix.mjs` 39.
  for (const { claim, pattern } of PINS) {
    assert.match(pattern.source, /\?<sha>/,
      `the pin "${claim}" does not capture a commit, so it is asserting about HEAD again.`);
  }
});
