// Prove every badSignal can actually tell a good page from a bad one.
//
//   npm run training:check-signals
//
// Why this exists: a signal is instrumentation, and we were validating captures while never
// validating the instruments. The first full dataset run captured all 45 pairs and exported
// only 30 — 11 signals never fired on the bad page, and 4 fired on the GOOD one, which is
// worse because a signal that flags both sides discriminates nothing. Every one of those was
// detectable from the first captured pair; instead it took 94 minutes of capture to find out.
//
// This runs against captures already on disk, so it costs no worker time. Two distinct
// verdicts, because they need different fixes:
//
//   BLIND        the signal did not fire on the bad page — usually the pattern describes
//                what we assumed NVDA says rather than what it says
//   CONTAMINATED the signal fired on the good page — the instrument is wrong, not the page
//
// Run it after any change to a probe's output shape. A probe and its signal are coupled:
// when the disclosure probe changed to re-read the control, `after` stopped being empty and
// the signal that tested for emptiness silently stopped working.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { signalMatches } from "./case-matrix.mjs";
import { hasUsableCaptureFiles } from "./capture-resume.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const CAPTURE_ROOT = resolve(ROOT, process.env.DATASET_CAPTURE_ROOT || "captures");
const PAGE_ROOT = resolve(ROOT, "pages");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const EVIDENCE_LINES = 4;

function capturePath(id, variant) {
  return resolve(CAPTURE_ROOT, id + "." + variant + ".json");
}

function readCapture(id, variant) {
  const path = capturePath(id, variant);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

// The fields a signal could plausibly be reading, so a failure report shows where the
// evidence actually is rather than making someone open two JSON files to find out.
function evidenceFor(capture, signal) {
  const lines = [];
  const add = (label, values) => {
    if (values?.length) lines.push(`      ${label}: ${JSON.stringify(values.slice(0, EVIDENCE_LINES))}`);
  };
  if (signal.type === "state-change-silent") add("stateChanges", capture.interaction?.stateChanges);
  else if (signal.type === "form-activation-silent") {
    add("formChanges", capture.interaction?.formChanges);
    add("postSubmitFields", capture.interaction?.postSubmitFields);
  } else if (signal.type === "structure-empty" || signal.type === "missing-heading") {
    add("headings", capture.structure?.headings);
    add("formFields", capture.structure?.formFields);
  } else {
    add("transcript", capture.transcript);
    add("formFields", capture.structure?.formFields);
  }
  return lines;
}

function describeSignal(signal) {
  const detail = signal.pattern ?? signal.text ?? signal.field ?? signal.control ?? "";
  return signal.type + (detail ? ` (${detail})` : "");
}

function checkCase(testCase) {
  const good = readCapture(testCase.id, "good");
  const bad = readCapture(testCase.id, "bad");
  if (!good || !bad) return { id: testCase.id, verdict: "NO CAPTURES" };
  if (!hasUsableCaptureFiles({ id: testCase.id, captureRoot: CAPTURE_ROOT, pageRoot: PAGE_ROOT })) {
    return { id: testCase.id, verdict: "STALE CAPTURES" };
  }

  const firesOnBad = signalMatches(bad, testCase.badSignal);
  const firesOnGood = signalMatches(good, testCase.badSignal);
  // Order matters: CONTAMINATED is the more serious diagnosis, so report it even when the
  // signal also fires on the bad page. "Fires on both" is not a half-working signal.
  if (firesOnGood) return { id: testCase.id, verdict: "CONTAMINATED", good, bad, firesOnBad };
  if (!firesOnBad) return { id: testCase.id, verdict: "BLIND", good, bad };
  return { id: testCase.id, verdict: "OK" };
}

function report(result, testCase) {
  if (result.verdict === "OK") {
    console.log(`  OK            ${result.id}`);
    return 0;
  }
  if (result.verdict === "NO CAPTURES") {
    console.log(`  NO CAPTURES   ${result.id}  (nothing to check — capture it first)`);
    return 0;
  }
  if (result.verdict === "STALE CAPTURES") {
    console.log(`  STALE CAPTURES ${result.id}  (recapture after the page or worker identity changed)`);
    return 1;
  }
  console.log(`  ${result.verdict.padEnd(13)} ${result.id}  [${describeSignal(testCase.badSignal)}]`);
  if (result.verdict === "CONTAMINATED") {
    console.log("    the signal fires on the GOOD page, so it cannot discriminate" +
      (result.firesOnBad ? " (it fires on both)" : " and misses the bad one"));
    console.log("    good page evidence:");
    for (const line of evidenceFor(result.good, testCase.badSignal)) console.log(line);
  } else {
    console.log("    the signal never fired on the BAD page. What NVDA actually produced:");
    for (const line of evidenceFor(result.bad, testCase.badSignal)) console.log(line);
    console.log("    for comparison, the good page:");
    for (const line of evidenceFor(result.good, testCase.badSignal)) console.log(line);
  }
  return 1;
}

/**
 * Only when RUN, never on import.
 *
 * This script's exit code is consumed as a gate -- `release:gate` runs it, and 0/1 decides whether a corpus
 * run may start. Unguarded, importing it called `process.exit` on the IMPORTING process, so
 * `node -e "import('./check-signals.mjs')"` -- which CLAUDE.md makes the only real check that an .mjs file
 * still loads -- terminated with a verdict about a corpus it had nothing to do with.
 *
 * It also reads the manifest at module scope, which throws on a fresh checkout with no `runs/`. That turned
 * "does this file load?" into "is there a corpus on this machine?", and those are different questions.
 */
function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const cases = ONLY ? manifest.cases.filter(({ id }) => id.includes(ONLY)) : manifest.cases;
  if (!cases.length) {
    console.error("No case matches --only=" + ONLY);
    process.exit(1);
  }

  console.log(`Checking ${cases.length} signal(s) against captures in ${CAPTURE_ROOT}\n`);
  let failures = 0;
  const counts = { OK: 0, BLIND: 0, CONTAMINATED: 0, "NO CAPTURES": 0, "STALE CAPTURES": 0 };
  for (const testCase of cases) {
    const result = checkCase(testCase);
    counts[result.verdict] += 1;
    failures += report(result, testCase);
  }

  console.log(
    `\n${counts.OK} discriminating, ${counts.BLIND} blind, ${counts.CONTAMINATED} contaminated, ` +
      `${counts["NO CAPTURES"]} uncaptured, ${counts["STALE CAPTURES"]} stale`
  );
  process.exit(failures === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
