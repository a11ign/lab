// @ts-check
// Run under tsx, not plain node (see package.json), so this host-side script can import the
// TypeScript fleet client. The rest of src/training is .mjs under node; this one file
// needs the shared flow logic, and duplicating it in .mjs would let the two copies
// drift.
//
// IT SUBMITS A FLEET JOB AND RUNS NO CAPTURE (A11-263). Each case becomes a good and a bad service case in one group, which the control plane holds to one box;
// the client records the job ID, waits once if it was told to (`A11Y_FLEET_WAIT`, `--wait=`), and writes the corpus from the job's manifest. Without a wait it
// prints the ID and the collect command and exits 75. `--collect[=<job ID>]` collects a job that has finished.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertFleetRunsThisCheckout } from "@a11ign/screenreader-fleet/worker-code-check";
import { titleOf } from "@a11ign/evidence/verify";
import { beginRun, continueRun, readProgress } from "./capture-progress.mjs";
import { hashPageDir, skipWhenFor } from "./capture-cache.mjs";
import { previouslyCaptured } from "./capture-resume.mjs";
import { leasePageServer } from "./page-server.mjs";
import { hostPowerState, powerVerdict, keepHostAwake } from "./power-guard.ts";
import { refuseUnknownFlags, flagValue } from "@a11ign/screenreader-fleet/cli-flags";
import { nonAuthoritativeHostNotice } from "./capture-host.mjs";
import { datasetRoot, captureRoot, refuseIfRunsReadonly, runsRoot } from "../dataset-paths.ts";
import { appendRunRecord, captureRunsFile, runRecordFromManifest } from "./capture-run-record.mjs";
// #958: the three-direction manifest check every verdict reader shares.
import { assertManifestMatchesCases } from "./manifest-matches-cases.mjs";
import { datasetCollector, datasetJob } from "./dataset-fleet.ts";
import { FleetInputError, fleetInputs, pagesBaseUrl, workerAddressNotice } from "../fleet/fleet-job.ts";
import { collectFlow, follow, noWaitPageServerNotice, submitJob } from "../fleet/capture-flow.ts";

/**
 * a typo here costs a full corpus run: `--resmue` silently means a fresh capture of 1,061 pairs.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 *
 * `--worker=` is still NAMED: it is refused (or ignored, when the catalogue also passes `A11Y_FLEET_BOXES`) with the new form, which a typo-guard's "unknown flag" would not say.
 */
refuseUnknownFlags(["--only=", "--resume", "--no-cache", "--allow-stale-workers", "--allow-battery", "--boxes=", "--label=", "--wait=", "--collect", "--worker="],
  { entry: import.meta.url, command: "npm run training:capture" });

const ROOT = datasetRoot();
const CAPTURE_ROOT = captureRoot(ROOT);
const PAGE_ROOT = resolve(ROOT, "pages");
const REJECTED_ROOT = resolve(CAPTURE_ROOT, "rejected");
const DEFAULT_BASE_URL = "http://localhost:5050";
const PAGES_PORT = Number(process.env.DATASET_PAGES_PORT || new URL(DEFAULT_BASE_URL).port);
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const STEPS = Number(process.env.DATASET_CAPTURE_STEPS || 150);
const ONLY = flagValue(process.argv, "only");
const RESUME = process.argv.includes("--resume");
/** Capture with a fleet that is not running this checkout. Says so in the output; never the default. */
const ALLOW_STALE = process.argv.includes("--allow-stale-workers");
/** `--collect` collects the newest uncollected dataset job; `--collect=<job ID>` a named one. Undefined when the flag is absent. */
const COLLECT = process.argv.find((arg) => arg === "--collect" || arg.startsWith("--collect="))?.slice("--collect".length + 1);
// Caching is refused for acceptance runs, whatever the flags say: those runs exist to test whether
// NVDA's output is still stable, and reusing evidence would make them pass by construction.
// `--no-cache` forces a recapture anywhere.
const KIND = process.env.DATASET_KIND || "training";
const CACHE = !process.argv.includes("--no-cache") && KIND !== "acceptance";
/** What this client's pending files are filed under, so `--collect` reads a dataset job and never a real-page or evidence-check one. */
const JOB_KIND = "dataset";
// Only used to size the power check below, so an estimate is enough — but it must be a MEASURED one,
// because a stale figure here would wave through a run that cannot finish before the host sleeps.
// 32.7 s is the mean over the two page-size buckets, timed on this host (see scale-buckets.test.ts,
// which owns the cost model). A pair is two captures, hence the x2 at the call site.
const MEAN_CAPTURE_S = 32.7;
// This is sent over the wire because NVDA lives in the Windows worker process. Setting
// A11Y_REUSE_NVDA on the host only changes a host process and cannot affect that worker.
// Keep reuse on for the normal pooled run; acceptance/repeat runs can set this to 0.
const REUSE_NVDA = process.env.DATASET_REUSE_NVDA !== "0";

