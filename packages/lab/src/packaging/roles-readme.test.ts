// EVERY ROLE THIS ORGANISATION DEPENDS ON MUST BE READABLE FROM THE REPO ALONE, OR IT DOES NOT SURVIVE
// THIS MACHINE BEING LOST.
//
// `docs/roles/README.md` indexes eight role files -- `ceo`, `orchestrator`, `dispatcher`, and five
// workers -- because a board finding on 2026-09-06 was that every one of them except `dispatcher` existed
// only in session history: nowhere a fresh agent, or a stranger with no context, could read to become that
// role. This test is the enforcement that keeps the set complete rather than a document that says it is --
// EXCEPT that "complete" is split into two different obligations, deliberately checked differently. An
// EXISTING file that is malformed is that agent's own defect and fails the suite. A file that has simply
// not landed yet belongs to a different agent's queue, and is REPORTED rather than failed, so this test
// does not put every other push on hold for someone else's unfinished homework -- see the comment on the
// "missing role files are reported" test below for the reasoning and the prior incident it is grounded in.
//
// DISCOVERED from the README's own roster table, never hand-listed -- the same shape as every other
// discovery test this repo has, for the reason CLAUDE.md gives all of them: a hand-maintained "the roles
// that matter" list is exactly the kind of list a ninth role slips past.
/**
 * #954: THE CROSS-REFERENCE HALF OF THIS FILE IS OFF THE PULL-REQUEST PATH. `roles-readme`'s rule now runs
 * once a night, in `scripts/doc-cross-reference-report.mjs`, which imports the same module this file
 * does -- so nothing about the rule changed, only when it runs and what a disagreement costs. See #905
 * for the argument and #954 for the retirement, which waited until the first nightly report had posted.
 *
 * WHAT STAYS HERE is what that report does not assert: the roster mutation case, built in a temporary directory, and the contingency drill section.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
// #905: the roster parser and the per-file check live in the doc cross-reference check the nightly report
// also runs -- one copy, which is what this file's own "exercise the exact same logic" comment asked for.
import { README_PATH, checkRoster, roster } from "../../../../scripts/doc-checks/roles-readme.mjs";

const readReadme = () => readFileSync(resolve(process.cwd(), README_PATH), "utf8");

test("the contingency drill section and its GIT_DIR warning both exist", () => {
  const source = readReadme();
  assert.match(source, /^## The contingency drill/m, `${README_PATH} must keep the drill section`);
  assert.match(source, /GIT_DIR/,
    `${README_PATH}'s drill must warn that a git call made with only cwd set follows GIT_DIR, not cwd -- `
    + "found the hard way the same night this page was written, from the pre-push hook exporting it");
});

/**
 * THE MUTATION HALF, against a synthetic roster and synthetic files under `os.tmpdir()` -- never against
 * the real `docs/roles/` tree, because deleting a real agent's file even temporarily is not something a
 * shared, git-hooked checkout should risk mid-test-run. Proves every direction the split above depends on:
 * a missing file is REPORTED (never thrown), an incomplete existing file IS thrown, a complete one is
 * clean, and breaking the discovery itself is caught before any per-row check could pass having examined
 * nothing.
 */
test("MUTATION: missing is reported not failed, incomplete fails, and a broken roster table is caught by the vacuity guard", () => {
  const goodReadme = "# If this machine is lost\n\n## The roster\n\n"
    + "| role | agent name | file | reports to |\n"
    + "|---|---|---|---|\n"
    + "| Example | `example-agent` | [example.md](./example.md) | `example-boss` |\n";

  // Baseline: the parser finds the one row, correctly.
  const found = roster(goodReadme);
  assert.equal(found.length, 1, "the roster parser did not find the one well-formed row -- broken baseline");
  assert.equal(found[0].agent, "example-agent");
  assert.equal(found[0].filePath, "docs/roles/example.md");
  assert.equal(found[0].reporter, "example-boss");

  const dir = mkdtempSync(join(tmpdir(), "roles-readme-mutation-"));
  const complete = join(dir, "complete.md");
  const incomplete = join(dir, "incomplete.md");
  const missing = join(dir, "does-not-exist.md");
  writeFileSync(complete, "# Example role -- `example-agent`\n\n## What this lane owns\n\n"
    + "Reports to `example-boss`.\n\n## The resource ban\n\nmust never do this: collision into a silent wrong answer.\n");
  writeFileSync(incomplete, "# Example role\n\nNo agent name, no ban, no reporter here.\n");

  // Missing: reported, never thrown -- this is the whole point of the split.
  const missingResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: missing, reporter: "example-boss" }]);
  assert.equal(missingResult.missing.length, 1, "a nonexistent file must be counted as missing");
  assert.equal(missingResult.incomplete.length, 0, "a MISSING file must never also be reported incomplete -- that would fail the wrong test");

  // Incomplete: an existing file lacking the four required parts DOES fail, because it is the pushing
  // agent's own defect to fix.
  const incompleteResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: incomplete, reporter: "example-boss" }]);
  assert.equal(incompleteResult.missing.length, 0);
  assert.ok(incompleteResult.incomplete.length > 0, "an existing file missing its name/reporter/lane/ban must be caught, not waved through");

  // Complete: no complaints either way.
  const completeResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: complete, reporter: "example-boss" }]);
  assert.deepEqual(completeResult, { missing: [], incomplete: [] }, "a well-formed file must produce no report at all");

  // Mutation: break the table row format itself (drop a pipe), simulating the shape change this guard
  // exists to catch -- must find ZERO rows, not silently skip the malformed one and report success on an
  // empty set.
  const brokenReadme = goodReadme.replace(
    "| Example | `example-agent` | [example.md](./example.md) | `example-boss` |",
    "| Example  `example-agent` | [example.md](./example.md) | `example-boss` |", // missing a leading pipe
  );
  assert.equal(roster(brokenReadme).length, 0,
    "a malformed table row (missing a pipe) was still parsed -- the row regex is too permissive to catch "
    + "a real format change");
});

