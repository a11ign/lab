// Run under tsx, not plain node (see package.json), so this host-side script can import the
// TypeScript worker-lease module. The rest of src/training is .mjs under node; this one file
// needs the shared lifecycle logic, and duplicating it in .mjs would let the two copies
// drift.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { leaseWorker, leaseWorkerPool, guestReachableUrl, isAfterRun } from "@a11y-witness/worker-fleet";
import { requestJson } from "../../../worker-fleet/src/worker-http.mjs";
import { configuredWorkers } from "../../../worker-fleet/src/fleet-env.mjs";
import { titleOf } from "@a11y-witness/evidence/verify";
import {
  isEvidence, isTransient, rejectionReason, runOutcome, shouldEvictWorker, shouldRetireWorker,
} from "./capture-decisions.mjs";
import { beginRun, readProgress } from "./capture-progress.mjs";
import { cacheDecision, cacheKey, hashPageDir, stampProvenance } from "./capture-cache.mjs";
import { previouslyCaptured } from "./capture-resume.mjs";
import { leasePageServer } from "./page-server.mjs";
import { hostPowerState, powerVerdict, keepHostAwake } from "./power-guard.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const CAPTURE_ROOT = resolve(ROOT, process.env.DATASET_CAPTURE_ROOT || "captures");
const PAGE_ROOT = resolve(ROOT, "pages");
const REJECTED_ROOT = resolve(CAPTURE_ROOT, "rejected");
const DEFAULT_BASE_URL = "http://localhost:5050";
const PAGES_PORT = Number(process.env.DATASET_PAGES_PORT || new URL(DEFAULT_BASE_URL).port);
const STEPS = Number(process.env.DATASET_CAPTURE_STEPS || 150);
const ONLY = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const RESUME = process.argv.includes("--resume");
// Caching is refused for acceptance runs, whatever the flags say: those runs exist to test whether
// NVDA's output is still stable, and reusing evidence would make them pass by construction.
// `--no-cache` forces a recapture anywhere.
const KIND = process.env.DATASET_KIND || "training";
const CACHE = !process.argv.includes("--no-cache") && KIND !== "acceptance";
// A comma-separated A11Y_WORKERS runs cases across those workers concurrently; unset keeps the
// single-worker behaviour. Read via `configuredWorkers()` at the point of use rather than captured
// here, so this file cannot drift from doctor and worker:code about what the fleet is again.
// Must sit ABOVE the worker's own hard timeout, or the host gives up before the guest can report WHY a
// capture failed — the same race the CLI lost, one layer out. `budget-ladder.test.ts` asserts the ordering
// against the worker's shipped constants, and it is what caught this when the budget was raised for real
// pages: 520 s hard timeout inside a 300 s host timeout would have silently truncated every long capture.
const CAPTURE_TIMEOUT_MS = Number(process.env.DATASET_CAPTURE_TIMEOUT_MS || 560000);
// Only used to size the power check below, so an estimate is enough — but it must be a MEASURED one,
// because a stale figure here would wave through a run that cannot finish before the host sleeps.
// 32.7 s is the mean over the two page-size buckets, timed on this host (see scale-buckets.test.ts,
// which owns the cost model). A pair is two captures, hence the x2 at the call site.
const MEAN_CAPTURE_S = 32.7;
// This is sent over the wire because NVDA lives in the Windows worker process. Setting
// A11Y_REUSE_NVDA on the host only changes a host process and cannot affect that worker.
// Keep reuse on for the normal pooled run; acceptance/repeat runs can set this to 0.
const REUSE_NVDA = process.env.DATASET_REUSE_NVDA !== "0";

/**
 * Choose which cases to run from `--only=`.
 *
 * Substring matching stays, because `--only=heading` to sweep a family is the common interactive use.
 * Two things it could not previously do, both of which are the *retry* workflow this project's own gates
 * ask for:
 *
 * - **An exact id must mean that one case.** `form-error-silent` is a real case id AND a prefix of ~90
 *   `form-error-silent-bulk-*` ids, so it could not be retried at all: asking for it ran ninety. Any id
 *   that is a prefix of another was untargetable, and that is precisely the set a gate names when it
 *   reports contamination.
 * - **A LIST.** `check-signals` prints the failing ids; the natural next step is to paste them back in.
 *   Without this, retrying eleven named cases meant eleven runs, each paying a page-server lease and a
 *   worker connect.
 *
 * Exact wins over substring per entry, so pasting a gate's output does what it says.
 */
export function selectCases(cases, only) {
  if (!only) return cases;
  const wanted = only.split(",").map((s) => s.trim()).filter(Boolean);
  const ids = new Set(cases.map(({ id }) => id));
  return cases.filter(({ id }) =>
    wanted.some((want) => (ids.has(want) ? id === want : id.includes(want))));
}

