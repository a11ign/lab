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

// @ts-expect-error -- .mjs helper, no declarations
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
