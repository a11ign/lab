// @ts-check
/**
 * How often does a capture read the WRONG PAGE? A rate, measured on the risky path.
 *
 *   npm run identity:rate -- --worker=http://REDACTED-INTERNAL-ADDRESS:8765 [--rounds=20]
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

import { leasePageServer } from "../training/page-server.mjs";
import { hostPagesBase } from "@a11ign/worker-fleet/host-address";
import { CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl } from "@a11ign/worker-fleet/worker-http";
import { refuseUnknownFlags, flagValue } from "@a11ign/worker-fleet/cli-flags";
import { captureTolerantly } from "@a11ign/worker-fleet/capture-client";

/**
 * asks whether a capture ever reads the WRONG page. `--rounds=` mistyped silently uses the default,
 * and a zero-count result is reported as a 95%% upper bound whose width depends entirely on it.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--worker=", "--rounds="], { entry: import.meta.url, command: "npm run identity:rate" });

// audit §9 "argv parsing": both were their own copy of the fifteen-file idiom. `?? ""` on WORKER preserves
// the original empty-string-when-missing exactly, since it reaches `String(WORKER)` downstream and
// `String(undefined)` is the literal text "undefined", not "".
const WORKER = flagValue(process.argv, "worker") ?? "";
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
export function classifyCapture(/** @type {any} */ { transcript, want, previous }) {
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

/**
 * Longer than the worker's own hard timeout, deliberately.
 *
 * The client must not give up before the server's bounded failure, or the worker's diagnosis — the fault code
 * it worked out and put in the response — is replaced by a transport error that says only "no answer". Same
 * rule as every deadline in the capture path: it has to exceed the slowest honest answer, because a check that
 * stops listening turns a finding into silence.
 *
 * This comment used to note that `fetch`'s ~300 s headers timeout was "close enough to lose the race, which is
 * exactly what happened" — and then raised the AbortSignal, which does not govern that timeout at all. So the
 * race was still lost, at 300 s, whatever this number said. `requestJson` is the actual remedy; see
 * worker-http.mjs for the measurement.
 */

async function captureOnce(/** @type {any} */ base, /** @type {any} */ page) {
  let body;
  try {
    const response = await captureTolerantly({
      worker: String(WORKER),
      body: { url: `${base}/${page}`, steps: STEPS },
      timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
    });
    body = response.json ?? {};
  } catch (error) {
    // One unreachable capture must not end a 60-capture measurement. An unhandled rejection here threw away
    // a whole run's evidence for a single timed-out request.
    return { error: `transport: ${/** @type {any} */ (error)?.message ?? error}` };
  }
  if (body.error) return { error: String(body.error) };
  const marks = (body.diagnostics ?? []).filter((/** @type {any} */ m) => m && typeof m === "object");
  return {
    transcript: body.transcript ?? [],
    reused: marks.some((/** @type {any} */ m) => m.event === "browserReused"),
    refreshed: marks.some((/** @type {any} */ m) => m.event === "browseBufferRefreshed"),
    title: marks.find((/** @type {any} */ m) => m.event === "documentReady")?.title ?? null,
  };
}

function report(/** @type {any} */ tally, /** @type {any} */ reusedCount, /** @type {any} */ refreshedCount, /** @type {any} */ total) {
  process.stdout.write(`\n  captures            ${total}\n`);
  process.stdout.write(`  on a REUSED window  ${reusedCount}  (the only ones that can express the fault)\n`);
  process.stdout.write(`  buffer refreshed    ${refreshedCount}\n`);
  for (const [outcome, count] of Object.entries(tally)) {
    const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
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
 * Capture every page in rotation `rounds` times, classifying each against its predecessor.
 *
 * Separated from `main` so the narrative there reads as setup, measurement, report — this function is the
 * measurement, and it is the only place that knows a capture's outcome depends on what came before it.
 */
async function runRounds(/** @type {any} */ base, /** @type {any} */ rounds) {
  const tally = { correct: 0, "wrong-page": 0, silent: 0, unrecognised: 0, error: 0 };
  const counts = { reused: 0, refreshed: 0, total: 0 };
  let previous = null;

  for (let index = 0; index < rounds * PAGES.length; index += 1) {
    const want = PAGES[index % PAGES.length];
    const result = await captureOnce(base, want.page);
    counts.total += 1;

    if (result.error) {
      tally.error += 1;
      process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)}`
        + ` ERROR ${result.error.slice(0, 62)}\n`);
      // A failed capture leaves no window to reuse, so the next one starts fresh and its predecessor is not
      // a page we read. Clearing this keeps any later stale-read claim honest.
      previous = null;
      continue;
    }

    if (result.reused) counts.reused += 1;
    if (result.refreshed) counts.refreshed += 1;
    const outcome = classifyCapture({ transcript: result.transcript, want, previous });
    tally[outcome] += 1;
    process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)}`
      + ` ${result.reused ? "reused " : "fresh  "} ${outcome.padEnd(13)}${flagFor(outcome, previous)}\n`);
    previous = want;
  }
  return { tally, counts };
}

/** Anything other than `correct` is called out on its own line, and a stale read names the page it read. */
function flagFor(/** @type {any} */ outcome, /** @type {any} */ previous) {
  if (outcome === "correct") return "";
  const from = outcome === "wrong-page" ? ` (read ${previous?.page})` : "";
  return `  <-- ${outcome.toUpperCase()}${from}`;
}

async function main() {
  // Validated, not merely present. A truthiness check passes `http://:8765`, and this harness derives the
  // page-server base FROM the worker address (`hostPagesBase`), so a malformed one produces a wrong pages
  // URL as well as a wrong worker — captured error pages, which is corrupted evidence rather than an
  // obvious outage.
  try {
    assertWorkerUrl(WORKER, { source: "--worker" });
  } catch (error) {
    process.stderr.write(`${/** @type {any} */ (error).message}\n`
      + "usage: npm run identity:rate -- --worker=http://<guest-ip>:8765 [--rounds=20]\n");
    process.exit(2);
  }
  selfTest();

  const port = Number(process.env.DATASET_PAGES_PORT || 5050);
  const lease = await leasePageServer({ root: pagesDir, port, probePath: PAGES[0].page });
  // The guest reaches the host on the .1 of its own subnet — the same derivation capture-check uses.
  const base = hostPagesBase(WORKER, port);

  let measured;
  try {
    measured = await runRounds(base, ROUNDS);
  } finally {
    await lease.release();
  }

  const { tally, counts } = measured;
  const wrong = report(tally, counts.reused, counts.refreshed, counts.total);

  // A run with no reused-window captures MEASURED NOTHING, and it used to say "0/0" and exit 0 — which reads
  // as a clean result. Found by running it against a worker whose speech channel had died: 3 of 3 captures
  // errored, the rate printed 0/0, and the exit code said success. That is this repo's own rule about checks
  // that report success having examined nothing, in a tool written to enforce it.
  if (counts.reused === 0) {
    process.stdout.write("\n  MEASURED NOTHING: no capture navigated an already-open window, so the fault under\n"
      + "  test could not occur and this run is not evidence about it. Check the worker before rerunning.\n");
    process.exit(3);
  }
  // Exit non-zero on a wrong page: this is a gate as well as a measurement, and reading evidence from the
  // wrong page is the most damaging failure available to a tool that makes accessibility claims.
  process.exit(wrong > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
