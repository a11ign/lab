/**
 * #577: writing an achievement record must refuse AT WRITE TIME when it would displace one.
 *
 * The incident: on 2026-09-08 the board body sat at exactly 925 words, its cap. Two records were added,
 * their bullets 19 and 24 words — precisely the 43-word overage. `board-style.test.ts` refused,
 * `trunk-guard` went red, and main stayed red until #576 reverted them. The next achievement anyone
 * recorded was going to do this, to whoever recorded it.
 *
 * `bodyCapRefusal` was already thorough and ran in the wrong place — inside `board:document`, at 08:00,
 * hours after the merge. **A refusal that arrives after the merge cannot stop the merge.**
 *
 * THE MUTATION THE ROW ASKS FOR IS `NOTHING IS WRITTEN WHEN IT REFUSES`. "It refused" and "it wrote the
 * record then complained" are indistinguishable from an exit code, and the second leaves the trunk
 * exactly as red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  missingFields, recordFilename, refusalForDraft, writeRecord, boardWithDraft,
} from "../../../../scripts/board-record.mjs";

const draft = (extra: Record<string, unknown> = {}) => ({
  claim: "A claim.",
  boardClaim: "A board claim.",
  evidence: "Evidence, verified by a named command.",
  issue: 577,
  reportedBy: "product-manager",
  at: "2026-09-09T14:00:00Z",
  ...extra,
});

const board = { data: { achievements: [] }, render: () => "rendered" };
const fits = () => null;
const overCap = () => "board:document REFUSES — the body is 968 words against a 925 cap.\n"
  + "The achievements, oldest first:\n  [0] \"An older claim\"   written 6 September, 13 words";

// --- the refusal ---

test("a draft that fits is written", () => {
  assert.equal(refusalForDraft(draft(), fits, board), null);
});

test("THE MUTATION: at the cap, one more record REFUSES and NOTHING IS WRITTEN", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "board-record-"));
  const refusal = refusalForDraft(draft(), overCap, board);
  assert.ok(refusal, "at the cap, the write must refuse");
  // The write is never reached, and the assertion that matters is the directory, not the exit code.
  assert.deepEqual(readdirSync(dir), [],
    "a refusal that wrote the file anyway leaves the trunk exactly as red as before");
});

test("the refusal NAMES the candidates, oldest first, with their word costs", () => {
  const refusal = refusalForDraft(draft(), overCap, board)!;
  assert.match(refusal, /oldest first/);
  assert.match(refusal, /13 words/,
    "the word cost is what makes the choice possible; a bare list makes it a guess");
});

test("IT REFUSES, IT NEVER RETIRES — the refusal says so and offers the two moves", () => {
  const refusal = refusalForDraft(draft(), overCap, board)!;
  assert.match(refusal, /NOTHING WAS WRITTEN/);
  assert.match(refusal, /a person's decision, not this tool's/);
  assert.match(refusal, /"inBody": false/,
    "a reader following this message exactly must be able to resolve it");
  assert.match(refusal, /shorten this draft/);
});

// --- shape before cap, and why that order ---

test("a draft missing evidence is refused for THAT, not for the body's length", () => {
  // Reporting a missing field as "the body is too long" names a real problem that is not this draft's,
  // and sends the writer to retire somebody else's achievement over their own typo.
  const refusal = refusalForDraft(draft({ evidence: "" }), overCap, board)!;
  assert.match(refusal, /missing evidence/);
  assert.doesNotMatch(refusal, /925 cap/);
});

test("missing fields are NAMED, never counted", () => {
  assert.deepEqual(missingFields({ claim: "x" }), ["evidence", "issue", "reportedBy", "at"]);
  assert.deepEqual(missingFields(draft()), []);
});

test("a whitespace-only field is missing, not present", () => {
  assert.deepEqual(missingFields(draft({ evidence: "   " })), ["evidence"]);
});

// --- the filename ---

test("the filename is deterministic, so writing the same record twice is the same file", () => {
  assert.equal(recordFilename(draft()), recordFilename(draft()));
  assert.match(recordFilename(draft()), /^issue-577-[0-9a-f]{8}\.json$/);
});

test("a different claim on the same issue is a different file, and that is visible", () => {
  assert.notEqual(recordFilename(draft()), recordFilename(draft({ claim: "A different claim." })));
});

// --- the write, once it is reached ---

test("writeRecord writes the draft verbatim, pretty-printed and newline-terminated", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "board-record-"));
  const file = writeRecord(draft(), dir);
  const written = readFileSync(file, "utf8");
  assert.equal(written.at(-1), "\n");
  assert.deepEqual(JSON.parse(written), draft());
  assert.deepEqual(readdirSync(dir), [recordFilename(draft())]);
});

// --- the question asked is "with this draft", not "today" ---

test("the cap is measured on the board WITH the draft in it, never the board without", () => {
  // The question is not "does the body fit today" — it always does, or main would be red — but "does it
  // fit once this is in it". A check on today's board passes every time and catches nothing.
  const seen: unknown[] = [];
  const withDraft = boardWithDraft(draft(), {
    collectData: (() => ({ since: "x" })) as never,
    reportedData: (() => ({ achievements: [{ claim: "an existing one" }] })) as never,
  });
  seen.push(withDraft);
  assert.equal((withDraft as { achievements: unknown[] }).achievements.length, 2);
  assert.deepEqual((withDraft as { achievements: { claim: string }[] }).achievements.at(-1)!.claim,
    "A claim.", "the draft is the last entry, so it is the one the bullet list gains");
});
