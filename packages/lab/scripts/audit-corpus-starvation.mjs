/**
 * Which features will the corpus STARVE — asked of the case definitions, before any capture.
 *
 * `npm run scorer:shortcuts` measures free vetoes in trained weights: features a head penalises at no cost
 * because they are 0 on every one of its training positives. That is the right measurement and it arrives
 * too late — after a corpus run, an export and a train.
 *
 * This asks the same question of the inputs. A feature that no positive of a subtype carries is one the
 * head may penalise for free, and whether that is true is decided by the pages, not by the training. So it
 * is knowable now: take the exported records for their LABELS and their capture-derived features, then
 * apply the feature effect of the page furniture the current case definitions would produce.
 *
 * Measured 2026-08-22, which is why it exists: the furniture added for ADR 0015 takes the starved pairs
 * from 263 to 209 — a sixth, where the splice probe in `compose-multi-defect-probe.py` reached 113. The
 * gap is entirely features that furniture CANNOT supply:
 *
 *   - a conformant state change   -> a disclosure widget would fix it (209 -> 178, modelled)
 *   - form-submission evidence    -> needs `probeForms`, which is a per-case cost, not furniture
 *   - other criteria's DEFECTS    -> vague links, generic headings, unnamed graphics, position-only table
 *                                    cells. No conformant page carries these because they ARE failures, so
 *                                    only a page that fails twice can supply them.
 *
 * Read it as a work list, not a gate. It says what the next corpus change has to reach.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { CASES } from "../src/training/case-matrix.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const RECORDS = resolve(REPO, process.env.DATASET_EXPORT
  ?? "runs/screenreader-dataset/screenreader-evidence.jsonl");
const PYTHON = process.env.A11Y_PYTHON || resolve(REPO, ".venv/bin/python");

/**
 * What each furniture piece grants, read off REAL captures of the same markup rather than from the feature
 * definitions — the featurizer decides these, and restating its rules here would be a second copy that
 * drifts. Sources: `table-bulk-aquarium-001.good`, `form-placeholder-calibration-aquarium-001.good`,
 * `disclosure-state-calibration-aquarium-001.good`.
 */
const GRANTS = Object.freeze({
  namedField: ["form_field_named", "form_field_present"],
  dataTable: ["table_present", "table_data_row_present", "table_header_associated"],
  disclosure: ["state_change_present", "state_changed", "control_present"],
});

/** A feature absent from the positives is only a shortcut if it is COMMON elsewhere — same rule as the
 * weights-side audit, so the two numbers describe the same thing. */
const MIN_CORPUS_OCCURRENCES = 50;
/** Below this a subtype has too few positives for "none of them carry it" to mean anything. */
const MIN_POSITIVES = 20;

/** The furniture a case will actually get, read from its GENERATED HTML rather than recomputed. */
function furnitureOf() {
  const carries = (testCase, marker) => marker.test(testCase.good) && marker.test(testCase.bad);
  return new Map(CASES.map((testCase) => [testCase.id, {
    namedField: carries(testCase, /Reference lookup/),
    dataTable: carries(testCase, /Reference notes index/),
    disclosure: carries(testCase, /Reference notes archive/),
  }]));
}

function featureValues(path) {
  const script = "import json,sys; sys.path.insert(0,'packages/scorer/python');\n"
    + "import screenreader_features as F;\n"
    + "print(json.dumps([F.structured_feature_values(json.loads(l)) for l in open(sys.argv[1]) if l.strip()]))";
  return JSON.parse(execFileSync(PYTHON, ["-c", script, path],
    { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
}

function starvation() {
  const records = readFileSync(RECORDS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const values = featureValues(RECORDS);
  const furniture = furnitureOf();
  const rows = records.map((record, index) => {
    const applied = { ...values[index] };
    const kit = furniture.get(record.provenance.caseId) ?? {};
    for (const [piece, granted] of Object.entries(GRANTS)) {
      if (kit[piece]) for (const name of granted) applied[name] = 1;
    }
    return { values: applied, subtypes: new Set(record.target?.subtypes ?? []) };
  });
  const unmatched = records.filter((r) => !furniture.has(r.provenance.caseId)).length;
  const names = Object.keys(values[0]);
  const occurrences = Object.fromEntries(
    names.map((name) => [name, rows.filter((row) => row.values[name]).length]));
  const subtypes = [...new Set(rows.flatMap((row) => [...row.subtypes]))].sort();
  const starved = subtypes.map((subtype) => {
    const positives = rows.filter((row) => row.subtypes.has(subtype));
    if (positives.length < MIN_POSITIVES) return null;
    return {
      subtype,
      positives: positives.length,
      features: names.filter((name) => occurrences[name] >= MIN_CORPUS_OCCURRENCES
        && positives.every((row) => !row.values[name])),
    };
  }).filter(Boolean);
  return { starved, unmatched, records: rows.length };
}

function render({ starved, unmatched, records }) {
  const total = starved.reduce((sum, row) => sum + row.features.length, 0);
  process.stdout.write(`\n  ${records} exported records; ${unmatched} whose case is no longer defined.\n`);
  if (unmatched > 0) {
    process.stdout.write("  Those get NO furniture applied, so their subtypes may read as starved when they "
      + "are merely stale — re-export.\n");
  }
  process.stdout.write("\n  Features that no positive of a subtype carries, so a head could penalise them free:\n\n");
  process.stdout.write(`  ${"subtype".padEnd(32)} ${"pos".padStart(5)} ${"starved".padStart(8)}  worst\n`);
  process.stdout.write(`  ${"-".repeat(80)}\n`);
  for (const row of starved) {
    process.stdout.write(`  ${row.subtype.padEnd(32)} ${String(row.positives).padStart(5)} `
      + `${String(row.features.length).padStart(8)}  ${row.features.slice(0, 3).join(", ")}\n`);
  }
  const byFeature = {};
  for (const row of starved) for (const name of row.features) byFeature[name] = (byFeature[name] ?? 0) + 1;
  process.stdout.write(`\n  ${total} starved feature/subtype pairs across ${starved.length} subtypes.\n`);
  process.stdout.write("\n  The work list — features by how many subtypes they starve:\n\n");
  for (const [name, count] of Object.entries(byFeature).sort((a, z) => z[1] - a[1]).slice(0, 14)) {
    process.stdout.write(`    ${name.padEnd(34)} ${count}\n`);
  }
  process.stdout.write("\n  See docs/adr/0015 for what each group needs. Furniture cannot supply a feature\n"
    + "  that is itself a FAILURE — those need a page that fails twice.\n\n");
}

// Guarded, so importing this module cannot run it. `entry-points.test.ts` asserts it across every npm
// script: a program that acts on import cannot be unit-tested, and one that shells out on import is worse.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (existsSync(RECORDS)) render(starvation());
  else process.stdout.write(`  no exported corpus at ${RECORDS} — run \`npm run training:export\` first.\n`);
}

export { starvation, GRANTS };
