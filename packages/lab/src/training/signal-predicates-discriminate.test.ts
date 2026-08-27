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
  "state-change-silent": "reads interaction.stateChanges, which only an activation produces",
  "form-activation-silent": "reads interaction.formChanges, which only a submit produces",
  "validation-error-silent": "reads interaction.postSubmitFields, which only a submit produces",
  "placeholder-only": "reads the announcement grammar's parse of a field, not a plain field",
  "table-unassociated": "reads structure.tableCells, which only probeTables produces",
  "missing-role": "reads the announcement grammar, so a fixture asserts my model of NVDA not NVDA",
  "focus-trapped": "reads the focusOrder probe's diagnostic mark, which only a capture writes",
  "focus-order-scrambled": "compares two captured channels, so a fixture would compare my own two guesses",
  "control-unreachable-by-keyboard": "same — needs both formFields and a closed focusOrder cycle",
  "route-title-stale": "reads a title across a navigation, which is a transition and not a state",
  "skip-link-inert": "reads whether focus MOVED, which only the probe can answer",
};

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
    const covered = type in DISCRIMINATES || type in NO_FIXTURE;
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
  for (const type of [...Object.keys(DISCRIMINATES), ...Object.keys(NO_FIXTURE)]) {
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
