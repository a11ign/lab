/**
 * `rules:real-pages` SCORES 85 PAGES DRAWN FROM TWO CAPTURE RUNS, and until 2026-09-06 said nothing.
 *
 * `capture-real-pages` DEFAULTS to `--role=training`, which is 39 of the 85; the other 46 are
 * `calibration`. So the ordinary way to refresh the corpus refreshes HALF of it, and the gate then compares
 * a mixed population against one baseline. It already refuses when a role is MISSING — the harder case is
 * every page present and half of them old, which looks exactly like a healthy corpus.
 *
 * MEASURED the night this was added. A run reported 42 new findings over captures spanning 01:54 to 03:55,
 * and reading one of the OLDER ones produced a confident wrong conclusion: that two diagnostic fields were
 * absent specifically on fallback pages, when they were absent because that capture predated the fields.
 * A mechanism argument was already half-written when one timestamp settled it. That is this repo's own
 * rule — a number is only as good as what it was computed from, so make every reported number carry that.
 *
 * The sibling of `gate-states-its-path.test.ts`: that one makes `rules:gate` say it reads a FROZEN export,
 * this one makes `rules:real-pages` say how old the captures it read are. Two gates, one corpus, and the
 * defect both close is a silence that reads as agreement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { captureAgeLines } from "../../scripts/check-real-page-findings.js";

const HOUR = "2026-09-06T0";

test("one capture run does NOT warn — the normal case must stay quiet", () => {
  // A pipeline capturing both roles back to back is what SHOULD happen, and a gate that warns on it is a
  // gate people learn to scroll past. This is the assertion that stops the check becoming noise.
  const lines = captureAgeLines([
    { at: `${HOUR}3:31:00.000Z`, role: "training" },
    { at: `${HOUR}4:55:00.000Z`, role: "calibration" },
  ]);
  assert.equal(lines.filter((l) => l.includes("***")).length, 0,
    `a 1.4-hour spread is one pipeline, not a mixed population:\n${lines.join("\n")}`);
  assert.ok(lines.some((l) => l.includes("training: 1 capture(s)")), "each role is still counted");
});

test("a half-refreshed corpus WARNS, and names the command that refreshes every role", () => {
  const lines = captureAgeLines([
    { at: "2026-08-09T10:24:50.229Z", role: "calibration" },
    { at: `${HOUR}3:31:00.000Z`, role: "training" },
  ]);
  const warnings = lines.filter((l) => l.includes("***")).join("\n");
  assert.match(warnings, /MIXED population/,
    "the whole point is that every page is present and half of them are old");
  assert.match(warnings, /--role=training, which refreshes 39 of the 85/,
    "it must name the CAUSE — the default role — not just the symptom");
  assert.match(warnings, /pipeline=real-pages/,
    "and the command that settles it, as check-signals and the starvation audit already do");
});

test("no capturedAt anywhere prints NOT RECORDED, never a clean age", () => {
  // `capture:explain`'s rule, and the reason this whole divergence survived: a silence read as agreement.
  // A corpus of captures too old to carry `capturedAt` must not read as a corpus captured just now.
  assert.deepEqual(captureAgeLines([]),
    ["  capture ages: NOT RECORDED — no scored capture carries `capturedAt`"]);
});

test("the warning is a THRESHOLD, so it reports hours rather than merely that they differ", () => {
  // "A number beats a word" — `crossCheckStructure`'s rule. "The captures differ in age" cannot tell an
  // hour from a month, and a month is the case that produced the wrong conclusion.
  const lines = captureAgeLines([
    { at: "2026-08-09T10:00:00.000Z", role: "calibration" },
    { at: "2026-09-06T10:00:00.000Z", role: "training" },
  ]);
  assert.ok(lines.some((l) => /\d{3} hour\(s\) between the oldest and newest/.test(l)),
    `a 28-day spread must be reported in hours, not as a bare flag:\n${lines.join("\n")}`);
});

test("a page unusable for TWO reasons is one page, not two", () => {
  // `unusable` used to be `consent.length + shell.length + suspectCensus.length`, three lists that can
  // each name the SAME page. Measured 2026-09-06, the first run where the numbers were small enough to
  // check by eye: `tfl.gov.uk/modes/tube/` was in `furniture.consent` AND in `suspectCensus` -- its consent
  // banner blocked the read and the page redirected, so no CDP target could be confirmed either. Two
  // distinct unusable pages were reported as three, and the verdict read `82 of 85` where the truth is 83.
  //
  // Harmless at 54 and misleading at 2, which is exactly when it starts mattering: this denominator's whole
  // job is deciding whether a run is CONCLUSIVE, and it also over-states the work remaining -- which is how
  // a list acquires an item nobody can close.
  //
  // Asserted on the SOURCE because the surrounding function needs a corpus, and `runs/` is gitignored, so
  // an integration test here would skip in CI and in every fresh worktree -- a check that reports clean
  // having examined nothing, which is the defect this whole file exists to close.
  const source = readFileSync(
    fileURLToPath(new URL("../../scripts/check-real-page-findings.ts", import.meta.url)), "utf8");
  // Asserted on the SET being built, not on the variable name, because the reporting phase was extracted
  // after this test was written and the name moved with it. The PROPERTY is what matters: the three lists
  // are unioned before anything counts them.
  assert.match(source, /const unusablePages = \[\.\.\.new Set\(\[\.\.\.furniture\.consent/,
    "the three lists must be UNIONED into a set of page urls; summing their LENGTHS counts a page once "
    + "per reason");
  assert.match(source, /examined: pages - unusablePages\.length,/,
    "and the count must come from that set, not from the lists");
  assert.doesNotMatch(source, /const unusable = .*\.length \+/,
    "the summed form is back, so a page unusable for two reasons is being counted twice again");
});

test("the role LEFT BEHIND is named, with the command that refreshes just it", () => {
  // `--role` is a free string filter, so every role is technically reachable; what nothing said is which
  // one the last refresh MISSED. Measured 2026-09-06: the corpus holds training (39), calibration (49) and
  // `fixture` (4), `capture-real-pages`'s usage line documents only the first two, and the four fixture
  // captures had not been retaken in twelve days. Nobody was ignoring them — there was no line that named
  // them.
  const lines = captureAgeLines([
    { at: "2026-09-06T04:43:00.000Z", role: "training" },
    { at: "2026-09-06T05:14:00.000Z", role: "calibration" },
    { at: "2026-08-25T10:27:00.000Z", role: "fixture" },
  ]);
  const behind = lines.filter((l) => l.includes("LEFT BEHIND")).join("\n");
  assert.match(behind, /role 'fixture'/, "the role that was missed must be named, not merely implied");
  assert.match(behind, /-e role=fixture/, "and the command that refreshes just it, not the whole corpus");
  assert.doesNotMatch(behind, /'training'|'calibration'/,
    "a role refreshed by the last run must NOT be named — a warning that fires on correct usage is one "
    + "people learn to scroll past");
});

test("one pipeline refreshing every role names NO role as left behind", () => {
  const lines = captureAgeLines([
    { at: "2026-09-06T03:31:00.000Z", role: "training" },
    { at: "2026-09-06T04:55:00.000Z", role: "calibration" },
    { at: "2026-09-06T05:10:00.000Z", role: "fixture" },
  ]);
  assert.equal(lines.filter((l) => l.includes("LEFT BEHIND")).length, 0,
    `all three refreshed within the window, so nothing was left behind:\n${lines.join("\n")}`);
});
