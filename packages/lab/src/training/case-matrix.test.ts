import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CASES, evidenceUnits, signalMatches, arrowKeysAreInert } from "./case-matrix.mjs";
import { ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { probeKindFor } from "@a11ign/nvda-worker/capture-pure";

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

/** The declared (unexpanded) pages of a status subtype: `+also-*` and `+with-component-index` are copies. */
const declaredStatus = (subtype: string) =>
  bySubtype(subtype).filter((c: { id: string }) => !c.id.includes("+")) as {
    id: string; family: string; task: string; source: string; mutation: string;
    badSignal: { type: string; control?: string; expected?: string };
    good: string; bad: string; probeForms: boolean;
  }[];

/**
 * #2385: THE FLOOR, NOT THE TOTAL. #1115 pinned exactly six declarations per subtype, which is how the
 * two status heads came to be trained on six pages each (24 positives once expanded, 0 recovered at their
 * own operating point in #2258). The count is now a MINIMUM, asserted against the shipped `CASES`, so
 * adding a page never needs this file edited and removing one below the floor is refused.
 */
const MIN_DECLARED_STATUS_PAGES = 12;

test("#1115/#2385: at least twelve WAITING and twelve PROGRESS pairs are declared, and they are well-formed", () => {
  // Counted from the DECLARATIONS rather than from the expanded array: `+also-*` and
  // `+with-component-index` multiply every case in this file, so the expanded total is a fact about the
  // expansion and not about what was built.
  for (const subtype of ["status-waiting", "status-progress"]) {
    const declared = declaredStatus(subtype);
    assert.ok(declared.length >= MIN_DECLARED_STATUS_PAGES,
      `${subtype} declares ${declared.length} pages, expected at least ${MIN_DECLARED_STATUS_PAGES}`);
    for (const c of declared) {
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

test("#2385: the status pages do not share one announced string, and the progress head hears more than one", () => {
  // THE SHAPE THIS ROW WAS FILED AGAINST: `Step 2 of 4` x6 on the same `<p id="progress">`. A head that
  // sees one sentence learns the sentence, so the property is "no string on more than half the pages",
  // read from the shipped declarations rather than typed as a total.
  for (const subtype of ["status-waiting", "status-progress"]) {
    const declared = declaredStatus(subtype);
    const perString = new Map<string, number>();
    for (const c of declared) {
      const text = c.badSignal.expected ?? "";
      perString.set(text, (perString.get(text) ?? 0) + 1);
    }
    assert.ok(perString.size > 1, `${subtype} announces ONE string on every page: ${[...perString.keys()].join(" | ")}`);
    const [commonest, count] = [...perString.entries()].sort((a, b) => b[1] - a[1])[0]!;
    assert.ok(count * 2 <= declared.length,
      `${subtype}: "${commonest}" is announced by ${count} of ${declared.length} declarations -- more than half`);
  }
});

test("#2385: the status pages are independent families, not copies of the older twelve", () => {
  // The builders name the family `status-waiting` / `status-progress`; a page sharing that name is one
  // example to the grouped split however many are declared. Each page added by #2385 is its OWN family.
  // Counted as a floor over what ships: the older twelve are the only pages allowed to share a name.
  for (const subtype of ["status-waiting", "status-progress"]) {
    const declared = declaredStatus(subtype);
    const sharing = declared.filter((c) => c.family === subtype);
    const own = declared.filter((c) => c.family === c.id);
    assert.ok(own.length >= MIN_DECLARED_STATUS_PAGES / 2,
      `${subtype}: only ${own.length} pages are their own family`);
    assert.equal(own.length + sharing.length, declared.length,
      `${subtype}: a page is in neither its own family nor the shared one`);
  }
});

/**
 * #2385: THE SHAPE OF A STATUS PAGE, read from its FAILING half's markup: which element carries the
 * changing text, whether the page has a heading, whether it carries a named field. These are the three
 * things the row says must vary, because the misses share `heading_present` and `form_field_named` at 1
 * and every older page changes a `<p>`. Read from the shipped HTML, not from the builders' arguments, so a
 * builder that silently drops `element` or `field` is what the test sees.
 */
const statusPageShape = (html: string) => ({
  element: /<(\w+) id="(?:state|progress)"/.exec(html)?.[1],
  heading: /<h1>/.test(html),
  field: /<label for="ref">[^<]+<\/label><input /.test(html),
});

const MIN_DISTINCT_ELEMENTS = 3;
const MIN_PAGES_PER_SHAPE = 2;

test("#2385: the status pages vary the changing element, the heading and the named field", () => {
  for (const subtype of ["status-waiting", "status-progress"]) {
    const shapes = declaredStatus(subtype).map((c) => ({ id: c.id, ...statusPageShape(c.bad) }));
    const unread = shapes.filter((s) => s.element === undefined).map((s) => s.id);
    assert.deepEqual(unread, [], `${subtype}: pages whose changing element the reader cannot find`);
    const elements = new Set(shapes.map((s) => s.element));
    assert.ok(elements.size >= MIN_DISTINCT_ELEMENTS,
      `${subtype}: the changing text sits in only ${[...elements].join(", ")}; expected ${MIN_DISTINCT_ELEMENTS}+ elements`);
    for (const key of ["heading", "field"] as const) {
      const withIt = shapes.filter((s) => s[key]).length;
      const without = shapes.length - withIt;
      assert.ok(withIt >= MIN_PAGES_PER_SHAPE && without >= MIN_PAGES_PER_SHAPE,
        `${subtype}: ${withIt} pages have a ${key} and ${without} do not; expected ${MIN_PAGES_PER_SHAPE}+ of each`);
    }
  }
});

test("#2385: the shape reader tells the shapes apart (positive control)", () => {
  // The variation test above passes vacuously if the reader returns one answer for every page, so it is
  // run on hand-typed pages that differ in exactly one dimension each.
  const base = statusPageShape("<h1>T</h1><button>Go</button><p id=\"state\"></p>");
  assert.deepEqual(base, { element: "p", heading: true, field: false });
  assert.equal(statusPageShape("<button>Go</button><span id=\"progress\">Step 1</span>").element, "span");
  assert.equal(statusPageShape("<button>Go</button><p id=\"state\"></p>").heading, false);
  assert.equal(statusPageShape("<label for=\"ref\">Name</label><input id=\"ref\" type=\"text\"><p id=\"state\"></p>").field, true);
});

/**
 * #2385: HARD NEGATIVES. A live region that announces a status, in any spelling a page here uses.
 * `<output>` is included because it carries an implicit `role="status"`.
 */
const ANNOUNCES_A_STATUS = /role="(?:status|alert|log)"|aria-live=|<output[\s>]/i;

const HARD_NEGATIVE_PREFIX = "status-negative-";
const MIN_HARD_NEGATIVE_PAIRS = 6;
const hardNegatives = CASES.filter((c: { id: string }) => c.id.startsWith(HARD_NEGATIVE_PREFIX)) as unknown as {
  id: string; criterion: string; subtype: string; badSignal: { type: string }; good: string; bad: string;
  probeForms: boolean;
}[];

test("#2385: at least six hard-negative pairs exist, labelled as NOT 4.1.3 and announcing no status", () => {
  assert.ok(hardNegatives.length >= MIN_HARD_NEGATIVE_PAIRS,
    `${hardNegatives.length} hard-negative pairs, expected at least ${MIN_HARD_NEGATIVE_PAIRS}`);
  const statusSubtypes = new Set(["status-waiting", "status-progress"]);
  for (const c of hardNegatives) {
    // The exporter writes `subtypes` as `criterion:subtype` of the CASE on its failing half only, so a case
    // that is not 4.1.3 is `clean` for every 4.1.3 head on both halves: that is the whole of the label.
    assert.notEqual(c.criterion, "4.1.3", `${c.id}: a 4.1.3 case is a status POSITIVE, not a negative for it`);
    assert.ok(!statusSubtypes.has(c.subtype), `${c.id}: subtype ${c.subtype} is a status subtype`);
    assert.ok(typeof c.subtype === "string" && c.subtype !== "", `${c.id}: no subtype, so its label is absent rather than negative`);
    assert.ok(c.badSignal.type !== "form-activation-silent",
      `${c.id}: form-activation-silent is the status subtypes' own signal`);
    assert.ok(!ANNOUNCES_A_STATUS.test(c.good) && !ANNOUNCES_A_STATUS.test(c.bad),
      `${c.id}: a page here contains a live region, so it is not a page with no status message`);
  }
});

test("#2385: the live-region detector fires on a page that does announce (positive control)", () => {
  // `!ANNOUNCES_A_STATUS.test(...)` over the hard negatives passes just as readily when the pattern
  // matches nothing. Every conformant status page announces by construction, so the detector is run on
  // those, and on the implicit-role spelling the row's own suggestion (`<output>`) would have produced.
  const conformant = declaredStatus("status-waiting");
  assert.ok(conformant.length > 0, "no declared waiting pages -- this control would be vacuous");
  for (const c of conformant) assert.ok(ANNOUNCES_A_STATUS.test(c.good), `${c.id}: detector missed its live region`);
  assert.ok(ANNOUNCES_A_STATUS.test("<output id=\"state\"></output>"));
  assert.ok(!ANNOUNCES_A_STATUS.test("<button>Print</button><p id=\"state\"></p>"));
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

/**
 * #1209: A POINTER WHOSE TARGET IS GONE READS AS WORKING.
 *
 * The comment above sends a reader to a specific paragraph in `case-matrix.mjs`. Nothing held it there:
 * deleting that paragraph left this suite **18/0 green**, with every reader the pointer sends across
 * finding nothing and no way to tell whether it was deleted, renamed, or never written.
 *
 * The row's second done-when -- *"and the corrected argument in `case-matrix.mjs` is still 1"* -- was a
 * ONE-TIME reading at merge. This makes it a standing one, which is the difference between a check and
 * a note. Found by `worker-capture`, who drove the deletion rather than reasoning about it.
 *
 * SAME SHAPE AS #1184, and narrower: that pointer at least named something that had existed. A reader
 * here follows a precise instruction and finds no such paragraph.
 *
 * ANCHORED ON THE PHRASE THE POINTER QUOTES, deliberately. A reword of the P/Q paragraph fails here --
 * which is the point: the pointer and its target have to move together, and a guard that survived a
 * reword would be back to holding nothing.
 */
test("#1209: the paragraph this file points at still exists in case-matrix.mjs", () => {
  const target = readFileSync(new URL("./case-matrix.mjs", import.meta.url), "utf8");
  assert.match(target, /P = updates `aria-expanded`, Q = moves focus/,
    "the P/Q argument this file's FOCUS-TARGET comment sends readers to is gone from case-matrix.mjs. "
    + "Move the pointer to wherever the argument now lives, or delete both -- a pointer whose target "
    + "moved reads as working, and the reader who follows it cannot tell whether it was deleted, "
    + "renamed, or never written");
});

test("#1202 clause 3, FOCUS-TARGET spelling: only the good variant moves focus, and to the sibling", () => {
  const { good, bad } = siblingCases[0];
  // The asymmetry that makes the pair valid: only the GOOD variant moves focus, so only the good
  // variant's capture produces a two-control pair, and the finding fires on the bad variant, where focus
  // never moves.
  //
  // WHY THAT IS SOUND IS ARGUED IN ONE PLACE, AND IT IS NOT HERE -- see the P/Q paragraph above
  // `disclosure-focus-moves-to-collapsed-sibling` in `case-matrix.mjs`, the one beginning
  // "P = updates `aria-expanded`, Q = moves focus". THAT PHRASE IS PINNED by the test below, so this
  // pointer cannot outlive what it points at. #1209: this comment used to
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

// ---------------------------------------------------------------------------------------------------
// #2070: 3.3.1 WHOSE SUBMIT IS NOT NAMED LIKE ONE.
//
// Measured 2026-09-23 at `abbaa6adc`: `3.3.1:validation-error-silent` held 143 training positives and
// `probeKindFor` classified 143 of them `submit`, while the acceptance set carries the other shape at
// 1 in 6 -- `acceptance-b2-error-vessel`, "Apply for a berth". A held-out case tests GENERALISATION only
// when the training distribution contains the thing it generalises from; a shape present nowhere in
// training is not held out, it is unseen.
//
// These cases carry NO SIGNAL until the corpus is recaptured under protocol 21 (#1926), because
// `screenreader_features.py:1015-1017` refuses `taskButton` alone. A flat scorer number before that
// recapture is this ordering working, not this row having failed.
// ---------------------------------------------------------------------------------------------------

const validationErrorCases = CASES.filter(
  (c: { criterion: string; subtype: string }) =>
    c.criterion === "3.3.1" && c.subtype === "validation-error-silent",
) as Array<{ id: string; task: string; badSignal: { control?: string } }>;

const probesAsTask = (c: { task: string; badSignal: { control?: string } }) =>
  probeKindFor(`${c.badSignal.control ?? ""}, button`, { probeForms: true, task: c.task }) === "task";

test("#2070: 20-30 validation-error-silent cases are probed as TASK buttons, asked of the real decider", () => {
  // CALLING `probeKindFor`, never matching the name against a pattern. "Task-named" is not a prefix test:
  // the predicate is that the name misses all sixteen `SUBMIT_RE` alternatives AND shares a meaningful
  // word with the case's own task (rule 4). A name pattern written to stand in for that passes on names
  // the capture would still classify `submit`, which is the failure mode this assertion exists to refuse.
  const taskNamed = validationErrorCases.filter(probesAsTask);
  assert.ok(validationErrorCases.length > 100,
    `only ${validationErrorCases.length} validation-error-silent cases -- re-read this test`);
  assert.ok(taskNamed.length >= 20 && taskNamed.length <= 30,
    `${taskNamed.length} of ${validationErrorCases.length} validation-error-silent cases probe as task `
    + "buttons, outside the 20-30 band #2070 rules. Below 20 the shape is thin enough to be memorised "
    + "rather than learned; above 30 training carries it at a higher rate than the acceptance set that "
    + "tests it (1 in 6), and the submit-named majority -- the real-world majority -- weakens.");
});

test("#2070: what the matrix DECLARES task-named and what probeKindFor decides are the same set", () => {
  // Two independent derivations of one population, pinned equal so neither can drift alone -- this is
  // what lets `submit-is-recognised.test.ts` exempt these cases by ID without weakening itself. A case
  // named `form-error-taskname-*` that reads `submit` is an ordinary case wearing the prefix; a case that
  // reads `task` WITHOUT it is the 2026-09-02 accident that file exists to catch ("Confirm booking",
  // "Create account" -- meant as submits, silently probed as task buttons), arriving through the door
  // this row opened.
  const declared = validationErrorCases.filter((c) => /^form-error-taskname-/.test(c.id)).map((c) => c.id).sort();
  const observed = validationErrorCases.filter(probesAsTask).map((c) => c.id).sort();
  assert.ok(declared.length > 0, "no case carries the form-error-taskname- prefix -- this comparison would be vacuous");
  assert.deepEqual(observed, declared);
});

test("#2070: no training control string for this subtype is reused from the acceptance set", () => {
  // THE NEGATIVE CONTROL, and it must pass BOTH before and after this row. Reaching for "Apply for a
  // berth" is the obvious way to write a task-named variant and it would destroy the only held-out case
  // this criterion has -- the overlap was empty before (121 distinct training controls, 6 acceptance) and
  // stays empty.
  const acceptance = (ACCEPTANCE_CASES as readonly unknown[] as Array<{ id: string; criterion: string;
    subtype: string; task: string; badSignal: { control?: string } }>)
    .filter((c) => c.criterion === "3.3.1" && c.subtype === "validation-error-silent");
  // NOT VACUOUS, and here is the positive control by name: the acceptance population is non-empty, and
  // `acceptance-b2-error-vessel` is the one task-named case in it -- the very case whose held-out status
  // this whole row exists to make meaningful.
  assert.ok(acceptance.length > 0, "the acceptance population for this subtype is empty");
  const heldOut = acceptance.find((c) => c.id === "acceptance-b2-error-vessel");
  assert.ok(heldOut, "acceptance-b2-error-vessel is gone -- the held-out task-named case this row serves");
  assert.ok(probesAsTask(heldOut), "acceptance-b2-error-vessel no longer probes as a task button");
  const trainingControls = new Set(validationErrorCases.map((c) => c.badSignal.control));
  const reused = acceptance.map((c) => c.badSignal.control).filter((control) => trainingControls.has(control));
  assert.deepEqual(reused, [],
    "these acceptance control strings were copied into training, so the acceptance cases carrying them "
    + "are no longer held out from anything");
});
