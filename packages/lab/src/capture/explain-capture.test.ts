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

import { captureOf, reachedThePage, reachedTheContent, wasAnythingInTheWay, heldStill, whatItAsked,
  sweepAgreesWithTheTree, whichProbesRan, INTERACTION_PROBES }
  from "../../scripts/explain-capture.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { datasetRoot, captureRoot, realCorpusRoot } from "../dataset-paths.mjs";
import { labCorpusReadable, skipLine } from "../training/corpus-settled.mjs";

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

test("a capture predating the field says so, rather than reading as nothing to ask about", () => {
  // Absence read as a clean result is the defect. A pre-protocol-10 capture cannot say, and must not be
  // rendered as though every channel were fine.
  const rows = whatItAsked({ url: "https://example.test/" });
  assert.match(rows.join("\n"), /NOT RECORDED/);
  assert.match(rows.join("\n"), /CAPTURE_PROTOCOL_VERSION 10/);
});

/**
 * WHICH INTERACTION PROBES RAN — the section added after this tool's own lesson was learned again.
 *
 * `whatItAsked` reads `observed`, which covers the SWEEP channels. The interaction probes are not in it,
 * so their verdicts lived only in diagnostic marks and nothing read them. On 2026-09-05 a real-page
 * capture was fetched to confirm the 1.4.13 probe had run; `cap.focusReveal` is `undefined` because it
 * lives under `interaction`, and "the probe never ran" was concluded from a guessed JSON path. It HAD run
 * — `asked: true, revealed: false, tabs: 8` — and the wrong conclusion would have cost a recapture round.
 */
test("A PROBE THAT NEVER RAN AND ONE THAT FOUND NOTHING ARE DIFFERENT ANSWERS", () => {
  const never = whichProbesRan(withMarks({ event: "focusOrder", stops: 3 }));
  const reveal = never.find((l) => l.includes("1.4.13")) ?? "";
  assert.match(reveal, /NOT ASKED/, "no mark must read as NOT ASKED, never as a clean result");
  assert.match(reveal, /never ran/);

  const ran = whichProbesRan(withMarks(
    { event: "focusReveal", asked: true, revealed: false, why: "nothing appeared on focus", tabs: 8 }));
  const found = ran.find((l) => l.includes("1.4.13")) ?? "";
  assert.match(found, /^\s+ok /, "a probe that ran and found nothing is a RESULT about the page");
  assert.match(found, /revealed=false/);
  assert.match(found, /tabs=8/, "the mark's own fields survive, so nobody has to guess a JSON path");
});

test("a probe that could not ask says WHICH precondition was missing", () => {
  // `observed.<channel>.why` names which precondition, "because 'nobody asked' and 'asked without the
  // probe that makes it meaningful' need opposite fixes".
  const rows = whichProbesRan(withMarks(
    { event: "focusReveal", asked: false, why: "probeFocusOrder did not run" },
    { event: "focusOrder", skipped: "deadline" }));
  assert.match(rows.find((l) => l.includes("1.4.13")) ?? "", /NOT ASKED.*probeFocusOrder did not run/);
  assert.match(rows.find((l) => l.includes("2.4.3")) ?? "", /NOT ASKED.*deadline/);
});

