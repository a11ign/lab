// @ts-check
/**
 * How often does a capture read the WRONG PAGE? A rate, measured on the risky path.
 *
 *   npm run identity:rate -- --box=a11y-worker-14 --label=<ticket key> --wait=2h [--rounds=20]
 *   npm run identity:rate -- --collect[=<job ID>]          # read a job that has finished
 *
 * It SUBMITS the rotation to the fleet job service as ONE group (A11-263): rounds x 3 captures, A→B→C→A..., on ONE box, in that order. That is what the measurement needs, because every
 * capture after the first must navigate an ALREADY-OPEN window on the same machine, and the service holds a group to one box and sends it one case after another. The box is a NAME
 * (`--box=`), never an address, and `--boxes=1` when none is named.
 *
 * ## Why this exists
 *
 * Blocker B2 asks for "a diagnosis, or a measured failure rate with a retry that makes it invisible to a
 * consumer. A number, not a hope." The diagnosis arrived — NVDA's browse-mode buffer belongs to the WINDOW,
 * so re-pointing a reused window over the DevTools Protocol can leave the previous page's buffer in place
 * behind the new document title — and `refreshBrowseBuffer` now rebuilds it. This produces the number.
 *
 * It deliberately exercises the path that can fail: every capture after the first navigates an
 * ALREADY-OPEN window, because a freshly launched browser has no previous document and therefore cannot
 * express the fault at all. A run that launched a new browser each time would report a clean rate while
 * measuring nothing — the mistake this repo has made three times with canaries that could not express the
 * fault they were validating.
 *
 * ## Why the pages rotate, and why they were chosen
 *
 * A stale read is only detectable if the previous page's announcements are DISTINGUISHABLE from this one's.
 * `structure-good` and `structure-bad` both say "City Library", so a stale read of one while asking for the
 * other passes any signature check — they are useless here despite being the pages the fault was first seen
 * on. The three pages below have mutually exclusive signatures, and rotating A->B->C->A means every capture
 * has a different predecessor, so a stale read always names which page it came from.
 *
 * ## Three outcomes, never two
 *
 * "Read the wrong page" and "read nothing" are different faults with different repairs, and collapsing them
 * is what sent an afternoon after a stale buffer that was actually a mute screen reader on a loaded host.
 * A silent capture is reported separately and is NOT counted as a wrong page.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { join as joinPath } from "node:path";
import { leasePageServer } from "../training/page-server.mjs";
import { refuseUnknownFlags, flagValue } from "@a11ign/screenreader-fleet/cli-flags";
import { refuseIfRunsReadonly, repeatCapturesRoot } from "../dataset-paths.ts";
import { pagesBaseUrl, whyNoCapture } from "../fleet/fleet-job.ts";
import type { FleetCase } from "../fleet/fleet-job.ts";
import type { Collector } from "../fleet/capture-flow.ts";
import { holdingPages, runFleetClient, stopExitWith } from "../fleet/harness-flow.ts";
import type { Loose } from "../capture/loose.ts";

/**
 * asks whether a capture ever reads the WRONG page. `--rounds=` mistyped silently uses the default,
 * and a zero-count result is reported as a 95%% upper bound whose width depends entirely on it.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--box=", "--boxes=", "--label=", "--wait=", "--collect", "--worker=", "--rounds="], { entry: import.meta.url, command: "npm run identity:rate" });

const ROUNDS = Number(flagValue(process.argv, "rounds") || 20);
const STEPS = 10;
const pagesDir = join(dirname(fileURLToPath(import.meta.url)), "../eval/pages/tutorials");

/**
 * Pages whose announcements cannot be mistaken for each other.
 *
 * `signature` is text this page must produce. Each page's signature doubles as the proof that ANOTHER page's
 * transcript came from it, which is why they must be mutually exclusive: absence of your own signature says
 * only "we did not hear it", while presence of the previous page's says "we read that page" — a much stronger
 * claim, and the one that distinguishes a stale buffer from a quiet capture.
 */
const PAGES = [
  { page: "structure-good.html", signature: /City Library/i },
  { page: "disclosure-good.html", signature: /FAQ|password/i },
  { page: "forms-validation-good.html", signature: /Newsletter|Email address/i },
];

/**
 * Classify one capture against the page it asked for and the page before it.
 *
 * Pure, so the self-test below can drive it with a constructed fault. That test is not ceremony: the first
 * two versions of the stale-page detector in this project's history were both wrong — one matched its own
 * regex, the other flagged a shared site template — and each clean result was read as reassurance.
 */
