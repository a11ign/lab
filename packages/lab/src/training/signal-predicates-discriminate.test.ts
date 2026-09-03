/**
 * Every signal type must be able to BOTH fire and stay silent — proved on hand-built captures.
 *
 * Proves half of the gate `training:check-signals:complete`. The other half — that each real case's
 * CAPTURED evidence discriminates — needs the corpus and is declared unproven in
 * `gates-are-proven.test.ts`, because an unstated gap reads as covered.
 *
 * ## The incident
 *
 * `check-signals` proves each case's `badSignal` fires on its bad page and stays silent on its good one.
 * CLAUDE.md records what happens when the layer beneath it moves: *"8 cases once went silently blind when
 * a probe changed"*. A predicate that can no longer fire makes every case using it BLIND; one that always
 * fires makes them CONTAMINATED. Neither shows up as an error — it shows up as a corpus that quietly
 * stops discriminating.
 *
 * The blast radius is not evenly spread, measured today:
 *
 *     517  regex                     143  validation-error-silent
 *     143  form-activation-silent    133  unnamed-form-field
 *     111  structure-empty            92  missing-role
 *
 * A dead `regex` predicate blinds 517 cases at once.
 *
 * ## Why this needs no corpus, contrary to what the register said
 *
 * `signalMatches` is pure — a capture in, a boolean out — so the premise that proving anything about
 * `check-signals` "needs runs/" is false for the DECISION. Four one-line predicates over plain fields.
 * That premise has now been wrong six times running; see `docs/proving-a-gate.md`.
 *
 * What genuinely needs the corpus is the GATE's other half: that each real case's captured evidence
 * discriminates. That stays unproven here and is declared so in `gates-are-proven.test.ts`, because an
 * unstated gap reads as covered.
 *
 * ## The discovery half is the half that lasts
 *
 * Fixtures rot by omission: a new signal type gets added, nobody writes a fixture, and this file goes on
 * passing while covering less of the surface. So the test DISCOVERS every type from `SIGNAL_TYPES` and
 * requires each to be exercised here or exempted with a reason — the same shape as `cli-flags.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, SIGNAL_TYPES, signalMatches } from "./case-matrix.mjs";
import REAL_EVIDENCE from "./fixtures/signal-evidence.json" with { type: "json" };

/**
 * Per signal type: a signal, a capture that MUST trip it, and one that must not.
 *
 * Minimal on purpose. A fixture carrying more than the predicate reads is a fixture that can pass for the
 * wrong reason, which is how a proof comes to vouch for something it never exercised.
 */
const DISCRIMINATES: Record<string, { signal: object; fires: object; silent: object }> = {
  regex: {
    signal: { type: "regex", pattern: "click here" },
    fires: { transcript: ["Click here, link"] },
    silent: { transcript: ["Read the accessibility guide, link"] },
  },
  "structure-empty": {
    signal: { type: "structure-empty", field: "headings" },
    fires: { structure: { headings: [] } },
    silent: { structure: { headings: ["heading, level 1, Delivery details"] } },
  },
  "unnamed-form-field": {
    signal: { type: "unnamed-form-field" },
    // A field announced as its ROLE alone is one a screen-reader user cannot identify.
    fires: { structure: { formFields: ["edit"] } },
    silent: { structure: { formFields: ["Full name, edit"] } },
  },
  "language-unmarked": {
    signal: { type: "language-unmarked", language: "French" },
    // FIRES ON SILENCE, which is what makes 3.1.2 a screen-reader question at all. The passage is read
    // either way; what the BAD page omits is any announcement that the language changed. NVDA speaks the
    // language NAME when `[speech] reportLanguage` is on, so its absence from the transcript IS the
    // finding — and the markup, which a static analyser reads, never enters into it.
    fires: { transcript: ["The archive holds a first edition, and its dedication reads:",
      "Le silence eternel de ces espaces infinis m'effraie."] },
    silent: { transcript: ["The archive holds a first edition, and its dedication reads:",
      "French", "Le silence eternel de ces espaces infinis m'effraie."] },
  },
  "missing-heading": {
    signal: { type: "missing-heading", text: "Results" },
    fires: { structure: { headings: ["heading, level 1, Home"] } },
    silent: { structure: { headings: ["heading, level 2, Results"] } },
  },
};

/**
 * Types with no fixture here, and why. A reason, never a blank.
 *
 * Every one of these reads a field only a real capture produces — an interaction delta, a focus-probe
 * mark, a table sweep. A hand-built fixture for them would be asserting my model of the probe rather than
 * the probe, which is worse than an admitted gap: it would read as coverage.
 */
