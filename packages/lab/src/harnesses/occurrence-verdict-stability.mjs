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
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { layerRoot } from "@a11ign/control/layer-checkouts";
import { leasePageServer } from "../training/page-server.mjs";
import { hostPagesBase } from "@a11ign/screenreader-fleet/host-address";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { captureTolerantly } from "@a11ign/screenreader-fleet/capture-client";
import { CAPTURE_CLIENT_TIMEOUT_MS } from "@a11ign/screenreader-fleet/worker-http";
import { wakeNamedWorkers } from "../training/wake-by-hand.mjs";

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
// THROUGH THE LAYER CHECKOUT (#3447): `nvda-speech` left this workspace with the worker and is not a package a registry
// serves (it is private), so it is found where its repository's checkout puts it: INSIDE the clone `layers.json` declares for
// `nvda-worker`, at `packages/nvda-speech` (the layer repository's root holds `src/` for the worker and `packages/` for the speech
// package, #3748). The resolver REFUSES where the checkout is not there, rather than guessing a monorepo path, so a host with no
// layer checkout stops here saying so and not on a vocabulary read from nowhere.
const LABELS_PATH = ["packages", "nvda-speech", "nvda_speech", "labels.py"];
/** @type {Set<string> | undefined} */
let vocabulary;
/** The words NVDA's labels use, read on first need so that importing this module never touches the checkout. */
function nvdaVocabulary() {
  vocabulary ??= new Set([...readFileSync(join(layerRoot("nvda-worker"), ...LABELS_PATH), "utf8").matchAll(/:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase()));
  return vocabulary;
}

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
    .filter((/** @type {string} */ word) => !nvdaVocabulary().has(word));
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
  nvdaVocabulary(); // refuses here, before a worker is woken and a page server leased, when the layer checkout is absent
  // Run BY HAND, this positional worker never goes through `lab:job`'s own wake -- #2655's table, row 11.
  // #2760 audited this call for the "one down worker must not refuse the whole run" question #2756 raised:
  // safe as-is, because this positional argument names exactly ONE worker -- refusing IS the down worker,
  // and there is no wider pool to narrow the run to.
  const wake = await wakeNamedWorkers([String(WORKER)]);
  if (!wake.ok) throw new Error(wake.refusal);
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
