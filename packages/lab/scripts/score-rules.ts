// Score the DETERMINISTIC rule layer against real captured evidence.
//
//   npm run rules:score                  # against the training corpus export
//   npm run rules:score -- --data=runs/screenreader-acceptance/screenreader-evidence.jsonl
//   npm run rules:score -- --gate        # non-zero exit on a regression
//
// ## Why this exists
//
// The acceptance report says two criteria are not the model's to decide:
//
//     "1.1.1": {"decisionOwner": "deterministic-rules", "modelEvaluated": false,
//               "reason": "criterion is evaluated by the authoritative deterministic rule layer"}
//
// That is the intended design (docs/local-model.md: the rules own exact absence cases). But the model
// layer has a family-grouped train/validation/test split, a held-out acceptance set, per-criterion
// thresholds, stability checks and hardening -- and the rule layer had `rules.test.ts` and nothing
// else. Zero references to `runs/` or any capture. So the two criteria decided ABSOLUTELY were the two
// measured only against hand-written fixtures.
//
// That gap hid a real defect. NVDA's "unlabeled" prefix is nondeterministic, the 1.1.1 rule keyed on
// it, and 3 of 88 corpus captures of images with NO alt text therefore produced no finding at all. A
// hand-written fixture cannot surface that, because the fixture author writes the phrasing they expect.
//
// The corpus is free ground truth: 1,061 labelled pairs whose bad variant is a known, single mutation.
//
// ## Two things this file used to get wrong, and both were invisible
//
// It declared the boundary ITSELF -- a `RULE_OWNED_SUBTYPES` array -- while `train-screenreader-model.py`
// declared the same boundary again in a Python frozenset. They had already drifted in both directions by
// the time anyone compared them. The declaration now lives once, in `packages/lab/rule-ownership.json`,
// which carries the argument for why.
//
// And it keyed subtypes on `provenance.subtype` prefixed with whichever of 1.1.1/4.1.2 the record
// happened to carry -- a vocabulary that exists nowhere else. Two consequences, both measured:
//
//   - it minted `4.1.2:unnamed-form-field`, a key no record has; the corpus calls it
//     `3.3.2:unnamed-form-field` and the rule reports 4.1.2, which is what `reportsAs` now records.
//   - filtering to those two criteria meant a rule firing on any OTHER criterion could not be seen.
//     The rules fire 2.4.4 on 19 of 100 vague-link records, and this gate was structurally blind to it.
//
// It now speaks the corpus's own `target.subtypes` vocabulary -- the same one the scorer's heads are
// named after -- so the two layers are measured in one language instead of two.
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { ruleFindings } from "@a11y-witness/judge/rules";

import { readRuleOwnership } from "../src/training/rule-ownership.js";

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const DATA = resolve(process.cwd(), arg("data", "runs/screenreader-dataset/screenreader-evidence.jsonl"));
const GATE = process.argv.includes("--gate");

const OWNERSHIP = readRuleOwnership();

interface Record_ {
  input: { transcript?: string[] };
  target: { label: string; criteria: string[]; subtypes?: string[] };
  provenance: { caseId: string; variant: string; subtype: string };
}

interface Coverage {
  /** Records carrying this subtype. */
  total: number;
  /** Of those, the ones a rule-owned subtype says a rule must decide. */
  dueByRule: number;
  /** Of those, the ones where every owned subtype's `reportsAs` criterion actually fired. */
  caughtByRule: number;
  /** Records where this subtype's own criterion fired with no rule-owned subtype to explain it. */
  alsoFired: number;
  missed: string[];
}

function load(path: string): Record_[] {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line) as Record_);
}

const criteriaOf = (record: Record_): Set<string> =>
  new Set(ruleFindings(record.input as never).map((f) => f.wcag.match(/(\d+\.\d+\.\d+)/)?.[1] ?? f.wcag));

const idOf = (record: Record_): string => `${record.provenance.caseId}.${record.provenance.variant}`;

/**
 * Coverage per subtype, under one expectation: a record is the RULES' to decide when it carries a
 * rule-owned subtype -- not when the subtype under examination happens to be the owned one.
 *
 * That distinction is the whole reason multi-labelled records used to read as a ragged boundary. The 115
 * unnamed-form-field records also carry `4.1.2:missing-role`, so `missing-role` measures 115 of 189
 * caught. Scored naively that is a boundary defect; scored against what the record actually is, it is
 * 115/115 rule-decided and 0 of the remaining 74 touched, which is exactly right and exactly clean.
 */
