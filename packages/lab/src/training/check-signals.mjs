// @ts-check
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
import { CASES, signalMatches } from "./case-matrix.mjs";
import { hasUsableCaptureFiles } from "./capture-resume.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * a mistyped `--require-complete` scores whatever happens to be on disk and passes — a check that
 * reports success having examined a partial corpus.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 */
refuseUnknownFlags(["--only=", "--require-complete"],
  { entry: import.meta.url, command: "npm run training:check-signals" });

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const MANIFEST_PATH = resolve(ROOT, "manifest.json");
const CAPTURE_ROOT = resolve(ROOT, process.env.DATASET_CAPTURE_ROOT || "captures");
const PAGE_ROOT = resolve(ROOT, "pages");
const REQUIRE_COMPLETE = process.argv.includes("--require-complete");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const EVIDENCE_LINES = 4;

/** @param {string} id @param {string} variant */
function capturePath(id, variant) {
  return resolve(CAPTURE_ROOT, id + "." + variant + ".json");
}

/** @param {string} id @param {string} variant */
function readCapture(id, variant) {
  const path = capturePath(id, variant);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/**
 * Which capture fields each signal is DECIDED from — a table, not a chain of `if`s.
 *
 * It was the chain, and ESLint stopped it at a complexity of 16 the moment the focus signals were added.
 * That limit was doing its job, for exactly the reason `SIGNAL_PREDICATES` gives one file over: the
 * branches never interact, so the chain was a lookup written the long way.
 *
 * **A signal missing from this table falls back to the transcript, and for three of them that was
 * actively misleading.** `focus-trapped`, `focus-order-scrambled` and `control-unreachable-by-keyboard`
 * are decided from the focus probe and from nothing spoken — and their pairs announce IDENTICALLY by
 * design, since the whole point is two pages that sound the same and operate differently. So a blind
 * focus case printed two fields its signal never consults, hid the one it does, and read as "these pages
 * are the same" when the evidence had simply not been looked at. Measured 2026-08-27 on
 * `keyboard-unreachable-native-button`, where it cost a diagnosis.
 *
 * @type {Record<string, string[]>}
 */
const EVIDENCE_FIELDS = Object.freeze({
  "state-change-silent": ["interaction.stateChanges"],
  "form-activation-silent": ["interaction.formChanges", "interaction.postSubmitFields"],
  "structure-empty": ["structure.headings", "structure.formFields"],
  "missing-heading": ["structure.headings", "structure.formFields"],
  "focus-trapped": ["structure.formFields", "interaction.focusOrder", "probe.focusOrder"],
  // `probe.focusOrder` as well as the dialog probe's own channel, and both are load-bearing: Escape from
  // the browse caret measures the DOCUMENT, so a dialogEscape taken without a focus probe is not evidence
  // about a dialog at all. The predicate is gated on the pair for the same reason.
  "escape-does-not-release": ["interaction.dialogEscape", "probe.focusOrder", "probe.dialogEscape"],
  "focus-order-scrambled": ["structure.formFields", "interaction.focusOrder", "probe.focusOrder"],
  "control-unreachable-by-keyboard": ["structure.formFields", "interaction.focusOrder", "probe.focusOrder"],
});

/** What a signal shows when the table has no entry for it. */
const DEFAULT_EVIDENCE_FIELDS = Object.freeze(["transcript", "structure.formFields"]);

/** Follow a dotted path into a capture. `transcript` is top level; the rest are one level down. */
/** @param {Record<string, any>} capture @param {string} path */
function fieldAt(capture, path) {
  return path.split(".").reduce((value, key) => (value == null ? value : value[key]), capture);
}

/**
 * The probe's OWN diagnostic mark, which no field can express.
 *
 * `focusIsTrapped` reads `stalled` from here and from nowhere else, so without this line the single value
 * that decides a 2.1.2 case was unprintable. An empty `focusOrder` beside `stops: 0` says the probe never
 * ran; beside `stops: 12` it says the probe ran and found nothing — opposite fixes, and previously the
 * same silence.
 */
/** @param {Record<string, any>} capture @param {string} event */
function probeMarkLine(capture, event) {
  const mark = (capture.diagnostics || []).find((/** @type {Record<string, any>} */ entry) => entry && entry.event === event);
  return mark
    ? `      ${event} probe: ${JSON.stringify(mark)}`
    : `      ${event} probe: NO MARK — the probe did not run on this capture`;
}

// The fields a signal is decided from, so a failure report shows where the evidence actually is rather
// than making someone open two JSON files to find out.
/** @param {Record<string, any>} capture @param {Record<string, any>} signal */
function evidenceFor(capture, signal) {
  const lines = [];
  for (const path of EVIDENCE_FIELDS[signal.type] ?? DEFAULT_EVIDENCE_FIELDS) {
    if (path.startsWith("probe.")) {
      lines.push(probeMarkLine(capture, path.slice("probe.".length)));
      continue;
    }
    const values = fieldAt(capture, path);
    if (values?.length) {
      lines.push(`      ${path.split(".").pop()}: ${JSON.stringify(values.slice(0, EVIDENCE_LINES))}`);
    }
  }
  return lines;
}

/** @param {Record<string, any>} signal */
function describeSignal(signal) {
  const detail = signal.pattern ?? signal.text ?? signal.field ?? signal.control ?? "";
  return signal.type + (detail ? ` (${detail})` : "");
}

/** @param {Record<string, any>} testCase */
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

/** @param {Record<string, any>} result @param {Record<string, any>} testCase */
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
    return 0;
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
  const cases = ONLY ? manifest.cases.filter((/** @type {{ id: string }} */ { id }) => id.includes(ONLY)) : manifest.cases;
  if (!cases.length) {
    console.error("No case matches --only=" + ONLY);
    process.exit(1);
  }

  // A MANIFEST CASE THAT NO LONGER EXISTS is a stale BUILD, not a broken signal, and saying so is the
  // whole point. This file evaluates whatever the manifest lists; delete a case from `case-matrix.mjs`
  // without regenerating and its captures are still on disk, its signal still does not fire, and the
  // report says BLIND — "a defect in the signal or in the probe feeding it", which sends the reader to
  // debug something that is working.
  //
  // Measured 2026-08-28: deleting `skip-link-target-not-focusable` (a case whose mechanism a capture had
  // just REFUTED) failed the pre-push gate with exactly that message. The gate was right to refuse and
  // wrong about why. `audit-corpus-starvation.mjs` has had this distinction as `unmatched` all along —
  // "records whose case has gone — a rename or a deletion" — and this file never learned it.
  //
  // SOME defined and some not, never NONE. A manifest in which not one case is defined is not this
  // project's corpus at all — it is a fixture, and `capture-corpus-guards.test.ts` drives this file with
  // exactly that. Refusing there would tell the caller nothing and break every harness. A manifest that
  // is PARTLY defined is the real thing, gone stale.
  const defined = new Set(CASES.map((/** @type {{ id: string }} */ testCase) => testCase.id));
  const orphaned = cases.filter((/** @type {{ id: string }} */ { id }) => !defined.has(id));
  if (orphaned.length && orphaned.length < cases.length) {
    console.error(`REFUSING: ${orphaned.length} case(s) in the manifest are no longer DEFINED, so this `
      + "manifest predates the case definitions and every verdict below would be computed against a "
      + "corpus that no longer exists:");
    for (const { id } of orphaned.slice(0, 8)) console.error(`  ${id}`);
    if (orphaned.length > 8) console.error(`  ... and ${orphaned.length - 8} more`);
    console.error("\nRegenerate:  npm run training:generate\n"
      + "This is a STALE BUILD, not a broken signal — a deleted case's captures are still on disk and its "
      + "signal will never fire, which reads as BLIND and sends you to debug a probe that works.");
    process.exit(2);
  }

  console.log(`Checking ${cases.length} signal(s) against captures in ${CAPTURE_ROOT}\n`);
  const counts = { OK: 0, BLIND: 0, CONTAMINATED: 0, "NO CAPTURES": 0, "STALE CAPTURES": 0 };
  for (const testCase of cases) {
    const result = checkCase(testCase);
    // The literal type is kept -- `signalVerdict` takes exactly these five keys and widening the
    // variable would push the loss of precision into it. Only the dynamic write is cast, which is the
    // one place a verdict name arrives as data.
    /** @type {Record<string, number>} */ (counts)[result.verdict] += 1;
    report(result, testCase);
  }

  console.log(
    `\n${counts.OK} discriminating, ${counts.BLIND} blind, ${counts.CONTAMINATED} contaminated, ` +
      `${counts["NO CAPTURES"]} uncaptured, ${counts["STALE CAPTURES"]} stale`
  );
  const { exitCode, summary } = signalVerdict(counts, { requireComplete: REQUIRE_COMPLETE });
  console.log(summary);
  if (exitCode !== 0) console.log(unsyncedCorpusHint(counts));
  process.exit(exitCode);
}

