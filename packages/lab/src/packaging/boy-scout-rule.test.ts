/**
 * #2847: THE BOY SCOUT RULE IS IN EVERY LIVE BRIEF, AND THE README SAYS HOW IT IS HELD.
 *
 * The chairman's standing rule (2026-10-01) is worth nothing in a brief a session never reads, and a copy that
 * drifts per brief is five rules. So the README's own section holds the ONE copy, every brief is compared to it,
 * and the set of briefs is DERIVED from `sessions.json` (plus the two role files the row names that are not
 * `live` entries), never listed here: a role added tomorrow without the block fails without anyone editing this.
 *
 * The four holds (what `ceo` and its peers do to keep sessions to the rule) are asserted by SHAPE, as
 * `roles-readme.test.ts` does for its own conventions: a guard pinned to today's wording refuses the next honest
 * rewrite and proves nothing about whether the hold exists.
 *
 * #2848 owns the repeating-log-line detector. This file does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROLES_DIR = ".agent-org/roles/";
const rootFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

// The row names these two beside the `live` entries: `reviewer` and `tracker-auditor` are real briefs a session
// reads, and neither is a `live` roster entry (spawned per pull request, and an hourly pass).
const EXTRA_BRIEFS = [`${ROLES_DIR}reviewer.md`, `${ROLES_DIR}tracker-auditor.md`];
const README = `${ROLES_DIR}README.md`;
const SECTION_HEADING = /^## The Boy Scout rule, verbatim/m;

type Sessions = { live: Array<{ brief: string }> };

/** The briefs that must carry the rule: every `live` entry's `brief`, then the two named extras, no repeats. */
const derivedBriefs = (sessions: Sessions): string[] =>
  [...new Set([...sessions.live.map((entry) => entry.brief), ...EXTRA_BRIEFS])];

/** The README section's text, from its heading to the next `## ` heading. Empty when the section is absent. */
function readmeSection(readme: string): string {
  const start = readme.search(SECTION_HEADING);
  if (start < 0) return "";
  const rest = readme.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The rule's text: the section's own blockquote (its `> ` lines, contiguous), exactly as every brief must hold it. */
function ruleBlock(section: string): string {
  const quoted = section.split("\n").filter((line) => line.startsWith("> "));
  return quoted.join("\n");
}

/** Briefs that do not carry `block` verbatim, each with why: absent file, or the block missing/altered. */
function briefsWithoutBlock(briefs: string[], block: string, read: (path: string) => string): string[] {
  return briefs.flatMap((path) => {
    try {
      return read(path).includes(block) ? [] : [`${path}: does not carry the block verbatim`];
    } catch (cause) {
      return [`${path}: unreadable (${(cause as Error).message})`];
    }
  });
}

/** The positive control, kept apart so a mutation of the set can be shown to trip IT and not the comparison. */
function controlProblems(briefs: string[]): string[] {
  const problems: string[] = [];
  if (briefs.length === 0) problems.push("the derived set of briefs is empty");
  if (!briefs.includes(`${ROLES_DIR}engineer.md`)) problems.push("the derived set lacks engineer.md (the spare family's brief)");
  return problems;
}

/** One entry per hold the README section must name, asserted by what each one MEANS, not by its sentence. */
const HOLDS: Array<[string, RegExp]> = [
  ["ceo's state reading carries a faults-met-and-left line", /ceo[^]*state reading[^]*#928[^]*faults met and left/i],
  ["a completion that names a fault with no row or fix is asked for the row, then a brief defect",
    /completion report[^]*names a fault[^]*no filed row or fix[^]*product-manager[^]*brief defect/i],
  ["product-manager promotes or refuses a backlog row inside one tick", /product-manager[^]*promotes or refuses[^]*backlog[^]*one tick/i],
  ["tracker-auditor counts closed rows naming a fault with no row linked", /tracker-auditor[^]*counts[^]*closed rows[^]*fault[^]*no row linked/i],
];
const holdsMissing = (section: string): string[] =>
  HOLDS.filter(([, shape]) => !shape.test(section)).map(([name]) => name);

/** The section with numbered item `n` (its line and continuation lines, up to the next item or blank line) removed. */
function withoutListItem(text: string, n: number): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${n}. `));
  const end = lines.findIndex((line, i) => i > start && (line.trim() === "" || /^\d\. /.test(line)));
  return [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join("\n");
}

const sessions = JSON.parse(rootFile(`${ROLES_DIR}sessions.json`)) as Sessions;
const section = readmeSection(rootFile(README));
const block = ruleBlock(section);
const briefs = derivedBriefs(sessions);

test("#2847 control: the README section, its block and the derived briefs are real, and engineer.md is in the set", () => {
  assert.ok(section.length > 0, `${README} must keep a section headed "The Boy Scout rule, verbatim"`);
  assert.match(block, /^> \*\*Boy Scout rule \(chairman, 2026-10-01\)\.\*\*/, "the section's blockquote must open with the rule's name");
  assert.deepEqual(controlProblems(briefs), []);
  assert.ok(briefs.length > EXTRA_BRIEFS.length, `expected the live briefs plus the extras, got ${briefs.join(", ")}`);
});

test("#2847 ACCEPTANCE: every live brief, reviewer.md and tracker-auditor.md carry the README's block verbatim", () => {
  assert.deepEqual(briefsWithoutBlock(briefs, block, rootFile), []);
});

test("#2847: the README section names all four holds", () => {
  assert.deepEqual(holdsMissing(section), []);
});

test("#2847 MUTATION: deleting the block from ONE brief goes red for that brief and no other", () => {
  const [victim, ...others] = briefs;
  const without = (path: string) => path === victim ? rootFile(path).replace(block, "") : rootFile(path);
  const problems = briefsWithoutBlock(briefs, block, without);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^${victim.replace(/\./g, "\\.")}`));
  assert.deepEqual(briefsWithoutBlock(others, block, without), []);
  // And a one-word alteration is as bad as a deletion: the briefs carry ONE text.
  const altered = briefsWithoutBlock([victim], block, (path) => rootFile(path).replace("Leave every place", "Leave each place"));
  assert.equal(altered.length, 1);
});