test("#1096 the review-verdict convention is in the README, by its parts, with the reason the sha is there", () => {
  // Parts, not one frozen sentence: a test pinning the whole string fails on a comma and teaches the next
  // editor to edit the test. The sha sentence is what makes this a protocol rather than a format.
  const source = readReadme();
  assert.match(source, /^## Review verdicts/m, "the README must carry the convention under its own heading");
  assert.match(source, /Review of #<n> at `<head8>`, by <session>: convinced\./, "the convinced form");
  assert.match(source, /by <session>: not convinced/, "the not-convinced form");
  assert.match(source, /a verdict is on a head, never on a PR/i, "why the sha is there");
  assert.match(source, /author marks the PR ready on\s+`convinced`; a reviewer never arms or merges/,
    "who arms: the author, never the reviewer");
});


// ---------------------------------------------------------------------------------------------------
// #1118: THE PROVISIONAL PERIOD HAD NO END CONDITION AND ITS MARKER WAS INVISIBLE TO EVERY MATCHER.
//
// "`ceo` lifts that line when the sample holds" named no sample and no threshold. A condition nobody can
// evaluate resolves by FATIGUE — the line comes out when spot-checking feels unnecessary, which is
// exactly when a missed disagreement is least likely to be noticed.
//
// Asserted BY SHAPE, not by matching one frozen sentence: a guard pinned to today's wording would refuse
// the next honest rewrite and prove nothing about whether a condition exists.
// ---------------------------------------------------------------------------------------------------

const reviewerBrief = readFileSync(
  new URL("../../../../docs/roles/reviewer.md", import.meta.url), "utf8");

test("#1118: the lift condition is COUNTABLE — a number, a checker, and what counts as held", () => {
  assert.match(reviewerBrief, /\b(five|5)\b[^.]*\bconsecutive\b/i,
    "the lift condition must name how many verdicts; \"when the sample holds\" is a condition nobody "
    + "can evaluate, and one nobody can evaluate resolves by fatigue");
  assert.match(reviewerBrief, /spot-check(s|ed|ing)?[^.]*\b(ceo|worker-judge)\b/i,
    "and WHO spot-checks, or the condition names a process with no actor");
  assert.match(reviewerBrief, /re-running the PR's Acceptance line and one Mutation/,
    "and what a spot-check IS -- otherwise 'spot-checked' means whatever the reader already does");
});

test("#1118: it says what a DISAGREEMENT does, not only what agreement does", () => {
  // THE CLAUSE THAT MATTERS MOST. A condition that only says when to stop checking cannot say when to
  // start again, and the spot-check that does not hold is the outcome the whole arrangement exists for.
  assert.match(reviewerBrief, /does not hold[^.]*resets the count to zero/i,
    "a failed spot-check must have a stated consequence");
  assert.match(reviewerBrief, /puts the line back/i,
    "and the period must be able to RESTART after the lift, or 'lifted' means 'never checked again'");
});

test("#1118: the count is PER MODEL, because a sample of one model says nothing about another", () => {
  // Not a detail: this role's model was swapped on 2026-09-12 when its quota ran out. A count carried
  // across that swap would report a sample that was never taken of the thing being sampled.
  assert.match(reviewerBrief, /per model/i, "the count must be per model");
  assert.match(reviewerBrief, /model change restarts the count at zero/i,
    "and a swap must restart it -- otherwise the number measures the arrangement rather than the model");
});

test("#1118: the provisional marker is ON THE VERDICT LINE, where the sha-plus-word matcher reads", () => {
  // THE SHARPER HALF OF THE ROW. `(provisional: ...)` as prose on a FOLLOWING line is legible to a human
  // and invisible to every automated reader in the org: a provisional verdict and a full one are
  // identical to the clock, so nothing could report how many were outstanding. On the line, it can.
  assert.match(reviewerBrief, /by reviewer: convinced \(provisional\)/,
    "the marker must sit inside the verdict sentence the matcher already parses");
  const stale = reviewerBrief.match(/^.*\(provisional: spot-check before ready\).*$/m);
  assert.equal(stale, null,
    "the old off-line marker must be gone, not merely joined by the new one -- two spellings of one "
    + "state is how a matcher ends up seeing neither");
});

// --- #1157: the line that stands in for a guard the 64 call-derived assertions cannot have ------------
//
// `ceo` split 236 emptiness assertions three ways on 2026-09-12: a RULE where a rule can work (the 64
// derived-local, #1155), a DEFINITION where the shape is not yet understood (the 73 accumulators, #1156),
// and a WRITTEN HABIT where neither can — the 64 derived from a CALL, which no rule can trace without
// guessing at what the call returns.
//
// **This repository loses habits, and that is the argument against this line rather than a reason to omit
// it.** The counter is that the alternative is a rule that infers intent, which is the defect this whole
// family is about one level up. So the habit is written in both places a reader meets it, and pinned here
// so it cannot quietly leave one of them.
//
// ASSERTED IN EACH FILE SEPARATELY, never as "at least one of the two carries it". A check satisfied by
// either copy is a check that lets them drift — which is the fact-stated-twice defect, landing on the line
// that tells people how to avoid defects.

const agentPractices = readFileSync(
  new URL("../../../../.claude/rules/agent-practices.md", import.meta.url), "utf8");

const POSITIVE_CONTROL = /an emptiness assertion names where its positive control lives/i;

/**
 * EVERY ASSERTION BELOW READS THE FLATTENED TEXT, and this file is the third place today that learned it
 * the same way. Both documents wrap, so the sentence is split across a line break in `reviewer.md`
 * (`**An emptiness\n   assertion names...`) and not in `agent-practices.md` -- **a prose assertion against
 * a wrapped file is matching a line, not a sentence**, and the failure is a silent non-match that reads
 * exactly like the prose being absent.
 *
 * It was caught here by the mutation's own landing check rather than by care: `assert.notEqual(without,
 * text)` fired because the replace had matched nothing. That is the pre-read check #1165 is about, working.
 */
const flat = (/** @type {string} */ text: string) => text.replace(/\s+/g, " ");

test("#1157: the practices file carries the line, with what makes it applicable rather than aspirational", () => {
  assert.match(flat(agentPractices), POSITIVE_CONTROL,
    "the sentence itself, since this is the only thing standing in for a guard on 64 assertions");
  assert.match(flat(agentPractices), /point at it/i,
    "and the operative half: a control you BELIEVE in is not one you can POINT AT, which is the "
    + "difference between this line and an encouragement");
  assert.match(flat(agentPractices), /64 derive from a CALL|64 call-derived/i,
    "and the population it covers, so a reader can tell whether their case is one of them");
});

test("#1157: the reviewer's entry says what a reviewer DOES, not that the property is desirable", () => {
  const brief = flat(reviewerBrief);

  assert.match(brief, POSITIVE_CONTROL, "the same sentence, in the other place a reader meets it");
  assert.match(brief, /\bask where its positive control lives\b/i,
    "an instruction with a verb -- a checklist item that states a property gives the reviewer nothing to do");
  assert.match(brief, /point at it, not describe it/i,
    "and names what counts as an answer, or 'ask' is satisfied by any reply");
  assert.match(brief, /you are the check/i,
    "and says where the reviewer's judgement is the ONLY instrument, which is the whole reason the line "
    + "exists rather than a rule");
});

test("#1157 MUTATION: removing the line from EITHER file must go red, not just from both", () => {
  // The row's clause 3, driven rather than asserted. Two copies with a check that accepts either would
  // let one drift away silently -- and the drift would be invisible precisely because the other copy
  // still reads correctly to anyone who looks in one place.
  for (const [name, text] of [["agent-practices.md", agentPractices], ["reviewer.md", reviewerBrief]]) {
    const without = flat(text).replace(POSITIVE_CONTROL, "a removed sentence");
    assert.notEqual(without, flat(text), `the mutation must LAND in ${name}, or this proves nothing`);
    assert.doesNotMatch(without, POSITIVE_CONTROL,
      `${name} without the line must fail the assertion above -- a guard that passes on one copy is what `
      + "lets the two drift apart");
  }
});
