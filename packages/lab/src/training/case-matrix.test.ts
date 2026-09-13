import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CASES, evidenceUnits, signalMatches, arrowKeysAreInert } from "./case-matrix.mjs";

/**
 * The fields of a generated case that these tests read.
 *
 * `case-matrix.mjs` is JavaScript, so `CASES` arrives untyped and every destructure below was an implicit
 * `any` — five type errors that kept the repo's `typecheck` red, and with it the pre-push hook, from
 * 2 August. Naming the shape once fixes all five without weakening anything: an added field still
 * type-checks, a renamed one still fails here.
 */
interface GeneratedCase {
  id: string;
  good: string;
  bad: string;
  badSignal: { type: string; control?: string; expected?: string; language?: string };
  probeTables?: boolean;
}

const cases = CASES as unknown as GeneratedCase[];

const tableSignal = { type: "table-unassociated" };

test("table-unassociated reads the dedicated cell announcement", () => {
  assert.equal(signalMatches({
    structure: { tableCells: ["Departs, column 2, 09:15"] },
  }, tableSignal), false);
  assert.equal(signalMatches({
    structure: { tableCells: ["column 2, 09:15"] },
  }, tableSignal), true);
});

test("table cells are included in the model evidence stream", () => {
  assert.deepEqual(evidenceUnits({
    transcript: [],
    structure: { headings: [], landmarks: [], formFields: [], tableCells: ["Departs, column 2, 09:15"] },
  }), [{ channel: "table-cell-navigation", text: "Departs, column 2, 09:15" }]);
});

test("table-unassociated does not infer from the general transcript or cell count", () => {
  assert.equal(signalMatches({
    transcript: ["row 2, column 2, 09:15"],
    structure: { tableCells: [] },
  }, tableSignal), false);
  assert.equal(signalMatches({
    structure: { tableCells: ["Departs, column 2, 09:15", "Platform, column 3, 3"] },
  }, tableSignal), false);
});

test("unnamed controls tolerate NVDA's object replacement character", () => {
  const signal = { type: "unnamed-form-field" };
  assert.equal(signalMatches({ structure: { formFields: ["￼, button"] } }, signal), true);
  assert.equal(signalMatches({ structure: { formFields: ["Open account search, button"] } }, signal), false);
});

test("every table case explicitly requests the table probe", () => {
  const tableCases = cases.filter(({ badSignal }) => badSignal.type === "table-unassociated");
  assert.ok(tableCases.length > 0);
  assert.ok(tableCases.every(({ probeTables }) => probeTables === true));
});