// `requestJson`, not `fetch`: a capture can hold the connection well past undici's 300 s headers cap,
// which no AbortSignal lifts. See worker-http.mjs — this call site declared 560 s and got 300 s.
async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const response = await requestJson(url, { ...options, timeoutMs });
  const text = response.text;
  const body = response.json ?? { raw: text };
  if (!response.ok) {
    const failed = new Error("HTTP " + response.status + " from " + url + ": " + JSON.stringify(body));
    // The status as a NUMBER, so callers branch on it instead of matching the message they just built.
    // Recovery needs exactly this: 404 means re-capture, 500 means the worker has a diagnosis for us.
    failed.status = response.status;
    // Carry the worker's fault code across the wire so retry decisions can key on it instead of on the
    // wording of a message that crossed two processes. Absent from older workers, which is why
    // isTransient still falls back to matching the text.
    if (body?.fault) failed.code = body.fault;
    throw failed;
  }
  return body;
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("Missing " + MANIFEST_PATH + ". Run npm run training:generate first.");
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

async function checkWorker({ worker, source }) {
  if (source === "default") {
    throw new Error(
      "No NVDA worker available. Dataset capture needs the interactive Windows/NVDA worker: " +
        "set A11Y_WORKER=http://host:8765, or on a Mac create the local VM " +
        "(scripts/local-worker/build-vm.sh) and it will be started on demand."
    );
  }
  let health;
  try {
    health = await fetchJson(worker + "/health");
  } catch (error) {
    throw new Error(
      "The worker at " + worker + " did not answer /health. If you set A11Y_WORKER yourself, " +
        "check that machine is up and the a11ysrv task is running; unset it to have a local VM " +
        "started on demand instead.",
      { cause: error }
    );
  }
  if (health.screenReader !== "NVDA") {
    throw new Error("Worker is not an NVDA worker: " + JSON.stringify(health));
  }
  if (health.busy) console.log("Worker reports busy; the next capture may be rejected.");
  console.log("Connected to NVDA worker at " + worker);
}

// The guest fetches these pages itself, so the base URL has to be reachable from THERE.
// With a local VM, the host's `localhost` is not: it resolves to the guest, which serves
// nothing, and every capture then comes back describing an empty page with no error.
function resolveBaseUrl(lease) {
  const configured = (process.env.DATASET_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const reachable = guestReachableUrl(configured, lease);
  if (reachable !== configured) {
    console.log("Dataset pages: rewrote " + configured + " -> " + reachable + " (the guest cannot reach the host's localhost)");
  }
  return reachable;
}

function captureUrl(baseUrl, testCase, variant) {
  return baseUrl + "/" + testCase.id + "/" + variant + ".html";
}

// Exactly what shapes the evidence, defined once. The cache keys on this and the worker receives
// it, so the two cannot drift -- a key that ignored an option we actually send would reuse evidence
// captured a different way.
function captureOptions(testCase) {
  return {
    task: testCase.task,
    steps: STEPS,
    probeForms: testCase.probeForms,
    probeTables: testCase.probeTables,
    // Present ONLY when true, and that is a cache-key decision rather than a style one.
    //
    // This object IS the cache key (`cacheKey` hashes it), and `JSON.stringify` omits an `undefined`
    // property while serialising `false`. So an unconditional `probeFocus: testCase.probeFocus` changed the
    // key for all 1,061 cases that do not use the probe the moment the generator started writing the flag
    // explicitly — measured: key `e511cc88941f207a` became `b50b03e6e7be45b0`. That is a full recapture of
    // 2,122 captures, hours of fleet time, to record nothing new about any of them.
    //
    // Omitting it also keeps the key and the request honest with each other, which is what the comment
    // above this function asks for: we do not send the flag, so we do not key on it, and `capture-core`
    // reads `!!opts.probeFocus` where absent and false are the same thing.
    ...(testCase.probeFocus ? { probeFocus: true } : {}),
    // Same omit-when-false rule, same reason: present only for the cases that ask, so adding the
    // flag re-keys those and nothing else.
    ...(testCase.probeNavigation ? { probeNavigation: true } : {}),
    reuseScreenReader: REUSE_NVDA,
  };
}

async function captureOne(ctx, testCase, url, captureId) {
  const body = { url, ...captureOptions(testCase), captureId };
  return fetchJson(ctx.worker + "/capture", { method: "POST", body }, CAPTURE_TIMEOUT_MS);
}

function writeCapture(testCase, variant, capture, provenance) {
  mkdirSync(CAPTURE_ROOT, { recursive: true });
  if (provenance) capture = stampProvenance(capture, provenance);
  const path = resolve(CAPTURE_ROOT, testCase.id + "." + variant + ".json");
  writeFileSync(path, JSON.stringify(capture, null, 2) + "\n", "utf8");
  return path;
}

// Fetch the page the way the guest will, and hand back its title so the capture can be
// checked against it. Doing this first turns a misconfigured base URL into one clear error
// instead of a whole dataset of captured 404 pages -- which is what happened before this
// existed: a stray server on port 5050 produced "Capture complete: 3/3 cases" while every
// transcript read "Error code: 404".
const SERVE_HINT =
  "The capture command normally leases the page server automatically; check that no other " +
  `process owns port ${PAGES_PORT} (a stray server can answer 404 for every page).`;

async function pageTitle(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    // A refused connection rejects rather than returning a response, so without this the
    // whole run dies with the bare message "fetch failed".
    throw new Error("Cannot reach the dataset pages at " + url + ". " + SERVE_HINT, { cause: error });
  }
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + url + ". " + SERVE_HINT);
  }
  return titleOf(await response.text());
}

