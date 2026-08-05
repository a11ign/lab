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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ruleFindings } from "@a11y-witness/judge/rules";

/**
 * Reported per SUBTYPE, not per criterion, because that is where the division of labour actually falls.
 *
 * The acceptance report marks whole criteria `"decisionOwner": "deterministic-rules"`, but
 * docs/local-model.md is narrower: the rules own "exact absence cases such as an unnamed control or
 * missing image alternative". Judgement subtypes -- is "image" a useful alt text, did a state change go
 * unannounced -- were never the rules' job, and the model has dedicated heads for them.
 *
 * Scoring by criterion therefore reads as a catastrophe when it is really a boundary: measured that way
 * the rules score 18.3% recall on 4.1.2, and every miss is a `missing-role` or `state-change-silent`
 * case they were never meant to catch. Per subtype, the same data says exactly who covers what -- and
 * makes visible any subtype covered by NEITHER layer.
 */
const RULE_OWNED = ["1.1.1", "4.1.2"];

/**
 * The subtypes the rules own EXACTLY, declared rather than inferred.
 *
 * Inferring ownership from "did any rule fire?" would be circular: a rule that broke completely would
 * read as a subtype the rules never owned, which is precisely the regression this gate exists to catch.
 * These four are the "exact absence" cases from docs/local-model.md -- no name, no alternative text, a
 * filename used as one. Everything else on 1.1.1/4.1.2 is a judgement the model's heads decide.
 *
 * Being deterministic, the bar for these is EXACT: one miss on real evidence is a defect, not variance.
 */
const RULE_OWNED_SUBTYPES = ["1.1.1:filename-alt", "1.1.1:missing-alt", "4.1.2:regex", "4.1.2:unnamed-form-field"];

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const DATA = resolve(process.cwd(), arg("data", "runs/screenreader-dataset/screenreader-evidence.jsonl"));
const GATE = process.argv.includes("--gate");

interface Record_ {
  input: { transcript?: string[] };
  target: { label: string; criteria: string[] };
  provenance: { caseId: string; variant: string; subtype: string };
}

function load(path: string): Record_[] {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line) as Record_);
}

const criteriaOf = (record: Record_): Set<string> =>
  new Set(ruleFindings(record.input as never).map((f) => f.wcag.match(/(\d+\.\d+\.\d+)/)?.[1] ?? f.wcag));

interface Tally {
  expected: number; caught: number; missed: string[];
  clean: number; falsePositives: string[];
}

function score(records: Record_[], criterion: string): Tally {
  const tally: Tally = { expected: 0, caught: 0, missed: [], clean: 0, falsePositives: [] };
  for (const record of records) {
    const found = criteriaOf(record).has(criterion);
    const shouldFind = record.target.criteria.includes(criterion);
    const id = `${record.provenance.caseId}.${record.provenance.variant}`;
    if (shouldFind) {
      tally.expected += 1;
      if (found) tally.caught += 1;
      else tally.missed.push(id);
    } else if (record.target.label === "clean") {
      // Only CONFORMANT records can produce a false positive. A bad variant demonstrating 4.1.2 may
      // legitimately also announce something a 1.1.1 rule fires on; counting that against the rule
      // would penalise it for the page having two real problems.
      tally.clean += 1;
      if (found) tally.falsePositives.push(id);
    }
  }
  return tally;
}

const records = load(DATA);
if (records.length === 0) {
  process.stderr.write(`No records at ${DATA}. Run npm run training:export first.\n`);
  process.exit(2);
}

console.log(`Rule-layer score over ${records.length} record(s) from ${DATA}\n`);
// Per-subtype breakdown first: it is the map, and the per-criterion numbers below are only meaningful
// once you can see which subtypes make them up.
const bySubtype = new Map<string, { total: number; caught: number }>();
for (const record of records) {
  if (record.target.label === "clean") continue;
  const criterion = record.target.criteria.find((c) => RULE_OWNED.includes(c));
  if (!criterion) continue;
  const key = `${criterion}:${record.provenance.subtype}`;
  const entry = bySubtype.get(key) ?? { total: 0, caught: 0 };
  entry.total += 1;
  if (criteriaOf(record).has(criterion)) entry.caught += 1;
  bySubtype.set(key, entry);
}
console.log("# coverage by subtype (who actually decides what)\n");
for (const [key, { total, caught }] of [...bySubtype.entries()].sort()) {
  const share = caught / total;
  const verdict = share === 1 ? "rules: EXACT"
    : share === 0 ? "rules: none — the model's heads own this subtype"
      : "rules: PARTIAL — a boundary this ragged is a defect either way";
  console.log(`  ${key.padEnd(34)} ${caught}/${total}  ${verdict}`);
}
console.log("");

let failures = 0;
for (const criterion of RULE_OWNED) {
  const t = score(records, criterion);
  const recall = t.expected ? t.caught / t.expected : 1;
  const precision = t.caught + t.falsePositives.length ? t.caught / (t.caught + t.falsePositives.length) : 1;
  console.log(`# ${criterion}`);
  console.log(`  recall     ${(recall * 100).toFixed(1)}%  (${t.caught}/${t.expected} failing records caught)`);
  console.log(`  precision  ${(precision * 100).toFixed(1)}%  (${t.falsePositives.length} false positive(s) over ${t.clean} conformant records)`);
  // Name them. A rate alone is not actionable, and the 1.1.1 misses turned out to share one cause --
  // which is only visible when the cases are listed.
  if (t.missed.length) console.log(`  MISSED     ${t.missed.slice(0, 6).join(", ")}${t.missed.length > 6 ? ` (+${t.missed.length - 6} more)` : ""}`);
  if (t.falsePositives.length) console.log(`  FALSE POS  ${t.falsePositives.slice(0, 6).join(", ")}${t.falsePositives.length > 6 ? ` (+${t.falsePositives.length - 6} more)` : ""}`);
  console.log("");
  // The rules are DETERMINISTIC and own these criteria absolutely, so the bar is exact: any miss or
  // false positive on real evidence is a defect, not variance. That is the whole reason a rule owns a
  // criterion instead of the judge.
  // False positives are gated at the criterion level: a conformant page must never be failed by a
  // deterministic rule, whichever subtype it belongs to.
  if (t.falsePositives.length) failures += 1;
}

for (const [key, { total, caught }] of [...bySubtype.entries()].sort()) {
  const owned = RULE_OWNED_SUBTYPES.includes(key);
  if (owned && caught < total) {
    console.log(`RULES: ${key} is rule-owned but caught only ${caught}/${total} — a deterministic rule missing real evidence is a defect.`);
    failures += 1;
  }
  // A subtype that is neither fully covered nor untouched means the boundary itself has moved, and
  // whichever side is wrong, nobody is reliably deciding those records.
  if (!owned && caught > 0 && caught < total) {
    console.log(`RULES: ${key} is PARTIAL (${caught}/${total}) — rules fire on some records of a subtype they do not own; the boundary is ragged.`);
    failures += 1;
  }
}

if (GATE && failures) {
  console.log(`RULES: FAIL — ${failures} rule-owned criterion/criteria have misses or false positives on real evidence.`);
  process.exitCode = 1;
} else if (GATE) {
  console.log("RULES: PASS — every rule-owned subtype is exact on real captured evidence, with no false positives.");
}
