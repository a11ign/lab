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

test("#1967: the practices file names the broken gauge AND the instrument that replaces it", () => {
  const text = flat(agentPractices);

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

test("#1967 MUTATION: dropping the instrument and reinstating the endpoint must EACH go red", () => {
  const text = flat(agentPractices);

  // Direction 1 -- the instrument is dropped. The prohibition survives; nobody is told what to read.
  const withoutInstrument = text.replace(THE_INSTRUMENT, "consult the usual place");
  assert.notEqual(withoutInstrument, text, "the instrument mutation must LAND, or this proves nothing");
  assert.doesNotMatch(withoutInstrument, THE_INSTRUMENT,
    "a file that prohibits the endpoint without naming the headers must fail the assertion above");

  // Direction 2 -- the correction is inverted back into the defect. This is the mutation that a guard
  // checking only for the string `gh api rate_limit` would survive: the endpoint is still named, and the
  // sentence now recommends it.
  const reinstated = text.replace(NEVER_THE_ENDPOINT, "always decide from `gh api rate_limit`");
  assert.notEqual(reinstated, text, "the reinstatement mutation must LAND, or this proves nothing");
  assert.doesNotMatch(reinstated, NEVER_THE_ENDPOINT,
    "a file that recommends the endpoint must fail the assertion above -- the endpoint's NAME being "
    + "present is not the property under test, its being DISOWNED is");
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

const CLICK_THROUGH = /an approval prompt a human learns to click through is worse than no prompt/i;
const THE_EMPTY_GUARD = /rm -f "\$\{D:\?\}"\/\*\.md/;
const SHAPE_NOT_EFFECT =
  /when a command is refused for its SHAPE rather than its EFFECT, change the shape/i;
const NOT_AN_OVERRIDE =
  /reaching for an override, or asking a human to approve it again, both leave the next session to rediscover the same refusal/i;

test("#2076: the practices file states the principle AND the command that satisfies it", () => {
  const text = flat(agentPractices);

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
});

test("#2076: the general form is stated, and the override is disowned rather than merely unmentioned", () => {
  const text = flat(agentPractices);

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
});

test("#2076: the population is stated as already-clean, with what would make a call site unsafe", () => {
  const text = flat(agentPractices);

  assert.match(text, /prevention rather than cleanup/i,
    "the row's own claim: nothing tracked has the pattern, so a reader does not go hunting for offenders");
  assert.match(text, /quoting alone defuses the catastrophe/i,
    "and WHICH property each tracked call site already has -- the eight `rm \"$VAR\"` sites are quoted "
    + "with no glob, and a rule that called them offenders would be asking for a change that buys nothing");
  assert.match(text, /the moment a glob joins the variable/i,
    "and the trigger for applying it, so the reader can tell their own next command apart from those eight");
});

test("#2076 MUTATION: losing the remedy and reinstating the override must EACH go red", () => {
  const text = flat(agentPractices);

  // Direction 1 -- the remedy is dropped. The principle survives and the reader has no command.
  const withoutRemedy = text.replace(THE_EMPTY_GUARD, "the usual removal");
  assert.notEqual(withoutRemedy, text, "the remedy mutation must LAND, or this proves nothing");
  assert.doesNotMatch(withoutRemedy, THE_EMPTY_GUARD,
    "a file that states the principle without the command must fail the assertion above");

  // Direction 2 -- the override is reinstated as the answer. This is the mutation a guard that only
  // looked for `:?` would survive: the remedy is still on the page, and the sentence now points past it.
  const overrideReinstated = text.replace(NOT_AN_OVERRIDE,
    "reaching for an override is the quicker fix and is fine here");
  assert.notEqual(overrideReinstated, text, "the override mutation must LAND, or this proves nothing");
  assert.doesNotMatch(overrideReinstated, NOT_AN_OVERRIDE,
    "a file that offers the override must fail the assertion above -- the override being NAMED is not "
    + "the property under test, its being DISOWNED is");

  // Direction 3 -- the rule is narrowed back to `rm`. It still reads correctly about the one command it
  // was born from, and says nothing to the next session meeting a different refused shape.
  const narrowed = text.replace(SHAPE_NOT_EFFECT, "always write `rm` this way");
  assert.notEqual(narrowed, text, "the narrowing mutation must LAND, or this proves nothing");
  assert.doesNotMatch(narrowed, SHAPE_NOT_EFFECT,
    "a file carrying only the `rm` instance must fail the assertion above -- the general form is the "
    + "part the row said was worth keeping");
});
