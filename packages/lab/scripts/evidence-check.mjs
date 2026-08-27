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
// TypeScript (@a11y-witness/evidence/verify). Same reason capture-screenreader-dataset.mjs does.
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
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { compareCapture, readCapture, summarise } from "../src/capture/evidence-diff.mjs";
import { isEvidence } from "../src/training/capture-decisions.mjs";
import { titleOf } from "@a11y-witness/evidence/verify";
import { leasePageServer } from "../src/training/page-server.mjs";
import { hasUsableCaptureFiles } from "../src/training/capture-resume.mjs";
import { hostPagesBase } from "../../worker-fleet/src/host-address.mjs";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS } from "../../worker-fleet/src/worker-http.mjs";
import { workerIsUsable } from "../../worker-fleet/src/worker-health.mjs";
import { drainAcrossPool } from "../src/training/worker-pool.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * the check that decides whether 2,122 cached captures survive a change. It also takes worker URLs
 * POSITIONALLY, which this guard does not touch.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--sample=", "--only=", "--browser="], { entry: import.meta.url, command: "npm run evidence:check" });

const DATASET = resolve(process.cwd(), "runs/screenreader-dataset");
const BASELINE = resolve(DATASET, "captures");
const OUT = resolve(DATASET, "evidence-check");
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
const flag = (name, fallback) => {
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
  return manifest.cases.filter((c) => !only || (c.family ?? c.id).includes(only));
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
const pageIsUnchanged = (testCase) => hasUsableCaptureFiles({
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
function optionsUnchanged(testCase) {
  return ["good", "bad"].every((variant) => {
    try {
      const recorded = JSON.parse(readFileSync(resolve(DATASET, "captures", `${testCase.id}.${variant}.json`), "utf8"))
        .provenance?.options;
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

/** One case per family until the sample is full, so no family can be silently absent. */
function stratify(cases, limit) {
  const byFamily = new Map();
  for (const testCase of cases) {
    const family = testCase.family ?? testCase.id;
    if (!byFamily.has(family)) byFamily.set(family, testCase);
  }
  return [...byFamily.values()].slice(0, limit);
}

async function capture(testCase, variant, worker) {
  const pageUrl = `${pagesBase()}/${testCase.id}/${variant}.html`;
  const response = await requestJson(`${worker.replace(/\/$/, "")}/capture`, {
    method: "POST",
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
async function pageTitle(testCase, variant) {
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
async function requirePagesServed(cases) {
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
 * Capture each case fresh across the pool and diff it against the baseline.
 *
 * Split out of `main` because it is a phase with a single job, and because `main` had grown past the
 * point where the lease, the sample, the comparison and the verdict could be read as one narrative.
 *
 * @returns {Promise<{results: object[], evicted: string[]}>}
 */
/**
 * Account for every capture that was ASKED for, so one that never happened reduces coverage instead of
 * disappearing from it.
 */
function countUncomparedAgainstCoverage(selected, results) {
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
    if (!readCapture(BASELINE, testCase.id, variant)) continue; // never asked for; not missing
    if (results.some((r) => r.id === testCase.id && r.variant === variant)) continue;
    results.push({ id: testCase.id, variant, comparison: { verdict: "REJECTED", changes: [], phrases: null } });
    process.stdout.write(`  UNCOMPARED  ${testCase.id}.${variant}  no usable capture; counted against coverage\n`);
  }
}
}

async function compareAcrossPool(selected) {
// ONE CASE PER WORKER AT A TIME, across every worker named. This ran against a single worker while the
// rest of the fleet sat idle — ~20 minutes for 48 captures where four boxes do it in about five. The
// dispatch is `worker-pool.mjs`, shared with the corpus runner, because a second copy of a pool is the
// kind of duplication that agrees right up until a worker dies.
//
// A case is the unit, both variants together, for the reason it always is here: a pair is only comparable
// if both halves came from the same screen reader on the same machine.
const results = [];
const compareCase = async (testCase, { worker }) => {
  for (const variant of ["good", "bad"]) {
    const baseline = readCapture(BASELINE, testCase.id, variant);
    if (!baseline) {
      process.stdout.write(`  SKIP        ${testCase.id}.${variant} (no baseline capture)\n`);
      continue;
    }
    let candidate;
    try {
      candidate = await capture(testCase, variant, worker);
    } catch (error) {
      process.stdout.write(`  FAILED      ${testCase.id}.${variant}: ${error.message}\n`);
      // Rethrown so the POOL sees it: a worker that fails three cases running is evicted and its work is
      // handed back, which is the entire reason for using the pool rather than a plain loop. Swallowing it
      // here would leave a dead guest quietly failing everything it touched.
      throw error;
    }
    // Apply the pipeline's OWN gates before comparing. A capture a real run would reject and retry is
    // not evidence, so diffing it produces a false CHANGED and blames the change for a bad capture.
    const title = await pageTitle(testCase, variant);
    if (title === null) {
      // Preflight proved the server is up, so this is a per-page failure. Skip it: comparing a
      // capture we cannot gate is how an error page came to read as changed evidence.
      results.push({ id: testCase.id, variant, comparison: { verdict: "SKIPPED", changes: [], phrases: null } });
      process.stdout.write(`  SKIPPED     ${testCase.id}.${variant}  page title unreadable; cannot gate, so not compared\n`);
      continue;
    }
    if (!isEvidence(candidate, title)) {
      results.push({ id: testCase.id, variant, comparison: { verdict: "REJECTED", changes: [], phrases: null } });
      process.stdout.write(`  REJECTED    ${testCase.id}.${variant}  the pipeline would reject this capture; excluded\n`);
      continue;
    }
    const comparison = compareCapture(baseline, candidate);
    results.push({ id: testCase.id, variant, comparison });
    const detail = comparison.verdict === "CHANGED"
      ? comparison.changes.map((c) => `${c.field} ${c.before}->${c.after}`).join(", ")
      : comparison.verdict === "DRIFT"
        ? `phrases ${comparison.phrases.before}->${comparison.phrases.after}` +
          (comparison.phrases.lost.length ? ` lost: ${JSON.stringify(comparison.phrases.lost.slice(0, 2))}` : "")
        : "";
    process.stdout.write(`  ${comparison.verdict.padEnd(11)} ${testCase.id}.${variant}  ${detail}\n`);
  }
};

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
    onWorkerUnusable: (worker, error) =>
      process.stdout.write(`  worker unusable, skipping it: ${worker} (${error.message})\n`),
    onEvicted: (worker, { consecutiveFailures, handedBack }) =>
      process.stdout.write(`  EVICTING ${worker} after ${consecutiveFailures} consecutive failures; `
        + `${handedBack} case(s) go back to the queue\n`),
  },
});
  countUncomparedAgainstCoverage(selected, results);
  return { results, evicted: pooled.evicted };
}

async function main() {
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
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify({ worker, results, summary }, null, 2) + "\n", "utf8");

  process.stdout.write(`\n${summary.compared} compared: ` +
    `${summary.counts.SAME} same, ${summary.counts.DRIFT} drift, ${summary.counts.CHANGED} changed` +
    (summary.counts.REJECTED ? `, ${summary.counts.REJECTED} rejected (excluded)` : "") + "\n");
  process.stdout.write(`${summary.recommendation}\n`);
  process.stdout.write(`Report: ${resolve(OUT, "report.json")}\n`);
  // Exit code is the contract, same as the other gates: 0 safe to ship, 1 evidence changed,
  // 2 could not answer. `inconclusive` MUST NOT exit 0, and that now covers PARTIAL coverage as well as
  // none: this exited 0 with "safe to ship" having compared 2 of 48, because a concurrent run stopped the
  // page server two captures in. The stratified sample means an uncompared capture is an unexamined
  // FAMILY, so a verdict drawn from the ones that landed says nothing about the ones that did not.
  process.exit(summary.inconclusive ? 2 : summary.evidenceChanged ? 1 : 0);
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
  if (!comparable.length) {
    // Refusing is the honest answer. Reporting SAME over nothing examined is how "verified" comes to mean
    // "unexamined", which is the failure this repo keeps meeting.
    process.stderr.write("no case has a capture taken against its CURRENT page — nothing can be compared.\n");
    process.exit(2);
  }
  return comparable;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