/**
 * Recovery is a cheap read of something already computed, so it gets a short budget -- not the capture's.
 * If the worker cannot answer this in 30 s it is in no state to be asked, and capturing again is the
 * better move.
 */
const RECOVERY_TIMEOUT_MS = 30000;

const CAPTURE_ATTEMPTS = 3;
const WORKER_WAIT_MS = Number(process.env.DATASET_WORKER_WAIT_MS || 600000);
const WORKER_POLL_MS = 10000;

/**
 * The worker's own vitals, and whether it answered at all.
 *
 * These are two different facts and collapsing them into one null hid a whole failure mode. "Answered
 * but reports no vitals" is an older worker, and must keep working exactly as before. "Did not answer"
 * is a worker that may be wedged — and a wedged guest does not merely stop contributing, it spins and
 * degrades its neighbours. A single silence is still not evidence: `shouldRetireWorker` requires a
 * streak, so a flaky probe on a loaded host costs nothing.
 *
 * @returns {Promise<{ reachable: boolean, vitals: object | null }>}
 */
async function workerVitals(worker) {
  try {
    return { reachable: true, vitals: (await fetchJson(worker + "/health", {}, 15000)).vitals ?? null };
  } catch {
    return { reachable: false, vitals: null };
  }
}

/** Consecutive silent /health probes per worker, so one blip cannot retire anybody. */
const unreachableStreaks = new Map();

/**
 * Stop sending work to a worker that is quietly costing four times what it should, or that has stopped
 * answering altogether.
 *
 * Checked after a success, because that is the state the degradation fault hides in: a guest whose NVDA
 * goes mute on every capture still returns evidence and still records zero failures, so the eviction
 * rule -- three consecutive failures -- can never reach it. Nothing is requeued; the cases it captured
 * are fine. It simply stops taking more.
 *
 * Also checked after a FAILURE, which it was not, and that omission is why a wedged guest survived. It
 * never succeeded, so this function was never called for it; it never returned a clean failure either,
 * so eviction never reached it. It sat in the rotation for twelve minutes spinning at 178% CPU while
 * its neighbour's mute rate went from 0/10 to 6/18.
 *
 * @returns {Promise<boolean>} true when the caller should stop using this worker
 */
async function retireIfDegraded({ worker, pool }) {
  const { reachable, vitals } = await workerVitals(worker);
  const streak = reachable ? 0 : (unreachableStreaks.get(worker) ?? 0) + 1;
  unreachableStreaks.set(worker, streak);
  // Both counts, because a worker leaves the pool two ways and the "never the last one standing" guard has to
  // see both. Reading them here — AFTER the await — is deliberate and safe: the read, the decision and the
  // push below are one synchronous run, and Node does not interleave those. A read taken before the await
  // would be a stale snapshot.
  const { retire, reason } = shouldRetireWorker({
    vitals, unreachableStreak: streak, poolSize: pool.size,
    retiredCount: pool.retired.length, evictedCount: pool.evicted.length,
  });
  if (!retire) return false;
  pool.retired.push(worker);
  console.error("  RETIRING " + worker + " — " + reason);
  return true;
}

async function waitForWorker(worker) {
  const deadline = Date.now() + WORKER_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(worker + "/health", {}, WORKER_POLL_MS);
      // Answering is not the same as able to capture. A worker reports `ready: false` while NVDA
      // is still warming up after a boot -- which is when the first capture used to fail on
      // `nvda.start` and be recorded as a broken case. Waiting here turns that into patience.
      //
      // `ready !== false` rather than `=== true` on purpose: a worker predating this field is
      // treated as ready, so an un-redeployed guest keeps working instead of stalling the run.
      // Staleness has its own detector (npm run worker:code).
      if (health.busy || health.ready === false) {
        await sleep(WORKER_POLL_MS);
        continue;
      }
      const waited = Math.round((WORKER_WAIT_MS - (deadline - Date.now())) / 1000);
      // Silent when there was nothing to wait for. This is now called once per worker before it
      // takes any work, so announcing "back after 0s" for a healthy pool was three lines of noise
      // per run, and "back" is wrong for a worker that never went away.
      if (waited > 0) console.log("    worker ready after " + waited + "s: " + worker);
      return;
    } catch {
      // Expected while it is down -- the whole point is to keep asking. The loop's own
      // timeout is the error path, so there is nothing to record here.
      await sleep(WORKER_POLL_MS);
    }
  }
  throw new Error("the worker did not come back within " + Math.round(WORKER_WAIT_MS / 60000) + " minutes");
}

