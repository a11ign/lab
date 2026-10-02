// #3021: the chairman's two rules of 2026-10-02 (USE THE PLATFORM FIRST, PREFER DELETING TO ADDING) lived in one
// comment on #928, and a rule in one comment is a rule nobody applies. They go where each session reads its job:
// the seven briefs a seat works from, and the pull request template.
//
// #3049: the same day the chairman ruled that `platform:` is ADVISORY and never retroactive, that a reviewer whose own
// environment fails escalates and posts no review, and that a finding that is not a defect in the diff is a follow-up.
// `reviewer.md` and `engineer.md` therefore no longer say a reimplementation "is refused" (the five other briefs still
// quote it until the follow-up row lands), and the reviewer's obligations are pinned in both directions: the words it
// must carry, and the words it must not.
//
// Every obligation is a pattern on the rule's own words, and each is run against a fixture WITHOUT the rule
// first, so a checker that finds nothing to check cannot pass (the emptiness's positive control). The reviewer's
// are also run against the passages of the text BEFORE #3049 that it replaced (`BEFORE_3049`), which must fail every one of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), "utf8");
const ROLES = ["ceo", "engineer", "lead-orchestrator", "orchestrator", "product-manager", "tracker-auditor", "reviewer"];
const STILL_QUOTING_REFUSAL = ["ceo", "lead-orchestrator", "orchestrator", "product-manager", "tracker-auditor"];
const TEMPLATE = ".github/PULL_REQUEST_TEMPLATE.md";
const REVIEWER = ".agent-org/roles/reviewer.md";
type Obligations = Array<[string, RegExp]>;

const BRIEF_RULES: Obligations = [
  ["names rule 2", /USE THE PLATFORM FIRST/],
  ["names the platforms to check", /GitHub, pnpm, systemd or git/],
  ["asks for the `platform:` line", /`platform: <what was checked>`/],
  ["names rule 3", /PREFER DELETING TO ADDING/],
  ["says why a growing fix must be explained", /why removing or reusing could not do it/],
  ["says the net line count must go down", /net line count[^.]*must go down/],
];
const QUOTES_THE_REFUSAL: Obligations = [
  ["says a reimplementation is refused", /reimplements a platform feature is refused/],
];
const REVIEWER_ONLY: Obligations = [
  ["makes the design question the FIRST check (#3044)", /THE FIRST CHECK, before you run anything[^:]*: should this exist, and is it the simplest way\?/],
  ["says a missing body line alone is not grounds to request changes (#3044)", /missing BODY line is never, alone, a reason to `--request-changes`/],
  ["says `platform:` is advisory and never retroactive (#3049)", /`platform:` is advisory, and never retroactive/],
  ["says the missing line is never a finding on any PR (#3049)", /absence of the reason a diff grows agent-org, is never a finding on any PR/],
  ["judges a reimplementation on the code (#3049)", /reimplements a platform feature[^.]*is judged on the code like any other defect/],
  ["retries the Acceptance once on an environment failure (#3049)", /retry the Acceptance once/],
  ["posts NO review when the environment still fails (#3049)", /If it still does not execute, post NO review/],
  ["hands the row to orchestrator with the label and the first error line (#3049)", /answer:orchestrator[^]*command and its first error line/],
  ["keeps the CI-run form of `convinced` (unchanged by #3049, so BEFORE_3049 passes it)", /convinced \(CI run <id or URL>\)/],
  ["makes a non-defect a `Follow-up:` line under `convinced` (#3049)", /goes in the review as a line of its own under a `convinced` verdict[^]*Follow-up: </],
  ["says product-manager files the follow-up row (#3049)", /`product-manager` files the row from it/],
  ["reserves `not convinced` for a reproducible defect in the diff (#3049)", /`not convinced` is reserved\s+for a defect in the diff that a reader can reproduce/],
];
/** What the reviewer brief must NOT say: each is a phrase the old text carried, and each is checked to match it. */
const REVIEWER_MUST_NOT: Obligations = [
  ["calls the rules REFUSAL CRITERIA", /REFUSAL CRITERIA/],
  ["tells the reviewer to ask every PR for the lines", /Ask every PR for both lines/],
  ["gives `not convinced (environment)` as a verdict line", /by reviewer-<n>: not convinced \(environment\)/],
  ["refuses a reimplementation on the line", /reimplements a platform feature is refused/],
];
const ENGINEER_ONLY: Obligations = [
  ["says a turn does not end on a background job it still needs", /does not end on a background job it still needs/],
  ["says the `platform:` line is a prompt, not a gate (#3049)", /`platform:` line is a prompt, not a gate/],
  ["says its absence is never a finding (#3049)", /optional, and its absence is never a finding/],
];
const TEMPLATE_RULES: Obligations = [
  ["has a `platform:` line to fill in, marked optional (#3049)", /^platform: <!-- optional/m],
  ["has a net-lines line to fill in, marked optional (#3049)", /^Net lines: <!-- optional/m],
];

/** Wrapped prose: a line break (or a blockquote marker) inside a phrase must not read as the phrase being absent. */
const flatten = (text: string) => text.replace(/\n>/g, "\n").replace(/\s+/g, " ");

/**
 * The passages of `reviewer.md` that #3049 replaced, verbatim from commit `cfdc07d9b` (checked against `git show` when
 * written). A fixture and not a `git show`, because "the text before" must stay the same text after this lands, and a
 * spawned git here would be a population census this repo's guards then ask to be classified.
 */
