// #1106: browsing history reaches the evidence. Kept in its own file, importing only `compareCapture`,
// so its Acceptance command never touches `dataset-paths.mjs` the way `evidence-diff.test.ts` does through
// its corpus-sampling `CORPUS_DIR` -- a corpus-free command a CI job with no fleet and no corpus can still
// run and trust.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compareCapture } from "./evidence-diff.mjs";

test("a visited-link difference alone is NOT an evidence change (#1106)", () => {
  // MEASURED on the acceptance repeat pair, 5109abd7, protocol 17: `acceptance-route-changes-title-does-not`
  // read "... Permits, visited, same page, link" in repeat-1 and "... Permits, same page, link" in
  // repeat-2, 2 of 138 records, nothing about the page or the code changed between the two captures.
  // `browser-profile.mjs` keeps one Edge profile alive across every capture a worker takes, so whether a
  // link reads "visited" depends on which OTHER pages that worker happened to capture earlier -- a fact
  // about this run's history, not the page.
  const before = { control: "navigation landmark, list, with 2 items, Permits, visited, same page, link",
    kind: "route", after: "" };
  const after = { ...before, control: "navigation landmark, list, with 2 items, Permits, same page, link" };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [after] } },
  ).verdict, "SAME", "browsing history is a property of the worker's Edge profile, not of the page");

  assert.equal(compareCapture(
    { interaction: { routeChange: before } },
    { interaction: { routeChange: after } },
  ).verdict, "SAME", "the same noise reaches routeChange.control, the row's second compared field");
});

test("a control whose NAME contains the word 'visited' is still compared", () => {
  // The half that stops the exclusion becoming the defect it fixes — exact segment match only, so a link
  // actually named "Recently visited pages" is not silently exempted from comparison.
  const before = { control: "Recently visited pages, link", kind: "route", after: "" };
  const after = { ...before, control: "Recently viewed pages, link" };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [after] } },
  ).verdict, "CHANGED", "the word appearing INSIDE a name is content, not state, and must still register");
});

test("a visited difference alongside a real content difference is still CHANGED", () => {
  const before = { control: "Permits, visited, same page, link", kind: "route", after: "" };
  const after = { control: "Permits, same page, link", kind: "route", after: "moved" };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [after] } },
  ).verdict, "CHANGED", "stripping `visited` must not hide an unrelated change in the same entry");
});