/**
 * How few cases may be examined before this check has no opinion worth having.
 *
 * A signal check that looked at three cases and found no defect has not verified the signal layer; it has
 * verified three cases. The number is a floor on MEANING, not on correctness.
 */
export const MIN_EXAMINED = 25;

/**
 * The exit code, as a pure function of what was found.
 *
 * ## Two questions were being answered with one number, and one of them cannot be asked here
 *
 * `BLIND` and `CONTAMINATED` are logic defects: the signal does not fire on the bad page, or fires on the
 * good one. Either is a real bug in a signal or the probe feeding it, and any machine holding evidence for
 * that case can detect it. **That is what this gate is for.**
 *
 * `NO CAPTURES` and `STALE CAPTURES` are not defects at all. They say the corpus on THIS disk has no
 * evidence matching the current definitions — which on the lab means "go capture", and on a developer's
 * machine usually means `runs/` is gitignored and this copy is older than the case matrix. The two are
 * indistinguishable from here, so failing on them makes the gate ask a question the machine cannot answer.
 *
 * Measured 2026-08-23: `0 blind, 0 contaminated, 242 uncaptured, 860 stale` locally, and
 * `1303 discriminating, 0 of everything else` on the lab, at the same commit. The signal layer was
 * provably fine and the gate said FAIL. The consequence is the part that matters: the only way past it was
 * `A11Y_SKIP_VERIFY=1`, which disables lint, typecheck, tests and rules:gate as well — so a check that
 * could not answer its own question was switching off four checks that could. **That is how a
 * verification stops being one**, and it had already happened nine times in a day.
 *
 * Note the asymmetry this replaces: `NO CAPTURES` returned 0 and `STALE CAPTURES` returned 1, though both
 * mean "no usable evidence here". 242 uncaptured passed in silence while 860 stale failed.
 *
 * ## Three outcomes, matching `evidence:check`
 *
 * The 0/1/2 contract is not invented here — `evidence:check` already uses it, and CLAUDE.md records why 2
 * had to include PARTIAL coverage rather than only zero: it reported "safe to ship" having compared 2 of
 * 48. An answer given on too little evidence is the failure, not the absence of an answer.
 *
 *   0  every case with usable evidence discriminates, and enough were examined to mean it
 *   1  a real defect — blind or contaminated — or, under `--require-complete`, a corpus with holes
 *   2  INCONCLUSIVE: too little usable evidence here to have an opinion
 *
 * `--require-complete` is how the authoritative paths keep the old strictness: on the lab, before a corpus
 * run, and in `release:gate`, "the corpus has holes" IS the answer and must block.
 *
 * @param {{OK: number, BLIND: number, CONTAMINATED: number, "NO CAPTURES": number, "STALE CAPTURES": number}} counts
 * @param {{requireComplete?: boolean}} [options]
 * @returns {{exitCode: 0 | 1 | 2, summary: string}}
 */
