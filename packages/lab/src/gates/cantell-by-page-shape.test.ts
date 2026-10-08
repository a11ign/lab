/**
 * `cantell-by-page-shape.mjs` groups the calibration pages by the shape their corpus entry declares. The controls are the REAL corpus's own
 * pages, named by url: the GOV.UK table page must land in `table-or-filter` and the skip-link page in `other`, so a regex that matched
 * everything, or nothing, fails one of the two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { REAL_PAGES, pagesFor, realPageFor } from "../training/real-page-corpus.mjs";
import { atLeastTwice, shapeOf, summariseByShape, tableLines } from "../../scripts/cantell-by-page-shape.mjs";

const TABLE_PAGE = "https://design-system.service.gov.uk/components/table/";
const SKIP_LINK_PAGE = "https://design-system.service.gov.uk/components/skip-link/";

/** The sweep's shape, built from the corpus's own calibration pages with a chosen `cantTell` per url. */
const sweepOf = (cantTellFor: (url: string) => string[]) =>
  pagesFor("calibration").map((p) => ({ url: p.url, cantTell: cantTellFor(p.url) }));

test("positive control: the GOV.UK data-table page classifies as table-or-filter", () => {
  const page = realPageFor(TABLE_PAGE);
  assert.equal(page?.demonstrates, "data table with row and column headers", "the control page's declaration moved; re-pick the control");
  assert.equal(shapeOf(page!), "table-or-filter");
});

test("negative control: the GOV.UK skip-link page classifies as other", () => {
  const page = realPageFor(SKIP_LINK_PAGE);
  assert.ok(page, "the control page left the corpus; re-pick the control");
  assert.equal(shapeOf(page), "other");
});

test("the real calibration set has pages in BOTH groups, so the two controls above are not the only members", () => {
  const shapes = pagesFor("calibration").map(shapeOf);
  assert.ok(shapes.includes("table-or-filter"));
  assert.ok(shapes.includes("other"));
});

test("the group counts add to the calibration-page count", () => {
  const rows = summariseByShape(sweepOf(() => []));
  const calibration = REAL_PAGES.filter((p) => p.role === "calibration").length;
  assert.ok(calibration > 0);
  assert.equal(rows.reduce((sum, r) => sum + r.n, 0), calibration);
});

test("a group with no pages prints n=0 and no mean, never NaN", () => {
  const onlyOther = [{ url: SKIP_LINK_PAGE, cantTell: ["1.1.1"] }];
  const rows = summariseByShape(onlyOther);
  const empty = rows.find((r) => r.shape === "table-or-filter")!;
  assert.deepEqual([empty.n, empty.meanCantTell, empty.share413, empty.share331], [0, null, null, null]);
  const printed = tableLines(rows).join("\n");
  assert.ok(!printed.includes("NaN"));
  assert.match(printed, /table-or-filter\s+0\s+-\s+-\s+-/);
  assert.equal(atLeastTwice(rows), null);
});

test("means and shares are over the pages of each group", () => {
  const sweep = [
    { url: TABLE_PAGE, cantTell: ["4.1.3", "3.3.1", "1.3.1", "2.4.1"] },
    { url: SKIP_LINK_PAGE, cantTell: ["4.1.3"] },
    { url: "https://design-system.service.gov.uk/components/tabs/", cantTell: [] },
  ];
  const [shaped, other] = summariseByShape(sweep);
  assert.deepEqual([shaped.n, shaped.meanCantTell, shaped.share413, shaped.share331], [1, 4, 1, 1]);
  assert.deepEqual([other.n, other.meanCantTell, other.share413, other.share331], [2, 0.5, 0.5, 0]);
  assert.equal(atLeastTwice([shaped, other]), true);
});

test("the twice threshold is inclusive and a zero baseline is cannot-tell", () => {
  const row = (shape: "table-or-filter" | "other", meanCantTell: number | null) =>
    ({ shape, n: 1, meanCantTell, share413: null, share331: null, undeclared: 0 });
  assert.equal(atLeastTwice([row("table-or-filter", 2), row("other", 1)]), true);
  assert.equal(atLeastTwice([row("table-or-filter", 1.99), row("other", 1)]), false);
  assert.equal(atLeastTwice([row("table-or-filter", 3), row("other", 0)]), null);
});

test("a scored page the corpus does not declare is counted apart, not dropped silently or put in a group", () => {
  const rows = summariseByShape([{ url: TABLE_PAGE, cantTell: [] }, { url: "https://example.invalid/never-declared", cantTell: ["1.1.1"] }]);
  assert.equal(rows.reduce((sum, r) => sum + r.n, 0), 1);
  assert.equal(rows.reduce((sum, r) => sum + r.undeclared, 0), 1);
});
