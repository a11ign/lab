/**
 * Does a conformant page become a FAILURE when you add more conformant content to it?
 *
 * ## The question, and why nothing else asks it
 *
 * The scorer decides per PAGE by pooling a bag of announcements. Every pooling rule it uses is a function
 * of bag size:
 *
 *   - instance-max (`fake-heading`, `unnamed-control`, `unnamed-form-field`): the page-level false-alarm
 *     rate is 1-(1-p)^n. At a per-instance p of 0.5%, that is 3% at n=6 and 73% at n=261.
 *   - document-mean with document-level binaries (`vague_link_present`): "does this page contain one" has a
 *     base rate that climbs with page size until it is true of nearly every real page.
 *
 * And the bag sizes do not overlap. Measured over every capture on disk:
 *
 *     announcements per capture   CORPUS  min 3  median 18   max 43
 *                                 REAL    min 8  median 253  max 805
 *
 * The corpus MAXIMUM is below the real-page 25th percentile. So the decision rule is calibrated in a regime
 * that barely intersects the one it runs in — and training, held-out acceptance, `rules:gate`,
 * `check-signals` and `scorer:shortcuts` ALL run on corpus pages, so every one of them is blind to this by
 * construction. The abstention floor does not help either: it asks whether a page is like training data in
 * EMBEDDING space, not whether the bag is the size the thresholds were calibrated for. GOV.UK scored 0.79,
 * comfortably in support, and was accused anyway.
 *
 * That is why each fix this week MOVED the failure rather than removing it. Fixing vague-link surfaced
 * fake-heading; fixing tables surfaced 2.4.4. We kept repairing whichever feature happened to trip and
 * never the aggregation rule that makes tripping likely.
 *
 * ## The experiment
 *
 * Take a conformant capture. Pad it with announcements drawn from OTHER conformant captures, so every added
 * line is benign by construction. Score it at increasing sizes. A verdict that depends only on the page
 * cannot change; a verdict that depends on bag size will eventually trip.
 *
 * Needs no worker time and no new captures: it is a pure function of evidence already on disk.
 *
 * ## Reading the result
 *
 * A finding that appears only after padding is a FALSE ACCUSATION the corpus can never show you, because no
 * corpus page is big enough to produce one. The count at each size is the false-alarm rate at that bag size.
 *
 *   npm run scorer:size-sensitivity
 *   npm run scorer:size-sensitivity -- --model=runs/model-candidate
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";

import { annotateCapture } from "@a11y-witness/evidence";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CAPTURES = resolve(REPO, process.env.CAPTURE_ROOT || "runs/screenreader-dataset/captures");
const PYTHON = process.env.A11Y_PYTHON || resolve(REPO, ".venv/bin/python");
const SCORER = resolve(REPO, "packages/scorer/python/score.py");
const MODEL = process.argv.find((a) => a.startsWith("--model="))?.slice("--model=".length);

/** Bag sizes to probe, spanning the corpus range into the real-page range. */
const SIZES = [20, 50, 100, 200, 400];

/** How many base pages to pad. Enough that one odd page cannot carry the verdict. */
const BASES = Number(process.env.SIZE_BASES || 12);

/**
 * Deterministic, because a size audit that reports a different number every run cannot gate anything.
 * `Math.random` would also make a regression indistinguishable from a reroll.
 */
function* deterministicOrder(items, seed = 7) {
  let state = seed;
  const pool = [...items];
  while (pool.length) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    yield pool.splice(state % pool.length, 1)[0];
  }
}

const isString = (v) => typeof v === "string";

function conformantCaptures() {
  const files = readdirSync(CAPTURES).filter((f) => f.endsWith(".good.json")).sort();
  const loaded = [];
  for (const file of files) {
    try {
      const capture = JSON.parse(readFileSync(join(CAPTURES, file), "utf8"));
      if ((capture.transcript ?? []).filter(isString).length > 0) loaded.push({ file, capture });
    } catch {
      // A capture that will not parse is not this audit's business; `verify.corpus.test.ts` owns that.
      continue;
    }
  }
  return loaded;
}

