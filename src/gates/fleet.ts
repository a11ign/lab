// @ts-check
/**
 * WHAT A GATE SAYS ABOUT A RUN OVER THE FLEET: a verdict over the ITEMS it examined, and where the work landed.
 *
 * The gates used to SPREAD their own work: `gateWorkers` chose the boxes, `acrossFleet` dealt the items to whichever box was free through `drainAcrossPool`, and each gate dispatched its own
 * captures. None of it took a lease, so a gate collided with booked jobs, and a gate run beside a corpus capture shared its boxes by accident (A11-229 and A11-230). A gate SUBMITS a fleet job now
 * (A11-263): `src/fleet/harness-flow.ts` books the boxes through the service, and the service places the work. What is left here is what is the gate's own to say.
 *
 * A PAGE'S CAPTURES STAY ON ONE BOX, and that is the invariant the job keeps now (a GROUP is held to one box, in order). `gate:stability` captures a page N times and compares by CONTENT;
 * spreading those N across machines would conflate run-to-run instability with box-to-box difference, which need opposite remedies -- flakiness versus a fleet that is not interchangeable, and
 * `fleet-consistency` answers the second separately. So the shard boundary is BETWEEN pages, never inside one.
 */
import { gateVerdict } from "./verdict.ts";

/**
 * The verdict over the ITEMS, which is the population the caller asked about.
 *
 * The boxes are how the work was spread, not what was examined -- so the denominator stays the page list,
 * exactly as it was when this ran on one machine. Changing the denominator to match the machines is how a
 * gate comes to report a number nobody asked for.
 *
 * An item that could not be judged reduces COVERAGE; an item that came back bad is a FAILURE. "We could
 * not measure" and "it varied" need opposite responses.
 *
 * @param {{ result: unknown, error: string | null }[]} outcomes
 * @param {{ of: number, what: string, workers: number, failed: number, controlPlane?: string }} about
 */
export function fleetVerdict(outcomes: { result: unknown; error: string | null; }[], { of, what, workers, failed, controlPlane }: { of: number; what: string; workers: number; failed: number; controlPlane?: string; }) {
  return gateVerdict({
    examined: outcomes.filter((o) => o.result !== null).length,
    of,
    // THE CONTROL PLANE IS PART OF THE POPULATION, for the same reason the machine is. Two verdicts that
    // look identical were produced from hosts that were not: one lost 9 of 40 responses on a laptop whose
    // battery fell 18% to 1%, and nothing in the output said so. Absent means an older caller that has not
    // been given it -- never "it ran somewhere fine".
    source: `${what}, run as a fleet job on ${workers} box(es)`
      + (controlPlane ? `, driven from ${controlPlane}` : ""),
    failures: failed,
  });
}

/**
 * Where the work actually LANDED, counted after the fact.
 *
 * The service places the groups, so there is no shard list to print up front -- this reports the real
 * distribution, which is more useful anyway: an uneven split is EVIDENCE that one box is slower (or that a
 * group was larger) rather than an artefact of how the work was dealt.
 */
export function renderShards(outcomes: { worker: string; }[]) {
  /** @type {Map<string, number>} */
  const byWorker: Map<string, number> = new Map();
  for (const o of outcomes) byWorker.set(o.worker, (byWorker.get(o.worker) ?? 0) + 1);
  return [...byWorker].sort().map(([w, n]) => `  ${w.padEnd(28)} ${n} item(s)`).join("\n");
}
