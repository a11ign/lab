// @ts-check
/**
 * Is an OCCURRENCE verdict stable on a flaky substrate? The last open question.
 *
 *   npm run verdict:stability -- a11y-worker-14 --label=<ticket key> --wait=30m
 *   npm run verdict:stability -- --label=<ticket key> --wait=30m          # one box, whichever is free
 *   npm run verdict:stability -- --collect[=<job ID>]                     # read a job that has finished
 *
 * It SUBMITS the six captures to the fleet job service as ONE group (A11-263): good three times, then bad three times, on ONE box, in that order. The box is a NAME (positional or
 * `--box=`), never an address, and `--boxes=1` when none is named. It records the job ID, waits once if it was told to (`--wait=`, `A11Y_FLEET_WAIT`), and reads the verdicts from the
 * manifest; with no wait it prints the ID and exits 75.
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
import { pathToFileURL } from "node:url";
import { refuseIfRunsReadonly, runsRoot } from "../dataset-paths.ts";
// By name, through the `exports` control declares: a repository never reads another's source by path (ADR 0045, Decision 1, rule 2; a11ign/a11ign#5176).
import { layerRoot } from "@a11ign/control/layer-checkouts";
import { leasePageServer } from "../training/page-server.mjs";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { pagesBaseUrl, whyNoCapture } from "../fleet/fleet-job.ts";
import type { Collector } from "../fleet/capture-flow.ts";
import { holdingPages, runFleetClient } from "../fleet/harness-flow.ts";
import { ORDER, RUNS, occurrenceCases } from "./occurrence-cases.ts";
import type { Loose } from "../capture/loose.ts";

/**
 * takes its box as a positional NAME or `--box=`, and the fleet flags. Any other flag passed to it is discarded, so an unknown one is refused.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--box=", "--boxes=", "--label=", "--wait=", "--collect", "--worker="], { entry: import.meta.url, command: "npm run verdict:stability" });

// This file is why the guard in budget-ladder.test.ts DISCOVERS capture clients instead of listing three: it declared 560 s and undici gave it 300 s, which is precisely the defect that was
// "fixed" the same day -- at three call sites out of ten. It declares no capture timeout at all now: the fleet job service sends each capture with the shared client's ceiling.
// Resolved from this module, not the cwd — `spawned-paths.test.ts` exists because a moved script with a
// repo-relative path dies with "Command failed" and nothing to read.
const PAGES = join(runsRoot(), "screenreader-dataset/pages/");

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
let vocabulary: Set<string> | undefined;
/** The words NVDA's labels use, read on first need so that importing this module never touches the checkout. */
function nvdaVocabulary() {
  vocabulary ??= new Set([...readFileSync(join(layerRoot("nvda-worker"), ...LABELS_PATH), "utf8").matchAll(/:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase()));
  return vocabulary;
}

/** Enough non-chrome words to count as an instruction rather than a label. */
const ACTIONABLE_WORDS = 3;

function verdict(capture: Record<string, Loose>) {
  const deltas = (capture.interaction?.formChanges ?? []).map((change: { after?: string; }) => String(change.after ?? ""));
  const words = deltas
    .join(" ")
    .toLowerCase()
    .split(/[\s,.]+/)
    .filter(Boolean)
    .filter((word: string) => !nvdaVocabulary().has(word));
  return { informed: words.length >= ACTIONABLE_WORDS, spoken: deltas.join(" | ").slice(0, 88) };
}

const JOB_KIND = "verdict-stability";
const FLEET_ROOT = join(runsRoot(), "repeat-captures", "verdict-stability");

/** The verdict of each capture, or the error that took its place, grouped by variant in run order. */
function resultsOf(fetched: Parameters<Collector>[0]): Record<string, Loose[]> {
  const results: Record<string, Loose[]> = { good: [], bad: [] };
  for (const { variant, run } of ORDER) {
    const entry = fetched.manifest.captures.find((c) => c.case === `${variant}.${run}`);
    const record = entry ? fetched.record(entry) : null;
    const body = record?.capture as Loose | undefined;
    if (entry?.status === "done" && body && !body.error) results[variant]?.push(verdict(body));
    else results[variant]?.push({ error: (body?.error ? String(body.error) : entry ? whyNoCapture(entry, record) : "no capture came back").slice(0, 62) });
    process.stdout.write(`  captured ${variant} ${run}/${RUNS}\n`);
  }
  return results;
}

function occurrenceCollector(): Collector {
  return async (fetched) => {
    const results = resultsOf(fetched);
    process.stdout.write(`  on ${[...new Set(fetched.manifest.captures.map((c) => c.box))].join(", ") || "no box"}\n`);
    return { recapture: [], exit: reportVerdicts(results) };
  };
}

/** What the pair showed: for each variant, whether the user was informed on every run, and whether that was stable and correct. Returns 0 either way, as it always has. */
function reportVerdicts(results: Record<string, Loose[]>): number {
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
    const seen = runs.filter((r: Record<string, Loose>) => !r.error)
    .map((r: Record<string, Loose>) => r.informed);
    const stable = seen.length > 0 && seen.every((v: unknown) => v === seen[0]);
    if (!stable) allCorrect = false;
    process.stdout.write(`    -> ${stable ? "STABLE" : "UNSTABLE"} across ${seen.length} run(s)\n`);
  }
  process.stdout.write(`\n  ${allCorrect
    ? ">>> verdicts stable AND correct: occurrence survives the substrate"
    : ">>> verdicts unstable or wrong: the unique direction has the same disease"}\n`);
  return 0;
}

async function main() {
  refuseIfRunsReadonly(FLEET_ROOT);
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith("--"));
  const collecting = argv.some((a) => a === "--collect" || a.startsWith("--collect="));
  if (!collecting) nvdaVocabulary(); // refuses here, before a page server is leased and a job submitted, when the layer checkout is absent
  const exit = await runFleetClient({
    argv, root: FLEET_ROOT, kind: JOB_KIND, oneBox: { positional },
    hint: (job) => `npm run verdict:stability -- --collect=${job}`,
    prepare: async () => {
      const lease = await leasePageServer({ root: PAGES, port: 5050, probePath: "form-error-silent/good.html" });
      return holdingPages(lease, () => ({ cases: occurrenceCases(pagesBaseUrl(process.env, 5050)), groups: { "form-error-silent": {} } }));
    },
    collect: occurrenceCollector(),
  });
  process.exit(exit);
}

// Only when RUN, never on import. CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check
// that an .mjs file still loads -- neither lint nor tsc can see a ReferenceError at import -- and unguarded
// that mandated check EXECUTES this script. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
