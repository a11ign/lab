// @ts-check
// Capture ONE page N times and report which fields are stable.
//
//   npm run training:repeat -- --url=http://<this host>:5050/<case>/good --times=5 --box=a11y-worker-14 --label=<ticket key> --wait=30m
//   npm run training:repeat -- --url=... --probe-tables --label=<ticket key> --wait=30m     # one box, whichever is free
//   npm run training:repeat -- --collect[=<job ID>]                                          # read a job that has finished
//
// It SUBMITS the repeats to the fleet job service as ONE group (A11-263): the service holds a group to one box and captures it in order, books the box, and
// captures a transient failure again on the same box when asked. This client records the job ID, waits once if it was told to (`--wait=`, `A11Y_FLEET_WAIT`),
// and reads the captures from the job's manifest. With no wait it prints the ID and exits 75.
//
// Why this exists: a probe that returns different evidence for the same unchanged page is
// indistinguishable from a page that genuinely differs, and that is the one defect this project
// cannot tolerate. It was found by hand -- 18 captures of one table page returned 4, 2, 4, 4, 1,
// 4, 4 cells -- and finding it by hand is how it survived several "fixes" that each helped and
// none cured.
//
// Deliberately compares CONTENT, not counts. A readiness gate once replaced the first line of
// every capture with the document title, and every count-based check stayed green.
//
// Fresh NVDA per capture by default (`reuseScreenReader: false`): a repeatability test that
// reuses one screen reader is measuring a single NVDA session, not the pipeline. `--reuse` opts
// back in when you specifically want to know whether reuse is what drifts.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { refuseUnknownFlags, flagValue } from "@a11ign/screenreader-fleet/cli-flags";
import { repeatCapturesRoot, refuseIfRunsReadonly } from "../dataset-paths.ts";
import { runFleetClient, slugOf } from "../fleet/harness-flow.ts";
import { reachableFromBoxes } from "../fleet/fleet-job.ts";
import { analyseRepeats, comparable, servedDifferentDocuments } from "./repeat-analysis.ts";
import { clearRepeatSet, repeatBody, repeatCollector, repeatJob } from "./repeat-fleet.ts";

// The analysis lives in `repeat-analysis.ts` (a pure function of the captures); these two keep the names their importers have always used.
export { comparable, servedDifferentDocuments };

/**
 * `--probe-forms` and `--probe-tables` are how a canary reaches the fields that carry interaction
 * evidence, and a canary that cannot express the fault is worthless.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 */
refuseUnknownFlags(["--url=", "--box=", "--boxes=", "--label=", "--wait=", "--collect", "--worker=", "--times=", "--steps=", "--task=", "--browser=", "--out=",
   "--probe-forms", "--probe-tables", "--probe-focus", "--probe-navigation", "--reuse"],
  { entry: import.meta.url, command: "npm run training:repeat" });

/**
 * A named `--flag=value`, or the fallback.
 *
 * `fallback` typed rather than inferred: defaulting to `null` infers exactly `null`, so every caller
 * supplying a real default became the error. The same shape `capture-fixtures.ts` has.
 *
 * @param {string} name
 * @param {string | number | null} [fallback]
 */
// audit §9 "argv parsing": was its own copy of the fifteen-file idiom, now the shared, tested extractor.
const arg = (name, fallback = null) => flagValue(process.argv, name) ?? fallback;

const URL_ARG = arg("url");
const TIMES = Number(arg("times", "5"));
const STEPS = Number(arg("steps", "10"));
const PROBE_TABLES = process.argv.includes("--probe-tables");
// `--probe-forms` and `--task` exist because without them this harness could not exercise the task-button
// or submit probes AT ALL, and those are where the interaction criteria (3.3.1, 4.1.3) live. The
// consequence was not theoretical: an intermittent contaminant in `formChanges.after` — a late document
// announcement credited to an activation, on a page whose finding is silence — reached the corpus with
// `gate:stability` reporting every canary stable, because no canary could reach the code path.
const PROBE_FORMS = process.argv.includes("--probe-forms");
// `focusOrder` has been in the compared fields since they were widened, and it has been EMPTY on
// every canary ever run, because nothing could ask for the probe. A field that is compared and can never
// hold anything compares equal every time — the mirror of the defect recorded beside those fields, where
// ten were watched and the two carrying interaction evidence were not among them.
const PROBE_FOCUS = process.argv.includes("--probe-focus");
const PROBE_NAVIGATION = process.argv.includes("--probe-navigation");
const TASK = arg("task");
const REUSE = process.argv.includes("--reuse");
// A new browser preset needs its own stability answer before it is trusted: "Chrome captures" and "Chrome
// captures the SAME THING TWICE" are different claims, and only the second one makes a corpus. Absent means
// the guest's configured browser, so existing invocations are unchanged.
const BROWSER = arg("browser");
// Every capture is kept, not just summarised. The first real run of this harness found two degenerate
// captures and I could not say WHY, because the diagnostics -- stopReason, documentReady,
// readThroughRetry -- had been thrown away with the response. A harness that reports instability
// without keeping the evidence makes you run it twice.
const outArg = arg("out");
const OUT_DIR = outArg ? resolve(String(outArg)) : repeatCapturesRoot();