/**
 * Ask the worker for a capture we already paid for but may not have received.
 *
 * Called only after `waitForWorker` has returned, which is what makes one request enough: that function
 * waits for `busy` to clear, so the capture we lost the socket to has necessarily finished by now and its
 * outcome is in the worker's store. No polling loop is needed and none is written.
 *
 * Returns null when there is nothing to recover -- a worker predating the endpoint (404 from the router's
 * fallback), one that restarted and lost its memory, or a capture still somehow running. Null means
 * "capture again", which is exactly what this code did before the endpoint existed.
 *
 * A recovered FAILURE is rethrown rather than swallowed, so a replay is indistinguishable from the original
 * response. That keeps the worker's `fault` code -- the thing it worked out and we would otherwise replace
 * with "no answer" -- and lets the run's own classification decide, as it would have done all along.
 */
async function recoverCapture(worker, captureId) {
  try {
    const body = await fetchJson(worker + "/capture/" + captureId, {}, RECOVERY_TIMEOUT_MS);
    if (body?.state === "running") return null;
    console.log("    recovered the completed capture " + captureId + " — no re-capture needed");
    return body;
  } catch (error) {
    // 500 is the worker's own account of a failed capture, and it is the answer, not an obstacle.
    if (error.status === 500) throw error;
    // 404 from the endpoint, or from an older worker's router fallback: nothing kept, so capture again.
    if (error.status === 404) return null;
    // Anything else (the worker went away again mid-question) is not worth a second round trip here;
    // the caller falls back to capturing, which is what it would have done anyway.
    return null;
  }
}

// One capture, tolerant of the worker disappearing underneath it.
async function captureTolerantly(ctx, testCase, url) {
  const captureId = randomUUID();
  try {
    return await captureOne(ctx, testCase, url, captureId);
  } catch (error) {
    if (!isTransient(error)) throw error;
    console.log("    worker unreachable (" + error.message + "); waiting for it to come back");
    await waitForWorker(ctx.worker);
    // Before paying for a second full capture, ask whether the first one actually finished. A capture is
    // 12-520 s of real screen-reader work, and a dropped socket after it completed used to discard all of
    // it -- then charge the same again, which on a bad network is how three failures in a row evict a
    // worker that was never faulty.
    const recovered = await recoverCapture(ctx.worker, captureId);
    if (recovered) return recovered;
    return captureOne(ctx, testCase, url, randomUUID());
  }
}

function writeRejected(testCase, variant, capture, attempt) {
  mkdirSync(REJECTED_ROOT, { recursive: true });
  const path = resolve(REJECTED_ROOT, testCase.id + "." + variant + ".attempt" + attempt + ".json");
  writeFileSync(path, JSON.stringify(capture, null, 2) + "\n", "utf8");
  return path;
}

async function captureVerified(ctx, testCase, { url, title, variant }) {
  let wrong = "";
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    const capture = await captureTolerantly(ctx, testCase, url);
    // Both questions, because the title check alone cannot answer the second and is in fact
    // SATISFIED by the failure: a degenerate capture's whole transcript is the document title.
    // Measured on a live worker -- 2 of 5 captures returned transcript ["<page title>"] with no
    // headings and no cells, and would have been written to the dataset as read evidence.
    // Three questions, all answerable from the capture alone: is this the right page, was anything
    // read at all, and does the capture agree with itself.
    //
    // Deliberately NOT "did the probes we asked for produce anything". That gate rejected 100 of the
    // 2,122 captures in a corpus check-signals scores as fully discriminating, and failed 44 cases in
    // a live run. For the custom-control family an empty form probe IS the finding: its bad pages are
    // div-based fake buttons, so NVDA finds no controls and that absence is the 4.1.2 failure being
    // demonstrated. Whether absence is evidence or malfunction depends on the CASE DEFINITION, which
    // check-signals can see and this layer cannot -- and check-signals already reports it, as BLIND or
    // CONTAMINATED. captureRanRequestedProbes is kept for diagnostics; it must never gate.
    if (isEvidence(capture, title)) return capture;
    wrong = rejectionReason(capture, { title, url });
    const kept = writeRejected(testCase, variant, capture, attempt);
    console.log("  attempt " + attempt + "/" + CAPTURE_ATTEMPTS + ": " + wrong);
    console.log("    diagnostics kept: " + kept);
  }
  throw new Error(wrong + " after " + CAPTURE_ATTEMPTS + " attempts. Not written as evidence; " +
    "the rejected captures are in " + REJECTED_ROOT + " for diagnosis.");
}

