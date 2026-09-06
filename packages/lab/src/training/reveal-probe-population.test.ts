/**
 * NO CORPUS CASE MAY SET `probeFocusReveal` ALONGSIDE `probeFocusContext` OR `probeNavigation`.
 *
 * This test exists because a DECISION rests on the fact, and the fact would otherwise expire in silence.
 *
 * On 2026-09-06 `focusRevealVerdict` gained `baselineUntouched`: an empty census growth now reads `null`
 * rather than `false` when a control held focus from an earlier probe, because `probeFocusContext` presses
 * Tab and opens a panel revealed on focus, and only a CONFORMANT page's Escape closes it again before the
 * baseline census (issue #76 — the property that makes a page fail 1.4.13 is the property that stopped the
 * probe seeing it).
 *
 * That changes `interaction.focusReveal` on affected captures, which raises the question of a
 * `CAPTURE_PROTOCOL_VERSION` bump — a bump invalidating 3,304 protocol-16 captures.
 *
 * THE ARGUMENT FOR NO BUMP IS A POPULATION ARGUMENT, and `dispatcher` corrected a weaker one to get to it.
 * I claimed the dataset path "runs neither probe"; `capture-screenreader-dataset.mjs` supports both
 * per-case, so that was a claim about the DEFAULTS wearing a claim about the path. The true and stronger
 * statement is that **no case sets them together**, so the affected population exists only on the
 * real-page and product paths, which never cache by construction.
 *
 * A comment cannot hold that. The day someone adds a case setting both, its captures are cached under a
 * verdict that can no longer be trusted, every gate stays green, and the bump becomes real without anyone
 * deciding it — which is this repo's whole defect catalogue in one sentence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CASES } from "./case-matrix.mjs";

type Case = { id: string; probeFocusReveal?: boolean; probeFocusContext?: boolean; probeNavigation?: boolean };
const cases = CASES as Case[];

const withReveal = cases.filter((c) => c.probeFocusReveal);
const withContext = cases.filter((c) => c.probeFocusContext);
const withNavigation = cases.filter((c) => c.probeNavigation);

test("VACUITY GUARD -- all three probe populations are non-empty, or this test examines nothing", () => {
  // Measured 2026-09-06: 15 / 28 / 51. Floors, not pins, because these families grow. Zero in any of them
  // means the flags were renamed and this passes having compared empty sets against each other -- the
  // always-passing-guard shape this repo closed as a class.
  assert.ok(withReveal.length >= 3, `probeFocusReveal cases: ${withReveal.length}, expected at least 3`);
  assert.ok(withContext.length >= 3, `probeFocusContext cases: ${withContext.length}, expected at least 3`);
  assert.ok(withNavigation.length >= 3, `probeNavigation cases: ${withNavigation.length}, expected at least 3`);
});

test("no case sets probeFocusReveal alongside a probe that walks the tab ring first", () => {
  const both = withReveal.filter((c) => c.probeFocusContext || c.probeNavigation);
  assert.deepEqual(both.map((c) => c.id), [],
    "These cases set `probeFocusReveal` together with `probeFocusContext` or `probeNavigation`, and that "
    + "combination is what made `focusRevealVerdict` return `revealed: null` instead of `false` (#76). "
    + "The corpus CACHES, so such a case would be stored under a verdict whose meaning changed — which is "
    + "the exact thing `CAPTURE_PROTOCOL_VERSION` exists to prevent, arriving without anyone bumping it.\n"
    + "Do not delete this assertion to make a case pass. Either give the case a probe set that keeps its "
    + "baseline untouched, or bump the protocol deliberately and pay for the recapture — 3,304 captures at "
    + "protocol 16 as of 2026-09-06. See issue #76 for the fix that would remove the constraint entirely.");
});

test("the reveal cases are the 1.4.13 family, so the constraint is on the population it was argued about", () => {
  // Guards against the assertion above staying green because `probeFocusReveal` migrated to some unrelated
  // family while the 1.4.13 cases quietly gained a context probe. The names are the link between the
  // decision and the data it was made from.
  assert.ok(withReveal.every((c) => c.id.startsWith("focus-panel-undismissable")),
    `probeFocusReveal is set on cases outside the focus-panel-undismissable family: `
    + `${withReveal.filter((c) => !c.id.startsWith("focus-panel-undismissable")).map((c) => c.id).join(", ")}`);
});
