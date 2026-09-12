/**
 * WHAT DID THIS CAPTURE ASK? -- `whatItAsked`, tested apart from the rest of `capture:explain` (#343).
 *
 * Its own file because `explain-capture.test.ts` imports `explain-capture.mjs`, which reaches
 * `dataset-paths.mjs`, and CI's acceptance job refuses anything that does. These tests read in-memory
 * captures only, so they run there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { whatItAsked } from "./what-it-asked.mjs";

test("WHAT DID IT ASK: a channel nobody asked about is a QUALIFICATION, not a clean result", () => {
  // This report's closing line — "what it does not report, the page does not have" — was a claim nothing
  // checked, and a channel that was never asked is exactly where it is false. Measured before `observed`
  // existed: `formChanges` empty on 4,830 corpus captures and 3,006 of those never asked.
  const rows = whatItAsked({
    observed: {
      headings: { asked: true, complete: true },
      links: { asked: true, complete: false, stop: { prev: "deadline", next: "exhausted" } },
      tableCells: { asked: true, complete: false, stop: { prev: "n/a", next: "n/a" } },
      formChanges: { asked: false, why: "probeForms is off for this capture" },
    },
  });
  const text = rows.join("\n");
  assert.match(text, /NOT ASKED\s+formChanges/, "it must say so in the capture's own words");
  assert.match(text, /! links asked, and the sweep did NOT run out/);
  assert.match(text, /ok headings/);
  assert.match(text, /! tableCells asked, and the sweep did NOT run out/,
    "the table probe's count varies with timing — 4,2,4,4,1,4,4 over 18 captures of one page — so an "
    + "absence there can never be read as the page having none, on any capture");
});

test("#343: a channel the capture SWEPT but recorded no verdict for prints NOT RECORDED -- never nothing", () => {
  // THE EXPECTED SET IS THE CAPTURE'S OWN `structure`, not a list typed here. Every array in `structure` is
  // a sweep, and every sweep writes its verdict into `observed` under the same key (`collectByType`'s
  // `observedAs`, `EXTRA_SWEEPS`' `key`, `tableCells` directly). So a `structure` channel with no `observed`
  // entry is a sweep that left no record -- as `sweepEveryStructuralType`'s one try/catch leaves every
  // channel after the one that threw. `SWEEP_OF` would not do: it names the five channels the census
  // counts and omits `lists`, `tableCells` and `frames`, which the capture also sweeps.
  const rows = whatItAsked({
    structure: { headings: ["Welcome, heading level 1"], lists: [], links: ["Home, link"] },
    observed: { headings: { asked: true, complete: true } },
  });
  const text = rows.join("\n");
  assert.match(text, /ok headings/, "the channel that did record a verdict still reads as it did");
  for (const channel of ["lists", "links"]) {
    assert.ok(rows.some((r) => r.includes("NOT RECORDED") && r.includes(channel)),
      `${channel} was swept and recorded no verdict, so it must print NOT RECORDED -- got: ${JSON.stringify(rows)}`);
  }
  assert.ok(!rows.some((r) => /\bok (lists|links)\b/.test(r)), "an absent verdict must never read as ok");
});

test("#343: only an ARRAY in `structure` is a sweep -- a timestamp or a tally beside them is not a channel", () => {
  const rows = whatItAsked({
    structure: { headings: [], sweptAt: "2026-09-11T03:00:00Z", headingLevels: { 1: 1, 2: 3 } },
    observed: { headings: { asked: true, complete: true } },
  });
  assert.ok(!rows.some((r) => r.includes("sweptAt") || r.includes("headingLevels")),
    `a non-array key is not a sweep, so it cannot be one with no verdict: ${JSON.stringify(rows)}`);
  assert.equal(rows.filter((r) => r.includes("NOT RECORDED")).length, 0);
});

test("#343: ...and a channel this capture never swept is not invented -- an older capture has no `frames`", () => {
  const rows = whatItAsked({
    structure: { headings: [] },
    observed: { headings: { asked: true, complete: true }, formChanges: { asked: false, why: "probeForms is off" } },
  });
  assert.ok(!rows.some((r) => r.includes("frames")), `nothing about frames, which it never swept: ${JSON.stringify(rows)}`);
  assert.equal(rows.filter((r) => r.includes("NOT RECORDED")).length, 0, "every swept channel recorded a verdict");
});

test("a capture predating the field says so, rather than reading as nothing to ask about", () => {
  // Absence read as a clean result is the defect. A pre-protocol-10 capture cannot say, and must not be
  // rendered as though every channel were fine.
  const rows = whatItAsked({ url: "https://example.test/" });
  assert.match(rows.join("\n"), /NOT RECORDED/);
  assert.match(rows.join("\n"), /CAPTURE_PROTOCOL_VERSION 10/);
});
