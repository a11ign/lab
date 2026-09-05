// @ts-check
// Run under tsx, not plain node (see package.json), so this host-side script can import the
// TypeScript worker-lease module. The rest of src/training is .mjs under node; this one file
// needs the shared lifecycle logic, and duplicating it in .mjs would let the two copies
// drift.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { leaseWorker, leaseWorkerPool, guestReachableUrl, isAfterRun } from "@a11y-witness/worker-fleet";
import { requestJson } from "../../../worker-fleet/src/worker-http.mjs";
import { configuredWorkers, inventoryWorkerUrls } from "../../../worker-fleet/src/fleet-env.mjs";
import { captureTolerantly as tolerantCapture } from "../../../worker-fleet/src/capture-client.mjs";
import { assertFleetRunsThisCheckout } from "../../../worker-fleet/src/worker-code-check.mjs";
import { titleOf } from "@a11y-witness/evidence/verify";
import {
  isEvidence, rejectionReason, runOutcome, shouldRetireWorker,
} from "./capture-decisions.mjs";
import { beginRun, readProgress } from "./capture-progress.mjs";
import { cacheDecision, cacheKey, hashPageDir, stampProvenance } from "./capture-cache.mjs";
import { drainAcrossPool } from "./worker-pool.mjs";
import { previouslyCaptured } from "./capture-resume.mjs";
import { leasePageServer } from "./page-server.mjs";
import { hostPowerState, powerVerdict, keepHostAwake } from "./power-guard.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { nonAuthoritativeHostNotice } from "./capture-host.mjs";

/**
 * a typo here costs a full corpus run: `--resmue` silently means a fresh capture of 1,061 pairs.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 */
refuseUnknownFlags(["--only=", "--resume", "--no-cache", "--allow-stale-workers", "--allow-battery"],
  { entry: import.meta.url, command: "npm run training:capture" });

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
/** Capture with a fleet that is not running this checkout. Says so in the output; never the default. */
const ALLOW_STALE = process.argv.includes("--allow-stale-workers");
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
// 560000 -> 620000 on architecture-audit.md §14.5: the worker also spends up to 60 s clearing the desktop
// BEFORE the hard-timeout-wrapped attempt starts, sequentially, so the true worst case is 580 s and 560 s
// sat below it — mirroring CAPTURE_CLIENT_TIMEOUT_MS's own fix in worker-http.mjs, which see for the
// derivation.
const CAPTURE_TIMEOUT_MS = Number(process.env.DATASET_CAPTURE_TIMEOUT_MS || 620000);
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
export function selectCases(/** @type {any} */ cases, /** @type {any} */ only) {
  if (!only) return cases;
  const wanted = only.split(",").map((/** @type {any} */ s) => s.trim()).filter(Boolean);
  const ids = new Set(cases.map((/** @type {any} */ { id }) => id));
  // A TRAILING `+` MEANS "this case and everything built from it".
  //
  // The exact-id rule above is right and cannot be relaxed: `form-error-silent` is a real id and a prefix
  // of ~90 others, so asking for it must mean that one. But the FAMILY is what a corpus change usually
  // touches — a base case plus its `+also-` and `+with-` variants — and there was no way to say it.
  // Measured 2026-08-26: `--only=route-title-stale` to prove a furniture fix captured 1 case of 7, and
  // the four uncaptured ones stayed stale while the run reported success.
  //
  // `route-title-stale+` is unambiguous because `+` is the variant separator, so it cannot collide with
  // an id: no case is named `X+` and every variant of X begins `X+`.
  return cases.filter((/** @type {any} */ { id }) => wanted.some((/** @type {any} */ want) => {
    if (want.endsWith("+")) return id === want.slice(0, -1) || id.startsWith(want);
    return ids.has(want) ? id === want : id.includes(want);
  }));
}

