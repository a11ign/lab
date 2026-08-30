/**
 * Judge eval runner.
 *
 * Runs the judge over the labeled fixtures and scores its findings against
 * ground truth, at the WCAG-criterion level. Reports recall (did it catch the
 * observable failures?) and precision (did it flag anything it shouldn't?).
 *
 * Usage:
 *   npm run eval                 # all cases, 1 run each
 *   npm run eval -- w3c-bad-before
 *   EVAL_RUNS=3 npm run eval     # repeat each case to measure consistency
 *
 * Fixtures are frozen transcripts, so this evaluates the JUDGE, not capture.
 */
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { judgeBackend } from "@a11y-witness/judge";
import { judge } from "@a11y-witness/judge";
import { oracleCounts } from "@a11y-witness/evidence/verify";
import { EVAL_CASES, type EvalCase } from "./cases.js";
import { evaluateFitness, persistentFalsePositives, thresholdsFromEnv } from "./fitness.js";

const RUNS = Number(process.env.EVAL_RUNS || 1);

/** "1.1.1 Non-text Content (A)" -> "1.1.1" */
function criterion(wcag: string): string {
  const m = wcag.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : wcag.trim();
}

interface RunScore {
  found: string[];
  /**
   * True when the scorer DECLINED to judge this capture because the page is unlike anything it was
   * validated on. Not a miss: the model was not wrong, it refused to guess.
   */
  abstained: boolean;
  recall: number;
  /**
   * The same recall, split by WHICH LAYER reported the criterion.
   *
   * `rulesRecall` counts conformance-mapped findings — the deterministic layer, the only one that
   * ASSERTS. `modelRecall` counts the rest, which is the trained scorer, whose findings become
   * `cantTell`. A criterion both layers report counts in both: the question each answers is "would this
   * layer have caught it", not "who got there first".
   *
   * They exist because the combined number cannot notice a layer vanishing. Measured 2026-08-27 by
   * driving this gate with a scorer that reports nothing: 59% recall against a floor of 0.55.
   */
  modelRecall: number;
  rulesRecall: number;
  precision: number;
  caught: string[];
  missed: string[];
  falsePositives: string[];
}

