/**
 * Does a conformant page become a FAILURE when you add more conformant content to it?
 *
 * ## What this was built to test, and what it found
 *
 * The hypothesis: the scorer decides per PAGE by pooling a bag of announcements, every pooling rule it uses
 * is a function of bag size, and the bag sizes barely overlap between training and deployment. Measured
 * over every capture on disk, that last part is TRUE and remains true:
 *
 *     announcements per capture   CORPUS  min 3  median 18   max 43
 *                                 REAL    min 8  median 253  max 805
 *
 * The corpus MAXIMUM is below the real-page 25th percentile. It is a real and large distribution shift.
 *
 * **But it is NOT what drives the false accusations, and this audit is how that was established.** Padding
 * 40 conformant pages with conformant content, at 20/50/100/200/400 announcements, produced ZERO
 * accusations at every size — 200 trials. The page verdict does not depend on how much conformant content
 * the page carries.
 *
 * An earlier run reported 3 accusations at 12 bases. That was an instrument fault, not a finding: the donor
 * pool was `slice(BASES)`, so changing the number of bases changed the padding CONTENT too and the two runs
 * were different experiments. Fixed below; the corrected instrument reports STABLE.
 *
 * Recorded in full because a measurement that refutes the thing it was built for is the most useful kind,
 * and the temptation is to keep the tool and quietly drop the finding. The distribution shift is real; the
 * mechanism inferred from it was wrong.
 *
 * ## What the false accusations DO track
 *
 * Not size, but WHICH LAYER OWNS THE QUESTION. Every false accusation this week came from a model-decided
 * JUDGEMENT subtype (2.4.4 vague link, 1.3.1 fake-heading, 1.3.1 unassociated-table). Not one came from a
 * rule-decided FACT subtype — those score 224/224 and 174/174 EXACT with 0 false positives across 1,183
 * conformant records. The scorer is 13 logistic regressions on a frozen encoder, 416 parameters per head
 * against 3 to 224 positives, and a linear model cannot represent the conjunction that judgement is.
 *
 * ## The experiment
 *
 * Take a conformant capture. Pad it with announcements drawn from OTHER conformant captures, so every added
 * line is benign by construction. Score it at increasing sizes. A verdict that depends only on the page
 * cannot change; a verdict that depends on bag size will trip.
 *
 * Keep it: it is cheap, needs no worker time, and it is the only check here that can see a size effect at
 * all — so it is what would catch one if a future pooling change introduces it.
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