test("#2847 MUTATION: dropping a live brief from the derived set trips the positive control, and only for engineer.md", () => {
  const withoutEngineer = derivedBriefs({ live: sessions.live.filter((entry) => !entry.brief.endsWith("/engineer.md")) });
  assert.ok(!withoutEngineer.includes(`${ROLES_DIR}engineer.md`), "the mutation must actually remove engineer.md from the set");
  assert.equal(controlProblems(withoutEngineer).length, 1);
  // With no live entries at all only the two extras remain, and that set has no engineer.md either.
  assert.equal(controlProblems(derivedBriefs({ live: [] })).length, 1);
});

test("#2847 MUTATION: a new live role whose brief lacks the block, or whose brief file is missing, fails", () => {
  const bare = (path: string) => path === `${ROLES_DIR}newcomer.md` ? "# A role with no rule\n" : rootFile(path);
  const withNewcomer = derivedBriefs({ live: [...sessions.live, { brief: `${ROLES_DIR}newcomer.md` }] });
  assert.deepEqual(briefsWithoutBlock(withNewcomer, block, bare).length, 1);
  const missingFile = derivedBriefs({ live: [...sessions.live, { brief: `${ROLES_DIR}no-such-brief.md` }] });
  assert.match(briefsWithoutBlock(missingFile, block, rootFile).join("\n"), /no-such-brief\.md: unreadable/);
});

test("#2847 MUTATION: an absent or emptied README section, and each dropped hold, are caught", () => {
  assert.equal(readmeSection("# Roles\n\n## Something else\n").length, 0);
  assert.equal(ruleBlock(readmeSection("## The Boy Scout rule, verbatim\n\nno quote here\n\n## Next\n")), "");
  // An empty block is contained in every string, so the comparison alone would pass vacuously: the control above
  // is what refuses it, and this shows the comparison would not.
  assert.deepEqual(briefsWithoutBlock(briefs, "", rootFile), []);
  HOLDS.forEach(([name], index) => {
    const dropped = withoutListItem(section, index + 1);
    assert.deepEqual(holdsMissing(dropped), [name], `removing hold ${index + 1} must report exactly: ${name}`);
  });
});
