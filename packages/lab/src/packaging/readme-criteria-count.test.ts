/**
 * #1332: README'S TWO SCORER-COUNT SENTENCES CARRY NUMBERS DERIVED FROM THE REPORT THAT COMPUTES THEM.
 *
 * The V1 rehearsal (#915, section e, item 6) found three counts of what the scorer covers: `docs/github-action.md`
 * said "eight criteria", README said "6 of 16", and the run printed "This layer covers 20 criteria". #1353 fixed
 * the first. On `origin/main` at `5bf38847` README still said "the 6 of 16 criteria it currently reaches the report
 * for" (line 107) and "out of 16 it has a head for" (line 423), while the shipped
 * `acceptance-report.json` has 17 criteria, every one with a head.
 *
 * TWO QUANTITIES, KEPT APART. Both sentences state the scorer's HELD-OUT ACCEPTANCE: the criteria the trained model
 * is evaluated on (`modelEvaluated: true`) and the true/false positives and negatives summed over those. The run's
 * "This layer covers N criteria" is a different quantity -- every criterion the layer covers, rules and scorer
 * heads together, overlapping -- and line 423 already says so. Line 107's "reaches the report for" read as that
 * second quantity, which is why its number looked contradicted.
 *
 * The sentences are found by the same substrings `public-claim.test.ts` exempts them by, so an edit that moves
 * either sentence out of that exemption also moves it out of this check -- and this check says so rather than
 * passing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const REPORT = "packages/scorer/models/screenreader-scorer/acceptance-report.json";

type CriterionEntry = { modelEvaluated?: boolean; truePositive?: number; falsePositive?: number; falseNegative?: number };
type AcceptanceReport = { criteria: Record<string, CriterionEntry> };

/** What the report computes: heads, the criteria the model is evaluated on, and the outcomes summed over those. */
export function heldOutAcceptance(report: AcceptanceReport) {
  const entries = Object.values(report.criteria);
  const evaluated = entries.filter((entry) => entry.modelEvaluated === true);
  const sum = (key: "truePositive" | "falsePositive" | "falseNegative") =>
    evaluated.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  return {
    heads: entries.length,
    evaluated: evaluated.length,
    ruleDecided: entries.length - evaluated.length,
    truePositive: sum("truePositive"),
    falsePositive: sum("falsePositive"),
    falseNegative: sum("falseNegative"),
  };
}

type Expected = ReturnType<typeof heldOutAcceptance>;

/**
 * Each sentence: the substring that finds its line (the one `public-claim.test.ts` exempts it by), and the pattern
 * that reads its figures, in order, with the report quantity each figure must equal.
 */
const SENTENCES: { name: string; findBy: string; pattern: RegExp; figures: (keyof Expected)[] }[] = [
  {
    name: "README's part-3 table row (line 107 at 5bf38847)",
    findBy: "judges screen-reader evidence against WCAG",
    pattern: /Held-out acceptance is (\d+) true positives, (\d+) false positives, (\d+) false negatives across the (\d+) criteria the trained model is evaluated on, of the (\d+) it has a head for; see \[Part 3\]\([^)]*\) for why the deterministic rules decide the other (\d+)/,
    figures: ["truePositive", "falsePositive", "falseNegative", "evaluated", "heads", "ruleDecided"],
  },
  {
    name: "README's scorer section (line 423 at 5bf38847)",
    findBy: "runs through the `applyGate` seam",
    pattern: /Held-out acceptance is currently (\d+) true positives, (\d+) false positives, (\d+) false negatives across the (\d+) criteria the shipped model scores today, out of (\d+) it has a head for \(`packages\/scorer\/models\/screenreader-scorer\/acceptance-report\.json`\)/,
    figures: ["truePositive", "falsePositive", "falseNegative", "evaluated", "heads"],
  },
];