/**
 * Choose which cases to run from `--only=`.
 *
 * Substring matching stays, because `--only=heading` to sweep a family is the common interactive use.
 * Two things it could not previously do, both of which are the *retry* workflow this project's own gates
 * ask for:
 *
 * - **An exact id must mean that one case.** `form-error-silent` is a real case id AND a prefix of ~90
 *   `form-error-silent-bulk-*` ids, so it could not be retried at all: asking for it ran ninety. Any id
 *   that is a prefix of another was untargetable, and that is precisely the set a gate names when it
 *   reports contamination.
 * - **A LIST.** `check-signals` prints the failing ids; the natural next step is to paste them back in.
 *   Without this, retrying eleven named cases meant eleven runs, each paying a page-server lease and a
 *   worker connect.
 *
 * Exact wins over substring per entry, so pasting a gate's output does what it says.
 */
export function selectCases(/** @type {any} */ cases, /** @type {any} */ only) {
  if (!only) return cases;
  const wanted = only.split(",").map((/** @type {any} */ s) => s.trim()).filter(Boolean);
  const ids = new Set(cases.map((/** @type {any} */ { id }) => id));
  // A TRAILING `+` MEANS "this case and everything built from it".
  //
  // The exact-id rule above is right and cannot be relaxed: `form-error-silent` is a real id and a prefix
  // of ~90 others, so asking for it must mean that one. But the FAMILY is what a corpus change usually
  // touches — a base case plus its `+also-` and `+with-` variants — and there was no way to say it.
  // Measured 2026-08-26: `--only=route-title-stale` to prove a furniture fix captured 1 case of 7, and
  // the four uncaptured ones stayed stale while the run reported success.
  //
  // `route-title-stale+` is unambiguous because `+` is the variant separator, so it cannot collide with
  // an id: no case is named `X+` and every variant of X begins `X+`.
  return cases.filter((/** @type {any} */ { id }) => wanted.some(
    (/** @type {any} */ want) => selectorMatches(want, id, ids)));
}

/** One selector against one id, so the filter and the unmatched check cannot drift apart. */
function selectorMatches(/** @type {any} */ want, /** @type {any} */ id, /** @type {Set<any>} */ ids) {
  if (want.endsWith("+")) return id === want.slice(0, -1) || id.startsWith(want);
  return ids.has(want) ? id === want : id.includes(want);
}

