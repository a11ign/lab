import { test } from "node:test";
import assert from "node:assert/strict";
import { tabStopEvidenceLines } from "../../scripts/score-rules.js";

/**
 * A green gate must not be able to mean two opposite things.
 *
 * 2.1.2's tab-ring branch makes no claim without `dom.tabbable`, deliberately — a capture predating the
 * tab-stop census omits it, and absence must never read as "the page has no tab stops". The price of that
 * correctness is that the branch is SILENT on an old corpus, and a silent branch scores exactly like a
 * clean one. "No conformant page trips it" and "not one record could have tripped it" then look identical
 * and need opposite responses: ship, versus recapture.
 *
 * The census cost this lesson twice — once to find, and once again when a re-export left every number
 * unchanged and the report could not say whether the evidence had arrived and found nothing, or had not
 * arrived at all. This is that fix applied to the next piece of evidence instead of after the next
 * investigation.
 */
const withTabbable = (n: number) => ({ ruleEvidence: { dom: { tabbable: n } } });

test("a corpus carrying no tab-stop count SAYS the branch is unexercised", () => {
  const lines = tabStopEvidenceLines([{}, { ruleEvidence: {} }, { ruleEvidence: { dom: {} } }]).join(" ");
  assert.match(lines, /UNEXERCISED/);
  assert.match(lines, /says nothing about it/);
});

test("zero is a READING, not an absence — a page with no tab stops still exercises the branch", () => {
  // The distinction the whole census exists to preserve. `tabbable: 0` means the browser counted and found
  // none; a missing key means nobody counted. Testing `typeof === "number"` rather than truthiness is what
  // keeps them apart, and a `?? 0` anywhere on this path would silently merge them.
  const lines = tabStopEvidenceLines([withTabbable(0)]).join(" ");
  assert.match(lines, /exercised/);
  assert.doesNotMatch(lines, /UNEXERCISED/);
});

test("a corpus that carries it reports HOW MANY, because a word cannot tell you 2 from 200", () => {
  const lines = tabStopEvidenceLines([withTabbable(14), withTabbable(16), {}]).join(" ");
  assert.match(lines, /2 of 3 record\(s\)/);
});
