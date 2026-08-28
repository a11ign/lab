// @ts-check
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
import { MODEL_EXCLUDED_SUBTYPES } from "../src/training/export-screenreader-dataset.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * takes no flags: it reads the corpus on disk and reports which features are constant across a
 * subtype's positives.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run corpus:starvation" });

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
/** @type {Record<string, any>} */
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

// Lower than MIN_CORPUS_OCCURRENCES (50), because a monopoly does not need to be common to be harmful. It
// needs to be REACHABLE on a real page, and "details" reached eleven GOV.UK pages while appearing on 17
// records here.
const MIN_MONOPOLY_OCCURRENCES = 10;

/**
 * Features decided by a hand-written VOCABULARY, and therefore the actionable half of a monopoly.
 *
 * A monopoly is only a defect when the feature can be true on a conforming page, and that is exactly what
 * separates these from the rest. `unnamed_graphic_present` is a monopoly because an unnamed graphic IS the
 * failure — no corpus change can or should give it a conformant example. `vague_link_present` is a monopoly
 * because the corpus only ever uses "details" in the failing sense, and English does not.
 *
 * Listing them beats inferring it: a work list nobody can complete is what `IMPOSSIBLE_BY_DEFINITION` was
 * added to stop, and this is the same mistake one sign over. Keep this in step with the wordlists in
 * `screenreader_features.py` — `vocabulary-features.test.ts` pins the pair.
 */
const VOCABULARY_FEATURES = Object.freeze(new Set([
  // `vague_link_present` was here until it was retired as a model input on 2026-08-24: it answers
  // 2.4.9 (text alone, AAA, unreported) and the 2.4.4 head used it as a shortcut, firing on 22 of
  // the 44 conformant pages that carry "Details" inside a peer index.
  "vague_link_without_context",      // VAGUE_LINKS      — "Details" names a GOV.UK component
  "generic_heading_present",         // GENERIC_HEADINGS — "Overview" is a real section title
  "generic_graphic_present",         // GENERIC_GRAPHICS — alt="Photo" beside a photo credit
  "filename_graphic_present",        // FILENAME_GRAPHIC — prose that mentions a file name
  "plain_heading_candidate_present", // a heading-shaped line that is not announced as one
  "unit_is_plain_heading_candidate",
]));

/** The furniture a case will actually get, read from its GENERATED HTML rather than recomputed. */
function furnitureOf() {
  const carries = (/** @type {any} */ testCase, /** @type {any} */ marker) => marker.test(testCase.good) && marker.test(testCase.bad);
  return new Map(CASES.map((/** @type {any} */ testCase) => [testCase.id, {
    namedField: carries(testCase, /Reference lookup/),
    dataTable: carries(testCase, /Reference notes index/),
    disclosure: carries(testCase, /Reference notes archive/),
  }]));
}

