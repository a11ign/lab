import test from "node:test";
import assert from "node:assert/strict";
import { populationOf, selectPopulation } from "../../scripts/bench-capture.mjs";

/**
 * `bench-capture --from-disk` reported a p50 across every capture in a directory, and a capture
 * directory is not one experiment: `captureProtocol` is a CACHE KEY, so captures either side of a
 * bump ran different code on different guests.
 *
 * Measured on this checkout's own copy, 2026-09-06: **2,122 of 2,178 captures are protocol 5 taken
 * on `192.168.64.x`, the RETIRED local UTM guests.** So the tool answered about a pool that no
 * longer exists, silently — and `docs/backlog.md` was at that moment holding open a row asking
 * whether a disputed "12.4 s" figure came from exactly that retired pool. The tool that would have
 * settled it had the same defect as the number.
 */
const run = (protocol: unknown, worker = "http://w:8765") => ({ protocol, worker, wallMs: 1 });

test("one protocol is not a mix — it reports, and names the population it reports on", () => {
  const chosen = selectPopulation([run(16), run(16)], undefined);
  assert.equal(chosen.refusal, undefined);
  assert.equal(chosen.runs?.length, 2);
  assert.match(String(chosen.scope), /2 capture\(s\) at captureProtocol 16/);
});

test("MORE THAN ONE protocol is REFUSED, not averaged — the whole point of the guard", () => {
  const chosen = selectPopulation([run(16), run(16), run(5)], undefined);
  assert.equal(chosen.runs, undefined, "a mixed population must yield no numbers at all");
  assert.match(String(chosen.refusal), /span 2 capture protocols/);
});

test("the refusal NAMES the mix with counts, so the next command is obvious", () => {
  // A refusal that says only "mixed" sends the reader to write their own jq. This repo's rule is
  // that a guard must be able to say what it caught.
  const chosen = selectPopulation([run(16), run(16), run(16), run(5)], undefined);
  assert.match(String(chosen.refusal), /16=3 5=1/);
  assert.match(String(chosen.refusal), /--protocol=16 {2}the largest population/);
});

test("--protocol=N selects that population and only that one", () => {
  const chosen = selectPopulation([run(16), run(5), run(5)], "5");
  assert.equal(chosen.runs?.length, 2);
  assert.ok(chosen.runs?.every((r: { protocol: unknown }) => r.protocol === 5));
});

test("--protocol=N for a protocol nothing carries REFUSES, and says what IS there", () => {
  // Silently reporting an empty selection as "no data" hides a typo in the flag.
  const chosen = selectPopulation([run(16), run(16), run(5)], "14");
  assert.equal(chosen.runs, undefined);
  assert.match(String(chosen.refusal), /No capture on disk has captureProtocol 14\. Present: 16=2 5=1/);
});

test("--protocol=all averages the mix, and SAYS it was asked for explicitly", () => {
  // The mixed answer stays available; what is removed is getting it by accident.
  // Counts are deliberately unequal: the ordering of a tie is not a contract.
  const chosen = selectPopulation([run(16), run(16), run(5)], "all");
  assert.equal(chosen.runs?.length, 3);
  assert.match(String(chosen.scope), /ALL protocols \(16=2 5=1\) -- asked for explicitly/);
});

test("an ABSENT protocol is a VALUE, never a gap", () => {
  // The cache reads a missing protocol as `unknown`, so those captures match no live guest either.
  // Dropping them would make a mixed corpus look homogeneous, which is the defect wearing the remedy.
  const chosen = selectPopulation([run(16), run(undefined)], undefined);
  assert.match(String(chosen.refusal), /absent=1/);
});

test("the population report counts WORKERS too — 'the run was slow' is only actionable once it names a guest", () => {
  const p = populationOf([run(16, "http://a:8765"), run(16, "http://a:8765"), run(16, "http://b:8765")]);
  assert.deepEqual(p.workers, { "http://a:8765": 2, "http://b:8765": 1 });
  assert.deepEqual(p.protocols, { "16": 3 });
});

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
