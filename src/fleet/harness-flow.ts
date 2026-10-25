/**
 * THE ONE RUNNER OF A GATE OR HARNESS THAT SUBMITS A FLEET JOB (A11-263, step 4).
 *
 * Step 3's `capture-flow.ts` is the flow (submit, record the ID, wait once or exit 75, collect, re-capture). The gates and the one-box harnesses follow it the same way, and what
 * each of them repeated was the SHELL around it: refuse a worker address in words, read `--boxes=`, `--label=` and `--wait=`, lease the page server the boxes fetch from for as long
 * as the job runs, and release it however the run ends. This is that shell, written once, so a client brings only its own cases and its own collector.
 *
 *     runFleetClient({ argv, root, kind, hint, prepare, collect })
 *
 * - `prepare(inputs)` builds the job: its cases, its groups (a group is held to ONE box, in order), and anything the collect step needs that the manifest does not hold. It may lease
 *   what the boxes fetch from (a page server) and hands back how to release it.
 * - `collect(fetched, pending)` reads the manifest and says which cases to capture again (a `fleet job recapture`, on the box the group was captured on) and how the run exits.
 *
 * `--collect[=<job ID>]` reads a job that has finished instead of submitting one.
 *
 * NO WAIT, POLL OR SLEEP IS WRITTEN HERE. `follow` calls `waitOnce`, which is `fleet job wait <id> --timeout <d>`, run once.
 */
import { EXIT_UNCOLLECTED, WAIT_EXIT, FleetInputError, fleetInputs, flagOf, workerAddressNotice } from "./fleet-job.ts";
import type { FleetCase, FleetGroups, FleetInputs } from "./fleet-job.ts";
import { collectFlow, follow, pageServerEndsNotice, pagesUnheldNotice, submitJob, uncollectedNotice } from "./capture-flow.ts";
import type { Collector, Flow, FlowDeps } from "./capture-flow.ts";

/** What a client hands the runner to submit: the job itself, and what to put away when the run ends. */
export type Prepared = {
  cases: FleetCase[];
  groups?: FleetGroups;
  /** A case ID mapped to the output it becomes. Optional: a client that writes its outputs by group needs none. */
  names?: Record<string, string>;
  /** What the collect step needs that the manifest does not hold. Stored in the pending file, so a later `--collect` has it. */
  extra?: Record<string, unknown>;
  /** Put the page server back, however the run ends. */
  release?: () => Promise<void>;
  /** Whether this process STARTED the page server (a lease it did not start stays up after it, so the boxes keep a page to fetch). */
  startedPageServer?: boolean;
};

export type ClientSpec = {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** The positional arguments, so an address given in one is dealt with where it enters. */
  positional?: readonly string[];
  /**
   * A client that runs on ONE box (a measurement a person runs against one machine): the box is a NAME, `--box=<name>` or `positional`, and `--boxes=1` when none is named.
   * An address is refused, naming the new form.
   */
  oneBox?: { positional?: string };
  /** The directory the pending files live under (`<root>/.fleet-jobs/`). */
  root: string;
  /** What this client's pending files are filed under, so `--collect` reads its own job and never another client's. */
  kind: string;
  /** The command that collects a job, for the line printed when the run stops without waiting. */
  hint: (job: string) => string;
  prepare: (inputs: FleetInputs) => Promise<Prepared>;
  collect: Collector;
  /** Maps a stop BEFORE the collector has answered (a job failed or cancelled, an unreachable service) onto the client's own exit contract. */
  stopExit?: (code: number) => number;
  deps?: FlowDeps;
};

/**
 * The exit code for a stop BEFORE the collector has answered (a job that failed or was cancelled, an unreachable service), in a client whose own contract has a code for "it could not
 * answer". The run's own 75 (submitted, not waited on) and 124 (the wait ran out, the job goes on) are not verdicts and are kept: a gate's 1 would read as "found unstable".
 */
export const stopExitWith = (couldNotAnswer: number) => (code: number): number => (code === EXIT_UNCOLLECTED || code === WAIT_EXIT.TIMEOUT ? code : couldNotAnswer);

/** The `Prepared` job of a client that leased the page server the boxes fetch from: `build` makes the job, and the lease is released when the run ends, or at once if `build` throws. */
export async function holdingPages(
  lease: { release: () => Promise<unknown>; started?: boolean },
  build: () => Omit<Prepared, "release" | "startedPageServer">,
): Promise<Prepared> {
  try {
    // A release that fails is said and not thrown: it runs in a `finally`, and must not replace the exit code the run earned.
    const release = async () => { await lease.release().catch((error: Error) => { process.stderr.write(`page server release failed: ${error.message}\n`); }); };
    return { ...build(), release, startedPageServer: lease.started === true };
  } catch (error) {
    await lease.release();
    throw error;
  }
}

/** What an address looks like: a URL, a dotted IPv4 address, or `host:port`. A box's NAME is never one of these. */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|\d{1,3}(?:\.\d{1,3}){3}|[^\s/]+:\d+)/i;

/**
 * The arguments of a one-box client with `--boxes=` filled in from the box it names. The service names boxes and never gives an address, so a client that took one would capture on a box
 * nothing had booked: it is refused in words, naming the form that works.
 */
