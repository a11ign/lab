/**
 * Page furniture must not SILENCE a case's badSignal — asserted against every real bad capture on disk.
 *
 * `filler-collision.test.ts` covers the contamination direction: furniture that makes a signal fire on the
 * good page too. This covers the opposite and more dangerous one — furniture that stops a signal firing on
 * the BAD page. Contamination is loud (`check-signals` reports CONTAMINATED); blinding is quiet, and a
 * blinded case looks exactly like a page with nothing to report.
 *
 * The synthetic delta test cannot see it, and I confirmed that by reintroducing the real bug and watching
 * it pass. A signal can only be observed to go silent on a capture where it FIRES, and constructing one per
 * signal type by hand is inventing the evidence the test is meant to check. The corpus is 2,122 real
 * captures that `check-signals` already scores 1061 discriminating / 0 blind — free ground truth, and the
 * same argument `verify.corpus.test.ts` makes for using it.
 *
 * The bug it exists for: `placeholderOnlyIsPresent` began `if (formFields.length > 0) return false`, so the
 * labelled reference field ADR 0015 added as furniture would have silenced every `placeholder-only` case.
 * Reintroduce that line and this test fails on 26 captures.
 *
 * Skips honestly when `runs/` is absent, which CI cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASES, signalMatches } from "./case-matrix.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT ?? "runs/screenreader-dataset");
const CAPTURES = resolve(ROOT, "captures");

/** Kept in step with `filler()`, `namedField()` and `dataTable()` — the announcements furniture adds. */
const FURNITURE = {
  transcript: [
    "heading, level 2, Reference note 01",
    "Background detail for reference note 01, retained for records and reviewed each year by the site team.",
    "bullet, same page, link, Opening times for the north entrance 01",
    "Reference lookup, edit",
    "table, with 2 rows and 2 columns, caption, Reference notes index",
    "out of caption, row 1, column 1, Note",
    "row 2, Note, column 1, Site safety",
  ],
  headings: ["Reference note 01"],
  formFields: ["Reference lookup, edit"],
  links: ["Opening times for the north entrance 01"],
  tableCells: ["row 2, Site safety"],
};

type Capture = {
  transcript?: string[];
  structure?: Record<string, string[]>;
  interaction?: Record<string, unknown>;
};

const furnished = (capture: Capture): Capture => ({
  ...capture,
  transcript: [...(capture.transcript ?? []), ...FURNITURE.transcript],
  structure: {
    ...(capture.structure ?? {}),
    headings: [...(capture.structure?.headings ?? []), ...FURNITURE.headings],
    formFields: [...(capture.structure?.formFields ?? []), ...FURNITURE.formFields],
    links: [...(capture.structure?.links ?? []), ...FURNITURE.links],
    tableCells: [...(capture.structure?.tableCells ?? []), ...FURNITURE.tableCells],
  },
});

type Case = { id: string; badSignal?: { type?: string } };

/** Bad captures whose signal actually fires — the only ones on which silencing is observable. */
function firing(): { id: string; capture: Capture; signal: { type?: string } }[] {
  const found = [];
  for (const testCase of CASES as Case[]) {
    const path = resolve(CAPTURES, `${testCase.id}.bad.json`);
    if (!testCase.badSignal?.type || !existsSync(path)) continue;
    const file = JSON.parse(readFileSync(path, "utf8")) as { capture?: Capture } & Capture;
    const capture = file.capture ?? file;
    if (!Array.isArray(capture.transcript)) continue;
    if (!signalMatches(capture, testCase.badSignal)) continue;
    found.push({ id: testCase.id, capture, signal: testCase.badSignal });
  }
  return found;
}

const cases = firing();

test("the corpus is present and its signals fire, or this test is honestly skipped", () => {
  if (cases.length === 0) {
    console.log("    no corpus under runs/ — skipping the blinding sweep (expected in CI)");
  }
  assert.ok(true);
});

test("adding page furniture silences no badSignal that was firing", () => {
  if (cases.length === 0) return;
  const blinded = cases
    .filter(({ capture, signal }) => !signalMatches(furnished(capture), signal))
    .map(({ id, signal }) => `${id} (${signal.type})`);
  assert.deepEqual(blinded.slice(0, 12), [],
    `${blinded.length} of ${cases.length} cases stop discriminating once page furniture is added. A `
    + "blinded case is indistinguishable from a page with nothing to report, which is the one failure "
    + "this corpus cannot carry — fix the SIGNAL to reason about its own evidence rather than the whole "
    + "page, never the furniture. See docs/adr/0015 and placeholder-signal.test.ts.");
});

test("every signal type with a CAPTURE is swept, and the rest are named as not-yet-captured", () => {
  if (cases.length === 0) return;
  const covered = new Set(cases.map(({ signal }) => signal.type));
  const uncaptured = new Set<string>();
  const notFiring: string[] = [];
  for (const testCase of CASES as Case[]) {
    const type = testCase.badSignal?.type;
    if (!type || covered.has(type)) continue;
    // Two very different reasons a type can be missing from the sweep, and collapsing them is how a gap
    // becomes invisible. No capture on disk is a known, temporary gap — those five cases were added on
    // 2026-08-22 and `check-signals` reports them as NO CAPTURES too. A capture that exists but whose
    // signal does not fire is a BLIND case, which is a real defect and belongs to `check-signals`.
    if (existsSync(resolve(CAPTURES, `${testCase.id}.bad.json`))) notFiring.push(`${testCase.id} (${type})`);
    else uncaptured.add(type);
  }
  if (uncaptured.size > 0) {
    console.log(`    not yet captured, so unswept: ${[...uncaptured].sort().join(", ")}`);
  }
  assert.deepEqual(notFiring, [],
    "these cases HAVE a bad capture whose own signal does not fire, so this sweep silently skips them and "
    + "`check-signals` should already be reporting them BLIND");
});