function featureValues(/** @type {any} */ path) {
  const script = "import json,sys; sys.path.insert(0,'packages/scorer/python');\n"
    + "import screenreader_features as F;\n"
    + "print(json.dumps([F.structured_feature_values(json.loads(l)) for l in open(sys.argv[1]) if l.strip()]))";
  try {
    return JSON.parse(execFileSync(PYTHON, ["-c", script, path],
      { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  } catch (cause) {
    // A STALE EXPORT IS NOT A BROKEN TOOL, and it read as one: a record written before the `parsed` block
    // existed raises a RuntimeError inside the featurizer, and this surfaced it as a raw node traceback
    // with a Python stack inside it. Measured 2026-08-26 — the same fault `audit_grants.py` already turns
    // into a named refusal, here uncaught.
    //
    // The distinction matters because the two need opposite responses: re-export, versus debug the
    // featurizer. An audit that cannot tell them apart sends its reader at the wrong one.
    const stderr = String(/** @type {any} */ (cause).stderr ?? "");
    if (stderr.includes("no `parsed` block")) {
      process.stderr.write("\n  STALE EXPORT — this copy of the dataset predates the announcement parse,\n"
        + "  so the featurizer cannot read it. That is a fact about the FILE, not a defect in the corpus.\n"
        + `  Re-export it, or ask the lab, which holds the current one:\n`
        + "    npm run lab:job -- -e job=export\n"
        + "    npm run lab:job -- -e job=starvation\n");
      process.exit(2);
    }
    throw cause;
  }
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
  const { missing, excludedByDesign } = absentCases(furniture, represented);
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
        .filter((/** @type {any} */ name) => positives.every((row) => !row.values[name])),
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
  // The OPPOSITE SIGN, and the direction that cost a real measurement.
  //
  // `starved` finds a feature no positive carries, which a head may penalise for free (ADR 0015). This
  // finds a feature no CONFORMANT record carries — one that is perfectly correlated with failing, so its
  // mere presence is a free PREDICTOR. Same shortcut, opposite sign, and nothing looked for it.
  //
  // Measured 2026-08-24, on the shipped corpus: all 13 wordlist terms appear on bad variants only.
  //
  //     link:details  0 good / 17 bad     graphic:image  0 good / 10 bad
  //     link:more     0 good / 17 bad     graphic:photo  0 good /  7 bad
  //
  // So the corpus teaches that the WORD is the failure. It is not: 2.4.4 is Link Purpose IN CONTEXT, and
  // "Details" naming a component inside an index of component names conforms — which is what the GOV.UK
  // Design System publishes and what this scorer accused 11 of its pages of, on the strength of the one
  // announcement `"link, Details"`.
  //
  // Reported, not failed. A monopoly is a question about the corpus, and for some features it is correct:
  // `unnamed_graphic_present` genuinely cannot appear on a conformant page. The ones to fix are those whose
  // feature is a WORD that carries a second sense in ordinary English.
  const conformant = rows.filter((row) => row.subtypes.size === 0);
  const monopoly = conformant.length === 0 ? [] : names
    .filter((name) => occurrences[name] >= MIN_MONOPOLY_OCCURRENCES
      && conformant.every((row) => !row.values[name]))
    .map((name) => ({ name, onFailing: occurrences[name], onConformant: 0 }))
    .sort((a, b) => b.onFailing - a.onFailing);

  return { starved, rare, monopoly, conformantRecords: conformant.length,
    unmatched, missing, excludedByDesign, defined: furniture.size, records: rows.length };
}

/**
 * Cases with no record, SPLIT BY CAUSE — because the two need opposite responses and this reported one
 * message for both.
 *
 * A case whose subtype is in `MODEL_EXCLUDED_SUBTYPES` has no record BY DESIGN; the exporter says so on
 * its own summary line, `218 excluded from model`. Telling a reader that the export "predates them" and
 * to re-export sends them to re-run something that was never wrong. Measured 2026-08-28: ALL 218 of the
 * cases this audit called missing were the excluded three subtypes, and it recommended a re-export that
 * had just been run.
 *
 * Two different faults must not print the same word — the rule `audit_grants.py` already applies where it
 * separates STALE from FAIL, and this is the same shape one audit along.
 *
 * @param {Map<string, unknown>} furniture   every defined case
 * @param {Set<string>} represented          the case ids this export actually carries
 */
function absentCases(furniture, represented) {
  const absent = [...furniture.keys()].filter((id) => !represented.has(id));
  const excludedByDesign = absent.filter((id) => {
    const testCase = CASES.find((/** @type {any} */ c) => c.id === id);
    const subtype = testCase && `${testCase.criterion}:${testCase.subtype}`;
    return Boolean(subtype && MODEL_EXCLUDED_SUBTYPES.has(subtype));
  }).length;
  return { missing: absent.length - excludedByDesign, excludedByDesign };
}

function render(/** @type {any} */ { starved, rare, monopoly, conformantRecords, unmatched, missing,
  excludedByDesign, defined, records }) {
  const total = starved.reduce((/** @type {any} */ sum, /** @type {any} */ row) => sum + row.features.length, 0);
  process.stdout.write(`\n  ${records} exported records; ${unmatched} whose case is no longer defined.\n`);
  if (unmatched > 0) {
    process.stdout.write("  Those get NO furniture applied, so their subtypes may read as starved when they "
      + "are merely stale — re-export.\n");
  }
  if (excludedByDesign > 0) {
    process.stdout.write(`  ${excludedByDesign} defined case(s) have no record because their subtype is `
      + "EXCLUDED FROM THE MODEL by the exporter, which is by design and not staleness:\n"
      + `    ${[...MODEL_EXCLUDED_SUBTYPES].sort().join(", ")}\n`);
  }
  if (missing > 0) {
    process.stdout.write(`  ${missing} of ${defined} defined case(s) have NO record here and are NOT `
      + "excluded, so this export predates them and every count below is computed on part of the corpus.\n"
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

  const impossible = starved.reduce((/** @type {any} */ sum, /** @type {any} */ row) => sum + (row.impossible?.length ?? 0), 0);
  if (impossible) {
    process.stdout.write(`\n  ${impossible} starved pair(s) are IMPOSSIBLE BY DEFINITION and excluded below: `
      + "the subtype\n  is the absence of that announcement, so no page can carry both and the negative "
      + "weight is\n  correct inference rather than a free veto. Nothing to build.\n");
    for (const row of starved.filter((/** @type {any} */ r) => r.impossible?.length)) {
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
  /** @type {Record<string, any>} */
  const byFeature = {};
  for (const row of starved) for (const name of row.features) byFeature[name] = (byFeature[name] ?? 0) + 1;
  process.stdout.write(`\n  ${total} starved feature/subtype pairs across ${starved.length} subtypes.\n`);
  process.stdout.write("\n  The work list — features by how many subtypes they starve:\n\n");
  for (const [name, count] of Object.entries(byFeature).sort((a, z) => z[1] - a[1]).slice(0, 14)) {
    process.stdout.write(`    ${name.padEnd(34)} ${count}\n`);
  }
  process.stdout.write("\n  See docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md for what each group needs. Furniture cannot supply a feature\n"
    + "  that is itself a FAILURE — those need a page that fails twice.\n");

  renderMonopoly(monopoly, conformantRecords);
}

/**
 * The monopoly section, split out because it asks a SECOND question.
 *
 * `render` answers which features the corpus will STARVE; this answers which it will OVER-TEACH. Same
 * audit, opposite sign. Keeping both in one function pushed it past the line-count and complexity gates,
 * which is those rules doing their job rather than something to widen.
 */
function renderMonopoly(/** @type {any} */ monopoly, /** @type {any} */ conformantRecords) {
  process.stdout.write(`\n  WORD-SENSE MONOPOLY — features no conformant page carries (of ${conformantRecords} conformant records):\n\n`);
  if (monopoly.length === 0) {
    process.stdout.write("    none.\n");
  } else {
    const actionable = monopoly.filter((/** @type {any} */ m) => VOCABULARY_FEATURES.has(m.name));
    const inherent = monopoly.filter((/** @type {any} */ m) => !VOCABULARY_FEATURES.has(m.name));
    process.stdout.write("    FIX THESE — decided by a hand-written wordlist, so the word has another sense in English:\n");
    for (const { name, onFailing } of actionable) {
      process.stdout.write(`      ${name.padEnd(32)} ${String(onFailing).padStart(5)} failing / 0 conformant\n`);
    }
    if (actionable.length === 0) process.stdout.write("      none.\n");
    process.stdout.write("\n    CORRECT AS THEY ARE — the feature IS the failure, so no conformant page can carry it:\n");
    for (const { name, onFailing } of inherent) {
      process.stdout.write(`      ${name.padEnd(32)} ${String(onFailing).padStart(5)} failing / 0 conformant\n`);
    }
    process.stdout.write("\n  A feature above is perfectly correlated with failing, so its PRESENCE is a free predictor. For the\n"
      + "  first group that is a defect: the head fires on any real page using the word in a conforming\n"
      + "  sense. \"Details\" naming a component inside an index of components conforms — and this scorer\n"
      + "  accused 11 GOV.UK Design System pages of 2.4.4 on the strength of one announcement, `link,\n"
      + "  Details`, where the shipped model accused none.\n"
      + "  The remedy is the CORPUS, never the weights: a conformant page that uses the word legitimately.\n"
      + "  See ADR 0019.\n\n");
  }
}

// Guarded, so importing this module cannot run it. `entry-points.test.ts` asserts it across every npm
// script: a program that acts on import cannot be unit-tested, and one that shells out on import is worse.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (existsSync(RECORDS)) render(starvation());
  else process.stdout.write(`  no exported corpus at ${RECORDS} — run \`npm run training:export\` first.\n`);
}

export { starvation, GRANTS, VOCABULARY_FEATURES };
