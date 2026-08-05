import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  captureEvidenceText,
  evidenceUnits,
  signalMatches,
} from "./case-matrix.mjs";
import { hasUsableCaptureFiles } from "./capture-resume.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const CAPTURE_ROOT = resolve(ROOT, process.env.DATASET_CAPTURE_ROOT || "captures");
const PAGE_ROOT = resolve(ROOT, "pages");
const DEFAULT_OUTPUT = resolve(ROOT, "screenreader-evidence.jsonl");
const outputArg = process.argv.find((arg) => arg.startsWith("--out="));
const OUTPUT_PATH = resolve(process.cwd(), outputArg?.slice("--out=".length) || DEFAULT_OUTPUT);
const FORBIDDEN_INPUT_KEYS = ["url", "task", "html", "dom", "css", "axe", "diagnostics"];
const MODEL_EXCLUDED_SUBTYPES = new Set(["1.3.1:missing-landmark"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function capturePath(testCase, variant) {
  return resolve(CAPTURE_ROOT, testCase.id + "." + variant + ".json");
}

function readCapture(testCase, variant) {
  const path = capturePath(testCase, variant);
  return existsSync(path) ? readJson(path) : null;
}

function usableCapture(capture) {
  return capture && Array.isArray(capture.transcript) && capture.transcript.length > 0;
}

function validatePair(testCase, good, bad) {
  if (!usableCapture(good) || !usableCapture(bad)) {
    return { status: "skipped", reason: "missing or empty screen-reader capture" };
  }
  const badObserved = signalMatches(bad, testCase.badSignal);
  const goodContaminated = signalMatches(good, testCase.badSignal);
  if (!badObserved) return { status: "skipped", reason: "bad signal was not observable in NVDA output" };
  if (goodContaminated) return { status: "invalid", reason: "good control also contained the bad signal" };
  return { status: "observed" };
}

function modelInput(capture) {
  return {
    screenReader: capture.screenReader || "unknown",
    transcript: capture.transcript,
    structure: capture.structure || null,
    interaction: capture.interaction || null,
    evidenceUnits: evidenceUnits(capture),
    evidenceText: captureEvidenceText(capture),
  };
}

function assertModelBoundary(input, caseId) {
  const leaked = FORBIDDEN_INPUT_KEYS.filter((key) => Object.hasOwn(input, key));
  if (leaked.length) throw new Error(caseId + " leaked forbidden model input: " + leaked.join(", "));
}

function lifecycleProfile(capture) {
  const nvdaStart = (capture.diagnostics || []).find((event) => event.event === "nvdaStart");
  return typeof nvdaStart?.reused === "boolean"
    ? (nvdaStart.reused ? "nvda-reused" : "nvda-fresh")
    : "unspecified";
}

function workerEnvironment(capture) {
  return capture.environment && typeof capture.environment === "object" ? capture.environment : {};
}

function knownOr(value, fallback) {
  return value || fallback;
}

function captureEnvironment(capture) {
  const worker = workerEnvironment(capture);
  return {
    profile: lifecycleProfile(capture),
    screenReader: knownOr(worker.screenReader, capture.screenReader || "unknown"),
    screenReaderVersion: knownOr(worker.screenReaderVersion, null),
    browser: knownOr(worker.browser, null),
    browserVersion: knownOr(worker.browserVersion, null),
    guidepupVersion: knownOr(worker.guidepupVersion, null),
    nodeVersion: knownOr(worker.nodeVersion, null),
    windowsVersion: knownOr(worker.windowsVersion, null),
    workerCode: knownOr(worker.workerCode, null),
    worker: process.env.A11Y_WORKERS || process.env.A11Y_WORKER || "managed-local-vm",
  };
}

function record(testCase, variant, capture) {
  const isBad = variant === "bad";
  const subtype = testCase.subtype || testCase.badSignal.type;
  const input = modelInput(capture);
  assertModelBoundary(input, testCase.id);
  return {
    input,
    target: {
      label: isBad ? "violation" : "clean",
      criteria: isBad ? [testCase.criterion] : [],
      subtypes: isBad ? [testCase.criterion + ":" + subtype] : [],
    },
    provenance: {
      caseId: testCase.id,
      family: testCase.family || testCase.id,
      subtype,
      variant,
      source: testCase.source,
      mutation: testCase.mutation,
      capturedAt: capture.capturedAt || null,
      environment: captureEnvironment(capture),
    },
  };
}

function exportCases(manifest) {
  const records = [];
  const summary = { observed: 0, skipped: 0, invalid: 0, excluded: 0, records: 0, reasons: {} };
  for (const testCase of manifest.cases) {
    const good = readCapture(testCase, "good");
    const bad = readCapture(testCase, "bad");
    const result = hasUsableCaptureFiles({ id: testCase.id, captureRoot: CAPTURE_ROOT, pageRoot: PAGE_ROOT })
      ? validatePair(testCase, good, bad)
      : { status: "skipped", reason: "capture is missing, empty, or does not match current page/provenance" };
    summary[result.status]++;
    if (result.reason) summary.reasons[result.reason] = (summary.reasons[result.reason] || 0) + 1;
    if (result.status !== "observed") {
      console.log(testCase.id + ": " + result.status + " (" + result.reason + ")");
      continue;
    }
    const subtype = testCase.criterion + ":" + (testCase.subtype || testCase.badSignal.type);
    if (MODEL_EXCLUDED_SUBTYPES.has(subtype)) {
      summary.excluded++;
      summary.reasons["not inferable from screen-reader output alone"] =
        (summary.reasons["not inferable from screen-reader output alone"] || 0) + 1;
      console.log(testCase.id + ": excluded from model (" + subtype + ")");
      continue;
    }
    records.push(JSON.stringify(record(testCase, "good", good)));
    records.push(JSON.stringify(record(testCase, "bad", bad)));
    summary.records += 2;
    console.log(testCase.id + ": observed");
  }
  return { records, summary };
}

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("Missing " + MANIFEST_PATH + ". Run npm run training:generate first.");
  }
  const manifest = readJson(MANIFEST_PATH);
  const { records, summary } = exportCases(manifest);
  writeFileSync(OUTPUT_PATH, records.length ? records.join("\n") + "\n" : "", "utf8");
  const summaryPath = OUTPUT_PATH.replace(/\.jsonl$/i, ".summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log("Exported " + summary.records + " records to " + OUTPUT_PATH);
  console.log("Summary: " + summary.observed + " observed, " + summary.skipped + " skipped, " + summary.invalid + " invalid, " + summary.excluded + " excluded from model.");
}

main();
