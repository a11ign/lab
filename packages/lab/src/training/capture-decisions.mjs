// The decisions a capture run makes: is this capture evidence, is this error worth retrying, and is
// this worker worth keeping.
//
// They live here because they are the riskiest logic in the pipeline and they were the least
// testable. Every one of them has been wrong at least once in production:
//
//   - a rejection reason gated on the wrong thing and failed 44 cases in a live run
//   - a recoverable error was classified fatal and lost a case the next capture would have got
//   - eviction blamed the cases a broken worker touched instead of the worker
//
// They are pure functions of their inputs, so they can be tested without a worker, a VM or a
// network — which is the whole point of moving them out of a 650-line orchestrator.
import { captureHasSubstance, captureIsSelfConsistent, captureMentionsTitle } from "@a11y-witness/evidence/verify";
import { assessWorker } from "@a11y-witness/worker-fleet/health";

/** How much of a rejected transcript to quote back. Enough to recognise the wrong page, not a dump. */
const REJECTED_PREVIEW_PHRASES = 2;

/** A worker that fails this many in a row is not having bad luck. */
export const MAX_CONSECUTIVE_WORKER_FAILURES = 3;

/**
 * Consecutive silent `/health` probes before a worker is treated as wedged rather than briefly busy.
 *
 * Two, not one: a single timed-out probe happens on a loaded host and must never cost a worker. Two in
 * a row, each taken after a capture on that worker finished, is the wedge — the guest that spun at 178%
 * CPU answered nothing for twelve minutes, so it would have been caught on the second probe.
 */
export const UNREACHABLE_PROBES_BEFORE_RETIRE = 2;

/**
 * Recoverable, or the end of this case?
 *
 * Everything here heals on its own, which is why waiting beats failing. The connection errors are
 * here because the first full dataset run lost its last four cases to one guest bugchecking — it came
 * back by itself, but the run had already recorded four permanent failures.
 *
 * `running but not speaking` and `hard timeout` are the subtle ones: both make the worker STOP its
 * screen reader, so the next capture cold-starts a fresh one. They are self-healing by construction,
 * and classifying them fatal cost a case in the run that proved it.
 */
const TRANSIENT = new RegExp([
  "fetch failed", "ECONNREFUSED", "ECONNRESET", "socket hang up", "timed out", "aborted",
  "HTTP 429.*capture is already in progress",
  "running but not speaking",
  "hard timeout",
].join("|"), "i");

/**
 * Faults the WORKER named for us, which never need matching against prose.
 *
 * Both self-heal: the worker stops NVDA on any failed capture, so the next attempt cold-starts a clean
 * one. The worker now retries these itself before answering, so seeing one here means even its retry
 * did not clear it — still worth reissuing the case rather than recording a permanent failure.
 */
const TRANSIENT_FAULTS = new Set(["screen-reader-mute", "screen-reader-start-failed"]);

/**
 * Network failures that heal on their own, by CODE rather than by wording.
 *
 * These became visible when the capture clients moved off `fetch` to `node:http` (see
 * `worker-fleet/src/worker-http.mjs` for why they had to). `fetch` collapsed every network failure into
 * `TypeError: fetch failed`, which the regex above matched — so the whole class was transient by accident,
 * through a wrapper's wording rather than through anything we had decided.
 *
 * `EHOSTUNREACH` is the one that would have bitten. It is how a bare-metal worker presents while its NIC
 * wakes from selective suspend, recorded in provision-nvda-worker.ps1: 48 instant failures in one
 * evidence-check run, and the box answered a curl thirty seconds later. Under the real code, and without
 * this set, that would now be classified FATAL and fail 48 cases permanently.
 *
 * `ETIMEDOUT` covers both a dead peer and our own deadline in `requestJson`, which is deliberate: a
 * capture that outran its budget is exactly the case the worker recovers from by cold-starting NVDA.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  "EPIPE", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

export function isTransient(error) {
  // Prefer the code. The regex below is the fallback for older workers and for host-side failures
  // (a dropped socket has no fault code), but a message is prose and prose gets reworded — see
  // packages/nvda-worker/src/capture-faults.mjs for what that cost.
  if (TRANSIENT_FAULTS.has(error?.code)) return true;
  if (TRANSIENT_NETWORK_CODES.has(error?.code)) return true;
  // A node:http error carries its code on the error itself; an undici one hides it on `cause`. Checking
  // both means the classification does not depend on which client the caller happened to use.
  if (TRANSIENT_NETWORK_CODES.has(error?.cause?.code)) return true;
  return TRANSIENT.test(String(error?.message ?? error ?? ""));
}

/** Is this capture usable as evidence? */
export function isEvidence(capture, title) {
  return captureMentionsTitle(capture, title) &&
    captureHasSubstance(capture, title) &&
    captureIsSelfConsistent(capture);
}

/**
 * Why this capture is not evidence.
 *
 * Three faults with three different fixes, so they must not collapse into one message: the wrong page
 * was read, the page was not read at all, or the capture contradicts itself. The reason is what a
 * human acts on, so it is the thing worth testing.
 *
 * Returns null when the capture IS evidence — asking why a good capture failed is a caller bug.
 */
export function rejectionReason(capture, { title, url }) {
  if (isEvidence(capture, title)) return null;
  if (!captureIsSelfConsistent(capture)) {
    return `the capture contradicts itself at ${url}: the read-through announced a heading but the ` +
      `heading sweep found none (${capture.transcript.length} phrase(s)) — the page was not traversed`;
  }
  if (!captureHasSubstance(capture, title)) {
    return `the screen reader announced nothing beyond the page title at ${url} ` +
      `(${capture.transcript.length} phrase(s), no structure) — the page was not read`;
  }
  const preview = capture.transcript.slice(0, REJECTED_PREVIEW_PHRASES)
    .map((phrase) => JSON.stringify(phrase)).join(", ");
  return `the screen reader did not read "${title}" at ${url} (announced: ${preview || "nothing"})`;
}

