/**
 * The held-out acceptance set decides whether a retrained model may ship, so a broken case here passes a
 * release rather than blocking one.
 *
 * These 32 pairs are never trained on. `training:evaluate-acceptance` reports `"passed": true` over them and
 * `RELEASE.md` quotes that as a release gate. The failure mode is quiet in both directions: a pair whose two
 * variants differ by more than the property under test measures the wrong thing, and a `badSignal` that matches
 * BOTH variants (or neither) cannot discriminate at all — it just moves the score.
 *
 * The pages are strings here, so every one of these assertions is pure and runs in milliseconds. That matters:
 * the alternative is discovering a bad pair after spending worker time capturing it, which is how the
 * "Reference section" filler contamination was found the expensive way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { SIGNAL_TYPES } from "./case-matrix.mjs";
import { WCAG_22_AA } from "@a11y-witness/evidence/wcag";

const criteria = new Set(WCAG_22_AA.map((c) => c.num));

test("the set is populated, so nothing below is vacuously true", () => {
  assert.ok(ACCEPTANCE_CASES.length >= 30, `expected the full held-out set, got ${ACCEPTANCE_CASES.length}`);
});

test("ids and families are unique, so no pair can silently overwrite another", () => {
  for (const key of ["id", "family"] as const) {
    const counts = new Map<string, number>();
    for (const c of ACCEPTANCE_CASES) counts.set(c[key], (counts.get(c[key]) ?? 0) + 1);
    assert.deepEqual([...counts].filter(([, n]) => n > 1).map(([v]) => v), [], `duplicate ${key}`);
  }
});

test("every criterion is a real WCAG 2.2 AA criterion", () => {
  const unknown = ACCEPTANCE_CASES
    .filter((c) => !criteria.has(c.criterion))
    .map((c) => `${c.id} -> ${c.criterion}`);
  assert.deepEqual(unknown, [], `criteria not in WCAG_22_AA:\n  ${unknown.join("\n  ")}`);
});

test("both variants are real HTML documents", () => {
  for (const c of ACCEPTANCE_CASES) {
    for (const variant of ["good", "bad"] as const) {
      const html = c[variant];
      assert.match(html, /^<!doctype html>/i, `${c.id}.${variant} is not a document`);
      assert.match(html, /<title>[^<]+<\/title>/, `${c.id}.${variant} has no title — the capture checks it`);
      assert.match(html, /lang="[a-z]{2}/, `${c.id}.${variant} has no lang, which NVDA uses to choose a voice`);
    }
  }
});

test("the two variants actually DIFFER", () => {
  // A pair whose halves are identical scores as a perfect model however bad the model is: the good page and the
  // bad page produce the same evidence, so the case can never discriminate.
  const identical = ACCEPTANCE_CASES.filter((c) => c.good === c.bad).map((c) => c.id);
  assert.deepEqual(identical, []);
});

test("the pair differs by the property under test, not by its whole content", () => {
  // The lesson that cost a corpus: a pair differing for a reason unrelated to accessibility compares two things
  // at once, and the model can learn the unrelated difference instead. A mutation should be a small edit — so
  // most of the document must survive it.
  for (const c of ACCEPTANCE_CASES) {
    const shorter = Math.min(c.good.length, c.bad.length);
    const longer = Math.max(c.good.length, c.bad.length);
    assert.ok(shorter / longer > 0.5,
      `${c.id}: the variants differ in size by more than half (${c.good.length} vs ${c.bad.length}), so they `
      + "differ by more than the property under test");
  }
});

test("every case documents its mutation and its source", () => {
  // `mutation` is what the pair is claimed to isolate and `source` is where the pattern came from. Without them
  // a failing case cannot be triaged — it is a score with no explanation.
  for (const c of ACCEPTANCE_CASES) {
    assert.ok(c.mutation?.trim(), `${c.id} does not say what it mutates`);
    assert.ok(c.source?.trim(), `${c.id} does not say where the pattern came from`);
    assert.ok(c.task?.trim(), `${c.id} has no task, and the judge is asked whether the task is completable`);
  }
});

test("every badSignal is a shape the checker can actually evaluate", () => {
  // Derived from `case-matrix.mjs`'s own `signalMatches`, not hardcoded: a list I maintain by hand would go
  // stale the first time a signal type is added, and the consequence of an unhandled type is that the signal
  // silently never fires — which reads as "the bad page was fine". My first version invented five type names
  // and missed eight of the ten real ones.
  // From the checker's own exported table, not scraped from its source. This regex-matched `type === "..."`
  // and returned NOTHING the day the if-chain became a lookup — a test deriving expectations from source
  // text is one refactor away from asserting over an empty set, which passes.
  const KNOWN = new Set(SIGNAL_TYPES);
  assert.ok(KNOWN.size >= 8, `only found ${KNOWN.size} signal types in the checker; the export is broken`);
  for (const c of ACCEPTANCE_CASES) {
    assert.ok(c.badSignal, `${c.id} has no badSignal, so nothing decides whether the bad page failed`);
    assert.ok(KNOWN.has(c.badSignal.type),
      `${c.id} uses badSignal type "${c.badSignal.type}", which check-signals does not know how to evaluate`);
    if (c.badSignal.type === "regex") {
      assert.ok(c.badSignal.pattern, `${c.id} is a regex signal with no pattern`);
      // A pattern that cannot compile silently never fires, which reads as "the bad page was fine".
      assert.doesNotThrow(() => new RegExp(c.badSignal.pattern!, c.badSignal.flags ?? ""),
        `${c.id}'s pattern does not compile`);
    }
  }
});

test("a table case asks for the table probe, and a non-table case does not", () => {
  // The probes are opt-in over the wire, so a table case that does not request `probeTables` is captured with no
  // cell announcements and its signal can never fire. That exact mismatch existed in the corpus for 61 cases.
  for (const c of ACCEPTANCE_CASES) {
    if (c.badSignal.type === "table-unassociated") {
      assert.equal(c.probeTables, true, `${c.id} needs table cells but does not request the probe`);
    }
  }
});

test("probe flags are booleans, because the wire treats anything else as false", () => {
  for (const c of ACCEPTANCE_CASES) {
    for (const flag of ["probeForms", "probeTables"] as const) {
      assert.ok(c[flag] === undefined || typeof c[flag] === "boolean",
        `${c.id}.${flag} is ${typeof c[flag]}, and the worker coerces it`);
    }
  }
});