/** The worker's own account of what it is, which the cache key depends on. */
async function workerEnvironment(worker) {
  try {
    return (await fetchJson(worker + "/health", {}, 15000)).environment ?? {};
  } catch {
    // An unreachable worker is handled by waitForWorker; keying on {} here just means its captures
    // will not match cached ones, which is the safe direction.
    return {};
  }
}

function provenanceFor(ctx, testCase) {
  const pageDir = resolve(PAGE_ROOT, testCase.id);
  const pageHash = hashPageDir(pageDir);
  const options = captureOptions(testCase);
  const environment = ctx.environment ?? {};
  return {
    key: cacheKey({ caseId: testCase.id, pageHash, options, environment }),
    pageHash,
    options,
    environment,
    worker: ctx.worker ?? null,
  };
}

/**
 * Reuse the pair on disk when nothing that shapes it has changed, otherwise capture it.
 *
 * @returns {Promise<{cached: boolean, phrases?: object, reason?: string}>}
 */
async function cachedOrCapture(ctx, testCase) {
  if (!CACHE) return { cached: false, phrases: await captureCase(ctx, testCase) };
  const { key } = provenanceFor(ctx, testCase);
  const decision = cacheDecision({ captureRoot: CAPTURE_ROOT, caseId: testCase.id, key });
  if (!decision.reuse) {
    // SAY WHY. A miss and a hit were both silent, so a run that recaptured all 1,061 cases looked
    // identical to one that reused them apart from a count at the end -- and the count says "1 captured"
    // whether the page changed, the worker was upgraded, or a new capture option re-keyed the corpus by
    // accident. `cacheDecision` has always computed the reason and nothing read it, which is this repo's
    // `sweepLog` shape: a diagnostic that exists, is correct, and reaches nobody.
    //
    // It also distinguishes the two cases that matter most and are otherwise identical from outside:
    // "no usable pair on disk" (first capture of a new case -- expected) and "page, options or
    // environment changed" (something re-keyed evidence that already existed -- check what, before
    // spending hours of fleet time).
    console.log("  " + testCase.id + ": capturing (" + decision.reason + ")");
    return { cached: false, phrases: await captureCase(ctx, testCase) };
  }
  // Worth saying out loud: the evidence is valid by protocol version, but it was produced by
  // different capture code. Silently reusing it is how you lose track of what made your dataset.
  if (decision.staleCode && decision.staleCode !== ctx.environment?.workerCode) {
    console.log("  " + testCase.id + ": reusing evidence produced by different capture code (" +
      decision.staleCode + " vs " + (ctx.environment?.workerCode ?? "unknown") + ")");
  }
  return { cached: true, reason: decision.reason };
}

async function captureCase(ctx, testCase) {
  const phrases = {};
  ctx = { ...ctx, provenance: provenanceFor(ctx, testCase) };
  for (const variant of ["good", "bad"]) {
    const url = captureUrl(ctx.baseUrl, testCase, variant);
    const title = await pageTitle(url);
    ctx.progress.startCase(testCase.id, variant, ctx.worker);
    console.log("Capturing " + testCase.id + " (" + variant + ")" +
      (ctx.poolSize > 1 ? " on " + ctx.worker : ""));
    const capture = await captureVerified(ctx, testCase, { url, title, variant });
    const path = writeCapture(testCase, variant, capture, ctx.provenance);
    console.log("  " + capture.transcript.length + " transcript phrases -> " + path);
    phrases[variant] = capture.transcript.length;
  }
  return phrases;
}

// A run interrupted an hour in should not start over. Must be read BEFORE beginRun, which
// replaces the progress file with a fresh all-pending one. Cache-enabled training runs do not
// use filenames as a completion signal: a file can be complete yet stale after a protocol, page,
// option, or worker-runtime change. cachedOrCapture must see every case so the cache key gets the
// final say. Acceptance runs deliberately disable caching, so they may use the previous progress
// record to skip cases completed in the same acceptance run.
//
// A case counts as done only if the previous run recorded it captured AND both files are
// still on disk: the progress file and the captures can be deleted independently, and
// trusting either alone silently skips work that no longer exists.
function afterRun() {
  const v = process.env.A11Y_VM_AFTER;
  if (!v) return "restore";
  if (isAfterRun(v)) return v;
  throw new Error('A11Y_VM_AFTER must be restore|stop|pause|leave (got "' + v + '")');
}

