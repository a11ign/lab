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

import { ACCEPTANCE_CASES, ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { CASES, SIGNAL_TYPES } from "./case-matrix.mjs";
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

test("held-out acceptance can express a MULTI-DEFECT page, or it cannot fail on one", () => {
  // Measured 2026-08-23: the `varied` candidate scored 58 TP / 0 FP / 0 FN on acceptance — a perfect pass
  // — while its own development figures showed `3.3.2:placeholder-only` at precision 0.244. Acceptance
  // could not see the difference because 0 of its 35 cases had more than one defect, and multi-defect
  // pages are exactly where the heads struggle. A gate that cannot represent the hard case cannot fail
  // on it, which is ADR 0015's own lesson landing on the gate that judges ADR 0015's fix.
  const multi = ALL_ACCEPTANCE_CASES.filter((c) => (c.alsoFails ?? []).length > 0);
  assert.ok(multi.length >= 5, `only ${multi.length} multi-defect acceptance cases`);
  const hosts = new Set(multi.map((c) => `${c.criterion}:${c.subtype}`));
  assert.ok(hosts.has("3.3.2:placeholder-only"),
    "the head that actually fails on multi-defect pages must be covered, or this set repeats the omission");
});

test("a multi-defect acceptance case never claims its own subtype twice", () => {
  for (const c of ALL_ACCEPTANCE_CASES) {
    assert.ok(!(c.alsoFails ?? []).includes(`${c.criterion}:${c.subtype}`),
      `${c.id} lists its own subtype in alsoFails, which double-counts one failure`);
  }
});

test("every case carries the metadata that makes it REVIEWABLE", () => {
  // `preflight` requires task, source and mutation on every case, and four families never had them —
  // route-title-stale, focus-order-tabindex, skip-link-broken, keyboard-unreachable-action — so 21 cases
  // failed it for as long as those criteria have existed. Measured 2026-08-26: 46 preflight failures,
  // identical on the previous commit, so nothing about the furniture change caused them.
  //
  // Asserted HERE as well as in preflight because preflight needs generated pages on disk and this needs
  // nothing: a case added without its metadata fails in a second rather than after a generate.
  //
  // The fields are not bookkeeping. "What was the user doing", "where does this failure come from" and
  // "what exactly was changed" are what let somebody check a label rather than trust it, and a corpus of
  // labels nobody can check is the thing this project measures everything against.
  const incomplete: string[] = [];
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    const missing = ["task", "source", "mutation"].filter((field) => !testCase[field]);
    if (missing.length) incomplete.push(`${testCase.id} (no ${missing.join(", ")})`);
  }
  assert.deepEqual(incomplete, [],
    "these cases cannot be reviewed: a label with no task, source or mutation is a claim with no way to "
    + "check it. `npm run training:preflight` refuses them too, but only after generating 1401 pages.");
});

/**
 * WHICH CORPUS SUBTYPES THE HELD-OUT SET CAN ACTUALLY MEASURE — pinned, because nothing compared them.
 *
 * `CLAUDE.md` names this exact shape: "acceptance-matrix.mjs declares subtypes BY HAND, separate from the
 * corpus, with nothing comparing them — the cause of two identical pipeline failures". Both halves are
 * hand-maintained lists of the same fact, which is this repo's most expensive recurring defect, and the
 * remedy it prescribes when a duplication is forced is to pin them equal with a test.
 *
 * They cannot simply BE equal: acceptance pairs are written by hand and deliberately never trained on, so
 * the set grows more slowly than the corpus. What must not happen is a subtype quietly acquiring no
 * held-out coverage — because `training:evaluate-acceptance` then reports `passed: true` having never
 * examined that head, and `RELEASE.md` quotes it as a gate. A gate that does not exercise what ships is
 * not a gate, for the fifth time in this repo.
 *
 * So the list below is a LEDGER OF WHAT IS UNMEASURED, not a set of justified exemptions. Measured
 * 2026-09-05: 8 of 25 corpus subtypes have no acceptance pair at all, and among them are the two whose
 * mapping was downgraded that same day (3.2.1, 3.2.2) — heads whose behaviour changed and which the
 * held-out set cannot see. Adding a subtype without an acceptance pair now costs one deliberate line here
 * rather than passing silently.
 */
const SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE = new Set<string>([
  // Each of these is a REAL GAP in held-out measurement. None is a decision that it does not need one.
  //
  // WAS EIGHT, NOW THREE. The other three were closed on 2026-09-05 once the cause was found: `pair()` here
  // enumerated `probeForms` and `probeTables` and dropped every other probe flag, so seven of the eight
  // were not unwritten but INEXPRESSIBLE — a gate that cannot represent a case cannot fail on it. The
  // remaining five need pages with real navigation or focus traps and are ordinary work, not blocked.
  "2.1.2:focus-trapped",
  "2.4.1:skip-link-inert",
  "2.4.2:route-title-stale",
]);

const subtypeKey = (c: { criterion?: string; subtype?: string }) =>
  `${c.criterion ?? "?"}:${c.subtype ?? "(default)"}`;

test("no corpus subtype loses held-out coverage without someone deciding to let it", () => {
  const covered = new Set<string>(ALL_ACCEPTANCE_CASES.map(subtypeKey));
  const uncovered = [...new Set<string>(CASES.map(subtypeKey))].filter((k) => !covered.has(k)).sort();

  const surprises = uncovered.filter((k) => !SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE.has(k));
  assert.deepEqual(surprises, [],
    `these corpus subtypes have no acceptance pair and are not on the ledger, so `
    + `training:evaluate-acceptance would report passed:true having never examined them: ${surprises.join(", ")}. `
    + `Add an acceptance pair, or add the subtype to SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE with the reason.`);

  // BOTH DIRECTIONS, for the reason `evidence-fields.test.ts` gives: an entry on the list that is no
  // longer uncovered is a phantom, and a ledger nobody prunes stops describing anything.
  const stale = [...SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE].filter((k) => covered.has(k)).sort();
  assert.deepEqual(stale, [],
    `these subtypes now HAVE acceptance coverage and should come off the ledger: ${stale.join(", ")}`);
});

test("every acceptance subtype exists in the corpus, so none measures a head that is not trained", () => {
  // The other direction, and it fails differently: an acceptance pair for a subtype the corpus does not
  // produce scores a head with no training positives, which reads as a model defect rather than a
  // bookkeeping one. Empty today and asserted so it stays that way.
  const inCorpus = new Set<string>(CASES.map(subtypeKey));
  const orphans = [...new Set<string>(ALL_ACCEPTANCE_CASES.map(subtypeKey))].filter((k) => !inCorpus.has(k)).sort();
  assert.deepEqual(orphans, [],
    `acceptance pairs exist for subtypes the corpus never produces: ${orphans.join(", ")}`);
});
