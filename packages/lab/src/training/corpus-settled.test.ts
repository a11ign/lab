/**
 * "Is the corpus settled" must be ASKED, not inferred from how new the files are.
 *
 * Three audits refused to measure a corpus whose newest capture was under ten minutes old. The reasoning
 * — a count taken mid-recapture describes a state that has already changed — is right; the TEST was a
 * proxy, and a proxy for "a run is in flight" that is wrong in both directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { corpusState, SETTLED_AFTER_MINUTES } from "./corpus-settled.mjs";
import { progressPath } from "./capture-progress.mjs";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");

/** A dataset root carrying one progress file, so `readProgress` finds it exactly as in production. */
function rootWith(progress: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-settled-"));
  const path = progressPath(root);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(progress), "utf8");
  return root;
}

test("a run that FINISHED is settled, however new its files are", () => {
  // The half that cost real time: the whole chain ran green in about five minutes and the coverage audit
  // then refused with "wait for the run" when there was no run to wait for.
  const root = rootWith({
    startedAt: "2026-08-26T11:50:00.000Z", updatedAt: "2026-08-26T11:59:30.000Z",
    finishedAt: "2026-08-26T11:59:30.000Z", cases: {},
  });
  const state = corpusState({ datasetRoots: [root], now: NOW, minutesSinceLastWrite: () => 0.5 });
  rmSync(root, { recursive: true, force: true });
  assert.equal(state.state, "settled");
  assert.equal(state.blocking, false, "a finished run must not block an audit, whatever the clock says");
  assert.match(state.why, /finished at/);
});

test("a run still writing blocks, however OLD its last write is", () => {
  // The half that actually costs something. A run pausing past the window — a worker retry, an eviction
  // and requeue — read as settled under the proxy, and the audit measured the moving target it exists to
  // refuse. `isStale` uses the run's own capture timeout, so a long-but-live pause stays in flight.
  const root = rootWith({
    startedAt: "2026-08-26T11:00:00.000Z", updatedAt: "2026-08-26T11:48:00.000Z",
    finishedAt: null, captureTimeoutMs: 20 * 60_000, cases: {},
  });
  const state = corpusState({ datasetRoots: [root], now: NOW, minutesSinceLastWrite: () => 12 });
  rmSync(root, { recursive: true, force: true });
  assert.equal(state.state, "in-flight");
  assert.equal(state.blocking, true, "12 minutes of quiet is under this run's own timeout, so it is alive");
});

test("a run that DIED mid-write is its own answer, not 'settled'", () => {
  // There used to be two states, so a dead run had to be one of them — and became "settled" once its
  // files aged past ten minutes, which is a half-written corpus measured as a whole one. The remedies
  // differ: wait for one, re-run or clear the other.
  const root = rootWith({
    startedAt: "2026-08-26T09:00:00.000Z", updatedAt: "2026-08-26T09:05:00.000Z",
    finishedAt: null, captureTimeoutMs: 60_000, cases: {},
  });
  const state = corpusState({ datasetRoots: [root], now: NOW, minutesSinceLastWrite: () => 175 });
  rmSync(root, { recursive: true, force: true });
  assert.equal(state.state, "abandoned");
  assert.equal(state.blocking, true, "a half-written corpus must not be measured as a whole one");
  assert.match(state.why, /never finished/);
  assert.match(state.why, /lab:stop/, "it must name the command that clears it");
});

test("with no progress file the clock is all there is, and it says so", () => {
  // The honest use of the proxy: the fallback for a corpus copied without its progress file, never the
  // primary test. The message says WHY it is guessing, so nobody reads it as the same answer.
  const fresh = corpusState({ datasetRoots: [], evidenceDirs: ["x"], minutesSinceLastWrite: () => 2 });
  assert.equal(fresh.blocking, true);
  assert.match(fresh.why, /no progress file/);
  const old = corpusState({
    datasetRoots: [], evidenceDirs: ["x"], minutesSinceLastWrite: () => SETTLED_AFTER_MINUTES + 1 });
  assert.equal(old.blocking, false);
  const none = corpusState({ datasetRoots: [], evidenceDirs: [], minutesSinceLastWrite: () => null });
  assert.equal(none.blocking, false, "nothing to date-check is not a reason to refuse");
});
