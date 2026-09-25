// no-token: gh -- reads one markdown file and nothing else; no `gh`, `herdr` or network is reached
/**
 * #2540: THE ENGINEER BRIEF CARRIES FOUR HABITS FOR KEEPING CONTEXT SMALL, EACH NAMING ITS TOOL.
 *
 * The brief is re-read by every engineer at every spawn, and what an engineer pastes early is re-read on every
 * later call, so a habit only helps if it names the tool that makes it cheap. The spellings are asserted inside
 * the ONE section, sliced by its heading: a whole-file `includes` is satisfied by a duplicate phrase elsewhere
 * in the brief, which is how a pin outlives the sentence it was written for.
 *
 * Its own file, and not a block in `wake-engineer-brief.test.ts`, because the token-less acceptance job
 * refuses the existing named packaging tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BRIEF = readFileSync(`${ROOT}packages/agent-org/docs/roles/engineer.md`, "utf8");
/** The row's ceiling on what the section may weigh. */
const SECTION_BYTE_CEILING = 1600;
const HEADING = /^## Keep your context small\b.*$/gm;

/** The text from the heading to the next `## ` heading (or the end of the file). */
function sectionOf(brief: string): string {
  const starts = [...brief.matchAll(HEADING)];
  assert.equal(starts.length, 1, "exactly one section carries the context habits");
  const from = starts[0].index as number;
  const next = brief.indexOf("\n## ", from + 1);
  return brief.slice(from, next === -1 ? undefined : next);
}

const HABITS = [
  ["read file ranges", "`offset`"],
  ["read file ranges (limit)", "`limit`"],
  ["summarise output", "| tail"],
  ["project gh JSON", "--jq"],
  ["explore in a subagent", 'model="haiku"'],
] as const;

/** Which of the habits' spellings the section lacks: the decider both the real read and the mutations call. */
const missingFrom = (section: string) => HABITS.filter(([, spelling]) => !section.includes(spelling));

test("the one section names the literal spelling of each of the four habits' tools", () => {
  assert.deepEqual(missingFrom(sectionOf(BRIEF)), []);
});

test("the pin bites: removing any one spelling from the section is reported as that spelling missing", () => {
  const section = sectionOf(BRIEF);
  for (const habit of HABITS) {
    const mutated = section.replaceAll(habit[1], "");
    assert.deepEqual(missingFrom(mutated), [habit], `${habit[0]}: the pin must notice ${habit[1]} gone`);
  }
});

test("the pin bites: a duplicate spelling ELSEWHERE in the brief does not satisfy it", () => {
  const stripped = BRIEF.replace(sectionOf(BRIEF), "## Keep your context small\n\nnothing here\n");
  const elsewhere = `${stripped}\n${HABITS.map(([, spelling]) => spelling).join(" ")}\n`;
  assert.deepEqual(missingFrom(sectionOf(elsewhere)).length, HABITS.length);
});

test("the section is small: the brief pays for it at every spawn", () => {
  const bytes = Buffer.byteLength(sectionOf(BRIEF));
  assert.ok(bytes <= SECTION_BYTE_CEILING, `the section is ${bytes} bytes; the ceiling is ${SECTION_BYTE_CEILING}`);
});
