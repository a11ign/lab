/**
 * Turn the real-page corpus's TRAINING split into training records — the realism tier (ADR 0009/0010).
 *
 *   node packages/lab/scripts/build-realism-tier.mjs [--out=runs/screenreader-dataset/with-realism.jsonl]
 *
 * ## Why, specifically
 *
 * This is not "more data is nice". It targets a measured defect. `calibrate-abstention.mjs` showed that if
 * the abstention floor were lowered to accept real pages, the scorer would accuse **3 of 4 pages W3C
 * publishes as conformant** while catching **0 of 3** it publishes as inaccessible. On real pages its output
 * is anti-correlated with the truth.
 *
 * The most likely reason is the plainest one: it has never seen a real page. Every training record is
 * generated, so real navigation, real footers, code samples inside prose and genuine heading depth all look
 * like novelty — and a linear head on a frozen embedding reads novelty as signal.
 *
 * So the 19 tutorial pages go in labelled **clean**, which is what W3C publishes about them, and the
 * hypothesis is directly testable: false positives on the HELD-OUT calibration pages should fall.
 *
 * ## What makes this safe to do at all
 *
 *   - The 7 CALIBRATION pages are excluded. They are the measurement, and training on them would destroy
 *     the only independent read we have — the same rule that keeps the eval fixtures out of both.
 *   - The label is the SOURCE's claim, not ours. W3C states its site conforms to WCAG 2 AA; each tutorial
 *     page also demonstrates the technique it names. We decide nothing.
 *   - The original dataset is never modified. This writes a NEW file, so a retrain can be compared against
 *     the shipped model and reverted by deleting one path.
 *
 * ## The honest risk
 *
 * Nineteen real pages against 2,002 generated ones is a small fraction, and adding them will raise real
 * pages' novelty scores — which means the model will start ACCEPTING pages it used to decline. That is only
 * an improvement if its accuracy on them improves too. If novelty rises while the false positives stay,
 * the tier has made things WORSE by removing the abstention that was protecting us. Measure before shipping:
 * retrain to a scratch output, then re-run the sweep on the calibration split.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this module, so the script works from any directory. `--out=` is still taken relative to
// the repo root rather than the cwd, so two runs from different shells cannot write to two places.
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORPUS = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
const BASE = resolve(REPO, "runs/screenreader-dataset/screenreader-evidence.jsonl");
const OUT = resolve(REPO,
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? "runs/screenreader-dataset/with-realism.jsonl");

/**
 * Which capture field feeds which evidence channel. A table rather than a run of `push` calls: the
 * channel names must match the generator's exactly or the realism records are featurised into different
 * channels from the 2,002 they join, and nothing would report that — the featurizer would simply see
 * channels it had never been trained on.
 */
const STRUCTURE_CHANNELS = [
  ["heading-navigation", "headings"],
  ["landmark-navigation", "landmarks"],
  ["form-field-navigation", "formFields"],
  ["link-navigation", "links"],
  ["list-navigation", "lists"],
  ["graphic-navigation", "graphics"],
  ["table-cell-navigation", "tableCells"],
];

/** Interaction fields carry a before/after pair, so they read as "control -> what was announced". */
const CHANGE_CHANNELS = [
  ["state-change", "stateChanges"],
  ["form-change", "formChanges"],
];

/** The evidence-unit shape the featurizer expects, built the same way the generator builds it. */
function evidenceUnits(capture) {
  const units = [];
  const push = (channel, values) => {
    for (const text of values ?? []) if (text) units.push({ channel, text });
  };
  push("read-through", capture.transcript);
  for (const [channel, field] of STRUCTURE_CHANNELS) push(channel, capture.structure?.[field]);
  push("post-submit-fields", capture.interaction?.postSubmitFields);
  for (const [channel, field] of CHANGE_CHANNELS) {
    for (const change of capture.interaction?.[field] ?? []) {
      if (change?.after) units.push({ channel, text: `${change.control} -> ${change.after}` });
    }
  }
  return units;
}

function main() {
  const entries = readdirSync(CORPUS)
    .filter((f) => f.endsWith(".json") && f !== "abstention-sweep.json")
    .map((f) => JSON.parse(readFileSync(resolve(CORPUS, f), "utf8")))
    .filter((e) => e.role === "training");

  if (!entries.length) {
    process.stderr.write(`no TRAINING-role captures in ${CORPUS}\n`);
    process.exit(2);
  }

  const records = entries.map((entry) => {
    const capture = entry.capture;
    const units = evidenceUnits(capture);
    return {
      input: {
        screenReader: capture.screenReader ?? "NVDA",
        transcript: capture.transcript ?? [],
        structure: capture.structure ?? {},
        interaction: capture.interaction ?? {},
        evidenceUnits: units,
        evidenceText: units.map((u) => `[${u.channel}] ${u.text}`).join("\n"),
      },
      // The SOURCE's claim, carried verbatim. `clean` because W3C publishes these pages as conforming; if
      // that is ever wrong, it is wrong in W3C's documentation and not in our labelling.
      target: { label: "clean", criteria: [], subtypes: [] },
      provenance: {
        realismTier: true,
        // `family` is REQUIRED, and it groups records so the split cannot separate pages that share a
        // template. Derived from the tutorial topic (`images`, `tables`, `forms`, ...) for exactly the
        // reason the corpus split calibration and training by source family: `images/decorative` and
        // `images/informative` share navigation, a footer and a page shell, so putting one in training and
        // the other in a hold-out would measure the model against structure it had already seen.
        family: `realism-${new URL(capture.url).pathname.split("/").filter(Boolean)[2] ?? "misc"}`,
        caseId: new URL(capture.url).pathname.replace(/\/+$/, "").split("/").slice(-2).join("-"),
        variant: "good",
        url: capture.url,
        publishedClaim: entry.publishedClaim,
        claimSource: entry.claimSource,
        demonstrates: entry.demonstrates,
        capturedAt: entry.capturedAt,
      },
    };
  });

  const base = readFileSync(BASE, "utf8").trimEnd().split("\n");
  writeFileSync(OUT, [...base, ...records.map((r) => JSON.stringify(r))].join("\n") + "\n");

  process.stdout.write(`  base records:     ${base.length}\n`);
  process.stdout.write(`  realism records:  ${records.length}  (all label=clean, from W3C's own claim)\n`);
  process.stdout.write(`  written:          ${OUT}\n`);
  process.stdout.write(`  median units/rec: ${median(records.map((r) => r.input.evidenceUnits.length))}\n`);
  // A real page with two evidence units would mean the capture failed, not that the page is simple.
  const thin = records.filter((r) => r.input.evidenceUnits.length < 5);
  if (thin.length) {
    process.stdout.write(`  WARNING: ${thin.length} record(s) have fewer than 5 evidence units — check the `
      + `capture before training on them:\n`);
    for (const r of thin) process.stdout.write(`    ${r.provenance.url}\n`);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

main();