export function singleBox(argv: readonly string[], env: NodeJS.ProcessEnv, positional?: string): string[] {
  const named = flagOf(argv, "box") ?? positional;
  const rest = argv.filter((arg) => !arg.startsWith("--box="));
  if (named === undefined || named === "") {
    return flagOf(argv, "boxes") === undefined && !env.A11Y_FLEET_BOXES ? [...rest, "--boxes=1"] : [...rest];
  }
  if (ADDRESS.test(named)) {
    // The job catalogue sets A11Y_FLEET_BOXES and still passes the old addresses: as for every other client, the address is ignored (the runner says so) and the catalogue's boxes stand.
    if (env.A11Y_FLEET_BOXES) return [...rest];
    throw new FleetInputError(`a box is named, never addressed: ${JSON.stringify(named)} is an address. Name the box instead, --box=<box name> (for example --box=a11y-worker-14), `
      + "with --label=<ticket key>; the fleet job service books it");
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(named)) {
    throw new FleetInputError(`--box= is one box's name (letters, digits, '.', '_' and '-', starting with a letter): ${JSON.stringify(named)} is not one`);
  }
  return [...rest.filter((arg) => !arg.startsWith("--boxes=")), `--boxes=${named}`];
}

/** The box a one-box client was told to use, as a name or an address: `--box=`, else the positional. Undefined when none was. */
export const namedBox = (argv: readonly string[], positional?: string): string | undefined => flagOf(argv, "box") ?? (positional || undefined);

/** `--collect` (the newest uncollected job of this kind) or `--collect=<job ID>`: the ID, `""` for none given, undefined when the flag is absent. */
export function collectFlag(argv: readonly string[]): string | undefined {
  const found = argv.find((arg) => arg === "--collect" || arg.startsWith("--collect="));
  return found === undefined ? undefined : found.slice("--collect".length + 1);
}

/** Submit what `prepare` built, follow it to the end, and put the page server back however that ends. */
async function submitAndFollow(spec: ClientSpec, flow: Flow, inputs: FleetInputs, err: (text: string) => void): Promise<number> {
  const earlier = uncollectedNotice(spec.root, spec.kind);
  if (earlier) err(earlier);
  const prepared = await spec.prepare(inputs);
  try {
    const pending = submitJob(flow, { kind: spec.kind, cases: prepared.cases, groups: prepared.groups ?? {}, names: prepared.names ?? {}, extra: prepared.extra });
    const exit = await follow(flow, [pending]);
    const ends = pageServerEndsNotice(exit, prepared.startedPageServer === true);
    if (ends) err(ends);
    return exit;
  } finally {
    await prepared.release?.();
  }
}

/** The arguments and the fleet inputs of a run: a one-box client's box is resolved, an address is ignored or refused, and what is ignored is said. */
function resolveInputs(spec: ClientSpec, err: (text: string) => void): { argv: readonly string[]; inputs: FleetInputs; collecting: string | undefined } {
  const env = spec.env ?? process.env;
  const argv = spec.oneBox ? singleBox(spec.argv, env, spec.oneBox.positional) : spec.argv;
  const named = spec.oneBox ? namedBox(spec.argv, spec.oneBox.positional) : undefined;
  const addressGiven = named !== undefined && ADDRESS.test(named);
  if (addressGiven) err(`ignoring the box address given (${named}): a box is named, never addressed, and the job catalogue's boxes (A11Y_FLEET_BOXES=${env.A11Y_FLEET_BOXES}) stand\n`);
  const notice = workerAddressNotice({ argv, env: spec.env, positional: spec.positional });
  if (notice) err(notice);
  const collecting = collectFlag(argv);
  // A box NAMED on the command line is the person's choice, and wins over the catalogue's boxes.
  const namedByPerson = named !== undefined && named !== "" && !addressGiven;
  const inputs = fleetInputs(argv, namedByPerson ? { ...env, A11Y_FLEET_BOXES: "" } : spec.env, { forCollect: collecting !== undefined });
  return { argv, inputs, collecting };
}

/**
 * Submit, follow and collect (or collect a finished job), and return the exit code. A refusal in words (`FleetInputError`) is printed and exits 2: it is a usage error, raised before
 * `fleet` runs.
 */
export async function runFleetClient(spec: ClientSpec): Promise<number> {
  const err = spec.deps?.err ?? ((text: string) => { process.stderr.write(text); });
  try {
    const { inputs, collecting } = resolveInputs(spec, err);
    const flow: Flow = { root: spec.root, inputs, hint: spec.hint, collect: spec.collect, stopExit: spec.stopExit, deps: spec.deps };
    if (collecting === undefined) return await submitAndFollow(spec, flow, inputs, err);
    const exit = await collectFlow(flow, collecting || undefined, spec.kind);
    const unheld = pagesUnheldNotice(exit);
    if (unheld) err(unheld);
    return exit;
  } catch (error) {
    err(`${(error as Error).message}\n`);
    // A refusal in words is a usage error. Anything else (`fleet` not found, the service down, a refused re-capture) is the client's "it could not answer", never the code that is a verdict.
    return error instanceof FleetInputError ? 2 : (spec.stopExit ? spec.stopExit(1) : 1);
  }
}

/** Cases that are the SAME page captured again and again, in one group: a canary's repeats, a page's samples. IDs are `<group>.<n>`, 1-based, so a repeat is named by where it ran. */
export function repeatedCases(
  { group, url, body, times }: { group: string; url: string; body: Record<string, unknown>; times: number },
): FleetCase[] {
  return Array.from({ length: times }, (_, index) => ({ id: `${group}.${index + 1}`, url, body: { ...body }, group }));
}

/** A name safe to use as a case or group ID from a path or URL: letters, digits and `.`, other runs collapsed to `-`, at most 100 characters. */
export function slugOf(name: string): string {
  const slug = name.replace(/^[a-z]+:\/\//i, "").replace(/[^A-Za-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100).replace(/[-.]+$/g, "");
  if (!slug) throw new FleetInputError(`nothing in ${JSON.stringify(name)} can name a case`);
  return slug;
}
