import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  captureEvidenceText,
  CASES,
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
// Subtypes the model must not be trained on, because the evidence it is allowed to see cannot express
// them. Both entries are excluded for the reason the summary prints: "not inferable from screen-reader
// output alone".
//
// `4.1.2:missing-role` is a role-less `<div onclick>` styled as a button. The screen reader CANNOT
// perceive it -- that is the failure -- so to NVDA a page with a fake button and a page with no button
// are the same page. Its 74 records all announce `formFields: []` and `controls: []`, and so do 437 of
// the corpus's 1,003 conformant records, because a page about images or tables has no controls either.
//
// Both attempts to close that gap from screen-reader evidence were measured and both failed in the
// direction that matters. Instance-max pooling reached precision 1.000 at recall 0.824 -- 13 misses.
// Document-mean reached recall 1.000 at precision 0.782 -- 21 false positives on CONFORMANT pages,
// which is this tool's worst error, on a synthetic corpus far cleaner than the web. The only remaining
// signal is "that bare line LOOKS like a button label", which on real pages (nav text, badges,
// captions, prices) is a false-positive machine and would be learning this generator's phrasing.
//
// This is not a permanent verdict, it is a statement about the EVIDENCE. The fact "this element
// responds to clicks, exposes no role, and cannot be reached by keyboard" is deterministic and
// obtainable over the CDP socket the capture already opens. Once captured it belongs to the RULE layer,
// which is exact on 1,003 conformant records, and not to a head guessing from prose. `modelInput()` is
// an allowlist and FORBIDDEN_INPUT_KEYS names `dom` explicitly, so a rule may use evidence the model
// never sees -- the same split already made for `landmarks`, which "stays in the capture and stays
// available to the dataset signals". That work needs a CAPTURE_PROTOCOL_VERSION bump and a recapture,
// so it is deliberate and scheduled rather than smuggled in here.
//
// Declared in `packages/lab/rule-ownership.json` too, so "nobody decides this" stays VISIBLE. Dropping
// the records silently would make 4.1.2 read as fully covered while one of its three failure modes went
// unchecked -- and unchecked is not clean.
//
// `3.3.2:placeholder-only` joined them 2026-08-23 (ADR 0018), and for the same reason stated differently:
// when a field has no label the BROWSER uses the placeholder as its accessible name, so NVDA announces
// `<input placeholder="Email address">` exactly as it announces `<label>Email address</label><input>` —
// "Email address, edit", identical words in identical order. The difference exists only in the DOM, which
// is axe-core's layer; this tool runs alongside it, not instead of it.
//
// The head trained on it produced eight false accusations on conformant pages, because there is no
// placeholder feature at all (encoder weight mass 598.9 against 9.26 for every document feature combined)
// and it had learned the corpus's placeholder WORDING — firing on 4 of the 6 clean pages containing
// "Example value" and 0 of the 34 without. The corpus could express the property because it KNOWS what it
// wrote; the screen reader cannot hear it. That asymmetry is the whole finding.
const MODEL_EXCLUDED_SUBTYPES = new Set([
  "1.3.1:missing-landmark", "4.1.2:missing-role", "3.3.2:placeholder-only",
]);

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
      // `alsoFails` names a criterion AND the subtype whose head carries it ("4.1.2:missing-role"),
      // because the grouped criterion decision is COMPUTED FROM the subtype heads. A criterion label
      // with no matching subtype is a positive nothing can predict — a structurally unreachable
      // ground truth. Adding one produced 88 guaranteed false negatives, which is how this was found.
      criteria: isBad
        ? [testCase.criterion, ...(testCase.alsoFails ?? []).map((s) => s.split(":")[0])]
        : [],
      subtypes: isBad
        ? [testCase.criterion + ":" + subtype, ...(testCase.alsoFails ?? [])]
        : [],
      // Empty for a GENERATED case, and that is a real claim rather than a default: we wrote the page, so
      // we know every criterion's status. Only a real page whose publisher claimed less than everything
      // carries entries here -- see `build-realism-tier.mjs` and `known_indices` in the trainer.
      unknownSubtypes: [],
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

