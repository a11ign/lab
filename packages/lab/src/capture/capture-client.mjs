// @ts-check
/**
 * ONE CAPTURE, TOLERANT OF THE SOCKET DYING UNDER IT — and the only place that knows how.
 *
 * The worker has stored completed captures under a caller-chosen id since the `captureId` work landed:
 * `POST /capture {captureId}` then `GET /capture/<id>` returns the original response verbatim, so a lost
 * socket costs a round trip instead of 12-520 s of real screen-reader work. That is the idempotency-key
 * shape, for the reason payment APIs use it.
 *
 * TEN CLIENTS POST TO `/capture`. ONE USED THE RECOVERY. This repo's most expensive recurring shape is a
 * remedy applied at one call site when the behaviour reaches several — `anchorToTop`, `ensureSpeechChannel`,
 * `waitForAnnouncement`, `refreshBrowseBuffer` — and this is that shape at its largest here.
 *
 * MEASURED COST, 2026-08-28: `gate:stability` lost THREE canaries to `FAILED read ETIMEDOUT` across two
 * runs — `filter-status-silent-solar/bad` on one box, then `form-error-silent/bad` and
 * `disclosure-state-silent/good` on two others. Different pages, different machines, so it is the transport
 * and not either. Each one turned the determinism gate INCONCLUSIVE while the capture it lost had already
 * COMPLETED and was sitting in the worker's store, which is precisely what the store exists to serve back.
 *
 * The worker is bare metal on real Ethernet with real power management, which is why this arrived now: on
 * three VMs sharing one Mac the socket was a virtual bridge and effectively lossless.
 */
import { randomUUID } from "node:crypto";

import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS } from "../../../worker-fleet/src/worker-http.mjs";
import { isTransient } from "../training/capture-decisions.mjs";

/** Long enough to survive a worker that is briefly busy, short enough not to double a capture's cost. */
const RECOVERY_TIMEOUT_MS = 30_000;

/**
 * THE ESCAPE HATCH BACK TO THE SYNCHRONOUS PATH, and it says so when used.
 *
 * Kept because a protocol change wants a way back that does not need a deploy, and removed only once a
 * corpus run has gone through the async path end to end.
 */
/**
 * READ PER CALL, NOT AT MODULE LOAD, and the difference is not stylistic. A value fixed at import is one
 * no test can vary and no process can change -- `fileProductVersion` memoised Edge's version that way and
 * stamped five days of captures with a build they were not taken under. So it is a PARAMETER with an env
 * default, which also lets both paths be driven from one test file.
 */
const syncByEnv = () => process.env.A11Y_SYNC_CAPTURE === "1";

/** Accepting a capture is a handshake, not the work: it either answers in seconds or the box is unwell. */
const ACCEPT_TIMEOUT_MS = 30_000;
/** Between polls. Short enough that a 12 s capture is not padded, long enough not to hammer a busy box. */
const POLL_MS = 2_000;
/** A read of an array already in memory; if this cannot answer, the guest's event loop is blocked. */
const PROGRESS_TIMEOUT_MS = 10_000;
/**
 * Consecutive failed POLLS before giving up.
 *
 * Not one: a single dropped poll is precisely the transport fault this design exists to survive, and
 * treating it as a failed capture would reintroduce the defect through the new door. Not unbounded either,
 * or a box that has genuinely gone would be waited on for the whole capture budget.
 */
const MAX_POLL_FAILURES = 5;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

const base = (/** @type {string} */ worker) => String(worker).replace(/\/$/, "");

/**
 * Ask the worker for a capture we already paid for but may not have received.
 *
 * Returns null when there is nothing to recover — a worker predating the endpoint (404 from the router's
 * fallback), one that restarted and lost its memory, or a capture still running. Null means "capture
 * again", which is what every client did before the endpoint existed.
 *
 * A recovered FAILURE is RETURNED rather than swallowed, so a replay is indistinguishable from the original
 * response. That keeps the worker's `fault` code — the thing it worked out, and which we would otherwise
 * replace with "no answer" — and lets the caller's own classification decide, as it would have all along.
 * (The dataset runner's version THREW here, because it wrapped a `fetchJson` that rejects on non-2xx;
 * `requestJson` resolves instead, so the same intent is expressed by returning the response.)
 *
 * @param {string} worker @param {string} captureId
 */
