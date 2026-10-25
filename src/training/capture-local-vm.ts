/**
 * THE LOCAL UTM WORKER VM ROUTE of `training:capture` (A11-263, the plan's decision: "the local UTM VM pool and in-process capture paths stay").
 *
 * A local worker VM is a person's own machine on their own Mac, not a fleet box: it has nothing to book, so a run with no fleet inputs (no `--label`, `--boxes`, `--wait`,
 * `--collect`, and none of `A11Y_FLEET_*`) drives it directly, as `training:capture` always did on a Mac (docs/local-worker-vm.md). It is a MODULE OF ITS OWN, and that is the
 * point of it: the clients that moved onto the service contain no capture of their own (`no-wait-in-moved-clients.test.ts` holds them to that), and this is the one place the
 * corpus capture still POSTs to a worker, for a worker that is not in the fleet. The fleet route never reaches it, and it never reaches a fleet box.
 *
 * It keeps what mattered to a person on a Mac and drops what only a fleet needed: the lease and the putting-back of the VM(s) (`leaseWorker`, `leaseWorkerPool`), a pre-run check
 * that each is an NVDA worker running this checkout, the cache, the evidence check with its three attempts, and the same files and progress file. What it does not carry is
 * the pool's eviction, retirement and waiting for a worker to come back: those were for twelve boxes, and a VM that fails is a case that fails, named, for the person to re-run
 * with `--resume --no-cache`. The preflight that the VM runs this checkout is the fleet's own (`assertFleetRunsThisCheckout`, waived by `--allow-stale-workers`). A pool of local VMs shares one queue of cases; a case is the unit of work, so a pair never splits across VMs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { leaseWorker, leaseWorkerPool, guestReachableUrl, isAfterRun } from "@a11ign/screenreader-fleet";
import { requestJson } from "@a11ign/screenreader-fleet/worker-http";
import { captureTolerantly } from "@a11ign/screenreader-fleet/capture-client";
import { assertFleetRunsThisCheckout } from "@a11ign/screenreader-fleet/worker-code-check";
import { captureFilePath, rejectedCaptureFilePath } from "../capture/evidence-diff.ts";
import type { Loose } from "../capture/loose.ts";
import { cacheDecision, cacheKey, hashPageDir, stampProvenance } from "./capture-cache.mjs";
import { isEvidence, rejectionReason, runOutcome } from "./capture-decisions.mjs";
import type { RunRecorder } from "./capture-progress.mjs";

/** The per-capture ceiling of a local run: above the worker's own hard timeout, or the host gives up before the guest can say why (`budget-ladder.test.ts`). */
const CAPTURE_TIMEOUT_MS = Number(process.env.DATASET_CAPTURE_TIMEOUT_MS || 620_000);
/** Three attempts at a variant the evidence check rejects or the worker loses. */
export const LOCAL_CAPTURE_ATTEMPTS = 3;

export type LocalRun = {
  cases: { id: string }[];
  done: Set<string>;
  captureRoot: string;
  rejectedRoot: string;
  pageRoot: string;
  cache: boolean;
  allowStale: boolean;
  /** The body a case is captured with, and the one the cache keys on. */
  optionsOf: (testCase: Loose) => Record<string, unknown>;
  /** `<base>/<case>/<variant>.html`, and the title of a page as served. */
  urlOf: (baseUrl: string, testCase: Loose, variant: string) => string;
  titleOf: (url: string) => Promise<string>;
  /** The base URL the pages are served at, before it is made reachable from the guest. */
  baseUrl: string;
  progressFor: (run: { worker: string; baseUrl: string; workers: string[]; captureTimeoutMs: number }) => RunRecorder;
  log?: (line: string) => void;
  /** One capture on a worker, and a worker's environment: the real ones by default, handed in by a test. */
  capture?: (worker: string, url: string, body: Record<string, unknown>) => Promise<Loose>;
  environment?: (worker: string) => Promise<Record<string, string | undefined>>;
};

const afterRun = (): "restore" | "stop" | "pause" | "leave" => {
  const value = process.env.A11Y_VM_AFTER;
  if (!value) return "restore";
  if (isAfterRun(value)) return value as "restore";
  throw new Error(`A11Y_VM_AFTER must be restore|stop|pause|leave (got "${value}")`);
};