/**
 * WHICH SELECTORS MATCHED NOTHING — because "all of them matched nothing" was the only case guarded.
 *
 * `main` refuses on `!cases.length`, which fires only when EVERY entry is a miss — and even then it can
 * only print the whole string back, never which entry is wrong. Ask for `label-vague,status-waiting+`
 * where the second names nothing: the first matches ten cases, the run captures them, reports success,
 * and never mentions that half of what you asked for does not exist.
 *
 * That is this repo's `examinedNothing` shape for the third time — a guard covering the extreme case and
 * calling it the general one. `evidence:check` had it (`compared === 0` guarded, 2-of-48 not), and the
 * comment directly above `selectCases` records its own version: *"`--only=route-title-stale` to prove a
 * furniture fix captured 1 case of 7, and the four uncaptured ones stayed stale while the run reported
 * success."* The trailing `+` closed "asked for a family, got one". This closes "asked for something that
 * does not exist, got told nothing" — the adjacent door, found 2026-09-06 checking issue #34's acceptance
 * before paying for its capture. That selector, `label-vague+,status-waiting+,status-progress+`, matches
 * 0 of 1,657 cases: two families were never built, and the third misses because `+` means "this case and
 * its variants" while the ten real ones are `label-vague-field`, `label-vague-box` and so on.
 *
 * NEAR MISSES ARE OFFERED, not just the miss. A selector that matched nothing is nearly always a typo or a
 * renamed case, and a refusal that cannot suggest the right spelling gets worked around rather than read.
 */
export function unmatchedSelectors(/** @type {any} */ cases, /** @type {any} */ only) {
  if (!only) return [];
  const wanted = only.split(",").map((/** @type {any} */ s) => s.trim()).filter(Boolean);
  const ids = new Set(cases.map((/** @type {any} */ { id }) => id));
  const all = [...ids];
  return wanted
    .filter((/** @type {any} */ want) => !all.some((/** @type {any} */ id) => selectorMatches(want, id, ids)))
    .map((/** @type {any} */ want) => ({ want, near: nearestIds(want, all) }));
}

/** Up to three ids sharing the selector's leading word — enough to spot a typo, short enough to read. */
function nearestIds(/** @type {any} */ want, /** @type {any[]} */ all) {
  const stem = String(want).replace(/\+$/, "").split("-")[0];
  return stem ? all.filter((/** @type {any} */ id) => id.startsWith(stem)).slice(0, 3) : [];
}


function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("Missing " + MANIFEST_PATH + ". Run npm run training:generate first.");
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function captureUrl(/** @type {any} */ baseUrl, /** @type {any} */ testCase, /** @type {any} */ variant) {
  return baseUrl + "/" + testCase.id + "/" + variant + ".html";
}

// Every `probe*` field this function names explicitly below, kept as ONE list so the catch-all forward
// at the end of `captureOptions` knows what NOT to re-process, rather than a second hand count of the
// same ten names drifting from the first. Exported so a test can prove it against the real corpus rather
// than trust it by reading.
export const NAMED_PROBE_FLAGS = new Set([
  "probeForms", "probeTables", "probeFocus", "probeOrder", "probeDialog", "probeFocusReveal",
  "probeArrows", "probeTyping", "probeFocusContext", "probeNavigation",
]);