// One case per worker at a time, pulled from a shared queue.
//
// The unit of work is a CASE, not a capture: its good and bad variants must be captured by the
// same worker, because the pair is only comparable if both came from the same screen reader on
// the same machine. Splitting a pair across workers would compare two NVDA instances and call
// the difference evidence.
//
// A queue rather than a static split, so a slow case does not leave a worker idle while
// another still has a backlog.
// A worker that has failed this many cases in a row is not having bad luck.
//
// Failures are caught per case, so a dead worker used to keep pulling from the queue and failing
// everything it touched -- one broken guest could turn a whole run into failures while two healthy
// ones sat idle. Evicting it hands the work back to the pool.

// Hand a broken worker's cases back to the pool: the one in hand plus everything it already
// failed, since those failures were the worker's fault rather than the cases'. A progress entry
// recorded as failed is overwritten when another worker captures it.
function requeueFrom({ queue, failures, testCase, failedHere }) {
  queue.push(testCase, ...failedHere.map((f) => f.testCase));
  for (const { id } of failedHere) {
    const at = failures.findIndex((f) => f.startsWith(id + ": "));
    if (at !== -1) failures.splice(at, 1);
  }
  return failedHere.length + 1;
}

/**
 * Drain the case queue across the pool, and report what happened to the run rather than to each worker.
 *
 * The accumulators are shared by every worker on purpose — the queue is the coordination mechanism. They are
 * bundled as `pool` so a worker's working life can be its own function without threading six loose lists
 * through it: four things cohesive enough to pass as a unit are already an object.
 */
async function captureAcrossPool(ctxBase, cases, done, workers) {
  const pool = {
    queue: [...cases], failures: [], skipped: [], evicted: [], retired: [], cachedIds: [],
    size: workers.length,
  };
  await Promise.all(workers.map((worker) => drainQueueWithWorker(worker, { ctxBase, done, pool })));
  const { failures, evicted, retired, skipped, cachedIds } = pool;
  if (cachedIds.length) {
    console.log("Reused cached evidence for " + cachedIds.length + " case(s); no worker time spent on them.");
  }
  // Never silent: a run that finished on two of three workers must say so, or the next person
  // wonders why it took longer and finds nothing.
  if (evicted.length) console.error("Evicted " + evicted.length + " worker(s): " + evicted.join(", "));
  if (retired.length) console.error("Retired " + retired.length + " degraded worker(s): " + retired.join(", "));
  return {
    failures, evicted, retired,
    skippedCount: skipped.length + cachedIds.length,
    cachedCount: cachedIds.length,
  };
}

/**
 * One worker's whole working life: become ready, then take cases until the queue empties or it is removed.
 *
 * Deliberately NOT split further. The per-case body mutates this worker's streak and blame list and uses
 * `return` to end the worker — expressing that as a separate function would mean either a mutable bag or a
 * sentinel return value, and two functions that cannot be understood apart are worse than one that reads
 * straight through. Every branch below already says why it exists.
 */
async function drainQueueWithWorker(worker, { ctxBase, done, pool }) {
  // Once per worker: the cache key depends on this guest's NVDA, Edge, protocol and provisioning,
  // and a pool member that differs must not reuse another's evidence.
  // Wait for THIS worker to be ready before it takes any work. Readiness was previously only
  // consulted after a failure, so a freshly booted worker still got handed the first case and
  // still lost it to `nvda.start` -- the exact failure the readiness gate exists to prevent.
  // A worker that never becomes ready simply takes no cases; the others drain the queue.
  try {
    await waitForWorker(worker);
  } catch (error) {
    console.error("  worker never became ready, skipping it: " + worker + " (" + error.message + ")");
    return;
  }
  const ctx = { ...ctxBase, worker, environment: await workerEnvironment(worker) };
  let consecutiveFailures = 0;
  // What this worker failed. If it turns out to be the worker rather than the cases, all of it
  // goes back to the pool -- otherwise a broken guest still costs two permanently failed cases
  // before the threshold trips, and those are cases a healthy worker could have captured.
  const failedHere = [];
  while (pool.queue.length) {
    const testCase = pool.queue.shift();
    if (done.has(testCase.id)) {
      ctx.progress.skipped(testCase.id, "already captured (--resume)");
      pool.skipped.push(testCase.id);
      continue;
    }
    try {
      const result = await cachedOrCapture(ctx, testCase);
      if (result.cached) {
        ctx.progress.skipped(testCase.id, "cached: " + result.reason);
        pool.cachedIds.push(testCase.id);
        continue;
      }
      ctx.progress.captured(testCase.id, result.phrases);
      // A success clears the streak AND the blame: these cases were fine, so they must not be
      // handed back if this worker dies later.
      consecutiveFailures = 0;
      failedHere.length = 0;
      if (await retireIfDegraded({ worker, pool })) return;
    } catch (error) {
      consecutiveFailures += 1;
      // Evict, but never the last worker standing: with nothing left to hand the work to,
      // recording the failures is more useful than abandoning the run quietly.
      if (shouldEvictWorker({
        consecutiveFailures, poolSize: pool.size,
        evictedCount: pool.evicted.length, retiredCount: pool.retired.length,
      })) {
        const handedBack = requeueFrom({ queue: pool.queue, failures: pool.failures, testCase, failedHere });
        pool.evicted.push(worker);
        console.error("  EVICTING " + worker + " after " + consecutiveFailures +
          " consecutive failures; " + handedBack +
          " case(s) go back to the queue. Last error: " + error.message);
        return;
      }
      // A failure is also the moment to ask whether the worker is answering at all. The wedge never
      // succeeds, so the success-path check can never see it, and it never fails cleanly enough to
      // reach the eviction threshold either. Its cases go back like an eviction's, because unlike a
      // degraded-but-working guest, this one genuinely did not capture them.
      if (await retireIfDegraded({ worker, pool })) {
        console.error("  " + requeueFrom({ queue: pool.queue, failures: pool.failures, testCase, failedHere }) +
          " case(s) go back to the queue");
        return;
      }
      failedHere.push({ id: testCase.id, testCase });
      pool.failures.push(testCase.id + ": " + error.message);
      ctx.progress.failed(testCase.id, error.message);
      console.error("  CAPTURE_FAILED " + pool.failures.at(-1));
    }
  }
}