async function scoreOnce(c: EvalCase): Promise<RunScore> {
  const data = JSON.parse(readFileSync(c.fixture, "utf8")) as {
    url: string;
    screenReader?: string;
    transcript: string[];
    // Declared LOOSELY on purpose. This shape used to name only headings/landmarks/formFields and
    // controls/stateChanges, which silently stripped `links`, `graphics`, `lists`, `postSubmitFields` and
    // `formChanges` before the judge ever saw them — so the rules that read those channels could not fire
    // here, and the model's structured features read zero. That is the same defect as the CLI's `--json`
    // dropping structure, which suppressed a true 4.1.2 at 0.993. An eval harness that feeds the judge
    // less than production does is measuring something else.
    structure?: Record<string, string[]>;
    interaction?: Record<string, unknown>;
    diagnostics?: unknown[];
  };
  const verdict = await judge({
    url: data.url,
    task: c.task,
    screenReader: data.screenReader ?? "NVDA",
    transcript: data.transcript,
    structure: data.structure as never,
    interaction: data.interaction as never,
    // The accessibility-tree oracle, which two deterministic rules need: 1.3.1 will not claim "no
    // headings" without it, and 1.1.1 uses it to see images that expose no name at all — ones quick
    // navigation walks past, so the announcements alone cannot reach them.
    ...oracleCounts(data as never),
  });
  const found = Array.from(new Set(verdict.findings.map((f) => criterion(f.wcag))));
  // WHICH LAYER reported it, keyed on whether `mapping` is PRESENT rather than on its value.
  //
  // `rules.ts`'s `add()` defaults it to `"secondary"` and passes `"conformance"` where the criterion is
  // conformance-mapped, so every rule finding carries one; `findingsFromScores` sets none at all, which
  // `RequirementMapping` treats as `secondary` and `criterionOutcomes` turns into `cantTell`. Splitting
  // on `!== "conformance"` therefore counts the rules' own REFERRALS as model findings -- measured, a
  // silent scorer scored 27% that way -- and is wrong for the reason this whole split exists: it cannot
  // see one layer disappear.
  //
  // Measured that day by driving the gate with a scorer that reports NOTHING: recall 59%, against 92%
  // shipped and a floor of 0.55. A judge that went completely silent would have passed the gate that
  // exists to measure it — not because the threshold was wrong so much as because the number could not
  // see one of the two layers disappear.
  const byModel = new Set(verdict.findings.filter((f) => f.mapping === undefined)
    .map((f) => criterion(f.wcag)));
  const byRules = new Set(verdict.findings.filter((f) => f.mapping !== undefined)
    .map((f) => criterion(f.wcag)));
  const allow = new Set(c.allow);
  const caught = c.expect.filter((x) => found.includes(x));
  const caughtByModel = c.expect.filter((x) => byModel.has(x));
  const caughtByRules = c.expect.filter((x) => byRules.has(x));
  const missed = c.expect.filter((x) => !found.includes(x));
  const falsePositives = found.filter((x) => !allow.has(x));
  const over = (xs: string[]) => (c.expect.length ? xs.length / c.expect.length : 1);
  const precision = found.length ? found.filter((x) => allow.has(x)).length / found.length : 1;
  return {
    found, abstained: verdict.abstained === true, recall: over(caught), precision, caught, missed,
    falsePositives, modelRecall: over(caughtByModel), rulesRecall: over(caughtByRules),
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// One scored case: its per-run recalls, whether it expects failures, and how
// many false positives the last run produced (the unit the aggregate sums).
interface CaseReport {
  recalls: number[];
  /** The same runs, split by layer. See `RunScore` for why the combined figure is not enough. */
  modelRecalls: number[];
  rulesRecalls: number[];
  /** The scorer declined to judge this case at all. */
  abstained?: boolean;
  isFailureCase: boolean;
  /** One entry per run, so the aggregate can tell a persistent false positive from sampling noise. */
  falsePositivesPerRun: string[][];
}

// Score a case (RUNS times), print its block, and return what the aggregate needs.
/**
 * Which judge is being measured — the skip below is per backend, because scope is per backend.
 *
 * FROM THE JUDGE'S OWN RESOLVER. This read `?? "local"`, and `??` only defaults on nullish — so with
 * `JUDGE_BACKEND=""`, which is how CI passes "unset", this resolved to `""` while the judge itself
 * resolved `"local"`. `c.notApplicableTo?.includes("")` never matches, so cases the local scorer CANNOT
 * assess were SCORED rather than excluded, depressing the eval silently. `judge.ts` had already been
 * bitten by the same `??` and fixed; the fix reached one of four copies.
 */
const BACKEND = judgeBackend();

async function reportCase(c: EvalCase): Promise<CaseReport> {
  // A case the active backend cannot assess is NOT APPLICABLE: excluded from recall rather than scored as
  // a zero, and announced so the exclusion can never be mistaken for a pass. Silence about a skipped case
  // is how a gate comes to report coverage it does not have.
  //
  // Checked BEFORE any judging, so an out-of-scope fixture also stops costing a judge call — and, for the
  // trained scorer, stops raising an exception that once aborted the whole run part-way.
  if (c.notApplicableTo?.includes(BACKEND)) {
    console.log(`\n# ${c.id}\n  SKIPPED  out of scope for the ${BACKEND} backend — ${c.notes ?? "see cases.ts"}`);
    return { recalls: [], modelRecalls: [], rulesRecalls: [], isFailureCase: false, falsePositivesPerRun: [] };
  }
  process.stderr.write(`Scoring ${c.id} ...\n`);
  const scores: RunScore[] = [];
  for (let i = 0; i < RUNS; i++) scores.push(await scoreOnce(c));
  const isFailureCase = c.expect.length > 0;
  printCaseScore(c, scores, isFailureCase);
  // Abstention is RECORDED, not excluded — and the difference matters enough to have been got wrong once.
  //
  // Excluding an abstained case from recall looks principled (the model declined; it was not wrong) and is
  // self-serving here, because the deterministic RULES still run when the scorer abstains. Most abstained
  // cases still report findings, so dropping them discarded the rule layer's work and lifted recall from
  // 59% to a meaningless 100% over the two cases the scorer engaged with. A gate that passes by measuring
  // a subset is worse than one that fails honestly.
  //
  // So recall stays over EVERY failure case — what fraction of the expected criteria did this tool report,
  // by any layer — and abstention is reported beside it as its own number.
  const abstained = scores.length > 0 && scores.every((score) => score.abstained);
  if (abstained) {
    console.log("  ABSTAINED  the trained scorer declined this page as outside the distribution it was "
      + "validated on. Any findings above came from the deterministic rules, which still ran.");
  }
  return {
    recalls: scores.map((score) => score.recall),
    modelRecalls: scores.map((score) => score.modelRecall),
    rulesRecalls: scores.map((score) => score.rulesRecall),
    isFailureCase,
    abstained,
    falsePositivesPerRun: scores.map((score) => score.falsePositives),
  };
}

// Takes the runs and derives the rest. `last` and `recalls` were separate parameters until they put
// this over the argument limit -- and they were always just views of `scores`, so passing them was
// duplication rather than information.
function printCaseScore(c: EvalCase, scores: RunScore[], isFailureCase: boolean): void {
  const recalls = scores.map((score) => score.recall);
  const last = scores[scores.length - 1];
  console.log(`# ${c.id}${isFailureCase ? "" : "  (conformant: expect no findings)"}`);
  console.log(`  expect:    [${c.expect.join(", ") || "(none)"}]`);
  console.log(`  found:     [${last.found.join(", ") || "(none)"}]${RUNS > 1 ? " (last run)" : ""}`);
  if (isFailureCase) {
    const range = RUNS > 1 ? ` (min ${pct(Math.min(...recalls))}, max ${pct(Math.max(...recalls))})` : "";
    console.log(`  recall:    ${pct(mean(recalls))}${range}  caught [${last.caught.join(", ") || "-"}]  missed [${last.missed.join(", ") || "-"}]`);
  }
  const persistent = persistentFalsePositives(scores.map((s) => s.falsePositives));
  console.log(`  false positives: ${persistent.length} [${persistent.join(", ") || "none"}]`);
  // Show what did NOT persist. A criterion that appeared in a minority of runs is the judge's sampling
  // noise, and hiding it is how a flaky gate gets mistaken for a clean one.
  if (scores.length > 1) {
    const transient = [...new Set(scores.flatMap((s) => s.falsePositives))].filter((f) => !persistent.includes(f));
    if (transient.length) console.log(`  transient (minority of ${scores.length} runs, not gated): [${transient.join(", ")}]`);
  }
  if (c.notes) console.log(`  note: ${c.notes}`);
  console.log("");
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  // Substring match so e.g. `npm run eval -- tut-` runs all tutorial cases.
  const matched = filter ? EVAL_CASES.filter((c) => c.id.includes(filter)) : EVAL_CASES;
  if (!matched.length) {
    console.error(`No eval case matches "${filter}". Known: ${EVAL_CASES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  // A case whose fixture has not been captured yet (authored page awaiting the
  // NVDA worker) is skipped, not an error: it does not exist to score.
  const cases = matched.filter((c) => existsSync(c.fixture));
  const pending = matched.filter((c) => !existsSync(c.fixture));
  if (pending.length) {
    console.log(`Pending capture (skipped — author'd, awaiting NVDA worker): ${pending.map((c) => c.id).join(", ")}\n`);
  }
  if (!cases.length) {
    console.log("No captured fixtures to score yet.");
    return;
  }

  console.log(`a11y-witness judge eval  (${RUNS} run(s) per case)\n`);
  const failureRecall: number[] = []; // recall, only on cases with expected failures
  const modelRecall: number[] = [];   // the same, counting only what the TRAINED SCORER reported
  const rulesRecall: number[] = [];   // and only what the deterministic rules reported
  let totalFalsePositives = 0; // persistent across a majority of runs, per case
  let conformantFalsePositives = 0; // false positives on conformant (expect-none) cases
  let failureCaseCount = 0;         // failure cases considered, answered plus abstained
  let abstainedFailureCases = 0;    // failure cases the scorer declined to judge at all

  for (const c of cases) {
    const report = await reportCase(c);
    const persistent = persistentFalsePositives(report.falsePositivesPerRun).length;
    totalFalsePositives += persistent;
    // ONE branch on `isFailureCase`, not four. Three separate `if`s reading the same condition took this
    // function to a complexity of 16 against a limit of 15 — and the limit was right: they are one
    // decision about one case, written as several.
    if (report.isFailureCase) {
      failureRecall.push(...report.recalls);
      modelRecall.push(...report.modelRecalls);
      rulesRecall.push(...report.rulesRecalls);
      failureCaseCount += 1;
      if (report.abstained) abstainedFailureCases += 1;
    } else {
      conformantFalsePositives += persistent;
    }
  }

  const recall = failureRecall.length ? mean(failureRecall) : 1;
  // Printed on the aggregate line, not buried per case. Recall is now over ANSWERED cases, so a reader who
  // does not see the abstention count beside it would read a number computed on a subset as a number
  // computed on everything — which is precisely the misreading this whole change exists to stop.
  console.log(
    `AGGREGATE  recall ${pct(recall)} (over ${failureRecall.length} failure-case run(s))  |  ` +
      `abstained ${abstainedFailureCases} of ${failureCaseCount} failure case(s)  |  ` +
      `false positives ${totalFalsePositives} total, ${conformantFalsePositives} on conformant pages`
  );
  // BY LAYER, beside the combined figure and never instead of it. The combined number is what a user
  // gets; these two are what say whether both layers are still working. A scorer reporting NOTHING scores
  // 59% on the line above, because the rules supply the rest — measured, not supposed.
  const layerMean = (xs: number[]) => (xs.length ? mean(xs) : 1);
  console.log(
    `           by layer: trained scorer ${pct(layerMean(modelRecall))}  |  `
      + `deterministic rules ${pct(layerMean(rulesRecall))}  `
      + "(a criterion both report counts in both)"
  );

  // Fitness-function gate (opt-in via EVAL_GATE): fail the run if judge quality
  // regresses below the thresholds, so it can be used as a regression gate.
  if (process.env.EVAL_GATE) {
    const thresholds = thresholdsFromEnv();
    const fitness = evaluateFitness({
      recall,
      modelRecall: layerMean(modelRecall),
      conformantFP: conformantFalsePositives,
      abstained: abstainedFailureCases,
      failureCases: failureCaseCount,
    }, thresholds);
    console.log(fitness.pass ? "\nFITNESS: PASS" : `\nFITNESS: FAIL — ${fitness.reasons.join("; ")}`);
    if (!fitness.pass) process.exitCode = 1;
  }
}

/**
 * Run ONLY when this file is the program, never when it is imported — so a test (or the `import()` load
 * check) can reach the functions above without executing the script. See `entry-points.test.ts`.
 */
const isProgram = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