export function classifyCapture({ transcript, want, previous }: Loose) {
  const text = (transcript ?? []).join(" | ");
  if (!transcript?.length) return "silent";
  if (want.signature.test(text)) return "correct";
  if (previous && previous.signature.test(text)) return "wrong-page";
  return "unrecognised";
}

/** Prove the classifier can fail before believing it when it passes. */
function selfTest() {
  const [a, b] = PAGES;
  const cases = [
    ["correct", { transcript: ["banner landmark, City Library"], want: a, previous: b }],
    ["wrong-page", { transcript: ["FAQ, heading, level 1"], want: a, previous: b }],
    ["silent", { transcript: [], want: a, previous: b }],
    ["unrecognised", { transcript: ["Welcome to Microsoft Edge"], want: a, previous: b }],
  ];
  for (const [expected, input] of cases) {
    const got = classifyCapture(input);
    if (got !== expected) {
      throw new Error(`classifier self-test failed: expected ${expected}, got ${got}`);
    }
  }
  process.stdout.write(`  classifier self-test: 4/4 (it detects a constructed stale read)\n`);
}

/** What a capture of the rotation is told: the page, and how many steps. The service adds `url`. */
const BODY = { steps: STEPS };

/** The rotation as the cases of ONE group, in order: round after round of A, B, C. IDs carry the position (`000.structure-good.html`), so the order is the file's and the report reads it back. */
export function rotationCases(base: string, rounds: number): FleetCase[] {
  const cases: FleetCase[] = [];
  for (let index = 0; index < rounds * PAGES.length; index += 1) {
    const { page } = PAGES[index % PAGES.length];
    cases.push({ id: `${String(index).padStart(3, "0")}.${page}`, url: `${base}/${page}`, body: { ...BODY }, group: "identity-rotation" });
  }
  return cases;
}

/** One capture of the rotation, read from its record: what it heard and which marks it carries, or the error that took its place. */
function readCapture(body: Loose | undefined, why: string) {
  if (!body || body.error) return { error: String(body?.error ?? why) };
  const marks = (body.diagnostics ?? []).filter((m: Loose) => m && typeof m === "object");
  return {
    transcript: body.transcript ?? [],
    reused: marks.some((m: Loose) => m.event === "browserReused"),
    refreshed: marks.some((m: Loose) => m.event === "browseBufferRefreshed"),
    title: marks.find((m: Loose) => m.event === "documentReady")?.title ?? null,
  };
}

function report(tally: Loose, reusedCount: Loose, refreshedCount: Loose, total: Loose) {
  process.stdout.write(`\n  captures            ${total}\n`);
  process.stdout.write(`  on a REUSED window  ${reusedCount}  (the only ones that can express the fault)\n`);
  process.stdout.write(`  buffer refreshed    ${refreshedCount}\n`);
  for (const [outcome, count] of Object.entries(tally)) {
    const pct = total ? (((count as number) / total) * 100).toFixed(1) : "0.0";
    process.stdout.write(`  ${outcome.padEnd(19)} ${String(count).padEnd(4)} ${pct}%\n`);
  }
  // Capture errors are NOT wrong pages, and must not be reported as though the fault under test occurred.
  // But they shrink the denominator, so a run that lost a third of its captures has a much weaker bound than
  // its headline suggests — and a cluster of them at the END is the documented speech-channel decay, not a
  // page problem. Say so, rather than leaving a reader to infer reliability from a percentage.
  const errors = tally.error ?? 0;
  if (errors) {
    const rate = ((errors / total) * 100).toFixed(1);
    process.stdout.write(`\n  ${errors} capture error(s) (${rate}%) — these are worker reliability, not wrong\n`
      + "  pages, and they are excluded from the rate below. Consecutive errors late in a long run are the\n"
      + "  known NVDA speech-channel decay; check /health.vitals.recoveries before blaming the pages.\n");
  }
  // The rate B2 asks for. Stated with its denominator, because "0%" of three captures is not a bound.
  const wrong = tally["wrong-page"] ?? 0;
  process.stdout.write(`\n  WRONG-PAGE RATE: ${wrong}/${reusedCount} reused-window captures`);
  if (reusedCount > 0 && wrong === 0) {
    // Rule of three: with no events in n trials the 95% upper bound is about 3/n.
    process.stdout.write(` — 95% upper bound about ${((3 / reusedCount) * 100).toFixed(1)}%\n`);
    process.stdout.write("  A zero count is an upper bound, never proof of absence. Raise --rounds to tighten it.\n");
  } else {
    process.stdout.write("\n");
  }
  return wrong;
}