async function captureAll(ctxBase, cases, done) {
  const failures = [];
  const ctx = { ...ctxBase, environment: await workerEnvironment(ctxBase.worker) };
  let cached = 0;
  for (const testCase of cases) {
    if (done.has(testCase.id)) {
      ctx.progress.skipped(testCase.id, "already captured (--resume)");
      console.log("Skipping " + testCase.id + " (already captured)");
      continue;
    }
    try {
      const result = await cachedOrCapture(ctx, testCase);
      if (result.cached) {
        ctx.progress.skipped(testCase.id, "cached: " + result.reason);
        console.log("Reusing " + testCase.id + " (cached: " + result.reason + ")");
        cached += 1;
        continue;
      }
      ctx.progress.captured(testCase.id, result.phrases);
    } catch (error) {
      failures.push(testCase.id + ": " + error.message);
      ctx.progress.failed(testCase.id, error.message);
      console.error("  CAPTURE_FAILED " + failures.at(-1));
    }
  }
  // Cached cases are skipped, not captured -- counting them as captured would report worker time
  // that was never spent, which is the one number this whole feature exists to change.
  const outcome = runOutcome({
    total: cases.length, failures: failures.length, skipped: done.size + cached, cached, poolSize: 1,
  });
  ctx.progress.finish(outcome);
  console.log("Capture complete: " + outcome + ".");
  if (failures.length) {
    throw new Error(failures.length + " case(s) failed. The completed captures were kept; " +
      "see npm run training:status, and re-run with --resume --no-cache to retry only what is missing.");
  }
}

async function acquireDatasetWorkers() {
  // Same lease as the witness CLI: an explicit A11Y_WORKER is used untouched, otherwise a
  // local VM is started on demand and put back as it was found. Dataset capture is the run
  // that benefits most -- it is long, unattended, and used to leave the guest running after.
  // Three ways to get workers, in priority order:
  //   A11Y_WORKERS  an explicit pool -- someone else's to manage, so no lifecycle handling
  //   two or more local VMs  leased as a pool AND put back afterwards
  //   otherwise     the single-worker lease, as before
  //
  // The middle case is the point: pooling used to hand back a no-op release, so a pooled run
  // left every VM running indefinitely. That is the exact cost the single-worker lease exists
  // to avoid, and it came back the moment pooling became the normal way to run.
  // One parser, in fleet-env.mjs. This copy and doctor's and check-worker-code's had drifted apart on
  // precedence, which meant a diagnostic could describe a different fleet from the one about to run.
  const named = configuredWorkers();
  const explicitPool = named.length ? named.map((w) => w.url) : null;
  if (explicitPool) {
    return {
      pool: explicitPool,
      lease: { worker: explicitPool[0], source: "explicit", hostAddress: undefined, release: async () => {} },
    };
  }
  if (!process.env.A11Y_WORKER) {
    // leaseWorkerPool returns NULL when it finds fewer than two local VMs -- one VM is the
    // single-worker path's job. That contract was documented and unhandled: a resume crashed with
    // "Cannot read properties of null (reading 'workers')" the moment the pool query came back short.
    // TypeScript declares the nullable return, but this file is .mjs so nothing checked the caller.
    const localPool = await leaseWorkerPool(afterRun());
    if (localPool) {
      return {
        pool: localPool.workers,
        lease: {
          worker: localPool.workers[0], source: "local-vm",
          hostAddress: localPool.hostAddress, release: localPool.release,
        },
      };
    }
    // Fall through to the single-worker lease, which starts and restores one VM on its own.
  }
  return { pool: null, lease: await leaseWorker({ worker: process.env.A11Y_WORKER, after: afterRun() }) };
}

