/**
 * The synthetic corpus capture's side of a fleet job (A11-263): the cases it submits, and what it writes from the manifest when the job is done.
 *
 * A dataset case is a good page and a bad page, and they are only comparable if both came from the same screen reader on the same machine. So a case becomes
 * TWO service cases, `<id>.good` and `<id>.bad`, in ONE group: the service holds a group to one box and captures it in order, which is the rule the old pool
 * kept by making the case its unit of work. Each service case carries `captureOptions(testCase)` as its body, sent exactly: that object is the cache key.
 *
 * Nothing here reaches a box. The evidence check that used to loop over `captureTolerantly` is a re-capture request now: a variant `isEvidence` rejects, or
 * whose capture the worker lost, is captured again by `fleet job recapture`, on the box its group was captured on, until it has had `CAPTURE_ATTEMPTS`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readCapture, captureFilePath, rejectedCaptureFilePath } from "../capture/evidence-diff.ts";
import type { Loose } from "../capture/loose.ts";
import type { CollectOutcome, Collector } from "../fleet/capture-flow.ts";
import type { FetchedJob, FleetCase, FleetGroups, Manifest, ManifestCapture, Pending } from "../fleet/fleet-job.ts";
import { isEvidence, rejectionReason } from "./capture-decisions.mjs";
import { cacheKey, stampProvenance } from "./capture-cache.mjs";
import type { RunRecorder } from "./capture-progress.mjs";

/** How many times a variant is captured before its case fails: the first, and two re-captures. */
export const CAPTURE_ATTEMPTS = 3;

/** A worker that restarted mid-capture forgets a capture it had accepted; the shared client throws this, and the service records it as the capture's error. */
export const LOST_CAPTURE = /worker forgot capture/;
/** A box that left the fleet mid-job: the service fails each capture it had not sent, saying so. */
export const LEFT_THE_FLEET = /left the fleet/;

export const VARIANTS = ["good", "bad"] as const;

/** The service's case ID for one variant of a dataset case. IDs are unique in a job and `<case>.<variant>` is as unique as the case. */
export const serviceCaseId = (id: string, variant: string): string => `${id}.${variant}`;

/** The variant a service case ID names, given its group (the group IS the dataset case's ID). */
const variantOf = (serviceCase: string, group: string): string => serviceCase.slice(group.length + 1);

type SkipWhen = { environment: Record<string, unknown> };

/**
 * The service cases of a set of dataset cases: one group of good and bad per case, each variant with its own URL and `captureOptions` body.
 */
export function datasetJob(
  { cases, baseUrl, optionsOf, skipWhenOf = () => null, captureRoot }:
  { cases: { id: string }[]; baseUrl: string; optionsOf: (testCase: Loose) => Record<string, unknown>; skipWhenOf?: (testCase: Loose) => SkipWhen | null; captureRoot: string },
) {
  const submitted: FleetCase[] = [];
  const groups: FleetGroups = {};
  const names: Record<string, string> = {};
  for (const testCase of cases) {
    const options = optionsOf(testCase);
    for (const variant of VARIANTS) {
      const id = serviceCaseId(testCase.id, variant);
      submitted.push({ id, url: `${baseUrl}/${testCase.id}/${variant}.html`, body: options, group: testCase.id });
      names[id] = captureFilePath(captureRoot, testCase.id, variant);
    }
    const skipWhen = skipWhenOf(testCase);
    groups[testCase.id] = skipWhen ? { skipWhen } : {};
  }
  return { cases: submitted, groups, names };
}

/**
 * What a dataset job's collect step needs that the manifest does not hold, recorded at submit: the title each page must be read as, and the bytes of each page directory
 * the key is computed over. Both are the page as it was SUBMITTED, not as it is when the job is collected.
 */
export type DatasetExtra = { titles: Record<string, string | null>; pageHashes: Record<string, string>; resubmitted?: Record<string, boolean> };