/** The local worker VM(s), leased and put back as found: two or more as a pool, otherwise the single-VM lease. Nothing else is looked for: no address is taken. */
export async function acquireLocalWorkers() {
  const pool = await leaseWorkerPool(afterRun());
  if (pool) return { workers: pool.workers as string[], hostAddress: pool.hostAddress as string | undefined, release: pool.release as () => Promise<void> };
  const lease = await leaseWorker({ worker: null, after: afterRun() });
  if (lease.source === "default") {
    throw new Error("No NVDA worker available. A run with no fleet inputs drives a local UTM worker VM on a Mac (scripts/local-worker/build-vm.sh), and none is registered. "
      + "To capture on the fleet pass --label=<ticket key> (and --boxes=, --wait=).");
  }
  return { workers: [lease.worker], hostAddress: lease.hostAddress, release: lease.release };
}

async function fetchHealth(worker: string): Promise<Loose> {
  const response = await requestJson(`${worker}/health`, { timeoutMs: 15_000 });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${worker}/health`);
  return response.json ?? {};
}

/** Each VM must be an NVDA worker that answers, before an hour is spent finding out. */
export async function checkLocalWorkers(workers: string[]): Promise<void> {
  for (const worker of workers) {
    let health: Loose;
    try {
      health = await fetchHealth(worker);
    } catch (error) {
      throw new Error(`The worker at ${worker} did not answer /health: check that VM is up and the a11ysrv task is running`, { cause: error });
    }
    if (health.screenReader !== "NVDA") throw new Error(`Worker is not an NVDA worker: ${JSON.stringify(health)}`);
  }
}

/** The worker's own account of what it is, which the cache key depends on. An unreachable worker keys on {} and so matches no cached capture, the safe direction. */
async function environmentOf(worker: string): Promise<Record<string, string | undefined>> {
  try {
    return (await fetchHealth(worker)).environment ?? {};
  } catch {
    return {};
  }
}

async function captureOnce(worker: string, url: string, body: Record<string, unknown>): Promise<Loose> {
  const response = await captureTolerantly({ worker, body: { url, ...body }, timeoutMs: CAPTURE_TIMEOUT_MS });
  if (response.ok) return response.json ?? { raw: response.text };
  const failed = new Error(`HTTP ${response.status} from ${worker}/capture: ${JSON.stringify(response.json ?? { raw: response.text })}`) as Error & { code?: string };
  if (response.json?.fault) failed.code = response.json.fault;
  throw failed;
}

/**
 * One variant, captured and checked: up to `LOCAL_CAPTURE_ATTEMPTS` while the evidence check rejects it or the worker lost it (`CAPTURE_LOST`: it restarted mid-capture and forgot
 * the capture it had accepted). Each rejected attempt is kept for diagnosis. Any other fault is the case's failure.
 */
export async function captureVerified(
  run: Pick<LocalRun, "rejectedRoot" | "log">,
  { capture, testCase, variant, url, title }: { capture: () => Promise<Loose>; testCase: { id: string }; variant: string; url: string; title: string },
): Promise<Loose> {
  let wrong: string | null = "";
  for (let attempt = 1; attempt <= LOCAL_CAPTURE_ATTEMPTS; attempt++) {
    let captured: Loose;
    try {
      captured = await capture();
    } catch (error) {
      if ((error as { code?: string })?.code !== "CAPTURE_LOST") throw error;
      run.log?.(`  attempt ${attempt}/${LOCAL_CAPTURE_ATTEMPTS}: the worker restarted mid-capture and forgot this one; re-issuing`);
      wrong = "the worker restarted mid-capture";
      continue;
    }
    if (isEvidence(captured, title)) return captured;
    wrong = rejectionReason(captured, { title, url });
    mkdirSync(run.rejectedRoot, { recursive: true });
    const kept = rejectedCaptureFilePath(run.rejectedRoot, testCase.id, variant, attempt);
    writeFileSync(kept, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
    run.log?.(`  attempt ${attempt}/${LOCAL_CAPTURE_ATTEMPTS}: ${wrong}`);
    run.log?.(`    diagnostics kept: ${kept}`);
  }
  throw new Error(`${wrong} after ${LOCAL_CAPTURE_ATTEMPTS} attempts. Not written as evidence; the rejected captures are in ${run.rejectedRoot} for diagnosis.`);
}

type Context = { worker: string; baseUrl: string; environment: Record<string, string | undefined>; progress: RunRecorder; poolSize: number };

function provenanceFor(run: LocalRun, context: Context, testCase: Loose) {
  const pageHash = hashPageDir(resolve(run.pageRoot, testCase.id));
  const options = run.optionsOf(testCase);
  return { key: cacheKey({ caseId: testCase.id, pageHash, options, environment: context.environment }), pageHash, options, environment: context.environment, worker: context.worker };
}

/** Both variants of a case on this worker, each checked, each written as it is accepted. */
async function captureCase(run: LocalRun, context: Context, testCase: Loose): Promise<Record<string, number>> {
  const provenance = provenanceFor(run, context, testCase);
  const phrases: Record<string, number> = {};
  for (const variant of ["good", "bad"]) {
    const url = run.urlOf(context.baseUrl, testCase, variant);
    const title = await run.titleOf(url);
    context.progress.startCase(testCase.id, variant, context.worker);
    run.log?.(`Capturing ${testCase.id} (${variant})${context.poolSize > 1 ? ` on ${context.worker}` : ""}`);
    const capture = await captureVerified(run, { capture: () => (run.capture ?? captureOnce)(context.worker, url, provenance.options), testCase, variant, url, title });
    mkdirSync(run.captureRoot, { recursive: true });
    const path = captureFilePath(run.captureRoot, testCase.id, variant);
    writeFileSync(path, `${JSON.stringify(stampProvenance(capture, provenance), null, 2)}\n`, "utf8");
    run.log?.(`  ${capture.transcript.length} transcript phrases -> ${path}`);
    phrases[variant] = capture.transcript.length;
  }
  return phrases;
}

/** Reuse the pair on disk when nothing that shapes it has changed, otherwise capture it. */
async function cachedOrCapture(run: LocalRun, context: Context, testCase: Loose): Promise<{ cached: boolean; reason?: string; phrases?: Record<string, number> }> {
  if (!run.cache) return { cached: false, phrases: await captureCase(run, context, testCase) };
  const decision = cacheDecision({ captureRoot: run.captureRoot, caseId: testCase.id, key: provenanceFor(run, context, testCase).key });
  if (!decision.reuse) {
    run.log?.(`  ${testCase.id}: capturing (${decision.reason})`);
    return { cached: false, phrases: await captureCase(run, context, testCase) };
  }
  return { cached: true, reason: decision.reason };
}

/** What the run did to one case, recorded in the progress file and the failure list. */
async function handleCase(run: LocalRun, context: Context, testCase: Loose, tally: { failures: string[]; cached: number; skipped: number }): Promise<void> {
  if (run.done.has(testCase.id)) {
    context.progress.skipped(testCase.id, "already captured (--resume)");
    tally.skipped += 1;
    return;
  }
  try {
    const result = await cachedOrCapture(run, context, testCase);
    if (result.cached) {
      context.progress.skipped(testCase.id, `cached: ${result.reason}`);
      tally.cached += 1;
      tally.skipped += 1;
    } else {
      context.progress.captured(testCase.id, result.phrases as Record<string, number>);
    }
  } catch (error) {
    const message = (error as Error).message;
    tally.failures.push(`${testCase.id}: ${message}`);
    context.progress.failed(testCase.id, message);
    run.log?.(`  CAPTURE_FAILED ${testCase.id}: ${message}`);
  }
}

/**
 * Capture the cases on the local VM(s), sharing one queue between them, and report the run as it has always been reported. Throws, naming the count, when a case failed.
 * The VM(s) are leased by the caller and put back by it.
 */
export async function captureOnLocalWorkers(run: LocalRun, lease: { workers: string[]; hostAddress?: string }): Promise<void> {
  const baseUrl = guestReachableUrl(run.baseUrl, { worker: lease.workers[0], hostAddress: lease.hostAddress, source: "local-vm", release: async () => undefined } as never);
  if (baseUrl !== run.baseUrl) run.log?.(`Dataset pages: rewrote ${run.baseUrl} -> ${baseUrl} (the guest cannot reach the host's localhost)`);
  await run.titleOf(run.urlOf(baseUrl, run.cases[0]!, "good"));
  await assertFleetRunsThisCheckout(lease.workers, { when: "before the run", allow: run.allowStale, bareMetalUrls: [] });
  const progress = run.progressFor({ worker: lease.workers[0]!, baseUrl, workers: lease.workers, captureTimeoutMs: CAPTURE_TIMEOUT_MS });
  const tally = { failures: [] as string[], cached: 0, skipped: 0 };
  const queue = [...run.cases];
  const contexts = await Promise.all(lease.workers.map(async (worker): Promise<Context> => (
    { worker, baseUrl, environment: await (run.environment ?? environmentOf)(worker), progress, poolSize: lease.workers.length })));
  await Promise.all(contexts.map(async (context) => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) await handleCase(run, context, testCase, tally);
  }));
  const outcome = runOutcome({ total: run.cases.length, failures: tally.failures.length, skipped: tally.skipped, cached: tally.cached, poolSize: lease.workers.length });
  progress.finish(outcome);
  run.log?.(`Capture complete: ${outcome}.`);
  if (tally.failures.length) {
    throw new Error(`${tally.failures.length} case(s) failed. The completed captures were kept; see npm run training:status, and re-run with --resume --no-cache to retry only what is missing.`);
  }
}
