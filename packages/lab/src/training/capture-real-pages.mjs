/**
 * Capture the real-page corpus (ADR 0010).
 *
 *   node packages/lab/src/training/capture-real-pages.mjs [--role=calibration|training] [--worker=URL]
 *
 * NEVER CACHED, and that is a requirement rather than a default. These pages live on the public web and
 * can change under us; the whole value of the corpus is that its evidence describes the page as it is now,
 * against a conformance claim its publisher makes now. A cache hit here would silently pair today's claim
 * with last month's announcements.
 *
 * Each capture records the page's PUBLISHED claim alongside the evidence, so a later training or
 * calibration step never has to re-derive a label — and never has to guess one. That is the ADR's
 * selection rule made mechanical: if a page is here, someone else already said whether it conforms.
 *
 * Deliberately NOT wired into `training:capture`. That command drives the synthetic corpus, is cached, and
 * is what a normal run uses; mixing a live-web fetch into it would make a routine run depend on w3.org
 * being up. This is a separate, explicit act.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { pagesFor, REAL_PAGES } from "./real-page-corpus.mjs";
import { parseShard, shardOf } from "./shard.mjs";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl } from "../../../worker-fleet/src/worker-http.mjs";
import { workerIsUsable } from "../../../worker-fleet/src/worker-health.mjs";
import { configuredWorkers } from "../../../worker-fleet/src/fleet-env.mjs";
import { fleetConsistency, describeMismatches } from "../../../worker-fleet/src/fleet-consistency.mjs";
import { drainAcrossPool } from "./worker-pool.mjs";
import { createHostThrottle, hostOf } from "./host-throttle.mjs";
import { writeJsonAtomic } from "./write-atomic.mjs";

const ROLE = process.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length) ?? null;
const WORKER = process.argv.find((a) => a.startsWith("--worker="))?.slice("--worker=".length) ?? null;
/** Build one corpus from two browser builds anyway. Says so in the output; never the default. */
const ALLOW_MIXED = process.argv.includes("--allow-mixed-browsers");
const OUT = resolve(process.cwd(), process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");

/**
 * Every worker this run may use, validated.
 *
 * The fleet, not a machine. This took a single `--worker` and captured 77 pages serially while three
 * identical boxes sat idle — ~6.5 h of a ~1.6 h job — and the escape hatch was `--shard=i/n` launched by
 * hand N times, which is both a manual step and the exact quoting surface that once sent four shards at
 * `--worker=http://:8765` for 29 minutes. Sharding is not parallelism; it is parallelism the operator has
 * to perform correctly every time.
 *
 * `configuredWorkers()` is the same reader `doctor`, `worker:code` and `fleet:status` use, so this file
 * cannot drift from them about what the fleet is. `--worker` still names ONE, for comparing two guests.
 *
 * Resolved in `main` rather than at module scope: validating on IMPORT would throw, and
 * `node -e "import(...)"` is the only real check that an .mjs file still loads.
 *
 * @returns {string[]}
 */
function resolveWorkers() {
  if (WORKER) return [assertWorkerUrl(WORKER, { source: "--worker" })];
  const configured = configuredWorkers();
  if (configured.length) return configured.map((w) => w.url);
  throw new Error(
    "no worker to capture with. Set A11Y_WORKERS (npm run fleet:env) for the whole fleet, or pass "
    + "--worker=http://host:8765 to use exactly one.");
}

/** One capture may legitimately take a while: a real page is bigger than a generated one. */
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
/**
 * Minimum gap between requests to ONE publisher, enforced per host rather than per process.
 *
 * It was a `sleep` between captures, which is a property of one process: run four and every publisher sees
 * four times the rate, so politeness silently weakened exactly as the fleet grew. Keyed on the host, the
 * rate a site sees is the same at any fleet size — which is what makes scaling out a decision nobody has
 * to weigh against being rude.
 *
 * Worth stating what the real limiter is, because it was misjudged once: a capture takes ~191 s and almost
 * all of it is NVDA reading a page already loaded. One worker therefore fetches from a given site about
 * once every three minutes, and this gap is ~1% of that cycle. The throttle matters for the case the
 * arithmetic does not cover — several workers drawing pages from the SAME publisher at once, which the
 * corpus makes likely (26 of 77 pages are w3.org).
 */
const POLITE_GAP_MS = 2_000;

/**
 * `--shard=i/n`. The parser and the slice live in `shard.mjs` so they can be tested, and so the job
 * launcher added in the lab-API work uses the same definition rather than a second one that agrees today.
 */
const SHARD = parseShard(process.argv);

// Read-through lines to allow on a real page. 600 rather than the worker's 150: the longest transcript in
// the current real-page corpus is ~145 lines under the old cap AND still reported `maxSteps`, so the true
// length is unknown and 150 was clearly binding. Generous on purpose -- the deadline is what should end a
// read-through on a pathological page, not an arbitrary line count, which is the same argument that took
// MAX_SWEEP_STEPS from 40 to 250.
const REAL_PAGE_STEPS = 600;

const slug = (url) => url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "");

