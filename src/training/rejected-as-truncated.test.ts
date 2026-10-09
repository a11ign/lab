import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT } from "../dataset-paths.mjs";
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

// THE INTEGRATION: the shaper's own tests cannot see whether `writeProvenance` is handed the rejected set at
// all -- pass it `[]` and every test above stays green (reviewer-2's mutation on #2384). So this runs the
// BUILD, on a fixture corpus, and reads the `.source.json` it wrote.
const CLEAN = "https://www.w3.org/WAI/tutorials/images/decorative/";
const TRUNCATED = [
  "https://www.w3.org/WAI/tutorials/images/informative/",
  "https://www.w3.org/WAI/tutorials/images/functional/",
];

function corpusEntry(url: string, diagnostics: object[]) {
  return {
    role: "training",
    publishedClaim: "clean",
    claimSource: "https://www.w3.org/WAI/",
    demonstrates: "images",
    capturedAt: "2026-09-14T00:00:10.389Z",
    capture: { url, transcript: [], diagnostics, environment: { captureProtocol: 21 } },
  };
}

function buildIn(dir: string, entries: ReturnType<typeof corpusEntry>[]) {
  const corpus = join(dir, "corpus");
  mkdirSync(corpus);
  entries.forEach((e, i) => writeFileSync(join(corpus, `${i}.json`), JSON.stringify(e)));
  const base = join(dir, "base.jsonl");
  writeFileSync(base, JSON.stringify({ id: "generated-1" }) + "\n");
  const out = join(dir, "with-realism.jsonl");
  const run = spawnSync(process.execPath, ["packages/lab/scripts/build-realism-tier.mjs", `--out=${out}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, REAL_CORPUS_ROOT: corpus, DATASET_EXPORT: base, A11Y_RUNS_READONLY: "" },
  });
  assert.equal(run.status, 0, `the build must run on the fixture corpus: ${run.stderr}${run.stdout}`);
  return { run, provenance: JSON.parse(readFileSync(`${out}.source.json`, "utf8")) };
}

test("the build writes both rejected urls and their gaps into .source.json, beside realismRecords (#2383)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rejected-as-truncated-"));
  try {
    const sweep = (type: string, nextStop: string) => ({ event: "sweep", type, prevStop: "exhausted", nextStop });
    const entries = [
      corpusEntry(CLEAN, [sweep("heading", "exhausted")]),
      corpusEntry(TRUNCATED[0], [sweep("heading", "repeat")]),
      corpusEntry(TRUNCATED[1], [{ event: "readThrough", stopReason: "cap" }, sweep("heading", "deadline")]),
    ];
    const { run, provenance } = buildIn(dir, entries);
    // Positive control for the emptiness below: one capture WAS usable, so this is a partition, not a wipe-out.
    assert.equal(provenance.realismRecords, 1);
    assert.match(run.stdout, new RegExp(`rejected as truncated: ${TRUNCATED.length} of ${entries.length}`));
    assert.deepEqual(provenance.rejectedAsTruncated, [
      { url: TRUNCATED[1], gaps: [gap("heading", "starved", "deadline"), gap("read-through", "capped", "cap")] },
      { url: TRUNCATED[0], gaps: [gap("heading", "inferred", "repeat")] },
    ]);
    assert.equal(provenance.rejectedAsTruncated.length, entries.length - provenance.realismRecords);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a build that rejected nothing writes [] into .source.json, not an absent key (#2383)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rejected-as-truncated-"));
  try {
    const { provenance } = buildIn(dir, [corpusEntry(CLEAN, [])]);
    assert.equal(provenance.realismRecords, 1);
    assert.deepEqual(provenance.rejectedAsTruncated, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