function tally(records: Record_[]): Map<string, Coverage> {
  const coverage = new Map<string, Coverage>();
  for (const record of records) {
    const subtypes = record.target.subtypes ?? [];
    if (subtypes.length === 0) continue; // conformant records carry none; they are gated separately
    const fired = criteriaOf(record);
    const owned = subtypes.filter((s) => OWNERSHIP.get(s)?.decidedBy === "rules");
    const rules = {
      decides: owned.length > 0,
      caught: owned.every((s) => fired.has(OWNERSHIP.get(s)!.reportsAs)),
      fired,
    };
    for (const subtype of subtypes) {
      const entry = coverage.get(subtype)
        ?? { total: 0, dueByRule: 0, caughtByRule: 0, alsoFired: 0, missed: [] };
      credit(entry, subtype, record, rules);
      coverage.set(subtype, entry);
    }
  }
  return coverage;
}

/** One record's contribution to one subtype's tally. See `tally` for what `rules.decides` means. */
function credit(
  entry: Coverage,
  subtype: string,
  record: Record_,
  rules: { decides: boolean; caught: boolean; fired: Set<string> },
): void {
  entry.total += 1;
  if (!rules.decides) {
    if (rules.fired.has(subtype.split(":")[0])) entry.alsoFired += 1;
    return;
  }
  entry.dueByRule += 1;
  if (rules.caught) entry.caughtByRule += 1;
  else entry.missed.push(idOf(record));
}

/**
 * Say which of the four states a subtype is in, and never let a partly rule-decided one read as owned.
 *
 * `4.1.2:missing-role` is the case that forces the distinction: 115 of its 189 records are unnamed form
 * fields the rules catch, and 74 are genuine missing-role cases they never look at. Printing "115/115
 * EXACT" would be true of the records the rules are answerable for and a lie about the subtype -- the
 * scorer's head is trained on all 189 and is the only decider for 74 of them.
 */
const verdictOf = (subtype: string, c: Coverage): string => {
  const declared = OWNERSHIP.get(subtype)?.decidedBy;
  if (c.dueByRule > c.caughtByRule) return "rules: MISSING EVIDENCE";
  if (c.dueByRule === c.total && c.total > 0) return "rules: EXACT";
  if (c.dueByRule > 0) {
    return `rules: EXACT on the ${c.dueByRule} co-labelled record(s); the head alone owns the other `
      + `${c.total - c.dueByRule}`;
  }
  if (declared === "overlap") return `rules: declared OVERLAP — the head owns the other ${c.total - c.alsoFired}`;
  if (c.alsoFired > 0) return `rules: UNDECLARED — fired on ${c.alsoFired}/${c.total} of a subtype this file does not claim`;
  return "rules: none — the model's heads own this subtype";
};

function main(): void {
  const records = load(DATA);
  if (records.length === 0) {
    process.stderr.write(`No records at ${DATA}. Run npm run training:export first.\n`);
    process.exit(2);
  }

  const coverage = tally(records);
  console.log(`Rule-layer score over ${records.length} record(s) from ${DATA}\n`);
  console.log("# coverage by subtype (who actually decides what)\n");
  printCoverage(coverage);

  const failures = [
    ...falsePositiveFailures(records),
    ...ownershipFailures(coverage),
    ...boundaryFailures(coverage),
  ];
  reportGate(failures);
}

/** The map of who decides what. Printed always, because "nobody" is the answer most worth seeing. */
function printCoverage(coverage: Map<string, Coverage>): void {
  // `unavailable` subtypes have no records by construction, and they belong in this table more than
  // anywhere else: it is the map of who decides what, and "nobody" is the answer most worth seeing.
  const rows = [
    ...[...coverage.entries()].map(([subtype, c]): [string, string, string] => [
      subtype,
      // Always over the subtype's FULL record count, so the denominator is what the head was trained on.
      `${c.dueByRule > 0 ? c.caughtByRule : c.alsoFired}/${c.total}`,
      verdictOf(subtype, c),
    ]),
    ...[...OWNERSHIP].filter(([, e]) => e.decidedBy === "unavailable").map(([subtype]): [string, string, string] => [
      subtype, "—",
      "NEITHER LAYER — excluded from the model; the evidence cannot express this failure",
    ]),
  ].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [subtype, share, verdict] of rows) {
    console.log(`  ${subtype.padEnd(30)} ${share.padStart(8)}  ${verdict}`);
  }
  console.log("");
  console.log("");
}

