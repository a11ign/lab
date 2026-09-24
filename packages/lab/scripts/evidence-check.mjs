// @ts-check
// Re-capture a sample of the dataset and ask whether a pipeline change altered the EVIDENCE.
//
//   npm run evidence:check -- <worker-url> [--sample=24] [--only=family] [--browser=chrome]
//
// `--browser` is what turns this into the Edge-vs-Chrome experiment. The baseline on disk was captured in
// Edge, so recapturing the same sample in Chrome and diffing field by field answers a question nobody has
// published: does NVDA announce the same thing in the two Chromium browsers? A SAME verdict would mean the
// corpus is browser-portable; a CHANGED one names exactly which fields move, which is a finding either way.
// It is also the only honest way to promote the Chrome preset from "predicted" to "measured".
//
// Runs under tsx, not plain node: it applies the pipeline's own verification gates, which live in
// TypeScript (@a11ign/evidence/verify). Same reason capture-screenreader-dataset.mjs does.
//
// Prints a per-case verdict and one recommendation: ship without invalidating the cache, or bump
// CAPTURE_PROTOCOL_VERSION and recapture. See ../src/capture/evidence-diff.mjs for why this exists --
// briefly, the cache key asks "could this have changed the evidence", never "did it", so before this
// existed every capture optimisation cost a 2,122-capture recapture to evaluate.
//
// The sample is STRATIFIED by family, not random. The lesson that cost the most in this project is
// that a guard validated on six hand-picked cases failed 44 in a live run, because the family it broke
// was not in the sample. One case per family, both variants, is the cheapest sample that cannot repeat
// that: absence-is-the-finding families (custom-control) and probe-dependent ones (table-*) are
// present by construction.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { compareCapture, readCapture, summarise } from "../src/capture/evidence-diff.mjs";
import { REPO_ROOT, datasetRoot, refuseIfRunsReadonly } from "../src/dataset-paths.mjs";
// #1185: every `git` spawn in this tree goes through a GIT_* scrubbing helper, and a read-only one is
// no exception -- a hook exports `GIT_DIR`, so an inherited environment reads another repository.
import { sandboxGitEnv } from "../../guards/src/git-env.mjs";
import { isEvidence } from "../src/training/capture-decisions.mjs";
import { titleOf } from "@a11ign/evidence/verify";
import { leasePageServer } from "../src/training/page-server.mjs";
import { nonAuthoritativeHostNotice } from "../src/training/capture-host.mjs";
import { hasUsableCaptureFiles } from "../src/training/capture-resume.mjs";
import { hostPagesBase } from "@a11ign/worker-fleet/host-address";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS } from "@a11ign/worker-fleet/worker-http";
import { workerIsUsable } from "@a11ign/worker-fleet/health";
import { drainAcrossPool } from "../src/training/worker-pool.mjs";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { captureTolerantly } from "@a11ign/worker-fleet/capture-client";
// #958: the three-direction manifest check every verdict reader shares.
import { assertManifestMatchesCases } from "../src/training/manifest-matches-cases.mjs";
// #2197: a crash and a CHANGED verdict no longer share an exit code. A leaf module, so a test can read the
// codes without importing this script and its corpus paths.
import { exitCodeFor, runToExit } from "../src/training/evidence-check-exit.mjs";

/**
 * the check that decides whether 2,122 cached captures survive a change. It also takes worker URLs
 * POSITIONALLY, which this guard does not touch.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--sample=", "--only=", "--browser="], { entry: import.meta.url, command: "npm run evidence:check" });

// Was hardcoded to "runs/screenreader-dataset" ignoring DATASET_ROOT entirely -- the fourth spelling of
// this default, and the only one that could not be redirected the way every other dataset tool can.
const DATASET = datasetRoot();
const BASELINE = resolve(DATASET, "captures");
/**
 * #968: EXPORTED, for the reason `emit-unclosable-vetoes.mjs`'s own `OUT` is -- so the fetch entry is
 * compared against the path this script writes rather than against a name the file still mentions.
 */
export const OUT = resolve(DATASET, "evidence-check");
/**
 * #968: THE FILE, not the directory -- `OUT` is a directory here, and `lab-fetch.yml` fetches the report
 * inside it. Exported and derived so `"report.json"` is written in exactly one place: naming it again in
 * the test would be a second copy of the fact, which is the drift #959 exists to stop rather than a
 * tidier spelling of it.
 */
export const REPORT = latestReportPath();

/**
 * `report.json` under whatever directory is passed. `REPORT` is this at the real `OUT`; `writeReports` is
 * this at whatever directory it was handed -- so the file name still has exactly ONE spelling in the tree
 * after #2122 gave the writer a directory it can be pointed at.
 *
 * @param {string} dir
 */