/** What kind of job this client files its pending record under, so `--collect` reads a repeat job and never another client's. */
const JOB_KIND = "repeat-capture";

/**
 * The progress lines the old client printed as it went, printed as the repeats are read back: a number, then how many phrases it heard or why it failed.
 *
 * @param {import("./repeat-fleet.ts").RepeatSet} set
 */
function progressLines(set) {
  const failures = new Map(set.errors.map((/** @type {string} */ e) => [Number(e.slice(0, e.indexOf(":"))), e.slice(e.indexOf(":") + 2)]));
  const heard = new Map();
  let captured = 0;
  for (let n = 1; n <= set.target.times; n += 1) {
    if (failures.has(n)) continue;
    const capture = set.raw[captured];
    captured += 1;
    const retried = (capture.diagnostics ?? []).some((/** @type {any} */ e) => e.event === "readThroughRetry");
    heard.set(n, `${(capture.transcript ?? []).length} phrases${retried ? " (read-through retried)" : ""}`);
  }
  const lines = [];
  for (let n = 1; n <= set.target.times; n += 1) lines.push(`capture ${n}/${set.target.times} ... ${failures.has(n) ? `FAILED ${failures.get(n)}` : heard.get(n)}`);
  return lines;
}

/**
 * What this client says about the repeats it has: the progress, then the verdict `analyseRepeats` reaches.
 *
 * @param {import("./repeat-fleet.ts").RepeatSet[]} sets
 */
function finish(sets) {
  const [set] = sets;
  process.stdout.write(`${progressLines(set).join("\n")}\n`);
  const report = analyseRepeats({ raw: set.raw, errors: set.errors, times: set.target.times, reuse: REUSE, outDir: set.target.outDir });
  process.stderr.write(report.stderr);
  process.stdout.write(report.stdout);
  if (set.box) process.stdout.write(`captured on ${set.box}\n`);
  return report.exit;
}

/**
 * Only when RUN, never on import.
 *
 * Two separate things ran at module scope: the usage guards, which called `process.exit(2)` on the
 * IMPORTING process, and the capture run itself. `stability-gate.ts` once SPAWNED this script per canary,
 * so importing it to check it still loads meant driving the fleet.
 *
 * The usage guards move in here with the run, deliberately: a missing `--url` is a mistake made by a
 * CALLER, and there is no caller when the file is merely imported.
 */
async function main() {
  refuseIfRunsReadonly(OUT_DIR);
  const collecting = process.argv.some((a) => a === "--collect" || a.startsWith("--collect="));
  // A probe-forms run with no task cannot activate anything, so it would compare an empty field five times
  // and call it stable. Refuse rather than pass vacuously.
  if (PROBE_FORMS && !TASK) {
    console.error("--probe-forms needs --task=\"...\": the task selects which control is activated, so " +
      "without one nothing is activated and the run reports a stable empty result.");
    process.exit(2);
  }
  if (!URL_ARG && !collecting) {
    console.error("usage: npm run training:repeat -- --url=<page> --label=<ticket key> [--box=<name>] [--wait=30m] [--times=5] " +
      "[--probe-tables] [--probe-forms] [--task=\"...\"] [--reuse]\n" +
      "  --collect[=<job ID>] reads a job that has finished. The repeats are one group: the service holds them to one box.");
    process.exit(2);
  }

  const target = URL_ARG ? {
    group: slugOf(String(URL_ARG)), url: String(URL_ARG), outDir: OUT_DIR, times: TIMES,
    body: repeatBody({ steps: STEPS, probeTables: PROBE_TABLES, reuse: REUSE, browser: BROWSER ? String(BROWSER) : null,
      probeForms: PROBE_FORMS, probeFocus: PROBE_FOCUS, probeNavigation: PROBE_NAVIGATION, task: TASK ? String(TASK) : null }),
  } : null;
  const exit = await runFleetClient({
    argv: process.argv.slice(2), root: OUT_DIR, kind: JOB_KIND, oneBox: {},
    hint: (job) => `npm run training:repeat -- --collect=${job}${outArg ? ` --out=${outArg}` : ""}`,
    prepare: async () => {
      if (!target) throw new Error("unreachable: a submit has a --url");
      const reachable = { ...target, url: reachableFromBoxes(target.url) };
      clearRepeatSet(reachable);
      return repeatJob([reachable]);
    },
    collect: repeatCollector((sets) => finish(sets), { log: (line) => console.log(line) }),
  });
  process.exit(exit);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
