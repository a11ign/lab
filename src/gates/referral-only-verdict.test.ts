/**
 * #1504: A REFERRED-ONLY READING WARNS AND EXITS 0; AN ASSERTED ONE STILL FAILS.
 *
 * `rules:real-pages` said "NOTHING WAS ASSERTED ... not a publish blocker" and exited 1 on the same run, and the
 * release gate reads the exit. These drive the decision the gate script now calls, over the three readings the
 * row names and the two edges beside them: a finding with no recorded outcome, and a coverage shortfall.
 *
 * THIS FILE IMPORTS ONLY `referral-only-verdict.mjs`. The gate script's import closure reaches the corpus, so
 * importing it here would make this Acceptance unrunnable in CI. `verdictFor` below therefore stands in for the
 * script's `coverageVerdict`, returning the shape `gateVerdict` returns and RECORDING the failure count it was
 * handed. That count is the thing #1504 changed, so every reading asserts it.
 *
 * Fixture pages are `.example` hosts: shaped like the gate's output, and unable to be a real conformant page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newFindingsVerdict, partitionByOutcome } from "./referral-only-verdict.mjs";

type Input = Parameters<typeof newFindingsVerdict>[0];
type Finding = Input["findings"][number];
type Verdict = ReturnType<Input["verdictFor"]>;

const SOURCE = "three conformant fixture pages";

/** Full coverage: FAIL on any failure, else PASS -- recording each failure count it is asked about. */
function fullCoverage(seen: number[]): Input["verdictFor"] {
  return (failures: number): Verdict => {
    seen.push(failures);
    return failures > 0
      ? { verdict: "FAIL", examined: 3, of: 3, source: SOURCE, failures,
        why: `${failures} problem(s) across 3 of 3 from ${SOURCE}` }
      : { verdict: "PASS", examined: 3, of: 3, source: SOURCE, failures,
        why: `all 3 of 3 from ${SOURCE} examined and clean` };
  };
}

function finding(criterion: string, url: string, outcome: Finding["outcome"]): Finding {
  return { criterion, url, outcome,
    evidence: `census heading=7 link=38 graphic=2 graphicUnnamed=0; 89 announcement(s)\n`
      + `           opens: "heading, level 2, fixture banner on ${url}"` };
}

const ASSERTED = finding("1.1.1", "https://conformant-a.example/", "ASSERTED");
const REFERRED_B = finding("1.4.13", "https://conformant-b.example/search?query=", "REFERRED");
const REFERRED_C = finding("1.1.1", "https://conformant-c.example/modes/", "REFERRED");

test("#1504 asserted: a NEW ASSERTED finding still fails -- exit 1, no warning, even beside a referral", () => {
  const seen: number[] = [];
  const decision = newFindingsVerdict({ findings: [ASSERTED, REFERRED_B], verdictFor: fullCoverage(seen) });
  assert.deepEqual(seen, [1], "the ASSERTED finding is the one failure; the referral beside it is not counted");
  assert.equal(decision.verdict.verdict, "FAIL");
  assert.equal(decision.exitCode, 1);
  assert.equal(decision.warning, null, "an asserted reading is a failure, never a warning");
});

test("#1504 referred-only: a NEW REFERRED-only reading exits 0 with a named WARNING", () => {
  const seen: number[] = [];
  const decision = newFindingsVerdict({ findings: [REFERRED_B, REFERRED_C], verdictFor: fullCoverage(seen) });
  assert.deepEqual(seen, [0], "no referral is a failure -- the count #1504 changed");
  assert.equal(decision.verdict.verdict, "PASS");
  assert.equal(decision.exitCode, 0);
  const warning = decision.warning ?? "";
  assert.match(warning, /^ {2}WARNING -- 2 NEW finding\(s\) on conformant pages, every one REFERRED and none ASSERTED\.\n/,
    "the warning names itself and carries the count");
  for (const f of [REFERRED_B, REFERRED_C]) {
    assert.ok(warning.includes(`    ${f.criterion}  ${f.url.replace(/^https:\/\//, "")}\n`),
      `the warning names ${f.criterion} on ${f.url}`);
    assert.ok(warning.includes(`opens: "heading, level 2, fixture banner on ${f.url}"`),
      `the warning carries the opens: line for ${f.url}`);
  }
  assert.match(warning, /the ordinary `--update` PR \(`npm run rules:real-pages -- --update`\)/,
    "the warning names the --update PR as the route into the baseline");
});

test("#1504 none: no new finding exits 0 and prints no warning", () => {
  const seen: number[] = [];
  const decision = newFindingsVerdict({ findings: [], verdictFor: fullCoverage(seen) });
  assert.deepEqual(seen, [0]);
  assert.equal(decision.verdict.verdict, "PASS");
  assert.equal(decision.exitCode, 0);
  assert.equal(decision.warning, null, "silent: a clean reading carries no warning");
});

test("#1504: a finding with no recorded outcome is not a referral -- it still fails, with no warning", () => {
  const seen: number[] = [];
  const unrecorded = finding("2.4.6", "https://conformant-d.example/", "UNRECORDED");
  const decision = newFindingsVerdict({ findings: [REFERRED_B, unrecorded], verdictFor: fullCoverage(seen) });
  assert.deepEqual(seen, [1]);
  assert.equal(decision.exitCode, 1);
  assert.equal(decision.warning, null, "a reading with an unscored finding is not referral-only");
});

test("#1504: coverage still decides INCONCLUSIVE -- a referral-only reading on a short run exits 2 and still warns", () => {
  const seen: number[] = [];
  const short: Input["verdictFor"] = (failures) => {
    seen.push(failures);
    return { verdict: "INCONCLUSIVE", examined: 2, of: 3, source: SOURCE, failures,
      why: `only 2 of 3 from ${SOURCE} were examined, so this says nothing about the rest` };
  };
  const decision = newFindingsVerdict({ findings: [REFERRED_B], verdictFor: short });
  assert.deepEqual(seen, [0]);
  assert.equal(decision.exitCode, 2, "#1504 moves what a referral is worth, never what a shortfall is");
  assert.match(decision.warning ?? "", /WARNING -- 1 NEW finding\(s\)/);
});

test("#1504: partitionByOutcome puts each finding in exactly one of the three, and the count line reads it", () => {
  const unrecorded = finding("2.4.6", "https://conformant-d.example/", "UNRECORDED");
  const all = [ASSERTED, REFERRED_B, REFERRED_C, unrecorded];
  const { asserted, referred, unrecorded: none } = partitionByOutcome(all);
  assert.deepEqual(asserted, [ASSERTED]);
  assert.deepEqual(referred, [REFERRED_B, REFERRED_C]);
  assert.deepEqual(none, [unrecorded]);
  assert.equal(asserted.length + referred.length + none.length, all.length);
});
