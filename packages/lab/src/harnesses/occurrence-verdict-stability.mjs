// @ts-check
/**
 * Is an OCCURRENCE verdict stable on a flaky substrate? The last open question.
 *
 *   npm run verdict:stability -- http://REDACTED-INTERNAL-ADDRESS:8765
 *
 * The claim under test: this project's unreliability wrecks ENUMERATION but barely touches VERDICTS.
 * "There are 66 graphics" is destroyed by a sweep that stops at 5 — measured, last night. "The user was
 * never told what to fix" should survive the same variance, because it needs one bit, not a complete
 * inventory.
 *
 * If that holds, the one genuinely unclaimed direction — did the page TELL the user? — is workable on
 * the infrastructure that already exists. If the verdict flips run to run, it has the same disease and
 * the direction should be abandoned.
 *
 * A controlled pair, not a live site: `form-error-silent/good` announces its validation error and
 * `bad` does not, so ground truth is known and the "break it on purpose" arm is free. Deliberately not
 * run against anyone's production sign-up form — repeated real submissions create records and send mail.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leasePageServer } from "../training/page-server.mjs";
import { hostPagesBase } from "@a11ign/worker-fleet/host-address";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { captureTolerantly } from "@a11ign/worker-fleet/capture-client";
import { CAPTURE_CLIENT_TIMEOUT_MS } from "@a11ign/worker-fleet/worker-http";

/**
 * takes its worker POSITIONALLY and no flags at all, so any flag passed to it is discarded.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run verdict:stability" });

// This file is why the guard in budget-ladder.test.ts now DISCOVERS capture clients instead of
// listing three: it declared 560 s and undici gave it 300 s, which is precisely the defect that
// was "fixed" the same day -- at three call sites out of ten. IMPORTED rather than a second literal
// now, architecture-audit.md §14.5: a local 560_000 was already below the worker's true worst case
// once desktop preparation is counted (580 s), so this was the same defect a third time.
const CAPTURE_TIMEOUT_MS = CAPTURE_CLIENT_TIMEOUT_MS;

const WORKER = process.argv[2];
const RUNS = 3;
const TASK = "Submit the request without entering a reference number and understand what needs fixing.";
// Resolved from this module, not the cwd — `spawned-paths.test.ts` exists because a moved script with a
// repo-relative path dies with "Command failed" and nothing to read.
const PAGES = fileURLToPath(new URL("../../../../runs/screenreader-dataset/pages/", import.meta.url));

/**
 * Role and state words, taken from the ported NVDA labels.
 *
 * So "was the user told anything ACTIONABLE?" is measured against NVDA's real vocabulary rather than a
 * guess at it — the one place the oracle spike earns its keep here. An announcement made only of role
 * and state chrome ("edit", "button", "invalid entry") names a control; it does not tell you what to do.
 */
const LABELS = readFileSync(fileURLToPath(new URL("../../../nvda-speech/nvda_speech/labels.py", import.meta.url)), "utf8");
const VOCAB = new Set([...LABELS.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase()));

/** Enough non-chrome words to count as an instruction rather than a label. */
const ACTIONABLE_WORDS = 3;

/** @param {Record<string, any>} capture */
function verdict(capture) {
  const deltas = (capture.interaction?.formChanges ?? []).map((/** @type {{ after?: string }} */ change) => String(change.after ?? ""));
  const words = deltas
    .join(" ")
    .toLowerCase()
    .split(/[\s,.]+/)
    .filter(Boolean)
    .filter((/** @type {string} */ word) => !VOCAB.has(word));
  return { informed: words.length >= ACTIONABLE_WORDS, spoken: deltas.join(" | ").slice(0, 88) };
}

/** @param {string} base @param {string} variant */
async function capture(base, variant) {
  const response = await captureTolerantly({
    worker: String(WORKER),
    body: {
      url: `${base}/form-error-silent/${variant}.html`,
      task: TASK,
      probeForms: true,
      steps: 25,
    },
    timeoutMs: CAPTURE_TIMEOUT_MS,
  });
  const body = response.json ?? {};
  return /** @type {Record<string, any>} */ (body).error ? { error: String(/** @type {Record<string, any>} */ (body).error).slice(0, 62) } : verdict(body);
}

async function main() {
  if (!WORKER) throw new Error("usage: npm run verdict:stability -- http://<guest-ip>:8765");
  const lease = await leasePageServer({ root: PAGES, port: 5050, probePath: "form-error-silent/good.html" });
  const base = hostPagesBase(WORKER);
  /** @type {Record<string, any[]>} */
  const results = {};
  try {
    for (const variant of ["good", "bad"]) {
      results[variant] = [];
      for (let run = 1; run <= RUNS; run += 1) {
        results[variant].push(await capture(base, variant));
        process.stdout.write(`  captured ${variant} ${run}/${RUNS}\n`);
      }
    }
  } finally {
    await lease.release();
  }

  let allCorrect = true;
  for (const [variant, runs] of Object.entries(results)) {
    const expected = variant === "good";
    process.stdout.write(`\n  ${variant.toUpperCase()} — should the user be informed? ${expected ? "YES" : "NO"}\n`);
    for (const [index, result] of runs.entries()) {
      if (result.error) {
        process.stdout.write(`    run ${index + 1}: ERROR ${result.error}\n`);
        continue;
      }
      const correct = result.informed === expected;
      allCorrect = allCorrect && correct;
      process.stdout.write(`    run ${index + 1}: informed=${String(result.informed).padEnd(5)}`
        + ` ${correct ? "correct" : "WRONG  "}  spoken="${result.spoken}"\n`);
    }
    const seen = runs.filter((/** @type {Record<string, any>} */ r) => !r.error)
    .map((/** @type {Record<string, any>} */ r) => r.informed);
    const stable = seen.length > 0 && seen.every((/** @type {unknown} */ v) => v === seen[0]);
    if (!stable) allCorrect = false;
    process.stdout.write(`    -> ${stable ? "STABLE" : "UNSTABLE"} across ${seen.length} run(s)\n`);
  }
  process.stdout.write(`\n  ${allCorrect
    ? ">>> verdicts stable AND correct: occurrence survives the substrate"
    : ">>> verdicts unstable or wrong: the unique direction has the same disease"}\n`);
}

// Only when RUN, never on import. CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check
// that an .mjs file still loads -- neither lint nor tsc can see a ReferenceError at import -- and unguarded
// that mandated check EXECUTES this script. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
