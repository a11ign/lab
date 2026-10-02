// #3021: the chairman's two rules of 2026-10-02 (USE THE PLATFORM FIRST, PREFER DELETING TO ADDING) lived in one
// comment on #928, and a rule in one comment is a rule nobody applies. They go where each session reads its job:
// the seven briefs a seat works from, and the pull request template. `reviewer.md` holds them as a REFUSAL
// CRITERION, so it owes more than the others, and `engineer.md` also carries the one-line background-job rule.
//
// Every obligation is a pattern on the rule's own words, and each is run against a fixture WITHOUT the rule
// first, so a checker that finds nothing to check cannot pass (the emptiness's positive control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), "utf8");
const ROLES = ["ceo", "engineer", "lead-orchestrator", "orchestrator", "product-manager", "tracker-auditor", "reviewer"];
const TEMPLATE = ".github/PULL_REQUEST_TEMPLATE.md";

type Obligations = Array<[string, RegExp]>;

const BRIEF_RULES: Obligations = [
  ["names rule 2", /USE THE PLATFORM FIRST/],
  ["names the platforms to check", /GitHub, pnpm, systemd or git/],
  ["asks for the `platform:` line", /`platform: <what was checked>`/],
  ["says a reimplementation is refused", /reimplements a platform feature is refused/],
  ["names rule 3", /PREFER DELETING TO ADDING/],
  ["says why a growing fix must be explained", /why removing or reusing could not do it/],
  ["says the net line count must go down", /net line count[^.]*must go down/],
];
const REVIEWER_ONLY: Obligations = [
  ["says these are refusal criteria", /REFUSAL CRITERIA/],
  ["asks for the `platform:` line", /Ask every PR for both lines/],
  ["asks for the growth reason", /the reason removing or reusing could not do it/],
];
const ENGINEER_ONLY: Obligations = [
  ["says a turn does not end on a background job it still needs", /does not end on a background job it still needs/],
];
const TEMPLATE_RULES: Obligations = [
  ["has a `platform:` line to fill in", /^platform:/m],
  ["has a net-lines line to fill in", /^Net lines:/m],
];

/** Wrapped prose: a line break (or a blockquote marker) inside a phrase must not read as the phrase being absent. */
const flatten = (text: string) => text.replace(/\n>/g, "\n").replace(/\s+/g, " ");

/** The obligations a text fails, as messages; empty means it carries the rule. */
function missing(text: string, obligations: Obligations): string[] {
  return obligations.filter(([, pattern]) => !pattern.test(text)).map(([why]) => `lacks: ${why}`);
}

const ALL: Obligations = [...BRIEF_RULES, ...REVIEWER_ONLY, ...ENGINEER_ONLY, ...TEMPLATE_RULES];
const FIXTURE_WITHOUT_THE_RULES = "## The Boy Scout rule\n\n> Leave every place better than you found it.\n\n## What changes, and why\n";

test("positive control: a file without the rules is refused, on every obligation", () => {
  assert.equal(missing(flatten(FIXTURE_WITHOUT_THE_RULES), ALL).length, ALL.length);
});

test("positive control: dropping any one obligation from a passage that carries them all is noticed", () => {
  const passage = "USE THE PLATFORM FIRST GitHub, pnpm, systemd or git `platform: <what was checked>` "
    + "reimplements a platform feature is refused PREFER DELETING TO ADDING why removing or reusing could not do it "
    + "net line count is tracked and must go down REFUSAL CRITERIA Ask every PR for both lines "
    + "the reason removing or reusing could not do it does not end on a background job it still needs";
  const obligations = [...BRIEF_RULES, ...REVIEWER_ONLY, ...ENGINEER_ONLY];
  assert.deepEqual(missing(flatten(passage), obligations), []);
  for (const [why, pattern] of obligations) {
    assert.deepEqual(missing(flatten(passage.replace(pattern, "")), obligations), [`lacks: ${why}`]);
  }
});

test("positive control: the template check bites on a template without either line", () => {
  assert.deepEqual(missing("platform: x\nNet lines: 0\n", TEMPLATE_RULES), []);
  assert.deepEqual(missing("Net lines: 0\n", TEMPLATE_RULES), ["lacks: has a `platform:` line to fill in"]);
  assert.deepEqual(missing("platform: x\n", TEMPLATE_RULES), ["lacks: has a net-lines line to fill in"]);
});

for (const role of ROLES) {
  test(`${role}.md carries both rules`, () => {
    assert.deepEqual(missing(flatten(read(`.agent-org/roles/${role}.md`)), BRIEF_RULES), []);
  });
}

test("reviewer.md holds them as a refusal criterion and asks for the platform line and the growth reason", () => {
  assert.deepEqual(missing(flatten(read(".agent-org/roles/reviewer.md")), REVIEWER_ONLY), []);
});

test("engineer.md carries the background-job rule", () => {
  assert.deepEqual(missing(flatten(read(".agent-org/roles/engineer.md")), ENGINEER_ONLY), []);
});

test("the pull request template carries a platform line and a net-lines line", () => {
  assert.deepEqual(missing(read(TEMPLATE), TEMPLATE_RULES), []);
});
