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

import { selectCases, unmatchedSelectors } from "./capture-screenreader-dataset.mjs";

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

/**
 * A SELECTOR THAT MATCHES NOTHING MUST BE NAMED, and until 2026-09-06 only ALL of them matching nothing
 * was caught.
 *
 * `main` refused on `!cases.length`, which fires when EVERY entry is a miss. Ask for
 * `label-vague+,status-waiting+` — the first real, the second never built — and the run captured ten
 * cases, reported success, and never said that half of what you asked for does not exist.
 *
 * Found while checking issue #34's acceptance before paying for its capture — and the check was worth
 * more than the capture. `--only=label-vague+,status-waiting+,status-progress+` selects **0 of 1,657**:
 * `status-waiting`/`status-progress` were never built, and `label-vague+` misses too, because a trailing
 * `+` means "the case `label-vague` AND its variants" and no case is named `label-vague` — the ten are
 * `label-vague-field`, `label-vague-box` and so on, which plain `label-vague` reaches by substring.
 *
 * BE PRECISE ABOUT WHAT THE OLD GUARD MISSED, because the first version of this comment overstated it:
 * for THAT selector `!cases.length` does fire, so the run refuses. What it cannot say is WHICH of the
 * three is wrong, or that one of them is a `+` away from correct — it prints the whole string back. The
 * unguarded case is the MIXED one, `label-vague,status-waiting+`, where the first matches ten cases, the
 * run captures them, reports success, and never mentions the second at all.
 *
 * This is the `examinedNothing` shape for the third time in this repo — a guard covering the extreme case
 * and reading as though it covered the general one. `evidence:check` guarded `compared === 0` and let
 * 2-of-48 through; `selectCases`'s own comment records `--only=route-title-stale` capturing 1 case of 7.
 * The trailing `+` closed "asked for a family, got one". This closes "asked for a thing that does not
 * exist, got told nothing".
 */
const CASE_SET = [
  { id: "label-vague-field" }, { id: "label-vague-box" },
  { id: "route-title-stale" }, { id: "route-title-stale+also-bare-edit" },
  { id: "form-error-silent" },
];

test("every selector matching something yields no complaint", () => {
  assert.deepEqual(unmatchedSelectors(CASE_SET, "label-vague,route-title-stale+"), []);
});

test("a selector matching NOTHING is named, even when its siblings matched", () => {
  // THE UNGUARDED CASE, and the reason this function exists. `label-vague` matches two cases here, so
  // `cases.length` is non-zero, `!cases.length` never fires, and the old code said nothing whatsoever
  // about `status-waiting+` while capturing a subset and reporting success.
  const missed = unmatchedSelectors(CASE_SET, "label-vague,status-waiting+");
  assert.equal(missed.length, 1);
  assert.equal(missed[0].want, "status-waiting+");
});

test("the refusal offers NEAR MISSES, because a miss is nearly always a typo or a rename", () => {
  // A refusal that cannot suggest the right spelling gets worked around rather than read — the same
  // reason every other guard in this repo names what it caught.
  const missed = unmatchedSelectors(CASE_SET, "label-vgaue+");
  assert.deepEqual(missed[0].near, ["label-vague-field", "label-vague-box"]);
});

test("a selector sharing no leading word says so rather than offering nothing silently", () => {
  const missed = unmatchedSelectors(CASE_SET, "zzz-nonexistent");
  assert.deepEqual(missed[0].near, []);
});

test("no --only at all is not a miss — it means every case", () => {
  assert.deepEqual(unmatchedSelectors(CASE_SET, undefined), []);
  assert.deepEqual(unmatchedSelectors(CASE_SET, ""), []);
});

test("the unmatched check and the filter agree, because they share one matcher", () => {
  // Two implementations of "does this selector match this id" is the fact-stated-twice shape, and it
  // would fail in the worst direction: a selector the filter honours reported as a miss, refusing a
  // correct run. Asserted over every selector form the filter supports.
  for (const want of ["label-vague", "label-vague-field", "route-title-stale+", "form-error-silent"]) {
    const selected = selectCases(CASE_SET, want);
    const missed = unmatchedSelectors(CASE_SET, want);
    assert.equal(selected.length > 0, missed.length === 0,
      `'${want}' selected ${selected.length} case(s) and the miss check said ${missed.length} miss(es)`);
  }
});
