// @ts-check
/**
 * A corpus run outlives the host's patience, and a sleeping host looks exactly like a dead worker.
 *
 * Measured, not hypothesised: a recapture launched on this Mac died with
 * `CAPTURE_FAILED ... the worker did not come back within 10 minutes` on case after case. The guest was
 * fine. `pmset -g log` showed the host had run down to 1% and hibernated:
 *
 *   08:49:37  Entering Sleep      Using Batt (Charge:1%)   821 secs
 *   09:07:09  Wake from Hibernate                          Using AC (Charge:3%)
 *
 * WHAT THE MECHANISM ACTUALLY IS, because the first version of this comment got it wrong in a way that
 * outlived the architecture. It said a hibernated host "cannot answer for its guests" — guests being the
 * UTM VMs that then ran on this Mac. Those are deprecated; the fleet is five bare-metal boxes with their
 * own power, and this laptop sleeping does nothing to them at all. The dependency is real anyway, and it
 * is a different one: a laptop-driven run SERVES THE CORPUS PAGES to the fleet on port 5050 and DRIVES
 * THE DISPATCH, so a sleeping host starves five perfectly healthy workers of both. That is why every
 * in-flight capture times out and the run marks the worker unreachable — and why it was first
 * misdiagnosed as host memory over-commitment, a theory built from symptoms observed only AFTER the event.
 *
 * Keeping the stale reasoning would have been the cheaper mistake of the two. The guard fires correctly
 * while explaining a machine that no longer exists, so the next person to read it concludes the guard is
 * obsolete and overrides it — which is the outcome, not a hypothetical.
 *
 * SO THE REFUSAL NAMES THE LAB, NOT JUST THE OVERRIDE FLAG. `--allow-battery` was for months the only exit
 * this guard offered, and `capture-host.mjs` records what that produced on 2026-08-28: the flag was passed
 * rather than the dependency understood. A long run belongs on the lab (`lab:job -e job=capture`), where it
 * is one systemd unit that outlives the ssh connection and this host's battery cannot reach it. An override
 * is the right answer for a short local run and the wrong one for an overnight corpus, and a guard that
 * offers only the override cannot tell you which you are doing.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { errorText } from "@a11y-witness/nvda-worker/error-text";

const run = promisify(execFile);

/** Below this, a multi-hour run cannot expect to finish before the host sleeps. */
const MIN_BATTERY_PERCENT = 30;

/**
 * Decide whether a long run may start, given the host's power state.
 *
 * Pure so it can be tested without a Mac in a particular battery state — the reason this is separated
 * from the `pmset` call at all. Returns a reason rather than throwing: the caller decides whether a
 * warning or a refusal is right, and a short run has every right to proceed on battery.
 */
/**
 * @param {{onAcPower: boolean, batteryPercent: number, estimatedHours: number}} reading
 */
export function powerVerdict({ onAcPower, batteryPercent, estimatedHours }) {
  if (onAcPower) return { ok: true };
  // A run measured in hours on battery will not finish, and the failure it produces is misleading
  // rather than obvious — that is what makes this worth refusing rather than warning about.
  if (estimatedHours >= 1) {
    return {
      ok: false,
      reason: `on battery (${batteryPercent}%) with an estimated ${estimatedHours}h run. This host serves `
        + "the corpus pages and drives the dispatch, so when it sleeps every in-flight capture times out "
        + "and the run reports an unreachable worker — which reads as a broken guest, and was "
        + "misdiagnosed here as exactly that. The five fleet boxes are unaffected; it is this machine "
        + "that goes away.\n"
        + "  A run this long belongs on the lab, where this host is not in the path at all:\n"
        + "    npm run lab:job -- -e job=capture\n"
        + "  Otherwise plug in, or pass --allow-battery if you accept the risk.",
    };
  }
  if (batteryPercent < MIN_BATTERY_PERCENT) {
    return { ok: false, reason: `battery at ${batteryPercent}%, below the ${MIN_BATTERY_PERCENT}% floor` };
  }
  return { ok: true };
}

/**
 * Read the host's power state. macOS only; anywhere else this reports AC so the guard never blocks a
 * platform it cannot measure — refusing to run because we could not ask is the same conflation this
 * project forbids everywhere else.
 */
export async function hostPowerState() {
  if (process.platform !== "darwin") return { onAcPower: true, batteryPercent: 100, measured: false };
  try {
    const { stdout } = await run("pmset", ["-g", "batt"]);
    const onAcPower = /'AC Power'/.test(stdout);
    const percent = stdout.match(/(\d+)%/);
    return { onAcPower, batteryPercent: percent ? Number(percent[1]) : 100, measured: true };
  } catch (error) {
    // Never block a run because the probe itself failed; say so and continue.
    return { onAcPower: true, batteryPercent: 100, measured: false, error: errorText(error) };
  }
}

/**
 * Hold the host awake for the lifetime of the caller, and hand back a release.
 *
 * `caffeinate -s` asserts only that the SYSTEM stays awake — the display may sleep, which is what you
 * want overnight. Leased the same way as the worker VMs and the page server: the caller gets a release
 * and the process dies with us if it never calls it, so a crashed run cannot leave the host pinned
 * awake forever.
 */
export function keepHostAwake() {
  if (process.platform !== "darwin") return { release: async () => {}, held: false };
  const child = spawn("caffeinate", ["-s"], { stdio: "ignore", detached: false });
  child.unref?.();
  let released = false;
  return {
    held: true,
    release: async () => {
      if (released) return;
      released = true;
      child.kill();
    },
  };
}