/** Every place README's figures disagree with the report, or a sentence could not be found at all. */
export function readmeCountMismatches(readme: string, report: AcceptanceReport): string[] {
  const expected = heldOutAcceptance(report);
  const lines = readme.split("\n");
  return SENTENCES.flatMap(({ name, findBy, pattern, figures }) => {
    const found = lines.filter((line) => line.includes(findBy));
    if (found.length !== 1) return [`${name}: ${found.length} lines contain "${findBy}" -- expected exactly one`];
    const match = pattern.exec(found[0]);
    if (!match) return [`${name}: the held-out sentence no longer reads as this check expects -- update the check to find it, not to pass`];
    return figures.flatMap((key, index) => (Number(match[index + 1]) === expected[key]
      ? [] : [`${name}: says ${match[index + 1]} for ${key}, the report computes ${expected[key]}`]));
  });
}

const realReadme = () => readFileSync(path.join(REPO, "README.md"), "utf8");
const realReport = (): AcceptanceReport => JSON.parse(readFileSync(path.join(REPO, REPORT), "utf8"));

test("#1332 ACCEPTANCE: README's two held-out sentences carry the numbers acceptance-report.json computes", () => {
  const report = realReport();
  const expected = heldOutAcceptance(report);
  // POSITIVE CONTROL on the population: an empty report computes zeros that an empty README pattern cannot match,
  // so the report must really have heads and evaluated criteria for "no mismatches" to mean anything.
  assert.ok(expected.heads > 0 && expected.evaluated > 0, `the report was read: ${JSON.stringify(expected)}`);
  assert.deepEqual(readmeCountMismatches(realReadme(), report), []);
});

test("#1332 POSITIVE CONTROL: a report with one more head, or one criterion no longer evaluated, fails the check", () => {
  const report = realReport();
  const readme = realReadme();
  const oneMoreHead: AcceptanceReport = { criteria: { ...report.criteria, "9.9.9": { modelEvaluated: false } } };
  const moreHeads = readmeCountMismatches(readme, oneMoreHead);
  assert.ok(moreHeads.some((m) => m.startsWith("README's part-3 table row") && m.includes("for heads")), JSON.stringify(moreHeads));
  assert.ok(moreHeads.some((m) => m.startsWith("README's scorer section") && m.includes("for heads")), JSON.stringify(moreHeads));
  assert.ok(moreHeads.some((m) => m.includes("for ruleDecided")), "and line 107's 'the other N'");

  const evaluatedId = Object.keys(report.criteria).find((id) => report.criteria[id].modelEvaluated === true);
  assert.ok(evaluatedId, "the report has an evaluated criterion to flip");
  const oneFewerEvaluated: AcceptanceReport = { criteria: { ...report.criteria,
    [evaluatedId]: { ...report.criteria[evaluatedId], modelEvaluated: false } } };
  const fewer = readmeCountMismatches(readme, oneFewerEvaluated);
  assert.ok(fewer.some((m) => m.includes("for evaluated")), JSON.stringify(fewer));
  assert.ok(fewer.some((m) => m.includes("for truePositive")), "the true positives are summed over the evaluated criteria");
});

test("#1332: a sentence that moved or was reworded is reported, never passed", () => {
  const report = realReport();
  const reworded = realReadme().replace("the trained model is evaluated on", "the model reaches");
  assert.ok(readmeCountMismatches(reworded, report).some((m) => m.includes("no longer reads as this check expects")));
  const gone = realReadme().split("\n").filter((line) => !line.includes("runs through the `applyGate` seam")).join("\n");
  assert.ok(readmeCountMismatches(gone, report).some((m) => m.includes("0 lines contain")));
});

test("#1332: line 107 names the quantity, and line 423 still says the run's summary counts something different", () => {
  const lines = realReadme().split("\n");
  const row = lines.find((line) => line.includes("judges screen-reader evidence against WCAG")) ?? "";
  assert.doesNotMatch(row, /reaches the report for/,
    "the phrase that read as the layer's coverage (the run's larger count) rather than held-out acceptance");
  const section = lines.find((line) => line.includes("runs through the `applyGate` seam")) ?? "";
  assert.match(section, /counts something different: every criterion the layer covers, deterministic rules and scorer heads together, overlapping/,
    "the sentence that tells the two quantities apart stays beside the numbers");
});
