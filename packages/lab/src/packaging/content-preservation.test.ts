/**
 * #1087: NOTHING ASSERTS THAT TEXT LEAVING `CLAUDE.md` STILL EXISTS ANYWHERE.
 *
 * #181 is what that costs: a CLAUDE.md split removed **1,337 substantive lines** that appeared neither in
 * the new CLAUDE.md nor anywhere under `docs/`. A large deletion, a green build, and a reviewer expected
 * to notice by hand. #907 deleted the previous guard (`claude-md-content-preservation.test.ts`) because it
 * compared LINE BY LINE and its own message admitted it: *"This guard cannot tell a corrected sentence
 * from a deleted one, and does not try to."*
 *
 * ## THIS MEASURES WHETHER THE TEXT SURVIVED, NEVER WHETHER THE MEANING DID
 *
 * That distinction is the whole design and it is `worker-judge`'s ruling on their own row. A reword that
 * keeps the meaning loses no text -- the fact is still on the page in different words. An instrument that
 * tried to judge MEANING would be a false-negative machine, and that is measured rather than asserted:
 * scoring a removed line against the best-matching paragraph by shared words, over the **6,818 paragraphs**
 * of CLAUDE.md plus `docs/`, gives an INVENTED sentence **0.63** against real removals' 0.71-1.00. With
 * enough paragraphs something always overlaps. So the question is textual: does a long run of these exact
 * words still appear somewhere?
 *
 * ## THE UNIT IS A RUN OF WORDS, NOT A LINE
 *
 * A line is not the unit of text -- a re-wrap moves words across boundaries without removing any, and a
 * de-numbering changes one token in the middle. Both are what a real edit looks like, and both defeated
 * the old guard (its `digitBlind` exemption blanked digits and still could not see a re-wrap).
 *
 * ## HOW THE THRESHOLD WAS SET, AND WHY IT IS CALIBRATION RATHER THAN A LAW
 *
 * Measured against #907's own diff (PR #1080, `8fa9a2ea` -> `67ad999b`), which removed 9 substantive
 * lines from CLAUDE.md. For each, the longest run of its words still present in the new CLAUDE.md plus
 * `docs/` -- and, decisively, WHAT that run was:
 *
 * ```
 * 17  "| [`docs/README.md`](docs/README.md) | the index to every guide and runbook, gro..."
 * 13  "> **THE LOCAL UTM WORKER VMs ARE DEPRECATED. Capture on the bare-metal fleet.**"
 *  9  "`-1` is retired and its number is never reused."
 *  6  "> [`-10` rejoined 2026-09-09 →](docs/operational-lessons.md#a11y-worker-10-withd..."
 * 49  "defined once in `packages/nvda-worker/src/worker-files.mjs`) and reboots each gu..."
 *  7  "A run starts what it needs and"
 *  5  "Do not go looking for"                                        <- GENERIC FILLER
 * 12  "and do not open the UTM GUI — just run the capture."
 *  6  "commit containing files nobody has touched"
 * ```
 *
 * **Eight of the nine matched distinctive text. One matched a generic English phrase.** `"Do not go
 * looking for"` appears in `docs/not-working.md` by coincidence of ordinary wording, not because that
 * line's content was preserved -- its text really was rewritten away. That is the line #1087's own row
 * accounts for when it says *"eight lines, SEVEN are false positives"*: the eighth is a true positive.
 *
 * So the floor sits at **6**, and it is derived from the row author's own 7-of-8 accounting rather than
 * fitted to a target. Four invented sentences written in this repository's vocabulary scored 3, 3, 4, 3.
 *
 * **A fifth invented sentence scored 6 and was a broken fixture, not a datum**: it contained
 * *"while every count-based check stayed green"*, which is near-verbatim CLAUDE.md. A fixture containing
 * the thing it claims is absent tests nothing, and had it been believed the floor would have moved by two.
 *
 * **THE THRESHOLD IS CALIBRATION AND THE NEXT DIFF RE-DERIVES IT RATHER THAN INHERITING IT.** A guard
 * fitted to one diff goes wrong on the next in a direction nobody predicts. That is why the failure
 * message prints the run it MATCHED rather than only the number: a reader who sees what matched can judge
 * the threshold themselves, and a reader handed `6` cannot.
 *
 * ## Two different "empty" cases, kept apart
 *
 * `git diff origin/main -- CLAUDE.md` is meaningless without a real `origin/main` (a shallow checkout has
 * no such ref). But an empty diff, once it resolves, is legitimate: `trunk-guard.yml` runs this suite
 * against main's own tip where HEAD IS `origin/main`. "The ref never resolved" and "the ref resolved and
 * there is nothing new" look identical in the diff's output and only the first is a defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A "substantive" line: long enough that it could not just be a fragment or bare markup punctuation. */
