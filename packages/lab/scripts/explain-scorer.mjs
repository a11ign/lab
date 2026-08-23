/**
 * Why did the scorer decide that? — the question this project asks after every surprising result.
 *
 * Written after a day in which it was answered five times by hand, with five throwaway scripts that each
 * re-derived the same joins: report -> criterion -> subtype -> head -> weights -> features -> the
 * announcements underneath. Every one of those scripts was deleted, so the sixth investigation started
 * from nothing again. The commands:
 *
 *   npm run scorer:explain -- --compare a,b              two models, criterion by criterion
 *   npm run scorer:explain -- --model=m --criterion=2.4.4  which cases failed, and their scores
 *   npm run scorer:explain -- --model=m --case=<id>       one case: label, features, evidence
 *   npm run scorer:explain -- --model=m --weights=3.3.2:unnamed-form-field
 *
 * Read-only. It runs no training, writes nothing, and touches no shipped artefact — so it can be pointed
 * at a release candidate mid-investigation without changing what is being investigated.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNS = resolve(process.cwd(), process.env.RUNS_ROOT || "runs");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const listArg = (name) => (arg(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A model's acceptance report, or a clear explanation of what is missing. */
function acceptance(model) {
  const path = resolve(RUNS, `model-${model}`, "acceptance-report.json");
  if (!existsSync(path)) {
    const have = existsSync(RUNS) ? readdirSync(RUNS).filter((d) => d.startsWith("model-")) : [];
    throw new Error(`no acceptance report for '${model}' at ${path}\n`
      + `models with a runs/ directory here: ${have.join(", ") || "(none)"}\n`
      + "Score one first:  npm run lab:job -- -e job=acceptance -e out=<name>");
  }
  return readJson(path);
}

/** Per-criterion counts, for the models named. The table this project keeps rebuilding. */
export function compareTable(reports) {
  const criteria = [...new Set(reports.flatMap(([, r]) =>
    Object.entries(r.criteria).filter(([, c]) => c.modelEvaluated).map(([n]) => n)))].sort();
  const lines = [`${"criterion".padEnd(10)}${reports.map(([n]) => n.padEnd(24)).join("")}`];
  for (const name of criteria) {
    let row = name.padEnd(10);
    for (const [, report] of reports) {
      const c = report.criteria[name];
      row += (c ? `TP${c.truePositive} FP${c.falsePositive} FN${c.falseNegative}` : "-").padEnd(24);
    }
    lines.push(row);
  }
  lines.push("");
  for (const [name, report] of reports) {
    const totals = Object.values(report.criteria).filter((c) => c.modelEvaluated);
    const fp = totals.reduce((n, c) => n + c.falsePositive, 0);
    const fn = totals.reduce((n, c) => n + c.falseNegative, 0);
    // FALSE ALARMS FIRST, deliberately. A false positive is an accusation someone may budget against or be
    // challenged over; a miss is a gap. Ranking models on total errors alone once made 8 false accusations
    // look like an improvement on 12 misses.
    lines.push(`${name.padEnd(24)} false alarms=${fp}  misses=${fn}   `
      + (fp === 0 ? "no false accusations" : "NOT SHIPPABLE: it accuses conformant pages"));
  }
  return lines;
}

/** Which cases a criterion got wrong, named, with the cut that decided them. */
export function criterionDetail(report, criterion) {
  const c = report.criteria?.[criterion];
  if (!c) return [`no criterion '${criterion}' in this report`];
  if (!c.modelEvaluated) return [`${criterion} is not model-evaluated here (decisionOwner: ${c.decisionOwner})`];
  const lines = [`${criterion}  owner=${c.decisionOwner}  thresholds=${JSON.stringify(c.subtypeThresholds)}`,
    `  records=${c.records} positive=${c.positive} clean=${c.clean}`,
    `  TP=${c.truePositive} FP=${c.falsePositive} FN=${c.falseNegative}`];
  for (const [key, label] of [["falsePositiveCases", "FALSE ALARM"], ["falseNegativeCases", "MISS"]]) {
    for (const id of [...new Set(c[key] ?? [])]) lines.push(`  ${label.padEnd(12)} ${id}`);
    if (c[`${key}Truncated`]) lines.push(`  ...and ${c[`${key}Truncated`]} more not listed`);
  }
  if (!c.falsePositive && !c.falseNegative) lines.push("  (nothing wrong on this criterion)");
  return lines;
}

/** A head's document-feature weights, largest magnitude first — where a decision actually comes from. */
export function weightTable(report, subtype, weights, featureNames) {
  for (const criterion of Object.values(report.criteria ?? {})) {
    for (const [name, sub] of Object.entries(criterion.subtypes ?? {})) {
      if (name !== subtype) continue;
      const vec = weights[`${sub.head}.weight`];
      const doc = vec.slice(vec.length - featureNames.length);
      const ranked = featureNames.map((n, i) => [n, doc[i]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      return [`${subtype}  head=${sub.head}  pooling=${sub.pooling ?? "document-mean"}  threshold=${sub.threshold}`,
        ...ranked.slice(0, 10).map(([n, v]) => `  ${n.padEnd(34)} ${v >= 0 ? "+" : ""}${v.toFixed(3)}`)];
    }
  }
  return [`no subtype '${subtype}' in this training report`];
}

function main() {
  const compare = listArg("compare");
  if (compare.length) {
    process.stdout.write(`${compareTable(compare.map((m) => [m, acceptance(m)])).join("\n")}\n`);
    return;
  }
  const model = arg("model");
  if (!model) {
    process.stderr.write("usage: --compare a,b | --model=<name> [--criterion=X | --case=<id>]\n");
    process.exit(2);
  }
  const criterion = arg("criterion");
  if (criterion) {
    process.stdout.write(`${criterionDetail(acceptance(model), criterion).join("\n")}\n`);
    return;
  }
  const report = acceptance(model);
  const worst = Object.entries(report.criteria)
    .filter(([, c]) => c.modelEvaluated && (c.falsePositive || c.falseNegative))
    .sort((a, b) => b[1].falsePositive - a[1].falsePositive);
  process.stdout.write(worst.length
    ? `${worst.flatMap(([n]) => criterionDetail(report, n)).join("\n")}\n`
    : "every model-evaluated criterion is clean on this report\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
