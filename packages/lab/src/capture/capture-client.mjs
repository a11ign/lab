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
 * @param {{ worker: string, body: object, timeoutMs?: number, beforeRecovery?: () => Promise<void> }} request
 */
export async function captureTolerantly({ worker, body, timeoutMs = CAPTURE_CLIENT_TIMEOUT_MS, beforeRecovery }) {
  const captureId = randomUUID();
  try {
    return { ...await post(worker, { ...body, captureId }, timeoutMs), recovered: false };
  } catch (error) {
    if (!isTransient(error)) throw error;
    if (beforeRecovery) await beforeRecovery();
    const recovered = await recoverCapture(worker, captureId);
    // A recovered capture is the ORIGINAL response, returned rather than re-requested. `recovered` travels
    // with it because a caller measuring the transport needs to know this one cost a round trip and not a
    // capture -- reporting it as a clean first attempt would hide the very fault this exists for.
    if (recovered) return { ...recovered, recovered: true };
    return { ...await post(worker, { ...body, captureId: randomUUID() }, timeoutMs), recovered: false };
  }
}

/** @param {string} worker @param {object} body @param {number} timeoutMs */
function post(worker, body, timeoutMs) {
  // `requestJson` serialises the body and sets the headers; passing a string here would double-encode it.
  return requestJson(`${base(worker)}/capture`, { method: "POST", body, timeoutMs });
}