export function latestReportPath(dir = OUT) {
  return resolve(dir, "report.json");
}

/**
 * #2122: WHERE EVERY RUN'S REPORT SURVIVES, beside the one that names the latest.
 *
 * `REPORT` is a single fixed path with no run id, no timestamp and no append, so run N+1 OVERWROTE run N.
 * A repeated-read protocol -- the exact shape this repo uses to decide DRIFT versus SAME -- therefore left
 * an apparatus artefact for its LAST read only. #1908's acceptance was ten reads at one pin; on the lab,
 * read 10 was the only one with a file, and reads 1-9 survived solely in `a11y-lab`'s systemd journal,
 * which rotates. A verdict whose evidence exists only in a rotating journal cannot be re-derived once it
 * ages out -- it can only be believed, which is the one thing a reading in this project may not ask for.
 *
 * ADDITIONAL, never a rename. `lab-fetch.yml` fetches `report.json` by a fixed path and it is the only
 * fetch entry this tool has; moving it is the failure #968 already recorded once for this same file.
 *
 * A DIRECTORY rather than a `report-*.json` sibling, and that is forced rather than tidy:
 * `lab-fetch.yml` resolves a globbed entry with `find` over the PATTERN'S OWN `dirname`, so a glob sitting
 * beside `report.json` would be one whose directory also holds the file it must never match.
 */
export const RUN_REPORTS = resolve(OUT, "runs");

/**
 * One run's own file name: the instant it finished, and which process wrote it.
 *
 * BOTH halves, because either alone collides on the population this exists for. Two dispatches queued back
 * to back share a stamp at anything coarser than milliseconds, and a pid alone repeats inside a day on a
 * box that has been up for weeks. `:` and `.` become `-` for the reason every other run-scoped name in
 * this repo does it (`runs/board-snapshots/`): a colon is not portable in a path, and these files are read
 * on whatever machine the operator is sitting at, not only on the lab.
 *
 * @param {{ at: Date, runId: string }} run
 */
export function runReportName({ at, runId }) {
  return `${at.toISOString().replace(/[:.]/g, "-")}-${runId}.json`;
}

/**
 * Write one run's report where the next run cannot reach it, and REFUSE rather than replace.
 *
 * The refusal IS the fix stated as behaviour. Silently replacing the previous run's artefact is the defect
 * this path exists to remove, so doing it here -- even by accident, even under a name that is supposed to
 * be unique -- must stop and name both runs rather than leave a reader believing there was only ever one.
 * It is also the positive control for the test: make the name constant and two writes collide by name
 * instead of passing by comparing a directory to itself.
 *
 * `flag: "wx"` rather than `existsSync` then write: the kernel decides, in one call, whether this run is
 * the first to claim the name. The check-then-write it replaces had a window between the two in which a
 * second process could claim the same path -- small, and exactly the case this refusal exists for, since
 * a repeated identity is most likely to arise from two dispatches running at once rather than from one
 * running twice.
 *
 * @param {{ dir: string, at: Date, runId: string, report: unknown }} run
 * @returns {string} the path it wrote
 */
export function writeRunReport({ dir, at, runId, report }) {
  const path = resolve(dir, runReportName({ at, runId }));
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
    throw new Error(`evidence-check: ${path} already exists. A second run would replace the first run's `
      + `report, which is the thing this file exists to prevent -- the run identity `
      + `(${at.toISOString()}, ${runId}) is not unique. Nothing was written: `
      + `report.json still names the run whose file is already there.`, { cause: error });
  }
  return path;
}

/**
 * The commit this checkout was on, or why it could not be read.
 *
 * PROVENANCE, not the verdict: a run whose git is unreadable still has a real answer about the evidence,
 * so the failure is recorded IN the artefact rather than ending the run. It is not swallowed either --
 * `commitError` is what a reader sees instead of a commit, and a report carrying neither is impossible.
 *
 * `-C REPO_ROOT` because the lab runs jobs from a checkout whose cwd is not guaranteed, and a scrubbed
 * environment for #1185's reason: git exports `GIT_DIR` into every hook environment.
 *
 * @returns {{ commit: string, commitError?: undefined } | { commit: null, commitError: string }}
 */
export function checkoutCommit() {
  try {
    const commit = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"],
      { env: sandboxGitEnv(), encoding: "utf8" }).trim();
    return { commit };
  } catch (error) {
    return { commit: null, commitError: /** @type {Error} */ (error).message };
  }
}
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
const DEFAULT_SAMPLE = 24;

