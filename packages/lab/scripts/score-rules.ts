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
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { ruleFindings } from "@a11y-witness/judge/rules";

import { readRuleOwnership } from "../src/training/rule-ownership.js";
import { CASES } from "../src/training/case-matrix.mjs";
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { REPO_ROOT, datasetExportPath, datasetRoot, captureRoot } from "../src/dataset-paths.mjs";

/**
 * Subtypes the CASE DEFINITIONS carry, which is a different question from what the export contains.
 *
 * It is the question that makes "declared but absent" decidable. A declaration naming a subtype the corpus
 * does not define is genuinely wrong; one naming a subtype the corpus DOES define, absent from this
 * export, means the export predates the definition — a stale copy, not a broken declaration. The two need
 * opposite responses and used to produce the same message.
 */
const DEFINED_SUBTYPES: Set<string> = new Set(
  (CASES as Array<{ criterion: string; subtype: string }>)
    .map((testCase) => `${testCase.criterion}:${testCase.subtype}`));

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const DATA = resolve(REPO_ROOT, arg("data", datasetExportPath()));
const GATE = process.argv.includes("--gate");

const OWNERSHIP = readRuleOwnership();

interface Record_ {
  input: { transcript?: string[]; interaction?: { focusOrder?: unknown } };
  /**
   * Evidence the RULES may use and the MODEL may not — carried as a sibling of `input` so the exporter's
   * model boundary and the featurizer, which both read `input`, cannot reach it. Optional because an
   * export predating it must still score rather than the gate refusing every record.
   */
  ruleEvidence?: {
    census?: { heading?: number; graphicUnnamed?: number };
    dom?: { tabbable?: number };
  };
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
  new Set(ruleFindings(ruleInput(record)).map((f) => f.wcag.match(/(\d+\.\d+\.\d+)/)?.[1] ?? f.wcag));

/**
 * What the rules get to see: the model's input PLUS the evidence only they are allowed.
 *
 * This used to be `record.input` alone — the model allowlist — so any rule reading a field the model is
 * not given could never fire here. Two did (`census`), and the gate reported one of them as
 * "NEVER FIRED ANYWHERE" while the other hid behind working siblings for the same criterion.
 *
 * `?? {}` rather than a hard requirement: an export made before `ruleEvidence` existed still scores,
 * exactly as it did before, instead of the gate refusing every record on an older corpus.
 */
function ruleInput(record: { input: unknown; ruleEvidence?: Record<string, unknown> }) {
  return { ...(record.input as object), ...(record.ruleEvidence ?? {}) } as never;
}

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
/**
 * How many records carried the evidence only the RULES are allowed, and how many had something in it.
 *
 * "The rule never fired" and "the rule never had its evidence" are different answers, and this gate
 * reported the first while the second was true — for the entire life of two rules. `input.census` was
 * stripped at export, so `addMissingHeadings` (1.3.1) and the census-based 1.1.1 rule returned on their
 * first line every time, and the coverage table said `NEVER FIRED ANYWHERE — the claim rests on nothing`.
 * That sentence sends you to the corpus. The fault was in the pipeline.
 *
 * Stating the count converts that ambiguity into a fact, for the same reason `crossCheckStructure` reports
 * `link 51/58` rather than "examination was INCOMPLETE": a number tells you whether two links were missed
 * or two hundred, and a word does not.
 */
function reportRuleOnlyEvidence(records: Record_[]): void {
  const carried = records.filter((record) => record.ruleEvidence !== undefined);
  const census = records.filter((record) => record.ruleEvidence?.census);
  console.log(`# evidence the rules may see and the model may not\n  ${carried.length} of `
    + `${records.length} record(s) carry ruleEvidence; ${census.length} carry a census`);
  if (carried.length === 0) {
    console.log("  NONE. Every census-reading rule is unreachable here, whatever the corpus contains —");
    console.log("  re-export (`npm run lab:job -- -e job=export`); this is a pipeline fault, not a corpus one.");
    return;
  }
  const headings = census.map((record) => record.ruleEvidence!.census!.heading ?? -1);
  const unnamed = census.map((record) => record.ruleEvidence!.census!.graphicUnnamed ?? 0);
  // The two values the two census rules actually gate on. Printing them makes "the rule is silent because
  // the corpus has no such page" checkable rather than assumed — which is the whole difference between a
  // coverage gap you fix in the corpus and one you fix in the exporter.
  console.log(`  census.heading === 0 on ${headings.filter((n) => n === 0).length} record(s); `
    + `census.graphicUnnamed > 0 on ${unnamed.filter((n) => n > 0).length}`);
  for (const line of tabStopEvidenceLines(records)) console.log(line);
  for (const line of completenessLines(records)) console.log(line);
}

/**
 * HOW MANY ASSERTIONS REST ON A SWEEP NOTHING COULD VERIFY — capture-integrity-plan C2.
 *
 * `assertableSweep` refuses `phantom` and `truncated` and deliberately ALLOWS `unknown`, because every
 * capture taken before the counter existed reports it and refusing would silence 2.1.1 across the whole
 * corpus. That is a defensible trade exactly once: while it is COUNTED. An unknown that nothing reports
 * is `unknown` read as `exact`, which is the defect C1 exists to prevent arriving one layer out.
 *
 * A number and not a word, for the reason the function above gives: "some are unverified" cannot tell you
 * whether it is two records or two thousand.
 */
export function completenessLines(records: Record_[]): string[] {
  const withEvidence = records.filter((record) => record.ruleEvidence !== undefined);
  if (withEvidence.length === 0) return [];
  const tally = new Map<string, number>();
  for (const record of withEvidence) {
    const completeness = (record.ruleEvidence as { completeness?: Record<string, string> }).completeness;
    // ABSENT IS ITS OWN ANSWER. A record predating the field is not a record whose sweep agreed, and
    // folding the two together is the exact collapse this whole plan is about.
    if (!completeness) { tally.set("no completeness field", (tally.get("no completeness field") ?? 0) + 1); continue; }
    for (const [type, verdict] of Object.entries(completeness)) {
      const key = `${type}/${verdict}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  const unknown = [...tally].filter(([k]) => k.endsWith("/unknown") || k === "no completeness field")
    .reduce((total, [, n]) => total + n, 0);
  const rows = [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `    ${String(n).padStart(6)}  ${k}`);
  return ["  sweep completeness, per record per type:", ...rows,
    `  ${unknown} record-type(s) are UNVERIFIED — an assertion resting on one is allowed and counted here, `
    + "never refused"];
}

/**
 * Whether the corpus carries a capture that can EXERCISE 2.1.2's cycling branch, stated rather than assumed.
 *
 * The branch fires on a closed ring, smaller than the swept controls, that offers no actionable role. A
 * corpus with no such capture scores `2.1.2:focus-trapped EXACT` on the STALLED records alone — and a
 * branch that was never reached scores exactly like a branch that is right. Those need opposite responses:
 * ship, versus capture the case.
 *
 * This reported `dom.tabbable` until 2026-08-28, for a tab-stop denominator that was built and withdrawn
 * the same day; it kept describing that branch after the branch was gone, which is a stale diagnostic in
 * the file whose whole job is to say what was examined.
 *
 * Same fix `reportRuleOnlyEvidence` exists for, applied to the next piece of evidence rather than
 * re-learned after it costs an investigation. The census took two: once to find, and once again when a
 * re-export left every number unchanged and the report could not say whether the evidence had arrived and
 * found nothing, or had not arrived at all.
 */
export function tabStopEvidenceLines(
  records: { input?: { interaction?: { focusOrder?: unknown } } }[],
): string[] {
  const walked = records.filter((r) => Array.isArray(r.input?.interaction?.focusOrder)
    && (r.input.interaction.focusOrder as unknown[]).length > 0);
  if (walked.length === 0) {
    return [
      "  focusOrder on 0 record(s) — 2.1.2's cycling branch is UNEXERCISED here, so a clean",
      "  2.1.2 rests on the STALLED records alone. Capture a case with `probeFocus: true`.",
    ];
  }
  return [`  focusOrder on ${walked.length} of ${records.length} record(s) `
    + "— 2.1.2's cycling branch can be exercised"];
}

export function tally(records: Record_[]): Map<string, Coverage> {
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
export const verdictOf = (subtype: string, c: Coverage): string => {
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

/**
 * THIS GATE READS THE EXPORT, AND `rules:real-pages` READS THE CAPTURES. The two answer the same question
 * from different sides of a freeze, and until 2026-09-06 nothing said so.
 *
 * `export-screenreader-dataset.mjs` bakes `ruleEvidence: oracleCounts(capture)` at EXPORT time, so the
 * census every census-reading rule consults here is frozen under whatever trust rule was current when the
 * export ran. `rules:real-pages` recomputes from the capture and sees a capture-layer change immediately;
 * this gate sees nothing until a re-export.
 *
 * MEASURED: after the census trust-rule tightening merged, every rule finding across all 2,796 exported
 * records was byte-identical -- 1,398 conformant, 10 with a finding, same per-criterion counts -- while
 * the same change demonstrably alters what a capture-reading rule concludes.
 *
 * The freeze is deliberate: a record of what the evidence MEANT when the labels were written, and the
 * reason this gate can run without the 370 MB of captures beside it. What was wrong is that it was
 * SILENT, and it presents as THE FIX APPEARING NOT TO WORK -- land a capture-layer fix, run this gate, see
 * no movement, conclude the fix is wrong, and be wrong. That is the "two gates disagreeing about one
 * corpus" signal from the 1.3.1 episode, where `rules:gate` said `29/29 EXACT` and `rules:coverage` said
 * `fired 0x` about the same rule, arriving as a silence rather than a disagreement.
 *
 * So it is STATED, and with a NUMBER where one is available -- a count says whether two captures moved or
 * two thousand, which is the difference between a stale export and a gate reading last week's corpus.
 */
function reportWhichPathThisGateRead(dataPath: string): void {
  console.log("# what this gate read, and what it therefore cannot see");
  console.log("  the EXPORT. `ruleEvidence` (the census every census-reading rule consults) is frozen at");
  console.log("  export time, so a CAPTURE-LAYER change is invisible here until `job=export` runs again.");
  console.log("  `rules:real-pages` reads the captures and sees such a change immediately.");
  const exported = statMtime(dataPath);
  const newest = newestCaptureMtime();
  if (exported === undefined || newest === undefined) {
    // Absent prints as NOT MEASURED, never as OK: `capture:explain`'s rule, and the reason this whole
    // divergence went unnoticed is that a silence read as agreement.
    console.log("  export vs captures: NOT MEASURED (no captures readable from here)\n");
    return;
  }
  const staleBy = Math.round((newest.mtime - exported) / 60000);
  if (staleBy <= 0) {
    console.log(`  export is newer than every capture under ${newest.root} — this gate is current\n`);
    return;
  }
  console.log(`  *** ${newest.newerThanExport} capture(s) are NEWER than this export, by up to `
    + `${staleBy} minute(s) — newest: ${newest.name}`);
  console.log("  *** Any capture-layer fix in those captures is NOT reflected in the numbers below.");
  console.log("  *** Re-export first:  npm run lab:job -- -e job=export\n");
}

function statMtime(path: string): number | undefined {
  try { return statSync(path).mtimeMs; } catch { return undefined; }
}

/** The newest capture on disk, and how many are newer than the export. Undefined when there are none. */
function newestCaptureMtime(): { mtime: number; name: string; root: string; newerThanExport: number }
  | undefined {
  const root = captureRoot(datasetRoot());
  let best: { mtime: number; name: string } | undefined;
  const times: number[] = [];
  let names: string[];
  try { names = readdirSync(root); } catch { return undefined; }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const mtime = statMtime(resolve(root, name));
    if (mtime === undefined) continue;
    times.push(mtime);
    if (best === undefined || mtime > best.mtime) best = { mtime, name };
  }
  if (best === undefined) return undefined;
  const exported = statMtime(DATA) ?? 0;
  return { ...best, root, newerThanExport: times.filter((t) => t > exported).length };
}

function main(): void {
  const records = load(DATA);
  if (records.length === 0) {
    process.stderr.write(`No records at ${DATA}. Run npm run training:export first.\n`);
    process.exit(2);
  }

  const coverage = tally(records);
  console.log(`Rule-layer score over ${records.length} record(s) from ${DATA}\n`);
  reportWhichPathThisGateRead(DATA);
  console.log("# coverage by subtype (who actually decides what)\n");
  printCoverage(coverage);

  const failures = [
    ...falsePositiveFailures(records),
    ...ownershipFailures(coverage),
    ...boundaryFailures(coverage),
  ];
  reportGate(failures, records.length);
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

export function falsePositiveFailures(records: Record_[]): string[] {
  const failures: string[] = [];
  // A conformant page must never be failed by a deterministic rule, on ANY criterion. This used to be
  // checked only for the criteria the rules were believed to own, which cannot see a rule that fires
  // somewhere unexpected -- the same blindness that hid the 2.4.4 overlap.
  const conformant = records.filter((r) => r.target.label === "clean");
  const falsePositives = conformant.filter((r) => criteriaOf(r).size > 0);
  console.log(`# conformant records\n  ${conformant.length} scored, ${falsePositives.length} false positive(s)`);
  reportRuleOnlyEvidence(records);
  if (falsePositives.length) {
    console.log(`  FALSE POS  ${falsePositives.slice(0, 6).map(idOf).join(", ")}`);
    // NAMED, not counted. The ids are console.logged a line above, but the FAILURE string is what
    // `reportGate` prints at the end and what a reader acts on — and this repo's own rule is that a count
    // is where an investigation stops. `MISSING EVIDENCE` already names its records; this did not.
    failures.push(`${falsePositives.length} conformant record(s) were failed by a deterministic rule: `
      + `${falsePositives.slice(0, 6).map(idOf).join(", ")}`
      + (falsePositives.length > 6 ? `, and ${falsePositives.length - 6} more` : ""));
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

/**
 * Every declared key must exist in the data — and every `unavailable` one must NOT.
 *
 * `ownership` defaults to the real declaration and takes a parameter only so a test can hand it a small
 * fabricated map instead — `OWNERSHIP` is read from `rule-ownership.json` at import time, and the real
 * file has no `modelHead: false` entry to exercise this exemption against yet
 * (`model-head-exclusion.test.ts`).
 */
export function ownershipFailures(
  coverage: Map<string, Coverage>, ownership: Map<string, import("../src/training/rule-ownership.js").Ownership> = OWNERSHIP,
): string[] {
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
  for (const [subtype, entry] of ownership) {
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
    // `modelHead: false` is the one declared-but-absent case that is not a defect: it is how
    // `1.4.2:autoplay-uncontrollable` is declared today with no corpus case at all -- see
    // `rule-ownership.json`'s own `why`. `assert_declaration_matches_data` (train-screenreader-model.py)
    // exempts it from the identical check for the identical reason; the two must move together or one
    // side's gate contradicts the other's.
    if (entry.modelHead === false) continue;
    // WHICH of the two it is, stated rather than guessed. This said "either the corpus vocabulary moved or
    // the key was never right" and failed hard on both — but there is a third case it never considered and
    // which is the common one locally: the export simply PREDATES the declaration. `runs/` is gitignored,
    // so a working copy is only ever as fresh as its last sync, and adding a subtype makes every local
    // gate fail until a re-export that only the lab can do.
    //
    // That is why this check was being skipped rather than fixed, and a check that gets bypassed is a
    // check that does not run. The case definitions answer it outright: if the corpus DEFINES the subtype,
    // the declaration is fine and the export is behind.
    if (DEFINED_SUBTYPES.has(subtype)) {
      console.log(`RULES: ${subtype} is declared in rule-ownership.json and the case matrix DEFINES it, `
        + "but no record in this export carries it — so this export predates the cases. Re-export "
        + "(`npm run lab:job -- -e job=export`); the declaration is not implicated.");
      failures.push(UNDETERMINED + `${subtype} declared and defined, absent from THIS export (stale export)`);
      continue;
    }
    console.log(`RULES: ${subtype} is declared in rule-ownership.json and NOTHING defines it — not the `
      + "export, and not the case matrix. The key was never right, or the corpus vocabulary moved; an "
      + "entry that matches nothing enforces nothing.");
    failures.push(`${subtype} is declared but nothing defines it`);
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

function reportGate(failures: string[], scored: number): void {
  const { conclusive, undetermined } = partitionProblems(failures);
  if (!GATE) return;

  // COVERAGE IS BOUNDARIES DECIDED, not subtypes present -- and the difference is measurable on this very
  // corpus, which carries one of each: `1.3.1:no-headings` is ABSENT from a stale export, while
  // `3.3.2:placeholder-only` is PRESENT and unattributable because the export recorded no exclusion set.
  // Counting presence would have called the second one examined. Every declared entry is one boundary this
  // gate sets out to decide, and every `undetermined` is one it could not -- for either reason.
  const of = OWNERSHIP.size;
  const verdict = gateVerdict({
    examined: of - undetermined.length,
    of,
    source: `rule-ownership.json, against ${scored} record(s) in ${DATA}`,
    // Failures are deliberately NOT a subset of `examined`: the undeclared-and-touched check finds problems
    // on subtypes that are in no declaration at all, so this count can exceed `of`. `gateVerdict`'s wording
    // was fixed for exactly that case.
    failures: conclusive.length,
  });

  // The detail is already printed above, per problem, with the remedy. This line is the one a hook or a
  // pipeline reads, and it now carries its own scope -- "1 of 41" cannot be mistaken for "clean".
  console.log(`\nRULES: ${renderVerdict(verdict)}`);
  if (conclusive.length) {
    console.log(`  problems: ${[...conclusive, ...undetermined.map((u) => `${u} (undetermined)`)].join("; ")}`);
  } else if (undetermined.length) {
    // A stale working copy of `runs/` is not a defect in the code being pushed, and this check cannot tell a
    // stale corpus from one that legitimately needs recapture. Failing on it is what made A11Y_SKIP_VERIFY=1
    // routine -- and that switch disables lint, typecheck and 1337 tests too, so the check that could not
    // answer its own question switched off the ones that could. Exit 2 INCONCLUSIVE, as check-signals does,
    // and let the hook report it as SKIPPED.
    console.log(`  cannot attribute: ${undetermined.join("; ")}.`);
    console.log("  This is not a pass. Re-export, or ask the lab, which holds the authoritative corpus.");
  }
  process.exitCode = exitCodeFor(verdict);
}

/**
 * Run ONLY when this file is the program, never when it is imported — so a test can reach the scoring
 * functions above without the script running the gate and calling `process.exit`. See `entry-points.test.ts`.
 */
const isProgram = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main();