function falsePositiveFailures(records: Record_[]): string[] {
  const failures: string[] = [];
  // A conformant page must never be failed by a deterministic rule, on ANY criterion. This used to be
  // checked only for the criteria the rules were believed to own, which cannot see a rule that fires
  // somewhere unexpected -- the same blindness that hid the 2.4.4 overlap.
  const conformant = records.filter((r) => r.target.label === "clean");
  const falsePositives = conformant.filter((r) => criteriaOf(r).size > 0);
  console.log(`# conformant records\n  ${conformant.length} scored, ${falsePositives.length} false positive(s)`);
  if (falsePositives.length) {
    console.log(`  FALSE POS  ${falsePositives.slice(0, 6).map(idOf).join(", ")}`);
    failures.push(`${falsePositives.length} conformant record(s) were failed by a deterministic rule`);
  }
  console.log("");
  return failures;
}

/**
 * A problem this copy of the corpus cannot attribute.
 *
 * Marked rather than described in prose because two readers act on it: `reportGate`, which must exit 2
 * INCONCLUSIVE rather than 1 FAIL, and a human. One exported constant, so the two cannot drift — the
 * failure this repo pays for most often is the same fact written down twice.
 */
export const UNDETERMINED = "[undetermined] ";

/**
 * The exclusions the export on disk was actually produced with, or null if it did not record them.
 *
 * Null is not "none": an export written before this was recorded cannot answer the question, and treating
 * that as "excluded nothing" would turn every old export into a false "the exporter is broken".
 */
function exportedExclusions(): string[] | null {
  const path = DATA.replace(/\.jsonl$/i, ".summary.json");
  if (!existsSync(path)) return null;
  const summary = JSON.parse(readFileSync(path, "utf8")) as { excludedSubtypes?: string[] };
  return Array.isArray(summary.excludedSubtypes) ? summary.excludedSubtypes : null;
}

/** Every declared key must exist in the data — and every `unavailable` one must NOT. */
function ownershipFailures(coverage: Map<string, Coverage>): string[] {
  const failures: string[] = [];
  // Every declared key must exist in the DATA -- except the `unavailable` ones, where the assertion is
  // exactly inverted and just as necessary.
  //
  // The map carried `4.1.2:unnamed-form-field` for as long as it existed and matched nothing, so the entry
  // was neither enforcing anything nor visibly wrong; a declaration nothing can contradict is a comment.
  //
  // An `unavailable` subtype is excluded from the export on purpose (MODEL_EXCLUDED_SUBTYPES), so its
  // records MUST be absent -- and if they come back, the exclusion has silently stopped working and a head
  // is being trained on evidence that cannot express its failure. Same reasoning, opposite direction.
  for (const [subtype, entry] of OWNERSHIP) {
    const present = coverage.has(subtype);
    if (entry.decidedBy === "unavailable") {
      if (!present) continue;
      // Two causes, opposite remedies, and this used to assert the alarming one unconditionally: either the
      // exporter's exclusion stopped working, or the export on disk simply predates the exclusion being
      // added. The export records the set it ran with, so the two are now distinguishable rather than
      // guessed -- a stale local corpus reported "the model exclusion has stopped working", which sends the
      // reader to debug code that is fine.
      const excludedAtExportTime = exportedExclusions();
      if (excludedAtExportTime && !excludedAtExportTime.includes(subtype)) {
        console.log(`RULES: ${subtype} is declared unavailable and appears in the export — but the export `
          + "was produced BEFORE that exclusion existed, so this is stale data, not a broken exporter. "
          + "Re-run the export against the current corpus.");
        failures.push(UNDETERMINED + `${subtype} present in the data, from an export that predates its exclusion (stale export)`);
        continue;
      }
      if (!excludedAtExportTime) {
        // "Cannot answer" is a third outcome and must not be reported as either of the other two. Routing it
        // to the alarming branch is the same guess the record was added to remove.
        console.log(`RULES: ${subtype} is declared unavailable and appears in the export, and that export `
          + "did not record which exclusions it ran with — so this is either a broken exclusion or an export "
          + "that predates it, and this check cannot tell which. Re-run the export: the answer is the same "
          + "either way if it clears, and definite if it does not.");
        failures.push(UNDETERMINED + `${subtype} present in the data; the export records no exclusion set, so the cause is undetermined`);
        continue;
      }
      console.log(`RULES: ${subtype} is declared unavailable and yet appears in an export that DID exclude `
        + "it. The model exclusion has stopped working, so a head is being trained on evidence that cannot "
        + "express its failure.");
      failures.push(`${subtype} is declared unavailable but present in the data`);
      continue;
    }
    if (present) continue;
    console.log(`RULES: ${subtype} is declared in rule-ownership.json and appears in no record. Either the `
      + "corpus vocabulary moved or the key was never right; an entry that matches nothing enforces nothing.");
    failures.push(`${subtype} is declared but absent from the data`);
  }
  return failures;
}

