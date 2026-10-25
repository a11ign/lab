/**
 * THE LAB'S ONE CLIENT OF THE `fleet` COMMAND (A11-263). No other lab file runs it.
 *
 * Fleet work is a job the control plane runs and books (control `docs/fleet-jobs.md`), and a lab client that captures submits one: it hands the service its
 * cases (each with its own body, and a group that holds cases to one box), records the job ID, waits once if it was told to, and reads the results from the
 * manifest. It runs no capture of its own, so it has no wait loop, no `pgrep` and no address of a box. The command is reached as a command, never by import (ADR 0045).
 *
 * WHAT THIS FILE KEEPS OUT: any wait other than `fleet job wait <id> --timeout <d>`, run once and in the foreground. That command always ends (control's
 * `docs/fleet-jobs.md`, "`wait` always ends"), which is the property A11-229's `until ! pgrep -f` loop lacked when it slept 11 hours.
 *
 * Every function takes its `fleet` runner as a parameter and defaults it to the real command, so a test points `FLEET` at a stub script (or hands a function) and nothing
 * here touches the control plane.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hostAddressForWorker } from "@a11ign/screenreader-fleet/host-address";
import type { Loose } from "../capture/loose.ts";

/** `EX_TEMPFAIL`: the job was submitted and has not been collected. A pipeline that forgot to say how long to wait stops here, and never exports an uncollected corpus. */
export const EXIT_UNCOLLECTED = 75;

/** `fleet job wait`'s own exit codes, which a moved client passes on. */
export const WAIT_EXIT = { DONE: 0, FAILED: 1, USAGE: 2, CANCELLED: 3, TIMEOUT: 124 } as const;

/** The label a job is booked under: a ticket key. Control's `src/fleet-jobs/label.ts` is the definition; `lab-job.yml` states it once more, and this is the lab's copy of it. */
export const LABEL = /^[A-Za-z0-9._-]{1,64}$/;
const BOXES = /^(?:ready|[0-9]+|[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*)$/;
const DURATION = /^[0-9]+[smh]$/;
const JOB_ID = /^fj-[A-Za-z0-9-]+$/;

/** A refusal in words, thrown before `fleet` runs so a malformed input never reaches the control plane. */
export class FleetInputError extends Error {}

/** One capture of a job: its URL, the worker's own `/capture` body for it (sent exactly, with `url` added), and the group that holds it to one box. */
export type FleetCase = { id: string; url: string; body: Record<string, unknown>; group?: string };
/** What a group asks of the service: leave it alone when every named `/health` environment field already reads as given on its box. */
export type FleetGroups = Record<string, { skipWhen?: { environment: Record<string, unknown> } }>;

export type ManifestCapture = {
  page: string; pass: number; case: string | null; group: string | null; attempt: number; file: string; box: string;
  status: "pending" | "dispatched" | "done" | "failed" | "skipped"; startedAt: string | null; finishedAt: string | null;
  httpStatus: number | null; error: string | null; note: string | null;
};
export type ManifestBox = {
  name: string; workerCode: string | null; windowsBuild: string | null; edge: string | null; nvda: string | null; read: boolean;
  /** The box's whole `/health` environment, which a case job's manifest keeps so a client can stamp provenance from it. */
  environment: Record<string, unknown> | null;
};
export type Manifest = {
  version: number; job: string; label: string; state: string; reason: string | null; recaptureOf?: string | null;
  cases?: { id: string; url: string; group: string; body: Record<string, unknown>; attempt: number }[];
  boxes: ManifestBox[]; dropped: { box: string; reason: string }[];
  agreement: { consistent: boolean; mismatches: unknown; reportedOnly: unknown; compared: unknown };
  captures: ManifestCapture[];
};
/** A capture's record under `results/`: the worker's answer, naming the box and never its address. */
export type CaptureRecord = { capturedAt: string; worker: string; status: number; capture: Loose; note?: string };

export type FleetRun = { code: number | null; stdout: string; stderr: string };
/** Runs `fleet <args>`. `inherit` hands the command this process's stdio, for the one command whose own output a person reads (`job wait`). */
export type RunFleet = (args: string[], options?: { inherit?: boolean }) => FleetRun;

/** `$FLEET` if it is set, else `fleet` on `PATH`. Tests point `FLEET` at a stub. */
export function fleetCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.FLEET || "fleet";
}

const MAX_BUFFER = 256 * 1024 * 1024;

