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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { leasePageServer } from "../training/page-server.mjs";

const WORKER = (process.argv.find((a) => a.startsWith("--worker=")) ?? "").slice("--worker=".length);
const ROUNDS = Number((process.argv.find((a) => a.startsWith("--rounds=")) ?? "").slice("--rounds=".length) || 20);
const STEPS = 10;
const pagesDir = join(dirname(fileURLToPath(import.meta.url)), "../eval/pages/tutorials");

/**
 * Pages whose announcements cannot be mistaken for each other.
 *
 * `signature` is text this page must produce; `foreign` is the regex that proves a transcript came from
 * somewhere else. Keeping them separate matters: absence of your own signature says only "we did not hear
 * it", while presence of another page's says "we read that page" — a much stronger claim, and the one that
 * distinguishes a stale buffer from a quiet capture.
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
export function classifyCapture({ transcript, want, previous }) {
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

async function captureOnce(base, page) {
  const response = await fetch(`${WORKER}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `${base}/${page}`, steps: STEPS }),
  });
  const body = await response.json();
  if (body.error) return { error: String(body.error) };
  const marks = (body.diagnostics ?? []).filter((m) => m && typeof m === "object");
  return {
    transcript: body.transcript ?? [],
    reused: marks.some((m) => m.event === "browserReused"),
    refreshed: marks.some((m) => m.event === "browseBufferRefreshed"),
    title: marks.find((m) => m.event === "documentReady")?.title ?? null,
  };
}

function report(tally, reusedCount, refreshedCount, total) {
  process.stdout.write(`\n  captures            ${total}\n`);
  process.stdout.write(`  on a REUSED window  ${reusedCount}  (the only ones that can express the fault)\n`);
  process.stdout.write(`  buffer refreshed    ${refreshedCount}\n`);
  for (const [outcome, count] of Object.entries(tally)) {
    const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
    process.stdout.write(`  ${outcome.padEnd(19)} ${String(count).padEnd(4)} ${pct}%\n`);
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

async function main() {
  if (!WORKER) {
    process.stderr.write("usage: npm run identity:rate -- --worker=http://<guest-ip>:8765 [--rounds=20]\n");
    process.exit(2);
  }
  selfTest();

  const port = Number(process.env.DATASET_PAGES_PORT || 5050);
  const lease = await leasePageServer({ root: pagesDir, port, probePath: PAGES[0].page });
  // The guest reaches the host on the .1 of its own subnet — the same derivation capture-check uses.
  const base = `http://${new URL(WORKER).hostname.replace(/\.\d+$/, ".1")}:${port}`;

  const tally = { correct: 0, "wrong-page": 0, silent: 0, unrecognised: 0, error: 0 };
  let previous = null;
  let reusedCount = 0;
  let refreshedCount = 0;
  let total = 0;

  try {
    for (let index = 0; index < ROUNDS * PAGES.length; index += 1) {
      const want = PAGES[index % PAGES.length];
      const result = await captureOnce(base, want.page);
      total += 1;
      if (result.error) {
        tally.error += 1;
        process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)} ERROR ${result.error.slice(0, 60)}\n`);
        // A failed capture leaves no window to reuse, so the next one starts fresh and its predecessor is
        // not a page we read. Clearing this keeps a stale-read claim honest.
        previous = null;
        continue;
      }
      if (result.reused) reusedCount += 1;
      if (result.refreshed) refreshedCount += 1;
      const outcome = classifyCapture({ transcript: result.transcript, want, previous });
      tally[outcome] += 1;
      const flag = outcome === "correct" ? "" : `  <-- ${outcome.toUpperCase()}`
        + (outcome === "wrong-page" ? ` (read ${previous?.page})` : "");
      process.stdout.write(`  ${String(index).padStart(3)} ${want.page.padEnd(28)}`
        + ` ${result.reused ? "reused " : "fresh  "} ${outcome.padEnd(13)}${flag}\n`);
      previous = want;
    }
  } finally {
    await lease.release();
  }

  const wrong = report(tally, reusedCount, refreshedCount, total);
  // Exit non-zero on a wrong page: this is a gate as well as a measurement, and reading evidence from the
  // wrong page is the most damaging failure available to a tool that makes accessibility claims.
  process.exit(wrong > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