export type DatasetIo = {
  captureRoot: string;
  rejectedRoot: string;
  progress: RunRecorder;
  /** The preflight over the boxes the job captured on, given what each one's manifest reading says its worker runs. It ends the run, naming them, when one is stale. */
  assertFleetRunsThisCheckout: (boxes: string[], options: { when: string; read: (box: string) => Promise<string | null> }) => Promise<unknown>;
  recordRun?: (manifest: Manifest) => Promise<unknown> | unknown;
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

const boxNamed = (manifest: Manifest, name: string) => manifest.boxes.find((box) => box.name === name);

/**
 * The environment a pair is stamped with: the box's whole `/health` environment from the manifest, with its worker code put where `stampProvenance` reads it. A box whose
 * health was not read stamps `{}`, which keys to a pair that matches nothing else, the safe direction.
 */
function environmentOf(manifest: Manifest, box: string): Record<string, string | undefined> {
  const found = boxNamed(manifest, box);
  const workerCode = (found?.environment?.workerCode ?? found?.workerCode ?? undefined) as string | undefined;
  return { ...((found?.environment ?? {}) as Record<string, string | undefined>), workerCode };
}

/**
 * Write one accepted variant, stamped with the provenance the cache and the export read: the key, the page hash, the options, and the box that took it BY NAME (the
 * service never gives an address).
 */
function writeAccepted(
  io: DatasetIo, manifest: Manifest, extra: DatasetExtra,
  { group, variant, capture, box, options }: { group: string; variant: string; capture: Loose; box: string; options: Record<string, unknown> },
): string {
  const environment = environmentOf(manifest, box);
  const pageHash = extra.pageHashes[group] ?? null;
  const key = cacheKey({ caseId: group, pageHash: pageHash ?? "", options, environment });
  mkdirSync(io.captureRoot, { recursive: true });
  const stamped = stampProvenance(capture, { key, pageHash, options, environment, worker: box });
  const path = captureFilePath(io.captureRoot, group, variant);
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  io.log?.(`  ${capture.transcript.length} transcript phrases -> ${path}`);
  return path;
}

type Verdict = { variant: string; accepted: boolean; recapture: boolean; boxLost: boolean; failure: string | null };

/** Another attempt while the variant has had fewer than `CAPTURE_ATTEMPTS`; otherwise the case fails with the message it has always failed with. */
function retryOrFail(io: DatasetIo, verdict: Verdict, { entry, wrong }: { entry: ManifestCapture; wrong: string }): Verdict {
  if (entry.attempt < CAPTURE_ATTEMPTS) return { ...verdict, recapture: true };
  return {
    ...verdict,
    failure: `${wrong} after ${CAPTURE_ATTEMPTS} attempts. Not written as evidence; the rejected captures are in ${io.rejectedRoot} for diagnosis.`,
  };
}

/** A capture that did not end `done`: lost to a restart (captured again), taken with its box (the whole group again), or failed (the case fails with the service's words). */
function judgeFailed(io: DatasetIo, verdict: Verdict, { entry, error }: { entry: ManifestCapture; error: string }): Verdict {
  if (LOST_CAPTURE.test(error)) {
    io.log?.(`  attempt ${entry.attempt}/${CAPTURE_ATTEMPTS}: the worker restarted mid-capture and forgot this one; re-issuing`);
    return retryOrFail(io, verdict, { entry, wrong: "the worker restarted mid-capture" });
  }
  if (LEFT_THE_FLEET.test(error)) return { ...verdict, boxLost: true, failure: error };
  return { ...verdict, failure: error };
}

/** A capture the pipeline would throw away: kept for diagnosis, then captured again or failed. */
function judgeRejected(io: DatasetIo, verdict: Verdict, { entry, group, capture, title }: { entry: ManifestCapture; group: string; capture: Loose; title: string | null }): Verdict {
  const wrong = title === null ? "the page title was not recorded when the job was submitted, so the capture cannot be checked against it"
    : rejectionReason(capture, { title, url: entry.page });
  mkdirSync(io.rejectedRoot, { recursive: true });
  const kept = rejectedCaptureFilePath(io.rejectedRoot, group, verdict.variant, entry.attempt);
  writeFileSync(kept, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  io.log?.(`  attempt ${entry.attempt}/${CAPTURE_ATTEMPTS}: ${wrong}`);
  io.log?.(`    diagnostics kept: ${kept}`);
  return retryOrFail(io, verdict, { entry, wrong: String(wrong) });
}

/** The verdict on one variant of one group, and what it asks for next. */
function judgeVariant(io: DatasetIo, fetched: FetchedJob, extra: DatasetExtra, { group, entry }: { group: string; entry: ManifestCapture }): Verdict {
  const variant = variantOf(entry.case ?? "", group);
  const verdict: Verdict = { variant, accepted: false, recapture: false, boxLost: false, failure: null };
  const record = fetched.record(entry);
  if (entry.status !== "done" || !record) return judgeFailed(io, verdict, { entry, error: String(entry.error ?? record?.capture?.error ?? "no record was written") });
  const title = extra.titles[entry.case as string] ?? null;
  if (title !== null && isEvidence(record.capture, title)) {
    const options = fetched.manifest.cases?.find((c) => c.id === entry.case)?.body ?? {};
    writeAccepted(io, fetched.manifest, extra, { group, variant, capture: record.capture, box: entry.box, options });
    return { ...verdict, accepted: true };
  }
  return judgeRejected(io, verdict, { entry, group, capture: record.capture, title });
}

/** The latest phrases count of each variant on disk, for a case whose pair is now whole. */
function phrasesOnDisk(captureRoot: string, group: string): Record<string, number> {
  return Object.fromEntries(VARIANTS.map((variant) => [variant, readCapture(captureRoot, group, variant)?.transcript?.length ?? 0]));
}

type GroupResult = { recapture: string[]; boxLost: boolean; failure: string | null };

/**
 * One group: accept what is evidence, and say what is left. Each variant is judged on its own; a pair is whole when both are on disk.
 */
function collectGroup(io: DatasetIo, fetched: FetchedJob, extra: DatasetExtra, { group, entries }: { group: string; entries: ManifestCapture[] }): GroupResult {
  if (entries.every((entry) => entry.status === "skipped")) {
    io.progress.skipped(group, "cached: unchanged");
    io.log?.(`Reusing ${group} (cached: unchanged)`);
    return { recapture: [], boxLost: false, failure: null };
  }
  io.log?.(`Collecting ${group}${entries[0]?.box ? ` (captured on ${entries[0].box})` : ""}`);
  const verdicts = entries.map((entry) => ({ entry, ...judgeVariant(io, fetched, extra, { group, entry }) }));
  const recapture = verdicts.filter((v) => v.recapture).map((v) => v.entry.case as string);
  const boxLost = verdicts.some((v) => v.boxLost);
  // A group whose box left is not failed here: it is submitted again whole (once), and the first loss is not the case's verdict.
  const failure = boxLost ? null : (verdicts.map((v) => v.failure).find((f) => f !== null) ?? null);
  if (recapture.length) io.progress.recapturing(group, `re-capturing ${recapture.join(", ")}`);
  else if (failure) {
    io.progress.failed(group, failure);
    io.logError?.(`  CAPTURE_FAILED ${group}: ${failure}`);
  } else if (!boxLost && verdicts.every((v) => v.accepted)) {
    io.progress.captured(group, phrasesOnDisk(io.captureRoot, group));
  }
  return { recapture, boxLost, failure };
}

/** The whole groups to submit again, from the cases the manifest holds for them. */
function resubmission(manifest: Manifest, again: string[], pending: Pending, extra: DatasetExtra): NonNullable<CollectOutcome["resubmit"]> {
  const wanted = new Set(again);
  const cases = (manifest.cases ?? []).filter((c) => wanted.has(c.group)).map((c) => ({ id: c.id, url: c.url, body: c.body, group: c.group }));
  const names = Object.fromEntries(cases.map((c) => [c.id, pending.names[c.id] ?? ""]));
  const resubmitted = { ...(extra.resubmitted ?? {}), ...Object.fromEntries(again.map((group) => [group, true])) };
  return { cases, groups: Object.fromEntries(again.map((group) => [group, {}])), names, extra: { ...extra, resubmitted } };
}

/**
 * End the run's progress file once no case is left in flight, with the outcome line the run has always ended with.
 */
function settle(io: DatasetIo): void {
  const progress = io.progress.snapshot();
  const open = Object.values(progress.cases).filter((c) => c.status === "pending" || c.status === "capturing").length;
  if (open) return;
  const counts = { captured: 0, failed: 0, skipped: 0, cached: 0 };
  for (const entry of Object.values(progress.cases)) {
    if (entry.status === "captured" || entry.status === "failed" || entry.status === "skipped") counts[entry.status] += 1;
    if (entry.status === "skipped" && /^cached:/.test(entry.reason ?? "")) counts.cached += 1;
  }
  const boxes = progress.workers.length;
  const scope = boxes > 1 ? `of ${progress.total} cases across ${boxes} workers` : `of ${progress.total} cases`;
  const outcome = [`${counts.captured} captured`, `${counts.failed} failed`, `${counts.skipped} skipped${counts.cached ? ` (${counts.cached} cached)` : ""}`, scope].join(", ");
  io.progress.finish(outcome);
  io.log?.(`Capture complete: ${outcome}.`);
}

function collectGroups(io: DatasetIo, fetched: FetchedJob, pending: Pending, extra: DatasetExtra): CollectOutcome {
  const { manifest } = fetched;
  const groups = [...new Set(manifest.captures.map((c) => c.group).filter((g): g is string => g !== null))];
  const recapture: string[] = [];
  const lost: string[] = [];
  const failures: string[] = [];
  const attempts: Record<string, number> = {};
  for (const group of groups) {
    const entries = manifest.captures.filter((c) => c.group === group);
    for (const entry of entries) attempts[entry.case as string] = entry.attempt;
    const result = collectGroup(io, fetched, extra, { group, entries });
    recapture.push(...result.recapture);
    if (result.boxLost) lost.push(group);
    if (result.failure) failures.push(`${group}: ${result.failure}`);
  }
  // A group whose box left the fleet is submitted again once. A second loss fails the case.
  for (const group of lost.filter((g) => extra.resubmitted?.[g])) {
    failures.push(`${group}: its box left the fleet a second time; the case is not submitted again`);
    io.progress.failed(group, "its box left the fleet a second time");
  }
  const again = lost.filter((g) => !extra.resubmitted?.[g]);
  for (const group of again) io.progress.recapturing(group, "the box left the fleet; the case is submitted again, whole");
  settle(io);
  return { recapture, attempts, exit: failures.length ? 1 : 0, ...(again.length ? { resubmit: resubmission(manifest, again, pending, extra) } : {}) };
}

/**
 * Collect a dataset job: write each accepted variant, keep each rejected one for diagnosis, and say which cases are to be captured again.
 *
 * A group whose every case the service skipped is `cached: unchanged`. A variant rejected, or lost to a restart, is re-captured while it has had fewer than
 * `CAPTURE_ATTEMPTS`, on the box its group was captured on. A group whose box left the fleet is submitted again WHOLE in a new job, once; a second loss fails the case.
 *
 * Records from a box that does not run this checkout are not written: the preflight runs first, over the boxes the job captured on, and ends the run naming them.
 */
export function datasetCollector(io: DatasetIo): Collector {
  return async (fetched, pending) => {
    const { manifest } = fetched;
    const extra = pending.extra as DatasetExtra;
    const boxes = [...new Set(manifest.captures.filter((c) => c.status === "done").map((c) => c.box))];
    if (boxes.length) {
      await io.assertFleetRunsThisCheckout(boxes, { when: "at collect", read: async (box) => boxNamed(manifest, box)?.workerCode ?? null });
    }
    if (!pending.recaptureOf) await io.recordRun?.(manifest);
    io.progress.setWorkers(manifest.boxes.map((box) => box.name));
    return collectGroups(io, fetched, pending, extra);
  };
}
