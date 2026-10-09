/**
 * THE COUNT THAT MAKES C2's TRADE DEFENSIBLE.
 *
 * `assertableSweep` refuses `phantom` and `truncated` and deliberately ALLOWS `unknown`, because every
 * capture taken before the counter existed reports it and refusing there would silence 2.1.1 across the
 * whole corpus. That trade is defensible exactly once: while it is COUNTED. An `unknown` that nothing
 * reports IS `unknown` read as `exact`, which is the defect C1 was written to prevent, arriving one layer
 * further out.
 *
 * Written because the function had no caller but its own test — the `scorer:verify` shape, a check that
 * existed and that nothing ever invoked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { completenessLines } from "../../scripts/score-rules.js";

const record = (completeness?: Record<string, string>) =>
  ({ ruleEvidence: completeness ? { completeness } : {} }) as never;

test("the distribution is reported per record per type, most common first", () => {
  const lines = completenessLines([
    record({ heading: "exact", link: "exact" }),
    record({ heading: "exact", link: "truncated" }),
  ]).join("\n");
  assert.match(lines, /heading\/exact/);
  assert.match(lines, /link\/truncated/);
  assert.match(lines, /2\s+heading\/exact/, "two records agreed on headings and the count must say so");
});

test("AN ABSENT FIELD IS ITS OWN ROW, never folded into agreement", () => {
  // A record predating the field is not a record whose sweep agreed. Folding those together is the exact
  // collapse this plan is about, and it would make the corpus look verified as it aged.
  const lines = completenessLines([record(), record()]).join("\n");
  assert.match(lines, /no completeness field/);
  assert.match(lines, /2 record-type\(s\) are UNVERIFIED/);
});

test("UNVERIFIED IS COUNTED, and unknown counts toward it", () => {
  const lines = completenessLines([record({ heading: "unknown", link: "exact" })]).join("\n");
  assert.match(lines, /1 record-type\(s\) are UNVERIFIED/,
    "one unknown among two types is one unverified, and `exact` must not absorb it");
  assert.match(lines, /allowed and counted here, never refused/,
    "the line must state the trade, or a reader takes the number for a failure count");
});

test("no records with evidence yields NO lines, rather than a report of nothing", () => {
  // The surrounding function already says why an export carries no ruleEvidence, and printing an empty
  // distribution under it would read as "measured, and everything is fine".
  assert.deepEqual(completenessLines([]), []);
});
