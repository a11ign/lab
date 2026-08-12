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
import { resolve } from "node:path";
import { compareCapture, readCapture, summarise } from "../src/capture/evidence-diff.mjs";
import { isEvidence } from "../src/training/capture-decisions.mjs";
import { titleOf } from "@a11y-witness/evidence/verify";
import { leasePageServer } from "../src/training/page-server.mjs";
import { hasUsableCaptureFiles } from "../src/training/capture-resume.mjs";

const DATASET = resolve(process.cwd(), "runs/screenreader-dataset");
const BASELINE = resolve(DATASET, "captures");
const OUT = resolve(DATASET, "evidence-check");
const CAPTURE_TIMEOUT_MS = 300_000;
const DEFAULT_SAMPLE = 24;

const [worker] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
if (!worker) {
  process.stderr.write(
    "usage: npm run evidence:check -- <worker-url> [--sample=24] [--only=family] [--browser=chrome]\n");
  process.exit(2);
}
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
  const wanted = { probeForms: !!testCase.probeForms, probeTables: !!testCase.probeTables };
  return ["good", "bad"].every((variant) => {
    try {
      const recorded = JSON.parse(readFileSync(resolve(DATASET, "captures", `${testCase.id}.${variant}.json`), "utf8"))
        .provenance?.options;
      // No recorded options at all is a capture from before provenance existed; the page check already refuses
      // those, so this must not turn "cannot tell" into "comparable".
      if (!recorded) return false;
      return !!recorded.probeForms === wanted.probeForms && !!recorded.probeTables === wanted.probeTables;
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

async function capture(testCase, variant) {
  const pageUrl = `${hostPages}/${testCase.id}/${variant}.html`;
  const response = await fetch(`${worker.replace(/\/$/, "")}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: pageUrl,
      task: testCase.task ?? null,
      probeForms: !!testCase.probeForms,
      probeTables: !!testCase.probeTables,
      ...(browser ? { browser } : {}),
    }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// The guest cannot reach the host's localhost, so the pages must be addressed by the host's LAN IP --
// the same reason leaseWorkerPool hands back a hostAddress.
const hostPages = process.env.DATASET_BASE_URL
  ?? `http://${new URL(worker).hostname.replace(/\.\d+$/, ".1")}:${process.env.DATASET_PAGES_PORT || 5050}`;

/** The page's own title, so the verification gates can check the capture against it. */
async function pageTitle(testCase, variant) {
  try {
    const response = await fetch(`${hostPages}/${testCase.id}/${variant}.html`,
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
    `Cannot read ${hostPages}/${probe.id}/good.html — the dataset pages are not being served.\n` +
    "Refusing to run: without the page title there is nothing to check a capture AGAINST, so every\n" +
    "capture would be compared ungated and an error page would read as changed evidence.\n" +
    "Start the pages (a run leases them automatically) or set DATASET_BASE_URL.\n");
  process.exit(2);
}

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
const selected = stratify(comparable, sampleSize);
process.stdout.write(`Evidence check: ${selected.length} case(s), both variants, against ${worker}\n`);
process.stdout.write(`Pages: ${hostPages}\nBaseline: ${BASELINE}\n\n`);

// Lease the pages the same way a real run does, instead of assuming somebody left a server up. What
// had been serving them here was a manual `npx serve` from eight days earlier; when it was cleared,
// this tool silently began capturing Edge's error page.
const pagesLease = await leasePageServer({
  root: resolve(DATASET, "pages"),
  port: Number(process.env.DATASET_PAGES_PORT || 5050),
  probePath: `${selected[0].id}/good.html`,
});
await requirePagesServed(selected);

const results = [];
for (const testCase of selected) {
  for (const variant of ["good", "bad"]) {
    const baseline = readCapture(BASELINE, testCase.id, variant);
    if (!baseline) {
      process.stdout.write(`  SKIP        ${testCase.id}.${variant} (no baseline capture)\n`);
      continue;
    }
    let candidate;
    try {
      candidate = await capture(testCase, variant);
    } catch (error) {
      process.stdout.write(`  FAILED      ${testCase.id}.${variant}: ${error.message}\n`);
      continue;
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
// Exit code is the contract, same as the other gates: 0 safe to ship, 1 evidence changed.
process.exit(summary.evidenceChanged ? 1 : 0);