/**
 * Drop this worker from the pool?
 *
 * Never the last one standing: with nothing left to hand the work to, recording the failures is more
 * useful than abandoning the run silently.
 *
 * @param {{ consecutiveFailures: number, poolSize: number, evictedCount: number, retiredCount?: number }} state
 */
export function shouldEvictWorker({ consecutiveFailures, poolSize, evictedCount, retiredCount = 0 }) {
  return consecutiveFailures >= MAX_CONSECUTIVE_WORKER_FAILURES && workersStillWorking({
    poolSize, evictedCount, retiredCount,
  }) > 1;
}

/**
 * How many workers are still taking cases.
 *
 * A worker leaves the pool two different ways — EVICTED for failing, RETIRED for degrading — and both guards
 * are meant to enforce the same invariant: never remove the last one. Each used to subtract only its own
 * count, so each was blind to the other. With three workers and two already retired, `shouldEvictWorker` saw
 * `3 - 0 = 3` remaining and would happily evict the third, leaving **zero** workers; the mirror image was true
 * of `shouldRetireWorker` after two evictions. A run then abandons the queue with no worker and no explanation.
 *
 * One function, so the two guards cannot disagree about what "remaining" means — the same reason the worker
 * file list and the code hasher are each defined once.
 */
export function workersStillWorking({ poolSize, evictedCount = 0, retiredCount = 0 }) {
  return poolSize - evictedCount - retiredCount;
}

/**
 * What the run actually did.
 *
 * Cached cases are SKIPPED, not captured — counting them as captured reports worker time that was
 * never spent, which is the one number the cache exists to change.
 *
 * @param {{ total: number, failures: number, skipped: number, cached: number,
 *           poolSize: number, evicted?: string[], retired?: string[] }} counts
 * @returns {string}
 */
export function runOutcome({ total, failures, skipped, cached, poolSize, evicted = [], retired = [] }) {
  const captured = total - failures - skipped;
  // "across N workers" hangs off the case count without a comma, because that is how it reads aloud:
  // "of 25 cases across 3 workers". The evicted clause is a separate thought and keeps its comma.
  const scope = poolSize > 1 ? `of ${total} cases across ${poolSize} workers` : `of ${total} cases`;
  const parts = [
    `${captured} captured`,
    `${failures} failed`,
    `${skipped} skipped${cached ? ` (${cached} cached)` : ""}`,
    scope,
  ];
  if (evicted.length) parts.push(`${evicted.length} evicted (${evicted.join(", ")})`);
  // Retired workers are named too: a run that quietly used two of three workers looks like an
  // unexplained slowdown, which is the whole failure this signal exists to end.
  if (retired.length) parts.push(`${retired.length} retired as degraded (${retired.join(", ")})`);
  return parts.join(", ");
}

/**
 * Take a silently-degraded worker out of the rotation.
 *
 * Separate from `shouldEvictWorker` because the two faults look nothing alike. Eviction answers "this
 * worker is FAILING": three consecutive failures, and its cases go back to the queue. This answers "this
 * worker is WORKING, and costing four times what it should" — every capture succeeds, nothing is requeued,
 * and the run is simply better off not sending it more.
 *
 * That gap was real and unreachable by the eviction rule. A guest whose NVDA went mute on 4 of 4 captures
 * produced **zero failures**, because the worker's own retry absorbed every one, so `consecutiveFailures`
 * never left zero while that worker ran at 122.9 s per capture against a healthy peer's 40.6 s. Nothing
 * could ever have evicted it.
 *
 * **A worker that answers nothing at all is the third fault, and it used to be invisible to both rules.**
 * Eviction needs failures and this rule needed vitals, so a guest that stopped answering `/health`
 * satisfied neither: `workerVitals` returned null, null was read as "no information", and no information
 * was treated as healthy. Measured consequence — one guest wedged and spun at 178% CPU for twelve
 * minutes while still in the rotation, and its healthy neighbour's mute rate went from 0/10 to 6/18
 * because the spin stole the CPU that NVDA's speech timeouts depend on. The wedged guest was never the
 * one that failed; it poisoned the other one.
 *
 * So unreachability is now evidence, but only in the plural. A single failed probe still must not retire
 * anybody — that principle is why `workerVitals` swallows errors, and a transient blip on a busy host is
 * common. `UNREACHABLE_PROBES_BEFORE_RETIRE` consecutive silences, each observed after a capture on that
 * worker ended, is a wedge rather than a blip.
 *
 * Never the last worker standing, for the same reason eviction is not: a slow run beats no run.
 *
 * @param {{ vitals: object | null | undefined, unreachableStreak?: number,
 *           poolSize: number, retiredCount: number, evictedCount?: number }} state
 * @returns {{ retire: boolean, reason: string | null }}
 */
export function shouldRetireWorker({ vitals, unreachableStreak = 0, poolSize, retiredCount, evictedCount = 0 }) {
  const wedged = unreachableStreak >= UNREACHABLE_PROBES_BEFORE_RETIRE;
  const { degraded, reason } = assessWorker(vitals);
  if (!wedged && !degraded) return { retire: false, reason: null };
  if (workersStillWorking({ poolSize, evictedCount, retiredCount }) <= 1) {
    return { retire: false, reason: null }; // last one standing: keep using it, however slow
  }
  if (wedged) {
    return {
      retire: true,
      reason: `did not answer /health on ${unreachableStreak} consecutive probes — wedged, and a wedged ` +
        "guest spins and degrades the workers beside it",
    };
  }
  return { retire: true, reason };
}