/**
 * Is this worth another attempt?
 *
 * Only a transport condition is. A malformed URL, a programmer error, a thrown assertion — none of those
 * get better by waiting, and treating them as "mid-boot" is how 29 minutes went missing.
 */
function isTransientNetwork(error) {
  const TRANSIENT = new Set([
    "ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "EPIPE",
  ]);
  // `requestJson`'s own timeout rejects with a plain Error and no code; that IS a transport condition and
  // is the common case while a worker boots.
  return TRANSIENT.has(error?.code) || /timed out|timeout/i.test(error?.message ?? "");
}

async function waitUntilReady(workerUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = (await requestJson(`${workerUrl}/health`, { timeoutMs: 8_000 })).json;
      // `workerIsUsable`, not `ready === true`: a worker predating the field reports neither, and this
      // loop would have spent all 60 attempts against a healthy guest and then recorded "worker never
      // became ready" as a failure of the PAGE.
      if (workerIsUsable(health)) return true;
    } catch (error) {
      // Retry a NETWORK condition; re-throw anything else. This was a bare `catch`, and it absorbed an
      // `ERR_INVALID_URL` from a malformed `--worker` — spending all 60 attempts and then recording
      // "worker never became ready" as a failure of the PAGE. The comment directly above already warned
      // about that exact misattribution for a different cause; this is the same trap, one line down.
      //
      // Keyed on `error.code`, matching how this repo classifies everywhere else: `capture-faults.mjs`
      // records what matching on prose costs. A code we do not recognise is not ours to swallow.
      if (!isTransientNetwork(error)) throw error;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function capture(page, workerUrl) {
  const response = await requestJson(`${workerUrl}/capture`, {
    method: "POST",
    // `probeForms` is OFF. These are somebody else's live pages, and the same rule the CLI follows applies
    // with more force here: pressing *Book* on a page we do not own is not a review. `probeFocus` is on —
    // Tab activates nothing.
    //
    // `probeNavigation` is ON as of 2026-08-24, and the line it sits on the right side of is worth stating
    // because it is not the same line as `probeForms`. It follows the FIRST LINK, which is ordinary
    // browsing — the thing this tool already did to reach the page — where submitting a form writes to
    // somebody's system. On essentially every real page the first link IS the skip link, which is exactly
    // what 2.4.1 exists to test.
    //
    // Without it, two rules could never fire on a real page: `addInertSkipLink` and `addStaleRouteTitle`
    // both read `interaction.routeChange`, and 0 of 77 real captures carried any. `criterion-coverage.ts`
    // listed both as assessed the whole time. That is the defect `rules:coverage` was built to name — a
    // rule whose evidence is never collected is not covered, it is unexamined.
    //
    // Scope is deliberate: this is the LAB's research corpus of public information pages, not a change to
    // what the CLI does when pointed at an arbitrary URL. `chooseProbe` still owns that decision.
    // `steps` RAISED for real pages. The worker's default is 150 read-through lines, sized for a generated
    // corpus whose largest page is 2,118 bytes -- and it truncates the transcript of most real pages.
    // Measured over the 26 shipped real captures: 9 of the 16 model-visible truncations are
    // `read-through:capped`, i.e. this cap and nothing else. A capped read-through makes the transcript a
    // PREFIX, and a prefix presented as a transcript is absence reported as evidence.
    //
    // Free, for two reasons. `steps` is part of `captureOptions` so changing it invalidates cached
    // captures -- and real-page captures are never cached, by construction. And the read-through is
    // separately bounded by `readThroughDeadline`, so a higher cap cannot run longer than the budget
    // allows; it only stops the cap binding BEFORE the deadline does. A budget is a ceiling, not a cost.
    body: {
      url: page.url, probeForms: false, probeFocus: true, probeNavigation: true, steps: REAL_PAGE_STEPS,
    },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const data = response.json ?? {};
  if (data.error) throw new Error(String(data.error).slice(0, 160));
  return data;
}

/**
 * Capture every page, across every worker, writing each as it lands.
 *
 * The unit of work is ONE PAGE, and unlike the synthetic corpus that is not a constraint anybody has to
 * defend: a real page has no good/bad twin to keep on the same guest, so any worker may take any page and
 * the queue needs no grouping. `drainAcrossPool` supplies the shared queue, per-worker failure streaks,
 * eviction and requeue — the same dispatch the synthetic corpus, `evidence:check` and `capture:check` use,
 * rather than a fourth implementation of "hand work to whichever box is free".
 *
 * Each record is written the moment its page finishes, never batched to the end. A run that dies at page
 * 70 of 77 keeps 70 captures; batching would keep none, and these are live fetches that cannot be replayed.
 */
async function captureAcrossPool(pages, workers) {
  const waitTurn = createHostThrottle({ minGapMs: POLITE_GAP_MS });
  const captured = [];
  const failed = [];

  const outcome = await drainAcrossPool({
    workers,
    items: pages,
    keyOf: (page) => page.url,
    prepare: async (worker) => {
      if (!await waitUntilReady(worker)) throw new Error(`worker never became ready: ${worker}`);
      return { worker };
    },
    handle: async (page, { context }) => {
      // Per publisher, not per worker — so this waits only when another worker is already on this site.
      await waitTurn(hostOf(page.url));
      process.stdout.write(`  ${page.role}  ${page.url}${workers.length > 1 ? `  [${context.worker}]` : ""}\n`);
      const evidence = await capture(page, context.worker);
      writeJsonAtomic(resolve(OUT, `${slug(page.url)}.json`), {
        // The label travels WITH the evidence, and names who made the claim. A later step must never have
        // to re-derive it, because re-deriving it means deciding conformance ourselves.
        role: page.role,
        publishedClaim: page.publishedClaim,
        claimSource: page.source,
        demonstrates: page.demonstrates,
        capturedAt: new Date().toISOString(),
        capture: evidence,
      });
      captured.push(page.url);
    },
    hooks: {
      onWorkerUnusable: (worker, error) =>
        process.stdout.write(`  worker unusable, skipping it: ${worker} (${error.message})\n`),
      onItemFailed: (page, error) => {
        process.stdout.write(`    FAILED: ${page.url}: ${error.message}\n`);
        failed.push(`${page.url}: ${error.message}`);
      },
      onEvicted: (worker, { consecutiveFailures, handedBack }) =>
        process.stdout.write(`  EVICTING ${worker} after ${consecutiveFailures} consecutive failures; `
          + `${handedBack} page(s) go back to the queue\n`),
    },
  });
  // A page requeued off an evicted worker and then captured is not a failure; the pool's list is what
  // actually failed after every attempt.
  for (const f of outcome.failures) {
    const line = `${f.id ?? f.key ?? "?"}: ${f.error ?? "failed"}`;
    if (!failed.includes(line)) failed.push(line);
  }
  return { captured: captured.length, failed };
}

/**
 * Refuse to build ONE corpus out of workers running different browsers.
 *
 * `browserVersion` is in the capture cache key precisely because a fleet can run more than one image, and
 * `fleet:status` has reported INCONSISTENT for a long time — but only when a human ran it, and only
 * before a run rather than during one.
 *
 * Measured 2026-08-24: a worker that had been down came back with Edge auto-updated from the pinned
 * .101 to .107 while a corpus run was in flight. The fleet was consistent when the run started and was
 * not when it finished, and nothing noticed. Fifteen pages were captured under the wrong build before I
 * happened to look.
 *
 * Checked HERE, at the boundary, for the same reason `assertWorkerUrl` is: the alternative is discovering
 * it in the evidence weeks later, where a split fleet looks like a page that changed. And re-checked
 * after the run, because "consistent when it started" is exactly the claim that failed.
 *
 * `--allow-mixed-browsers` exists for the case where you know something the check does not, and it says
 * so in the output rather than passing quietly.
 */
async function assertOneBrowserAcross(workers, when) {
  if (ALLOW_MIXED) return;
  const guests = await Promise.all(workers.map(async (url) => {
    try {
      return (await requestJson(`${url}/health`, { timeoutMs: 10_000 })).json ?? null;
    } catch {
      // Unreachable is not INCONSISTENT. A box that is asleep contributes no evidence and no mismatch,
      // and treating silence as a fault is how a check earns a reputation for crying wolf.
      return null;
    }
  }));
  const verdict = fleetConsistency(guests.filter(Boolean));
  if (verdict.consistent) return;
  process.stderr.write(`\nFLEET INCONSISTENT ${when}: ${describeMismatches(verdict.mismatches)}\n`
    + "Two browser builds must never write into one corpus — `browserVersion` is in the capture cache\n"
    + "key for exactly this reason, and a split shows up later as evidence that cannot be compared.\n"
    + "Pin the fleet (`provision-role.yml --tags edge`) or run with --allow-mixed-browsers.\n");
  process.exit(3);
}

async function main() {
  let workers;
  try {
    // Validated HERE, at the boundary, before a single page is fetched. This used to be a truthiness check,
    // and `http://:8765` is truthy — so the run started, and every page paid a five-minute readiness timeout
    // before being recorded as a failure of the page. `assertWorkerUrl` explains what an empty host means.
    workers = resolveWorkers();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  const selected = ROLE ? pagesFor(ROLE) : REAL_PAGES;
  const pages = shardOf(selected, SHARD);
  if (!pages.length) {
    process.stderr.write(`no pages for role '${ROLE}'\n`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`Capturing ${pages.length} real page(s)${SHARD.count > 1 ? ` (shard ${SHARD.index + 1}/${SHARD.count} of ${selected.length})` : ""} into ${OUT}\n`);
  process.stdout.write(`Across ${workers.length} worker(s): ${workers.join(", ")}\n`);
  process.stdout.write("Never cached: these pages change, and stale evidence would be paired with a "
    + "current conformance claim.\n");

  await assertOneBrowserAcross(workers, "before the run");
  const { captured, failed } = await captureAcrossPool(pages, workers);
  // AND AFTER. A worker can rejoin mid-run with a browser that updated while it was away, which is
  // exactly what happened on 2026-08-24 — so checking only at the start proves only that the start
  // was clean.
  await assertOneBrowserAcross(workers, "by the END of the run");

  process.stdout.write(`\n${captured}/${pages.length} captured\n`);
  // Named, not counted. "3 failed" tells you nothing about whether the corpus is usable.
  for (const line of failed) process.stdout.write(`  failed: ${line}\n`);
  process.exit(failed.length ? 1 : 0);
}

// Guarded for the same reason as `build-realism-tier.mjs`: CLAUDE.md makes
// `node -e "import('./this.mjs')"` the only real check that an .mjs file still loads, and unguarded that
// check STARTS A CAPTURE RUN against the fleet. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
