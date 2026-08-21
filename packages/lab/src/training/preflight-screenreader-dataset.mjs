import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CASES } from "./case-matrix.mjs";
import { ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const EXPECTED_CASES = process.env.DATASET_KIND === "acceptance" ? ACCEPTANCE_CASES : CASES;
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const REPORT_PATH = resolve(ROOT, "preflight.json");
const REQUIRED_HTML = "<!doctype html>";
const KNOWN_SIGNALS = new Set([
  "regex",
  "structure-empty",
  "missing-heading",
  "missing-role",
  "state-change-silent",
  "form-activation-silent",
  "table-unassociated",
  "unnamed-form-field",
  "validation-error-silent",
  "placeholder-only",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function metadataErrors(testCase) {
  const errors = [];
  if (!/^\d+\.\d+\.\d+$/.test(testCase.criterion)) errors.push("invalid criterion");
  if (!testCase.task || !testCase.source || !testCase.mutation) errors.push("missing label metadata");
  if (!KNOWN_SIGNALS.has(testCase.badSignal?.type)) errors.push("unknown bad signal");
  if (testCase.badSignal?.type === "table-unassociated" && testCase.probeTables !== true) {
    errors.push("table-unassociated requires probeTables");
  }
  return errors;
}

function variantErrors(testCase, manifestCase, variant) {
  const html = testCase[variant];
  const path = manifestCase?.pages?.[variant] ? resolve(ROOT, manifestCase.pages[variant]) : "";
  const errors = [];
  if (!html || !html.includes(REQUIRED_HTML)) errors.push(variant + " is not a complete HTML instrument");
  if (!path || !existsSync(path)) errors.push(variant + " page is missing");
  if (html.includes("<script src=")) errors.push(variant + " loads an external script");
  if (!html.includes("<html lang=\"en\">")) errors.push(variant + " has no English language declaration");
  return errors;
}

function assertCase(testCase, manifestCase) {
  const errors = metadataErrors(testCase);
  if (!manifestCase || manifestCase.id !== testCase.id) errors.push("manifest mismatch");
  for (const variant of ["good", "bad"]) errors.push(...variantErrors(testCase, manifestCase, variant));
  if (testCase.good === testCase.bad) errors.push("good and bad instruments are identical");
  return errors;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function probeName({ probeForms, probeTables }) {
  const probes = [];
  if (probeForms) probes.push("interaction");
  if (probeTables) probes.push("table");
  return probes.length ? probes.join("+") + "-probe" : "read-through-only";
}

function buildReport(manifest) {
  const results = EXPECTED_CASES.map((testCase) => ({
    id: testCase.id,
    errors: assertCase(testCase, manifest.cases.find(({ id }) => id === testCase.id)),
  }));
  const errors = results.flatMap(({ id, errors: caseErrors }) => caseErrors.map((error) => id + ": " + error));
  return {
    schema: "a11y-witness/screen-reader-dataset-preflight",
    generatedAt: new Date().toISOString(),
    status: errors.length ? "failed" : "ready-for-NVDA-capture",
    note: "This report validates page instruments and metadata only; it is not screen-reader evidence.",
    cases: EXPECTED_CASES.length,
    families: countBy(EXPECTED_CASES.map(({ family }) => family)),
    criteria: countBy(EXPECTED_CASES.map(({ criterion }) => criterion)),
    signalTypes: countBy(EXPECTED_CASES.map(({ badSignal }) => badSignal.type)),
    probes: countBy(EXPECTED_CASES.map(probeName)),
    errors,
  };
}

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("Missing " + MANIFEST_PATH + ". Run npm run training:generate first.");
  }
  const manifest = readJson(MANIFEST_PATH);
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== EXPECTED_CASES.length) {
    throw new Error("Manifest case count does not match the source case matrix.");
  }
  const report = buildReport(manifest);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("Preflight: " + report.status);
  console.log("Cases: " + report.cases + "; criteria: " + JSON.stringify(report.criteria));
  console.log("Report: " + REPORT_PATH);
  if (report.errors.length) {
    for (const error of report.errors) console.error("  " + error);
    process.exitCode = 1;
  }
}

// Only when RUN, never on import. CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check
// that an .mjs file still loads -- neither lint nor tsc can see a ReferenceError at import -- and unguarded
// that mandated check EXECUTES this script. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
