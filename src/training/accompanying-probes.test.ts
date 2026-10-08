import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCOMPANYING_DEFECTS } from "./case-matrix.mjs";

/**
 * AN ACCOMPANYING DEFECT'S LABEL AND ITS EVIDENCE MUST ARRIVE TOGETHER — known-gaps §19.
 *
 * `withAccompanyingDefects` spreads `...template`, so a paired defect inherited the HOST's probe settings.
 * Measured over the built case list: 69 cases pair `position-only-table` and all 69 carried
 * `probeTables: false`, so `structure.tableCells` was empty on every one while the label
 * `1.3.1:unassociated-table` was applied.
 *
 * Nothing failed, and the reason is the interesting half: `grants: "table_position_only"` is computed from
 * the TRANSCRIPT, which carries the table fine, so `corpus:grants-audit` passed — correctly. The FEATURE
 * was present and the rule-side channel was not. Two consumers of one defect, and only one needs a probe.
 */
type Defect = { subtypes: string[]; grants?: string; probes?: Record<string, boolean> };
const DEFECTS = ACCOMPANYING_DEFECTS as Record<string, Defect>;

test("a defect that declares probes only ever turns them ON", () => {
  // A UNION, never an override. A host that already probes must keep doing so — an accompanying defect
  // silently disabling one would take evidence away from the case it was added to.
  for (const [name, defect] of Object.entries(DEFECTS)) {
    for (const [probe, value] of Object.entries(defect.probes ?? {})) {
      assert.equal(value, true,
        `${name} declares ${probe}: ${value}. A defect may add a probe and never remove one.`);
    }
  }
});

test("NO accompanying defect can turn probeForms on", () => {
  // `probeForms` makes this tool PRESS BUTTONS. That is a decision for the case author — the same line
  // `chooseProbe` draws for the CLI, where pressing *Book* on a stranger's site is not a review — and it
  // must not become a side effect of a pairing. Asserted rather than left to reviewer memory.
  const offenders = Object.entries(DEFECTS)
    .filter(([, defect]) => defect.probes && "probeForms" in defect.probes)
    .map(([name]) => name);
  assert.deepEqual(offenders, [],
    `${offenders.join(", ")} would activate form submission because of a LABEL, not because the case `
    + "author asked for it");
});

test("the table defect declares the probe its rule-side evidence needs", () => {
  // The concrete case §19 records. Its `grants` feature reads the transcript and is fine without a probe;
  // a RULE would read `structure.tableCells`, which only `probeTables` fills.
  assert.deepEqual(DEFECTS["position-only-table"]?.probes, { probeTables: true });
});

test("every defect whose evidence lives in an opt-in channel declares its probe", () => {
  // The SHAPE, not a list. `tableCells` is the only sweep behind an opt-in probe today, so a defect whose
  // markup contains a <table> and whose subtypes name 1.3.1 needs `probeTables` — and a second such
  // channel arriving later is caught by the same rule rather than by someone remembering this entry.
  const offenders: string[] = [];
  for (const [name, defect] of Object.entries(DEFECTS)) {
    const markup = JSON.stringify((defect as { markup?: string[] }).markup ?? []);
    if (!/<table[\s>]/i.test(markup)) continue;
    if (defect.probes?.probeTables !== true) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(", ")} inject a <table> whose cells nothing will capture, so the label arrives `
    + "without the evidence");
});
