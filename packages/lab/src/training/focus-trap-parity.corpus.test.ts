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

import { signalMatches } from "./case-matrix.mjs";
import { ruleFindings } from "@a11y-witness/judge/rules";
import { oracleCounts } from "@a11y-witness/evidence/verify";
import { datasetRoot, captureRoot } from "../dataset-paths.mjs";

const CAPTURES = captureRoot(datasetRoot());

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

/*
 * A third test pinned the two TAB_RING_FLOOR constants equal. Both are gone: the tab-stop denominator they
 * belonged to was withdrawn after `rules-real-pages` measured 9 new 2.1.2 findings on 86 conformant real
 * pages. Recorded rather than silently deleted, because the reason it existed still stands and will apply
 * again the moment the two sides share a tuned number: mutation-checking showed the VERDICT comparison
 * above could not see a floor moved 0.5 -> 0.95, since no capture on disk sat between the two. A corpus
 * that happens to contain no counter-example is not a check, so a shared constant needs pinning by VALUE.
 */
