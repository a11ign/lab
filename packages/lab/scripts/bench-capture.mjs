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
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { captureIn, costCause, MIN_TRIPS_FOR_A_RATE, rateAcrossPages, sweepCostsByPage, walkRate }
  from "../src/capture/sweep-costs.mjs";
import { captureTolerantly } from "../../worker-fleet/src/capture-client.mjs";
import { datasetRoot, captureRoot } from "../src/dataset-paths.mjs";

/**
 * `--from-disk` decides whether it measures a live capture or replays one; mistyped, it silently
 * drives the fleet when you meant to read a file.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--dir=", "--from-disk", "--protocol=", "--sweeps"], { entry: import.meta.url, command: "npm run bench:capture" });

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
export async function fromDisk(/** @type {any} */ root) {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const files = readdirSync(root).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const runs = [];
  for (const file of files) {
    let record;
    try {
      record = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    } catch { continue; } // a partial write is not a data point
    const capture = captureIn(record);
    if (!capture) continue;
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
      // The population this capture belongs to. ABSENT is a value, not a gap: the cache reads a
      // missing protocol as `unknown`, so those captures match no live guest either.
      protocol: capture.provenance?.captureProtocol ?? "absent",
      // FOR THE PER-SWEEP REPLAY (#659). The page ASKED for, and only the `sweep` marks -- keeping whole
      // diagnostics for thousands of captures holds a corpus in memory to read eight numbers from each.
      url: typeof capture.url === "string" ? capture.url : undefined,
      diagnostics: capture.diagnostics.filter((/** @type {any} */ e) => e?.event === "sweep"),
    });
  }
  return runs;
}

// --- WHICH POPULATION IS THIS? -------------------------------------------
//
// A capture directory is not one experiment. This repo's corpus has held five
// `captureProtocol` values at once, and the protocol is a CACHE KEY -- so captures either side
// of a bump ran different code, on different guests, and mean different things. Averaging
// across them produces a p50 that describes no fleet that ever existed.
//
// That is not hypothetical. Measured 2026-09-06 on this checkout's own copy: 2,122 of 2,178
// captures are protocol 5 taken on `192.168.64.x` -- the RETIRED local UTM guests -- and the
// remaining 56 are the bare-metal fleet. A `--from-disk` run here reported the retired pool's
// numbers as the fleet's, silently, which is the wrong-population defect this repo has now
// recorded thirteen times.
//
// So the population is STATED before any statistic, and a mixed one is REFUSED rather than
// averaged. `--protocol=all` is how you ask for the mix deliberately; there is no way to get
// it by accident.

/**
 * Counts by value.
 *
 * ABSENT IS A VALUE, and the defaulting lives HERE rather than at the one call site that reads a
 * capture off disk. Put it there and a caller reaching this any other way renders `undefined` as a
 * protocol -- which is a mixed corpus describing itself as homogeneous, the defect wearing the
 * remedy's clothes. This repo's own rule: one fact, one place.
 *
 * @param {any[]} runs @param {(r: any) => any} key
 */
function tally(runs, key) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const run of runs) {
    const raw = key(run);
    const value = raw === undefined || raw === null || raw === "" ? "absent" : String(raw);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** Counts by value, biggest first, as `16=3304 6=580`. An ABSENT field counts as the value
 * `absent`, because the cache reads it as `unknown` and those captures match no live guest. */
export function populationOf(/** @type {any[]} */ runs) {
  return {
    protocols: tally(runs, (r) => r.protocol),
    workers: tally(runs, (r) => r.worker),
  };
}

/** @param {Record<string, number>} counts */
function describe(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([value, n]) => `${value}=${n}`)
    .join(" ");
}

/**
 * Choose the captures to report on, or refuse and say why.
 *
 * Returns `{ runs, scope }` when the answer is about ONE population, and `{ refusal }` when it
 * would otherwise be about several. A refusal names the mix, so the next command is obvious --
 * the rule this repo applies to every guard: replace a plausible wrong answer with a refusal
 * that names the cause.
 *
 * @param {any[]} runs
 * @param {string | undefined} wanted `--protocol=` as given: a value, `all`, or absent
 */
export function selectPopulation(runs, wanted) {
  const protocols = tally(runs, (r) => r.protocol);
  const mix = describe(protocols);
  if (wanted === "all") {
    return { runs, scope: `${runs.length} capture(s) across ALL protocols (${mix}) -- asked for explicitly` };
  }
  if (wanted !== undefined) {
    // Normalised the same way `tally` does, so `--protocol=absent` names the same set the mix does.
    const chosen = runs.filter((r) => (r.protocol === undefined || r.protocol === null || r.protocol === ""
      ? "absent" : String(r.protocol)) === wanted);
    if (!chosen.length) {
      return { refusal: `No capture on disk has captureProtocol ${wanted}. Present: ${mix}` };
    }
    return { runs: chosen, scope: `${chosen.length} capture(s) at captureProtocol ${wanted}` };
  }
  const present = Object.keys(protocols);
  if (present.length > 1) {
    return {
      refusal:
        `These captures span ${present.length} capture protocols (${mix}), and the protocol is a CACHE ` +
        `KEY -- they ran different code on different guests. A p50 across them describes no fleet that ` +
        `ever existed.\n` +
        `  --protocol=${Object.entries(protocols).sort((a, b) => b[1] - a[1])[0][0]}  the largest population\n` +
        `  --protocol=all      average them anyway, deliberately`,
    };
  }
  return { runs, scope: `${runs.length} capture(s) at captureProtocol ${present[0]}` };
}

