/**
 * Validate the deterministic absence rules (@a11y-witness/judge/rules) over the eval
 * fixtures. Exits non-zero if the rules produce ANY false positive on a
 * conformant page — precision is the whole point of a rule.
 *
 * Run: npm run rules-check
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ruleFindings, type RuleInput } from "@a11y-witness/judge/rules";
import { oracleCounts } from "@a11y-witness/evidence/verify";
import { EVAL_CASES } from "./cases.js";

const crit = (w: string): string => w.match(/(\d+\.\d+\.\d+)/)?.[1] ?? w;
const ID_WIDTH = 28; // padding for aligned case-id output

function main(): void {
  let cleanFP = 0;
  let caught = 0;
  let total = 0;
  const pending: string[] = [];
  for (const c of EVAL_CASES) {
    // Skip cases whose fixture is not captured yet (authored page awaiting the
    // NVDA worker) so the check runs on real transcripts only.
    if (!existsSync(c.fixture)) {
      pending.push(c.id);
      continue;
    }
    const data = JSON.parse(readFileSync(c.fixture, "utf8")) as RuleInput;
    // A fixture on disk is a raw capture, so the oracle counts have to be extracted here exactly as the
    // CLI extracts them — otherwise this check inside `eval:gate` cannot reach a census-reading rule.
    const crits = [...new Set(ruleFindings({ ...data, ...oracleCounts(data as never) }).map((f) => crit(f.wcag)))];
    const absence = c.expect.filter((x) => x === "1.1.1" || x === "4.1.2");
    if (c.expect.length === 0) cleanFP += crits.length;
    if (absence.length) {
      total++;
      if (absence.every((x) => crits.includes(x))) caught++;
    }
    const fp = c.expect.length === 0 && crits.length ? "  <-- FALSE POSITIVE" : "";
    console.log(`${c.expect.length ? "FAIL " : "CLEAN"} ${c.id.padEnd(ID_WIDTH)} rules=${JSON.stringify(crits)}${fp}`);
  }
  console.log(`\nAbsence cases fully caught: ${caught}/${total}  |  clean-page false positives: ${cleanFP}`);
  if (pending.length) console.log(`Pending capture (skipped): ${pending.join(", ")}`);
  if (cleanFP > 0) {
    console.error("FAIL: deterministic rules produced false positives on conformant pages");
    process.exit(1);
  }
}

/**
 * Run ONLY when this file is the program, never when it is imported — so a test can reach the logic above
 * without the script exiting the test runner via `process.exit(1)`. See `entry-points.test.ts`.
 */
const isProgram = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main();
