/**
 * The repeated-capture side of a fleet job (A11-263, step 4): the cases it submits, and what it writes from the manifest when the job is done.
 *
 * A page captured N times is ONE group: the service holds a group to one box and captures it in order, which is the rule `gate:stability` has always kept by hand ("a page's repeats stay on
 * one box": splitting them would answer a different question, are the boxes interchangeable, while looking like an answer to this one). The old client captured them one after another on its
 * worker with a 2 s `BETWEEN_MS` sleep; the service sends a group's cases one after another, so the sleep is gone.
 *
 * Each repeat is a case `<group>.<n>` with the SAME body (`reuseScreenReader: false`, unless `--reuse`): the body is sent exactly, because a repeatability test that reuses one screen reader is
 * measuring a single NVDA session, not the pipeline.
 *
 * WHAT A TRANSIENT FAULT IS, here as it was in `captureWithRetry`: a worker still booting, a mute screen reader it recovered from, a wedged capture that timed out. It says nothing about the page, so
 * the repeat is captured again, on the SAME box (`fleet job recapture` pins each case to the box its group was captured on), up to `REPEAT_ATTEMPTS` in all. Differing CONTENT is never retried: that
 * is the signal being measured, and retrying it away would turn the gate into a rubber stamp.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Loose } from "../capture/loose.ts";
import { repeatedCases } from "../fleet/harness-flow.ts";
import type { Collector } from "../fleet/capture-flow.ts";
import { LEFT_THE_FLEET, whyNoCapture } from "../fleet/fleet-job.ts";
import type { FetchedJob, FleetCase, ManifestCapture } from "../fleet/fleet-job.ts";
import { isTransient } from "./capture-decisions.mjs";

/** Captures of one repeat before it is given up on: the first, and two more (what `captureWithRetry` made). */
export const REPEAT_ATTEMPTS = 3;

/** What a repeat run asks the worker, as the worker's own body (the service adds `url`). Absent probes are left out, as the old client left them out. */
export type RepeatBody = {
  steps?: number; probeTables?: boolean; reuse?: boolean; browser?: string | null;
  probeForms?: boolean; probeFocus?: boolean; probeNavigation?: boolean; task?: string | null;
};

export function repeatBody({ steps = 10, probeTables = false, reuse = false, browser = null, probeForms = false, probeFocus = false, probeNavigation = false, task = null }: RepeatBody = {}): Record<string, unknown> {
  return {
    steps, probeTables, reuseScreenReader: reuse,
    ...(browser ? { browser } : {}),
    // The task is what selects which button the probe activates -- a control whose announced name shares a meaningful word with it -- so a probe-forms run without one activates nothing and
    // reports a stable empty field, which looks exactly like a pass.
    ...(probeForms ? { probeForms: true } : {}),
    ...(probeFocus ? { probeFocus: true } : {}),
    // `--probe-navigation`, because a canary that cannot express the fault is worthless and 2.4.2's evidence -- and any live region a LINK fires -- exists only when this probe runs.
    ...(probeNavigation ? { probeNavigation: true } : {}),
    ...(task ? { task } : {}),
  };
}

/** One page to repeat: its group name, where its captures are kept, and what it asks. */
export type RepeatTarget = { group: string; url: string; outDir: string; times: number; body: Record<string, unknown> };

/** The service cases of a set of repeat targets: a group each. */
export function repeatJob(targets: readonly RepeatTarget[]): { cases: FleetCase[]; groups: Record<string, Record<string, never>>; extra: { targets: RepeatTarget[] } } {
  const ids = new Set<string>();
  for (const { group } of targets) {
    if (ids.has(group)) throw new Error(`two repeat groups are named ${group}: a group is the page's name and a job holds one of each`);
    ids.add(group);
  }
  return {
    cases: targets.flatMap((t) => repeatedCases({ group: t.group, url: t.url, body: t.body, times: t.times })),
    groups: Object.fromEntries(targets.map((t) => [t.group, {}])),
    extra: { targets: [...targets] },
  };
}

const captureFile = (outDir: string, n: number) => resolve(outDir, `capture-${n}.json`);
const failedFile = (outDir: string, n: number) => resolve(outDir, `capture-${n}.failed.json`);
const groupFile = (outDir: string) => resolve(outDir, "group.json");

/** What a repeat set holds on disk after the jobs that took it: the raw captures in order, a line for each that did not come back, and the box that took them. */
export type RepeatSet = { target: RepeatTarget; raw: Loose[]; errors: string[]; box: string | null };

const readJson = (path: string): Loose | null => {
  try { return JSON.parse(readFileSync(path, "utf8")) as Loose; } catch { return null; }
};

