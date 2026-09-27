/**
 * #2682: the seven by-hand entries #2655's table found asleep-blind (rows 6, 7 and 11) each call
 * `wakeNamedWorkers` (`./wake-by-hand.mjs`) for exactly the workers they name, before they dispatch a
 * single capture.
 *
 * Two things are asserted, deliberately kept apart:
 *
 *   1. `wakeNamedWorkers` ITSELF, offline by injection: it forwards to `wakeFleet` unchanged (no second
 *      implementation, no second packet rule), a worker `lab:job` already woke gets no second packet, and a
 *      worker that never wakes refuses in #2655's own words.
 *   2. EACH ENTRY calls it, before it dispatches. This reads the entry's SOURCE TEXT, never imports the
 *      entry itself: four of the seven import `dataset-paths.mjs` (a `corpus` reader), and the token-less
 *      acceptance job cannot follow that closure (`row-file`'s warning on this row).
 *
 * The population for (2) is DISCOVERED, not typed in from the Region section, so a census that finds
 * nothing is not silently the same as a census that found seven -- `positive control` below is the proof
 * the discovery itself works, the same shape as `corpusReadable`'s missed `labCorpusReadable(` spelling.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { wakeNamedWorkers } from "./wake-by-hand.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

// ---------------------------------------------------------------------------------------------------
// 1. `wakeNamedWorkers` itself -- offline by injection, no network, no clock.
// ---------------------------------------------------------------------------------------------------

/** A `/health` stand-in that always answers the same way, matching `fleet-wake.test.ts`'s own shape. */
function fixedHealth(json: Record<string, unknown>) {
  return async () => ({ status: 200, ok: true, text: "", json });
}

/** A `/health` stand-in that never answers -- ECONNRESET-style silence, never a status. */
function silentHealth() {
  return async () => {
    throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
  };
}

/** A `/health` stand-in whose connection is refused throughout: the box is up, the worker is not. */
function refusedHealth() {
  return async () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  };
}

test("a worker `lab:job` already woke answers ready on the first probe and is sent NOTHING (#2655 done-when 2)", async () => {
  const sent: string[] = [];
  const verdict = await wakeNamedWorkers(["http://192.0.2.10:8765"], {
    request: fixedHealth({ ok: true, ready: true, busy: false }),
    send: async (mac: string) => { sent.push(mac); return 3; },
  });
  assert.deepEqual(verdict, { ok: true });
  assert.equal(sent.length, 0, "an entry run under `lab:job` must not wake its pool a second time");
});

test("a worker that never answers, with no mac to send, refuses in #2655's own words (no-mac)", async () => {
  const verdict = await wakeNamedWorkers(["http://192.0.2.11:8765"], {
    request: silentHealth(),
    deadlineMs: 0, pollMs: 0, sleep: async () => {}, now: () => 0,
  });
  assert.equal(verdict.ok, false);
  // `wakeReportLine`'s own prose for `no-mac` -- restated here would be a second vocabulary.
  assert.match((verdict as { refusal: string }).refusal, /has no mac in inventory\.yml/);
});

test("a worker that refuses every connection is UP and gets no packet (not-listening)", async () => {
  const sent: string[] = [];
  const verdict = await wakeNamedWorkers(["http://192.0.2.12:8765"], {
    request: refusedHealth(), deadlineMs: 0, pollMs: 0, sleep: async () => {}, now: () => 0,
    send: async (mac: string) => { sent.push(mac); return 3; },
  });
  assert.equal(verdict.ok, false);
  // `wakeReportLine`'s own prose for `not-listening`.
  assert.match((verdict as { refusal: string }).refusal, /never started listening/);
  assert.equal(sent.length, 0, "the box is up: a magic packet changes nothing on it and none is sent");
});

test("named exactly, and nothing else: two workers in, two `wakeFleet` targets out, host taken from the URL", async () => {
  const seen: string[] = [];
  await wakeNamedWorkers(["http://192.0.2.13:8765", "http://192.0.2.14:8765"], {
    request: async (url: string) => { seen.push(new URL(url).hostname); return { status: 200, ok: true, text: "", json: { ok: true, ready: true } }; },
  });
  assert.deepEqual(seen, ["192.0.2.13", "192.0.2.14"]);
});

// ---------------------------------------------------------------------------------------------------
// 2. EACH ENTRY calls it, before it dispatches -- read from source text, never imported.
// ---------------------------------------------------------------------------------------------------

/**
 * Closed ELSEWHERE, not silently dropped: `capture-check.mjs`, `stability-gate.mjs` and
 * `gate-probe-order.mjs` also take `--worker=`, and `evidence-check.mjs` also takes one positionally --
 * but all four are catalogued `lab-job.yml` jobs (`capture-check`, `stability`/`gate-stability`,
 * `gate-probe-order`, `evidence-check`), so they wake THROUGH `lab:job` already (#2655's table, rows 4, 5,
 * 10). A census that also flagged them would ask this row to fix a defect closed by a different one.
 */
const CLOSED_ELSEWHERE = new Set([
  "packages/lab/src/harnesses/capture-check.mjs",
  "packages/lab/scripts/stability-gate.mjs",
  "packages/lab/scripts/gate-probe-order.mjs",
  "packages/lab/scripts/evidence-check.mjs",
]);

/** The module itself, and its own test: a wake call cannot call itself, and prose mentioning the two
 *  signals below is not an entry that needs one. */