/** The real runner: `fleet` as a child, with no shell, so nothing in an argument is interpreted. */
export function realFleet(env: NodeJS.ProcessEnv = process.env): RunFleet {
  return (args, { inherit = false } = {}) => {
    const run = spawnSync(fleetCommand(env), args, { env, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    if (run.error) return { code: null, stdout: "", stderr: `could not run ${fleetCommand(env)}: ${run.error.message}\n` };
    return { code: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
  };
}

/** The first word on a line that is a job ID: `fleet capture submit` and `fleet job recapture` print it at once, ahead of a hint for a person at a terminal. */
export function jobIdFrom(stdout: string): string | null {
  return stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => JOB_ID.test(line)) ?? null;
}

// ---- Where the inputs come from -------------------------------------------------------------------------------------------------------------------------

/** `--name=value` from an argument list, or undefined. The last one given wins, as it does for every other flag in the lab. */
export function flagOf(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length)).at(-1);
}

const given = (value: string | undefined): string | undefined => (value === undefined || value === "" ? undefined : value);

export type FleetInputs = { boxes: string; label: string; wait: string | null };

/**
 * The boxes, the label and the wait a moved client submits with.
 *
 * - boxes: `A11Y_FLEET_BOXES`, else `--boxes=`, else `ready`;
 * - the label: `A11Y_FLEET_LABEL`, else `--label=`, and REFUSED if neither is set, before `fleet` runs: a job is booked under a ticket key. A `--collect` (`forCollect`) may leave
 *   it out: the job it reads was booked under a label already, which a re-capture it asks for is booked under too;
 * - the wait: `A11Y_FLEET_WAIT`, else `--wait=`, and with neither the client submits, records the ID and does not wait.
 */
export function fleetInputs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, { forCollect = false }: { forCollect?: boolean } = {}): FleetInputs {
  const boxes = given(env.A11Y_FLEET_BOXES) ?? given(flagOf(argv, "boxes")) ?? "ready";
  const label = given(env.A11Y_FLEET_LABEL) ?? given(flagOf(argv, "label")) ?? (forCollect ? "" : undefined);
  const wait = given(env.A11Y_FLEET_WAIT) ?? given(flagOf(argv, "wait")) ?? null;
  if (label === undefined) {
    throw new FleetInputError("a fleet job is booked under a ticket key: pass --label=<ticket key> (or set A11Y_FLEET_LABEL), for example --label=A11-263");
  }
  refuseMalformed({ boxes, label, wait });
  return { boxes, label, wait };
}

/** Each input's shape, in words, before `fleet` runs. An empty label is a `--collect` that named none, which is not malformed. */
function refuseMalformed({ boxes, label, wait }: FleetInputs): void {
  if (label !== "" && !LABEL.test(label)) throw new FleetInputError(`the label is a ticket key (letters, digits, '.', '_' and '-', at most 64): ${JSON.stringify(label)} is not one`);
  if (!BOXES.test(boxes)) {
    throw new FleetInputError(`--boxes is a number of boxes, \`ready\`, or box names separated by commas: ${JSON.stringify(boxes)} is none of these`);
  }
  if (wait !== null && !DURATION.test(wait)) {
    throw new FleetInputError(`--wait is a whole number and a unit, such as 90s, 30m or 2h: ${JSON.stringify(wait)} is not one`);
  }
}

/**
 * A worker ADDRESS given to a moved client: `--worker=`, a positional address, `A11Y_WORKER` or `A11Y_WORKERS`.
 *
 * The client no longer knows a box's address; the service names boxes and never gives one. So an address is IGNORED, with one stderr line, when `A11Y_FLEET_BOXES` is set
 * (the job catalogue still passes the old addresses until the lab on the lab host is the one that reads the new variables), and REFUSED, naming the new form, when it is not.
 *
 * @returns the line to print when an address was ignored, else null.
 */
export function workerAddressNotice(
  { argv, env = process.env, positional = [] }: { argv: readonly string[]; env?: NodeJS.ProcessEnv; positional?: readonly string[] },
): string | null {
  const addresses = [flagOf(argv, "worker"), ...positional, env.A11Y_WORKER, env.A11Y_WORKERS].filter((a): a is string => given(a) !== undefined);
  if (!addresses.length) return null;
  if (given(env.A11Y_FLEET_BOXES) !== undefined) {
    return `ignoring the worker address(es) given (${addresses.join(", ")}): this client submits to the fleet job service, which books the boxes (A11Y_FLEET_BOXES=${env.A11Y_FLEET_BOXES})\n`;
  }
  throw new FleetInputError(`a worker address is not taken any more (${addresses.join(", ")}): the fleet job service books the boxes. `
    + "Name them instead, --boxes=<a number|ready|box,box> with --label=<ticket key>");
}

/** NAME=value lines of a `fleet.env` file (an `export ` before the name, and quotes around the value, are allowed). The file is read, never run. */
export function parseEnvFile(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*?)\s*$/.exec(line);
    if (match) found[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return found;
}

