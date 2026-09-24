import { test } from "node:test";
import assert from "node:assert/strict";

import { rejectedAsTruncated } from "./rejected-as-truncated.mjs";

const gap = (channel: string, kind = "inferred", reason = "repeat") => ({ channel, reason, kind });

// Two truncated captures, as #2215's two w3 tables pages: the same channels ending the same way.
const rejection = (url: string, ...gaps: ReturnType<typeof gap>[]) => ({ url, gaps });
const TABLES = "https://www.w3.org/WAI/tutorials/tables/";
const TABLES_2 = "https://www.w3.org/WAI/tutorials/tables/irregular/";

test("both truncated captures' urls and gaps read back from the shaped list (#2383)", () => {
  const shaped = rejectedAsTruncated([
    rejection(TABLES, gap("formField"), gap("heading")),
    rejection(TABLES_2, gap("formField"), gap("heading")),
  ]);
  assert.deepEqual(shaped.map((r) => r.url), [TABLES, TABLES_2]);
  assert.deepEqual(shaped[0].gaps, [gap("formField"), gap("heading")]);
  // JSON round trip: this is what lands in `.source.json`, and `undefined` fields would vanish from it.
  assert.deepEqual(JSON.parse(JSON.stringify(shaped)), shaped);
});

test("the list is sorted by url whatever order the captures were read in, so two builds diff cleanly", () => {
  const a = rejection("https://a.test/", gap("heading"));
  const b = rejection("https://b.test/", gap("heading"));
  assert.deepEqual(rejectedAsTruncated([b, a]), rejectedAsTruncated([a, b]));
  assert.deepEqual(rejectedAsTruncated([b, a]).map((r) => r.url), ["https://a.test/", "https://b.test/"]);
});

test("each url's gaps are sorted too, and a gap keeps only channel, reason and kind", () => {
  const shaped = rejectedAsTruncated([
    rejection("https://a.test/", { ...gap("heading"), extra: 1 } as never, gap("border"), gap("heading", "cap", "read-through:capped")),
  ]);
  assert.deepEqual(shaped[0].gaps, [
    gap("border"),
    gap("heading", "cap", "read-through:capped"),
    gap("heading"),
  ]);
});

test("the list's length is what the build's counts leave over: entries - realismRecords (#2383)", () => {
  // A list that drifts from the count is the defect this row removes. `completeCaptures` partitions the
  // entries, so usable + rejected is every entry; the provenance's list must be the `rejected` half whole.
  const entries = ["https://a.test/", "https://b.test/", TABLES, TABLES_2].map((url) => ({ url }));
  const rejectedUrls = new Set([TABLES, TABLES_2]);
  const rejected = entries.filter((e) => rejectedUrls.has(e.url)).map((e) => rejection(e.url, gap("heading")));
  const realismRecords = entries.length - rejected.length;
  assert.equal(realismRecords, 2);
  assert.equal(rejectedAsTruncated(rejected).length, entries.length - realismRecords);
});

test("a base-only build has nothing rejected and says so with [], not by omission", () => {
  // Positive control for the emptiness: the cases above are non-empty, so `[]` here is the empty-input answer.
  assert.deepEqual(rejectedAsTruncated([]), []);
});

test("the shaper does not mutate what completeCaptures returned", () => {
  const input = [rejection("https://b.test/", gap("heading"), gap("border")), rejection("https://a.test/", gap("heading"))];
  const before = JSON.stringify(input);
  rejectedAsTruncated(input);
  assert.equal(JSON.stringify(input), before);
});
