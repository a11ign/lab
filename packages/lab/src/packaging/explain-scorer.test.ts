/**
 * The diagnostic that reports a model comparison must put FALSE ALARMS first.
 *
 * Written after ranking two models on total errors and calling the worse one an improvement: 8 false
 * accusations read as better than 12 misses because 8 < 12. They are not comparable. A false positive is
 * an accusation someone may budget against or be challenged over; a miss is a gap. The tool that presents
 * the numbers is where that asymmetry has to live, because it is the moment a human forms a judgement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compareTable, criterionDetail } from "../../scripts/explain-scorer.mjs";

const report = (criteria: Record<string, Partial<Record<string, unknown>>>) => ({
  criteria: Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, {
    modelEvaluated: true, truePositive: 0, falsePositive: 0, falseNegative: 0,
    records: 160, positive: 10, clean: 150, decisionOwner: "learned-screenreader-scorer", ...v,
  }])),
});

test("a model with false alarms is called NOT SHIPPABLE, however few total errors it has", () => {
  const misses = report({ "2.4.4": { truePositive: 4, falseNegative: 12 } });
  const alarms = report({ "3.3.2": { truePositive: 14, falsePositive: 8 } });
  const out = compareTable([["misses-only", misses], ["alarms-only", alarms]]).join("\n");

  assert.match(out, /misses-only\s+false alarms=0\s+misses=12\s+no false accusations/);
  assert.match(out, /alarms-only\s+false alarms=8\s+misses=0\s+NOT SHIPPABLE/,
    "8 false accusations must not read as better than 12 misses just because 8 is the smaller number");
});

test("false alarms are printed before misses, because that is the order they matter in", () => {
  const out = compareTable([["m", report({ "3.3.2": { falsePositive: 3, falseNegative: 9 } })]]).join("\n");
  assert.ok(out.indexOf("false alarms") < out.indexOf("misses"));
});

test("a failing criterion NAMES its cases rather than counting them", () => {
  // "2 false negatives" is where an investigation stops. The names are where it starts — and it took a
  // hand-written script to get them, five times in one day.
  const detail = criterionDetail(report({
    "2.4.4": {
      truePositive: 10, falsePositive: 1, falseNegative: 2,
      falsePositiveCases: ["case-a/good"], falseNegativeCases: ["case-b/bad", "case-c/bad"],
      subtypeThresholds: { "2.4.4:regex": 0.5 },
    },
  }), "2.4.4").join("\n");
  assert.match(detail, /FALSE ALARM\s+case-a\/good/);
  assert.match(detail, /MISS\s+case-b\/bad/);
  assert.match(detail, /thresholds=.*2\.4\.4:regex/, "the cut that decided it must be visible");
});

test("a clean criterion says so, instead of printing an empty list", () => {
  // Absent and clean must not look alike — the rule this whole codebase keeps relearning.
  assert.match(criterionDetail(report({ "1.1.1": { truePositive: 6 } }), "1.1.1").join("\n"),
    /nothing wrong on this criterion/);
});

test("a rule-decided criterion says who owns it rather than reporting model numbers", () => {
  const out = criterionDetail({ criteria: { "4.1.2": { modelEvaluated: false, decisionOwner: "deterministic-rules" } } },
    "4.1.2").join("\n");
  assert.match(out, /not model-evaluated/);
  assert.match(out, /deterministic-rules/);
});

test("a miss the RAISE refused is annotated, and a miss the head lost is not", () => {
  // Two misses on one criterion, printed as one line each. Without the annotation they are the same
  // line and a reader has no way to tell them apart — which is how #2152's two cases came to be given
  // opposite diagnoses: 0.0031 under the cut was called threshold variance, 0.0197 under "not a
  // threshold-variance candidate at all". Both had cleared the head's own Neyman-Pearson floor.
  const detail = criterionDetail(report({
    "4.1.3": {
      truePositive: 14, falseNegative: 2,
      falseNegativeCases: ["b3-status-taxi/bad", "b3-fake-miss/bad"],
      subtypeThresholds: { "4.1.3:form-activation-silent": 0.9639 },
      subtypeThresholdFloors: { "4.1.3:form-activation-silent": 0.9344 },
      falseNegativesAboveFloor: { "b3-status-taxi/bad": ["4.1.3:form-activation-silent"] },
    },
  }), "4.1.3").join("\n");

  const [raised, lost] = detail.split("\n").filter((l) => l.includes("MISS"));
  assert.match(raised, /b3-status-taxi\/bad.*above the NP floor.*form-activation-silent.*raise refused it/,
    "a miss inside [floor, cut) must say the raise refused it, not the head");
  assert.doesNotMatch(lost, /NP floor/,
    "a head that genuinely lost the case must not be excused by the same line");
});

test("a report written before the floors were recorded prints an unannotated miss, not a claim", () => {
  // Absent and clean must not look alike, and neither must absent and 'the head lost it'.
  const detail = criterionDetail(report({
    "4.1.3": { falseNegative: 1, falseNegativeCases: ["b3-status-taxi/bad"] },
  }), "4.1.3").join("\n");
  assert.match(detail, /MISS\s+b3-status-taxi\/bad\s*$/m);
});

test("a FALSE ALARM is never annotated with a floor, whatever the miss list says about that id", () => {
  // The annotation answers "which side of its own cut did this score land", and a false alarm fired —
  // no cut refused it. Keyed off the list being walked, not off the two lists never sharing an id.
  const detail = criterionDetail(report({
    "4.1.3": {
      falsePositive: 1, falsePositiveCases: ["shared-id"],
      falseNegative: 1, falseNegativeCases: ["shared-id"],
      falseNegativesAboveFloor: { "shared-id": ["4.1.3:form-activation-silent"] },
    },
  }), "4.1.3");

  assert.match(detail.find((l) => l.includes("FALSE ALARM")) ?? "", /shared-id\s*$/);
  assert.match(detail.find((l) => l.includes("MISS")) ?? "", /the raise refused it/);
});
