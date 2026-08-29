/**
 * A tool that answers "what actually happened on this page" must never answer "fine" when it does not know.
 *
 * Every question about a capture used to be answered by ssh, hand-written Python, a glob and a guess at the
 * JSON shape — and on 2026-08-29 that produced four wrong answers in one session, each looking like a real
 * number. The worst was reading the WRAPPER instead of `capture`: a page with 20 tab stops and 14 form
 * fields reported ZERO of each, because `undefined ?? []` is `[]`.
 *
 * So the properties below are the ones that would make this tool worse than nothing: silently unwrapping
 * wrong, or printing OK for a mark that was never recorded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { captureOf, reachedThePage, reachedTheContent, wasAnythingInTheWay, heldStill,
  sweepAgreesWithTheTree }
  from "../../scripts/explain-capture.mjs";

const withMarks = (...marks: object[]) => ({ diagnostics: marks, transcript: [] });

test("THE WRAPPER IS UNWRAPPED — the exact mistake that reported 0 of 20 tab stops", () => {
  const inner = { transcript: ["x"], diagnostics: [] };
  assert.equal(captureOf({ capture: inner, publishedClaim: "conformant" }), inner);
  // And a bare capture is returned unchanged, so callers need not know which shape they hold.
  assert.equal(captureOf(inner), inner);
});

test("A MARK THAT WAS NEVER RECORDED SAYS SO — it never reads as OK", () => {
  // This project's most expensive defects are all one shape: absent read as zero, undefined read as false,
  // an empty probe read as "the page announced nothing". A diagnostic that repeated it would be worse than
  // none, because it would be believed.
  for (const rows of [reachedThePage(withMarks()), reachedTheContent(withMarks()), heldStill(withMarks())]) {
    assert.ok(rows.some((r) => r.includes("NOT RECORDED")),
      `an absent mark must print NOT RECORDED, got: ${JSON.stringify(rows)}`);
    assert.ok(!rows.some((r) => /\bYES\b/.test(r)),
      "nothing may be reported as confirmed when the evidence for it is missing");
  }
});

test("REACHING THE END IS NOT FAILING TO FINISH — the tool's own first wrong answer", () => {
  // The first version treated anything but `exhausted` as incomplete and reported "the read did NOT
  // finish" on 106 of 106 real captures. `repeatBottom` is arrow-down producing the same phrase at the
  // bottom of the document; `wrap` is a substantial phrase coming round again. Both are the read finding
  // the end, and calling them failures made a diagnostic tool the source of a confident wrong answer at
  // its first use — the exact class it exists to remove.
  for (const stopReason of ["exhausted", "repeatBottom", "wrap"]) {
    const rows = reachedTheContent(withMarks({ event: "readThrough", count: 40, stopReason }));
    assert.ok(rows.some((r) => r.includes("reached the end")), `${stopReason} means the read got there`);
    assert.ok(!rows.some((r) => r.includes("stopped at")), `${stopReason} must not read as giving up`);
  }
  for (const stopReason of ["maxSteps", "deadline", "stepError", "silent"]) {
    const rows = reachedTheContent(withMarks({ event: "readThrough", count: 11, stopReason }));
    assert.ok(rows.some((r) => r.includes("stopped at")), `${stopReason} is the read being cut short`);
  }
});

test("a read that ran out of budget is NOT a page with nothing on it", () => {
  const stopped = reachedTheContent(withMarks({ event: "readThrough", count: 11, stopReason: "maxSteps" }));
  assert.ok(stopped.some((r) => r.includes("stopped at") && r.includes("past where it stopped")),
    "a truncated read must say that an absence below it may be an artefact");
  const finished = reachedTheContent(withMarks({ event: "readThrough", count: 40, stopReason: "exhausted" }));
  assert.ok(finished.some((r) => r.includes("reached the end")));
});

test("THE URL BEING RIGHT AND THE PAGE BEING SERVED ARE DIFFERENT QUESTIONS", () => {
  // An error page has the address you asked for. That distinction cost four captures-that-looked-valid.
  const rows = reachedThePage(withMarks(
    { event: "landedOnRequested", ok: true, actual: "http://x/y", requested: "http://x/y", waitedMs: 3, attempts: 1 },
    { event: "pageServed", status: 0 }));
  assert.ok(rows.some((r) => r.includes("YES the browser showed")));
  assert.ok(rows.some((r) => r.startsWith("    NO ") && r.includes("HTTP 0")),
    "a page nothing served must be reported even when the URL is right");
});

test("A CONSENT BANNER IS NAMED, because guessing about it is half the debugging", () => {
  const banner = wasAnythingInTheWay({ diagnostics: [],
    transcript: ["heading, level 1, Cookie settings", "We use cookies to collect anonymous data"] });
  assert.ok(banner.some((r) => r.includes("CONSENT BANNER")),
    "a page that opens on a banner and a page with nothing to say produce similar evidence; the "
    + "difference decides whether a finding is about the site or about us");
  const clean = wasAnythingInTheWay({ diagnostics: [], transcript: ["heading, level 1, Publications"] });
  assert.ok(clean.some((r) => r.includes("no consent banner")));
});

test("a page that MOVED between probes is reported, and one fingerprint cannot say", () => {
  const moved = heldStill(withMarks(
    { event: "pageState", beforeProbe: "sweep", tabbable: 150 },
    { event: "pageState", beforeProbe: "focus", tabbable: 10 }));
  assert.ok(moved.some((r) => r.includes("CHANGED UNDER ITS OWN PROBES") && r.includes("tabbable")));

  const one = heldStill(withMarks({ event: "pageState", beforeProbe: "sweep", tabbable: 150 }));
  assert.ok(one.some((r) => r.includes("NOT RECORDED") && r.includes("fewer than two")),
    "one fingerprint is not agreement — the third answer must stay distinct from 'it held still'");
});

test("A FAILED FINGERPRINT IS NOT A READING OF ZERO", () => {
  // `markPageState` marks even when the census failed, precisely so the two stay apart.
  const rows = heldStill(withMarks(
    { event: "pageState", beforeProbe: "sweep", tabbable: 150 },
    { event: "pageState", beforeProbe: "focus", error: "not counted" }));
  assert.ok(rows.some((r) => r.includes("NOT RECORDED")),
    "a capture with one usable fingerprint cannot report that the page held still");
});

test("a PRE-§13 capture still explains, with its unjustifiable verdict shown as recorded", () => {
  // `capture:explain` is pointed at captures of any age, and every capture taken before known-gaps §13
  // spells the cross-check `agrees`/`disagreements`/`kind`. A reader that only understood the new names
  // would make the entire existing corpus unexplainable to fix a naming problem — and this tool exists
  // precisely because diagnosing an old capture by hand produced four wrong answers in one session.
  const lines = sweepAgreesWithTheTree({
    diagnostics: [{
      event: "structureCrossCheck", compared: 5, agrees: false,
      disagreements: [{ type: "link", sweep: 7, elementsList: 6, kind: "phantom" }],
    }],
  } as never);
  const raw = lines.find((l: string) => l.includes("worker cross-check"));
  assert.ok(raw, `expected a raw worker line, got ${JSON.stringify(lines)}`);
  assert.match(raw ?? "", /sweep entries 7 vs tree distinct names 6/);
  assert.match(raw ?? "", /a verdict the worker cannot compute/);
});

test("a POST-§13 capture explains with no verdict at all", () => {
  const lines = sweepAgreesWithTheTree({
    diagnostics: [{
      event: "structureCrossCheck", compared: 5, sameCounts: false,
      differsOn: [{ type: "link", sweepEntries: 7, oracleDistinctNames: 6 }],
    }],
  } as never);
  const raw = lines.find((l: string) => l.includes("worker cross-check")) ?? "";
  assert.match(raw, /sweep entries 7 vs tree distinct names 6/);
  assert.ok(!raw.includes("cannot compute"), "there is no verdict to report on a post-§13 capture");
});