// Exactly what shapes the evidence, defined once. The cache keys on this and the worker receives
// it, so the two cannot drift -- a key that ignored an option we actually send would reuse evidence
// captured a different way. Exported for the same reason as `NAMED_PROBE_FLAGS`.
export function captureOptions(/** @type {any} */ testCase) {
  return {
    task: testCase.task,
    steps: STEPS,
    probeForms: testCase.probeForms,
    probeTables: testCase.probeTables,
    // Present ONLY when true, and that is a cache-key decision rather than a style one.
    //
    // This object IS the cache key (`cacheKey` hashes it), and `JSON.stringify` omits an `undefined`
    // property while serialising `false`. So an unconditional `probeFocus: testCase.probeFocus` changed the
    // key for all 1,061 cases that do not use the probe the moment the generator started writing the flag
    // explicitly — measured: key `e511cc88941f207a` became `b50b03e6e7be45b0`. That is a full recapture of
    // 2,122 captures, hours of fleet time, to record nothing new about any of them.
    //
    // Omitting it also keeps the key and the request honest with each other, which is what the comment
    // above this function asks for: we do not send the flag, so we do not key on it, and `capture-core`
    // reads `!!opts.probeFocus` where absent and false are the same thing.
    ...(testCase.probeFocus ? { probeFocus: true } : {}),
    // WHICH ORDER the two position-dependent probes run in, forwarded under the same omit-when-absent
    // rule and for the same cache-key reason: absent means the order that has always run, so adding this
    // re-keys only the cases that ask for it and leaves every other capture valid.
    //
    // It existed in `capture-core` and `server.mjs` and was unreachable from a case, because THIS hop
    // enumerates by name while the manifest hop forwards `probe*` by prefix. So the one mechanism that
    // lets a focus case carry form evidence without activating a control before the ring is walked could
    // not be asked for. `probe-chain.test.ts` could not see it either: it derived its flag list from what
    // cases ALREADY declare, so an option no case used was never checked -- and therefore no case could
    // start using it. That circularity is fixed there.
    ...(testCase.probeOrder ? { probeOrder: testCase.probeOrder } : {}),
    // Same omit-when-absent rule and the same cache-key reason: present only for the cases that ask.
    ...(testCase.probeDialog ? { probeDialog: true } : {}),
    ...(testCase.probeFocusReveal ? { probeFocusReveal: true } : {}),
    ...(testCase.probeArrows ? { probeArrows: true } : {}),
    ...(testCase.probeTyping ? { probeTyping: true } : {}),
    ...(testCase.probeFocusContext ? { probeFocusContext: true } : {}),
    // Same omit-when-false rule, same reason: present only for the cases that ask, so adding the
    // flag re-keys those and nothing else.
    ...(testCase.probeNavigation ? { probeNavigation: true } : {}),
    // EVERY OTHER `probe*` FLAG, BY PREFIX RATHER THAN BY NAME — architecture-audit.md §5's residual item.
    // `case-matrix.mjs`, `generate-screenreader-dataset.mjs` and `acceptance-matrix.mjs` all forward
    // `probe*` this way already, each citing the SAME defect this function was still the exception to:
    // "enumerating them is how this exact defect happened three times in one feature" (case-matrix.mjs).
    // `probeOrder` lived that defect here directly — built, and unreachable from a case for exactly the
    // reason stated above it, until it was added to the named list by hand. Adding the NEXT probe by hand
    // is the same fix arriving a commit late every time; this closes the class instead of the instance.
    //
    // PROVEN not to move a single existing cache key: every `probe*` identifier this package's case
    // definitions actually use is one of the ten named above (checked by grep across
    // `packages/lab/src/training` and `packages/lab/src/harnesses`), so this line forwards nothing today
    // — `probe-forward-by-prefix.test.ts` pins that emptiness so a future name added ABOVE without
    // being excluded here cannot double it into the body accidentally.
    ...Object.fromEntries(Object.entries(testCase).filter(([key, value]) => key.startsWith("probe")
      && !NAMED_PROBE_FLAGS.has(key) && value)),
    reuseScreenReader: REUSE_NVDA,
  };
}

// Fetch the page the way the guest will, and hand back its title so the capture can be
// checked against it. Doing this first turns a misconfigured base URL into one clear error
// instead of a whole dataset of captured 404 pages -- which is what happened before this
// existed: a stray server on port 5050 produced "Capture complete: 3/3 cases" while every
// transcript read "Error code: 404".
const SERVE_HINT =
  "The capture command normally leases the page server automatically; check that no other " +
  `process owns port ${PAGES_PORT} (a stray server can answer 404 for every page).`;

// EXEMPT from audit §9's "the HTTP client" row, deliberately, unlike the other three raw-`fetch` sites
// this row named (doctor.mjs, capture-status.mjs, capture-check.ts -- all converted to `requestJson`).
// This one talks to the DATASET PAGE SERVER, not a capture worker: it fetches an arbitrary page's raw
// HTML for `titleOf()` to read, where `requestJson` is documented as, and shaped for, "HTTP to a capture
// worker" returning pre-parsed JSON. Converting would misuse that abstraction for an unrelated service. It
// is also outside the failure mode `requestJson` exists to prevent -- a 15 s timeout, far under undici's
// 300 s headers cap -- so nothing is gained functionally either. Left as `fetch`, following the same
// "read each site before converting it" rule `fleet-env.mjs` used to stay outside the `control` move.
async function pageTitle(/** @type {any} */ url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    // A refused connection rejects rather than returning a response, so without this the
    // whole run dies with the bare message "fetch failed".
    throw new Error("Cannot reach the dataset pages at " + url + ". " + SERVE_HINT, { cause: error });
  }
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + url + ". " + SERVE_HINT);
  }
  return titleOf(await response.text());
}

