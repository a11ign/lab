/**
 * A case asserting a structure channel is EMPTY must not be handed markup that fills it.
 *
 * `structure-empty` says "this page exposes no X". If anything on the page supplies an X, the assertion is
 * simply false — the case keeps its label, stops testing what it claims to test, and `check-signals` reports
 * it as failing to discriminate, which reads like a capture problem rather than a page problem.
 *
 * Two sources can supply one. Page FURNITURE, which `withRealisticScale` handles by dropping the offending
 * element (it already did this for tables). And ACCOMPANYING DEFECTS, which `COLLIDING_PAIRINGS` handles —
 * except nothing checked it. Measured 2026-08-26 when the `no-headings` cases were added: `generic-heading`
 * adds a REAL `<h2>` (vaguely worded, which is 2.4.6's failure, but a heading), and **5 of 29 variants
 * carried one**. The whole suite passed with those five voided, and still did when the fix was reverted to
 * check — which is why this file exists rather than a note in `COLLIDING_PAIRINGS`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as matrix from "./case-matrix.mjs";

/** What markup would supply the channel a `structure-empty` case says is absent. */
const SUPPLIES: Record<string, RegExp> = {
  headings: /<h[1-6][\s>]/i,
  landmarks: /<(main|nav|aside|header|footer)[\s>]|role="(main|navigation|banner|contentinfo)"/i,
};

type Case = { id: string; good: string; bad: string; badSignal?: { type?: string; field?: string } };
const cases = (): Case[] => (matrix as unknown as { CASES: Case[] }).CASES;

test("a page claiming a channel is empty does not contain that channel", () => {
  const relevant = cases().filter((testCase) =>
    testCase.badSignal?.type === "structure-empty");
  // A discovery test that discovers nothing passes having examined nothing — the failure this repo has
  // shipped three times. If `structure-empty` is renamed, this must fail rather than fall silent.
  assert.ok(relevant.length > 20,
    `found only ${relevant.length} structure-empty case(s); the search is broken`);

  const broken: string[] = [];
  for (const testCase of relevant) {
    const field = testCase.badSignal!.field!;
    const supplies = SUPPLIES[field];
    assert.ok(supplies, `no rule for structure-empty on '${field}' — add one to SUPPLIES`);
    if (supplies.test(testCase.bad)) broken.push(`${testCase.id} (${field})`);
  }
  assert.deepEqual(broken, [],
    "these bad pages contain the very structure their signal says is absent, so they are labelled for a "
    + "failure the page does not have. Name the offender in COLLIDING_PAIRINGS, or suppress the furniture "
    + "in withRealisticScale — whichever supplied it");
});

test("the GOOD variant does supply it, or the pair cannot discriminate", () => {
  // The other half. A good page that ALSO lacks the channel makes the pair prove nothing, and
  // `check-signals` would call it contaminated — the opposite diagnosis from the one above, for the same
  // symptom of "this case does not work".
  const missing = cases()
    .filter((testCase) => testCase.badSignal?.type === "structure-empty")
    .filter((testCase) => !SUPPLIES[testCase.badSignal!.field!].test(testCase.good))
    .map((testCase) => testCase.id);
  assert.deepEqual(missing, [], "the conformant control must contain what the failing page lacks");
});

test("a no-headings page carries enough content to be a PAGE, not a fragment", () => {
  // The rule this subtype exists to test requires at least MIN_CONTENT_LINES (15) announcements before it
  // will say a page has no headings — deliberately, because "a fragment or an error page legitimately has
  // none". A case built to exercise that rule must clear its threshold BY CONSTRUCTION.
  //
  // Three of the first 29 did not, and the gate said so: `1.3.1:no-headings is rule-decided on 29
  // record(s) and caught only 26`. They were the three with the least content — 12, 12 and 13 block
  // elements — and two cases that DID pass sat at 13, so the whole subtype was one furniture bucket away
  // from flaking. A case that only sometimes trips the rule it tests is worse than one that never does:
  // it reads as an intermittent capture fault.
  //
  // The margin is the point, not the exact number. Announcements are not block elements one-for-one, so
  // this asks for comfortably more than the threshold rather than exactly it.
  const MIN_CONTENT_LINES = 15;
  const thin = cases()
    .filter((testCase) => testCase.badSignal?.field === "headings")
    .map((testCase) => ({
      id: testCase.id,
      blocks: (testCase.bad.match(/<p>|<li>|<a /g) ?? []).length,
    }))
    .filter((entry) => entry.blocks < MIN_CONTENT_LINES + 3);
  assert.deepEqual(thin, [],
    `these pages have too few block elements to reliably produce ${MIN_CONTENT_LINES} announcements, so `
    + "the rule reads them as fragments and stays silent — which the gate reports as the rule MISSING "
    + "EVIDENCE on a case built to provide it");
});
