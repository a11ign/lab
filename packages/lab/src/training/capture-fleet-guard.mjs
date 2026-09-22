// @ts-check
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
 * Checked at the BOUNDARY of a capture run, for the same reason `assertWorkerUrl` is: the alternative is
 * discovering it in the evidence weeks later, where a split fleet looks like a page that changed. And
 * re-checked after the run, because "consistent when it started" is exactly the claim that failed.
 *
 * FOR TWO MONTHS IT COULD NOT FIRE (#2018). It passed each guest's raw `/health` payload straight to
 * `fleetConsistency`, and `/health` answers `{ ok, screenReader, busy, code, environment }` — no `worker`
 * key. `check()` stores every value as `values[guest.worker]`, so ten guests landed on the single key
 * `undefined`, the map held one entry however many reported, and `consistent` was true for any fleet at
 * all — including the 151-against-150 split this function exists for, and which it had already caught
 * once by hand. Nothing typed it: `fleetConsistency` documents `{worker, environment, policy}` in JSDoc,
 * and a `.mjs` caller is not checked against a `@param`. `fleet-status.mjs` and `doctor.mjs` both build
 * the documented shape; this was the odd one out, so the fix is to join them rather than to loosen the
 * callee.
 *
 * ITS OWN FILE, and that is part of the same fix. It lived in `capture-real-pages.mjs`, whose import
 * closure reaches `dataset-paths.mjs` and therefore the corpus — so the acceptance job, which has no
 * `runs/`, REFUSED to run any test that imported it (`acceptance-commands.mjs`'s closure walk). A guard
 * nothing could test in CI is how this one shipped unable to fire. Nothing here reads the corpus, parses
 * a flag or knows what a role is; it asks the fleet one question.
 *
 * `--allow-mixed-browsers` stays with the flags, in the caller: this function is the check, not the
 * decision to skip it.
 */
import { requestJson } from "@a11ign/worker-fleet/worker-http";
import { fleetConsistency, describeMismatches } from "@a11ign/worker-fleet/fleet-consistency";

/** One guest's `/health` is a cheap read, and a box that needs longer than this is not one to capture on. */
const HEALTH_TIMEOUT_MS = 10_000;

/** The run stops rather than writing two browser builds into one corpus — `docs/gate-exit-codes.md`. */
export const EXIT_FLEET_INCONSISTENT = 3;

/**
 * Ask every worker what it is running, and stop the run if they do not agree.
 *
 * `deps` exists so a test can drive THIS FUNCTION rather than a pure helper beside it — the same reason
 * `fleetStatus` takes one. The defect lived entirely in the object built out of a `/health` payload, so a
 * test that stubs `fleetConsistency`, or re-derives the guests itself, holds everything except the line
 * that was wrong. Production passes nothing and the defaults are the real probe, stderr and exit.
 *
 * @param {string[]} workers
 * @param {string} when — "before the run" / "by the END of the run", quoted into the refusal
 * @param {{probe?: (url: string) => Promise<any>, report?: (text: string) => void,
 *   exit?: (code: number) => void}} [deps]
 */
export async function assertOneBrowserAcross(workers, when, deps = {}) {
  const probe = deps.probe ?? healthOfGuest;
  const report = deps.report ?? ((/** @type {string} */ text) => void process.stderr.write(text));
  const exit = deps.exit ?? ((/** @type {number} */ code) => process.exit(code));
  const guests = await Promise.all(workers.map((url) => guestFrom(url, probe)));
  // `!== null` rather than `Boolean`: a filter cannot narrow unless it says what it tests, and typing the
  // guests is the whole point of this fix — a `.filter(Boolean)` here leaves the array `(guest|null)[]`,
  // which is how a wrongly-shaped guest reached `fleetConsistency` unchecked in the first place.
  const verdict = fleetConsistency(guests.filter((guest) => guest !== null));
  if (verdict.consistent) return;
  report(`\nFLEET INCONSISTENT ${when}: ${describeMismatches(verdict.mismatches)}\n`
    + "Two browser builds must never write into one corpus — `browserVersion` is in the capture cache\n"
    + "key for exactly this reason, and a split shows up later as evidence that cannot be compared.\n"
    + "Pin the fleet (`provision-role.yml --tags edge`) or run with --allow-mixed-browsers.\n");
  exit(EXIT_FLEET_INCONSISTENT);
}

/**
 * One guest, in the shape `fleetConsistency` documents — or nothing at all.
 *
 * @param {string} url
 * @param {(url: string) => Promise<any>} probe
 */
async function guestFrom(url, probe) {
  try {
    const health = await probe(url);
    // NAMED BY WORKER, which is what makes a verdict possible at all: the values `fleetConsistency`
    // compares are keyed by `worker`, and `describeMismatches` reads those same keys to say WHICH box
    // drifted. `policy: undefined` rather than null, exactly as `fleet-status.mjs` passes it — the field
    // is optional and means "this probe collected no policy block", which is true here since `/health`
    // carries none. `null` would claim we collected an empty one.
    return health ? { worker: url, environment: health.environment, policy: undefined } : null;
  } catch {
    // Unreachable is not INCONSISTENT. A box that is asleep contributes no evidence and no mismatch,
    // and treating silence as a fault is how a check earns a reputation for crying wolf.
    return null;
  }
}

/** The real `/health` read, which `deps.probe` replaces in a test. @param {string} url */
async function healthOfGuest(url) {
  return (await requestJson(`${url}/health`, { timeoutMs: HEALTH_TIMEOUT_MS })).json ?? null;
}
