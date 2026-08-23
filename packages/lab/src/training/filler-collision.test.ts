/**
 * Page furniture must not change ANY case's badSignal — measured as a delta, over every predicate.
 *
 * Realistic furniture is added to every case so the scorer sees real-world structure (see `filler()` in
 * case-matrix). Its announced text is the hazard: a signal is a pattern over what NVDA said, so furniture
 * that happens to satisfy one makes the signal fire on BOTH variants and `check-signals` reports
 * CONTAMINATED. That happened once — the furniture said "Reference section 01" and
 * `heading-vague-market`'s signal is `heading.*\bsection\b` — and it was found only after spending capture
 * time on it.
 *
 * This used to check the REGEX signals against five hand-written speech lines, which was the cheap 80%. It
 * now runs **every** signal predicate, because the furniture grew structure as well as text: ADR 0015 added
 * a labelled field and a data table to break the feature correlations that taught the heads to veto, and
 * those reach the STRUCTURAL predicates that a regex sweep cannot see.
 *
 * It immediately earned itself. `placeholderOnlyIsPresent` began `if (formFields.length > 0) return false`,
 * so the labelled reference field would have silenced every `placeholder-only` case — blinding them
 * quietly rather than failing, which is the one failure mode this corpus cannot carry. See
 * `placeholder-signal.test.ts`.
 *
 * **The delta is the assertion, not the value.** Several predicates fire on ABSENCE (`structure-empty`,
 * `missing-heading`, `control-unreachable-by-keyboard`), so asking "does this signal fire on a
 * furniture-only capture?" would report alarms that say nothing about the furniture. Asking whether adding
 * furniture CHANGES the answer is the question that matters, and it is immune to what the base lacks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CASES, signalMatches } from "./case-matrix.mjs";

type Signal = { type?: string };
type Case = { id: string; badSignal?: Signal };

/**
 * What NVDA announces for the furniture, in the shape the signals match against.
 *
 * Hand-written rather than captured, on purpose: this test must run in CI with no Windows guest. The table
 * and field lines are taken from real corpus captures of the same markup (`table-bulk-aquarium-001.good`
 * and `form-placeholder-calibration-aquarium-001.good`) rather than guessed. Keep it in step with
 * `filler()`, `namedField()` and `dataTable()`.
 */
const FURNITURE = {
  transcript: [
    "heading, level 2, Reference note 01",
    "Background detail for reference note 01, retained for records and reviewed each year by the site team.",
    "list, with 6 items",
    "bullet, same page, link, Opening times for the north entrance 01",
    "link, Annual review 2019 02",
    "Reference lookup, edit",
    "table, with 2 rows and 2 columns, caption, Reference notes index",
    "out of caption, row 1, column 1, Note",
    "column 2, Reviewed",
    "row 2, Note, column 1, Site safety",
    "Reviewed, column 2, 2019",
    "Reference notes archive, button, collapsed",
    "Reference notes archive, button, focused, expanded",
  ],
  headings: ["Reference note 01"],
  formFields: ["Reference lookup, edit"],
  tableCells: ["row 2, Site safety", "Reviewed, column 2, 2019"],
  controls: ["Reference notes archive, button, collapsed"],
  stateChanges: [{ control: "Reference notes archive, button, collapsed",
    after: "Reference notes archive, button, focused, expanded" }],
  links: ["Opening times for the north entrance 01", "Annual review 2019 02"],
};

/** A plausible page WITHOUT furniture. Its content is irrelevant; only the delta against it is read. */
const base = () => ({
  transcript: [
    "heading, level 1, Booking a guided walk",
    "main landmark",
    "Walks run every Saturday from the north entrance.",
    "link, Check availability for guided walks",
  ],
  structure: {
    headings: ["Booking a guided walk"], landmarks: ["main"], formFields: [],
    graphics: [], links: ["Check availability for guided walks"], lists: [], tableCells: [],
  },
  interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [] },
});

const withFurniture = () => {
  const capture = base();
  return {
    ...capture,
    transcript: [...capture.transcript, ...FURNITURE.transcript],
    structure: {
      ...capture.structure,
      headings: [...capture.structure.headings, ...FURNITURE.headings],
      formFields: [...capture.structure.formFields, ...FURNITURE.formFields],
      links: [...capture.structure.links, ...FURNITURE.links],
      lists: [...capture.structure.lists, "list, with 6 items"],
      tableCells: [...capture.structure.tableCells, ...FURNITURE.tableCells],
    },
    interaction: {
      ...capture.interaction,
      controls: [...capture.interaction.controls, ...FURNITURE.controls],
      stateChanges: [...capture.interaction.stateChanges, ...FURNITURE.stateChanges],
    },
  };
};

test("adding page furniture flips no case's badSignal", () => {
  const before = base();
  const after = withFurniture();
  const collisions: string[] = [];
  for (const testCase of CASES as Case[]) {
    const signal = testCase.badSignal;
    if (!signal?.type) continue;
    if (signalMatches(before, signal) !== signalMatches(after, signal)) {
      collisions.push(`${testCase.id}: ${signal.type} changed when furniture was added`);
    }
  }
  assert.deepEqual([...new Set(collisions)], [],
    "furniture changes a case's own badSignal, so the case will be CONTAMINATED (it fires on the good "
    + "variant too) or BLIND (it stops firing on the bad one). Reword or restructure the furniture, never "
    + "the signal.");
});