/** Stable JSON, so a key-order difference cannot read as a changed value. */
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

/**
 * Does the manifest still describe the cases the code defines?
 *
 * THE EXPORT READS THE MANIFEST, NOT `CASES`, and that indirection has now cost two full cycles in one
 * session. `probeFocus: true` was added to a case and the capture ran without the probe; then the case's
 * `subtype` was corrected and the export still emitted the old one, producing the key
 * `2.1.2:2.1.2:focus-trapped` that `rules:gate` rejected from both sides at once. Both times every check
 * was green, because the manifest and the captures agreed with each other perfectly -- they were simply
 * describing case definitions that no longer existed.
 *
 * Which of the two is authoritative is genuinely ambiguous, so this REPORTS rather than picking: the
 * manifest is what the captures were taken under, and `CASES` is what the code now means. A label that
 * disagrees with the code is not a label anyone can act on, so it fails and names the fields.
 *
 * `pages` is manifest-only (it records where the files were written), and the probe flags are compared
 * because they decide what evidence the capture even contains -- that was the first of the two faults.
 */
function assertManifestMatchesCases(manifest) {
  const defined = new Map(CASES.map((testCase) => [testCase.id, testCase]));
  // A manifest that shares NO id with `CASES` is not a stale corpus, it is a different case set -- a test
  // fixture, or an archived corpus exported deliberately via DATASET_ROOT. Comparing it would reject a
  // supported use, and "every id is missing" is not the drift this guards against.
  //
  // Said out loud rather than returned in silence, because a guard that skips quietly is indistinguishable
  // from one that never ran -- the mistake `refreshBrowseBuffer` made while three green checks vouched for
  // it. The real corpus shares 1,062 ids, so this branch cannot hide a stale manifest.
  const overlap = manifest.cases.filter((entry) => defined.has(entry.id)).length;
  if (overlap === 0) {
    console.log("Manifest shares no case id with CASES (" + manifest.cases.length
      + " entries); not comparing definitions.");
    return;
  }
  const drifted = [];
  for (const entry of manifest.cases) {
    const testCase = defined.get(entry.id);
    if (!testCase) { drifted.push(entry.id + ": in the manifest, not in CASES"); continue; }
    for (const field of Object.keys(entry)) {
      if (field === "pages") continue;
      const was = canonicalJson(entry[field]);
      const now = canonicalJson(testCase[field]);
      if (was !== now) drifted.push(`${entry.id}.${field}: manifest=${was} CASES=${now}`);
    }
  }
  for (const id of defined.keys()) {
    if (!manifest.cases.some((entry) => entry.id === id)) drifted.push(id + ": in CASES, not in the manifest");
  }
  if (!drifted.length) return;
  const NAMED = 8; // enough to see the pattern; the count tells you the scale
  throw new Error("The manifest describes case definitions that no longer match CASES, so the export "
    + "would label captures using the old ones.\n  "
    + drifted.slice(0, NAMED).join("\n  ")
    + (drifted.length > NAMED ? `\n  ... and ${drifted.length - NAMED} more` : "")
    + "\nRegenerate it: node packages/lab/src/training/generate-screenreader-dataset.mjs"
    + "\n(Page files are rewritten byte-identically unless a page actually changed, so this does not "
    + "invalidate captures on its own.)");
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
  assertManifestMatchesCases(manifest);
  const { records, summary } = exportCases(manifest);
  writeFileSync(OUTPUT_PATH, records.length ? records.join("\n") + "\n" : "", "utf8");
  const summaryPath = OUTPUT_PATH.replace(/\.jsonl$/i, ".summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log("Exported " + summary.records + " records to " + OUTPUT_PATH);
  console.log("Summary: " + summary.observed + " observed, " + summary.skipped + " skipped, " + summary.invalid + " invalid, " + summary.excluded + " excluded from model.");
}

// Only when RUN, never on import. CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check
// that an .mjs file still loads -- neither lint nor tsc can see a ReferenceError at import -- and unguarded
// that mandated check EXECUTES this script. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
