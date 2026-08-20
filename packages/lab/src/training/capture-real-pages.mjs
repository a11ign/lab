/**
 * Capture the real-page corpus (ADR 0010).
 *
 *   node packages/lab/src/training/capture-real-pages.mjs [--role=calibration|training] [--worker=URL]
 *
 * NEVER CACHED, and that is a requirement rather than a default. These pages live on the public web and
 * can change under us; the whole value of the corpus is that its evidence describes the page as it is now,
 * against a conformance claim its publisher makes now. A cache hit here would silently pair today's claim
 * with last month's announcements.
 *
 * Each capture records the page's PUBLISHED claim alongside the evidence, so a later training or
 * calibration step never has to re-derive a label — and never has to guess one. That is the ADR's
 * selection rule made mechanical: if a page is here, someone else already said whether it conforms.
 *
 * Deliberately NOT wired into `training:capture`. That command drives the synthetic corpus, is cached, and
 * is what a normal run uses; mixing a live-web fetch into it would make a routine run depend on w3.org
 * being up. This is a separate, explicit act.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { pagesFor, REAL_PAGES } from "./real-page-corpus.mjs";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS } from "../../../worker-fleet/src/worker-http.mjs";
import { workerIsUsable } from "../../../worker-fleet/src/worker-health.mjs";

const ROLE = process.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length) ?? null;
const WORKER = process.argv.find((a) => a.startsWith("--worker="))?.slice("--worker=".length)
  ?? process.env.A11Y_WORKER
  ?? null;
const OUT = resolve(process.cwd(), process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");

/** One capture may legitimately take a while: a real page is bigger than a generated one. */
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
/** Between captures, so a run cannot look like a crawl to the site being fetched. */
const POLITE_GAP_MS = 2_000;

// Read-through lines to allow on a real page. 600 rather than the worker's 150: the longest transcript in
// the current real-page corpus is ~145 lines under the old cap AND still reported `maxSteps`, so the true
// length is unknown and 150 was clearly binding. Generous on purpose -- the deadline is what should end a
// read-through on a pathological page, not an arbitrary line count, which is the same argument that took
// MAX_SWEEP_STEPS from 40 to 250.
const REAL_PAGE_STEPS = 600;

const slug = (url) => url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "");

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = (await requestJson(`${WORKER}/health`, { timeoutMs: 8_000 })).json;
      // `workerIsUsable`, not `ready === true`: a worker predating the field reports neither, and this
      // loop would have spent all 60 attempts against a healthy guest and then recorded "worker never
      // became ready" as a failure of the PAGE.
      if (workerIsUsable(health)) return true;
    } catch { /* mid-boot or mid-restart; keep waiting */ }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function capture(page) {
  const response = await requestJson(`${WORKER}/capture`, {
    method: "POST",
    // `probeForms` is OFF. These are somebody else's live pages, and the same rule the CLI follows applies
    // with more force here: pressing *Book* on a page we do not own is not a review. `probeFocus` is on —
    // Tab activates nothing.
    // `steps` RAISED for real pages. The worker's default is 150 read-through lines, sized for a generated
    // corpus whose largest page is 2,118 bytes -- and it truncates the transcript of most real pages.
    // Measured over the 26 shipped real captures: 9 of the 16 model-visible truncations are
    // `read-through:capped`, i.e. this cap and nothing else. A capped read-through makes the transcript a
    // PREFIX, and a prefix presented as a transcript is absence reported as evidence.
    //
    // Free, for two reasons. `steps` is part of `captureOptions` so changing it invalidates cached
    // captures -- and real-page captures are never cached, by construction. And the read-through is
    // separately bounded by `readThroughDeadline`, so a higher cap cannot run longer than the budget
    // allows; it only stops the cap binding BEFORE the deadline does. A budget is a ceiling, not a cost.
    body: { url: page.url, probeForms: false, probeFocus: true, steps: REAL_PAGE_STEPS },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const data = response.json ?? {};
  if (data.error) throw new Error(String(data.error).slice(0, 160));
  return data;
}

async function main() {
  if (!WORKER) {
    process.stderr.write("a worker is required: --worker=http://host:port (or A11Y_WORKER)\n");
    process.exit(2);
  }
  const pages = ROLE ? pagesFor(ROLE) : REAL_PAGES;
  if (!pages.length) {
    process.stderr.write(`no pages for role '${ROLE}'\n`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`Capturing ${pages.length} real page(s) into ${OUT}\n`);
  process.stdout.write("Never cached: these pages change, and stale evidence would be paired with a "
    + "current conformance claim.\n");

  let captured = 0;
  const failed = [];
  for (const page of pages) {
    if (!await waitUntilReady()) { failed.push(`${page.url}: worker never became ready`); continue; }
    process.stdout.write(`  ${page.role}  ${page.url}\n`);
    try {
      const evidence = await capture(page);
      writeFileSync(resolve(OUT, `${slug(page.url)}.json`), JSON.stringify({
        // The label travels WITH the evidence, and names who made the claim. A later step must never have
        // to re-derive it, because re-deriving it means deciding conformance ourselves.
        role: page.role,
        publishedClaim: page.publishedClaim,
        claimSource: page.source,
        demonstrates: page.demonstrates,
        capturedAt: new Date().toISOString(),
        capture: evidence,
      }, null, 2));
      captured += 1;
    } catch (error) {
      process.stdout.write(`    FAILED: ${error.message}\n`);
      failed.push(`${page.url}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, POLITE_GAP_MS));
  }

  process.stdout.write(`\n${captured}/${pages.length} captured\n`);
  // Named, not counted. "3 failed" tells you nothing about whether the corpus is usable.
  for (const line of failed) process.stdout.write(`  failed: ${line}\n`);
  process.exit(failed.length ? 1 : 0);
}

await main();
