// Each of these decisions has been wrong in production at least once. The tests assert the REASONS,
// not just the booleans, because the reason is what a human reads and acts on.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEvidence, isTransient, rejectionReason, runOutcome, shouldEvictWorker, shouldRetireWorker,
} from "./capture-decisions.mjs";
import { captureFault, FAULT } from "@a11y-witness/nvda-worker/capture-faults";

const TITLE = "Aquarium 001 schedule";
const URL = "http://host:5050/aquarium/good";
const empty = { headings: [], landmarks: [], formFields: [] };
const good = {
  transcript: ["heading, level 1, Aquarium 001 schedule", "Departures from Central station"],
  structure: { ...empty, headings: ["Aquarium 001 schedule, heading, level 1"] },
};

test("a good capture is evidence", () => {
  assert.equal(isEvidence(good, TITLE), true);
});

test("a good capture has no rejection reason", () => {
  assert.equal(rejectionReason(good, { title: TITLE, url: URL }), null);
});

test("a capture of the wrong page says so, and quotes what it heard", () => {
  const wrongPage = { transcript: ["Cannot reach this site", "Try again"], structure: empty };
  const reason = rejectionReason(wrongPage, { title: TITLE, url: URL });
  assert.match(reason!, /did not read "Aquarium 001 schedule"/);
  assert.match(reason!, /Cannot reach this site/);
});

test("a capture of only the title says the page was not read", () => {
  const titleOnly = { transcript: [TITLE], structure: empty };
  assert.match(rejectionReason(titleOnly, { title: TITLE, url: URL })!, /nothing beyond the page title/);
});

test("a self-contradicting capture says the page was not traversed", () => {
  // Heard a heading, swept none — the two halves of one capture disagree.
  const contradicts = { transcript: ["heading, level 1, Aquarium 001 schedule"], structure: empty };
  assert.match(rejectionReason(contradicts, { title: TITLE, url: URL })!, /contradicts itself/);
});

test("a dropped connection is transient", () => {
  assert.equal(isTransient(new Error("fetch failed")), true);
});

test("a busy worker is transient", () => {
  assert.equal(isTransient(new Error("HTTP 429 from worker: a capture is already in progress")), true);
});

test("a mute screen reader is transient — the worker cold-starts a fresh one next capture", () => {
  assert.equal(isTransient(new Error("NVDA is running but not speaking (afterStart was empty)")), true);
});

test("an abandoned capture is transient — same self-healing reason", () => {
  assert.equal(isTransient(new Error("capture exceeded the hard timeout of 240000 ms")), true);
});

test("a bare-metal worker waking its NIC is transient, by CODE not by wording", () => {
  // The one that would have been silently reclassified when the clients moved off `fetch`. EHOSTUNREACH is
  // how a physical worker presents while its NIC returns from selective suspend: provisioning records 48
  // instant failures in one evidence-check run, and the box answered a curl thirty seconds later.
  //
  // Under `fetch` this was transient only by ACCIDENT -- undici wrapped every network failure as
  // "TypeError: fetch failed", which the prose regex matched. `node:http` reports the real code, so nothing
  // matched the prose any more and 48 recoverable failures would have become 48 permanent ones.
  const unreachable = Object.assign(new Error("connect EHOSTUNREACH 203.0.113.83:8765"), { code: "EHOSTUNREACH" });
  assert.equal(isTransient(unreachable), true);
  // And the wording alone must not be what saves it.
  assert.equal(isTransient(Object.assign(new Error("worker gone"), { code: "EHOSTUNREACH" })), true);
});

test("undici's headers timeout is transient wherever the code is carried", () => {
  // A capture that outran the client's patience is exactly what the worker recovers from by cold-starting
  // NVDA. node:http puts the code on the error; undici hides it on `cause`, so both are checked -- the
  // classification must not depend on which client the caller happened to use.
  assert.equal(isTransient(Object.assign(new Error("timed out"), { code: "UND_ERR_HEADERS_TIMEOUT" })), true);
  assert.equal(isTransient(Object.assign(new TypeError("fetch failed"),
    { cause: Object.assign(new Error("x"), { code: "UND_ERR_HEADERS_TIMEOUT" }) })), true);
});

test("a programming error is not transient", () => {
  assert.equal(isTransient(new TypeError("x is not a function")), false);
});

test("a missing error object is not transient", () => {
  // Defensive: isTransient is called on whatever a catch block caught.
  assert.equal(isTransient(undefined), false);
});

/**
 * TRANSIENT FAULTS ARE MATCHED BY THE SAME CODES `capture-faults.mjs` DEFINES, not by a copied literal —
 * architecture-audit.md §5, item 4. Built through `captureFault()` (the worker's own constructor), so this
 * proves the classification reads the ACTUAL fault code the worker sends, not a string that happens to
 * match it today.
 */
test("a worker fault classifies as transient by its REAL code, from capture-faults.mjs", () => {
  assert.equal(isTransient(captureFault(FAULT.SCREEN_READER_MUTE, "NVDA is running but not speaking")),
    true, "screen-reader-mute self-heals on the next capture's cold-started NVDA");
  assert.equal(isTransient(captureFault(FAULT.SCREEN_READER_START_FAILED, "NVDA would not start")),
    true, "screen-reader-start-failed self-heals the same way");
  assert.equal(isTransient(captureFault(FAULT.WRONG_PAGE, "the browser is showing a different page")),
    false, "a wrong page is a corpus/site problem, not a worker fault a retry can fix");
});

