/**
 * The 2.1.2 decision is stated TWICE, and this asserts the copies agree on every capture on disk.
 *
 * `focusIsTrappedIn` (case-matrix.mjs) decides whether a corpus page demonstrates a keyboard trap;
 * `tabRingCoverage` (rules.ts) decides whether to report one. They cannot share code — the corpus
 * generator runs under plain `node` and the rules are TypeScript compiled into a package the generator
 * would then depend on for a build — so this is the remedy CLAUDE.md prescribes for a duplication that is
 * genuinely forced: pin them equal against real evidence, exactly as `name-normalisation.test.ts` does.
 *
 * IT COST A DRIFT WITHIN THE HOUR OF BEING WRITTEN. The rule learned to measure the tab ring against the
 * page's rendered TAB STOPS, so `keyboard-trap-modal-total` began reporting a trap; the signal still
 * measured against swept FORM FIELDS, and a dialog holding every field means `reached >= onPage`. So
 * `check-signals` reported the case BLIND while the rule fired on that same capture. Two gates disagreeing
 * about one corpus is the only reason it surfaced, and this test is that disagreement made cheap.
 *
 * WHOLE CAPTURES, not the two predicates in isolation. Each side has to EXTRACT what it needs — the signal
 * reads `domCensus(capture)`, the rule reads `oracleCounts(capture)` — and the extraction is where four of
 * this repo's six rule callers went wrong. A parity test on the predicates alone would agree perfectly
 * while the two disagreed in production.
 *
 * Skips honestly when `runs/` is absent, which CI cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { signalMatches, TAB_RING_FLOOR as SIGNAL_FLOOR } from "./case-matrix.mjs";
import { ruleFindings, TAB_RING_FLOOR as RULE_FLOOR } from "@a11y-witness/judge/rules";
import { oracleCounts } from "@a11y-witness/evidence/verify";

const CAPTURES = resolve(process.cwd(), process.env.DATASET_ROOT ?? "runs/screenreader-dataset", "captures");

/** Every capture that walked the focus ring — the only ones either side can have an opinion about. */
function capturesWithAFocusOrder(): { name: string; capture: Record<string, unknown> }[] {
  if (!existsSync(CAPTURES)) return [];
  const out = [];
  for (const file of readdirSync(CAPTURES).filter((f) => f.endsWith(".json"))) {
    try {
      const capture = JSON.parse(readFileSync(resolve(CAPTURES, file), "utf8"));
      const stops = (capture as { interaction?: { focusOrder?: unknown } }).interaction?.focusOrder;
      if (Array.isArray(stops) && stops.length) out.push({ name: file, capture });
    } catch { /* a half-written capture is not this test's subject; verify.corpus.test.ts owns that */ }
  }
  return out;
}

const saysTrapped = (capture: Record<string, unknown>): boolean =>
  signalMatches(capture as never, { type: "focus-trapped" } as never);

const rulesSayTrapped = (capture: Record<string, unknown>): boolean =>
  ruleFindings({ ...capture, ...oracleCounts(capture as never) } as never)
    .some((f) => f.wcag.startsWith("2.1.2"));

test("the signal and the rule reach the same 2.1.2 verdict on every capture on disk", () => {
  const captures = capturesWithAFocusOrder();
  if (!captures.length) {
    console.log("      SKIPPED: no captures with a focusOrder under runs/ — nothing to compare");
    return;
  }
  const disagreements = captures
    .map(({ name, capture }) => ({ name, signal: saysTrapped(capture), rule: rulesSayTrapped(capture) }))
    .filter((r) => r.signal !== r.rule);

  assert.deepEqual(disagreements, [],
    `the corpus signal and the shipped rule disagree about ${disagreements.length} capture(s). `
      + "One of them has learned something the other has not — which is how `keyboard-trap-modal-total` "
      + "came to read BLIND to check-signals while the rule reported it.");
});

test("the comparison examined a real corpus, rather than agreeing about nothing", () => {
  // Both sides return false for a capture with no focus order, so an empty or filtered-to-nothing set
  // makes the test above pass having compared zero verdicts — the way a source-text scrape passes.
  const captures = capturesWithAFocusOrder();
  if (!captures.length) return;
  assert.ok(captures.length >= 2, `only ${captures.length} capture(s) carry a focus order`);
  assert.ok(captures.some(({ capture }) => rulesSayTrapped(capture)),
    "no capture on disk reports a trap, so agreement here proves only that both sides can say no");
});

test("both sides use the SAME floor, asserted on the value rather than on agreeing verdicts", () => {
  // The verdict comparison above cannot see this on a thin corpus. Measured while mutation-checking it:
  // moving the signal's floor from 0.5 to 0.95 changed NO verdict, because the captures on disk sit at
  // 1.00, 0.21, 1.00 and 0.19 — nothing lies between the two floors, so the mutation was equivalent and
  // the drift would have shipped. A corpus that happens to contain no counter-example is not a check.
  //
  // Read as EXPORTED VALUES, never scraped from source text: a regex over the source is how a test comes
  // to assert over an empty set and pass having examined nothing.
  assert.equal(SIGNAL_FLOOR, RULE_FLOOR,
    `the corpus signal and the rule disagree about how generous the tab-ring floor is `
      + `(signal ${SIGNAL_FLOOR}, rule ${RULE_FLOOR}); they decide the same question and must use one number`);
});