// `requestJson`, not `fetch`: a capture can hold the connection well past undici's 300 s headers cap,
// which no AbortSignal lifts. See worker-http.mjs — this call site declared 560 s and got 300 s.
async function fetchJson(/** @type {any} */ url, options = {}, timeoutMs = 30000) {
  return raiseForStatus(url, await requestJson(url, { ...options, timeoutMs }));
}

/**
 * The body, or a typed throw — ONE construction, used by both the plain fetch and the tolerant capture.
 *
 * Split out when the recovery moved to the shared client, because the alternative was raising this error
 * in two places and hoping they stayed identical. The fields are the entire point: every retry decision in
 * this file keys on the status and on the worker's fault CODE, never on the message text.
 *
 * The body is typed `any` deliberately: it is whatever the worker sent, and every caller in this file
 * already reads it that way (`health.busy`, `capture.transcript`). Narrowing it here would only push the
 * casts outward to a dozen call sites.
 *
 * @param {string} url @param {{ok: boolean, status: number, text: string, json: unknown}} response
 * @returns {any}
 */
function raiseForStatus(url, response) {
  const body = /** @type {any} */ (response.json ?? { raw: response.text });
  if (response.ok) return body;
  const failed = /** @type {Error & { status?: number, code?: string }} */ (
    new Error("HTTP " + response.status + " from " + url + ": " + JSON.stringify(body)));
  // The status as a NUMBER, so callers branch on it instead of matching the message they just built.
  // Recovery needs exactly this: 404 means re-capture, 500 means the worker has a diagnosis for us.
  failed.status = response.status;
  // Carry the worker's fault code across the wire so retry decisions can key on it instead of on the
  // wording of a message that crossed two processes. Absent from older workers, which is why
  // isTransient still falls back to matching the text.
  if (body?.fault) failed.code = body.fault;
  throw failed;
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("Missing " + MANIFEST_PATH + ". Run npm run training:generate first.");
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

async function checkWorker(/** @type {any} */ { worker, source }) {
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
function resolveBaseUrl(/** @type {any} */ lease) {
  const configured = (process.env.DATASET_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const reachable = guestReachableUrl(configured, lease);
  if (reachable !== configured) {
    console.log("Dataset pages: rewrote " + configured + " -> " + reachable + " (the guest cannot reach the host's localhost)");
  }
  return reachable;
}

function captureUrl(/** @type {any} */ baseUrl, /** @type {any} */ testCase, /** @type {any} */ variant) {
  return baseUrl + "/" + testCase.id + "/" + variant + ".html";
}

// Exactly what shapes the evidence, defined once. The cache keys on this and the worker receives
// it, so the two cannot drift -- a key that ignored an option we actually send would reuse evidence
// captured a different way.
function captureOptions(/** @type {any} */ testCase) {
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
    // WHICH ORDER the two position-dependent probes run in, forwarded under the same omit-when-absent
    // rule and for the same cache-key reason: absent means the order that has always run, so adding this
    // re-keys only the cases that ask for it and leaves every other capture valid.
    //
    // It existed in `capture-core` and `server.mjs` and was unreachable from a case, because THIS hop
    // enumerates by name while the manifest hop forwards `probe*` by prefix. So the one mechanism that
    // lets a focus case carry form evidence without activating a control before the ring is walked could
    // not be asked for. `probe-chain.test.ts` could not see it either: it derived its flag list from what
    // cases ALREADY declare, so an option no case used was never checked -- and therefore no case could
    // start using it. That circularity is fixed there.
    ...(testCase.probeOrder ? { probeOrder: testCase.probeOrder } : {}),
    // Same omit-when-absent rule and the same cache-key reason: present only for the cases that ask.
    ...(testCase.probeDialog ? { probeDialog: true } : {}),
    ...(testCase.probeFocusReveal ? { probeFocusReveal: true } : {}),
    ...(testCase.probeArrows ? { probeArrows: true } : {}),
    ...(testCase.probeTyping ? { probeTyping: true } : {}),
    ...(testCase.probeFocusContext ? { probeFocusContext: true } : {}),
    // Same omit-when-false rule, same reason: present only for the cases that ask, so adding the
    // flag re-keys those and nothing else.
    ...(testCase.probeNavigation ? { probeNavigation: true } : {}),
    reuseScreenReader: REUSE_NVDA,
  };
}

function writeCapture(/** @type {any} */ testCase, /** @type {any} */ variant, /** @type {any} */ capture, /** @type {any} */ provenance) {
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

async function pageTitle(/** @type {any} */ url) {
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
async function workerVitals(/** @type {any} */ worker) {
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
 * @returns {Promise<{retire: boolean, reason: string|null}>}
 *   The VERDICT AND ITS REASON, which is what `shouldRetireWorker` returns and what the pool accepts.
 *   This said `Promise<boolean>` for as long as it has existed -- a contract nobody could act on, since
 *   the run summary names why a worker was retired and a boolean cannot say.
 */
async function retireIfDegraded(/** @type {any} */ { worker, poolSize, evictedCount, retiredCount }) {
  const { reachable, vitals } = await workerVitals(worker);
  const streak = reachable ? 0 : (unreachableStreaks.get(worker) ?? 0) + 1;
  unreachableStreaks.set(worker, streak);
  // Both counts, because a worker leaves the pool two ways and the "never the last one standing" guard has to
  // see both. Reading them here — AFTER the await — is deliberate and safe: the read, the decision and the
  // push below are one synchronous run, and Node does not interleave those. A read taken before the await
  // would be a stale snapshot.
  // Returned rather than acted on: the pool owns who is in it, and pushing to its list from here was how
  // this function ended up needing the pool object at all.
  return shouldRetireWorker({
    vitals, unreachableStreak: streak, poolSize, retiredCount, evictedCount,
  });
}

async function waitForWorker(/** @type {any} */ worker) {
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
 * One capture, tolerant of the worker disappearing underneath it.
 *
 * THE RECOVERY LIVES IN `@a11y-witness/worker-fleet`'s `capture-client.mjs` NOW (moved there from
 * `packages/lab` on architecture-audit.md §5, item 6, so `packages/cli` could reach it too). This file
 * held the only implementation for months while nine other modules POSTed to `/capture` with none -- the
 * remedy-at-one-call-site shape this repo pays for most often. Two copies of a subtle protocol (404 means
 * re-capture, 202 does not, a 500 carries the worker's diagnosis) is the fact-stated-twice shape on top
 * of it.
 *
 * What stays here is what is genuinely this runner's: `waitForWorker`, because a corpus run can afford to
 * wait minutes for a box to come back where a gate wants an answer now, and the THROW contract below,
 * which every retry decision in this file keys on.
 */
async function captureTolerantly(/** @type {any} */ ctx, /** @type {any} */ testCase, /** @type {any} */ url) {
  const response = await tolerantCapture({
    worker: ctx.worker,
    body: { url, ...captureOptions(testCase) },
    timeoutMs: CAPTURE_TIMEOUT_MS,
    beforeRecovery: async (/** @type {any} */ error) => {
      console.log("    worker unreachable (" + (error?.message ?? error) + "); waiting for it to come back");
      await waitForWorker(ctx.worker);
    },
  });
  if (response.recovered) console.log("    recovered the completed capture — no re-capture needed");
  // The shared client RESOLVES a non-2xx where `fetchJson` throws, and this file's retry decisions read
  // `error.status` and `error.code`. Converting here keeps that contract exactly rather than rewriting
  // every caller -- and a recovered FAILURE arrives as a 500 and throws identically to the original.
  return raiseForStatus(ctx.worker + "/capture", response);
}

function writeRejected(/** @type {any} */ testCase, /** @type {any} */ variant, /** @type {any} */ capture, /** @type {any} */ attempt) {
  mkdirSync(REJECTED_ROOT, { recursive: true });
  const path = resolve(REJECTED_ROOT, testCase.id + "." + variant + ".attempt" + attempt + ".json");
  writeFileSync(path, JSON.stringify(capture, null, 2) + "\n", "utf8");
  return path;
}

async function captureVerified(/** @type {any} */ ctx, /** @type {any} */ testCase, /** @type {any} */ { url, title, variant }) {
  // `rejectionReason` answers null when the capture IS evidence, and this accumulates whichever
  // reason the last attempt produced. Typed to carry both, since an empty string and "no reason"
  // are the same thing here only by accident.
  /** @type {string | null} */
  let wrong = "";
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    // A LOST CAPTURE IS A RE-ISSUABLE CASE, and its own error says so: "the work is gone and the case must
    // be re-issued". Nothing acted on that. `CAPTURE_LOST` is thrown when the worker 404s a captureId it
    // had accepted — it restarted mid-capture — and it is in neither transient set, so it escaped this
    // loop, reached the pool as one consecutive failure, and the case was recorded failed WITHOUT being
    // requeued. Three in a row would evict the worker and hand the work back; a single restart lost
    // exactly one case, quietly.
    //
    // Retried here rather than made "transient", which would have been inert: `isTransient` has one
    // production caller and it is on the SYNC path, where this is never thrown.
    let capture;
    try {
      capture = await captureTolerantly(ctx, testCase, url);
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== "CAPTURE_LOST") throw error;
      console.log("  attempt " + attempt + "/" + CAPTURE_ATTEMPTS + ": the worker restarted mid-capture "
        + "and forgot this one; re-issuing");
      wrong = "the worker restarted mid-capture";
      continue;
    }
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
async function workerEnvironment(/** @type {any} */ worker) {
  try {
    return (await fetchJson(worker + "/health", {}, 15000)).environment ?? {};
  } catch {
    // An unreachable worker is handled by waitForWorker; keying on {} here just means its captures
    // will not match cached ones, which is the safe direction.
    return {};
  }
}

function provenanceFor(/** @type {any} */ ctx, /** @type {any} */ testCase) {
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
async function cachedOrCapture(/** @type {any} */ ctx, /** @type {any} */ testCase) {
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

async function captureCase(/** @type {any} */ ctx, /** @type {any} */ testCase) {
  /** @type {Record<string, number>} */
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

/**
 * Drain the case queue across the pool, and report what happened to the run rather than to each worker.
 *
 * The dispatch itself — the shared queue, each worker's failure streak, eviction and requeue — moved to
 * `worker-pool.mjs` so `evidence:check` and `capture:check` can use the fleet too. They ran against ONE
 * worker while three sat idle, because this was the only caller that knew how.
 *
 * What stays here is what is specific to a corpus run and has no business in a shared module: the cache, the
 * `--resume` set, and the progress file.
 *
 * **The unit of work is a CASE, not a capture**, and that is a correctness constraint rather than a
 * convenience: a pair is only comparable if both variants came from the same screen reader on the same
 * machine. Splitting one across workers would compare two NVDA instances and call the difference evidence.
 */
async function captureAcrossPool(/** @type {any} */ ctxBase, /** @type {any} */ cases, /** @type {any} */ done, /** @type {any} */ workers) {
  const skipped = [], cachedIds = [];
  const outcome = await drainAcrossPool({
    workers,
    items: cases,
    // Once per worker: the cache key depends on this guest's NVDA, Edge, protocol and provisioning, and a
    // pool member that differs must not reuse another's evidence.
    prepare: async (worker) => {
      await waitForWorker(worker);
      return { ...ctxBase, worker, environment: await workerEnvironment(worker) };
    },
    handle: async (testCase, { context: ctx }) => {
      if (done.has(testCase.id)) {
        ctx.progress.skipped(testCase.id, "already captured (--resume)");
        skipped.push(testCase.id);
        return;
      }
      const result = await cachedOrCapture(ctx, testCase);
      if (result.cached) {
        ctx.progress.skipped(testCase.id, "cached: " + result.reason);
        cachedIds.push(testCase.id);
        return;
      }
      ctx.progress.captured(testCase.id, result.phrases);
    },
    // The pool supplies the counts it owns; `retireIfDegraded` measures the vitals and makes the call, so
    // the decision stays in `capture-decisions.mjs` where `pool-invariants.test.ts` already pins it.
    isDegraded: (/** @type {any} */ { worker, poolSize, evictedCount, retiredCount }) =>
      retireIfDegraded({ worker, poolSize, evictedCount, retiredCount }),
    hooks: {
      onWorkerUnusable: (/** @type {any} */ worker, /** @type {any} */ error) =>
        console.error("  worker never became ready, skipping it: " + worker + " (" + /** @type {any} */ (error).message + ")"),
      onItemFailed: (/** @type {any} */ testCase, /** @type {any} */ error, /** @type {any} */ { worker }) => {
        // The progress entry is written here and deliberately NOT rolled back on requeue: another worker
        // capturing the case overwrites it, and a failure that was really the worker's is still worth
        // having been visible while it stood.
        ctxBase.progress.failed(testCase.id, /** @type {any} */ (error).message, worker);
        console.error("  CAPTURE_FAILED " + testCase.id + ": " + /** @type {any} */ (error).message);
      },
      onEvicted: (/** @type {any} */ worker, /** @type {any} */ { consecutiveFailures, handedBack, error }) =>
        console.error("  EVICTING " + worker + " after " + consecutiveFailures + " consecutive failures; "
          + handedBack + " case(s) go back to the queue. Last error: " + /** @type {any} */ (error).message),
      onRetired: (/** @type {any} */ worker, /** @type {any} */ { handedBack, reason }) =>
        console.error("  RETIRING " + worker + " — " + reason
          + (handedBack ? "; " + handedBack + " case(s) go back to the queue" : "")),
    },
  });

  if (cachedIds.length) {
    console.log("Reused cached evidence for " + cachedIds.length + " case(s); no worker time spent on them.");
  }
  // Never silent: a run that finished on two of three workers must say so, or the next person wonders why it
  // took longer and finds nothing.
  if (outcome.evicted.length) console.error("Evicted " + outcome.evicted.length + " worker(s): " + outcome.evicted.join(", "));
  if (outcome.retired.length) console.error("Retired " + outcome.retired.length + " degraded worker(s): " + outcome.retired.join(", "));
  return {
    failures: outcome.failures.map((f) => f.key + ": " + f.error.message),
    evicted: outcome.evicted,
    retired: outcome.retired,
    skippedCount: skipped.length + cachedIds.length,
    cachedCount: cachedIds.length,
  };
}

async function captureAll(/** @type {any} */ ctxBase, /** @type {any} */ cases, /** @type {any} */ done) {
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
      failures.push(testCase.id + ": " + /** @type {any} */ (error).message);
      ctx.progress.failed(testCase.id, /** @type {any} */ (error).message);
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
  // THE BARE-METAL FLEET, before the deprecated local guests. This function went named -> local UTM pool
  // -> single-VM lease and NEVER READ THE INVENTORY, while `doctor` went named -> inventory and
  // `check-worker-code` went named -> local -> inventory: three modules, three precedences, and the
  // comment six lines up claiming they had been unified covered the NAMED half only.
  //
  // So a bare `npm run training:capture` on a Mac with a registered guest captured the CORPUS on a
  // deprecated laptop VM while five bare-metal boxes sat idle. In practice the job always sets
  // `A11Y_WORKERS` (`lab-job.yml` passes `lab_fleet_workers`), which is why this never bit — a default
  // that is wrong and always overridden is a trap waiting for the first person who does not override it.
  //
  // NO LEASE, exactly like the explicit branch above: these machines are always on and are not ours to
  // start or stop. Leasing them would be `worker-ctl.sh` reaching for `utmctl` against a physical box.
  const fleet = inventoryWorkerUrls();
  if (fleet.length) {
    return {
      pool: fleet,
      lease: { worker: fleet[0], source: "inventory.yml", hostAddress: undefined, release: async () => {} },
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
  return { pool: null, lease: await leaseWorker({ worker: process.env.A11Y_WORKER ?? null, after: afterRun() }) };
}

async function checkDatasetWorkers(/** @type {any} */ pool, /** @type {any} */ lease) {
  if (pool) {
    // Check every one of them before starting: discovering a dead worker an hour in wastes
    // the hour, and the pool driver would keep handing it cases.
    for (const worker of pool) await checkWorker({ worker, source: "explicit" });
    console.log(`Pool of ${pool.length}: ${pool.join(", ")}`);
  } else {
    await checkWorker(lease);
  }
  // AND that they run the code this checkout expects — here as well as in `capture-real-pages.mjs`, which
  // is the whole point. A remedy that reaches one of several paths is this repo's most expensive recurring
  // shape, and the SYNTHETIC corpus is the worse half of it: real-page captures never cache, so a stale
  // worker's evidence there is at least overwritten next run. Here it is CACHED, and `workerCode` is
  // deliberately outside the cache key — so one stale guest's capture is reused for ever with nothing
  // recording which code produced it.
  // Said BEFORE the run, not after it fails. This host serves the pages and drives the dispatch, and the
  // only place that dependency was ever mentioned is a battery guard's refusal — which is how it came to be
  // met with `--allow-battery` rather than understood.
  const hostNotice = nonAuthoritativeHostNotice({ cwd: process.cwd(), servesPages: true });
  if (hostNotice) process.stdout.write(hostNotice);
  await assertFleetRunsThisCheckout(pool ?? [lease.worker],
    { when: "before the run", allow: ALLOW_STALE, bareMetalUrls: inventoryWorkerUrls() });
}

function captureProgress(/** @type {any} */ cases, /** @type {any} */ lease, /** @type {any} */ pool, /** @type {any} */ baseUrl) {
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

async function captureWithPool(/** @type {any} */ { baseUrl, progress, pool }, /** @type {any} */ cases, /** @type {any} */ done) {
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

async function captureDataset(/** @type {any} */ cases, /** @type {any} */ done, /** @type {any} */ pool, /** @type {any} */ lease) {
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
  // SAY WHAT --no-cache CANNOT REACH. `previouslyCaptured` returns a non-empty set only under
  // `--resume --no-cache`, and it skips on the capture FILES rather than on this run's progress -- so a
  // case that already succeeded is skipped and `--no-cache` never gets to force it. That is exactly right
  // for the pairing's documented purpose ("retry only what is missing": a FAILED case has no usable files,
  // so it is not skipped and is recaptured fresh), and it is silently wrong for the other reason somebody
  // reaches for `--no-cache` -- re-measuring a case that succeeded, to see whether an odd result
  // reproduces. Measured cost 2026-09-03: an investigation into one split pair read an identical result
  // from a "recapture" and called it REPRODUCIBLE, when the run had skipped the case and the second
  // reading was the same bytes. Two readings of one file are not two measurements.
  //
  // So the line names the consequence rather than the count. `--no-cache` alone re-measures everything.
  if (done.size) {
    console.log("Resuming: " + done.size + " case(s) already captured.");
    console.log("  --no-cache CANNOT reach those " + done.size + " — they are skipped on the files already "
      + "on disk, so a re-read of them is not a second measurement. Drop --resume to re-measure.");
  }

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
    await lease.release().catch((e) => console.error("worker release failed: " + /** @type {any} */ (e).message));
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
    console.error("training:capture failed:", /** @type {any} */ (error).message);
    process.exitCode = 1;
  });
}