/**
 * What a dataset job's collect step needs that the manifest does not hold, read from the page files at SUBMIT time: the title each page is read as (so a rejected
 * capture is judged against the page that was submitted, not against whatever the files hold when a later `--collect` runs), and the bytes of each page directory.
 * @param {{ id: string }[]} cases
 */
function submittedPages(cases) {
  /** @type {Record<string, string | null>} */ const titles = {};
  /** @type {Record<string, string>} */ const pageHashes = {};
  for (const { id } of cases) {
    pageHashes[id] = hashPageDir(resolve(PAGE_ROOT, id));
    for (const variant of ["good", "bad"]) titles[`${id}.${variant}`] = titleOf(readFileSync(resolve(PAGE_ROOT, id, `${variant}.html`), "utf8"));
  }
  return { titles, pageHashes };
}

/** The flow this client follows: where its pending files live, how it collects, and the command that does. @param {import("../fleet/fleet-job.ts").FleetInputs} inputs @param {import("./capture-progress.mjs").RunRecorder} progress */
function flowFor(inputs, progress) {
  const startedAt = progress.snapshot().startedAt;
  return {
    root: ROOT,
    inputs,
    hint: (/** @type {string} */ job) => `npm run training:capture -- --collect=${job}`,
    collect: datasetCollector({
      captureRoot: CAPTURE_ROOT,
      rejectedRoot: REJECTED_ROOT,
      progress,
      // Over the boxes the manifest names, read from the manifest rather than asked: the service already read each box's `/health` when the job began.
      assertFleetRunsThisCheckout: (boxes, { when, read }) => assertFleetRunsThisCheckout(boxes, { when, allow: ALLOW_STALE, read, bareMetalUrls: [] }),
      recordRun: (manifest) => recordRun({ startedAt, manifest }),
      log: (line) => console.log(line),
      logError: (line) => console.error(line),
    }),
  };
}

/**
 * This run's line in `runs/capture-runs.jsonl` (#4462), the same record `capture-real-pages.mjs` writes (#4459): the boxes the job used, each dropped one as excluded, and the job ID.
 * NOT behind `capture-fleet-guard.mjs`, so no ready count was read and the record says `null`. A record that cannot be written is SAID and never changes the run's exit.
 * @param {{ startedAt: string, manifest: import("../fleet/fleet-job.ts").Manifest }} run
 */
function recordRun({ startedAt, manifest }) {
  const file = captureRunsFile(runsRoot());
  try {
    appendRunRecord(runRecordFromManifest({ startedAt, manifest }), file);
  } catch (error) {
    process.stderr.write(`CAPTURE RUN RECORD NOT WRITTEN to ${file}: ${/** @type {Error} */ (error).message}\n`);
  }
}

/**
 * Choose the cases, refuse what cannot be run, and say what `--no-cache` cannot reach. Split from `submit` so each reads as one step.
 * @returns {{ cases: any[], done: Set<string> }}
 */
