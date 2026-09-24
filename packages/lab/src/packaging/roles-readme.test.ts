// EVERY ROLE THIS ORGANISATION DEPENDS ON MUST BE READABLE FROM THE REPO ALONE, OR IT DOES NOT SURVIVE
// THIS MACHINE BEING LOST.
//
// `packages/agent-org/docs/roles/README.md` indexes eight role files -- `ceo`, `orchestrator`, `dispatcher`, and five
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
import { execFileSync } from "node:child_process";
// #2076's tree scan spawns `git ls-files`, and every git spawn in this repo strips the environment through
// this one function -- see the file's own header for the 2026-09-06 incident that made it a rule.
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
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
 * the real `packages/agent-org/docs/roles/` tree, because deleting a real agent's file even temporarily is not something a
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
  assert.equal(found[0].filePath, "packages/agent-org/docs/roles/example.md");
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
  new URL("../../../../packages/agent-org/docs/roles/reviewer.md", import.meta.url), "utf8");

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

/**
 * THE TWO #1157 CHECKS, AS FUNCTIONS -- each is called by its own test against the real file and by the
 * mutation test below against the file with the line removed. See #2185 for why the mutation test may not
 * re-test `String.replace` instead.
 */
const assertsThePracticesLine = (text: string) => {
  assert.match(text, POSITIVE_CONTROL,
    "the sentence itself, since this is the only thing standing in for a guard on 64 assertions");
  assert.match(text, /point at it/i,
    "and the operative half: a control you BELIEVE in is not one you can POINT AT, which is the "
    + "difference between this line and an encouragement");
  assert.match(text, /64 derive from a CALL|64 call-derived/i,
    "and the population it covers, so a reader can tell whether their case is one of them");
};

const assertsTheReviewersEntry = (text: string) => {
  assert.match(text, POSITIVE_CONTROL, "the same sentence, in the other place a reader meets it");
  assert.match(text, /\bask where its positive control lives\b/i,
    "an instruction with a verb -- a checklist item that states a property gives the reviewer nothing to do");
  assert.match(text, /point at it, not describe it/i,
    "and names what counts as an answer, or 'ask' is satisfied by any reply");
  assert.match(text, /you are the check/i,
    "and says where the reviewer's judgement is the ONLY instrument, which is the whole reason the line "
    + "exists rather than a rule");
};

test("#1157: the practices file carries the line, with what makes it applicable rather than aspirational", () => {
  assertsThePracticesLine(flat(agentPractices));
});

test("#1157: the reviewer's entry says what a reviewer DOES, not that the property is desirable", () => {
  assertsTheReviewersEntry(flat(reviewerBrief));
});

// --- #1967: the broken gauge, stated where a session loads it rather than in two code comments ---------
//
// `gh api rate_limit` reported a full pool and a reset 49 minutes late during a real GraphQL outage of the
// same token. The knowledge already existed -- in `close-rows-for-merged-pr.mjs:206` and
// `queue-table.mjs:639` -- and TWO SESSIONS STILL BURNED A CYCLE ON IT on 2026-09-22, because a code
// comment is not something anyone reads before typing a command. So it moves to the file every session
// loads, and these tests are what keeps it there.
//
// BOTH DIRECTIONS ARE PINNED, because the two ways this line dies are opposites: the instrument can be
// dropped (nobody is told what to read instead), or the endpoint can be quietly reinstated as the thing to
// consult (the correction is inverted back into the defect). A guard that only checks the prohibition is
// still passing the day someone writes "check `gh api rate_limit` first" underneath it.

const NEVER_THE_ENDPOINT = /never decide anything from `gh api rate_limit`/i;
const THE_INSTRUMENT = /read `X-Ratelimit-\*` off a real call/i;