const MIN_SUBSTANTIVE_LENGTH = 25;

/**
 * How many consecutive words must survive for a removed line to count as preserved. See the header for
 * the measurement: 8 of #907's 9 removals matched 6 or more distinctive words; the ninth matched 5 words
 * of generic English and its text really was gone. Invented prose in this repo's vocabulary reached 4.
 */
const MIN_SURVIVING_RUN = 6;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Every `.md` file under `docs/`, recursively. */
function allDocsMd(dir: string): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allDocsMd(path));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

function ensureOriginMain(): void {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
  } catch {
    execFileSync("git", ["fetch", "--depth=50", "origin", "main:refs/remotes/origin/main"],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
  }
}

/** Every substantive line the diff marks as REMOVED from CLAUDE.md, whitespace-normalised. */
export function removedSubstantiveLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => norm(l.slice(1)))
    .filter((l) => l.length > MIN_SUBSTANTIVE_LENGTH);
}

/**
 * The longest run of consecutive words from `line` that still appears in `haystack`, and the run itself.
 *
 * The run is returned, not just its length, because it is the evidence: `"Do not go looking for"` and
 * `"defined once in \`packages/nvda-worker/src/worker-files.mjs\`) and reboots each guest"` are both
 * matches, and only one of them means the content survived. A number cannot say which.
 */
export function longestSurvivingRun(line: string, haystack: string): { words: number; text: string } {
  const w = line.split(" ");
  let words = 0;
  let text = "";
  for (let i = 0; i < w.length; i++) {
    // Start from one longer than the best so far: a shorter run cannot improve the answer, and a run
    // that is absent stays absent when extended, so the inner loop stops at the first miss.
    for (let len = words + 1; i + len <= w.length; len++) {
      const run = w.slice(i, i + len).join(" ");
      if (!haystack.includes(run)) break;
      words = len;
      text = run;
    }
  }
  return { words, text };
}