export async function recoverCapture(worker, captureId) {
  let response;
  try {
    response = await requestJson(`${base(worker)}/capture/${captureId}`, { timeoutMs: RECOVERY_TIMEOUT_MS });
  } catch (error) {
    // The worker went away again mid-question. Not worth a second round trip; the caller falls back to
    // capturing, which is what it would have done anyway.
    void error;
    return null;
  }
  // 500 IS AN ANSWER, NOT AN OBSTACLE: it is the worker's own account of a failed capture, carrying the
  // `fault` code it worked out. Returning it lets the caller's existing classification decide, exactly as
  // it would have on the original response -- and losing it replaces a diagnosis with "no answer", which
  // this project has repeatedly misread as a dead machine.
  if (response.status === 500) return response;
  // 404 from the endpoint, or from an older worker's router fallback: nothing kept, so capture again.
  if (response.status === 404) return null;
  if (!response.ok) return null;
  // "Still running" and "never heard of it" are DIFFERENT ANSWERS and must stay that way. Neither is
  // recoverable here, but only one means the work is still being done.
  if (/** @type {any} */ (response.json)?.state === "running") return null;
  return response;
}

/**
 * POST a capture, and on a TRANSIENT failure ask whether it actually finished before paying again.
 *
 * Returns what `requestJson` returns — `{status, ok, text, json}` — plus `recovered`, so this is a
 * drop-in at the call sites that already POST `/capture` and read `response.ok` / `body.error`. Keeping
 * their own classification is deliberate: a shared client that also decided what counts as a failure would
 * be changing ten behaviours at once while claiming to change one.
 *
 * `requestJson` RESOLVES on an HTTP error and REJECTS only on a transport one, so the `catch` below is
 * reached exactly by the case this exists for — `ETIMEDOUT`, `ECONNRESET`, a socket dying mid-answer.
 *
 * `waitForWorker` is deliberately NOT called here. The dataset runner has one, tuned to a corpus run's
 * tolerance for a box gone for minutes; a gate wants an answer quickly. So this asks once, immediately,
 * and a caller that wants to wait first passes `beforeRecovery`.
 *
 * @param {{ worker: string, body: object, timeoutMs?: number,
 *           beforeRecovery?: (error: unknown) => Promise<void>,
 *           onProgress?: (progress: object) => void, sync?: boolean }} request
 */
export async function captureTolerantly({ worker, body, timeoutMs = CAPTURE_CLIENT_TIMEOUT_MS, beforeRecovery,
  onProgress, sync = syncByEnv() }) {
  const captureId = randomUUID();
  if (!sync) return pollForResult({ worker, body, captureId, timeoutMs, onProgress });
  // Said once, at the moment it applies, rather than at import: the synchronous form holds a connection
  // open and silent for the whole capture, which is the shape that lost 9 of 40 responses on this fleet.
  process.stderr.write("A11Y_SYNC_CAPTURE — holding one connection open for this capture\n");
  try {
    return { ...await post(worker, { ...body, captureId }, timeoutMs), recovered: false, pollsSurvived: 0 };
  } catch (error) {
    if (!isTransient(error)) throw error;
    // The error is handed over so a caller can SAY why it is waiting. The dataset runner prints
    // "worker unreachable (<message>)" before a multi-minute wait, and a wait with no stated cause is
    // one an operator kills.
    if (beforeRecovery) await beforeRecovery(error);
    const recovered = await recoverCapture(worker, captureId);
    // A recovered capture is the ORIGINAL response, returned rather than re-requested. `recovered` travels
    // with it because a caller measuring the transport needs to know this one cost a round trip and not a
    // capture -- reporting it as a clean first attempt would hide the very fault this exists for.
    if (recovered) return { ...recovered, recovered: true, pollsSurvived: 0 };
    return { ...await post(worker, { ...body, captureId: randomUUID() }, timeoutMs), recovered: false, pollsSurvived: 0 };
  }
}

/**
 * DISPATCH, THEN POLL — the async path, and the reason this module exists.
 *
 * `POST {async:true}` returns 202 in milliseconds, so no connection is held while NVDA reads a page. The
 * result is collected from the store with `GET /capture/<id>`, which is the endpoint that has existed for
 * this shape all along and was only ever reached after a failure. **The recovery path is now the normal
 * path**, which is what stops it rotting: a route that runs only when something breaks is one nobody
 * notices has broken.
 *
 * A dropped poll costs one round trip and is simply retried; the capture is unaffected because nothing is
 * riding on that socket. That is the whole difference from the synchronous form, where the answer existed
 * only in the connection that was carrying it.
 */
/**
 * @param {{ worker: string, body: object, captureId: string, timeoutMs: number,
 *           onProgress?: (progress: object) => void }} request
 */
