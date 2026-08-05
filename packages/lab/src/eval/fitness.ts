/**
 * Eval-as-fitness-function: an objective pass/fail on judge quality so it can't
 * silently regress. ("Fitness function" in the architecture-governance sense —
 * Building Evolutionary Architectures: a check wired into the build that verifies
 * a characteristic is preserved.) Pure so it is unit-testable without a model;
 * run.ts calls it under EVAL_GATE and sets a non-zero exit on FAIL.
 */
export interface FitnessThresholds {
  /** Minimum acceptable recall over failure cases (0–1). */
  minRecall: number;
  /** Maximum acceptable false positives on conformant (clean) pages. */
  maxConformantFP: number;
}

export interface FitnessMetrics {
  recall: number;
  conformantFP: number;
}

export interface FitnessResult {
  pass: boolean;
  reasons: string[];
}

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

export function evaluateFitness(m: FitnessMetrics, t: FitnessThresholds): FitnessResult {
  const reasons: string[] = [];
  if (m.recall < t.minRecall) {
    reasons.push(`recall ${pct(m.recall)} below floor ${pct(t.minRecall)}`);
  }
  if (m.conformantFP > t.maxConformantFP) {
    reasons.push(`${m.conformantFP} false positive(s) on conformant pages (max ${t.maxConformantFP})`);
  }
  return { pass: reasons.length === 0, reasons };
}

/** Thresholds from env, with regression-gate defaults: recall floor 80%, zero
 * over-flagging on conformant pages (the precision bar). */
/**
 * Which false positives are REAL, given a nondeterministic judge?
 *
 * The judge cannot be made deterministic: `codex exec` (0.145.0) has no temperature or seed field —
 * `temperature`, `model_temperature` and `model_sampling_temperature` are all rejected as unknown
 * configuration fields — so two identical runs legitimately differ. Measured here across three gate
 * runs whose only intervening change was a 1.1.1 image rule that provably cannot affect the fixture
 * involved (`ruleFindings` returns `[]` for it):
 *
 *   run 2: 0 conformant false positives, recall 94%  -> PASS
 *   run 3: 1 conformant false positive,  recall 100% -> FAIL
 *
 * A zero-tolerance threshold sampled ONCE therefore flips verdict on identical inputs, and a gate that
 * flakes gets re-run until green — which converts noise into a pass and is worse than having no gate.
 *
 * So a false positive counts only when it PERSISTS across a majority of runs. One appearance in three
 * is sampling noise; three in three is a judge defect. With a single run this is exactly the previous
 * behaviour, so the default path is unchanged.
 *
 * This deliberately aggregates false positives the same way recall was already aggregated. Before this,
 * `EVAL_RUNS=3` averaged recall over all runs but took false positives from the LAST run only — so it
 * looked like it hardened both metrics while leaving half the gate a coin toss.
 *
 * @param runs one entry per run, each listing the criteria falsely reported for a case
 */
export function persistentFalsePositives(runs: string[][]): string[] {
  if (runs.length === 0) return [];
  const appearances = new Map<string, number>();
  for (const run of runs) {
    // Within one run the same criterion may be reported twice; persistence is about how many RUNS
    // agree, not how many findings a single run produced.
    for (const criterion of new Set(run)) {
      appearances.set(criterion, (appearances.get(criterion) ?? 0) + 1);
    }
  }
  // Strict majority. With 1 run that is 1 (unchanged behaviour); with 3 it is 2, so a lone appearance
  // is noise and two agreeing runs is a finding.
  const majority = Math.floor(runs.length / 2) + 1;
  return [...appearances.entries()]
    .filter(([, count]) => count >= majority)
    .map(([criterion]) => criterion)
    .sort();
}

export function thresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): FitnessThresholds {
  return {
    minRecall: Number(env.EVAL_MIN_RECALL ?? 0.8),
    maxConformantFP: Number(env.EVAL_MAX_CONFORMANT_FP ?? 0),
  };
}