function percentile(/** @type {any} */ values, /** @type {any} */ p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function reportFromDisk(/** @type {any} */ runs, /** @type {string} */ scope) {
  // The population FIRST. A statistic whose population is not stated is the defect this repo has
  // recorded thirteen times, and printing it above the numbers is what makes it unmissable.
  console.log(`\npopulation: ${scope}`);
  console.log(`  workers:  ${describe(populationOf(runs).workers)}`);
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

/**
 * PER SWEEP TYPE, PER PAGE — #659, and the reason it is not the phase table above.
 *
 * `sweep` is one phase covering eight types, and one of them (`formField`) carries an activation probe
 * the other seven do not. Summed into a phase, that one type's behaviour is everybody's. Split by type,
 * #659's question becomes answerable: is the total trips x a constant (what seeing the page costs), or is
 * the rate itself climbing (where a reducible cost would live)?
 *
 * @param {any[]} runs
 */
function reportSweeps(runs) {
  const pages = sweepCostsByPage(runs);
  /** @type {Map<string, any[]>} */
  const byType = new Map();
  for (const [, types] of pages) {
    for (const [type, acc] of types) byType.set(type, [...(byType.get(type) ?? []), acc]);
  }
  console.log(`\nper sweep type across ${pages.size} page(s) — median ms per round trip:`);
  console.log(`  ${"type".padEnd(12)}${"pages".padStart(5)}${"thin".padStart(6)}  `
    + `${"rates".padEnd(30)}${"spread".padStart(7)}  cause`);
  for (const [type, perPage] of [...byType].sort()) {
    const rate = rateAcrossPages(perPage);
    const rates = rate.rates.map((/** @type {number} */ r) => r.toFixed(0)).join(", ");
    console.log(`  ${type.padEnd(12)}${String(rate.pages).padStart(5)}${String(rate.thin).padStart(6)}  `
      + `${rates.padEnd(30)}${(rate.spread === null ? "--" : rate.spread.toFixed(1)).padStart(7)}  `
      + `${costCause(rate)}`);
  }
  reportWalkRate(byType);
  console.log(`\n  thin = pages whose sweep made fewer than ${MIN_TRIPS_FOR_A_RATE} round trips, `
    + "excluded and counted: a rate over four trips is noise, and one such page read as the strongest "
    + "per-step scaling in the set until it was excluded. See sweep-costs.mjs for the measurement.");
}

/**
 * THE ANSWER, not just the table. Every type but the carrier only walks, so their median rate is what a
 * round trip costs; the carrier's excess over it is its probe rather than a slower walk.
 *
 * Split from `reportSweeps` to keep that function inside the complexity gate.
 *
 * @param {Map<string, any[]>} byType
 */
function reportWalkRate(byType) {
  const walk = walkRate([...byType].flatMap(([type, perPage]) =>
    perPage.map((/** @type {any} */ p) => ({ ...p, type }))));
  if (walk === null) return;
  console.log(`\n  walk rate (every type with no onItem): ${walk.toFixed(0)} ms/trip`);
  const carrier = rateAcrossPages(byType.get("formField") ?? []);
  if (carrier.rates.length === 0) return;
  console.log(`  formField: ${Math.min(...carrier.rates).toFixed(0)}-`
    + `${Math.max(...carrier.rates).toFixed(0)} ms/trip — the excess over ${walk.toFixed(0)} is its `
    + "per-field activation, NOT a slower walk. Where it reads AT the walk rate its probe barely fired — "
    + "which is not the same as firing being free.");
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
    const wanted = process.argv.find((a) => a.startsWith("--protocol="))?.slice("--protocol=".length);
    const chosen = selectPopulation(fromDiskRuns, wanted);
    // Both halves tested, because "no runs" and "a refusal" must never be able to come apart: a
    // selection that returned neither would otherwise fall through and report on `undefined`.
    if (chosen.refusal || !chosen.runs || !chosen.scope) {
      console.error(`\nREFUSING to average across populations, under ${dir}:\n` +
        `${chosen.refusal ?? "the selection returned no captures and no reason, which is a bug here"}`);
      process.exit(2);
    }
    reportFromDisk(chosen.runs, chosen.scope);
    if (process.argv.includes("--sweeps")) reportSweeps(chosen.runs);
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
