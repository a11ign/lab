import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * #659 — `--from-disk` READS BOTH RECORD SHAPES, and reading one found an empty population in a full
 * directory.
 *
 * A dataset capture IS the capture; a `runs/witness/` record WRAPS it as `{capturedAt, task, capture}`.
 * `fromDisk` read only the top level, so pointing it at `runs/witness` — which #659's own Region names —
 * printed *"No captures with diagnostics"* over 24 of them. A tool reporting an empty population is worse
 * than one refusing an unreadable directory, because the empty answer looks like a finding about the data.
 */
test("fromDisk reads a wrapped witness record and a bare dataset capture alike", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fromDisk } = await import("../../scripts/bench-capture.mjs");

  const dir = mkdtempSync(join(tmpdir(), "bench-shapes-"));
  try {
    const diagnostics = [
      { event: "nvdaStart", atMs: 0 },
      { event: "sweep", type: "link", found: 40, prevMs: 3000, nextMs: 3000,
        prevTrips: 20, nextTrips: 20, prevStop: "exhausted", nextStop: "exhausted" },
      { event: "done", atMs: 9000 },
    ];
    writeFileSync(join(dir, "bare.json"),
      JSON.stringify({ url: "https://bare.example/", diagnostics, transcript: ["a"] }));
    writeFileSync(join(dir, "wrapped.json"), JSON.stringify({
      capturedAt: "2026-09-09T00:00:00Z", task: "t",
      capture: { url: "https://wrapped.example/", diagnostics, transcript: ["a"] },
    }));

    const runs = await fromDisk(dir);
    assert.equal(runs.length, 2, "one shape read and the other skipped is the defect this pins");
    assert.deepEqual(runs.map((r: { url?: string }) => r.url).sort(),
      ["https://bare.example/", "https://wrapped.example/"]);
    // The sweep marks must survive the extraction, since that is what the per-type replay reads.
    for (const run of runs) {
      assert.equal((run as { diagnostics: unknown[] }).diagnostics.length, 1,
        "only the sweep marks are kept — holding whole diagnostics for a corpus to read eight numbers is why");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