/** Whether each subtype still behaves as `rule-ownership.json` declares it does. */
function boundaryFailures(coverage: Map<string, Coverage>): string[] {
  const failures: string[] = [];
  for (const [subtype, c] of [...coverage.entries()].sort()) {
    const declared = OWNERSHIP.get(subtype)?.decidedBy;
    // Being deterministic, the bar where a rule decides is EXACT: one miss on real evidence is a defect,
    // not variance. That is the whole reason a rule owns a subtype instead of the judge.
    if (c.dueByRule > c.caughtByRule) {
      console.log(`RULES: ${subtype} is rule-decided on ${c.dueByRule} record(s) and caught only `
        + `${c.caughtByRule} — ${c.missed.slice(0, 6).join(", ")}`);
      failures.push(`${subtype} misses real evidence`);
    }
    // A declared overlap must remain one. All of it means the subtype is really the rules', and the
    // scorer's head is being calibrated against records nobody reads; none of it means the rule broke.
    if (declared === "overlap" && (c.alsoFired === 0 || c.alsoFired === c.total)) {
      console.log(`RULES: ${subtype} is declared an overlap and measured ${c.alsoFired}/${c.total} — `
        + (c.alsoFired === 0 ? "the rule no longer fires on it at all." : "the rules now cover all of it."));
      failures.push(`${subtype} is no longer the overlap it is declared to be`);
    }
    // Undeclared and touched: whichever side is wrong, nobody is reliably deciding those records.
    if (!declared && c.alsoFired > 0) {
      console.log(`RULES: ${subtype} fired on ${c.alsoFired}/${c.total} record(s) and is not declared in `
        + "rule-ownership.json — declare the overlap or stop the rule firing; a boundary nobody wrote down "
        + "is one the scorer's release gate cannot account for.");
      failures.push(`${subtype} is touched by the rules but undeclared`);
    }
  }
  return failures;
}

export function partitionProblems(failures: string[]): { conclusive: string[]; undetermined: string[] } {
  return {
    conclusive: failures.filter((f) => !f.startsWith(UNDETERMINED)),
    undetermined: failures.filter((f) => f.startsWith(UNDETERMINED)).map((f) => f.slice(UNDETERMINED.length)),
  };
}

function reportGate(failures: string[]): void {
  const { conclusive, undetermined } = partitionProblems(failures);

  // A stale working copy of `runs/` is not a defect in the code being pushed, and this check cannot tell a
  // stale corpus from one that legitimately needs recapture. Failing on it is what made A11Y_SKIP_VERIFY=1
  // routine -- and that switch disables lint, typecheck and 953 tests too, so the check that could not
  // answer its own question switched off the ones that could. Exit 2 INCONCLUSIVE instead, exactly as
  // check-signals already does, and let the hook report it as SKIPPED. The authoritative answer is
  // `npm run lab:job -- -e job=rules-gate`, where the corpus IS the corpus.
  if (GATE && !conclusive.length && undetermined.length) {
    console.log(`\nRULES: INCONCLUSIVE — ${undetermined.length} problem(s) this copy of runs/ cannot `
      + `attribute: ${undetermined.join("; ")}.`);
    console.log("This is not a pass. Re-export, or ask the lab, which holds the authoritative corpus.");
    process.exitCode = 2;
    return;
  }
  if (GATE && conclusive.length) {
    const all = [...conclusive, ...undetermined.map((u) => `${u} (undetermined)`)];
    console.log(`\nRULES: FAIL — ${all.length} problem(s): ${all.join("; ")}.`);
    process.exitCode = 1;
  } else if (GATE) {
    console.log("\nRULES: PASS — every declared boundary holds on real captured evidence, with no false positives.");
  }
}

/**
 * Run ONLY when this file is the program, never when it is imported — so a test can reach the scoring
 * functions above without the script running the gate and calling `process.exit`. See `entry-points.test.ts`.
 */
const isProgram = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main();