function chooseCases() {
  const manifest = readManifest();
  // A CAPTURE TAKEN UNDER A STALE MANIFEST IS TAKEN UNDER THE OLD DEFINITIONS (#958). The export's own header
  // records the cost: `probeFocus: true` was added to a case and the capture ran without the probe, because
  // this reads the manifest, not `CASES`. Asked of the WHOLE manifest, before `--only` narrows it.
  assertManifestMatchesCases(manifest, {
    consequence: "the capture would take evidence under definitions the code no longer has",
  });
  const cases = selectCases(manifest.cases, ONLY);
  // EVERY selector must match something, not merely one of them. See `unmatchedSelectors`.
  const missed = unmatchedSelectors(manifest.cases, ONLY);
  if (missed.length) {
    throw new Error(`--only= names ${missed.length} selector(s) that match no generated case:\n`
      + missed.map((/** @type {any} */ { want, near }) => `  ${want}`
        + (near.length ? `   did you mean: ${near.join(", ")}` : "   nothing on this page begins like it"))
        .join("\n")
      + `\nOf ${manifest.cases.length} generated case(s), ${cases.length} matched the rest. Refusing rather `
      + "than capturing a subset and reporting success.");
  }
  if (!cases.length) throw new Error("No generated case matches --only=" + ONLY);

  // A run interrupted an hour in should not start over. Must be read BEFORE beginRun, which replaces the
  // progress file with a fresh all-pending one. Cache-enabled training runs do not use filenames as a
  // completion signal: a file can be complete yet stale after a protocol, page, option, or worker-runtime
  // change, so the service gets to decide (`skipWhen`). Acceptance runs deliberately disable caching, so they
  // may use the previous progress record to skip cases completed in the same acceptance run.
  const done = previouslyCaptured({
    cases,
    previous: readProgress(ROOT),
    captureRoot: CAPTURE_ROOT,
    pageRoot: PAGE_ROOT,
    resume: RESUME,
    cache: CACHE,
  });
  // SAY WHAT --no-cache CANNOT REACH. `previouslyCaptured` returns a non-empty set only under
  // `--resume --no-cache`, and it skips on the capture FILES rather than on this run's progress -- so a
  // case that already succeeded is skipped and `--no-cache` never gets to force it. That is exactly right
  // for the pairing's documented purpose ("retry only what is missing": a FAILED case has no usable files,
  // so it is not skipped and is recaptured fresh), and it is silently wrong for the other reason somebody
  // reaches for `--no-cache` -- re-measuring a case that succeeded, to see whether an odd result
  // reproduces. Measured cost 2026-09-03: an investigation into one split pair read an identical result
  // from a "recapture" and called it REPRODUCIBLE, when the run had skipped the case and the second
  // reading was the same bytes. Two readings of one file are not two measurements.
  //
  // So the line names the consequence rather than the count. `--no-cache` alone re-measures everything.
  if (done.size) {
    console.log("Resuming: " + done.size + " case(s) already captured.");
    console.log("  --no-cache CANNOT reach those " + done.size + " — they are skipped on the files already "
      + "on disk, so a re-read of them is not a second measurement. Drop --resume to re-measure.");
  }
  return { cases, done };
}

/**
 * Power BEFORE anything expensive is leased. A run that dies because the host slept reports every in-flight capture as lost, which reads as a broken guest and was
 * misdiagnosed here as exactly that. Estimated from what is left to do, not the whole corpus, so a resume of the last twenty cases is not held to an overnight run's standard.
 * This host serves the pages for the whole job, so the guard stays.
 * @param {number} remaining
 * @returns {Promise<boolean>} whether the run may start
 */