const readText = (path: string): string | null => {
  try { return readFileSync(path, "utf8"); } catch { return null; }
};

/**
 * The control plane's address, which is how this host knows which subnet the boxes are on: `A11Y_CONTROL_HOST`, else the file `A11Y_CONTROL_HOST_FILE` names, from the
 * environment or from `/etc/a11ign/fleet.env` (the lab) or `~/.config/a11ign/fleet.env` (the agents host).
 */
export function controlHost(env: NodeJS.ProcessEnv = process.env, read: (path: string) => string | null = readText): string | null {
  const files = [read("/etc/a11ign/fleet.env"), read(join(env.HOME ?? homedir(), ".config/a11ign/fleet.env"))];
  const fromFiles = Object.assign({}, ...files.map((text) => parseEnvFile(text ?? ""))) as Record<string, string>;
  const host = given(env.A11Y_CONTROL_HOST) ?? given(fromFiles.A11Y_CONTROL_HOST);
  if (host) return host;
  const file = given(env.A11Y_CONTROL_HOST_FILE) ?? given(fromFiles.A11Y_CONTROL_HOST_FILE);
  return file ? (read(file)?.trim() || null) : null;
}

/** This host's address as the boxes see it (its address on the control plane's subnet), or the words for why it cannot be worked out. */
function addressTheBoxesReach(env: NodeJS.ProcessEnv, read: (path: string) => string | null): string {
  const host = controlHost(env, read);
  if (!host) {
    throw new FleetInputError("cannot work out the address the boxes fetch pages from: the URL names this host as localhost and no control plane address is known "
      + "(A11Y_CONTROL_HOST, or A11Y_CONTROL_HOST_FILE in the fleet.env this host reads). Give the URL the boxes should use instead, as DATASET_BASE_URL");
  }
  const address = hostAddressForWorker(`http://${host}`);
  if (!address) {
    throw new FleetInputError(`cannot work out this host's address as seen from the control plane at ${host}: no local interface shares its subnet. `
      + "Give the URL the boxes should use instead, as DATASET_BASE_URL");
  }
  return address;
}

/**
 * A URL the BOXES can fetch: one that names this host as `localhost` is rewritten to this host's address on the control plane's subnet, which the boxes share. A box's
 * `localhost` is the box; left alone, every capture would read an error page and record it as evidence. Any other URL is returned as it is.
 */
