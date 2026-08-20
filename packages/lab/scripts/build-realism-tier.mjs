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

import { evidenceUnits, captureEvidenceText, producerFeedsModel } from "@a11y-witness/scorer/evidence-units";
import { realPageFor } from "../src/training/real-page-corpus.mjs";
import { captureWasTruncated } from "@a11y-witness/evidence/verify";

// Resolved from this module, so the script works from any directory. `--out=` is still taken relative to
// the repo root rather than the cwd, so two runs from different shells cannot write to two places.
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORPUS = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
const BASE = resolve(REPO, "runs/screenreader-dataset/screenreader-evidence.jsonl");
const OUT = resolve(REPO,
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? "runs/screenreader-dataset/with-realism.jsonl");

// Channels come from `@a11y-witness/scorer/evidence-units` -- imported at the top -- and are NOT redefined
// here. This file used to carry its own table, and the two disagreed in three separate ways at once:
//
//   channel names   `read-through` vs `transcript`, `form-field-navigation` vs `form-navigation`,
//                   `post-submit-fields` vs `post-submit-navigation`
//   membership      `control-navigation` missing; `landmark`/`link`/`list`/`graphic-navigation` invented
//   evidenceText    built as `[channel] text` when every other producer joins text alone (`score.py:103`)
//
// The featurizer embeds `f"{channel}: {text}"`, so four channel tokens appeared only on real records and
// three only on synthetic ones -- a linear head could separate the two populations on channel names alone.
// A systematic shortcut feature, in the corpus meant to REMOVE shortcut features.
//
// The docblock that used to sit here stated the requirement exactly: "the channel names must match the
// generator's exactly or the realism records are featurised into different channels from the 2,002 they
// join, and nothing would report that." It was right, and it was above the table that broke it. The
// duplication was the defect; the mismatch was only its symptom.

/**
 * The training captures whose MODEL-VISIBLE evidence is complete, rejecting the rest out loud.
 *
 * Rejects rather than warns, because truncation and absence are the same bytes. A capture whose heading
 * sweep starved reports the headings it reached, and a record built from it teaches the scorer that a real
 * page has that many headings -- which is how "real pages have no lists" becomes a learned feature. That is
 * the exact spurious correlation a real-page corpus exists to remove, so it cannot be left to a human
 * noticing a WARNING line.
 *
 * Scoped to the channels the model reads (`producerFeedsModel`). Unscoped, ALL 26 captures in this corpus
 * are truncated somewhere -- `link`, `list` and `graphic` sweeps starve first on a big page and none of them
 * is a model input, so gating on them would discard everything for evidence nobody consumes. Scoped, 5 of
 * 19 training captures survive. That number is the honest state of the corpus, not a knob: the dominant
 * reason is `read-through:capped`, i.e. the 150-line `DEFAULT_STEPS` cap, which was sized for the generated
 * corpus and truncates the transcript of most real pages.
 */
function completeCaptures(entries) {
  const rejected = [];
  const usable = entries.filter((entry) => {
    const gaps = captureWasTruncated(entry.capture?.diagnostics).filter((g) => producerFeedsModel(g.channel));
    if (!gaps.length) return true;
    rejected.push({ url: entry.capture?.url ?? "(no url recorded)", gaps });
    return false;
  });
  for (const { url, gaps } of rejected) {
    const named = [...new Set(gaps.map((g) => `${g.channel}:${g.kind}`))].sort().join(" ");
    process.stdout.write(`  REJECTED (truncated) ${url}\n      ${named}\n`);
  }
  return { usable, rejected };
}

/**
 * What the publisher of this captured page does NOT claim.
 *
 * THROWS on a failed join rather than returning `[]`. A url that has drifted -- a redirect, a publisher
 * restructuring, a slug change -- would otherwise produce an unmasked page indistinguishable from a
 * publisher with nothing to disclose, which is precisely the bug this replaces.
 */
function claimExcludesFor(entry) {
  const url = entry.capture?.url;
  const page = url ? realPageFor(url) : undefined;
  if (!page) {
    throw new Error(
      `captured page ${url ?? "(no url)"} is not in real-page-corpus.mjs, so its publisher's claim cannot `
      + "be read. Refusing to treat that as \"no exceptions\": an unmasked page trains every head as "
      + "conformant, including criteria the publisher may state in writing that it fails.");
  }
  return page.claimExcludes ?? [];
}

/**
 * The mask, VISIBLE. It was inert for its whole existence and nothing said so, because an empty mask and a
 * broken join print the same nothing. A count per page is the cheapest thing that could have caught it.
 */