const NO_FIXTURE: Record<string, string> = {
  // RE-OPENED 2026-09-01 for one type, on the exact reason this list was emptied for the other five, and
  // it must close the same way they did: by capturing, not by relaxing the bar.
  //
  // `probeArrows` ships in source and has never run — the fleet is mid-recapture and deploying would
  // destroy unresumable work. So no capture on disk carries `interaction.arrowNavigation`, and a
  // hand-built fixture here would be MY MODEL of what NVDA announces when an arrow moves inside a radio
  // group rather than what it announces. This session has been wrong three times about exactly that kind
  // of claim — the dialog probe took three captures, and each correction was something no amount of
  // reading NVDA's source would have produced.
  //
  // The predicate itself IS unit-tested in `case-matrix.test.ts` against its four states. What is missing
  // is evidence that those states are the ones a real capture produces, which only a capture can supply.
  // Same reason, same closure condition: capture `validation-live-silent` once the fleet is free. What
  // NVDA speaks while characters are typed into a field -- how the echo interleaves with a live region's
  // announcement -- is exactly the kind of claim this session has been wrong about three times.
  "typed-feedback-silent":
    "probeTyping has never run: no capture carries typedFeedback, and guessing how NVDA's character echo "
    + "interleaves with a live region would be my model of the probe rather than the probe. Close by "
    + "capturing validation-live-silent once the fleet is free.",
  // EMPTY, and it stayed non-empty for the right reason until 2026-08-27.
  //
  // All five entries here were focus-probe types — `focus-trapped`, `focus-order-scrambled`,
  // `control-unreachable-by-keyboard`, `route-title-stale`, `skip-link-inert` — exempted because no
  // capture on disk carried `interaction.focusOrder` or the probe's mark for a case using them, and the
  // note said a hand-built fixture "would be my model of the probe rather than the probe". That was the
  // correct call: the gap was in the EVIDENCE, not the method.
  //
  // So the evidence was captured. Five cases, both variants, across the real fleet; all five then
  // discriminated, and the extraction below refuses any trim that changes either verdict. The exemption
  // is gone because the reason for it is, not because the bar moved.
};

/**
 * Evidence CUT FROM REAL CAPTURES, for the types a hand-built fixture cannot honestly express.
 *
 * Six of the eleven previously-exempt types read an interaction delta, a table sweep or the announcement
 * grammar — where writing a fixture by hand asserts my model of the probe rather than the probe, which is
 * worse than an admitted gap because it reads as coverage.
 *
 * So the fixture is extracted from captures NVDA actually produced, trimmed to the fields the predicate
 * reads, and COMMITTED — which is what lets this run in CI. A test needing `runs/` skips where the corpus
 * is absent, and a test that skips vouches for nothing. This is the SRE Workbook's stated fallback for
 * when synthetic testing is impossible: *"a running system that exports well-known metrics"*, frozen.
 *
 * The extraction asserted that trimming did not change either verdict, so what is stored still
 * discriminates for the same reason the full capture did.
 */
test("the types read from real evidence both fire and stay silent", () => {
  const covered = Object.keys(REAL_EVIDENCE);
  assert.ok(covered.length >= 12, `expected real evidence for twelve types, got ${covered.length}`);
  for (const [type, sample] of Object.entries(REAL_EVIDENCE as Record<string, {
    caseId: string; signal: { type: string }; fires: object; silent: object;
  }>)) {
    assert.equal(sample.signal.type, type, `${type}: the stored signal must be the one it claims to be`);
    assert.equal(signalMatches(sample.fires, sample.signal), true,
      `${type} did not fire on the BAD capture of ${sample.caseId} — every case using it is now BLIND`);
    assert.equal(signalMatches(sample.silent, sample.signal), false,
      `${type} fired on the GOOD capture of ${sample.caseId} — every case using it is CONTAMINATED, which `
      + "is the worse half: the signal appears to work and the pair proves nothing");
  }
});

test("every exercised predicate both fires and stays silent", () => {
  for (const [type, { signal, fires, silent }] of Object.entries(DISCRIMINATES)) {
    assert.equal(signalMatches(fires, signal), true,
      `${type} did not fire on a capture built to trip it — every case using it is now BLIND, and `
      + "check-signals would report them as not discriminating with no clue why");
    assert.equal(signalMatches(silent, signal), false,
      `${type} fired on a capture that should not trip it — every case using it is CONTAMINATED, which `
      + "is the worse half: the signal appears to work and the pair proves nothing");
  }
});

test("every signal type is either exercised or exempted with a reason", () => {
  for (const type of SIGNAL_TYPES) {
    const covered = type in DISCRIMINATES || type in NO_FIXTURE || type in REAL_EVIDENCE;
    assert.ok(covered,
      `signal type '${type}' is neither exercised nor exempted. A type nobody proved can go dead and take `
      + "every case using it with it, silently.");
    if (type in NO_FIXTURE) {
      assert.ok(NO_FIXTURE[type].length >= 30, `${type}: "${NO_FIXTURE[type]}" is not a reason`);
    }
  }
  // And nothing here names a type that no longer exists — a fixture for a deleted predicate is dead
  // weight that reads as coverage.
  const known = new Set(SIGNAL_TYPES);
  for (const type of [...Object.keys(DISCRIMINATES), ...Object.keys(NO_FIXTURE), ...Object.keys(REAL_EVIDENCE)]) {
    assert.ok(known.has(type), `'${type}' is exercised or exempted here but is not a signal type any more`);
  }
});

test("the exercised types are the ones with the largest blast radius", () => {
  // Coverage should follow consequence, not convenience. If a type with more cases than any exercised one
  // is sitting in NO_FIXTURE, that is worth knowing rather than discovering later.
  const perType: Record<string, number> = {};
  for (const testCase of CASES) {
    const type = (testCase as { badSignal?: { type?: string } }).badSignal?.type;
    if (type) perType[type] = (perType[type] ?? 0) + 1;
  }
  const biggest = Object.entries(perType).sort((a, b) => b[1] - a[1])[0];
  assert.ok(biggest[0] in DISCRIMINATES,
    `'${biggest[0]}' covers ${biggest[1]} cases — more than any other — and is not exercised here`);
});
