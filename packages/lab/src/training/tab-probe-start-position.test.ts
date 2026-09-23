/**
 * #2053 (#1865's authoring half): THE CORPUS EXERCISES MORE THAN ONE TRIGGER DEPTH.
 *
 * `packages/nvda-worker/src/tab-probe-start-position.test.ts` — the same name, deliberately, one package
 * over — guards the OTHER half of this claim: that `probeFocusReveal` calls `resetFocusToDocumentStart`
 * before `walkToReveal`, so the walk STARTS at document start. Neither file is enough alone. A walk that
 * provably starts at zero and is only ever asked to find a panel one Tab later has not been shown to find
 * a panel anywhere else, and no test that reads the probe's source can show it: the evidence is in the
 * CORPUS, which is why this half lives here and reads `CASES`.
 *
 * Until 2026-09-22 every `focus-panel-*` case laid its three controls out as `first`, `trigger`, `last` —
 * the trigger second on all fifteen, `probeOrder: "focus-first"` the only value in the matrix. So the
 * probe's firings demonstrated that the corpus was uniform, not that the probe worked.
 * `focus-panel-undismissable-help+first-tab-stop` broke that, and this file is what keeps it broken.
 *
 * DERIVED FROM THE CASE DEFINITIONS, NEVER PINNED. A test that asserted "there is a case at distance 0"
 * would pass forever from the day it was written and stop measuring uniformity, which is the defect this
 * row exists to fix rather than to re-create one level up. Every number below comes out of the matrix.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CASES } from "./case-matrix.mjs";

/** The fields of a generated case this file reads. `case-matrix.mjs` is JS, so `CASES` arrives untyped. */
interface GeneratedCase {
  id: string;
  good: string;
  bad: string;
  probeFocusReveal?: boolean;
}

/**
 * Anything NVDA's Tab walk stops on. `hidden`-attribute inputs are not excluded: the panel's own contents
 * start hidden and sit AFTER the trigger, so they cannot affect a count taken before it, and excluding by
 * attribute would need this regex to understand which ancestor carries `hidden` — which it cannot.
 */
const FOCUSABLE = /<(?:a\b[^>]*\shref=|button\b|select\b|textarea\b|input\b(?![^>]*\stype=["']hidden["']))/gi;

/** The corpus's own name for the control that reveals the panel. */
const TRIGGER = 'id="trigger"';

/**
 * How many Tab stops stand between document start and the panel trigger, read off the rendered page.
 *
 * Returns `null` when the page names no trigger, so a case that stopped using the convention reads as
 * UNMEASURABLE rather than as distance 0 — "we could not tell" and "it is first" are different facts, and
 * the second is the one that would quietly satisfy this file's whole point.
 */
function triggerDistance(html: string): number | null {
  const at = html.indexOf(TRIGGER);
  if (at < 0) return null;
  const openingTag = html.lastIndexOf("<", at);
  return (html.slice(0, openingTag).match(FOCUSABLE) ?? []).length;
}

/** Every case whose capture drives `probeFocusReveal` — the population this claim is about. */
function focusRevealCases(): GeneratedCase[] {
  return (CASES as unknown as GeneratedCase[]).filter((c) => c.probeFocusReveal === true);
}

/** The distinct trigger distances a population exercises, ignoring cases that name no trigger. */
function distinctDistances(cases: GeneratedCase[]): number[] {
  const distances = cases.map((c) => triggerDistance(c.bad)).filter((d): d is number => d !== null);
  return [...new Set(distances)].sort((a, b) => a - b);
}

// Guard the guard. Every assertion below is over a filtered population, and a filter that stops matching
// makes all of them vacuous while the file still reads as "testing the corpus". Four is the floor the
// three original siblings plus the one outlier put on it; it is not a target.
const MINIMUM_POPULATION = 4;

test("#2053: the focus-reveal population is real, so nothing below passes over an empty set", () => {
  const cases = focusRevealCases();
  assert.ok(cases.length >= MINIMUM_POPULATION,
    `only ${cases.length} case(s) in CASES carry probeFocusReveal; the filter is broken and every check `
    + "in this file would pass having examined nothing");
});

test("#2053: every focus-reveal case names its trigger, so none is silently unmeasurable", () => {
  const unmeasurable = focusRevealCases()
    .filter((c) => triggerDistance(c.bad) === null || triggerDistance(c.good) === null)
    .map((c) => c.id);
  assert.deepEqual(unmeasurable, [],
    `${unmeasurable.length} focus-reveal case(s) contain no ${TRIGGER}, so this file cannot say how many `
    + "Tabs reach their panel and quietly stops covering them. Keep the convention, or teach "
    + `triggerDistance the new one — do not let the case drop out of the population:\n  `
    + unmeasurable.join("\n  "));
});

test("#2053: a pair's two variants put the trigger at the SAME depth", () => {
  const mismatched = focusRevealCases()
    .filter((c) => triggerDistance(c.good) !== triggerDistance(c.bad))
    .map((c) => `${c.id} (good ${triggerDistance(c.good)}, bad ${triggerDistance(c.bad)})`);
  assert.deepEqual(mismatched, [],
    `${mismatched.length} pair(s) move the trigger between their good and bad variant. That is a second `
    + "difference inside a controlled comparison: the pair would then be measuring tab depth as well as "
    + `the dismissal mechanism, and nothing in the label says so:\n  ` + mismatched.join("\n  "));
});

test("#2053: the corpus exercises more than one trigger depth", () => {
  const distances = distinctDistances(focusRevealCases());
  assert.ok(distances.length >= 2,
    `every focus-reveal case reaches its trigger after the same ${distances[0]} preceding control(s). `
    + "The probe's firings then demonstrate that the corpus is UNIFORM, not that the walk finds a panel "
    + "wherever it sits — the claim #1865 carries and #1205's source-level guard explicitly cannot make. "
    + "Add a case at another depth; do not relax this number.");
});

/**
 * THE POSITIVE CONTROL, and it lives here rather than in a paragraph.
 *
 * `assert.ok(distances.length >= 2)` above is an emptiness-shaped assertion over a population nobody
 * varied for months, so `.claude/rules/agent-practices.md` requires somewhere that proves it can fail.
 * The row's own wording for that control is "with the new case removed, the distinct-distance assertion
 * must FAIL" — this runs it, every time, rather than asking a reader to delete a case and believe the
 * result. `distinctDistances` is the same function the test above calls, not a re-implementation.
 */
test("#2053: the distinct-depth check FAILS on a uniform population — its own positive control", () => {
  const cases = focusRevealCases();
  const shallowest = distinctDistances(cases)[0];
  const uniform = cases.filter((c) => triggerDistance(c.bad) === shallowest);
  assert.ok(uniform.length >= 2, "the control needs at least two cases at one depth to be a population");
  assert.equal(distinctDistances(uniform).length, 1,
    "with every case at one depth the check must report a single distance. If it does not, the check "
    + "above cannot fail either, and it has been passing without measuring anything");
});
