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

/**
 * Pairs where the feature's ABSENCE is what the subtype means, so no page can ever carry both.
 *
 * `3.3.1:validation-error-silent` is a page that submits a form and hears NO error. It cannot also carry
 * `validation_error_announced` — that is the conformant behaviour whose absence defines the failure. A
 * negative weight there is correct inference, not a free veto, and no amount of corpus work changes it.
 *
 * Without this the audit reported them alongside the fixable ones, so the work list contained items nobody
 * could complete. Measured 2026-08-23: 55 starved pairs, of which these are structurally impossible — and
 * the two features heading the "work list" ranking, `status_update_announced` and
 * `validation_error_announced`, each counted two subtypes that can never carry them.
 *
 * A LIST, not a rule, because the relationship is semantic: it is what the subtype's name asserts. Each
 * entry says which announcement the failure consists of NOT hearing.
 */
const IMPOSSIBLE_BY_DEFINITION = Object.freeze({
  "3.3.1:validation-error-silent": ["validation_error_announced", "status_update_announced"],
  "4.1.3:form-activation-silent": ["status_update_announced", "validation_error_announced"],
  "4.1.2:state-change-silent": ["state_changed"],
  "2.4.1:skip-link-inert": ["skip_link_moves_focus"],
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
  // The INVERSE, and the direction that was missing. `unmatched` finds records whose case has gone —
  // a rename or a deletion. It cannot see the far commoner staleness: an export that PREDATES cases which
  // now exist, where every record it holds is perfectly valid and hundreds simply are not there.
  //
  // Measured 2026-08-23: this printed `1868 exported records; 0 whose case is no longer defined` and a full
  // starvation table, while the lab's export held 2282 records from the same commit. Every number in that
  // table was computed on two thirds of the corpus and none of it said so. `runs/` is gitignored, so a
  // working copy is only ever as fresh as its last sync — the same trap that had `check-signals` reporting
  // 860 stale locally and 0 on the lab.
  const represented = new Set(records.map((r) => r.provenance.caseId));
  const missing = [...furniture.keys()].filter((id) => !represented.has(id)).length;
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
        && positives.every((row) => !row.values[name])
        // Not a shortcut when the subtype is DEFINED by not hearing it. Reporting those put items on a
        // work list that nobody can complete, and inflated the two features at the top of the ranking.
        && !(IMPOSSIBLE_BY_DEFINITION[subtype] ?? []).includes(name)),
      impossible: (IMPOSSIBLE_BY_DEFINITION[subtype] ?? [])
        .filter((name) => positives.every((row) => !row.values[name])),
    };
  }).filter(Boolean);
  // A feature almost nothing carries is EXCLUDED from the starvation table above by
  // MIN_CORPUS_OCCURRENCES, on the reasoning that a rare feature cannot be a shortcut. True — and it means
  // the audit looks away from the one thing that distinguishes a rare feature from a BROKEN EXTRACTOR.
  //
  // `vague_link_present` sat at 5% of records for the life of the project because `link_name` anchored the
  // role at the start of the phrase and NVDA almost never puts it there. This audit dropped it as too rare
  // to mention; `scorer:shortcuts` reported it as a corpus-starvation veto. Both fit the evidence and only
  // one was true, and six held-out acceptance failures came of the difference.
  //
  // Reported, never failed: rarity is suspicious, not wrong. `test_extractor_coverage.py` is the guard that
  // can actually decide, by asking what fraction of announcements naming a role the extractor can read.
  const rare = names
    .filter((name) => occurrences[name] > 0 && occurrences[name] < MIN_CORPUS_OCCURRENCES)
    .map((name) => ({ name, count: occurrences[name] }))
    .sort((a, b) => a.count - b.count);
  return { starved, rare, unmatched, missing, defined: furniture.size, records: rows.length };
}

function render({ starved, rare, unmatched, missing, defined, records }) {
  const total = starved.reduce((sum, row) => sum + row.features.length, 0);
  process.stdout.write(`\n  ${records} exported records; ${unmatched} whose case is no longer defined.\n`);
  if (unmatched > 0) {
    process.stdout.write("  Those get NO furniture applied, so their subtypes may read as starved when they "
      + "are merely stale — re-export.\n");
  }
  if (missing > 0) {
    process.stdout.write(`  ${missing} of ${defined} defined case(s) have NO record here, so this export `
      + "predates them and every count below is computed on part of the corpus.\n"
      + "  Re-export, or ask the box that owns it:  npm run lab:job -- -e job=export\n");
  }
  if (rare.length) {
    process.stdout.write(`\n  ${rare.length} feature(s) fire on fewer than ${MIN_CORPUS_OCCURRENCES} `
      + "records, so they are EXCLUDED from the table below and cannot be judged here.\n"
      + "  Rare and correct, or an extractor that cannot read its own evidence? This audit cannot tell:\n");
    for (const { name, count } of rare.slice(0, 8)) {
      process.stdout.write(`    ${name.padEnd(34)} ${String(count).padStart(5)} record(s)\n`);
    }
    process.stdout.write("  `pytest packages/scorer/tests/test_extractor_coverage.py` is the check that "
      + "decides.\n");
  }

  const impossible = starved.reduce((sum, row) => sum + (row.impossible?.length ?? 0), 0);
  if (impossible) {
    process.stdout.write(`\n  ${impossible} starved pair(s) are IMPOSSIBLE BY DEFINITION and excluded below: `
      + "the subtype\n  is the absence of that announcement, so no page can carry both and the negative "
      + "weight is\n  correct inference rather than a free veto. Nothing to build.\n");
    for (const row of starved.filter((r) => r.impossible?.length)) {
      process.stdout.write(`    ${row.subtype.padEnd(34)} ${row.impossible.join(", ")}\n`);
    }
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
  process.stdout.write("\n  See docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md for what each group needs. Furniture cannot supply a feature\n"
    + "  that is itself a FAILURE — those need a page that fails twice.\n\n");
}

// Guarded, so importing this module cannot run it. `entry-points.test.ts` asserts it across every npm
// script: a program that acts on import cannot be unit-tested, and one that shells out on import is worse.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (existsSync(RECORDS)) render(starvation());
  else process.stdout.write(`  no exported corpus at ${RECORDS} — run \`npm run training:export\` first.\n`);
}

export { starvation, GRANTS };