function reportMasks(records) {
  const masks = records
    .map((r) => [r.provenance.url, r.target.unknownSubtypes.length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  process.stdout.write(`  publisher exceptions honoured: ${masks.length} of ${records.length} page(s)\n`);
  for (const [url, n] of masks.slice(0, 8)) {
    process.stdout.write(`    ${n} head(s) masked  ${url}\n`);
  }
  if (masks.length > 8) process.stdout.write(`    ... and ${masks.length - 8} more\n`);
}

/** One capture, as a training record. The channel contract and the publisher's claim both come from
 * elsewhere on purpose -- see the imports. */
function recordFor(entry) {
    const capture = entry.capture;
    const units = evidenceUnits(capture);
    return {
      input: {
        screenReader: capture.screenReader ?? "NVDA",
        transcript: capture.transcript ?? [],
        structure: capture.structure ?? {},
        interaction: capture.interaction ?? {},
        evidenceUnits: units,
        evidenceText: captureEvidenceText(capture),
      },
      // The SOURCE's claim, carried verbatim. `clean` because W3C publishes these pages as conforming; if
      // that is ever wrong, it is wrong in W3C's documentation and not in our labelling.
      // `unknownSubtypes` carries what the publisher did NOT claim. Empty for W3C, whose statement is a
      // site-wide WCAG 2 AA conformance claim covering every criterion we score -- so `clean` here is the
      // source's assertion, not our inference. A partially-compliant publisher populates it from
      // `claimExcludes`, and those records then train no head for which the source said nothing.
      //
      // Joined from the CORPUS, not read off the capture. This line was `entry.claimExcludes ?? []` and the
      // captured file has no such field -- `capture-real-pages.mjs` writes six keys and that is not one of
      // them -- so every record got `[]` and every masked head trained the page as clean. The mask existed,
      // was documented, and never once ran. `?? []` is what made it silent: the join failing and the
      // publisher having no exceptions produced identical output.
      target: {
        label: "clean", criteria: [], subtypes: [],
        unknownSubtypes: claimExcludesFor(entry),
      },
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
}

function main() {
  const entries = readdirSync(CORPUS)
    .filter((f) => f.endsWith(".json") && f !== "abstention-sweep.json")
    .map((f) => JSON.parse(readFileSync(resolve(CORPUS, f), "utf8")))
    .filter((e) => e.role === "training");

  // No real-page captures is a legitimate state -- a fresh checkout has none -- so this writes the base
  // dataset through rather than failing. It says so LOUDLY, because a script that silently produced a
  // dataset with no realism tier would let someone ship a model that abstains on every real page while
  // believing they had built the one that does not.
  if (!entries.length) {
    process.stdout.write(`  NO REALISM TIER: ${CORPUS} holds no training-role captures, so the output is the\n`
      + `  base dataset unchanged. A model trained on this will ABSTAIN on real pages. Capture the\n`
      + `  real-page corpus first: node packages/lab/src/training/capture-real-pages.mjs --role=training\n`);
    writeFileSync(OUT, readFileSync(BASE, "utf8"));
    process.stdout.write(`  written: ${OUT} (base only)\n`);
    return;
  }

  const { usable, rejected } = completeCaptures(entries);
  if (!usable.length) {
    process.stderr.write(`every training capture in ${CORPUS} is truncated on a channel the model reads. `
      + `Recapture before building a realism tier -- see the budget ladder in capture-real-pages.mjs.\n`);
    process.exit(2);
  }

  const records = usable.map(recordFor);

  const base = readFileSync(BASE, "utf8").trimEnd().split("\n");
  writeFileSync(OUT, [...base, ...records.map((r) => JSON.stringify(r))].join("\n") + "\n");

  process.stdout.write(`  base records:     ${base.length}\n`);
  process.stdout.write(`  realism records:  ${records.length}  (all label=clean, from W3C's own claim)\n`);
  process.stdout.write(`  written:          ${OUT}\n`);
  process.stdout.write(`  median units/rec: ${median(records.map((r) => r.input.evidenceUnits.length))}\n`);
  process.stdout.write(`  rejected as truncated: ${rejected.length} of ${entries.length}\n`);
  reportMasks(records);
  // A real page with two evidence units would mean the capture failed, not that the page is simple. Kept as
  // a warning rather than promoted to a reject: the truncation gate above is the principled check, and this
  // is a backstop for a capture that failed in a way no sweep recorded.
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