async function powerAllows(remaining) {
  const power = await hostPowerState();
  const verdict = powerVerdict({ ...power, estimatedHours: (remaining * MEAN_CAPTURE_S * 2) / 3600 });
  if (!verdict.ok && !process.argv.includes("--allow-battery")) {
    console.error(`Refusing to start: ${verdict.reason}`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

/**
 * Submit the cases as one job, then follow it as far as this run was asked to.
 * @param {import("../fleet/fleet-job.ts").FleetInputs} inputs
 */
async function submit(inputs) {
  const { cases, done } = chooseCases();
  const todo = cases.filter((/** @type {{ id: string }} */ testCase) => !done.has(testCase.id));
  if (!await powerAllows(todo.length)) return;
  // Leased like everything else here, and released in the same `finally`, so a run that throws does
  // not leave the host pinned awake.
  const awake = keepHostAwake();
  // The pages are leased: started if missing, put back as found. The BOXES fetch them from this host for as long as the job runs.
  const pages = await leasePageServer({ root: PAGE_ROOT, port: PAGES_PORT, probePath: `${cases[0].id}/good.html` });
  try {
    const hostNotice = nonAuthoritativeHostNotice({ cwd: process.cwd(), servesPages: true });
    if (hostNotice) process.stdout.write(hostNotice);
    const baseUrl = pagesBaseUrl(process.env, PAGES_PORT);
    // Prove the pages are served before submitting anything, as the guest will fetch them. A wrong base URL is one clear error here and not a corpus of captured 404 pages.
    await pageTitle(captureUrl(baseUrl, cases[0], "good"));
    const progress = beginRun({ root: ROOT, worker: null, baseUrl, cases });
    for (const id of done) progress.skipped(id, "already captured (--resume)");
    if (!todo.length) return finishWithoutJob(progress, cases.length, done.size);
    const job = datasetJob({
      cases: todo, baseUrl, optionsOf: captureOptions, captureRoot: CAPTURE_ROOT,
      skipWhenOf: (testCase) => CACHE ? skipWhenFor({ captureRoot: CAPTURE_ROOT, caseId: testCase.id, pageHash: hashPageDir(resolve(PAGE_ROOT, testCase.id)), options: captureOptions(testCase) }) : null,
    });
    console.log(describeSubmission(job));
    const flow = flowFor(inputs, progress);
    const pending = submitJob(flow, { kind: JOB_KIND, ...job, extra: submittedPages(todo) });
    progress.addFleetJob({ id: pending.job, kind: JOB_KIND, submittedAt: pending.submittedAt });
    console.log(`Progress: ${progress.path} (follow the job: fleet job status ${pending.job}; npm run training:status)`);
    const notice = noWaitPageServerNotice(inputs, pages.started);
    if (notice) process.stderr.write(notice);
    process.exitCode = await follow(flow, [pending]);
  } finally {
    await pages.release();
    await awake.release();
  }
}

/** What is about to be submitted, in a line: the cases, the groups that hold each pair to one box, and how many the service may leave alone. @param {{ cases: unknown[], groups: Record<string, { skipWhen?: unknown }> }} job */
function describeSubmission({ cases, groups }) {
  const skippable = Object.values(groups).filter((group) => group.skipWhen).length;
  return `Submitting ${Object.keys(groups).length} case(s) as ${cases.length} captures in ${Object.keys(groups).length} group(s), each good and bad held to one box`
    + `${skippable ? `; ${skippable} carry skipWhen, left alone on a box that has not changed` : ""}.`;
}

/** Every selected case was already captured by the run being resumed, so there is nothing to submit. @param {import("./capture-progress.mjs").RunRecorder} progress @param {number} total @param {number} skipped */
function finishWithoutJob(progress, total, skipped) {
  const outcome = `0 captured, 0 failed, ${skipped} skipped, of ${total} cases`;
  progress.finish(outcome);
  console.log(`Nothing to capture: ${outcome}.`);
}

/**
 * `--collect[=<job ID>]`: write the corpus from a job that has finished, carrying on as a wait would have.
 * @param {import("../fleet/fleet-job.ts").FleetInputs} inputs
 */
async function collect(inputs) {
  const progress = continueRun(ROOT);
  process.exitCode = await collectFlow(flowFor(inputs, progress), COLLECT || undefined, JOB_KIND);
}

async function main() {
  refuseIfRunsReadonly(ROOT);
  const args = process.argv.slice(2);
  const notice = workerAddressNotice({ argv: args });
  if (notice) process.stderr.write(notice);
  const inputs = fleetInputs(args, process.env, { forCollect: COLLECT !== undefined });
  if (COLLECT !== undefined) await collect(inputs);
  else await submit(inputs);
}

// Guarded, because importing this module used to START A CAPTURE RUN. That bit three times in one
// session: twice by accident while inspecting it, and once when a unit test imported it to reach the
// pure `selectCases` — the test hung, having silently begun capturing 1,061 cases against a live
// worker. A pure function is not testable if reaching it launches the program that contains it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("training:capture failed:", /** @type {any} */ (error).message);
    process.exitCode = error instanceof FleetInputError ? 2 : 1;
  });
}
