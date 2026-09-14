// @ts-check
/**
 * WHAT A NEW FINDING ON A CONFORMANT REAL PAGE IS WORTH TO THE GATE -- #1504.
 *
 * `rules:real-pages` printed "NOTHING WAS ASSERTED ... not a publish blocker" and then exited 1: its failure
 * count was every new finding, asserted or referred, and `exitCodeFor` maps any failure to 1. The release gate
 * reads the exit, not the sentence, so on 2026-09-14 two REFERRED findings refused stage 11 (#915) under a line
 * saying they could not. #364 recorded the same contradiction on 2026-09-07 and resolved it only in the job's
 * exit-1 prose.
 *
 * ceo's ruling: the sentence is right and the exit is wrong.
 *   - ASSERTED: this tool STATED that a page its publisher declares conformant fails a criterion. That is the
 *     claim the gate exists for, so it fails.
 *   - REFERRED only: a `cantTell` offered to a human. A named WARNING, not a failure; a finding that is right
 *     enters the baseline through the ordinary `--update` PR.
 *   - UNRECORDED: this run scored no outcome for it, so nothing says it is a referral. It still fails, as every
 *     new finding did before. A referral is something this run measured, never a default.
 *
 * PURE, AND IT HAS TO BE. The gate script reaches the corpus (`corpus-settled.mjs` -> `dataset-paths.mjs`), so a
 * test importing it inherits `corpus` and CI refuses it. This module imports only `verdict.mjs`: the script calls
 * it and `referral-only-verdict.test.ts` drives it. The script keeps its own `coverageVerdict` and `exitCodeFor`
 * calls, which `exit-code-contract.test.ts` and `lab-job.test.ts` read to count it as a verdict adopter, so this
 * module never sets `process.exitCode`.
 */
import { exitCodeFor } from "./verdict.mjs";

/**
 * @typedef {import("./verdict.mjs").GateVerdict} GateVerdict
 * @typedef {"ASSERTED" | "REFERRED" | "UNRECORDED"} Outcome
 * @typedef {{ criterion: string, url: string, outcome: Outcome, evidence: string }} NewFinding
 *   `evidence` is the gate's evidence for the page: its census line, then its `opens:` line.
 */

/**
 * The new findings split by how each reaches a user. One split, read by the report's count line and by the
 * verdict, so the two cannot count differently.
 * @param {NewFinding[]} findings
 */
export function partitionByOutcome(findings) {
  return {
    asserted: findings.filter((finding) => finding.outcome === "ASSERTED"),
    referred: findings.filter((finding) => finding.outcome === "REFERRED"),
    unrecorded: findings.filter((finding) => finding.outcome === "UNRECORDED"),
  };
}

/**
 * The verdict, its exit code, and the warning a referral-only reading carries.
 * @param {{ findings: NewFinding[], verdictFor: (failures: number) => GateVerdict }} input
 *   `verdictFor` is the gate's own coverage verdict with `failures` filled in, so coverage still decides
 *   INCONCLUSIVE exactly as it did before #1504.
 * @returns {{ verdict: GateVerdict, exitCode: number, warning: string | null }}
 */
export function newFindingsVerdict({ findings, verdictFor }) {
  const { asserted, referred, unrecorded } = partitionByOutcome(findings);
  const verdict = verdictFor(asserted.length + unrecorded.length);
  const referralOnly = referred.length > 0 && asserted.length === 0 && unrecorded.length === 0;
  return { verdict, exitCode: exitCodeFor(verdict), warning: referralOnly ? referralWarning(referred) : null };
}

/**
 * NAMED, NOT SUMMARISED: the criterion, the page and what the screen reader opened on, for each one. A warning
 * that only gave a count would send the reader back to the log above it, which is the step this removes.
 * @param {NewFinding[]} referred
 */
function referralWarning(referred) {
  const named = referred.map((finding) =>
    `    ${finding.criterion}  ${finding.url.replace(/^https:\/\//, "")}\n           ${finding.evidence}\n`);
  return `  WARNING -- ${referred.length} NEW finding(s) on conformant pages, every one REFERRED and none ASSERTED.\n`
    + "  Referral noise does not fail this gate. Read each one's evidence; one that is right enters the baseline\n"
    + "  through the ordinary `--update` PR (`npm run rules:real-pages -- --update`), never as a side effect:\n"
    + named.join("");
}