const SELF = new Set([
  "packages/lab/src/training/wake-by-hand.mjs",
  "packages/lab/src/training/wake-by-hand.test.ts",
]);

const CANDIDATE_DIRS = ["packages/lab/src/training", "packages/lab/src/harnesses", "packages/lab/scripts"];

/** Every `.mjs`/`.ts` file directly under one of `CANDIDATE_DIRS` (not recursive: none of the three nests). */
function candidateFiles(): string[] {
  const files: string[] = [];
  for (const dir of CANDIDATE_DIRS) {
    const abs = join(REPO, dir);
    for (const name of readdirSync(abs)) {
      if (/\.(mjs|ts)$/.test(name)) files.push(join(dir, name));
    }
  }
  return files;
}

/**
 * Names its workers directly, in the caller's own words: `configuredWorkers()`, a declared `--worker=`
 * flag, or a bare positional `process.argv` read into a variable spelled `worker` (case-insensitive) --
 * `occurrence-verdict-stability.mjs`'s `const WORKER = process.argv[2]` and `bench-capture.mjs`'s
 * `const [worker, ...] = process.argv.slice(2)` take neither a flag nor `configuredWorkers()`, and are
 * exactly `#2655`'s row 11 either way.
 */
function namesAWorkerDirectly(text: string): boolean {
  if (/configuredWorkers\(\)/.test(text)) return true;
  if (/"--worker="/.test(text)) return true;
  return text.split("\n").some((line) => /process\.argv/.test(line) && /\bworker\b/i.test(line));
}

function discoverByHandEntries(): string[] {
  return candidateFiles()
    .filter((path) => !SELF.has(path) && !CLOSED_ELSEWHERE.has(path))
    .filter((path) => namesAWorkerDirectly(readFileSync(join(REPO, path), "utf8")))
    .sort();
}

const REGION_ENTRIES = [
  "packages/lab/scripts/bench-capture.mjs",
  "packages/lab/src/harnesses/capture-fixtures.mjs",
  "packages/lab/src/harnesses/occurrence-verdict-stability.mjs",
  "packages/lab/src/harnesses/page-identity-rate.mjs",
  "packages/lab/src/training/capture-real-pages.mjs",
  "packages/lab/src/training/capture-screenreader-dataset.mjs",
  "packages/lab/src/training/repeat-capture.mjs",
].sort();

test("the census names its positive control: the discovery is not vacuous", () => {
  const discovered = discoverByHandEntries();
  assert.ok(discovered.length > 0, "discovered nothing -- the two signals themselves are untested");
  assert.ok(discovered.includes("packages/lab/src/harnesses/capture-fixtures.mjs"),
    "a known by-hand entry (`capture-fixtures.mjs`, declares `--worker=`) must be discoverable, or the " +
    "signals below are being asked to prove an emptiness they cannot see into");
});

test("the census finds exactly this row's Region, no more and no fewer", () => {
  assert.deepEqual(discoverByHandEntries(), REGION_ENTRIES);
});

/** The text right after the entry's own wake call: proof it runs BEFORE a single capture is dispatched. */
const DISPATCH_MARKER: Record<string, string> = {
  "packages/lab/scripts/bench-capture.mjs": "await collectSamples(page)",
  "packages/lab/src/harnesses/capture-fixtures.mjs": "await captureOverWorker(url, worker, steps)",
  "packages/lab/src/harnesses/occurrence-verdict-stability.mjs": "await capture(base, variant)",
  "packages/lab/src/harnesses/page-identity-rate.mjs": "await runRounds(base, ROUNDS)",
  "packages/lab/src/training/capture-real-pages.mjs": "await captureAcrossPool(toCapture, workers)",
  "packages/lab/src/training/capture-screenreader-dataset.mjs": "await captureDataset(cases, done, pool, lease)",
  "packages/lab/src/training/repeat-capture.mjs": "await captureWithRetry()",
};

for (const path of REGION_ENTRIES) {
  // ONE test per entry (#2682 done-when 4), so a single removed wake call fails exactly one test and
  // names the file it broke, rather than one shared assertion going red for all seven at once.
  test(`${path} calls wakeNamedWorkers before it dispatches`, () => {
    const text = readFileSync(join(REPO, path), "utf8");
    assert.match(text, /from ["'].*wake-by-hand\.mjs["']/,
      `${path} does not import wake-by-hand.mjs`);
    const callIndex = text.search(/wakeNamedWorkers\(/);
    assert.notEqual(callIndex, -1, `${path} never calls wakeNamedWorkers(...)`);
    const marker = DISPATCH_MARKER[path];
    const dispatchIndex = text.indexOf(marker);
    assert.notEqual(dispatchIndex, -1, `${path}'s own dispatch marker (${JSON.stringify(marker)}) moved; update it`);
    assert.ok(callIndex < dispatchIndex,
      `${path} dispatches at offset ${dispatchIndex} before its wake call at offset ${callIndex}`);
  });
}

test("relative-import sanity: REPO resolves to the checkout root, not this file's own directory", () => {
  assert.ok(readdirSync(REPO).includes("packages"), "REPO must point at the checkout root");
  // A path this file computes must be relative to REPO for the errors above to be readable.
  assert.equal(relative(REPO, join(REPO, REGION_ENTRIES[0])), REGION_ENTRIES[0]);
});