const BEFORE_3049 = flatten([
  "> and record `platform: <what was checked>` in the PR. A PR that reimplements a platform feature is refused in review.",
  "**Without one it is `not convinced (environment)`:**",
  "`**Review of #<n> at `<head8>`, by reviewer-<n>: not convinced (environment) — <what did not run>.**`",
  "**These are REFUSAL CRITERIA, not advice.** Ask every PR for both lines: the `platform:` line naming what was checked, and,",
  "where the diff grows agent-org, the reason removing or reusing could not do it. A PR that reimplements",
  "a platform feature, or grows agent-org with no reason removing or reusing could not do it, is refused on that substance.",
  "**A missing BODY line is never, alone, a reason to `--request-changes`**",
  "**Never push to a PR's branch, never merge, never close, never edit a PR body, never touch labels.**",
].join("\n"));

/** The obligations a text fails, as messages; empty means it carries the rule. */
function missing(text: string, obligations: Obligations): string[] {
  return obligations.filter(([, pattern]) => !pattern.test(text)).map(([why]) => `lacks: ${why}`);
}

/** The forbidden phrases a text still carries, as messages; empty means it is clean. */
function carries(text: string, forbidden: Obligations): string[] {
  return forbidden.filter(([, pattern]) => pattern.test(text)).map(([why]) => `still: ${why}`);
}

const ALL: Obligations = [...BRIEF_RULES, ...QUOTES_THE_REFUSAL, ...REVIEWER_ONLY, ...ENGINEER_ONLY, ...TEMPLATE_RULES];
const FIXTURE_WITHOUT_THE_RULES = "## The Boy Scout rule\n\n> Leave every place better than you found it.\n\n## What changes, and why\n";

test("positive control: a file without the rules is refused, on every obligation", () => {
  assert.equal(missing(flatten(FIXTURE_WITHOUT_THE_RULES), ALL).length, ALL.length);
});

test("positive control: dropping any one obligation from a passage that carries them all is noticed", () => {
  const passage = "USE THE PLATFORM FIRST GitHub, pnpm, systemd or git `platform: <what was checked>` "
    + "PREFER DELETING TO ADDING why removing or reusing could not do it "
    + "net line count is tracked and must go down does not end on a background job it still needs "
    + "THE FIRST CHECK, before you run anything (chairman): should this exist, and is it the simplest way? "
    + "missing BODY line is never, alone, a reason to `--request-changes`";
  const obligations = [...BRIEF_RULES, ...ENGINEER_ONLY.slice(0, 1), ...REVIEWER_ONLY.slice(0, 2)];
  assert.deepEqual(missing(flatten(passage), obligations), []);
  for (const [why, pattern] of obligations) {
    assert.deepEqual(missing(flatten(passage.replace(pattern, "")), obligations), [`lacks: ${why}`]);
  }
});

test("positive control: the template check bites on a template without either line", () => {
  assert.deepEqual(missing("platform: <!-- optional\nNet lines: <!-- optional\n", TEMPLATE_RULES), []);
  assert.deepEqual(missing("Net lines: <!-- optional\n", TEMPLATE_RULES), [`lacks: ${TEMPLATE_RULES[0][0]}`]);
  assert.deepEqual(missing("platform: <!-- optional\n", TEMPLATE_RULES), [`lacks: ${TEMPLATE_RULES[1][0]}`]);
  assert.equal(missing("platform: <!-- what you checked\nNet lines: <!-- agent-org\n", TEMPLATE_RULES).length, TEMPLATE_RULES.length);
});

test("positive control (#3049): the reviewer brief as it stood BEFORE #3049 (`BEFORE_3049`) fails every new obligation and carries every forbidden phrase", () => {
  const NEW_IN_3049 = REVIEWER_ONLY.filter(([why]) => why.includes("#3049") && !why.includes("unchanged"));
  assert.ok(NEW_IN_3049.length > 0, "the control needs the new obligations to exist");
  assert.deepEqual(missing(BEFORE_3049, NEW_IN_3049), NEW_IN_3049.map(([why]) => `lacks: ${why}`));
  assert.deepEqual(carries(BEFORE_3049, REVIEWER_MUST_NOT), REVIEWER_MUST_NOT.map(([why]) => `still: ${why}`));
});

for (const role of ROLES) {
  test(`${role}.md carries both rules`, () => {
    assert.deepEqual(missing(flatten(read(`.agent-org/roles/${role}.md`)), BRIEF_RULES), []);
  });
}

for (const role of STILL_QUOTING_REFUSAL) {
  test(`${role}.md still quotes the refusal until the #3049 follow-up row lands`, () => {
    assert.deepEqual(missing(flatten(read(`.agent-org/roles/${role}.md`)), QUOTES_THE_REFUSAL), []);
  });
}

test("reviewer.md judges the code: advisory platform line, environment escalation, follow-up lines", () => {
  assert.deepEqual(missing(flatten(read(REVIEWER)), REVIEWER_ONLY), []);
});

test("reviewer.md carries none of the refusal wording #3049 retired", () => {
  assert.deepEqual(carries(flatten(read(REVIEWER)), REVIEWER_MUST_NOT), []);
});

test("engineer.md carries the background-job rule and the advisory platform line, and does not refuse", () => {
  const engineer = flatten(read(".agent-org/roles/engineer.md"));
  assert.deepEqual(missing(engineer, ENGINEER_ONLY), []);
  assert.deepEqual(carries(engineer, QUOTES_THE_REFUSAL), []);
});

test("the pull request template marks both lines optional and does not refuse", () => {
  const template = read(TEMPLATE);
  assert.deepEqual(missing(template, TEMPLATE_RULES), []);
  assert.deepEqual(carries(flatten(template), [["refuses", /is refused/]]), []);
});