async function checkDatasetWorkers(pool, lease) {
  if (pool) {
    // Check every one of them before starting: discovering a dead worker an hour in wastes
    // the hour, and the pool driver would keep handing it cases.
    for (const worker of pool) await checkWorker({ worker, source: "explicit" });
    console.log(`Pool of ${pool.length}: ${pool.join(", ")}`);
    return;
  }
  await checkWorker(lease);
}

function captureProgress(cases, lease, pool, baseUrl) {
  const progress = beginRun({
    root: ROOT,
    worker: lease.worker,
    baseUrl,
    cases,
    captureTimeoutMs: CAPTURE_TIMEOUT_MS,
  });
  progress.setWorkers(pool ?? [lease.worker]);
  console.log("Progress: " + progress.path + " (watch it: npm run training:status, or block: npm run training:wait)");
  return progress;
}

async function captureWithPool({ baseUrl, progress, pool }, cases, done) {
  const { failures, skippedCount, cachedCount, evicted } = await captureAcrossPool(
    { baseUrl, progress, poolSize: pool.length }, cases, done, pool);
  const outcome = runOutcome({
    total: cases.length, failures: failures.length, skipped: skippedCount,
    cached: cachedCount, poolSize: pool.length, evicted,
  });
  progress.finish(outcome);
  console.log("Capture complete: " + outcome + ".");
  if (failures.length) {
    throw new Error(failures.length + " case(s) failed. The completed captures were kept; " +
      "see npm run training:status, and re-run with --resume --no-cache to retry only what is missing.");
  }
}

async function captureDataset(cases, done, pool, lease) {
  const baseUrl = resolveBaseUrl(lease);
  // Prove the pages are served before capturing anything. captureAll treats a bad page as
  // a per-case failure, so without this a wrong base URL reports the same error 45 times
  // over -- and each one costs a full NVDA capture first.
  await pageTitle(captureUrl(baseUrl, cases[0], "good"));
  const progress = captureProgress(cases, lease, pool, baseUrl);
  if (pool && pool.length > 1) {
    await captureWithPool({ baseUrl, progress, pool }, cases, done);
    return;
  }
  await captureAll({ worker: lease.worker, baseUrl, progress, poolSize: 1 }, cases, done);
}

async function main() {
  const manifest = readManifest();
  const cases = selectCases(manifest.cases, ONLY);
  if (!cases.length) throw new Error("No generated case matches --only=" + ONLY);

  const done = previouslyCaptured({
    cases,
    previous: readProgress(ROOT),
    captureRoot: CAPTURE_ROOT,
    pageRoot: PAGE_ROOT,
    resume: RESUME,
    cache: CACHE,
  });
  if (done.size) console.log("Resuming: " + done.size + " case(s) already captured.");

  // The pages are leased like the workers are: started if missing, put back as found. Serving them
  // was a manual step nobody owned, which leaked four `serve` processes onto this host and, worse,
  // let a stray server from another directory 404 an entire run while it reported success.
  // Power BEFORE anything expensive is leased. A run that dies because the host slept reports every
  // in-flight capture as `the worker did not come back within 10 minutes`, which reads as a broken
  // guest and was misdiagnosed here as exactly that. Estimated from what is left to do, not the whole
  // corpus, so a resume of the last twenty cases is not held to an overnight run's standard.
  const remaining = cases.length - done.size;
  const power = await hostPowerState();
  const verdict = powerVerdict({ ...power, estimatedHours: (remaining * MEAN_CAPTURE_S * 2) / 3600 });
  if (!verdict.ok && !process.argv.includes("--allow-battery")) {
    console.error(`Refusing to start: ${verdict.reason}`);
    process.exitCode = 2;
    return;
  }
  // Leased like everything else here, and released in the same `finally`, so a run that throws does
  // not leave the host pinned awake.
  const awake = keepHostAwake();

  const pages = await leasePageServer({
    root: PAGE_ROOT,
    port: PAGES_PORT,
    probePath: `${cases[0].id}/good.html`,
  });
  const { pool, lease } = await acquireDatasetWorkers();
  try {
    await checkDatasetWorkers(pool, lease);
    await captureDataset(cases, done, pool, lease);
  } finally {
    // Workers first: they are the expensive resource, and the page server costs nothing to hold for
    // the extra second. Both run even if the other throws.
    await lease.release().catch((e) => console.error("worker release failed: " + e.message));
    await pages.release();
    await awake.release();
  }
}

// Guarded, because importing this module used to START A CAPTURE RUN. That bit three times in one
// session: twice by accident while inspecting it, and once when a unit test imported it to reach the
// pure `selectCases` — the test hung, having silently begun capturing 1,061 cases against a live
// worker. A pure function is not testable if reaching it launches the program that contains it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("training:capture failed:", error.message);
    process.exitCode = 1;
  });
}