/**
 * A conformant page grown to `size` announcements with lines from OTHER conformant pages.
 *
 * Padding is drawn from conformant captures ONLY, so nothing added can carry a defect. That is what makes a
 * new finding attributable to size rather than to content — the whole design of the control.
 */
function paddedTo(base, donors, size) {
  const lines = [...(base.capture.transcript ?? []).filter(isString)];
  for (const donor of donors) {
    if (lines.length >= size) break;
    for (const line of (donor.capture.transcript ?? []).filter(isString)) {
      if (lines.length >= size) break;
      lines.push(line);
    }
  }
  return { ...base.capture, transcript: lines };
}

function findingsFor(capture) {
  const args = [SCORER, "--stdin", ...(MODEL ? ["--model", MODEL, "--evaluating"] : [])];
  const out = JSON.parse(execFileSync(PYTHON, args, {
    input: JSON.stringify(annotateCapture(capture)), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }));
  const predictions = out.records?.[0]?.predictions ?? {};
  return Object.entries(predictions).filter(([, hit]) => hit).map(([criterion]) => criterion);
}

function main() {
  const all = conformantCaptures();
  if (all.length < BASES * 2) {
    process.stderr.write(`only ${all.length} conformant captures under ${CAPTURES}; this audit needs a corpus.\n`);
    process.exit(2);
  }
  // The donor pool is FIXED, never `slice(BASES)`.
  //
  // It was the tail after the bases, so changing `BASES` changed the padding CONTENT too — and the audit
  // reported 3 accusations at 12 bases and 0 at 40, which reads as a size effect disappearing when it is
  // really two different experiments. An instrument whose answer depends on a knob that should not affect
  // it cannot support either answer.
  //
  // Bases are taken from the front and donors from the BACK, so the two never overlap and neither moves
  // when the other grows.
  const ordered = [...deterministicOrder(all)];
  const DONORS = 60;
  const donors = ordered.slice(-DONORS);
  const bases = ordered.slice(0, BASES);
  if (bases.length + donors.length > ordered.length) {
    process.stderr.write(`corpus too small: ${BASES} bases and ${DONORS} donors need `
      + `${BASES + DONORS} distinct captures, and only ${ordered.length} exist.\n`);
    process.exit(2);
  }

  process.stdout.write(`\n  Padding ${BASES} CONFORMANT pages with CONFORMANT content, and asking whether\n`
    + `  they become failures. Model: ${MODEL ?? "shipped"}\n\n`);
  process.stdout.write("  bag size   pages accused   criteria raised\n");

  const rows = [];
  for (const size of SIZES) {
    const raised = new Map();
    let accused = 0;
    for (const base of bases) {
      const findings = findingsFor(paddedTo(base, donors, size));
      if (findings.length) accused += 1;
      for (const criterion of findings) raised.set(criterion, (raised.get(criterion) ?? 0) + 1);
    }
    rows.push({ size, accused, raised });
    const detail = [...raised.entries()].sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}×${n}`).join(" ") || "-";
    process.stdout.write(`  ${String(size).padEnd(10)} ${String(`${accused}/${BASES}`).padEnd(15)} ${detail}\n`);
  }

  report(rows);
}

function report(rows) {
  const smallest = rows[0];
  const largest = rows[rows.length - 1];
  process.stdout.write(`\n  Every line added is from a page with NO defect, so a finding that appears only at\n`
    + `  a larger size is a false accusation caused by SIZE, not by the page.\n`);

  if (largest.accused > smallest.accused) {
    process.stdout.write(`\n  SIZE-DEPENDENT: ${smallest.accused}/${rows[0].size ? largest.accused : 0} — accusations rise from `
      + `${smallest.accused} at ${smallest.size} announcements to ${largest.accused} at ${largest.size}.\n`
      + `  The corpus cannot show you this: its largest page is 43 announcements, below the 25th percentile\n`
      + `  of real pages (149). Every other gate runs on corpus pages and is blind to it by construction.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("\n  STABLE — the verdict does not depend on how much conformant content the page carries.\n");
}

// Guarded, so importing this module cannot spawn the scorer once per page.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

export { paddedTo, deterministicOrder };
