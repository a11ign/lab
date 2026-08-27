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

import { ACCOMPANYING_CONFORMANT, ACCOMPANYING_DEFECTS, CASES, signalMatches } from "./case-matrix.mjs";

type Signal = { type?: string };
type Case = { id: string; badSignal?: Signal; criterion?: string; good?: string; bad?: string };

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
  // Added with the three accompaniments that exist to raise under-represented subtypes above the ~140
  // positives where per-head recall stops tracking sample size. A fake heading is a `div` styled to look
  // like one, so NVDA announces only its TEXT — no role, no level — which is precisely the failure.
  "fake-heading": ["Borrowing books", "Contact and opening hours", "Where to find us"],
  "filename-alt": [
    "graphic, trail_entrance-final.jpg", "graphic, site_plan_v2.png", "graphic, DSC_0421.jpg",
  ],
  "generic-alt": ["graphic, image", "graphic, photo", "graphic, graphic"],
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
    const distinct = distinctWordings(phrasings, multi);
    assert.ok(distinct.size >= 2,
      `${name} appears with only ${distinct.size} distinct wording(s) across the family — vary it, or the `
      + "model learns that wording rather than the failure");
  }
});

test("an accompanying defect never perturbs the evidence channel its host is measured on", () => {
  // A different failure from a text collision, and the delta checks above cannot see it: a focusable
  // element ENTERS the tab order, and 2.1.1, 2.1.2, 2.4.1 and 2.4.3 are measured on `focusOrder`. Pairing
  // a vague link or a bare edit with `focus-order-tabindex` produced the corpus's only BLIND case in
  // 1,306 — its signal never fired on the bad page, because the accompanying controls changed what the
  // probe recorded.
  // READ THE MARKUP, not the case id — and the id version was wrong twice over.
  //
  // It matched `c.id.includes("bare-edit")`, which is a PROXY for "carries a focusable element". Two
  // problems. A new defect that adds a focusable element without being on the list is invisible to it,
  // which is the failure the whole test exists to prevent. And `bare-edit-inert` contains the substring
  // `bare-edit`, so the proxy fired on the one defect built specifically NOT to perturb the tab order —
  // the same substring trap `defects_in` in `audit_grants.py` documents and solves by matching
  // longest-first.
  //
  // What actually matters is SEQUENTIAL focusability. `tabindex="-1"` makes an element focusable
  // programmatically and unreachable by Tab, which is exactly the property that lets an unnamed field
  // reach a focus-order host without changing the channel it is judged on.
  const READS_FOCUS_ORDER = ["2.1.1", "2.1.2", "2.4.1", "2.4.3"];
  const NATIVELY_FOCUSABLE = /<(a\s[^>]*href|input|button|select|textarea)\b[^>]*>/gi;
  const sequentiallyFocusable = (html: string): boolean => {
    for (const [tag] of html.matchAll(NATIVELY_FOCUSABLE)) {
      if (!/tabindex\s*=\s*["']?-\d/i.test(tag)) return true;
    }
    return false;
  };

  // Read each DEFINITION's markup, which is the source of truth. Diffing the assembled pages was tried
  // and does not work: `bad` is not `good` plus the injection — the host's own mutation differs too — so
  // `bad.replace(good, "")` matches nothing and hands back the whole page, inputs and all.
  const perturbing = new Set(Object.entries(ACCOMPANYING_DEFECTS as Record<string, { markup: string[] }>)
    .filter(([, defect]) => defect.markup.some(sequentiallyFocusable))
    .map(([name]) => name));
  assert.ok(perturbing.size > 0,
    "no accompanying defect looks focusable, so this test would pass having examined nothing");

  // LONGEST FIRST, because the names nest: `bare-edit-inert` contains `bare-edit`, and matching greedily
  // is what stops the inert variant being blamed for its tabbable sibling. `defects_in` in
  // `audit_grants.py` documents the same trap and solves it the same way.
  const byLength = [...perturbing].sort((a, b) => b.length - a.length);
  const carries = (id: string): boolean => {
    let suffix = id.split("+also-")[1] ?? "";
    for (const name of [...Object.keys(ACCOMPANYING_DEFECTS)].sort((a, b) => b.length - a.length)) {
      if (!suffix.includes(name)) continue;
      suffix = suffix.replace(name, "");
      if (byLength.includes(name)) return true;
    }
    return false;
  };
  const offenders = (CASES as { id: string; criterion: string }[])
    .filter((c) => c.id.includes("+also-") && READS_FOCUS_ORDER.includes(c.criterion))
    .filter((c) => carries(c.id))
    .map((c) => c.id);
  assert.deepEqual(offenders, [],
    "these hosts are measured on focusOrder and carry an accompanying focusable element, which changes "
    + "the tab order they are being judged on — the case goes BLIND and the label is unbacked");
});

/** Which of a defect's phrasings actually appear in the generated markup, by their leading words. */
function distinctWordings(phrasings: string[], multi: { bad: string }[]): Set<string> {
  const distinct = new Set<string>();
  for (const testCase of multi) {
    for (const phrase of phrasings) {
      const words = phrase.replace(/^(link|heading, level 2|out of caption[^,]*|row \d+[^,]*), /, "");
      if (words && testCase.bad.includes(words.split(",")[0])) distinct.add(words);
    }
  }
  return distinct;
}

/**
 * The same delta again, for the CONFORMANT accompaniments — the third path, and the one where a collision
 * is not merely possible but designed in.
 *
 * `component-index` exists to break a word-sense monopoly: every wordlist term appears on failing pages
 * only (`link:details` 0 good / 17 bad), so the corpus taught that the WORD is the failure rather than the
 * word WITHOUT CONTEXT. Fixing that means putting "Details" on a conformant page — and two 2.4.4 cases use
 * "Details" as their vague example, so the same word must not reach their good variant.
 *
 * That exclusion is declared by hand (`notFor`). This proves it is COMPLETE, over every case and every
 * piece, rather than over the two the author happened to think of. The previous two blocks in this file
 * cover `filler()` and the accompanying DEFECTS; this path had none, which is this repo's most familiar
 * shape — a remedy applied where somebody was looking.
 */
const CONFORMANT_SPEECH: Record<string, { transcript: string[]; links: string[] }> = {
  // What NVDA announces for the nav-and-list markup. Written from a real capture's shape: the container is
  // announced, then each link in order.
  "component-index": {
    // No landmark line: the piece is a bare `<ul>`. A `<nav>` was captured and broke three cases by
    // changing NVDA's container prefixes — see the markup's comment in case-matrix.
    transcript: [
      "list, with 4 items",
      "link, Accordion", "link, Details", "link, Tabs", "link, Table",
      "link, Eligibility", "link, Deadlines", "link, Contacts",
      "out of list",
    ],
    links: ["Accordion, link", "Details, link", "Tabs, link", "Table, link",
      "Eligibility, link", "Deadlines, link", "Contacts, link"],
  },
};

test("no conformant accompaniment satisfies its HOST case's own badSignal", () => {
  const collisions: string[] = [];
  for (const testCase of CASES as Case[]) {
    const signal = testCase.badSignal;
    if (!signal?.type) continue;
    const name = Object.keys(CONFORMANT_SPEECH).find((piece) => testCase.id.endsWith(`+with-${piece}`));
    if (!name) continue;
    const piece = CONFORMANT_SPEECH[name];
    const before = base();
    const after = {
      ...before,
      transcript: [...before.transcript, ...piece.transcript],
      structure: { ...before.structure, links: [...before.structure.links, ...piece.links] },
    };
    if (signalMatches(before, signal) !== signalMatches(after, signal)) {
      collisions.push(`${testCase.id}: ${signal.type} changed when ${name} was added`);
    }
  }
  assert.deepEqual([...new Set(collisions)], [],
    "a conformant accompaniment satisfies its host's badSignal, so the pair fires on BOTH variants and "
    + "reports CONTAMINATED. Add the host's criterion to that piece's `notFor`, or reword the piece — "
    + "never the signal.");
});

test("conformant accompaniments exist and carry the word, or the check above is vacuous", () => {
  const generated = (CASES as Case[]).filter((c) => c.id.endsWith("+with-component-index"));
  assert.ok(generated.length > 0, "no component-index case was generated; the check examines nothing");
  assert.ok(generated.every((c) => /Details<\/a>/.test(String(c.good)) && /Details<\/a>/.test(String(c.bad))),
    "the piece must reach BOTH variants — on the failing one alone it would correlate with the label, "
    + "which is the shortcut this corpus change exists to remove");
  assert.ok(generated.every((c) => c.criterion !== "2.4.4"),
    "a 2.4.4 host received the piece whose word its own case uses as the failure");
  assert.ok(generated.every((c) => !["2.4.3", "2.1.1", "2.1.2"].includes(String(c.criterion))),
    "a focus-order case received four extra focusable links, and `focusOrder` truncates at 12 stops");
  // Asserted on the piece's own markup, which is a VALUE. Diffing the generated page against its host does
  // not work: the two have different IDs, so `withRealisticScale` gives them different furniture, and the
  // residue contained the HOST's `<nav>` rather than the piece's.
  for (const markup of ACCOMPANYING_CONFORMANT["component-index"].markup) {
    assert.ok(!/<nav[\s>]/.test(markup),
      "the piece injects a landmark, which changes NVDA's container prefixes for everything after it — "
      + "measured, it turned a bare \"edit\" into \"main landmark, form, edit\" and blinded three cases");
  }
});

test("an accompaniment adds to a host, it does not DISARM it", () => {
  // `probeForms: piece.probeForms` erased the host's own. Both existing pieces declare one, so nothing
  // noticed until a static piece declared neither and turned `form-error-silent` from
  // `probeForms: true, task: "Submit the request..."` into `false` and `""` — the form was never submitted,
  // no validation error was announced on EITHER variant, and six cases reported CONTAMINATED.
  const hosts = new Map((CASES as Case[]).map((c) => [c.id, c]));
  const generated = (CASES as Case[]).filter((c) => /\+with-[a-z-]+$/.test(c.id));
  assert.ok(generated.length > 0, "no accompanied case exists; this check examines nothing");
  let checked = 0;
  for (const testCase of generated) {
    const host = hosts.get(testCase.id.replace(/\+with-[a-z-]+$/, ""));
    if (!host) continue;
    const hostProbes = host as unknown as { probeForms?: boolean; task?: string };
    const madeProbes = testCase as unknown as { probeForms?: boolean; task?: string };
    if (!hostProbes.probeForms) continue;
    checked += 1;
    assert.ok(madeProbes.probeForms,
      `${testCase.id} lost its host's probeForms, so the evidence its label describes is never captured`);
    assert.ok((madeProbes.task ?? "").length > 0,
      `${testCase.id} lost its host's task; probeForms with no task activates nothing`);
  }
  assert.ok(checked > 0, "no accompanied case had a probing host, so this guard examined nothing");
});