export function signalVerdict(counts, { requireComplete = false } = {}) {
  const defects = counts.BLIND + counts.CONTAMINATED;
  const gaps = counts["NO CAPTURES"] + counts["STALE CAPTURES"];
  const examined = counts.OK + defects;

  if (defects > 0) {
    return { exitCode: 1, summary:
      `FAIL — ${defects} signal(s) do not discriminate. That is a defect in the signal or in the probe `
      + "feeding it, and it is what this gate exists to catch." };
  }
  if (requireComplete && gaps > 0) {
    return { exitCode: 1, summary:
      `FAIL — ${gaps} case(s) have no evidence matching their current definition, and --require-complete `
      + "says that is the question being asked. Capture them before this corpus is used or released." };
  }
  if (examined < MIN_EXAMINED) {
    return { exitCode: 2, summary:
      `INCONCLUSIVE — only ${examined} case(s) had usable evidence, below the floor of ${MIN_EXAMINED}. `
      + "Nothing here is wrong; there is simply not enough to verify the signal layer. This is not a pass." };
  }
  return { exitCode: 0, summary: gaps === 0
    ? `PASS — all ${examined} case(s) discriminate, and the corpus is complete.`
    : `PASS — all ${examined} case(s) with usable evidence discriminate. ${gaps} case(s) could not be `
      + "checked here; that is a question about this corpus copy, not about the signal layer." };
}

/**
 * Say which question stale-or-uncaptured is actually asking, because there are two and they look identical.
 *
 * A count of stale pairs means "the captures on THIS disk do not match the case definitions on this disk".
 * On the lab, where captures are produced, that means the corpus needs recapturing — hours of fleet time.
 * On a developer's machine it usually means something far duller: `runs/` is gitignored, so a local copy is
 * whatever was last synced, and case definitions move every time somebody edits the matrix.
 *
 * Measured 2026-08-23: this reported `242 uncaptured, 860 stale` locally and `0 uncaptured, 0 stale` on the
 * lab, for the same commit. The corpus was complete; the local copy was old. Acting on the local number
 * meant planning a 2–3 hour recapture of work already done, and pushing with the verification hook
 * overridden because it "failed".
 *
 * A hint rather than a guard: nothing here can see the lab, so this cannot decide which case applies. What
 * it can do is stop the two reading as one, which is the distinction this whole codebase keeps paying for.
 *
 * ONE BLOCK. This was two adjacent ones, which is the fourth pair found today: only the last attaches, so
 * the paragraph above reached no tool and the `@param` below did not apply either -- the parameter stayed
 * inferred from its one call site.
 *
 * @param {Record<string, number>} counts
 */
export function unsyncedCorpusHint(counts) {
  const unusable = counts["NO CAPTURES"] + counts["STALE CAPTURES"];
  if (unusable === 0) return "Every case has evidence matching its current definition.";
  return `${unusable} case(s) have no usable evidence HERE. That is either a corpus that genuinely needs `
    + "capturing, or a local `runs/` that is simply out of date — they are indistinguishable from this "
    + "machine, and `runs/` is gitignored so a local copy is only ever as fresh as its last sync.\n"
    + "Before planning a recapture, ask the box that owns the corpus:\n"
    + "  npm run lab:job -- -e job=check-signals";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