test("a 116-entry event list is a COUNT and a sample, not 116 lines of JSON", () => {
  // The first version printed `focusEventLog`'s events whole and buried the other seven probes' verdicts —
  // the failure this whole section exists to fix, arriving through the fix itself.
  const events = Array.from({ length: 116 }, (_, i) => ({ type: "focusin", id: i, name: "A" }));
  const row = whichProbesRan(withMarks({ event: "focusEventLog", asked: true, eventCount: 116, events }))
    .find((l) => l.includes("2.4.7")) ?? "";
  assert.match(row, /\[116 entries, e\.g\. /, "the count discriminates and one element says what they are");
  assert.ok(row.length < 400, `one probe must fit on one line, got ${row.length} characters`);
});

test("every probe mark real captures carry is NAMED, and every name is carried — both directions", () => {
  // `evidence-fields.test.ts`'s rule, applied to a report: a mark on disk this list does not name is a
  // hole, and a name here no capture carries is a phantom contributing nothing to a coverage claim. The
  // same defect has now been found in four tools, so this one is DISCOVERED rather than trusted.
  //
  // IT FOUND TWO THINGS ON ITS FIRST RUN, which is why it is here rather than a comment. `formFill` was
  // named and 1,182 captures carry `formProbe` instead — one probe with two names across a protocol
  // version, so keying on either alone reports NOT ASKED for half the corpus. And `dialogEscape` was on
  // disk and named nowhere.
  const dirs = [realCorpusRoot(), captureRoot(datasetRoot()),
    captureRoot(datasetRoot("screenreader-acceptance"))];
  const seen = new Set<string>();
  let read = 0;
  /** One capture file's mark names, folded into `seen`. Extracted for `max-depth`, which four levels of
   *  directory/file/mark iteration exceeds — the nesting is real, not incidental. */
  const foldMarks = (path: string) => {
    let capture: { diagnostics?: unknown[] };
    try { capture = captureOf(JSON.parse(readFileSync(path, "utf8"))); } catch { return; }
    if (!Array.isArray(capture.diagnostics)) return;
    read += 1;
    for (const m of capture.diagnostics) {
      const event = (m as { event?: unknown })?.event;
      if (typeof event === "string") seen.add(event);
    }
  };
  for (const dir of dirs) {
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
    for (const f of files) foldMarks(`${dir}/${f}`);
  }
  // SETTLED AS WELL AS PRESENT. This folds every mark name across three capture roots and then asserts
  // that each probe-shaped one is accounted for; a run in flight is writing exactly those marks, so a
  // name it has not written yet is indistinguishable from one nothing produces. The honest absent-skip
  // below stays as it was -- absent and moving are different answers.
  const corpus = labCorpusReadable({ present: read > 0 });
  if (!corpus.read) {
    console.log(skipLine(corpus));
    assert.ok(true, corpus.why);
    return;
  }
  if (read === 0) {
    // AN HONEST SKIP. `runs/` is gitignored, so CI cannot see it — and a test that reports success having
    // examined nothing is how "verified" comes to mean "unexamined".
    assert.ok(true, "SKIPPED: no captures on disk; this check needs runs/");
    return;
  }

  // THE HOLE DIRECTION, and it is the one that catches a new probe. Any mark whose name looks like a
  // probe verdict — the shape every one of them has — must be accounted for by name.
  const named = new Set(INTERACTION_PROBES.flatMap((p) => p.events));
  const probeLike = [...seen].filter((e) => /^(focus|dialog|form|route|arrow|typing)/i.test(e))
    // The BROWSE-MODE bookkeeping that rides with a probe rather than being one: `<probe>BrowseRestored`
    // records that the sweep's mode was put back, and `formStateUnbound` is a warning inside the form
    // probe. Neither is a verdict about the page, which is what this section reports.
    .filter((e) => !/BrowseRestored$|^formState/.test(e));
  for (const e of probeLike) {
    assert.ok(named.has(e), `the mark "${e}" is on disk and INTERACTION_PROBES does not name it — either `
      + `add it with the QUESTION it answers, or exclude it here with the reason it is not a verdict`);
  }

  // THE PHANTOM DIRECTION, and it is bounded by what a LOCAL corpus can know. A probe added after this
  // copy of `runs/` was last synced is legitimately absent here and is not a phantom — so this reports
  // rather than fails, and names them, because a silent pass is what the whole test exists against.
  const unseen = [...named].filter((n) => !seen.has(n));
  if (unseen.length) {
    process.stdout.write(`    (not carried by any of ${read} local captures: ${unseen.join(", ")} — new `
      + "probes look identical to phantoms from a copy of runs/; the authoritative corpus is on the lab)\n");
  }
});
