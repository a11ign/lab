/**
 * The retry workflow this project's gates ask for did not exist, and the gap was invisible until a gate
 * named specific cases to redo.
 *
 * `check-signals` prints the ids that came back contaminated or blind. The obvious next step is to
 * recapture exactly those. `--only=` matched by substring against a single value, which meant:
 *
 *   - an id that is a PREFIX of others could not be targeted at all — `form-error-silent` is a real case
 *     and a prefix of ~90 `form-error-silent-bulk-*` ids, so asking for it ran ninety;
 *   - a LIST was impossible, so eleven named cases meant eleven runs, each paying a page-server lease
 *     and a worker connect.
 *
 * A tool that reports what went wrong but cannot act on its own report is only half a tool. These are
 * pure list operations — no worker, no manifest on disk, milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { selectCases } from "./capture-screenreader-dataset.mjs";

/** Deliberately includes an id that is a strict prefix of others — the case that could not be targeted. */
const CASES = [
  { id: "form-error-silent" },
  { id: "form-error-silent-hall" },
  { id: "form-error-silent-bulk-depot-001" },
  { id: "form-error-silent-bulk-depot-002" },
  { id: "heading-vague-market" },
  { id: "filter-status-silent-bulk-marina-022" },
];

const ids = (cases: { id: string }[]) => cases.map((c) => c.id);

test("no filter runs everything", () => {
  assert.equal(selectCases(CASES, undefined).length, CASES.length);
  assert.equal(selectCases(CASES, "").length, CASES.length);
});

test("an EXACT id means that one case, even when it is a prefix of others", () => {
  // The defect. Substring matching turned a request for one case into a request for ninety, and there
  // was no way to say "just this one".
  assert.deepEqual(ids(selectCases(CASES, "form-error-silent")), ["form-error-silent"]);
});

test("a substring still sweeps a family, because that is the common interactive use", () => {
  // Kept deliberately: `--only=heading` to run a family is why substring matching existed. Exact-only
  // would have fixed one workflow by breaking another.
  assert.deepEqual(ids(selectCases(CASES, "bulk-depot")),
    ["form-error-silent-bulk-depot-001", "form-error-silent-bulk-depot-002"]);
});

test("a comma-separated LIST works, so a gate's output can be pasted straight back in", () => {
  const selected = selectCases(CASES, "heading-vague-market,filter-status-silent-bulk-marina-022");
  assert.deepEqual(ids(selected), ["heading-vague-market", "filter-status-silent-bulk-marina-022"]);
});

test("exact and substring entries mix, and nothing is selected twice", () => {
  // `form-error-silent` is exact; `bulk-depot` is a substring. A case matching both must appear once —
  // capturing the same case twice in one run would race two workers onto one output file.
  const selected = selectCases(CASES, "form-error-silent,bulk-depot");
  assert.deepEqual(ids(selected),
    ["form-error-silent", "form-error-silent-bulk-depot-001", "form-error-silent-bulk-depot-002"]);
  assert.equal(new Set(ids(selected)).size, selected.length, "a case was selected more than once");
});

test("whitespace around list entries is tolerated, because pasted output carries it", () => {
  assert.deepEqual(ids(selectCases(CASES, " heading-vague-market , form-error-silent ")),
    ["form-error-silent", "heading-vague-market"]);
});

test("a filter matching nothing returns empty, so the caller can refuse rather than run everything", () => {
  // The dangerous alternative: an unmatched filter falling back to "all cases" would turn a targeted
  // retry of one case into a full 1,061-case run. The caller throws on empty; it must get empty.
  assert.deepEqual(selectCases(CASES, "no-such-case"), []);
});
