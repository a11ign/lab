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

/**
 * #2142 (#1926's offline authoring half): HOW DEEP THE WALK IS ASKED TO GO, which is not the same claim.
 *
 * `#2053: the corpus exercises more than one trigger depth` above measures VARIETY, and the mutation that
 * proves it is a different assertion is cheap to run: move this row's new trigger back to position 1 and
 * that test stays GREEN -- distances 0 and 1 are still two distinct values -- while both assertions below
 * go red. Variety at the shallow end says nothing about a walk bounded at `FOCUS_REVEAL_STOPS = 8`
 * (`packages/nvda-worker/src/capture-probes.mjs`), which until #2142 had been asked for stops 0 and 1 only.
 *
 * DERIVED, NEVER PINNED, on the same rule as the rest of this file: neither test below names a case. They
 * read the floor off `CASES` every run, so deleting the deep case fails them and renaming it does not.
 */

/**
 * Distinct depths the corpus must exercise. Three rather than two because two is already asserted above
 * and was already true of a corpus that only ever reached stop 1; this is the number that cannot be
 * satisfied without leaving the shallow end.
 */
const MINIMUM_DISTINCT_DEPTHS = 3;

/**
 * How far in the deepest trigger must sit. Five, with the walk bounded at 8, for the reason the case's own
 * comment gives: a trigger AT the bound cannot tell "the walk reached the last stop" from "the walk ran
 * out", so the deep case has to leave headroom or its `revealed: false` is unreadable. It is a FLOOR --
 * a deeper case satisfies it, and nothing here needs changing when one is added.
 */
const DEEPEST_REQUIRED_DISTANCE = 5;

/** The deepest trigger a population reaches, or `null` when nothing in it is measurable. */
function deepestDistance(cases: GeneratedCase[]): number | null {
  const distances = distinctDistances(cases);
  return distances.length === 0 ? null : distances[distances.length - 1];
}

test("#2142: the corpus exercises at least three distinct trigger depths", () => {
  const distances = distinctDistances(focusRevealCases());
  assert.ok(distances.length >= MINIMUM_DISTINCT_DEPTHS,
    `the focus-reveal corpus reaches its triggers from ${distances.length} distinct depth(s) `
    + `(${JSON.stringify(distances)}). Two of them are the shallow pair the corpus has always had; a walk `
    + "bounded at 8 stops needs to be asked for more than its first two. Add a case at another depth; do "
    + "not relax this number.");
});

test("#2142: the deepest trigger sits five stops in, with headroom inside the walk's bound", () => {
  const deepest = deepestDistance(focusRevealCases());
  assert.ok(deepest !== null && deepest >= DEEPEST_REQUIRED_DISTANCE,
    `the deepest focus-reveal trigger stands ${deepest} control(s) from document start. `
    + `FOCUS_REVEAL_STOPS bounds walkToReveal at 8, so a corpus that never asks past ${deepest} leaves `
    + "most of that budget justified by nothing. This is the assertion `#2053: the corpus exercises more "
    + "than one trigger depth` cannot make: it counts distinct values and a corpus at depths 0 and 1 "
    + "satisfies it forever.");
});

/** A `focus` listener registration this file can read the target of. */
const FOCUS_LISTENER_ON_ID = /getElementById\(\s*["']([^"']+)["']\s*\)\s*\.addEventListener\(\s*["']focus["']/g;

/** Any `focus` listener registration at all, however it names its element. */
const FOCUS_LISTENER = /addEventListener\(\s*["']focus["']/g;

/** An inline `onfocus=` attribute -- the other way a control can reveal something on focus. */
const INLINE_ONFOCUS = /\bonfocus\s*=/gi;

/**
 * Why a page's reveal is not attributable to `#trigger` alone, or `[]` when it is.
 *
 * Counts every registration BEFORE reading targets, so a `focus` listener spelled in a way the pattern
 * cannot attribute is reported as unreadable rather than passing unseen -- the same "we could not tell is
 * not the same as it is fine" rule `triggerDistance` follows by returning `null`.
 */
function nonTriggerReveals(html: string): string[] {
  const registrations = (html.match(FOCUS_LISTENER) ?? []).length;
  const targets = [...html.matchAll(FOCUS_LISTENER_ON_ID)].map((m) => m[1]);
  const inline = (html.match(INLINE_ONFOCUS) ?? []).length;
  return [
    ...(registrations === targets.length ? []
      : [`${registrations - targets.length} focus listener(s) whose element this file cannot read`]),
    ...(inline === 0 ? [] : [`${inline} inline onfocus= attribute(s)`]),
    ...targets.filter((id) => id !== "trigger").map((id) => `a focus listener on #${id}`),
  ];
}

test("#2142: only the trigger reveals the panel, so a shallow stop cannot look like a deep one", () => {
  const offenders = focusRevealCases().flatMap((c) => (["good", "bad"] as const).flatMap(
    (variant) => nonTriggerReveals(c[variant]).map((why) => `${c.id} (${variant}): ${why}`)));
  assert.deepEqual(offenders, [],
    "a focus-reveal case reveals its panel from somewhere other than #trigger. The depth assertions above "
    + "then measure nothing: a walk that stopped at the first control would open the panel there and read "
    + "exactly like a walk that travelled the whole distance. Only #trigger may carry the handler:\n  "
    + offenders.join("\n  "));
});

/**
 * THE POSITIVE CONTROLS for the three assertions above, run rather than described.
 *
 * The first two run the real derivations over the corpus AS IT STOOD BEFORE #2142 -- every case shallower
 * than the floor, which is a real population of this file's own making, not a fabricated one. Both checks
 * must report that corpus as failing, or neither was ever capable of it.
 *
 * The third is fabricated, because there is no page in `CASES` that reveals from the wrong control and
 * this file's whole point is that there must not be one. `nonTriggerReveals` is the same function the
 * test above calls.
 */
test("#2142: both depth checks FAIL on the corpus as it stood before this row -- their positive control", () => {
  const shallow = focusRevealCases().filter((c) => (triggerDistance(c.bad) ?? 0) < DEEPEST_REQUIRED_DISTANCE);
  assert.ok(shallow.length >= MINIMUM_POPULATION,
    "the control needs the pre-#2142 population to still be there; it is what both checks must reject");
  assert.ok(distinctDistances(shallow).length < MINIMUM_DISTINCT_DEPTHS,
    `the shallow population already spans ${distinctDistances(shallow).length} depths, so the `
    + "distinct-depth check would pass on it and cannot be said to have been failing before this row");
  const deepest = deepestDistance(shallow);
  assert.ok(deepest !== null && deepest < DEEPEST_REQUIRED_DISTANCE,
    `the shallow population reaches ${deepest}, which meets the floor -- the depth check cannot fail and `
    + "has been passing without measuring anything");
});

test("#2142: the reveal-attribution check REPORTS a panel opened from another control", () => {
  const revealedFromTheFirstField = "<input id=\"first\"><input id=\"trigger\">"
    + "<script>var p=document.getElementById('panel');"
    + "document.getElementById('first').addEventListener('focus', function(){ p.hidden = false; });"
    + "</script>";
  assert.deepEqual(nonTriggerReveals(revealedFromTheFirstField), ["a focus listener on #first"]);
  const spelledAnotherWay = "<script>document.querySelector('#first').addEventListener('focus', f);</script>";
  assert.deepEqual(nonTriggerReveals(spelledAnotherWay),
    ["1 focus listener(s) whose element this file cannot read"]);
  assert.deepEqual(nonTriggerReveals("<input id=\"trigger\" onfocus=\"reveal()\">"),
    ["1 inline onfocus= attribute(s)"]);
});
