// #1726: the same browsing-history leak #1106 fixed for `control` also reaches
// `routeChange.announced`/`formChanges[].after`, one hop over. Kept in its own file for the same reason
// `visited-link-state.test.ts` is: it imports only `compareCapture`, so its Acceptance command never
// touches `dataset-paths.mjs` the way `evidence-diff.test.ts` does through its corpus-sampling
// `CORPUS_DIR` -- a corpus-free command a CI job with no fleet and no corpus can still run and trust.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compareCapture } from "./evidence-diff.mjs";

test("a route-announcement visited leak alone is not an evidence change (#1726)", () => {
  // MEASURED on the ORIGINAL #1106 repeat pair, re-derived while confirming #1106's own fix:
  // `acceptance-route-changes-title-does-not`'s `bad` variant read `announced: ""` on repeat-1
  // (a11y-worker-8) and `announced: "visited"` on repeat-2 (a11y-worker-7) -- the same leak as #1106's
  // `control`, through `probeRouteChange`'s fallback: no heading changed, so the whole activation-delta
  // announcement is nothing but the just-activated link's own visited state. The identical value also
  // lands in the matching `formChanges[]` entry `probeRouteChange` records (`kind: "route"`).
  const routeBefore = { control: null, titleBefore: "Permits", titleAfter: "Permits",
    headingBefore: "Permits", headingAfter: "Permits", navigated: true, announced: "" };
  const routeAfter = { ...routeBefore, announced: "visited" };
  assert.equal(compareCapture(
    { interaction: { routeChange: routeBefore } },
    { interaction: { routeChange: routeAfter } },
  ).verdict, "SAME", "browsing history is a property of the worker's Edge profile, not of the page");

  const formBefore = { control: "Permits, link", kind: "route", after: "" };
  const formAfter = { ...formBefore, after: "visited" };
  assert.equal(compareCapture(
    { interaction: { formChanges: [formBefore] } },
    { interaction: { formChanges: [formAfter] } },
  ).verdict, "SAME", "the same leak reaches formChanges[].after, the row's second field, on the route entry");
});

test("a non-route formChanges entry keeps 'visited' as real content", () => {
  // The half that stops the exclusion becoming the defect it fixes: only the entry `probeRouteChange`
  // itself wrote (`kind: "route"`) is in scope. A form-submit or toggle probe's `after` reading exactly
  // "visited" (a "Mark as visited" confirmation, say) is real page evidence and must still register.
  const before = { control: "Mark as read, button", kind: "toggle", after: "visited" };
  const after = { ...before, after: "" };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [after] } },
  ).verdict, "CHANGED", "'visited' outside a route entry is content, not browsing-history state");
});

test("a visited-announcement leak alongside a real content difference is still CHANGED", () => {
  const routeBefore = { control: null, titleBefore: "Permits", titleAfter: "Permits",
    headingBefore: "Permits", headingAfter: "Permits", navigated: true, announced: "" };
  const routeAfter = { ...routeBefore, announced: "visited", headingAfter: "Other" };
  assert.equal(compareCapture(
    { interaction: { routeChange: routeBefore } },
    { interaction: { routeChange: routeAfter } },
  ).verdict, "CHANGED", "stripping the leaked announcement must not hide an unrelated change on the same object");
});