test("status-message pairs expose an explicit live region only on the good page", () => {
  const statusCases = cases.filter(({ badSignal }) => badSignal.type === "form-activation-silent");
  assert.ok(statusCases.length > 0);
  for (const testCase of statusCases) {
    assert.match(testCase.good, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.doesNotMatch(testCase.bad, /role="status"|aria-live=/);
  }
});

test("error fixtures prevent submit navigation before the probe can fire", () => {
  for (const id of ["form-error-calibration-bus-depot-013", "form-error-silent-bulk-health-pavilion-042"]) {
    const testCase = cases.find((candidate) => candidate.id === id);
    assert.ok(testCase, id + " should exist");
    assert.match(testCase.good, /<form[^>]+onsubmit=/);
    assert.match(testCase.bad, /<form[^>]+onsubmit=/);
    assert.doesNotMatch(testCase.good + testCase.bad, /addEventListener\(['"]submit/);
  }
});

test("the seed validation fixture changes only error announcement, not field naming", () => {
  const testCase = cases.find((candidate) => candidate.id === "form-error-silent");
  assert.ok(testCase, "form-error-silent should exist");
  assert.match(testCase.good, /<label for="reference">Reference number<\/label>/);
  assert.match(testCase.bad, /<label for="reference">Reference number<\/label>/);
  assert.doesNotMatch(testCase.bad, /<span>Reference number<\/span>/);
});

test("arrow-keys-inert fires only when the page said nothing AND focus did not move", () => {
  // The observation 2.1.1 abstains without. `SHARES_ONE_TAB_STOP` refuses to decide on a radio group
  // because a native one and a broken one both present ONE tab stop — the tab ring cannot separate them,
  // and that refusal is correct. Pressing the arrow is the only thing that can.
  const inert = { focusBefore: "Standard delivery, radio button", announced: "",
    focusAfter: "Standard delivery, radio button, 1 of 3" };
  assert.equal(arrowKeysAreInert(inert), true);
  // EITHER signal of movement clears it, never both required. NVDA re-announces the same option
  // differently depending on how the caret arrived, so demanding both would call a working group broken.
  assert.equal(arrowKeysAreInert({ ...inert, announced: "Express delivery, radio button, 2 of 3" }), false);
  assert.equal(arrowKeysAreInert({ ...inert, focusAfter: "Express delivery, radio button" }), false);
});

test("no language-unmarked case names its own language in the page text", () => {
  // `languageIsUnannounced` fires when the language NAME (not the ISO code) is absent from everything
  // NVDA said -- and NVDA reads the page's own visible text too, so a lead or passage that happens to
  // contain the word ("reproduced in the original French") puts it in spokenText() on BOTH variants
  // regardless of whether a language change was actually announced. That made three real cases BLIND at
  // the gate on 2026-09-05 (case-matrix.mjs, the comment above `language-marked-silent-museum`), fixed by
  // hand-rewriting their lead text -- an unwritten convention until then. This is the guard that convention
  // never had: it is cheap (no capture, no fleet), runs on every push, and the next case that violates it
  // fails here instead of surviving until a real capture run reports it blind.
  const languageCases = cases.filter((c) => c.badSignal.type === "language-unmarked" && c.badSignal.language);
  assert.ok(languageCases.length >= 5, "the language-of-parts family has shrunk; re-read this test");
  const violators = languageCases.filter((c) => {
    const name = c.badSignal.language as string;
    const pattern = new RegExp(`\\b${name}\\b`, "i");
    return pattern.test(c.good) || pattern.test(c.bad);
  });
  assert.deepEqual(violators.map((c) => c.id), [],
    "these cases name their own declared language somewhere in the page text, which makes " +
    "language-unmarked unable to discriminate the pair");
});

test("an unprobed or unreadable capture makes NO arrow claim", () => {
  // A capture that never pressed an arrow cannot say whether one works, and reading that absence as
  // inertness is this corpus's oldest defect wearing a new criterion. An unreadable focus on either side
  // means the probe could not observe, which is equally not evidence of inertness.
  assert.equal(arrowKeysAreInert(null), false);
  assert.equal(arrowKeysAreInert(undefined), false);
  assert.equal(arrowKeysAreInert({ focusBefore: "", announced: "", focusAfter: "" }), false);
  assert.equal(arrowKeysAreInert({ focusBefore: "Standard, radio button", announced: "", focusAfter: "" }),
    false);
});

// ---------------------------------------------------------------------------------------------------
// #1115: 4.1.3 WAS ONE SUBTYPE, 150 CASES DEEP.
//
// A criterion whose whole population is one subtype cannot distinguish the categories it claims, and a
// model trained on it learns the subtype rather than the criterion — the starvation shape ADR 0015 is
// about, with the flaw INSIDE the data so no held-out split can punish it.
//
//     before: { "form-activation-silent": 150 }
//     after:  { "form-activation-silent": 150, "status-waiting": 24, "status-progress": 24 }
//
// TWELVE DECLARATIONS, FORTY-EIGHT CASES. The row predicted twelve, not knowing this file multiplies
// every declaration by its `+also-*` and `+with-component-index` expansions. Stated rather than trimmed
// to hit the predicted number: the row's requirement is six pairs of each category, and that is what is
// declared.
// ---------------------------------------------------------------------------------------------------

const statusCases = CASES.filter((c: { criterion: string }) => c.criterion === "4.1.3");
const bySubtype = (name: string) =>
  statusCases.filter((c: { subtype: string }) => c.subtype === name);

test("#1115: 4.1.3 is no longer ONE subtype — asserted as a distribution, never as a count", () => {
  // A COUNT GOES STALE the next time a case is added; this is a property of the population. Each
  // represented subtype must carry BOTH halves, because a subtype present only as a positive teaches the
  // label rather than the criterion.
  const subtypes = [...new Set(statusCases.map((c: { subtype: string }) => c.subtype))].sort() as string[];
  assert.ok(subtypes.length > 1,
    `4.1.3 is still one subtype (${subtypes.join(", ")}) -- a criterion whose whole population is one `
    + "subtype cannot distinguish the categories it claims");

  for (const subtype of subtypes) {
    const cases = bySubtype(subtype) as { good?: string; bad?: string }[];
    assert.ok(cases.some((c) => typeof c.good === "string" && c.good !== ""),
      `${subtype} has no conformant half`);
    assert.ok(cases.some((c) => typeof c.bad === "string" && c.bad !== ""),
      `${subtype} has no failing half`);
  }
});

test("#1115: six WAITING and six PROGRESS pairs are declared, and they are well-formed", () => {
  // Counted from the DECLARATIONS rather than from the expanded array: `+also-*` and
  // `+with-component-index` multiply every case in this file, so the expanded total is a fact about the
  // expansion and not about what this row built.
  for (const subtype of ["status-waiting", "status-progress"]) {
    const declared = bySubtype(subtype)
      .filter((c: { id: string }) => !c.id.includes("+"));
    assert.equal(declared.length, 6, `${subtype} declares ${declared.length} pairs, expected six`);
    for (const c of declared as {
      id: string; task: string; source: string; mutation: string;
      badSignal: { type: string; control?: string; expected?: string };
      good: string; bad: string; probeForms: boolean;
    }[]) {
      assert.ok(c.task && c.source && c.mutation, `${c.id}: missing task, source or mutation`);
      assert.ok(c.good.includes("role=\"status\""), `${c.id}: the conformant half must announce`);
      assert.ok(!c.bad.includes("role=\"status\""), `${c.id}: the failing half must NOT announce`);
      assert.ok(c.probeForms, `${c.id}: a case nobody probes cannot produce the evidence it declares`);
      assert.ok(!c.good.includes("setTimeout") && !c.bad.includes("setTimeout"),
        `${c.id}: SYNCHRONOUS ONLY -- a polite region waits for idle, so an asynchronous update announces `
        + "intermittently, and `filter-status-silent-checkbox` was withdrawn over exactly that");
    }
  }
});

test("#1115: each new case declares a badSignal an implementation actually reads", () => {
  // THE #1114 LESSON, ONE FILE OVER: a declaration nothing implements does nothing. `check-signals.mjs`
  // maps a badSignal TYPE to the evidence fields a capture records, so a new type invented here would
  // name a contract no run can honour. The type is reused and the SUBTYPE is what this row moves.
  //
  // This asserts the DECLARATION; #34 proves the firing, because the run that would is `orchestrator`'s.
  const source = readFileSync(new URL("./check-signals.mjs", import.meta.url), "utf8");
  for (const c of [...bySubtype("status-waiting"), ...bySubtype("status-progress")] as
    { id: string; badSignal: { type: string; control?: string; expected?: string } }[]) {
    assert.ok(source.includes(`"${c.badSignal.type}"`),
      `${c.id} declares badSignal type ${c.badSignal.type}, which check-signals.mjs does not read`);
    assert.ok(c.badSignal.control && c.badSignal.expected,
      `${c.id}: the signal must name the control to press and what it expects to hear`);
  }
});

/**
 * #1202 (#828's code half): THE CASE THAT MAKES #812'S GATE OBSERVABLE.
 *
 * `rules.ts` refuses a `stateChange` whose two sides name different controls
 * (`sameControlAnnounced`). `after` is a post-activation FOCUS read, so the sides CAN describe two
 * different controls -- and "both say collapsed" is then a true statement about two strings that says
 * nothing about either control. Without that gate a finding is added against a conformant page.
 *
 * **No corpus case could reach that line.** Every disclosure case landed the post-activation read on the
 * same control, so the gate's presence and its absence produced identical corpus results.
 *
 * THIS HALF OWNS THE FIXTURE, NOT THE EVIDENCE. Everything below is asserted from the case DEFINITION.
 * Whether a real capture produces the predicted pair is #828's, on the fleet, through `check-signals` --
 * a `runs/`-reading verdict this row must not report.
 */
const SIBLING_CASE = "disclosure-focus-moves-to-collapsed-sibling";
const siblingCases = cases.filter((c) => c.id === SIBLING_CASE || c.id.startsWith(`${SIBLING_CASE}+`));

/** The `aria-expanded` controls a variant's markup declares, in document order, with their names. */
function expandableControls(html: string): { name: string; state: string }[] {
  return [...html.matchAll(/<button[^>]*aria-expanded="(true|false)"[^>]*>([^<]*)<\/button>/g)]
    .map((m) => ({ name: m[2].trim(), state: m[1] === "true" ? "expanded" : "collapsed" }));
}

test("#1202 clause 1: the case exists, and BOTH its controls carry an expandable state", () => {
  assert.ok(siblingCases.length > 0,
    `${SIBLING_CASE} is not in CASES, so every assertion below would pass having examined nothing`);
  const good = siblingCases[0].good;
  const controls = expandableControls(good);
  // POSITIVE CONTROL: print the two control names before asserting anything about them. A case whose
  // markup stopped parsing and a case with the wrong controls produce the same empty list.
  assert.deepEqual(controls.map((c) => c.name), ["Show delivery options", "Show opening hours"],
    `the two controls this case is about are not both present: ${JSON.stringify(controls)}`);
  assert.deepEqual(controls.map((c) => c.state), ["collapsed", "collapsed"],
    "BOTH must announce a collapsed state -- if the focus destination carries no expandable state the "
    + "pair fails `sameControlAnnounced` for the uninteresting reason (no state on one side) rather "
    + `than the interesting one (two different controls): ${JSON.stringify(controls)}`);
});

test("#1202 clause 3, MARKUP spelling: the two controls are DIFFERENT controls", () => {
  // THE ROW'S MUTATION HAS TWO SPELLINGS AND THIS TEST CATCHES ONE OF THEM. "Make the two controls the
  // same control" can mean renaming the second button in the MARKUP -- which this catches -- or pointing
  // the good variant's `.focus()` at the control it started from, which is what actually decides whether
  // `after` names the same control and is caught by the `.focus()` test below, not here.
  //
  // Labelled for the spelling it covers rather than as THE mutation target, because `worker-capture`
  // pointed out in review that the focus-target reading is the more natural one and this test stays
  // green under it. Both are covered; only the label was pointing at the less likely half.
  const controls = expandableControls(siblingCases[0].good).map((c) => c.name);
  assert.equal(new Set(controls).size, controls.length,
    `the case names the same control twice (${JSON.stringify(controls)}), so the post-activation read `
    + "lands on the control it started from and `sameControlAnnounced` is satisfied for the ordinary "
    + "reason. The case then exercises nothing #812 added, which is the parent's defect one level down");
});

test("#1202 clause 2: the variants share their MARKUP -- only the script differs", () => {
  const { good, bad } = siblingCases[0];
  const bodyOf = (html: string) => expandableControls(html);
  assert.deepEqual(bodyOf(good), bodyOf(bad),
    "the two variants must present the same controls in the same states; a pair differing in its markup "
    + "as well as its behaviour cannot attribute a finding to either");
  assert.notEqual(good, bad, "the variants are identical, so one of them is not the case it claims to be");
});

test("#1202 clause 3, FOCUS-TARGET spelling: only the good variant moves focus, and to the sibling", () => {
  const { good, bad } = siblingCases[0];
  // The asymmetry that makes the pair valid: only the GOOD variant moves focus, so only the good
  // variant's capture produces a two-control pair, and the finding fires on the bad variant, where focus
  // never moves.
  //
  // WHY THAT IS SOUND IS ARGUED IN ONE PLACE, AND IT IS NOT HERE -- see the P/Q paragraph above
  // `disclosure-focus-moves-to-collapsed-sibling` in `case-matrix.mjs`. #1209: this comment used to
  // carry a SECOND copy of that argument, and the copy was the superseded version -- "nothing is ever
  // attributed to the focus move", which is wrong in one direction, since the good variant's silence is
  // attributable to the focus move entirely. It stood here, in the file whose failure message sends a
  // reader to this exact clause, while the correction sat in the other file.
  //
  // A POINTER RATHER THAN A BETTER SECOND COPY. Two copies of a live argument is what produced this, and
  // correcting both is the remedy that fails again the next time only one is edited.
  assert.match(good, /#hours'\)\.focus\(\)/,
    "the good variant must move focus to the sibling disclosure, or its capture never reaches the gate");
  assert.ok(!/\.focus\(\)/.test(bad),
    "the bad variant must NOT move focus: if it did, its pair would name two controls too and the gate "
    + "would skip it, leaving a case whose signal cannot fire on either variant");
});