test("three consecutive failures evicts a worker from a healthy pool", () => {
  assert.equal(shouldEvictWorker({ consecutiveFailures: 3, poolSize: 3, evictedCount: 0 }), true);
});

test("two failures is not yet a pattern", () => {
  assert.equal(shouldEvictWorker({ consecutiveFailures: 2, poolSize: 3, evictedCount: 0 }), false);
});

test("the last worker standing is never evicted", () => {
  // With nothing to hand the work to, recording failures beats abandoning the run silently.
  assert.equal(shouldEvictWorker({ consecutiveFailures: 9, poolSize: 1, evictedCount: 0 }), false);
  assert.equal(shouldEvictWorker({ consecutiveFailures: 9, poolSize: 3, evictedCount: 2 }), false);
});

test("cached cases count as skipped, never as captured", () => {
  // Counting them as captured would report worker time that was never spent.
  const outcome = runOutcome({ total: 10, failures: 0, skipped: 6, cached: 6, poolSize: 3 });
  assert.equal(outcome, "4 captured, 0 failed, 6 skipped (6 cached), of 10 cases across 3 workers");
});

test("a single-worker run does not claim a pool", () => {
  assert.equal(runOutcome({ total: 2, failures: 0, skipped: 0, cached: 0, poolSize: 1 }),
    "2 captured, 0 failed, 0 skipped, of 2 cases");
});

test("an evicted worker is named in the outcome", () => {
  const outcome = runOutcome({
    total: 5, failures: 1, skipped: 0, cached: 0, poolSize: 3, evicted: ["http://w2:8765"],
  });
  assert.match(outcome, /1 evicted \(http:\/\/w2:8765\)/);
});

test("a fault code from the worker is transient without matching any message text", () => {
  // The point of the code: this error's message says nothing a regex would recognise.
  const error = Object.assign(new Error("HTTP 500 from http://w:8765/capture: {...}"),
    { code: "screen-reader-mute" });
  assert.equal(isTransient(error), true);
});

test("an unknown fault code falls through to the message rules", () => {
  const error = Object.assign(new Error("something we have never seen"), { code: "who-knows" });
  assert.equal(isTransient(error), false);
});

test("a worker recovering on every capture is retired, even with zero failures", () => {
  // The real case: 4 of 4 captures needed a screen-reader recovery, so consecutiveFailures never left
  // zero and eviction could never fire, while that guest ran at 122.9s against a peer's 40.6s.
  const { retire, reason } = shouldRetireWorker({
    vitals: { captures: 4, recoveries: 4, failures: 0 }, poolSize: 3, retiredCount: 0,
  });
  assert.equal(retire, true);
  assert.match(reason!, /4 of 4 captures needed a screen-reader recovery/);
});

test("a healthy worker is never retired", () => {
  assert.equal(shouldRetireWorker({
    vitals: { captures: 20, recoveries: 0, failures: 0 }, poolSize: 3, retiredCount: 0,
  }).retire, false);
});

test("the last worker standing is never retired, however degraded", () => {
  // A slow run beats no run — the same rule eviction follows.
  assert.equal(shouldRetireWorker({
    vitals: { captures: 8, recoveries: 8, failures: 0 }, poolSize: 3, retiredCount: 2,
  }).retire, false);
});

test("a worker that stops answering /health is retired as wedged", () => {
  // The measured incident: one guest wedged, spun at 178% CPU and answered nothing for twelve minutes
  // while still taking work. It never succeeded, so the degradation check never ran on it; it never
  // failed cleanly enough for eviction either. Meanwhile its healthy neighbour's mute rate went from
  // 0/10 to 6/18, because the spin stole the CPU that NVDA's 1s speech timeouts depend on.
  const { retire, reason } = shouldRetireWorker({
    vitals: null, unreachableStreak: 2, poolSize: 2, retiredCount: 0,
  });
  assert.equal(retire, true);
  assert.match(reason!, /did not answer \/health on 2 consecutive probes/);
});

test("one silent probe is a blip, not a wedge", () => {
  // A health probe that failed must never be the thing that retires a worker — that principle is why
  // workerVitals swallows errors, and a single timeout on a loaded host is ordinary.
  assert.equal(shouldRetireWorker({
    vitals: null, unreachableStreak: 1, poolSize: 3, retiredCount: 0,
  }).retire, false);
});

test("a worker that answers but reports no vitals is still healthy", () => {
  // An older worker predates the vitals field. Absent vitals must keep meaning "no information",
  // which is why reachability had to become a separate fact rather than another null.
  assert.equal(shouldRetireWorker({
    vitals: null, unreachableStreak: 0, poolSize: 3, retiredCount: 0,
  }).retire, false);
});

test("the last worker standing is not retired even when wedged", () => {
  // Consistent with every other rule here: a slow run beats no run, and there is nowhere to hand the
  // work to. The run reports it rather than abandoning the queue.
  assert.equal(shouldRetireWorker({
    vitals: null, unreachableStreak: 5, poolSize: 3, retiredCount: 2,
  }).retire, false);
});

test("retired workers are named in the run outcome", () => {
  const outcome = runOutcome({
    total: 10, failures: 0, skipped: 0, cached: 0, poolSize: 3, retired: ["http://w1:8765"],
  });
  assert.match(outcome, /1 retired as degraded \(http:\/\/w1:8765\)/);
});