// EVERY positional argument is a worker. It took one, and used one, while the rest of the fleet idled.
//
// A single worker is still perfectly valid and is what the job catalogue passes by default — but the
// argument for it being REQUIRED does not survive inspection. The claim was that a second guest is a second
// variable; in fact the baseline corpus was itself captured across all four, so a single fresh worker does
// not remove that confound, it just hides which side it is on. What actually defends the comparison is
// fleet consistency, which `fleet:status` now proves and which was inert until the browserVersion memo was
// fixed.
const workers = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const worker = workers[0];
const flag = (/** @type {any} */ name, /** @type {any} */ fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const sampleSize = Number(flag("sample", DEFAULT_SAMPLE));
const only = flag("only", null);
// Absent means "whatever the guest is configured for", so an ordinary run is unaffected. The worker
// validates the name against its allow-list and answers 400 for anything else.
const browser = flag("browser", null);

function manifestCases() {
  const manifest = JSON.parse(readFileSync(resolve(DATASET, "manifest.json"), "utf8"));
  // THE VERDICT IS ABOUT THE CASES THE CODE DEFINES (#958), so a manifest that has drifted from them is
  // refused before a single capture is compared -- asked of the WHOLE manifest, before `--only` narrows it.
  assertManifestMatchesCases(manifest, {
    consequence: "this would compare evidence over a case set the code no longer defines",
  });
  return narrowTo(manifest.cases, only);
}

/**
 * The `--only=` filter: a FAMILY name, or a case id, matched on `family ?? id`.
 *
 * Exported so what this narrowing actually selects can be asserted rather than read. It matches on the
 * family FIRST, so a case whose id begins `media-autoplay-audio+` but whose family is
 * `multi-defect-1.4.2` is NOT selected by `--only=media-autoplay-audio` — measured 2026-09-22 on #1908,
 * where 7 cases embed the WAV under test and this filter reaches exactly 1 of them. That is the intended
 * population for that row (`ceo`'s condition 1 is about the single case), and the surprise is expensive
 * enough to pin: a reader who assumes the filter is by id would report ten clean reads of seven cases.
 *
 * @param {any[]} cases @param {string | null} only
 */
export function narrowTo(cases, only) {
  return cases.filter((/** @type {any} */ c) => !only || (c.family ?? c.id).includes(only));
}

/**
 * Can this case answer the question at all?
 *
 * A comparison is only about the CODE if both sides saw the same page. On a corpus where the page generator
 * has moved since capture, the recorded capture describes a different page — so the diff reports the page
 * change and calls it an evidence change.
 *
 * That is not hypothetical: this check once reported **40 of 47 CHANGED** for a refactor that moved pure
 * functions between files and altered no behaviour, with differences like `structure.links 40->0` that were
 * purely the shelved page rescale. Its own advice is "bump CAPTURE_PROTOCOL_VERSION and recapture", which
 * would have meant 2,122 captures for a no-op. Every one of those 40 had a moved page, and every case whose
 * page had NOT moved came back SAME — so excluding them costs nothing and is the only way the answer means
 * anything.
 *
 * `hasUsableCaptureFiles` is the same predicate `--resume` and `check-signals` use, so "comparable here" and
 * "current on disk" cannot drift apart.
 */
const pageIsUnchanged = (/** @type {any} */ testCase) => hasUsableCaptureFiles({
  id: testCase.id,
  captureRoot: resolve(DATASET, "captures"),
  pageRoot: resolve(DATASET, "pages"),
});

/**
 * Would this case be captured the same WAY it was captured?
 *
 * The probes are opt-in over the wire, so a case whose recorded options differ from what the manifest asks for
 * now is not comparable either — and this one is invisible to the page hash. Measured: 61 cases recorded
 * `probeTables: true` while the manifest on disk says false, because the manifest predates the fix that derives
 * that flag from the signal type. The fresh capture then requests no table probe, `structure.tableCells` goes
 * 4 -> 0, and the diff reports an evidence change that is really a missing question.
 *
 * Same rule as the page check, one field along: **a comparison must not be between two things that differ for
 * a reason unrelated to the change under test.**
 */
function optionsUnchanged(/** @type {any} */ testCase) {
  return ["good", "bad"].every((variant) => {
    try {
      const recorded = readCapture(resolve(DATASET, "captures"), testCase.id, variant)?.provenance?.options;
      // No recorded options at all is a capture from before provenance existed; the page check already refuses
      // those, so this must not turn "cannot tell" into "comparable".
      if (!recorded) return false;
      // EVERY probe flag, from both sides, by prefix. This named `probeForms` and `probeTables` — the two
      // that existed when it was written — which made the guard against "a comparison between two things
      // that differ for an unrelated reason" blind to the two flags added since. A case that gained
      // `probeFocus` would have been declared comparable and then diffed against a baseline captured
      // without it, reporting CHANGED for a question the baseline was never asked.
      //
      // Compared as booleans because `captureOptions` omits a falsy flag rather than sending false, so
      // absent and false are the same request and must compare equal.
      const flags = new Set([...Object.keys(testCase), ...Object.keys(recorded)].filter((k) => k.startsWith("probe")));
      return [...flags].every((flag) => !!recorded[flag] === !!testCase[flag]);
    } catch {
      return false;
    }
  });
}

/**
 * One case per family until the sample is full, so no family can be silently absent.
 *
 * Exported for the same reason `narrowTo` is, and the two compose into the fact an operator most needs
 * before dispatching: under `--only=<one family>` the stratified set is ONE case whatever `--sample` says,
 * because one case per family is one case. `--sample=1` and `--sample=200` then do identical work.
 */
export function stratify(/** @type {any} */ cases, /** @type {any} */ limit) {
  const byFamily = new Map();
  for (const testCase of cases) {
    const family = testCase.family ?? testCase.id;
    if (!byFamily.has(family)) byFamily.set(family, testCase);
  }
  return [...byFamily.values()].slice(0, limit);
}

async function capture(/** @type {any} */ testCase, /** @type {any} */ variant, /** @type {any} */ worker) {
  const pageUrl = `${pagesBase()}/${testCase.id}/${variant}.html`;
  const response = await captureTolerantly({
    worker,
    body: {
      url: pageUrl,
      task: testCase.task ?? null,
      // Every `probe*` flag the case declares, forwarded BY PREFIX rather than by name. Naming them here
      // made this the sixth place a probe flag has to be listed, and the previous five have dropped one
      // twice in two days. It matters more here than most: this tool captures a case FRESH and diffs it
      // against the baseline, so a flag it forgets produces a capture missing evidence the baseline has —
      // reported as CHANGED, which is this tool's most expensive possible answer.
      ...Object.fromEntries(
        Object.entries(testCase).filter(([key, value]) => key.startsWith("probe") && value),
      ),
      ...(browser ? { browser } : {}),
    },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const body = response.json ?? {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// The guest cannot reach the host's localhost, so the pages must be addressed by the host's LAN IP --
// the same reason leaseWorkerPool hands back a hostAddress.
let hostPagesCache = null;
/**
 * The base URL the GUEST fetches dataset pages from — resolved LAZILY, on first use.
 *
 * This was `const hostPages = hostPagesBase(worker, ...)` at module scope, and `hostPagesBase` throws when
 * it cannot work out an address: "cannot work out this host's address as seen from undefined". So merely
 * IMPORTING this file threw whenever no worker argument was present, which is every import. That made
 * `node -e "import('./evidence-check.mjs')"` — the only real check this repo has that an .mjs file still
 * loads — unable to distinguish a broken module from a missing argument.
 *
 * Lazy rather than threaded through `capture`, `pageTitle` and `requirePagesServed` as a parameter: three
 * signatures changed to move one constant is a worse trade than one memoised accessor.
 */
function pagesBase() {
  hostPagesCache ??= hostPagesBase(worker, process.env.DATASET_PAGES_PORT || 5050);
  return hostPagesCache;
}

/** The page's own title, so the verification gates can check the capture against it. */
async function pageTitle(/** @type {any} */ testCase, /** @type {any} */ variant) {
  try {
    const response = await fetch(`${pagesBase()}/${testCase.id}/${variant}.html`,
      { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return titleOf(await response.text());
  } catch {
    return null;
  }
}

/**
 * Refuse to run at all unless the pages are actually being served.
 *
 * This is not defensive padding; it is the difference between a verdict and a lie. `pageTitle` returns
 * null when it cannot read a page, and the integrity gate below is written as
 * `if (title !== null && !isEvidence(...))` -- so a null SKIPPED the gate. With the page server down,
 * every title read failed, every gate was skipped, and the run captured Edge's "hmmm... can't reach
 * this page" for all 48 cases, compared those against real evidence, and concluded:
 *
 *     48 compared: 0 same, 0 drift, 48 changed
 *     evidence CHANGED -- bump CAPTURE_PROTOCOL_VERSION and recapture
 *
 * Acting on that would have invalidated 2,122 captures because a static file server was not running.
 * "Cannot verify" must never resolve to "proceed" in a tool whose whole output is a verdict.
 */
async function requirePagesServed(/** @type {any} */ cases) {
  const probe = cases[0];
  for (const variant of ["good", "bad"]) {
    if (await pageTitle(probe, variant) !== null) return;
  }
  process.stderr.write(
    `Cannot read ${pagesBase()}/${probe.id}/good.html — the dataset pages are not being served.\n` +
    "Refusing to run: without the page title there is nothing to check a capture AGAINST, so every\n" +
    "capture would be compared ungated and an error page would read as changed evidence.\n" +
    "Start the pages (a run leases them automatically) or set DATASET_BASE_URL.\n");
  process.exit(2);
}

/**
 * Only when RUN, never on import.
 *
 * Everything below leases a page server, drives real captures against a worker, writes a report and then
 * calls `process.exit` — so importing this file did all of that and terminated the importing process with
 * evidence-check's verdict. The usage guard came in here too: a missing worker argument is a mistake made
 * by a CALLER, and there is no caller when a file is merely imported.
 */
/**
 * ONE ROW OF THE REPORT, and the only place that decides what a row holds.
 *
 * `worker` is the box that actually produced this capture, taken from the pool's own context — never the
 * first url on the argv. The report used to carry a single top-level `worker` set to `workers[0]`, which
 * on a fleet dispatch names the same box whether or not it did any of the work: a CONSTANT read as a
 * measurement (#1948). A pooled run hands a case to whichever worker takes it off the shared queue, so
 * the capturing box is knowable only here, at the moment the case is handled.
 *
 * `null` for a case no worker ever captured — an UNCOMPARED row exists precisely because nothing ran, and
 * naming a worker on it would invent the very attribution this row is about.
 *
 * @param {{testCase: any, variant: string, worker: string | null, comparison: any}} row
 */
export function resultRow({ testCase, variant, worker, comparison }) {
  return { id: testCase.id, variant, worker, comparison };
}

/**
 * Account for every capture that was ASKED for, so one that never happened reduces coverage instead of
 * disappearing from it.
 *
 * Takes the same `io` as `caseComparer` and for the same reason: this is the FOURTH `resultRow` site and
 * the only one that passes `worker: null` correctly, so it cannot be guarded by a rule over the pushes —
 * a "no site passes null" scan would turn exactly this line red. It is guarded by being run, and the
 * mutant it has to stop is `null` becoming `worker`, which here resolves to the module-level `workers[0]`
 * and would name a box that captured nothing for the row that exists BECAUSE nothing captured it.
 *
 * @param {{selected: any[], results: any[], io: {baselineFor: Function, write: Function}}} args
 */
export function countUncomparedAgainstCoverage({ selected, results, io }) {
// A capture that failed left no result at all, so it vanished from the DENOMINATOR: measured on this run,
// one worker answered `NVDA is running but not speaking`, that case's second variant was never attempted,
// and the verdict read `46 compared: 46 same ... safe to ship` — complete coverage of a sample two smaller
// than the one requested. Exactly the fault fixed yesterday for SKIPPED captures, arriving through the
// path that does not reach `results`. It predates the pool: the old sequential loop also just `continue`d.
//
// Reconciled after the drain rather than in the catch, because the pool may hand a failed case to another
// worker — recording it at the moment of failure would double-count the ones that later succeed. Asking
// "what has no result?" at the end is true regardless of how many attempts it took.
//
// REJECTED, not a new verdict: `summarise` counts it in `attempted` and not in `compared`, which is what
// makes the coverage rule report INCONCLUSIVE. A worker fault and a capture the pipeline would throw away
// are the same thing to this tool — we have no opinion about that family, and must not imply one.
for (const testCase of selected) {
  for (const variant of ["good", "bad"]) {
    if (!io.baselineFor(testCase, variant)) continue; // never asked for; not missing
    if (results.some((/** @type {any} */ r) => r.id === testCase.id && r.variant === variant)) continue;
    results.push(resultRow({
      testCase, variant, worker: null,
      comparison: { verdict: "REJECTED", changes: [], phrases: null },
    }));
    io.write(`  UNCOMPARED  ${testCase.id}.${variant}  no usable capture; counted against coverage\n`);
  }
}
}

/**
 * THE POOL'S HANDLER: one case, both variants, on the one worker the pool leased for it.
 *
 * Its I/O arrives as a parameter and the handler is built at module scope, rather than the whole thing
 * being an arrow closed over `compareAcrossPool`. That is this row's attribution guard and not a shape
 * preference. Three of the four `resultRow` sites are in here, each recording the worker that CAPTURED,
 * and a source read cannot tell them apart from the defect: `worker` also names a module-level
 * `workers[0]` two scopes up (`:82`, still live for `pagesBase` and the usage line), so deleting the
 * `{ worker }` parameter leaves every line below reading and every row naming the first url on the argv
 * — the exact constant #1948 removed, restored silently. Driven by `evidence-check-aim.test.ts` with
 * stub I/O, both bindings are in scope at once and only the parameter answers.
 *
 * `io` is bundled rather than four positional collaborators (`max-params`), and holds only what touches
 * the world: `isEvidence` and `compareCapture` are pure and stay imported, so a test drives the real
 * gates rather than its own opinion of them.
 *
 * @param {{results: any[], io: {baselineFor: Function, captureOn: Function, titleFor: Function, write: Function}}} deps
 */
export function caseComparer({ results, io }) {
  return async (/** @type {any} */ testCase, /** @type {any} */ { worker }) => {
    for (const variant of ["good", "bad"]) {
      const baseline = io.baselineFor(testCase, variant);
      if (!baseline) {
        io.write(`  SKIP        ${testCase.id}.${variant} (no baseline capture)\n`);
        continue;
      }
      let candidate;
      try {
        candidate = await io.captureOn(testCase, variant, worker);
      } catch (error) {
        io.write(`  FAILED      ${testCase.id}.${variant}: ${/** @type {any} */ (error).message}\n`);
        // Rethrown so the POOL sees it: a worker that fails three cases running is evicted and its work is
        // handed back, which is the entire reason for using the pool rather than a plain loop. Swallowing it
        // here would leave a dead guest quietly failing everything it touched.
        throw error;
      }
      // Apply the pipeline's OWN gates before comparing. A capture a real run would reject and retry is
      // not evidence, so diffing it produces a false CHANGED and blames the change for a bad capture.
      const title = await io.titleFor(testCase, variant);
      if (title === null) {
        // Preflight proved the server is up, so this is a per-page failure. Skip it: comparing a
        // capture we cannot gate is how an error page came to read as changed evidence.
        results.push(resultRow({
          testCase, variant, worker, comparison: { verdict: "SKIPPED", changes: [], phrases: null },
        }));
        io.write(`  SKIPPED     ${testCase.id}.${variant}  page title unreadable; cannot gate, so not compared\n`);
        continue;
      }
      if (!isEvidence(candidate, title)) {
        results.push(resultRow({
          testCase, variant, worker, comparison: { verdict: "REJECTED", changes: [], phrases: null },
        }));
        io.write(`  REJECTED    ${testCase.id}.${variant}  the pipeline would reject this capture; excluded\n`);
        continue;
      }
      const comparison = compareCapture(baseline, candidate);
      results.push(resultRow({ testCase, variant, worker, comparison }));
      io.write(`  ${comparison.verdict.padEnd(18)} ${testCase.id}.${variant}  ${comparisonDetail(comparison)}\n`);
    }
  };
}

/** What to say about a comparison beyond its verdict; "" when the verdict already says everything. */
function comparisonDetail(/** @type {any} */ comparison) {
  if (comparison.verdict === "DIFFERENT_DOCUMENT") {
    // THE TWO DOCUMENTS, not the fields. A field list here would be true and would send the reader
    // after the capture pipeline when the cause is that the server sent another page (#687).
    return comparison.identity.differing
      .map((/** @type {any} */ d) => `${d.component} ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`)
      .join("; ");
  }
  if (comparison.verdict === "CHANGED") {
    return comparison.changes.map((/** @type {any} */ c) => `${c.field} ${c.before}->${c.after}`).join(", ");
  }
  // `&& comparison.phrases` is not belt-and-braces: `compareCapture` returns `phrases: null` for a
  // DIFFERENT_DOCUMENT, because a transcript comparison that did not happen must not render as
  // "nothing drifted", and the compiler is right to make every reader say what it does about that.
  if (comparison.verdict === "DRIFT" && comparison.phrases) {
    return `phrases ${comparison.phrases.before}->${comparison.phrases.after}`
      + (comparison.phrases.lost.length ? ` lost: ${JSON.stringify(comparison.phrases.lost.slice(0, 2))}` : "");
  }
  return "";
}

/**
 * Capture each case fresh across the pool and diff it against the baseline.
 *
 * Split out of `main` because it is a phase with a single job, and because `main` had grown past the
 * point where the lease, the sample, the comparison and the verdict could be read as one narrative.
 *
 * @returns {Promise<{results: object[], evicted: string[]}>}
 */
async function compareAcrossPool(/** @type {any} */ selected) {
// ONE CASE PER WORKER AT A TIME, across every worker named. This ran against a single worker while the
// rest of the fleet sat idle — ~20 minutes for 48 captures where four boxes do it in about five. The
// dispatch is `worker-pool.mjs`, shared with the corpus runner, because a second copy of a pool is the
// kind of duplication that agrees right up until a worker dies.
//
// A case is the unit, both variants together, for the reason it always is here: a pair is only comparable
// if both halves came from the same screen reader on the same machine.
/** @type {any[]} */
const results = [];
// ONE `io` for the phase: the comparer and the reconciliation below read the same baselines and write to
// the same stream, and handing them one object is what lets a test drive both halves of the report.
const io = {
  baselineFor: (/** @type {any} */ testCase, /** @type {any} */ variant) =>
    readCapture(BASELINE, testCase.id, variant),
  captureOn: capture,
  titleFor: pageTitle,
  write: (/** @type {any} */ line) => process.stdout.write(line),
};
const compareCase = caseComparer({ results, io });

const pooled = await drainAcrossPool({
  workers,
  items: selected,
  prepare: async (worker) => {
    if (!await workerIsUsable((await requestJson(`${worker.replace(/\/$/, "")}/health`, { timeoutMs: 15_000 })).json)) {
      throw new Error("not ready");
    }
    return worker;
  },
  handle: compareCase,
  hooks: {
    onWorkerUnusable: (/** @type {any} */ worker, /** @type {any} */ error) =>
      process.stdout.write(`  worker unusable, skipping it: ${worker} (${error.message})\n`),
    onEvicted: (/** @type {any} */ worker, /** @type {any} */ { consecutiveFailures, handedBack }) =>
      process.stdout.write(`  EVICTING ${worker} after ${consecutiveFailures} consecutive failures; `
        + `${handedBack} case(s) go back to the queue\n`),
  },
});
  countUncomparedAgainstCoverage({ selected, results, io });
  return { results, evicted: pooled.evicted };
}

/**
 * BOTH artefacts, from one object: the file `lab-fetch.yml` names, and the file the next run cannot touch.
 *
 * The SAME report goes to both, so `report.json` gains `at`, `runId` and `commit` as well -- that is what
 * lets a reader holding the fetched copy say WHICH run-scoped file it duplicates. Nothing in the
 * repository reads a field of this report (`lab-fetch.yml` fetches the file, not a field), so the addition
 * costs no reader; the absence cost #1908 nine tenths of its evidence.
 *
 * THE DURABLE FILE IS WRITTEN FIRST, and that order is the whole of the guarantee (reviewer-2 on #2136,
 * 2026-09-23). It used to be the other way round -- `report.json` first and unconditionally, so that a
 * run-scoped refusal could not cost the run the answer it had just spent hours of fleet time computing.
 * That ordering bought the answer at the price of the only thing a reader can check: on a refusal,
 * `report.json` held the SECOND run while `runs/<identity>.json` still held the FIRST, so the one entry
 * `lab-fetch.yml` fetches named a run with no run-scoped artefact anywhere, and the two files disagreed
 * SILENTLY. Two artefacts that disagree are worse than one run's answer lost, because the disagreement
 * reaches a reader looking like evidence while the loss is loud -- the refusal names both runs and the run
 * exits non-zero. So the run-scoped write goes first and `report.json` is only replaced once the file it
 * will name is on disk; anything that stops the first write stops the second.
 *
 * `at`, `runId`, `out` and `runs` DEFAULT rather than being read inside, so the whole composition -- not
 * two halves of it joined by a test -- can be driven into a temporary directory at two chosen identities.
 * The row this was filed for is about what two successive runs leave behind, and a test that cannot run
 * this function twice is a test of something else.
 *
 * @param {{ workers: string[], results: any[], summary: any, at?: Date, runId?: string, out?: string,
 *   runs?: string }} run
 * @returns {{ report: any, latest: string, runReport: string }}
 */
export function writeReports({ workers, results, summary,
  at = new Date(), runId = String(process.pid), out = OUT, runs = RUN_REPORTS }) {
  // `workers` — THE POOL AS DISPATCHED — and a `worker` on every row, which is the box that captured it.
  // This wrote `worker: workers[0]` for the whole run: the first url on the argv, not the one that did the
  // work. On a fleet dispatch that field named the same box whether or not it captured anything, so a
  // verdict quoting it reported a constant as a measurement (#1948). The singular key is GONE rather than
  // kept truthful, because a reader who has seen it cannot tell which of the two meanings a given report
  // carries.
  //
  // #2122: `commit` joins them for the same reason `worker` did. A verdict is re-derivable only against
  // the code that produced it, and "ten reads at pin 8fd25e80c" was a sentence a session typed rather than
  // a field the instrument wrote.
  const report = { at: at.toISOString(), runId, ...checkoutCommit(), workers, results, summary };
  const runReport = writeRunReport({ dir: runs, at, runId, report });
  const latest = latestReportPath(out);
  mkdirSync(out, { recursive: true });
  writeFileSync(latest, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, latest, runReport };
}

async function main() {
  refuseIfRunsReadonly(OUT);
  if (!worker) {
    process.stderr.write(
      "usage: npm run evidence:check -- <worker-url> [<worker-url>...] [--sample=24] [--only=family] "
      + "[--browser=chrome]\n");
    process.exit(2);
  }
  const comparable = selectComparable();
  const selected = stratify(comparable, sampleSize);
  process.stdout.write(`Evidence check: ${selected.length} case(s), both variants, across `
    + `${workers.length} worker(s): ${workers.join(", ")}\n`);
  process.stdout.write(`Pages: ${pagesBase()}\nBaseline: ${BASELINE}\n\n`);

  // Lease the pages the same way a real run does, instead of assuming somebody left a server up. What
  // had been serving them here was a manual `npx serve` from eight days earlier; when it was cleared,
  // this tool silently began capturing Edge's error page.
  // SAY WHOSE BASELINE THIS IS. The comparison is "the captures on THIS disk" against "what the fleet
  // produces now", and on a laptop the first half is whatever was last synced — so the verdict is about the
  // COPY, not about the change you just made. Measured 2026-08-28: this reported CHANGED on 2 of 48, and
  // the difference was NVDA's own wording (`unlabeled` -> `unlabelled`) between a stored capture from
  // 2026-08-07 taken on a UTM VM and today's bare-metal fleet. Nothing to do with the change under test,
  // and it was read as a verdict on it for several minutes.
  const hostNotice = nonAuthoritativeHostNotice({ cwd: process.cwd(), servesPages: true });
  if (hostNotice) process.stdout.write(hostNotice);
  const pagesLease = await leasePageServer({
    root: resolve(DATASET, "pages"),
    port: Number(process.env.DATASET_PAGES_PORT || 5050),
    probePath: `${selected[0].id}/good.html`,
  });
  await requirePagesServed(selected);

  const { results, evicted } = await compareAcrossPool(selected);
  if (evicted.length) {
    process.stdout.write(`\nEvicted ${evicted.length} worker(s): ${evicted.join(", ")}\n`);
  }

  await pagesLease.release();

  const summary = summarise(results);
  const { runReport } = writeReports({ workers, results, summary });

  // WHICH BOXES ACTUALLY CAPTURED, on the run's own output rather than only in the fetched report:
  // #1908's acceptance is ten reads posted with the worker each came from, and an operator reading a
  // dispatch log had no way to answer that at all.
  const capturedBy = [...new Set(results.map((/** @type {any} */ r) => r.worker).filter(Boolean))];
  process.stdout.write(`\nCaptured by ${capturedBy.length} of the ${workers.length} worker(s) named: `
    + `${capturedBy.join(", ") || "none"}\n`);

  process.stdout.write(`${summary.compared} compared: ` +
    `${summary.counts.SAME} same, ${summary.counts.DRIFT} drift, ${summary.counts.CHANGED} changed` +
    (summary.counts.REJECTED ? `, ${summary.counts.REJECTED} rejected (excluded)` : "") + "\n");
  process.stdout.write(`${summary.recommendation}\n`);
  process.stdout.write(`Report: ${REPORT}\n`);
  // #2122: NAMED ON THE RUN'S OWN OUTPUT, not only on disk. The durable copy is worth nothing to an
  // operator reading a dispatch log who cannot tell which file this read became.
  process.stdout.write(`This run: ${runReport}\n`);
  // Exit code is the contract, same as the other gates: 0 safe to ship, 1 evidence changed,
  // 2 could not answer, 3 (`EXIT.THREW`, #2197) it threw and never got to answer.
  // `inconclusive` MUST NOT exit 0, and that now covers PARTIAL coverage as well as
  // none: this exited 0 with "safe to ship" having compared 2 of 48, because a concurrent run stopped the
  // page server two captures in. The stratified sample means an uncompared capture is an unexamined
  // FAMILY, so a verdict drawn from the ones that landed says nothing about the ones that did not.
  process.exit(exitCodeFor(summary));
}

/**
 * Which cases can honestly be compared, and a loud account of every one excluded.
 *
 * Split from `main` to stay inside the lint gate, and it is a real concern rather than a slice taken to
 * satisfy it: deciding what is comparable is the whole reason this tool can be trusted. A capture taken
 * against a DIFFERENT version of the page would diff the page rather than the code, and reporting that as
 * "evidence changed" would send someone recapturing 2,122 pairs for nothing.
 */
function selectComparable() 
{
  const allCases = manifestCases();
  const pageOk = allCases.filter(pageIsUnchanged);
  const comparable = pageOk.filter(optionsUnchanged);
  const pageSkipped = allCases.length - pageOk.length;
  const optionSkipped = pageOk.length - comparable.length;
  if (pageSkipped) {
    process.stdout.write(
      `${pageSkipped} case(s) excluded: their PAGE has changed since capture, so a diff would measure the page `
      + `and not the code. Recapture them (npm run training:capture -- --resume) to widen this check.\n`);
  }
  if (optionSkipped) {
    process.stdout.write(
      `${optionSkipped} case(s) excluded: the manifest now asks for different PROBES than the recorded capture `
      + `used, so the fresh capture would be asked a different question. Regenerate the manifest `
      + `(npm run training:generate) and recapture them.\n`);
  }
  if (!comparable.length) {
    // Refusing is the honest answer. Reporting SAME over nothing examined is how "verified" comes to mean
    // "unexamined", which is the failure this repo keeps meeting.
    process.stderr.write("no case has a capture taken against its CURRENT page — nothing can be compared.\n");
    process.exit(2);
  }
  return comparable;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await runToExit(main);