test("the furniture really is exercised, or the check above is vacuous", () => {
  // The guard this file most needs on itself: an earlier version asserted against five speech lines while
  // the furniture had grown structure those lines did not describe, so it passed having examined a
  // fraction of what it claimed. If the two captures are identical, the delta is trivially zero.
  assert.notDeepEqual(base(), withFurniture());
  assert.ok((CASES as Case[]).some((c) => c.badSignal?.type === "placeholder-only"),
    "no placeholder-only case is present, so the collision this test was extended for cannot occur");
  assert.ok((CASES as Case[]).filter((c) => c.badSignal?.type).length > 100);
});

/**
 * The same delta, for the ACCOMPANYING defects a multi-defect case adds to its bad variant.
 *
 * Page furniture is conformant, so it can only contaminate. An accompanying defect is a real failure, so it
 * can do worse: satisfy the HOST case's own badSignal, making a two-defect page report its neighbour's
 * failure as its own. `withAccompanyingDefects` already refuses to pair a host with a defect carrying its
 * own subtype, but that guard is on the LABEL and a `regex` signal matches TEXT — `link-vague-details`
 * matches /link[, ]+(read more|learn more)/ whatever subtype the phrase came from.
 */
const ACCOMPANYING_SPEECH: Record<string, string[]> = {
  // EVERY phrasing, not one. The snippets vary per host (see `accompanyingMarkup`) so checking a single
  // wording would examine a quarter of what ships — the vacuity this file exists to prevent.
  "vague-link": ["link, Details", "link, Here", "link, More", "link, Read more"],
  "generic-heading": [
    "heading, level 2, Welcome", "heading, level 2, Details",
    "heading, level 2, Things", "heading, level 2, Stuff",
    "General notes about this service.",
  ],
  "unnamed-graphic": ["graphic, to get missing image descriptions"],
  "position-only-table": [
    "table, with 2 rows and 2 columns, caption, Archive index",
    "table, with 2 rows and 2 columns, caption, Session times",
    "table, with 2 rows and 2 columns, caption, Room rates",
    "out of caption, row 1, column 1, Period",
    "row 2, column 1, 2019",
    "column 2, Yes",
  ],
  "bare-edit": ["edit"],
};

test("no accompanying defect satisfies its HOST case's own badSignal", () => {
  const collisions: string[] = [];
  for (const testCase of CASES as (Case & { id: string })[]) {
    const marker = /\+also-(.+)$/.exec(testCase.id);
    if (!marker || !testCase.badSignal?.type) continue;
    const names = Object.keys(ACCOMPANYING_SPEECH).filter((name) => marker[1].includes(name));
    assert.ok(names.length > 0, `${testCase.id}: no known accompanying defect — keep this map in step`);
    const before = base();
    const after = { ...before, transcript: [...before.transcript,
      ...names.flatMap((name) => ACCOMPANYING_SPEECH[name])] };
    if (signalMatches(before, testCase.badSignal) !== signalMatches(after, testCase.badSignal)) {
      collisions.push(`${testCase.id}: its own ${testCase.badSignal.type} signal fires on ${names.join("+")}`);
    }
  }
  assert.deepEqual(collisions, [],
    "a two-defect page whose host signal is satisfied by the ACCOMPANYING defect reports its neighbour's "
    + "failure as its own — pair that host with a different defect, or reword the snippet");
});

test("multi-defect cases exist, or the check above is vacuous", () => {
  const multi = (CASES as { id: string }[]).filter((c) => c.id.includes("+also-"));
  assert.ok(multi.length >= 20, `only ${multi.length} multi-defect cases — see docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md`);
});

test("an accompanying defect has SEVERAL phrasings, or 240 pages teach one string", () => {
  // The error this guards is the one this project diagnosed in the W3C real-page corpus the same week:
  // one unnamed combo box repeated three times, counted as three failures. The first version of the
  // multi-defect family put a byte-identical "Read more" on 93 of 240 pages. Scaling the number of PAGES
  // without scaling the variety of what is being learned teaches the string, not the concept.
  const multi = (CASES as { bad: string; id: string }[]).filter((c) => c.id.includes("+also-"));
  assert.ok(multi.length >= 100, `only ${multi.length} multi-defect cases`);
  for (const [name, phrasings] of Object.entries(ACCOMPANYING_SPEECH)) {
    if (phrasings.length < 2) continue; // an unnamed graphic announces one hint however many files there are
    const distinct = new Set<string>();
    for (const testCase of multi) {
      for (const phrase of phrasings) {
        const words = phrase.replace(/^(link|heading, level 2|out of caption[^,]*|row \d+[^,]*), /, "");
        if (words && testCase.bad.includes(words.split(",")[0])) distinct.add(words);
      }
    }
    assert.ok(distinct.size >= 2,
      `${name} appears with only ${distinct.size} distinct wording(s) across the family — vary it, or the `
      + "model learns that wording rather than the failure");
  }
});
