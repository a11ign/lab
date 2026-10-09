/**
 * THE WRONG-POPULATION ROW'S HEADING COUNT MUST MATCH THE ROWS IT ACTUALLY DESCRIBES.
 *
 * `docs/backlog.md`'s longest-lived open row collects one shape: a check that answers CORRECTLY about a
 * population other than the one its reader thinks it covers. On 2026-09-06 its heading read **ELEVEN**
 * while its table held **four** rows — the other seven had been counted in conversation and never
 * written down.
 *
 * That is the row's own subject, committed inside the row itself. A heading count is a claim about a
 * population (the instances) derived from somewhere other than that population (somebody's memory of a
 * standup), and it read as authoritative for as long as nobody counted. It is also the failure this page
 * names elsewhere in its own words: *a claim that something is recorded is not a record.*
 *
 * So the count is DERIVED here rather than trusted. This is deliberately the weakest of the three
 * remedies CLAUDE.md ranks (delete a copy, derive one from the other, pin them equal with a test) — the
 * duplication is forced, because prose has to state a number for a reader who is not running tests.
 *
 * Mutation-checked: change either the heading number or the number of table rows and this fails, naming
 * both sides.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKLOG = readFileSync(`${REPO}docs/backlog.md`, "utf8");

const WORDS: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8,
  NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14,
  FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20,
};

/** The row's heading, and the number it claims — spelled as a word, as the row has always spelled it. */
function headingClaim(): { line: string; claimed: number } {
  const line = BACKLOG.split("\n").find(
    (l) => l.startsWith("## ") && l.includes("answers correctly about the wrong population"));
  assert.ok(line, "the wrong-population row's heading is gone — renamed, or the row was deleted");
  const word = line.match(/\*\*([A-Z]+)\*\*\s+instances/)?.[1];
  assert.ok(word, `the heading no longer states a count in the pinned form: ${line}`);
  assert.ok(word in WORDS, `heading count '${word}' is not a number word this test knows`);
  return { line, claimed: WORDS[word] };
}

/**
 * The instance rows: the table's body under that heading, up to the first paragraph after it.
 *
 * Counted by the leading `| <n> |` index the table already carries, NOT by counting pipe-rows — a
 * markdown table's header and separator are pipe-rows too, and a cell containing a wrapped line is not.
 */
function instanceRows(): number[] {
  const after = BACKLOG.slice(BACKLOG.indexOf(headingClaim().line));
  const end = after.indexOf("\n\n**Filed as one row");
  // ASSERT THE TERMINATOR WAS FOUND, never just that the slice came out shorter.
  // The first version of this line read `after.slice(0, after.indexOf(...))` with a
  // `table.length < after.length` guard. `indexOf` returns -1 on no match and `slice(0, -1)` then
  // yields the whole rest of the file minus ONE CHARACTER -- which is shorter, so the guard passed,
  // and the row count was silently taken from every table below this one as well. Found by mutation:
  // rewording that paragraph left all four assertions green. A guard that cannot fail is the exact
  // shape this file is about, committed inside the test written to pin it.
  assert.ok(end > 0, "the paragraph terminating the table is gone, so the row count would be read " +
    "from the whole rest of the file — reword it and update this test together");
  const table = after.slice(0, end);
  return [...table.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
}

test("VACUITY GUARD -- the table is found and holds instances at all", () => {
  // 0 here means the slice or the regex broke, which would make every assertion below pass having
  // examined nothing. That is the always-passing-guard shape this same page closed as a class.
  assert.ok(instanceRows().length >= 4, `found ${instanceRows().length} instance rows, expected at least 4`);
});

test("the heading's count equals the number of instances actually written down", () => {
  const { claimed } = headingClaim();
  const rows = instanceRows();
  assert.equal(rows.length, claimed,
    `the heading claims ${claimed} instances and the table describes ${rows.length}. ` +
    `Counting an instance without describing it is the row's own subject: a number derived from ` +
    `somewhere other than the population it claims to count.`);
});

test("the instances are numbered 1..n with no gap and no repeat", () => {
  // A duplicated index makes two instances read as one and the count then disagrees for a second,
  // unrelated reason -- which would send the next reader to the heading rather than to the table.
  const rows = instanceRows();
  assert.deepEqual(rows, rows.map((_, i) => i + 1),
    `instance indices are ${rows.join(",")} — expected 1..${rows.length}`);
});

test("the row is still OPEN, and says why it stays open", () => {
  // It is a RECORD, not a defect awaiting a fix: every entry is already fixed at its own site. If a
  // future edit closes it, that edit must also remove this test, which is the point of asserting it.
  const { line } = headingClaim();
  assert.ok(line.includes("OPEN"), `the row is no longer marked OPEN: ${line}`);
  assert.match(BACKLOG, /the row stays OPEN deliberately/,
    "the row no longer states why it stays open, which is what stops it reading as neglected");
});