/** The #1967 checks as functions, for the reason the #1157 ones are: the mutation test runs THEM. */
const assertsTheGaugeAndItsInstrument = (text: string) => {
  assert.match(text, NEVER_THE_ENDPOINT,
    "the prohibition itself -- the endpoint has now been measured lying twice, three weeks apart, and "
    + "until this landed the only record of it was two code comments nobody reads before typing a command");
  assert.match(text, THE_INSTRUMENT,
    "and what to read INSTEAD: a prohibition with no replacement instrument sends the reader back to the "
    + "endpoint, because they still need the number");
  assert.match(text, /gh api graphql[^`]*-i/,
    "with the command that produces it, or 'read the headers' is an instruction the reader cannot follow");
  assert.match(text, /headers come back on the 403/i,
    "and the half that makes it work during the outage it exists to report -- an instrument that fails "
    + "exactly when its subject fails reports the alarming state as no state");
};

test("#1967: the practices file names the broken gauge AND the instrument that replaces it", () => {
  assertsTheGaugeAndItsInstrument(flat(agentPractices));
});

test("#1967: per TOKEN and per RESOURCE, with why a sanity check on core is not one", () => {
  const text = flat(agentPractices);

  assert.match(text, /per TOKEN and per RESOURCE/i,
    "both axes: one token's pools are separate from each other, and separate from another token's");
  assert.match(text, /spend GRAPHQL|spends CORE/,
    "and which commands spend which pool, so 'check the pool you care about' names a pool");
  assert.match(text, /a sanity check on core is not a sanity check/i,
    "THE SHARPEST HALF, and the one the row did not have: on 2026-09-22 the endpoint was accurate on "
    + "core to within one call and wrong by 1360 on graphql -- so the obvious way to test the gauge "
    + "returns that it works");
  assert.match(text, /same token, same second/i,
    "and that the disagreement was read from ONE moment, not two readings minutes apart, which is the "
    + "only reading that rules out the pool simply having moved");
});

/**
 * BOTH MUTATION BLOCKS BELOW RUN THE CHECKS ABOVE against the mutated file and require an `AssertionError`.
 * The first version of each read `text.replace(RE, x)` then `assert.doesNotMatch(mutated, RE)`, which proves
 * that `String.replace` removed what it matched and nothing about whether the assertions would REJECT the
 * result (#2185; the shape #2104's review found in the #2076 block). Each shows the unmutated subject
 * passing FIRST, since `assert.throws` is green on a subject that fails every check.
 */
test("#1967 MUTATION: dropping the instrument and reinstating the endpoint must EACH go red", () => {
  const text = flat(agentPractices);
  assertsTheGaugeAndItsInstrument(text);

  const mutations = [
    // Direction 1 -- the instrument is dropped. The prohibition survives; nobody is told what to read.
    { what: "instrument dropped", pattern: THE_INSTRUMENT, into: "consult the usual place",
      why: "a file that prohibits the endpoint without naming the headers must fail the check" },
    // Direction 2 -- the correction is inverted back into the defect. This is the mutation that a guard
    // checking only for the string `gh api rate_limit` would survive: the endpoint is still named, and the
    // sentence now recommends it.
    { what: "endpoint reinstated", pattern: NEVER_THE_ENDPOINT, into: "always decide from `gh api rate_limit`",
      why: "a file that recommends the endpoint must fail the check -- the endpoint's NAME being present is "
        + "not the property under test, its being DISOWNED is" },
  ];
  for (const { what, pattern, into, why } of mutations) {
    const mutated = text.replace(pattern, into);
    assert.notEqual(mutated, text, `the ${what} mutation must LAND, or this proves nothing`);
    assert.throws(() => assertsTheGaugeAndItsInstrument(mutated), assert.AssertionError,
      `the ${what} file must FAIL the check, and did not -- ${why}`);
  }
});

test("#1157 MUTATION: removing the line from EITHER file must go red, not just from both", () => {
  // The row's clause 3, driven rather than asserted. Two copies with a check that accepts either would
  // let one drift away silently -- and the drift would be invisible precisely because the other copy
  // still reads correctly to anyone who looks in one place.
  const files: readonly [string, string, (text: string) => void][] = [
    ["agent-practices.md", agentPractices, assertsThePracticesLine],
    ["reviewer.md", reviewerBrief, assertsTheReviewersEntry],
  ];
  for (const [, source, check] of files) check(flat(source));

  for (const [name, source, check] of files) {
    const text = flat(source);
    const without = text.replace(POSITIVE_CONTROL, "a removed sentence");
    assert.notEqual(without, text, `the mutation must LAND in ${name}, or this proves nothing`);
    assert.throws(() => check(without), assert.AssertionError,
      `${name} without the line must FAIL its check, and did not -- a guard that passes on one copy is what `
      + "lets the two drift apart");
  }
});

// --- #2076: the empty-guard, written where a session loads it before typing the command -----------------
//
// `rm -f $D/*.md` is safe when `D` was assigned a literal path on the same line, and the permission
// classifier cannot see that. It is one of the few guards `--dangerously-skip-permissions` deliberately
// does NOT disable, so on 2026-09-23 it reached the chairman several times in one morning -- each time a
// command read in order to conclude it was fine. The remedy is `"${D:?}"`, which removes the danger rather
// than the prompt.
//
// PINNED FOR THE SAME REASON #1967 IS, and it is the same failure shape one level up: knowledge that
// exists only in a closed row is knowledge nobody reads before typing. The file's own Assertions section
// says out loud that **this repository loses habits**; a line with no guard on it is the kind it loses.
//
// BOTH DIRECTIONS, because the two ways this rule dies are opposites. It can lose its REMEDY -- the
// principle survives, nobody is told what to type, and the reader is left with the override as the only
// move they know. Or it can be INVERTED -- the override reinstated as the answer, which is the defect the
// rule exists to name, and which a guard checking only for the string `:?` would sail straight past.
//
// #2104's REVIEW FOUND THE FIRST VERSION OF THE MUTATION BLOCK TAUTOLOGICAL, AND IT WAS. It read
// `text.replace(RE, x)` and then `assert.doesNotMatch(mutated, RE)` -- which proves that `String.replace`
// removed what it matched, a property of the standard library, and says nothing about whether the
// assertions above would REJECT the mutated file. Every direction could have been weakened with that block
// still green. So the positive assertions are now FUNCTIONS, the tests call them against the real file, and
// the mutation test calls the same functions against each mutated subject and requires an `AssertionError`.
// The same tautology was in the `#1967` and `#1157` mutation blocks above; #2185 converted them the same way.

const CLICK_THROUGH = /an approval prompt a human learns to click through is worse than no prompt/i;
const THE_EMPTY_GUARD = /rm -f "\$\{D:\?\}"\/\*\.md/;
const SHAPE_NOT_EFFECT =
  /when a command is refused for its SHAPE rather than its EFFECT, change the shape/i;
const NOT_AN_OVERRIDE =
  /reaching for an override, or asking a human to approve it again, both leave the next session to rediscover the same refusal/i;
const QUOTING_IS_HALF = /quoting alone defuses the BARE-VARIABLE case, and buys nothing once a glob is attached/i;
const GREP_UNDERCOUNTS = /puts a `--` where the regex expects the target/i;

/**
 * THE THREE POSITIVE CHECKS, AS FUNCTIONS RATHER THAN TEST BODIES. A mutation test can only prove a guard
 * bites by running THE GUARD against the mutated subject; anything else re-tests the mutation itself. Each
 * is called twice -- once by its own test against the real file, and once per mutation below.
 */
const assertsThePrincipleAndItsRemedy = (text: string) => {
  assert.match(text, CLICK_THROUGH,
    "the principle itself -- without it `:?` reads as a style preference, and a style preference is not "
    + "what stops the next avoidable prompt being filed");
  assert.match(text, THE_EMPTY_GUARD,
    "and the literal remedy, quoted and brace-guarded: a rule whose fix the reader has to reconstruct "
    + "sends them back to the override, because they still have a command to run");
  assert.match(text, /abort on an unset or empty variable/i,
    "and WHY `:?` works, or it is a charm to be copied rather than a construct to be applied to the next "
    + "command, which will not be this one");
  assert.match(text, /dangerously-skip-permissions/,
    "and the fact that makes it unavoidable: bypass is already on and this guard survives it, so "
    + "'turn the prompts off' is not an available answer and the reader should not go looking for it");
};

const assertsTheGeneralForm = (text: string) => {
  assert.match(text, SHAPE_NOT_EFFECT,
    "THE TRANSFERABLE HALF -- `rm` is one instance, and a rule that names only the instance leaves the "
    + "next refused shape to be solved by an override again");
  assert.match(text, NOT_AN_OVERRIDE,
    "and what is wrong with the two easier moves, stated: a rule that recommends the fix without "
    + "disowning the alternatives reads as advice between equals");
  assert.match(text, /several times in one morning/i,
    "with the measurement, so the cost is a count rather than an intuition about tidiness");
  assert.match(text, /makes the unavoidable ones cheaper to ignore/i,
    "and the consequence that makes this a safety rule rather than a courtesy -- the harm lands on the "
    + "NEXT prompt, which is the one that will be real");
};

const assertsThePopulationReading = (text: string) => {
  assert.match(text, /prevention rather than cleanup/i,
    "the row's own claim: nothing tracked has the pattern, so a reader does not go hunting for offenders");
  assert.match(text, QUOTING_IS_HALF,
    "and WHICH property each tracked call site already has, stated precisely: the nine `rm \"$VAR\"` sites "
    + "are quoted with no glob, and quoting is what saves THEM -- it saves nothing once a glob is attached, "
    + "which is the distinction that makes `:?` load-bearing rather than tidy");
  assert.match(text, /the moment a glob joins the variable/i,
    "and the trigger for applying it, so the reader can tell their own next command apart from those nine");
  assert.match(text, GREP_UNDERCOUNTS,
    "and why the grep undercounts -- a population read with the wrong instrument is the defect one level "
    + "up from the one this rule is about, and the reader needs to know which reading to trust");
};

test("#2076: the practices file states the principle AND the command that satisfies it", () => {
  assertsThePrincipleAndItsRemedy(flat(agentPractices));
});

test("#2076: the general form is stated, and the override is disowned rather than merely unmentioned", () => {
  assertsTheGeneralForm(flat(agentPractices));
});

test("#2076: the population is stated as already-clean, with what would make a call site unsafe", () => {
  assertsThePopulationReading(flat(agentPractices));
});

/** One mutation: a sentence removed or inverted, and the check that must reject the result. */
const MUTATIONS: readonly { what: string; pattern: RegExp; into: string; rejects: (text: string) => void; why: string }[] = [
  {
    what: "remedy dropped", pattern: THE_EMPTY_GUARD, into: "the usual removal",
    rejects: assertsThePrincipleAndItsRemedy,
    why: "the principle survives and the reader has no command, so the override is the only move they know",
  },
  {
    what: "principle dropped", pattern: CLICK_THROUGH, into: "avoidable prompts are untidy",
    rejects: assertsThePrincipleAndItsRemedy,
    why: "the command survives as a style note, and a style note does not stop the next prompt being filed",
  },
  {
    what: "override reinstated", pattern: NOT_AN_OVERRIDE,
    into: "reaching for an override is the quicker fix and is fine here",
    rejects: assertsTheGeneralForm,
    why: "THE MUTATION A `:?`-ONLY GUARD SURVIVES -- the remedy is still on the page and the sentence now "
      + "points past it. The override being NAMED is not the property under test; its being DISOWNED is",
  },
  {
    what: "general form narrowed", pattern: SHAPE_NOT_EFFECT, into: "always write `rm` this way",
    rejects: assertsTheGeneralForm,
    why: "it still reads correctly about the one command it was born from, and says nothing to the next "
      + "session meeting a different refused shape",
  },
  {
    what: "instrument correction dropped", pattern: GREP_UNDERCOUNTS,
    into: "is what the grep reads",
    rejects: assertsThePopulationReading,
    why: "the numbers are corrected and the reason is gone, so the next session re-derives the population "
      + "with the same regex, gets 8 and 11 again, and concludes the rule is stale rather than the grep",
  },
  {
    what: "population reading dropped", pattern: QUOTING_IS_HALF,
    into: "those nine are offenders too",
    rejects: assertsThePopulationReading,
    why: "a rule that calls nine already-safe call sites offenders asks for a change that buys nothing, "
      + "and the next session learns to ignore it -- the same defect one level up",
  },
];

test("#2076 MUTATION: each direction must make the assertions THEMSELVES throw, not merely stop matching", () => {
  const text = flat(agentPractices);

  // THE RESTORED CONTROL, RUN FIRST. Five `assert.throws` in a row is a green test on a file that fails
  // every check, so the unmutated subject has to be shown passing all three before any throw means
  // anything. This is the half the first version of this block was missing.
  for (const check of [assertsThePrincipleAndItsRemedy, assertsTheGeneralForm, assertsThePopulationReading]) {
    check(text);
  }

  for (const { what, pattern, into, rejects, why } of MUTATIONS) {
    const mutated = text.replace(pattern, into);
    assert.notEqual(mutated, text, `the ${what} mutation must LAND, or this proves nothing`);
    assert.throws(() => rejects(mutated), assert.AssertionError,
      `the practices file with the ${what} must FAIL the check above, and did not -- ${why}`);
  }
});

/**
 * THE POPULATION HALF, WHICH IS AN EMPTINESS AND THEREFORE NEEDS A POSITIVE CONTROL -- #2104's review
 * found the first version had none, and it was right: the row's claim was `git grep … # empty`, quoted from
 * a past commit, with nothing anywhere in the tree that the pattern was shown to MATCH. An emptiness whose
 * detector has never fired is indistinguishable from a detector that cannot fire.
 *
 * So the detector lives here, is exercised against both halves of a fixture table below, and the emptiness
 * is COMPUTED at run time rather than quoted. Written as a classifier over the ARGUMENTS rather than a
 * regex over the line, because that is what the grep got wrong: `rm -f -- "$path"` in
 * `packages/control/ansible/lab-reset.yml` puts a `--` where a line-anchored pattern expects the target, so
 * the row's reading of "8 files / 11 lines" was two lines and one file short of the real 9 / 13.
 */
const UNGUARDED_EXPANSION = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
const GUARDED_EXPANSION = /\$\{[A-Za-z_][A-Za-z0-9_]*:[?+-]/;

/** The `rm` targets on a line: everything after the first `rm`, up to a separator, minus the flags. */
const rmTargets = (line: string): string[] => {
  const invocation = /\brm\s+([^;&|)]*)/.exec(line);
  if (invocation === null) return [];
  return invocation[1].split(/\s+/).filter((word) => word.length > 0 && !word.startsWith("-"));
};

/**
 * The shape the rule is about. Only `*` counts as the glob: `?` is a glob too, but `:?` is the remedy's own
 * spelling, and a detector that read the remedy as an offender would be the #804 shape -- a guard charging
 * a document for quoting the pattern it warns about.
 */
const globbedThroughAnUnguardedVariable = (line: string): boolean =>
  rmTargets(line).some((target) =>
    target.includes("*") && UNGUARDED_EXPANSION.test(target) && !GUARDED_EXPANSION.test(target));

/** The wider, already-clean population: an `rm` whose target expands a variable at all. */
const removesThroughAVariable = (line: string): boolean =>
  rmTargets(line).some((target) => target.includes("$"));

test("#2076 CONTROL: the detector fires on the dangerous shape and declines the remedy", () => {
  const dangerous = [
    'rm -f $D/*.md',
    'rm -rf $dir/*',
    'D=/tmp/x/comments && rm -f $D/*.md',
    // QUOTING DOES NOT SAVE THIS ONE, and it is the reason the rule's own sentence had to be narrowed: the
    // glob sits outside the quotes, so an empty `D` still expands the word to `/*.md`.
    'rm -f "$D"/*.md',
    'rm -f "${D}"/*.md',
  ];
  for (const line of dangerous) {
    assert.equal(globbedThroughAnUnguardedVariable(line), true,
      `${line} is the shape this rule exists to prevent and the detector missed it -- an emptiness read `
      + "with this detector would then be empty for the wrong reason");
  }

  const safe = [
    'rm -f "${D:?}"/*.md',        // the remedy the rule names
    'rm -f "${D:-/tmp/fallback}"/*.md',
    'rm -rf "$STAGE"',            // a bare variable, quoted, no glob: eight of the nine call sites
    'rm -f -- "$path"',           // the ninth, and the one the grep could not see
    'rm -f /tmp/fixed/*.md',      // a glob with no variable
    'rm -rf node_modules/${name}', // printed advice in a JS template literal, not a shell call site
  ];
  for (const line of safe) {
    assert.equal(globbedThroughAnUnguardedVariable(line), false,
      `${line} is not the shape, and a detector that charges it would make this rule ask for changes that `
      + "buy nothing -- which is the failure the rule itself names");
  }
});

/**
 * The nine call sites, PINNED BY NAME rather than by count, because the count is what rots: an unrelated
 * change to `fetch-windows-iso.sh` moves it, and a guard that demands a document be re-numbered for
 * somebody else's refactor is noise. What is asserted is the PROPERTY -- every one of them removes through
 * a variable (so the population is real, not a list of files that happen to exist) and not one of them is
 * dangerous.
 */
const CALL_SITES = [
  "packages/control/ansible/lab-reset.yml",
  "packages/judge/src/codex-backend.test.ts",
  "packages/worker-fleet/src/lab-job-lock-two-rows.test.ts",
  "packages/worker-fleet/src/local-worker/build-vm.sh",
  "packages/worker-fleet/src/local-worker/create-utm-vm.sh",
  "packages/worker-fleet/src/local-worker/fetch-windows-iso.sh",
  "packages/worker-fleet/src/provisioning/bare-metal/serve-bootstrap.sh",
  "scripts/git-hooks/pre-commit",
  "scripts/git-hooks/pre-push",
] as const;

/** 13 `rm`-through-a-variable lines across the nine at `67f30071f`, and 16 shell-executed tracked files. */
const MEASURED_CALL_SITE_LINES = 13;
const SHELL_FILE_FLOOR = 10;

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const lines = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8").split("\n");

test("#2076: the nine tracked call sites are a real, non-empty population and none of them is the shape", () => {
  let found = 0;
  for (const path of CALL_SITES) {
    const throughAVariable = lines(path).filter(removesThroughAVariable);
    assert.ok(throughAVariable.length > 0,
      `${path} is pinned as an \`rm\`-through-a-variable call site and no longer has one -- either the `
      + "line moved, in which case update this list and the count in the rule, or the detector is broken");
    found += throughAVariable.length;
    for (const line of throughAVariable) {
      assert.equal(globbedThroughAnUnguardedVariable(line), false,
        `${path} now attaches a glob to a variable: ${line.trim()} -- this is the shape `
        + '`.claude/rules/agent-practices.md` says to write as `"${VAR:?}"/*`');
    }
  }
  // A FLOOR, NOT A PIN -- 13 at `67f30071f`, and a tenth legitimate call site raises it. The floor exists
  // only to catch the other failure: `removesThroughAVariable` breaking and finding nothing, which would
  // make every assertion in the loop above pass having examined no lines.
  assert.ok(found >= MEASURED_CALL_SITE_LINES,
    `only ${found} \`rm\`-through-a-variable lines across the nine pinned files, fewer than the 13 measured `
    + "at `67f30071f` -- the detector is more likely broken than the population shrinking");
});

/**
 * THE STANDING HALF: the rule's claim computed against the tree rather than quoted from a grep.
 *
 * SCOPED TO FILES A SHELL EXECUTES, and the bound is deliberate. Markdown and TS/MJS are excluded because
 * in those files the shape appears as PROSE -- `.claude/rules/agent-practices.md` quotes it to warn about
 * it, and so does the comment at the top of this block. A scan that charged them would be #804's defect
 * exactly: a guard flagging a note ABOUT the pattern. The cost of the bound is that shell embedded in a
 * template literal or an Ansible `shell:` block is not scanned here, which is why the two `.test.ts` sites
 * and the one `.yml` site are pinned by name in the test above instead.
 */
const shellExecutedFiles = () =>
  execFileSync("git", ["-C", REPO_ROOT, "ls-files"],
    // `sandboxGitEnv()` is CALLED, not merely imported: git exports GIT_DIR into every hook environment,
    // and this file's tests run under `pre-push`, so an inherited env would walk whatever repository the
    // hook was invoked from rather than this one.
    { encoding: "utf8", env: sandboxGitEnv() })
    .split("\n")
    .filter((path) => path.endsWith(".sh") || path.startsWith("scripts/git-hooks/"));

test("#2076: no tracked file a shell executes runs `rm` on a glob beneath an unguarded variable", () => {
  const files = shellExecutedFiles();
  assert.ok(files.length >= SHELL_FILE_FLOOR,
    `only ${files.length} shell-executed tracked files found, against 16 at \`67f30071f\` -- the `
    + "`ls-files` walk is broken, and an emptiness over nothing is not a reading");
  assert.ok(files.includes("packages/worker-fleet/src/local-worker/fetch-windows-iso.sh"),
    "the walk must reach the file with the most `rm`-through-a-variable lines in the tree, or its scope "
    + "is not what this test claims");

  const offenders = files.flatMap((path) =>
    lines(path).filter(globbedThroughAnUnguardedVariable).map((line) => `${path}: ${line.trim()}`));
  assert.deepEqual(offenders, [],
    "a shell script now attaches a glob to an unguarded variable. The positive control for this emptiness "
    + "is the CONTROL test above, which fires the same detector on five dangerous forms; the non-empty "
    + `complement is the nine pinned call sites. Write \`"\${VAR:?}"/*\`:\n${offenders.join("\n")}`);
});

// --- #2025: which account this session is spending, stated where the rate-limit rule is read -----------
//
// The paragraph above teaches a reader to read the headers of "the pool you are about to spend", and until
// this landed it ended by telling them the host "has exactly one `gh` identity configured -- so there is
// nothing here to switch to". That was true of `~/.config/gh` and false of the host. There are two
// configurations, two tokens and two accounts, and `/home/agent/.local/bin/gh` ALREADY SWITCHES between
// them by `HERDR_WORKSPACE_ID` -- which is the same routing `host-units.mjs` and three unit files already
// describe, contradicted in the one file every session loads.
//
// WHAT IS PINNED IS THE REFUSAL, NEVER THE COUNT, and the distinction is this row's whole point. An
// assertion on "exactly one" -- or on the number two -- goes stale the day a third configuration appears,
// and is then a green test asserting a false fact, which is precisely the defect being repaired. So
// nothing below counts configurations. What must survive a mutation is *do not switch to the other config
// to get past your own limit*, and a guard that merely finds the string `GH_CONFIG_DIR` survives the
// inversion of it with nothing to say. The row's Open-check grep is a filing instrument for one moment,
// deliberately not reproduced here for the same reason.
//
// WRITTEN AS FUNCTIONS, per #2104's finding on the block above: a mutation proves a guard bites only by
// running THE GUARD against the mutated subject.

const DEFAULT_CONFIG_IS_A_PERSON =
  /the default `~\/\.config\/gh` authenticates as a person \(`DanBeckDev`\)/i;
const WORKERS_CONFIG_IS_THE_BOT =
  /`GH_CONFIG_DIR=\/home\/agent\/workers\/gh` as `a11ign-ai-workers`/;
const WHICH_UNIT_SETS_IT = /which is what `a11ign-work-tick\.service` sets/i;
const THE_REFUSAL = /you must not switch to the other config to get past your own limit/i;
const ATTRIBUTION_IS_THE_GROUND =
  /one export changes who every subsequent write is attributed to/i;
const THE_ROUTING_WRAPPER = /is a ROUTING WRAPPER sitting ahead of `\/usr\/bin\/gh`/;
const NAME_THE_ACCOUNT_FIRST = /run `gh api user --jq \.login` first, then the headers/i;

const assertsBothAccountsAreNamed = (text: string) => {
  assert.match(text, DEFAULT_CONFIG_IS_A_PERSON,
    "which account the DEFAULT config authenticates as -- a reader who is told only that a second one "
    + "exists cannot tell whether the pool they just read belongs to a person or to the bot");
  assert.match(text, WORKERS_CONFIG_IS_THE_BOT,
    "and the other, by the export that selects it, so the sentence names a thing the reader can type "
    + "rather than an arrangement they have to go and discover");
  assert.match(text, WHICH_UNIT_SETS_IT,
    "and something on this host that already sets it -- the claim is that the switch is REAL and in use, "
    + "and an unattributed claim is the one the old sentence made in the other direction");
};

const assertsTheRefusal = (text: string) => {
  assert.match(text, THE_REFUSAL,
    "THE SENTENCE THIS ROW EXISTS FOR. The old wording declined the switch because there was supposedly "
    + "nothing to switch to; correcting the fact without carrying the refusal would leave a reader with "
    + "an exhausted pool, a healthy neighbour named for them, and no instruction");
  assert.match(text, ATTRIBUTION_IS_THE_GROUND,
    "and the reason, which is what makes it hold at 3am against a deadline: the cost is not the quota, "
    + "it is that every subsequent write is attributed to somebody else");
  assert.match(text, /that disposition is `ceo`'s \(`lane:ceo`, #916\) rather than yours/i,
    "and WHOSE decision it is, so the refusal points somewhere instead of merely forbidding -- this file "
    + "must not settle by wording whether a blocked session may ever spend the other account's quota");
  assert.match(text, /wait out your own reset/i,
    "and what to do instead, because a prohibition whose alternative is unstated is one a stuck reader "
    + "reads as advice");
};

const assertsTheRoutingIsNotChosen = (text: string) => {
  assert.match(text, THE_ROUTING_WRAPPER,
    "that a bare `gh` is ROUTED -- without this the paragraph's own instruction, read the pool you are "
    + "about to spend, is unfollowable, because the reader believes the account is whatever their config "
    + "says and it is decided by their PATH");
  assert.match(text, /`HERDR_WORKSPACE_ID` is listed in `\/home\/agent\/workers\/workspaces\.txt`/,
    "and what the routing keys on, which is also why a systemd unit -- having no workspace id -- has to "
    + "declare its identity rather than inherit one");
  assert.match(text, NAME_THE_ACCOUNT_FIRST,
    "and the command that answers it BEFORE the headers are read, or the reader has a fact they cannot "
    + "act on");
  assert.match(text, /decided by your PATH and your workspace id, not by what you typed/i,
    "and the consequence stated plainly, since the same command name spelling two accounts is the part "
    + "that reads as impossible until it is written down");
};

test("#2025: the practices file names both accounts and what already sets the second", () => {
  assertsBothAccountsAreNamed(flat(agentPractices));
});

test("#2025: the refusal is carried, with its ground and whose decision it is", () => {
  assertsTheRefusal(flat(agentPractices));
});

test("#2025: a bare `gh` is routed, and the reader is told to name the account before reading its pool", () => {
  assertsTheRoutingIsNotChosen(flat(agentPractices));
});

const IDENTITY_MUTATIONS: readonly {
  what: string; pattern: RegExp; into: string; rejects: (text: string) => void; why: string;
}[] = [
  {
    what: "refusal inverted", pattern: THE_REFUSAL,
    into: "switch to the other config when your own limit is reached",
    rejects: assertsTheRefusal,
    why: "THE MUTATION A `GH_CONFIG_DIR`-GREP SURVIVES -- both accounts are still named, the export is "
      + "still on the page, and the sentence now recommends the thing it exists to refuse. The switch "
      + "being DESCRIBED is not the property under test; its being REFUSED is",
  },
  {
    what: "ground for the refusal dropped", pattern: ATTRIBUTION_IS_THE_GROUND,
    into: "it is a different directory",
    rejects: assertsTheRefusal,
    why: "the prohibition survives with no reason behind it, and a reader who is blocked, on a deadline "
      + "and holding a working alternative overrides an unexplained rule -- which is how the old sentence "
      + "failed, refusing on a ground that turned out to be false",
  },
  {
    what: "the defect re-shipped", pattern: WHICH_UNIT_SETS_IT,
    into: "so there is nothing here to switch to",
    rejects: assertsBothAccountsAreNamed,
    why: "the exact sentence this row removed, restored beside a correction -- the file would then state "
      + "the second config and deny it in the same breath, and a guard reading only the refusal would "
      + "still be green",
  },
  {
    what: "routing dropped", pattern: THE_ROUTING_WRAPPER,
    into: "reads a single config",
    rejects: assertsTheRoutingIsNotChosen,
    why: "the two accounts survive as an arrangement the reader must opt into, so they conclude their own "
      + "`gh` is the default one -- which on this host it is not, in three of the workspaces listed",
  },
  {
    what: "instrument for the account dropped", pattern: NAME_THE_ACCOUNT_FIRST,
    into: "read the headers",
    rejects: assertsTheRoutingIsNotChosen,
    why: "the reader is told the account is not what they think and given nothing to run, which is the "
      + "same shape as prohibiting the endpoint without naming the headers, one field over",
  },
];

test("#2025 MUTATION: each direction must make the assertions THEMSELVES throw, not merely stop matching", () => {
  const text = flat(agentPractices);

  // THE CONTROL, RUN FIRST -- five `assert.throws` in a row is a green test on a file that fails every
  // check, so the unmutated subject is shown passing all three before any throw below means anything.
  for (const check of [assertsBothAccountsAreNamed, assertsTheRefusal, assertsTheRoutingIsNotChosen]) {
    check(text);
  }

  for (const { what, pattern, into, rejects, why } of IDENTITY_MUTATIONS) {
    const mutated = text.replace(pattern, into);
    assert.notEqual(mutated, text, `the ${what} mutation must LAND, or this proves nothing`);
    assert.throws(() => rejects(mutated), assert.AssertionError,
      `the practices file with the ${what} must FAIL the check above, and did not -- ${why}`);
  }
});

// --- #2093: two surfaces carry the review requirement, and which instrument reads which ----------------
//
// `ceo` added a `pull_request` rule to the `merge-queue-main` ruleset on 2026-09-23 at ~09:04Z (#2086),
// and #2090 shipped the guard that reads it. The "`main` REQUIRES an approving review" section above
// predates both: it named `bypass_pull_request_allowances` as THE exemption instrument and ended by
// teaching `CANNOT_TELL` for everything a non-admin token can see. Nothing in it was false -- classic
// protection still carries the requirement and its exemption list is still admin-only -- but a session
// following it reported ignorance where a true, bounded reading had become available.
//
// WHAT IS PINNED IS THE BOUND ON THE CHEAP READING, NEVER THE FIELD NAME, and that is this block's whole
// point. `current_user_can_bypass` is a string a grep finds in the sentence that states the limitation AND
// in the sentence that inverts it, so a guard looking for it is green on both. What must survive a
// mutation is *`never` answers for me alone and does not mean nobody is exempt* -- flip that to its
// opposite and every assertion below must throw. The row's Open-check grep counted the field name for one
// moment, as a filing instrument; it is deliberately not reproduced here.
//
// THE OVERCLAIM IS THE FAILURE MODE, NOT THE OMISSION. A rewrite that lets `never` read as "nobody is
// exempt" is strictly worse than the over-strict sentence it replaces, because it is quotable: `ceo`'s
// ruling on #2086 is binding on the wording -- "a CI check that certifies less than it appears to is the
// failure #2022 exists to prevent; it does not become acceptable by being cheap".
//
// WRITTEN AS FUNCTIONS, per #2104's finding two blocks up: a mutation proves a guard bites only by running
// THE GUARD against the mutated subject.

const TWO_SURFACES =
  /TWO SURFACES CARRY THE REQUIREMENT, and a reading of one is not a reading of the other/i;
const EXEMPTIONS_DO_NOT_COMPOSE = /requirements compose and exemptions do not/i;
const CLASSIC_CAN_BE_ENUMERATED =
  /the only surface whose exemption list can be ENUMERATED rather than merely queried for one identity/i;
const PICK_YOUR_INSTRUMENT = /PICK THE INSTRUMENT BY WHAT YOU HOLD, AND SAY WHICH ONE YOU USED/i;
const THE_ADMIN_INSTRUMENT = /`branches\/main\/protection`, behind `A11Y_CHECK_BRANCH_PROTECTION=1`/;
const THE_CHEAP_INSTRUMENT =
  /`rules\/branches\/main` plus `rulesets\/\{id\}`, behind `A11Y_CHECK_MAIN_RULESET=1`/;
const THE_BOUNDED_CLAIM =
  /`current_user_can_bypass: "never"` answers FOR ME ALONE and does not mean nobody is exempt/i;
const ABSENCE_IS_NOT_EMPTINESS =
  /its absence means "you may not look", never "the list is empty"/i;
const CANNOT_TELL_STANDS = /`CANNOT_TELL` stands unchanged as the verdict for/i;
const NOT_ACCEPTABLE_BY_BEING_CHEAP = /does not become acceptable by being cheap/i;

const assertsBothSurfacesAreNamed = (text: string) => {
  assert.match(text, TWO_SURFACES,
    "that there are TWO of them -- the shipped section knew one, and a session reading it goes to the "
    + "admin-only endpoint, gets a 404 and stops, never learning the other object exists");
  assert.match(text, /`merge-queue-main` ruleset \(id `23681721`\)/,
    "and WHICH ruleset carries the second, by id, because `rulesets/{id}` is the call the reader has to "
    + "make and the id is not derivable from anything else on the page");
  assert.match(text, EXEMPTIONS_DO_NOT_COMPOSE,
    "and `ceo`'s reason for ADD rather than SWAP -- without it a reader meets two surfaces and assumes a "
    + "second place to be exempt, which is the assumption the ruling was granted against");
  assert.match(text, CLASSIC_CAN_BE_ENUMERATED,
    "and why the admin-only surface stays authoritative rather than being superseded by the cheaper one: "
    + "enumeration is a property only it has, and it is the property the whole requirement rests on");
};

const assertsTheInstrumentIsChosenByWhatYouHold = (text: string) => {
  assert.match(text, PICK_YOUR_INSTRUMENT,
    "that the choice is the reader's and has to be DECLARED -- two instruments answering different "
    + "questions are quoted as one the moment a verdict does not say which produced it");
  assert.match(text, THE_ADMIN_INSTRUMENT,
    "the admin instrument, with the switch that runs it, or 'use the complete one' names nothing typeable");
  assert.match(text, THE_CHEAP_INSTRUMENT,
    "and the one every session and every CI job here can actually run -- this is the whole of what #2086 "
    + "bought, and a rules file that omits it leaves the reader at `CANNOT_TELL` by default again");
};

const assertsTheReadingIsBounded = (text: string) => {
  assert.match(text, THE_BOUNDED_CLAIM,
    "THE SENTENCE THIS ROW EXISTS FOR. `never` is a per-identity answer; read as a universal it converts "
    + "the cheap instrument into a certificate that nobody can bypass `main`, which no token here can "
    + "issue -- and a quotable overclaim is worse than the over-strict sentence it replaced");
  assert.match(text, ABSENCE_IS_NOT_EMPTINESS,
    "and the same error one field over: `bypass_actors` is withheld rather than empty on a token without "
    + "write access to the ruleset, so a reader who treats a missing list as an empty one reaches the "
    + "universal claim by a second route");
  assert.match(text, CANNOT_TELL_STANDS,
    "and that the old verdict SURVIVES for the question it always answered -- the amendment narrows what "
    + "`CANNOT_TELL` covers and must not read as retiring it, which is the other way this section dies");
  assert.match(text, NOT_ACCEPTABLE_BY_BEING_CHEAP,
    "with `ceo`'s ruling on the wording, because cheapness is the argument that will be made for the "
    + "overclaim and the answer to it has to be on the page rather than in a closed row");
};

test("#2093: the practices file names both surfaces and why the admin-only one stays authoritative", () => {
  assertsBothSurfacesAreNamed(flat(agentPractices));
});

test("#2093: the instrument is chosen by what the reader holds, and must be declared", () => {
  assertsTheInstrumentIsChosenByWhatYouHold(flat(agentPractices));
});

test("#2093: the cheap reading is bounded to the asking identity, and `CANNOT_TELL` survives", () => {
  assertsTheReadingIsBounded(flat(agentPractices));
});

const REVIEW_SURFACE_MUTATIONS: readonly {
  what: string; pattern: RegExp; into: string; rejects: (text: string) => void; why: string;
}[] = [
  {
    what: "bounded claim inverted", pattern: THE_BOUNDED_CLAIM,
    into: '`current_user_can_bypass: "never"` means nobody is exempt',
    rejects: assertsTheReadingIsBounded,
    why: "THE MUTATION A `current_user_can_bypass`-GREP SURVIVES -- the field is still named, the cheap "
      + "instrument is still on the page, and the sentence now issues the certificate #2022 exists to "
      + "prevent. The field being MENTIONED is not the property under test; the reading being BOUNDED is",
  },
  {
    what: "withheld read as empty", pattern: ABSENCE_IS_NOT_EMPTINESS,
    into: "an absent list is an empty one",
    rejects: assertsTheReadingIsBounded,
    why: "the bound on `current_user_can_bypass` survives and the reader reaches the same universal claim "
      + "through `bypass_actors` instead -- a permission-dependent absence read as a measurement",
  },
  {
    what: "CANNOT_TELL retired", pattern: CANNOT_TELL_STANDS,
    into: "the cheap read replaces the verdict for",
    rejects: assertsTheReadingIsBounded,
    why: "the opposite failure to the overclaim and the easier one to ship by accident: the amendment "
      + "narrows what `CANNOT_TELL` covers, and a reader told it is superseded stops reporting the one "
      + "question neither surface answers without admin",
  },
  {
    what: "second surface dropped", pattern: TWO_SURFACES,
    into: "the requirement lives in classic protection",
    rejects: assertsBothSurfacesAreNamed,
    why: "the shipped defect restored -- every assertion about the cheap instrument could still be on the "
      + "page while the reader is told there is one object to read, and they will read the one that 404s",
  },
  {
    what: "ADD read as SWAP", pattern: EXEMPTIONS_DO_NOT_COMPOSE,
    into: "the newer surface supersedes the older",
    rejects: assertsBothSurfacesAreNamed,
    why: "`ceo`'s ruling inverted: a reader who believes the ruleset replaced classic protection concludes "
      + "the enumerable surface is gone and that `never` is now the best available answer, which is the "
      + "overclaim arrived at by a third route",
  },
  {
    what: "cheap instrument dropped", pattern: THE_CHEAP_INSTRUMENT,
    into: "the endpoints you can reach",
    rejects: assertsTheInstrumentIsChosenByWhatYouHold,
    why: "the bound survives with nothing bounded -- the reader is told what the cheap reading does not "
      + "mean and never told how to take it, so they are back at `CANNOT_TELL` for everything, which is "
      + "the state this row exists to leave",
  },
];

test("#2093 MUTATION: each direction must make the assertions THEMSELVES throw, not merely stop matching", () => {
  const text = flat(agentPractices);

  // THE CONTROL, RUN FIRST -- six `assert.throws` in a row is a green test on a file that fails every
  // check, so the unmutated subject is shown passing all three before any throw below means anything.
  for (const check of [assertsBothSurfacesAreNamed, assertsTheInstrumentIsChosenByWhatYouHold,
    assertsTheReadingIsBounded]) {
    check(text);
  }

  for (const { what, pattern, into, rejects, why } of REVIEW_SURFACE_MUTATIONS) {
    const mutated = text.replace(pattern, into);
    assert.notEqual(mutated, text, `the ${what} mutation must LAND, or this proves nothing`);
    assert.throws(() => rejects(mutated), assert.AssertionError,
      `the practices file with the ${what} must FAIL the check above, and did not -- ${why}`);
  }
});

/**
 * THE ROW'S OWN REJECTED ALTERNATIVE, PINNED AS A CONTROL: "a guard that merely finds the string
 * `current_user_can_bypass` survives that flip and must not be accepted as one". That is an assertion
 * about a guard this file does not contain, so it is demonstrated rather than trusted -- the weaker guard
 * is written out here, run against the inverted file, and shown GREEN in the same breath as the real one
 * is shown red above.
 */
test("#2093 CONTROL: a field-name guard is green on the inverted file, which is why this block is not one", () => {
  const FIELD_NAME_ONLY = /current_user_can_bypass/;
  const inverted = flat(agentPractices)
    .replace(THE_BOUNDED_CLAIM, '`current_user_can_bypass: "never"` means nobody is exempt');

  assert.match(flat(agentPractices), FIELD_NAME_ONLY, "the weaker guard passes on the real file");
  assert.match(inverted, FIELD_NAME_ONLY,
    "and on the inverted one -- a file that now states the overclaim still contains the field name, so "
    + "the cheaper guard cannot tell the two apart and would have shipped green");
  assert.throws(() => assertsTheReadingIsBounded(inverted), assert.AssertionError,
    "while the guard this block actually installs rejects it -- the pair is the evidence that what is "
    + "pinned is the bounded CLAIM and not the field NAME");
});