/** The set a target holds on disk now, whichever jobs wrote it. A repeat with a capture file is a capture; one with only a failure is an error line. */
export function readRepeatSet(target: RepeatTarget): RepeatSet {
  const raw: Loose[] = [];
  const errors: string[] = [];
  for (let n = 1; n <= target.times; n += 1) {
    const capture = readJson(captureFile(target.outDir, n));
    if (capture) { raw.push(capture); continue; }
    const failed = readJson(failedFile(target.outDir, n));
    errors.push(`${n}: ${failed?.error ?? "no capture came back"}`);
  }
  return { target, raw, errors, box: (readJson(groupFile(target.outDir))?.box as string | undefined) ?? null };
}

/**
 * Forget what an earlier run left in a target's directory, before this run's job is submitted. The default directory is shared by every run of `training:repeat`, and a set is READ BACK from disk
 * after the jobs that took it: a stale `capture-3.json` under a repeat that failed this time would be counted as a capture of this run.
 */
export function clearRepeatSet(target: RepeatTarget): void {
  mkdirSync(target.outDir, { recursive: true });
  for (let n = 1; n <= target.times; n += 1) {
    rmSync(captureFile(target.outDir, n), { force: true });
    rmSync(failedFile(target.outDir, n), { force: true });
  }
  rmSync(groupFile(target.outDir), { force: true });
}

/** The repeat number a case ID names, given its group: `<group>.<n>`. */
const repeatNumber = (caseId: string, group: string): number => Number(caseId.slice(group.length + 1));

/** Whether a failed repeat is a fault of the infrastructure that is worth capturing again, and why not when it is not. */
function retryable(entry: ManifestCapture, error: string, fault: string | undefined): boolean {
  if (LEFT_THE_FLEET.test(error)) return false;
  if (entry.attempt >= REPEAT_ATTEMPTS) return false;
  // Carry the worker's fault CODE, not just its prose. `isTransient` matches on codes; matching on message text is the check that silently stops working when somebody rewords a throw site.
  return isTransient(Object.assign(new Error(error), { code: fault }));
}

/** What one capture of a repeat set came to, once it is written: whether the service should be asked for it again. */
function settleRepeat(
  { entry, target, fetched, log }: { entry: ManifestCapture; target: RepeatTarget; fetched: FetchedJob; log: (line: string) => void },
): string | null {
  mkdirSync(target.outDir, { recursive: true });
  const n = repeatNumber(entry.case as string, target.group);
  const record = fetched.record(entry);
  const capture = record?.capture as Loose | undefined;
  const bodyError = typeof capture?.error === "string" && capture.error ? capture.error : null;
  const where = JSON.stringify({ group: target.group, box: entry.box, job: fetched.job });
  if (entry.status === "done" && capture && !bodyError) {
    writeFileSync(captureFile(target.outDir, n), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    rmSync(failedFile(target.outDir, n), { force: true });
    writeFileSync(groupFile(target.outDir), `${where}\n`, "utf8");
    return null;
  }
  const error = bodyError ?? whyNoCapture(entry, record);
  writeFileSync(failedFile(target.outDir, n), `${JSON.stringify({ error, attempt: entry.attempt, job: fetched.job })}\n`, "utf8");
  if (!entry.box) return null;
  writeFileSync(groupFile(target.outDir), `${where}\n`, "utf8");
  if (!retryable(entry, error, capture?.fault as string | undefined)) return null;
  log(`    transient (${String(capture?.fault ?? error).slice(0, 40)}), capturing ${entry.case} again on ${entry.box} (attempt ${entry.attempt + 1}/${REPEAT_ATTEMPTS})`);
  return entry.case;
}

/**
 * The collector for repeat jobs. It writes every capture that came back as `capture-<n>.json` in its group's directory (and the box as `group.json`), asks for a transient failure to be
 * captured again, and once nothing more is asked reads each set back from disk and hands them to `finish`, which says what they mean and how the run exits.
 *
 * The state lives on disk, not in this closure, so a `--collect` in another process, and a re-capture job's collect, see the repeats the first job took.
 */
export function repeatCollector(
  finish: (sets: RepeatSet[], context: { jobs: string[] }) => number | Promise<number>,
  { log = () => {} }: { log?: (line: string) => void } = {},
): Collector {
  return async (fetched, pending) => {
    const targets = (pending.extra as { targets: RepeatTarget[] }).targets;
    const byGroup = new Map(targets.map((t) => [t.group, t]));
    const again: string[] = [];
    for (const entry of fetched.manifest.captures) {
      const target = entry.group ? byGroup.get(entry.group) : undefined;
      if (!target || !entry.case || entry.status === "skipped") continue;
      const retry = settleRepeat({ entry, target, fetched, log });
      if (retry) again.push(retry);
    }
    if (again.length) return { recapture: again, exit: 0 };
    return { recapture: [], exit: await finish(targets.map(readRepeatSet), { jobs: [fetched.job] }) };
  };
}