export function reachableFromBoxes(url: string, env: NodeJS.ProcessEnv = process.env, read: (path: string) => string | null = readText): string {
  const parsed = new URL(url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return url;
  parsed.hostname = addressTheBoxesReach(env, read);
  return parsed.toString().replace(/\/$/, "");
}

/** The base URL the BOXES fetch the dataset pages from: `DATASET_BASE_URL`, else `http://localhost:<port>`, either made reachable from the boxes. */
export function pagesBaseUrl(env: NodeJS.ProcessEnv = process.env, port: number | string = env.DATASET_PAGES_PORT || 5050): string {
  return reachableFromBoxes(given(env.DATASET_BASE_URL) ?? `http://localhost:${port}`, env).replace(/\/$/, "");
}

// ---- The commands ---------------------------------------------------------------------------------------------------------------------------------------

const failure = (what: string, run: FleetRun): Error => new Error(`${what} (fleet exit ${run.code}): ${run.stderr.trim() || run.stdout.trim() || "no output"}`);

function checkedLabel(label: string): void {
  if (!LABEL.test(label)) throw new FleetInputError(`the label is a ticket key: ${JSON.stringify(label)} is not one`);
}

/** Write the cases file the service reads, beside the pending files. Kept, not cleaned up: it is the record of what this job was asked to capture. */
export function writeCasesFile(dir: string, cases: readonly FleetCase[], groups: FleetGroups, stamp: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}.cases.json`);
  writeFileSync(file, `${JSON.stringify({ cases, groups })}\n`, "utf8");
  return file;
}

/** Submit a job of cases and return its ID. `--boxes` and `--label` are the caller's; nothing else the service takes is passed, so a body comes from the cases alone. */
export function submitCases(
  { cases, groups = {}, boxes, label, dir, run = realFleet(), stamp = new Date().toISOString().replace(/[:.]/g, "-") }:
  { cases: readonly FleetCase[]; groups?: FleetGroups; boxes: string; label: string; dir: string; run?: RunFleet; stamp?: string },
): string {
  checkedLabel(label);
  if (!cases.length) throw new FleetInputError("no cases to submit: a job of nothing is not a job");
  const file = writeCasesFile(dir, cases, groups, stamp);
  const reply = run(["capture", "submit", "--cases", file, "--boxes", boxes, "--label", label]);
  const id = reply.code === 0 ? jobIdFrom(reply.stdout) : null;
  if (id === null) throw failure("fleet capture submit did not return a job ID", reply);
  return id;
}

/** Re-capture the named cases of a finished job. The service pins each to the box its group was captured on, and returns a NEW job ID. */
export function recapture({ job, caseIds, label, run = realFleet() }: { job: string; caseIds: readonly string[]; label: string; run?: RunFleet }): string {
  checkedLabel(label);
  if (!caseIds.length) throw new FleetInputError("no cases to re-capture");
  const reply = run(["job", "recapture", job, "--cases", caseIds.join(","), "--label", label]);
  const id = reply.code === 0 ? jobIdFrom(reply.stdout) : null;
  if (id === null) throw failure(`fleet job recapture ${job} did not return a job ID`, reply);
  return id;
}

/**
 * Wait for a job ONCE, in the foreground, and return `fleet job wait`'s exit code: 0 done, 1 failed, 3 cancelled, 124 the timeout ran out (the job goes on), 2 usage or the service
 * could not be reached. Nothing in the lab waits any other way: no sleep, no poll, no `pgrep`.
 */
export function waitOnce({ job, duration, run = realFleet() }: { job: string; duration: string; run?: RunFleet }): number {
  if (!DURATION.test(duration)) throw new FleetInputError(`a wait is a whole number and a unit, such as 90s, 30m or 2h: ${JSON.stringify(duration)} is not one`);
  return run(["job", "wait", job, "--timeout", duration], { inherit: true }).code ?? WAIT_EXIT.USAGE;
}

export type FetchedJob = {
  job: string; dir: string; manifest: Manifest;
  /** The record of a capture, or null when the service wrote none (a skipped case). */
  record(capture: ManifestCapture): CaptureRecord | null;
};

/** Copy a job's results here and read its manifest. A failed capture is a record in the manifest, not a failed job, so the caller reads each capture's status. */
export function fetchManifest({ job, dir, run = realFleet() }: { job: string; dir: string; run?: RunFleet }): FetchedJob {
  const reply = run(["job", "fetch", job, "--to", dir]);
  if (reply.code !== 0) throw failure(`fleet job fetch ${job} copied no results`, reply);
  const where = resolve(dir, job);
  const text = readText(join(where, "manifest.json"));
  if (text === null) throw new Error(`fleet job fetch ${job} left no manifest.json in ${where}`);
  const manifest = JSON.parse(text) as Manifest;
  return {
    job, dir: where, manifest,
    record: (capture) => {
      const body = readText(join(where, capture.file));
      return body === null ? null : (JSON.parse(body) as CaptureRecord);
    },
  };
}

// ---- The pending file -----------------------------------------------------------------------------------------------------------------------------------

/**
 * What a client records when it submits, so a later `--collect` can read the results without the process that submitted them: `{ job, label, submittedAt, kind, names, ... }`.
 * `names` maps a case ID to the output it becomes. A client keeps anything else its collect step needs under `extra`.
 */
export type Pending = {
  job: string; label: string; submittedAt: string; kind: string; names: Record<string, string>;
  /** The job this one re-captures. */
  recaptureOf?: string;
  extra?: Record<string, unknown>;
  collectedAt?: string;
};

/** `<root>/.fleet-jobs/`: outside every `captures/*.json` glob, so a pending file is never read as a capture. */
export const pendingDir = (root: string): string => join(root, ".fleet-jobs");
export const pendingPath = (root: string, job: string): string => join(pendingDir(root), `${job}.json`);

export function writePending(root: string, pending: Pending): string {
  mkdirSync(pendingDir(root), { recursive: true });
  const path = pendingPath(root, pending.job);
  writeFileSync(path, `${JSON.stringify(pending)}\n`, "utf8");
  return path;
}

export function readPending(root: string, job: string): Pending | null {
  const text = readText(pendingPath(root, job));
  return text === null ? null : (JSON.parse(text) as Pending);
}

/** The newest job of this `kind` that has not been collected, or null: what `--collect` without an ID reads. */
export function newestPending(root: string, kind?: string): Pending | null {
  const dir = pendingDir(root);
  if (!existsSync(dir)) return null;
  const all = readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".cases.json"))
    .map((name) => readPending(root, name.slice(0, -".json".length)))
    .filter((pending): pending is Pending => pending !== null && pending.collectedAt === undefined && (kind === undefined || pending.kind === kind));
  return all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.job.localeCompare(a.job))[0] ?? null;
}

/** Mark a job collected, so the next `--collect` without an ID does not read it again. */
export function markCollected(root: string, pending: Pending, at: string = new Date().toISOString()): void {
  writePending(root, { ...pending, collectedAt: at });
}
