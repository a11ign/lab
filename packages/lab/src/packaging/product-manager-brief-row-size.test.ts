// #2691: the chairman ruled, via `ceo`, that `product-manager` files a row sized to finish in about 60
// calls or fewer and splits any row expected to run past ~100 (#928's token-efficiency reading). The rule
// lives beside "## The tracker's rules" in `product-manager.md`, the section that already carries the
// Ready-column and re-verification rules -- nowhere else says it, so a session that has not read this file
// has no way to know the estimate is expected at filing time.
//
// Every obligation is a pattern on the section's own words, run against a fixture WITHOUT the rule first,
// so a checker that finds nothing to check cannot pass (the emptiness's positive control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const PRODUCT_MANAGER = "packages/agent-org/docs/roles/product-manager.md";
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), "utf8");

/** What the passage must say, each with the reason it is on the list. */
const OBLIGATIONS: Array<[string, RegExp]> = [
  ["sizes a row to finish in about 60 calls", /about 60 calls/],
  ["splits a row expected to run past ~100", /past ~100/],
  ["cites the chairman's token-efficiency reading", /#928/],
  ["cites this row", /#2691/],
  ["the filer estimates at filing time", /[Ee]stimate the call count at filing time/],
  ["the estimate weighs Region size", /Region size/],
  ["the estimate weighs files touched", /how many files it touches/],
  ["the estimate weighs a mutation check or a fleet\\/lab round-trip",
    /mutation check or a fleet\/lab round-trip/],
  ["a row that cannot be split smaller says so in its own body",
    /cannot reasonably be split smaller says so in its own body/],
  ["names the live call-count signal", /row-call-count-signal/],
  ["says the signal is a candidate, not an automatic split", /never an automatic split/],
];

/** The obligations a file fails, as messages; empty means it carries the rule. */
function missing(text: string, obligations: Array<[string, RegExp]>): string[] {
  // Wrapped prose: a line break inside a phrase must not read as the phrase being absent.
  const flat = text.replace(/\s+/g, " ");
  return obligations.filter(([, pattern]) => !pattern.test(flat)).map(([why]) => `lacks: ${why}`);
}

const FIXTURE_WITHOUT_THE_RULE = "## The tracker's rules\n\nReady holds at least three product rows.\n";

test("positive control: a tracker-rules section without the rule is refused, on every obligation", () => {
  assert.equal(missing(FIXTURE_WITHOUT_THE_RULE, OBLIGATIONS).length, OBLIGATIONS.length);
});

test("positive control: dropping any one obligation from a passage that carries them all is noticed", () => {
  const passage = "about 60 calls past ~100 #928 #2691 Estimate the call count at filing time Region size "
    + "how many files it touches mutation check or a fleet/lab round-trip "
    + "cannot reasonably be split smaller says so in its own body "
    + "row-call-count-signal never an automatic split";
  assert.deepEqual(missing(passage, OBLIGATIONS), []);
  for (const [why, pattern] of OBLIGATIONS) {
    assert.deepEqual(missing(passage.replace(pattern, ""), OBLIGATIONS), [`lacks: ${why}`]);
  }
});

test("product-manager.md carries the row-size filing rule", () => {
  assert.deepEqual(missing(read(PRODUCT_MANAGER), OBLIGATIONS), []);
});

test("the rule sits beside The tracker's rules, not under .claude/rules/ (#2217's byte budget)", () => {
  const text = read(PRODUCT_MANAGER);
  const trackerAt = text.indexOf("## The tracker's rules");
  const sizeAt = text.indexOf("A row is filed sized to finish");
  assert.ok(trackerAt !== -1 && sizeAt !== -1, "positive control: both sections exist");
  assert.ok(sizeAt > trackerAt, "the sizing rule is filed after the tracker's rules section, not before it");
  const rules = readFileSync(resolve(ROOT, ".claude/rules/agent-practices.md"), "utf8");
  assert.doesNotMatch(rules, /about 60 calls/, "the rule belongs in the role brief, not the everyone-pays budget");
});