async function pollForResult({ worker, body, captureId, timeoutMs, onProgress }) {
  const accepted = await post(worker, { ...body, captureId, async: true }, ACCEPT_TIMEOUT_MS);
  // A worker too old to know `async` runs the capture SYNCHRONOUSLY and answers 200 with the result. That
  // is not an error and must not be retried -- it is the additive-field contract this project uses for
  // every wire change, and it means a host can be deployed before the fleet.
  if (accepted.status !== 202) return { ...accepted, recovered: false, pollsSurvived: 0 };

  const deadline = Date.now() + timeoutMs;
  let transportFailures = 0;
  let survived = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (onProgress) await readProgress(worker, onProgress);
    const poll = await pollOnce(worker, captureId);
    if (poll.done) {
      // WHAT THE TRANSPORT DID, carried out with the result. Under the synchronous protocol a dropped
      // response destroyed the capture; here it costs one poll -- but "harmless" and "not happening" are
      // different facts, and only one of them means the network is healthy. Reporting it keeps the
      // question answerable after the fix that stopped it mattering.
      return { ...poll.response, recovered: false, pollsSurvived: survived };
    }
    if (poll.lost) {
      throw Object.assign(new Error(`worker forgot capture ${captureId} after accepting it — it restarted `
        + "mid-capture, so the work is gone and the case must be re-issued"), { code: "CAPTURE_LOST" });
    }
    // A FAILED POLL IS NOT A FAILED CAPTURE, and conflating them would give back the defect this design
    // removes: the worker is still working, we merely could not ask. Retried until a RUN of them says the
    // box has gone, rather than on the first one -- a single dropped request is the exact fault this exists
    // to survive.
    if (poll.unreachable) survived += 1;
    transportFailures = poll.unreachable ? transportFailures + 1 : 0;
    if (transportFailures >= MAX_POLL_FAILURES) throw poll.error;
  }
  throw Object.assign(new Error(`capture ${captureId} did not finish within ${timeoutMs} ms`),
    { code: "ETIMEDOUT" });
}

/**
 * ONE POLL, WITH FOUR DISTINCT ANSWERS — and keeping them apart is the whole job.
 *
 *   done        the capture finished (200 or 500); the 500 carries the worker's own fault code
 *   lost        404 AFTER a 202 acceptance: the worker restarted, the work is gone, re-issue
 *   running     202; keep waiting
 *   unreachable we could not ask; the capture is unaffected
 *
 * NOT `recoverCapture`, and that is the correction. It SWALLOWS a transport error and returns null, which
 * is right for its own job — "we already failed, is the result there?" — and wrong here, because it makes
 * "could not ask" indistinguishable from "still running". Written that way first, and the retry counter
 * built on it was unreachable: found by mutation, since deleting the retry changed nothing.
 *
 * @param {string} worker @param {string} captureId
 */
async function pollOnce(worker, captureId) {
  let response;
  try {
    response = await requestJson(`${base(worker)}/capture/${captureId}`, { timeoutMs: RECOVERY_TIMEOUT_MS });
  } catch (error) {
    return { unreachable: true, error };
  }
  if (response.status === 404) return { lost: true };
  if (response.status === 202) return { running: true };
  // 200 and 500 are both ANSWERS: the second is the worker's diagnosis, and losing it would replace a
  // fault code with silence -- which this project has repeatedly misread as a dead machine.
  if (response.ok || response.status === 500) return { done: true, response };
  // Anything else is a worker speaking a protocol we do not know; treat it as unreachable rather than as
  // an answer, so it is retried and then surfaces with its own status rather than being read as a capture.
  return { unreachable: true, error: new Error(`unexpected ${response.status} polling ${captureId}`) };
}

/** The phase the worker is IN, so a caller can tell a slow capture from a wedged one. */
async function readProgress(/** @type {string} */ worker, /** @type {(p: object) => void} */ onProgress) {
  try {
    const { json } = await requestJson(`${base(worker)}/progress`, { timeoutMs: PROGRESS_TIMEOUT_MS });
    if (json && typeof json === "object") onProgress(json);
  } catch (error) {
    // Progress is a convenience; failing to read it must never fail a capture that is going fine.
    void error;
  }
}

/** @param {string} worker @param {object} body @param {number} timeoutMs */
function post(worker, body, timeoutMs) {
  // `requestJson` serialises the body and sets the headers; passing a string here would double-encode it.
  return requestJson(`${base(worker)}/capture`, { method: "POST", body, timeoutMs });
}
