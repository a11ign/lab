/**
 * THE ONE FLOW EVERY MOVED CAPTURE CLIENT FOLLOWS (A11-263): submit, record the ID, wait once or stop, collect from the manifest, re-capture what a check rejects.
 *
 *     submit  ->  pending file  ->  [wait once]  ->  fetch  ->  collect  ->  (re-capture  ->  wait once  ->  fetch  ->  collect)...
 *
 * - WITH A WAIT (`A11Y_FLEET_WAIT` or `--wait=`) the client calls `fleet job wait` once per job, in the foreground, collects, and goes round again for each re-capture the collector
 *   asks for. The wait is ONE BUDGET across the whole run, so submit, collect and every re-capture end inside it and the unit's own `RuntimeMaxSec`.
 * - WITHOUT ONE it prints the job ID and the command that collects it, and exits 75, so a pipeline that forgot to say how long to wait stops here and never exports a corpus it has not collected.
 * - `--collect[=<job ID>]` reads a job that has finished (the newest uncollected one when no ID is given), writes its outputs, and does what a wait would have done.
 *
 * What a client brings is only what is its own: the cases it submits, and a collector that writes its outputs from a fetched job and says which cases it wants captured again.
 * No wait, poll or sleep is written here or in any client; `waitOnce` is the one wait.
 */
import { join } from "node:path";
import {
  EXIT_UNCOLLECTED, WAIT_EXIT, FleetInputError, fetchManifest, markCollected, newestPending, pendingDir, readPending, recapture, submitCases, waitOnce, writePending,
} from "./fleet-job.ts";
import type { FetchedJob, FleetCase, FleetGroups, FleetInputs, Pending, RunFleet } from "./fleet-job.ts";

/** What a collector says after it has written what it can from a fetched job. */
export type CollectOutcome = {
  /** Cases to capture again, on the box their group was captured on (`fleet job recapture`). The collector has counted these as attempts. */
  recapture: string[];
  /** Cases to submit again WHOLE, in a new job, because the box their group sat on left the fleet. */
  resubmit?: { cases: FleetCase[]; groups: FleetGroups; names: Record<string, string>; extra?: Record<string, unknown> };
  /** The exit the run ends with when nothing more is asked of it: 0, or 1 when it finished with failures. */
  exit: number;
};
export type Collector = (fetched: FetchedJob, pending: Pending) => CollectOutcome | Promise<CollectOutcome>;

export type FlowDeps = {
  run?: RunFleet;
  out?: (text: string) => void;
  err?: (text: string) => void;
  now?: () => number;
};

const DEFAULTS = {
  out: (text: string) => { process.stdout.write(text); },
  err: (text: string) => { process.stderr.write(text); },
  now: () => Date.now(),
};

const UNIT_SECONDS = { s: 1, m: 60, h: 3600 } as const;

/** `28800s`, `30m`, `2h` as milliseconds. The caller has already validated the shape, so a malformed one is a bug, not input. */
export function durationMs(text: string): number {
  const match = /^([0-9]+)([smh])$/.exec(text);
  if (!match) throw new FleetInputError(`a duration is a whole number and a unit, such as 90s, 30m or 2h: ${JSON.stringify(text)} is not one`);
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS] * 1000;
}

const secondsOf = (ms: number): string => `${Math.max(1, Math.ceil(ms / 1000))}s`;

/** The command that collects a job: the one this client was started as, with `--collect=<id>` in place of whatever submitted it. */
export type CollectHint = (job: string) => string;

export type Flow = {
  /** The directory the pending files live under (`<root>/.fleet-jobs/`): the dataset, the real-page corpus or the evidence check's own. */
  root: string;
  inputs: FleetInputs;
  collect: Collector;
  hint: CollectHint;
  deps?: FlowDeps;
};

/** Submit a job of cases and record it. Returns the pending record, which is written before anything else can fail. */
export function submitJob(
  flow: Pick<Flow, "root" | "inputs" | "deps">,
  { kind, cases, groups, names, extra }: { kind: string; cases: FleetCase[]; groups: FleetGroups; names: Record<string, string>; extra?: Record<string, unknown> },
): Pending {
  const job = submitCases({ cases, groups, boxes: flow.inputs.boxes, label: flow.inputs.label, dir: pendingDir(flow.root), run: flow.deps?.run });
  const pending: Pending = { job, label: flow.inputs.label, submittedAt: new Date((flow.deps?.now ?? DEFAULTS.now)()).toISOString(), kind, names, ...(extra ? { extra } : {}) };
  writePending(flow.root, pending);
  (flow.deps?.err ?? DEFAULTS.err)(`submitted ${cases.length} ${cases.length === 1 ? "case" : "cases"} as ${job}\n`);
  return pending;
}

/** A job that has not ended cleanly has nothing to collect: the exit code `fleet job wait` would have given for its state. */
function unendedExit(fetched: FetchedJob, err: (text: string) => void): number | null {
  const { state, reason } = fetched.manifest;
  if (state === "done") return null;
  if (state === "failed") { err(`${fetched.job} FAILED: ${reason ?? "no reason was recorded"}\n`); return WAIT_EXIT.FAILED; }
  if (state === "cancelled") { err(`${fetched.job} was cancelled${reason ? `: ${reason}` : ""}\n`); return WAIT_EXIT.CANCELLED; }
  err(`${fetched.job} is ${state}, not done: declare the wait on it and collect when it has finished\n`);
  return WAIT_EXIT.TIMEOUT;
}