/**
 * Classify every capture of the rotation against its predecessor, in order.
 *
 * Separated from `main` so the narrative there reads as setup, measurement, report — this function is the measurement, and it is the only place that knows a capture's outcome depends on
 * what came before it. It reads the captures the job took; it sends nothing.
 */
function classifyRotation(results: ReturnType<typeof readCapture>[]) {
  const tally: Record<string, number> = { correct: 0, "wrong-page": 0, silent: 0, unrecognised: 0, error: 0 };
  const counts = { reused: 0, refreshed: 0, total: 0 };
  let previous = null;

  for (const [index, result] of results.entries()) {
    const want = PAGES[index % PAGES.length];
    counts.total += 1;

    if ("error" in result && result.error) {
      tally.error += 1;
      process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)}`
        + ` ERROR ${result.error.slice(0, 62)}\n`);
      // A failed capture leaves no window to reuse, so the next one starts fresh and its predecessor is not
      // a page we read. Clearing this keeps any later stale-read claim honest.
      previous = null;
      continue;
    }

    const read = result as Exclude<typeof result, { error: string }>;
    if (read.reused) counts.reused += 1;
    if (read.refreshed) counts.refreshed += 1;
    const outcome = classifyCapture({ transcript: read.transcript, want, previous });
    tally[outcome] += 1;
    process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)}`
      + ` ${read.reused ? "reused " : "fresh  "} ${outcome.padEnd(13)}${flagFor(outcome, previous)}\n`);
    previous = want;
  }
  return { tally, counts };
}

/** Anything other than `correct` is called out on its own line, and a stale read names the page it read. */
function flagFor(outcome: Loose, previous: Loose) {
  if (outcome === "correct") return "";
  const from = outcome === "wrong-page" ? ` (read ${previous?.page})` : "";
  return `  <-- ${outcome.toUpperCase()}${from}`;
}

const JOB_KIND = "identity-rate";
const FLEET_ROOT = joinPath(repeatCapturesRoot(), "identity-rate");

export function rotationCollector(): Collector {
  return async (fetched) => {
    // In the order the rotation ran: the position is in the case's ID.
    const entries = fetched.manifest.captures.filter((c) => c.case).sort((a, b) => String(a.case).localeCompare(String(b.case), undefined, { numeric: true }));
    const results = entries.map((entry) => readCapture(
      (entry.status === "done" ? fetched.record(entry)?.capture : undefined) as Loose | undefined,
      entry.status === "done" ? "no record came back" : whyNoCapture(entry, fetched.record(entry)),
    ));
    const { tally, counts } = classifyRotation(results);
    process.stdout.write(`  on ${[...new Set(entries.map((e) => e.box))].join(", ") || "no box"}\n`);
    const wrong = report(tally, counts.reused, counts.refreshed, counts.total);

    // A run with no reused-window captures MEASURED NOTHING, and it used to say "0/0" and exit 0 — which reads
    // as a clean result. Found by running it against a worker whose speech channel had died: 3 of 3 captures
    // errored, the rate printed 0/0, and the exit code said success. That is this repo's own rule about checks
    // that report success having examined nothing, in a tool written to enforce it.
    if (counts.reused === 0) {
      process.stdout.write("\n  MEASURED NOTHING: no capture navigated an already-open window, so the fault under\n"
        + "  test could not occur and this run is not evidence about it. Check the worker before rerunning.\n");
      return { recapture: [], exit: 3 };
    }
    // Exit non-zero on a wrong page: this is a gate as well as a measurement, and reading evidence from the
    // wrong page is the most damaging failure available to a tool that makes accessibility claims.
    return { recapture: [], exit: wrong > 0 ? 1 : 0 };
  };
}

async function main() {
  refuseIfRunsReadonly(FLEET_ROOT);
  selfTest();
  const port = Number(process.env.DATASET_PAGES_PORT || 5050);
  const exit = await runFleetClient({
    argv: process.argv.slice(2), root: FLEET_ROOT, kind: JOB_KIND, oneBox: {},
    hint: (job) => `npm run identity:rate -- --collect=${job}`,
    // Exit 1 means "a wrong page was read" and 3 "measured nothing" here: a job that failed or was cancelled measured nothing.
    stopExit: stopExitWith(3),
    prepare: async () => {
      const lease = await leasePageServer({ root: pagesDir, port, probePath: PAGES[0].page });
      // The BOXES fetch these pages, from this host's address on their subnet.
      return holdingPages(lease, () => ({ cases: rotationCases(pagesBaseUrl(process.env, port), ROUNDS), groups: { "identity-rotation": {} } }));
    },
    collect: rotationCollector(),
  });
  process.exit(exit);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
