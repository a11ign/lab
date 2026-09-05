// @ts-check
// Measure what a capture actually costs, phase by phase.
//
//   node scripts/bench-capture.mjs <worker-url> <page-url> [count]
//
// Why this exists: per-capture cost is the constraint on the training dataset. A run of 45
// page pairs took 98 minutes, and the phase timings showed only 13 of every 50 seconds was
// real work -- the rest was fixed sleeps and restarting NVDA 90 times. Optimising that by
// eye is how you end up "faster" and wrong, so measure it.
//
// It reports phrase counts alongside the timings on purpose. A capture that got quicker by
// reading less is not an improvement, and a suite that only asserts "it ran" stays green
// while the evidence turns to garbage (see CLAUDE.md).
import { setTimeout as sleep } from "node:timers/promises";
import { CAPTURE_CLIENT_TIMEOUT_MS } from "../../worker-fleet/src/worker-http.mjs";

import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { captureTolerantly } from "../../worker-fleet/src/capture-client.mjs";
import { datasetRoot, captureRoot } from "../src/dataset-paths.mjs";

/**
 * `--from-disk` decides whether it measures a live capture or replays one; mistyped, it silently
 * drives the fleet when you meant to read a file.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--dir=", "--from-disk"], { entry: import.meta.url, command: "npm run bench:capture" });

const [worker, page, countArg] = process.argv.slice(2);

/**
 * The timing samples, and how many were thrown away.
 *
 * A RECOVERED SAMPLE IS NOT A TIMING SAMPLE: its wall clock is a capture plus a socket timeout plus a
 * recovery round trip. Keeping it would make this tool report the transport as capture cost, which is the
 * misattribution that once sent an afternoon after the wrong subsystem.
 *
 * @param {string} page
 */
async function collectSamples(page) {
  const runs = [];
  let recovered = 0;
  for (let i = 1; i <= COUNT; i++) {
    const { wallMs, body, recovered: wasRecovered } = await capture(page);
    if (wasRecovered) {
      recovered += 1;
      console.log(`capture ${i}/${COUNT}: EXCLUDED — response recovered after a lost socket, so its `
        + "wall clock is not a capture cost");
    } else {
      const start = (body.diagnostics ?? []).find((/** @type {any} */ e) => e.event === "nvdaStart");
      runs.push({
        wallMs,
        costs: phaseCosts(body.diagnostics),
        phrases: (body.transcript ?? []).length,
        reused: !!start?.reused,
      });
      console.log(`capture ${i}/${COUNT}: ${(wallMs / 1000).toFixed(1)}s, ${runs.at(-1)?.phrases} phrases${runs.at(-1)?.reused ? " (NVDA reused)" : ""}`);
    }
    if (i < COUNT) await sleep(BETWEEN_MS);
  }
  return { runs, recovered };
}

/**
 * Was this file RUN, or merely imported?
 *
 * CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check that an .mjs file still loads —
 * neither lint nor tsc can see a ReferenceError at import. Unguarded, that mandated check ran this whole
 * benchmark: it drove real captures against a worker, and on a machine with none it exited the IMPORTING
 * process with a usage error. Either way the check you are told to run is one you cannot safely run.
 */
const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (IS_MAIN && !process.argv.includes("--from-disk") && (!worker || !page)) {
  console.error("usage: node scripts/bench-capture.mjs <worker-url> <page-url> [count]\n" +
    "   or: node scripts/bench-capture.mjs --from-disk [--dir=<captures dir>]");
  process.exit(1);
}
const COUNT = Number(countArg || 3);
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
const BETWEEN_MS = 1_000;