/** Fetch a job's results and hand them to the collector, then mark the job collected. A job that did not end `done` is a stop, with the exit code its state means. */
async function collectOne(flow: Flow, pending: Pending): Promise<CollectOutcome | { stop: number }> {
  const fetched = fetchManifest({ job: pending.job, dir: join(pendingDir(flow.root), "fetched"), run: flow.deps?.run });
  const stop = unendedExit(fetched, flow.deps?.err ?? DEFAULTS.err);
  if (stop !== null) return { stop };
  const outcome = await flow.collect(fetched, pending);
  markCollected(flow.root, pending);
  return outcome;
}

/** The follow-up jobs a collect asked for, each with its own pending file. */
function followUps(flow: Flow, from: Pending, outcome: CollectOutcome): Pending[] {
  const jobs: Pending[] = [];
  // A `--collect` carries no label of its own: a re-capture is booked under the label the job was submitted with.
  const label = flow.inputs.label || from.label;
  const submittedAt = new Date((flow.deps?.now ?? DEFAULTS.now)()).toISOString();
  if (outcome.recapture.length) {
    const job = recapture({ job: from.job, caseIds: outcome.recapture, label, run: flow.deps?.run });
    const names = Object.fromEntries(outcome.recapture.map((id) => [id, from.names[id] ?? ""]));
    const next: Pending = { job, label, submittedAt, kind: from.kind, names, recaptureOf: from.job, ...(from.extra ? { extra: from.extra } : {}) };
    writePending(flow.root, next);
    jobs.push(next);
  }
  if (outcome.resubmit) {
    jobs.push(submitJob(flow, { kind: from.kind, ...outcome.resubmit, extra: outcome.resubmit.extra ?? from.extra }));
  }
  return jobs;
}

/**
 * The page server a client leased stops with the client. A run with no wait exits at once, so the boxes would be fetching pages from a server that is gone: say so, and what to do.
 */
export function noWaitPageServerNotice(inputs: FleetInputs, startedByThisProcess: boolean): string | null {
  if (inputs.wait !== null || !startedByThisProcess) return null;
  return "This process started the page server the boxes fetch from, and stops it when it exits. Run with --wait=<duration> (or A11Y_FLEET_WAIT) to hold it "
    + "for the job, or serve the pages from a server that stays up.\n";
}

/** Say what is to be collected and how, for a run that has stopped without waiting. */
function printUncollected(flow: Flow, jobs: readonly Pending[]): void {
  const err = flow.deps?.err ?? DEFAULTS.err;
  const out = flow.deps?.out ?? DEFAULTS.out;
  for (const { job } of jobs) out(`${job}\n`);
  err(`the job${jobs.length === 1 ? "" : "s"} run${jobs.length === 1 ? "s" : ""} on the control plane and go${jobs.length === 1 ? "es" : ""} on without this process. Declare the wait, `
    + `waitingOn: [${jobs.map(({ job }) => `{ "fleetJob": "${job}" }`).join(", ")}], and end the turn; when it is done: ${jobs.map(({ job }) => flow.hint(job)).join("  ;  ")}\n`);
}

/** Wait for one job from what is left of the budget, and return the exit code that stops the run, or null when the job is done and ready to collect. */
function waitForJob(flow: Flow, pending: Pending, deadline: number | null): number | null {
  const err = flow.deps?.err ?? DEFAULTS.err;
  if (deadline === null) return EXIT_UNCOLLECTED;
  const left = deadline - (flow.deps?.now ?? DEFAULTS.now)();
  if (left < 1000) { err(`the wait budget ran out before ${pending.job} was waited on; it goes on in the service. ${flow.hint(pending.job)}\n`); return WAIT_EXIT.TIMEOUT; }
  const code = waitOnce({ job: pending.job, duration: secondsOf(left), run: flow.deps?.run });
  if (code === WAIT_EXIT.TIMEOUT) err(`${pending.job} is still running; it goes on in the service. ${flow.hint(pending.job)}\n`);
  return code === WAIT_EXIT.DONE ? null : code;
}

/**
 * Follow the submitted jobs to the end of what this run was asked to do, and return the exit code.
 *
 * `wait` null: print the IDs and the collect command, exit 75. `wait` set: one `fleet job wait` per job from one shared budget; 124 (the budget ran out, the job goes on) and 1 or 3 (the job
 * failed or was cancelled) end the run with that code and the command that collects what is there.
 */
export async function follow(flow: Flow, first: Pending[], { collectNow = false }: { collectNow?: boolean } = {}): Promise<number> {
  const now = flow.deps?.now ?? DEFAULTS.now;
  const queue = [...first];
  const deadline = flow.inputs.wait === null ? null : now() + durationMs(flow.inputs.wait);
  let exit = 0;
  for (let pending = queue.shift(), collected = collectNow; pending; pending = queue.shift(), collected = false) {
    const stop = collected ? null : waitForJob(flow, pending, deadline);
    if (stop === EXIT_UNCOLLECTED) printUncollected(flow, [pending, ...queue]);
    if (stop !== null) return stop;
    const outcome = await collectOne(flow, pending);
    if ("stop" in outcome) return outcome.stop;
    exit = Math.max(exit, outcome.exit);
    queue.push(...followUps(flow, pending, outcome));
  }
  return exit;
}

/** `--collect[=<job ID>]`: read a job that has finished, and carry on as a wait would have. */
export async function collectFlow(flow: Flow, job: string | undefined, kind: string): Promise<number> {
  const err = flow.deps?.err ?? DEFAULTS.err;
  const pending = job ? readPending(flow.root, job) : newestPending(flow.root, kind);
  if (!pending) {
    err(job ? `no pending ${kind} job ${job} under ${pendingDir(flow.root)}: it was never submitted from here, or it is not one of this client's\n`
      : `no uncollected ${kind} job under ${pendingDir(flow.root)}: submit one first\n`);
    return WAIT_EXIT.USAGE;
  }
  return follow(flow, [pending], { collectNow: true });
}