/** The new CLAUDE.md plus every `docs/*.md` file, concatenated and whitespace-normalised. */
export function haystack(): string {
  const claudeMd = norm(readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8"));
  const docsFiles = allDocsMd(join(REPO_ROOT, "docs"));
  return claudeMd + " " + docsFiles.map((f) => norm(readFileSync(f, "utf8"))).join(" ");
}

/** Removed lines whose longest surviving run falls below the floor, each with what it DID match. */
export function unpreservedLines(removed: string[], hay: string, minRun = MIN_SURVIVING_RUN):
{ line: string; matched: string; words: number }[] {
  return removed
    .map((line) => ({ line, ...longestSurvivingRun(line, hay) }))
    .filter((r) => r.words < minRun)
    .map((r) => ({ line: r.line, matched: r.text, words: r.words }));
}

/**
 * #651: CLAUDE.md's own map is this pattern repeated at almost every paragraph --
 * `... [Detail →](docs/some-file.md#anchor)`. The destination for a removed line is not something this
 * guard has to invent; it is sitting in the same paragraph the line was removed from, in the OLD file.
 */
export function nearestDocsLink(missingLine: string, oldClaudeMd: string): string | null {
  const paragraphs = oldClaudeMd.split(/\n\s*\n/);
  const owner = paragraphs.find((p) => norm(p).includes(missingLine));
  if (owner === undefined) return null;
  const match = /docs\/[\w./-]+\.md/.exec(owner);
  return match ? match[0] : null;
}

/**
 * The refusal. Names the `docs/` file each line belongs in, and prints what the guard DID match so the
 * threshold is auditable from the message rather than only from this file.
 *
 * **The population is stated.** `examined` is here so that zero flags cannot read the same as zero
 * examined -- a guard reporting "0 unpreserved" having looked at nothing is the vacuity this repo has
 * been bitten by, and the count is the only thing that separates the two.
 */
export function unpreservedMessage(
  missing: { line: string; matched: string; words: number }[],
  examined: number,
  oldMd: string,
): string {
  const named = missing.slice(0, 20).map(({ line, matched, words }) => {
    const target = nearestDocsLink(line, oldMd);
    const dest = target ?? "no docs/ link in this line's own paragraph -- see docs/README.md's index "
      + "and pick the sibling file for this section by hand";
    return `-> ${dest}\n   REMOVED: ${line}\n   longest surviving run: ${words} word(s) `
      + `${words === 0 ? "(nothing)" : JSON.stringify(matched)}`;
  });
  return `${missing.length} of ${examined} substantive line(s) removed from CLAUDE.md have no run of `
    + `${MIN_SURVIVING_RUN} consecutive words left anywhere in the new CLAUDE.md or under docs/ -- this `
    + "is #181's failure mode, where 1,337 lines left the file and landed nowhere. This checks whether the "
    + "TEXT survived, not whether the meaning did: a reword keeping a long run is the same text, and a "
    + "reword keeping none is a rewrite worth a human's eye. Move each line into the docs/ file named "
    + `above it, or say on the PR why the text should not survive:\n${named.join("\n")}`
    + (missing.length > 20 ? `\n...and ${missing.length - 20} more` : "");
}

test("origin/main resolves to a real commit -- this test cannot pass having examined nothing", () => {
  // NOT "the diff is non-empty": trunk-guard runs this SAME suite against main's own tip, where HEAD
  // legitimately equals origin/main. The vacuity risk is `origin/main` failing to RESOLVE at all.
  ensureOriginMain();
  const sha = execFileSync("git", ["rev-parse", "--verify", "origin/main"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, `origin/main resolved to "${sha}", not a real commit SHA`);
});

/**
 * THE BASE IS THE MERGE-BASE, AND NEITHER OF THE TWO OBVIOUS SPELLINGS IS RIGHT.
 *
 * `git diff origin/main -- CLAUDE.md` is TWO-DOT: it compares main's tip to this working tree, so a
 * branch that is merely BEHIND main is accused of removing every line main has added since. Measured on
 * a head 741 commits back: **14 removed lines two-dot, 0 three-dot**, and 4 of them flagged -- with the
 * message telling the author to move main's own new text into `docs/`. It does not fire in PR CI, where
 * checkout takes the merge ref and HEAD already contains main; it fires LOCALLY, on any branch that has
 * not merged main, which is the ordinary state here.
 *
 * But `origin/main...HEAD` is not the fix either: three-dot compares against the COMMIT, so it silently
 * drops removals that are still only in the working tree -- exactly the edit this guard should catch
 * soonest, while the author still has the body in front of them.
 *
 * So: resolve the merge-base, then diff the WORKING TREE against it. `fetch-depth: 0` on the `ts` job is
 * what makes `merge-base` resolvable, and `ci.yml`'s `deliberateRefusals` already records that a
 * merge-base diff needs it. Found by `worker-judge` in review, driving these exports against a real
 * behind-main head rather than reasoning about the dots.
 */
test("every substantive line removed from CLAUDE.md still exists as text somewhere", () => {
  ensureOriginMain();
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  const base = git("merge-base", "origin/main", "HEAD").trim();
  const removed = removedSubstantiveLines(git("diff", base, "--", "CLAUDE.md"));
  const missing = unpreservedLines(removed, haystack());
  assert.deepEqual(missing, [], unpreservedMessage(missing, removed.length, git("show", `${base}:CLAUDE.md`)));
});

/**
 * The positive control for the assertion above, which is an emptiness assertion and passes when the
 * population is empty. On main's own tip the diff is legitimately empty, so without this the real test
 * is green having compared nothing -- and that is the state it would sit in for most of its life.
 */
test("CONTROL: a line present nowhere IS reported, and one present verbatim is not", () => {
  const hay = norm("the fleet is defined once in inventory.yml and every box serves /health");
  const gone = "the witness harness reconciles every ledger entry against the shadow manifest nightly";
  // `words: 1` and `matched: "the"`, not zero: the haystack contains the word "the". That is the point of
  // returning the run rather than a bare length -- a match can be real and worth nothing, and the reader
  // can see which. An expectation of 0 here would have been wrong about the code, not about the rule.
  assert.deepEqual(unpreservedLines([gone], hay), [{ line: gone, matched: "the", words: 1 }],
    "a line sharing nothing substantive with the haystack must be reported, with its useless match shown");
  assert.deepEqual(unpreservedLines(["the fleet is defined once in inventory.yml"], hay), [],
    "a line present verbatim must not be reported");
});

test("a re-wrapped line is NOT reported -- a re-wrap moves words across boundaries, it removes none", () => {
  // The shape every real edit takes, and the one the old line-by-line guard could not see.
  const hay = norm("Deploy pushes every hashed file, defined once in worker-files.mjs, and reboots each guest");
  const rewrapped = "Deploy pushes every hashed file, defined once in worker-files.mjs, and";
  assert.deepEqual(unpreservedLines([rewrapped], hay), []);
});

test("a de-numbered sentence is NOT reported -- the number goes, the sentence stays", () => {
  // #907's deliverable: a number in prose must be free to change. The old guard's `digitBlind` exemption
  // existed for exactly this and still failed, because it blanked digits without addressing the unit.
  const hay = norm("the index to every guide and runbook, grouped by task, for the decision records");
  const numbered = "the index to every guide and runbook, grouped by task, for the 37 decision records";
  assert.deepEqual(unpreservedLines([numbered], hay), []);
});

test("the refusal names the docs/ file, the removed line, AND what it matched", () => {
  const oldMd = "Some paragraph about the fleet that was removed.\n[Full detail →](docs/operational-lessons.md#x)";
  const msg = unpreservedMessage(
    [{ line: "Some paragraph about the fleet that was removed.", matched: "about the fleet", words: 3 }],
    9, oldMd);
  assert.match(msg, /docs\/operational-lessons\.md/, "the remedy must name where the text belongs");
  assert.match(msg, /longest surviving run: 3 word\(s\) "about the fleet"/,
    "the run it matched is the evidence -- a reader handed only a number cannot judge the threshold");
  assert.match(msg, /1 of 9 substantive line\(s\)/,
    "the population is stated, so zero flags cannot read the same as zero examined");
});

test("MIN_SURVIVING_RUN separates #907's real removals from invented prose", () => {
  // The calibration, as a test rather than a claim in a comment. These are the measured runs from #907's
  // diff (see the header) and from four invented sentences written in this repository's vocabulary.
  const realRemovals = [17, 13, 9, 6, 49, 7, 12, 6];
  const inventedProse = [3, 3, 4, 3];
  for (const words of realRemovals) {
    assert.ok(words >= MIN_SURVIVING_RUN,
      `a real removal surviving ${words} words must not be reported at a floor of ${MIN_SURVIVING_RUN}`);
  }
  for (const words of inventedProse) {
    assert.ok(words < MIN_SURVIVING_RUN,
      `invented prose surviving ${words} words must be reported at a floor of ${MIN_SURVIVING_RUN}`);
  }
  // The ninth line of #907's nine is deliberately absent from `realRemovals`: it survived 5 words, and
  // those 5 words were "Do not go looking for" -- generic English matching `docs/not-working.md` by
  // coincidence. Its text really was rewritten away, which is the row's own "seven of eight".
  assert.equal(5 < MIN_SURVIVING_RUN, true,
    "the true positive among #907's eight flags must still be reported");
});

/**
 * #907's OWN DIFF, driven end to end -- the row's first acceptance bullet, and the only test here that
 * touches real history rather than a hand-made haystack.
 *
 * The commits are pinned. `8fa9a2ea` -> `67ad999b` is PR #1080, which deleted the previous guard and
 * reworded the paragraphs it had been refusing. **The old guard flagged 8 of these 9 lines. This flags 1**,
 * and the 1 is the line whose only surviving words are `"Do not go looking for"` -- generic English
 * matching `docs/not-working.md` by coincidence, not preserved content.
 *
 * SKIPS HONESTLY where the objects are absent: a shallow CI checkout has neither commit, and a test that
 * silently passed there would report a calibration it never ran. The skip names the reason.
 */
test("#907's diff: the old guard flagged 8 of 9, this flags the 1 whose text really went", (t) => {
  const BASE = "8fa9a2ea";
  const HEAD = "67ad999b";
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  try {
    git("cat-file", "-e", `${BASE}^{commit}`);
    git("cat-file", "-e", `${HEAD}^{commit}`);
  } catch {
    // DEFENCE ONLY, and say so rather than implying it fires: every job running this suite uses
    // `fetch-depth: 0`, so a shallow checkout cannot happen in CI today. `worker-judge` exercised this
    // path against a fixture repo at the same depth -- `origin/main` resolving, neither commit present --
    // and it reported `skipped 1` with `pass 7 fail 0`, so the branch is tested rather than assumed.
    t.skip(`#907's commits (${BASE}, ${HEAD}) are not in this checkout -- shallow clone. `
      + "Not run, and not counted as a pass.");
    return;
  }
  const removed = removedSubstantiveLines(git("diff", BASE, HEAD, "--", "CLAUDE.md"));
  assert.equal(removed.length, 9, "the population is pinned: #907 removed 9 substantive lines");
  const docs = git("ls-tree", "-r", "--name-only", HEAD, "docs/").split("\n").filter((f) => f.endsWith(".md"));
  const hay = norm(git("show", `${HEAD}:CLAUDE.md`)) + " "
    + docs.map((f) => norm(git("show", `${HEAD}:${f}`))).join(" ");
  const missing = unpreservedLines(removed, hay);
  assert.equal(missing.length, 1,
    `expected exactly the one true positive; got ${missing.length}: `
    + missing.map((m) => `${m.words}w ${JSON.stringify(m.matched)}`).join(", "));
  assert.match(missing[0].line, /Do not go looking for another/);
  assert.equal(missing[0].words, 5, "and it survives 5 words -- one below the floor, which is the margin");
  assert.equal(missing[0].matched, "Do not go looking for",
    "the matched run is generic English, which is why 5 words is not preservation");
});

/**
 * THE CASE THAT DISTINGUISHES TWO-DOT FROM THREE-DOT, which the suite did not have.
 *
 * A branch LEVEL with main produces the same answer either way, so every test that exercises the happy
 * state is blind to this. The distinguishing case is a branch genuinely BEHIND main with no removals of
 * its own: two-dot accuses it of removing everything main has added since it forked, and the accusation
 * grows louder the longer the branch lives. `product-manager` named the mutation; `worker-judge` found
 * the defect by driving these exports rather than re-implementing the comparison beside them.
 *
 * Driven against real history rather than a fixture, because the bug was never in the comparison -- it
 * was in which two trees were handed to it, and a hand-made diff cannot be wrong in that way.
 */
test("a branch merely BEHIND main is accused of nothing -- the two-dot trap", (t) => {
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  ensureOriginMain();
  // DERIVED, not a magic depth: the parent of the last commit that touched CLAUDE.md is by construction
  // a point where main has since changed the file. My first attempt used `--skip=200` and the guard
  // below caught it -- CLAUDE.md had not moved in 200 commits, so the naive diff reported 0 and the test
  // would have passed having exercised nothing. A depth chosen by eye is a depth that goes stale.
  const lastTouch = git("log", "-n1", "--format=%H", "origin/main", "--", "CLAUDE.md").trim();
  if (lastTouch === "") {
    t.skip("no commit touching CLAUDE.md in this history -- shallow clone. Not run, and not a pass.");
    return;
  }
  const behind = git("rev-parse", `${lastTouch}^`).trim();
  const naive = removedSubstantiveLines(git("diff", "origin/main", behind, "--", "CLAUDE.md"));
  const base = git("merge-base", "origin/main", behind).trim();
  const correct = removedSubstantiveLines(git("diff", base, behind, "--", "CLAUDE.md"));

  // The trap must be REAL at this depth, or this test proves nothing by passing.
  assert.ok(naive.length > 0,
    "the naive two-dot diff reported no removals, so this history cannot exercise the trap -- the test "
    + "would pass for the wrong reason");
  assert.equal(base, behind,
    "a commit reachable from main IS its own merge-base with main; if this moved, the setup is wrong");
  assert.deepEqual(correct, [],
    `a branch that is only BEHIND main removed nothing, but the merge-base diff found ${correct.length} `
    + "removed line(s) -- the base is wrong");
});
