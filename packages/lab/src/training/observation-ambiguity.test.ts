/**
 * PROVE THE AUDIT CAN TELL ITS OWN CASES APART BEFORE BELIEVING ITS NUMBER.
 *
 * On the corpus copy this was written against, every channel reported 100% UNSUPPORTED — which is either
 * the finding or an audit that classifies everything the same way, and those look identical from outside.
 * That is this repo's most-recorded failure: a check that reports a result having examined nothing.
 * `verify.corpus.test.ts`'s first version read `capture.interaction.sweepLog`, a field that does not
 * exist, and passed against the very corpus carrying 604 crashes.
 *
 * So each verdict gets a capture built to produce it, and the assertions are that the audit SEPARATES
 * them — not merely that it runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHANNEL_FIELD, observationAmbiguity } from "./observation-ambiguity.mjs";
import { SWEEP_OF } from "@a11y-witness/evidence/verify";

/** A capture carrying an AX-tree census, which is what `sweepCompleteness` compares the sweep against. */
function capture(distinct: Record<string, number>, structure: Record<string, string[]>,
  extra: Record<string, unknown> = {}) {
  return {
    url: "https://example.test/",
    screenReader: "NVDA",
    transcript: ["Example, document"],
    structure: { headings: [], links: [], landmarks: [], graphics: [], formFields: [], lists: [], ...structure },
    interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
    diagnostics: [{ event: "structureCensus", distinct }] as Record<string, unknown>[],
    ...extra,
  };
}

test("a page the census agrees has no headings is SUPPORTED absence", () => {
  const { channels } = observationAmbiguity([capture({ heading: 0 }, { headings: [] })]);
  assert.equal(channels.heading.empty, 1);
  assert.equal(channels.heading.emptySupported, 1, "census says 0 and the sweep found 0 — the page has none");
  assert.equal(channels.heading.sweepMissed, 0);
  assert.equal(channels.heading.cannotSay, 0);
});

test("a sweep that found nothing where the census counts three is UNSUPPORTED — the landmark_present shape", () => {
  const { channels } = observationAmbiguity([capture({ heading: 3 }, { headings: [] })]);
  assert.equal(channels.heading.empty, 1);
  assert.equal(channels.heading.sweepMissed, 1, "the page HAS headings; the sweep missed them");
  assert.equal(channels.heading.cannotSay, 0, "a truncated sweep is a CAPTURE defect, not a missing census");
  assert.equal(channels.heading.emptySupported, 0);
  assert.equal(channels.heading.verdicts.truncated, 1);
});

test("SUPPORTED and UNSUPPORTED are counted separately over a mixed corpus", () => {
  const { channels, scanned } = observationAmbiguity([
    capture({ heading: 0 }, { headings: [] }),
    capture({ heading: 0 }, { headings: [] }),
    capture({ heading: 4 }, { headings: [] }),
  ]);
  assert.equal(scanned, 3);
  assert.equal(channels.heading.emptySupported, 2);
  assert.equal(channels.heading.sweepMissed, 1);
});

test("a non-empty channel is not counted as an absence at all", () => {
  const { channels } = observationAmbiguity([capture({ heading: 1 }, { headings: ["Welcome, heading, level 1"] })]);
  assert.equal(channels.heading.empty, 0, "the feature reads 1 here; this audit is only about the zeros");
});

test("a capture with no census answers `unknown` and never `exact` — absence must not read as agreement", () => {
  const noCensus = { ...capture({}, {}), diagnostics: [] };
  const { channels, noCensus: count } = observationAmbiguity([noCensus]);
  assert.equal(count, 1);
  assert.equal(channels.heading.verdicts.unknown, 1);
  assert.equal(channels.heading.emptySupported, 0, "`unknown` is a verdict about this tool, not about the page");
  assert.equal(channels.heading.cannotSay, 1);
  assert.equal(channels.heading.sweepMissed, 0,
    "NO CENSUS AND A MISSED SWEEP ARE DIFFERENT ANSWERS. Reporting them as one number is what made this "
    + "audit's own first run say `heading 94.9% UNSUPPORTED` about a corpus whose sweeps were largely fine.");
});

test("an empty formChanges is UNASKED without the probe's mark and ASKED with it", () => {
  const unasked = observationAmbiguity([capture({ heading: 0 }, {})]);
  assert.equal(unasked.interaction.formChanges.empty, 1);
  assert.equal(unasked.interaction.formChanges.emptyNotAsked, 1, "no formProbe mark — probeForms never ran");

  const asked = capture({ heading: 0 }, {});
  asked.diagnostics.push({ event: "formProbe", activated: 0 });
  const marked = observationAmbiguity([asked]);
  assert.equal(marked.interaction.formChanges.empty, 1);
  assert.equal(marked.interaction.formChanges.emptyNotAsked, 0, "the probe ran and the page said nothing");
});

test("the channel list is DERIVED from SWEEP_OF, so a new sweep type cannot be silently unaudited", () => {
  for (const type of Object.keys(SWEEP_OF)) {
    assert.ok(type in CHANNEL_FIELD, `${type} is swept and must be audited`);
    assert.equal(CHANNEL_FIELD[type as keyof typeof CHANNEL_FIELD], SWEEP_OF[type]);
  }
  assert.ok("tableCells" in CHANNEL_FIELD, "sweepCompleteness adds tableCells separately and it must be covered");
});