async function capture(/** @type {any} */ url) {
  const startedAt = Date.now();
  const response = await captureTolerantly({
    worker,
    body: { url, task: "Benchmark the capture cost" },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const body = response.json ?? {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  // A RECOVERED SAMPLE IS NOT A TIMING SAMPLE, and this is the one client where that matters. Its wall
  // clock includes a socket timeout plus a recovery round trip, so counting it would inflate the very
  // number this tool exists to measure -- and a p95 quietly poisoned by the transport is exactly the
  // "timing number with no foundation underneath it" this repo has already chased down the wrong path.
  //
  // Kept rather than dropped silently: the caller reports how many were excluded, because a benchmark
  // that discards a fifth of its samples without saying so is worse than one that fails.
  return { wallMs: Date.now() - startedAt, body, recovered: response.recovered };
}

// Diagnostics carry cumulative atMs, so each phase's own cost is the gap from the last one.
function phaseCosts(/** @type {any} */ diagnostics) {
  /** @type {Record<string, any>} */
  const costs = {};
  let previous = 0;
  for (const entry of diagnostics ?? []) {
    if (typeof entry.atMs !== "number") continue;
    costs[entry.event] = (costs[entry.event] ?? 0) + (entry.atMs - previous);
    previous = entry.atMs;
  }
  return costs;
}

function mean(/** @type {any} */ values) {
  return values.reduce((/** @type {any} */ a, /** @type {any} */ b) => a + b, 0) / values.length;
}

function report(/** @type {any} */ runs) {
  /** @type {Record<string, any>} */
  const phases = {};
  for (const run of runs) {
    for (const [phase, ms] of Object.entries(run.costs)) (phases[phase] ??= []).push(ms);
  }
  const rows = Object.entries(phases)
    .map(([phase, values]) => ({ phase, seconds: +(mean(values) / 1000).toFixed(1) }))
    .sort((a, b) => b.seconds - a.seconds);

  console.log(`\nphase cost, mean of ${runs.length} captures:`);
  for (const { phase, seconds } of rows) {
    console.log(`  ${phase.padEnd(18)}${String(seconds).padStart(6)}s  ${"#".repeat(Math.round(seconds))}`);
  }
  const wall = mean(runs.map((/** @type {any} */ r) => r.wallMs)) / 1000;
  console.log(`  ${"WALL".padEnd(18)}${wall.toFixed(1).padStart(6)}s`);

  // Faster is only better if the capture still heard the page.
  const phrases = runs.map((/** @type {any} */ r) => r.phrases);
  console.log(`\nphrases per capture: ${phrases.join(", ")} (mean ${mean(phrases).toFixed(1)})`);
  const empty = phrases.filter((/** @type {any} */ p) => p === 0).length;
  if (empty) console.log(`  WARNING: ${empty} capture(s) returned NOTHING — faster but broken`);
  const reused = runs.filter((/** @type {any} */ r) => r.reused).length;
  console.log(`NVDA reused on ${reused}/${runs.length} captures`);
}

// --- from-disk mode -------------------------------------------------------
//
// The same summariser, over captures already on disk. A live benchmark tells you what a capture
// costs NOW on one worker; this tells you what a whole run cost across the pool, which is the
// question when a run was slower than usual and the workers have since been shut down.
//
// Nothing new is instrumented: every capture already carries per-phase diagnostics. This only
// aggregates them, and reports p50/p95 rather than a mean because the tail is where a wedged
// guest shows up -- a mean hides one 60-second capture among fifty good ones.
async function fromDisk(/** @type {any} */ root) {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const files = readdirSync(root).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const runs = [];
  for (const file of files) {
    let capture;
    try {
      capture = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    } catch { continue; } // a partial write is not a data point
    if (!Array.isArray(capture.diagnostics)) continue;
    const done = capture.diagnostics.filter((/** @type {any} */ e) => typeof e.atMs === "number").at(-1);
    const start = capture.diagnostics.find((/** @type {any} */ e) => e.event === "nvdaStart");
    runs.push({
      // No client-side timing on disk, so the last diagnostic's atMs is the in-capture duration.
      // Labelled WALL(in-capture) rather than WALL so nobody compares it with the live number.
      wallMs: done?.atMs ?? 0,
      costs: phaseCosts(capture.diagnostics),
      phrases: (capture.transcript ?? []).length,
      reused: !!start?.reused,
      worker: capture.provenance?.worker ?? "unrecorded",
    });
  }
  return runs;
}

function percentile(/** @type {any} */ values, /** @type {any} */ p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function reportFromDisk(/** @type {any} */ runs) {
  /** @type {Record<string, any>} */
  const phases = {};
  for (const run of runs) {
    for (const [phase, ms] of Object.entries(run.costs)) (phases[phase] ??= []).push(ms);
  }
  console.log(`\nphase cost across ${runs.length} captures on disk (p50 / p95, seconds):`);
  for (const [phase, values] of Object.entries(phases)
    .sort((a, b) => percentile(b[1], 50) - percentile(a[1], 50))) {
    const p50 = (percentile(values, 50) / 1000).toFixed(1);
    const p95 = (percentile(values, 95) / 1000).toFixed(1);
    console.log(`  ${phase.padEnd(18)}${p50.padStart(6)}s  ${p95.padStart(6)}s  ${"#".repeat(Math.round(+p50))}`);
  }
  const walls = runs.map((/** @type {any} */ r) => r.wallMs);
  console.log(`  ${"WALL(in-capture)".padEnd(18)}${(percentile(walls, 50) / 1000).toFixed(1).padStart(6)}s  ` +
    `${(percentile(walls, 95) / 1000).toFixed(1).padStart(6)}s`);

  const empty = runs.filter((/** @type {any} */ r) => r.phrases === 0).length;
  if (empty) console.log(`\nWARNING: ${empty}/${runs.length} captures on disk have NO phrases`);

  // Per worker, because "the run was slow" is only actionable once it names a guest.
  /** @type {Record<string, any>} */
  const byWorker = {};
  for (const run of runs) (byWorker[run.worker] ??= []).push(run.wallMs);
  if (Object.keys(byWorker).length > 1 || !byWorker.unrecorded) {
    console.log("\nper worker (p50 / p95 in-capture seconds, count):");
    for (const [worker, walls2] of Object.entries(byWorker)) {
      console.log(`  ${worker.padEnd(28)}${(percentile(walls2, 50) / 1000).toFixed(1).padStart(6)}s  ` +
        `${(percentile(walls2, 95) / 1000).toFixed(1).padStart(6)}s  n=${walls2.length}`);
    }
  }
}

if (IS_MAIN) await main();

async function main() {
  if (process.argv.includes("--from-disk")) {
    const dirArg = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
    const dir = dirArg ?? captureRoot(datasetRoot());
    const fromDiskRuns = await fromDisk(dir);
    if (!fromDiskRuns.length) {
      console.error(`No captures with diagnostics under ${dir}`);
      process.exit(1);
    }
    reportFromDisk(fromDiskRuns);
    process.exit(0);
  }

  const { runs, recovered } = await collectSamples(page);
  // NEVER a silent truncation: this repo's own rule is that a bounded sample must say what it dropped, or
  // it reads as "covered everything".
  if (recovered) {
    console.log(`\n${recovered} of ${COUNT} sample(s) excluded: the transport dropped a response the `
      + `worker had completed. ${runs.length} sample(s) remain.`);
  }
  if (runs.length === 0) {
    console.log("NO USABLE SAMPLES — every capture lost its socket. This is a network finding, not a "
      + "timing one, and no median is reported rather than one computed from nothing.");
    process.exitCode = 2;
    return;
  }
  report(runs);
}
