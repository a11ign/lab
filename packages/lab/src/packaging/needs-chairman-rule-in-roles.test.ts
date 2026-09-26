// #2637: `ceo` ruled on 2026-09-26 (#2623) what `needs:chairman` is for, and the rule lived in one comment and
// in the label's description while the two roles that apply the label -- `ceo` and `product-manager` -- never
// mentioned it. It survived only in whatever a session happened to remember.
//
// `ceo.md` carries the wording in full and `product-manager.md` points at it (done-when 2), so the two files are
// held to DIFFERENT obligations: the full rule in one, the pointer plus what is specific to that role in the other.
// Neither goes under `.claude/rules/` -- that directory is charged on every wake (#2217).
//
// Every obligation is a pattern on the section's own words, and each is run against a fixture WITHOUT the rule
// first, so a checker that finds nothing to check cannot pass (the emptiness's positive control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), "utf8");
const CEO = "packages/agent-org/docs/roles/ceo.md";
const PRODUCT_MANAGER = "packages/agent-org/docs/roles/product-manager.md";

/** What a passage must say, each with the reason it is on the list. Patterns are on words the rule needs. */
const SHARED: Array<[string, RegExp]> = [
  ["names the label", /needs:chairman/],
  ["says a future product line is `parked`", /future product line is `parked`/],
  ["cites the ruling", /#2623/],
  ["cites this row", /#2637/],
  ["sends an uncleared row to `ceo`", /could not clear[^.]*\bceo\b|goes to `ceo`/],
];
const FULL_RULE: Array<[string, RegExp]> = [
  ["says what the label is for: what only the chairman can physically do", /physically do/],
  ["names the categories", /accounts, credentials, org or repo admin, money, legal/],
  ["says it is not a parking label", /never a parking label/],
  ["says it is not sequencing", /never sequencing/],
  ["says it is not for something not needed yet", /not needed yet/],
  ["says the start is REPORTED, not asked", /REPORTED in "what's new", not asked/],
];
const POINTER: Array<[string, RegExp]> = [
  ["points at the wording in ceo.md rather than copying it", /\]\(ceo\.md#who-it-talks-to\)/],
];

/** The obligations a file fails, as messages; empty means it carries the rule. */
function missing(text: string, obligations: Array<[string, RegExp]>): string[] {
  // Wrapped prose: a line break inside a phrase must not read as the phrase being absent.
  const flat = text.replace(/\s+/g, " ");
  return obligations.filter(([, pattern]) => !pattern.test(flat)).map(([why]) => `lacks: ${why}`);
}

const FIXTURE_WITHOUT_THE_RULE = "## Who it talks to\n`orchestrator` for fleet; the chairman for money and publishing.\n";

test("positive control: a role file without the rule is refused, on every obligation", () => {
  assert.equal(missing(FIXTURE_WITHOUT_THE_RULE, [...SHARED, ...FULL_RULE, ...POINTER]).length,
    SHARED.length + FULL_RULE.length + POINTER.length);
});

test("positive control: dropping any one obligation from a passage that carries them all is noticed", () => {
  const all = [...SHARED, ...FULL_RULE];
  const passage = "needs:chairman future product line is `parked` #2623 #2637 goes to `ceo` physically do "
    + "accounts, credentials, org or repo admin, money, legal never a parking label never sequencing "
    + 'not needed yet REPORTED in "what\'s new", not asked';
  assert.deepEqual(missing(passage, all), []);
  for (const [why, pattern] of all) {
    assert.deepEqual(missing(passage.replace(pattern, ""), all), [`lacks: ${why}`]);
  }
});

test("ceo.md carries the whole needs:chairman rule", () => {
  assert.deepEqual(missing(read(CEO), [...SHARED, ...FULL_RULE]), []);
});

test("product-manager.md carries the shared rule and points at ceo.md's wording", () => {
  assert.deepEqual(missing(read(PRODUCT_MANAGER), [...SHARED, ...POINTER]), []);
});

test("the rule was not put under .claude/rules/, which every wake pays for (#2217)", () => {
  const dir = resolve(ROOT, ".claude/rules");
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  assert.ok(files.length > 0, "positive control: the directory has rule files to read");
  const offenders = files.filter((name) => /needs:chairman/.test(read(`.claude/rules/${name}`)));
  assert.deepEqual(offenders, []);
});
