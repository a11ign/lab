// @ts-check
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
import { nonAuthoritativeHostNotice } from "./capture-host.mjs";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { pagesFor, REAL_PAGES } from "./real-page-corpus.mjs";
import { parseShard, shardOf } from "./shard.mjs";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl } from "../../../worker-fleet/src/worker-http.mjs";
import { workerIsUsable } from "../../../worker-fleet/src/worker-health.mjs";
import { configuredWorkers, inventoryWorkerUrls } from "../../../worker-fleet/src/fleet-env.mjs";
import { leasePageServer } from "./page-server.mjs";
import { hostAddressForWorker } from "@a11y-witness/worker-fleet";
import { fleetConsistency, describeMismatches } from "../../../worker-fleet/src/fleet-consistency.mjs";
import { assertFleetRunsThisCheckout } from "../../../worker-fleet/src/worker-code-check.mjs";
import { drainAcrossPool } from "./worker-pool.mjs";
import { createHostThrottle, hostOf } from "./host-throttle.mjs";
import { writeJsonAtomic } from "./write-atomic.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { beginRun } from "./capture-progress.mjs";
import { resumePlan, describeResume } from "./real-page-resume.mjs";
import { captureTolerantly } from "../capture/capture-client.mjs";

/**
 * THE script that ran four shards against `--worker=http://:8765` for 29 minutes. `--shard=` arrives
 * through `parseShard`, so a regex over this file would not find it — which is why the list is read out
 * by hand rather than derived.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--role=", "--worker=", "--shard=", "--allow-mixed-browsers", "--allow-stale-workers",
  "--resume"], { entry: import.meta.url, command: "npm run lab:job -- -e job=capture-real-pages" });

const ROLE = process.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length) ?? null;
const WORKER = process.argv.find((a) => a.startsWith("--worker="))?.slice("--worker=".length) ?? null;
/** Build one corpus from two browser builds anyway. Says so in the output; never the default. */
const ALLOW_MIXED = process.argv.includes("--allow-mixed-browsers");
/** Capture with a fleet that is not running this checkout. Says so in the output; never the default. */
const ALLOW_STALE = process.argv.includes("--allow-stale-workers");
const OUT = resolve(process.cwd(), process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");

/**
 * The captures already on disk, as `{ url, capturedAt }` — the only two fields resume reasons about.
 *
 * Deliberately tolerant of a file that will not parse: a half-written capture from the kill this resume
 * exists to recover from is exactly what would be there, and treating it as unreadable means it gets
 * taken again, which is the safe direction.
 */
function existingCaptures() {
  try {
    // The cast states what the final filter establishes: entries that failed the shape check are null
    // and are dropped. A filter cannot narrow, and this repo has now met that five times in one day.
    return /** @type {any[]} */ (readdirSync(OUT)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const parsed = JSON.parse(readFileSync(resolve(OUT, name), "utf8"));
          // A CAPTURE, identified by shape. This directory also holds `abstention-sweep*.json` and other
          // reports, which carry no `capture.url` — they would read as `url: ""`, match no wanted page and
          // be harmless, which is accidentally safe rather than deliberately. `capturesIn` in
          // `audit-rule-coverage.ts` identifies by shape for the same reason and says why: a name
          // convention is a second thing to keep in step.
          const url = parsed?.capture?.url;
          return typeof url === "string" && url ? { url, capturedAt: parsed.capturedAt } : null;
        } catch {
          return null;
        }
      })
      .filter((/** @type {any} */ entry) => entry !== null));
  } catch {
    return []; // no directory yet: a first run, not a fault
  }
}

/**
 * Every worker this run may use, validated.
 *
 * The fleet, not a machine. This took a single `--worker` and captured 77 pages serially while three
 * identical boxes sat idle — ~6.5 h of a ~1.6 h job — and the escape hatch was `--shard=i/n` launched by
 * hand N times, which is both a manual step and the exact quoting surface that once sent four shards at
 * `--worker=http://:8765` for 29 minutes. Sharding is not parallelism; it is parallelism the operator has
 * to perform correctly every time.
 *
 * `configuredWorkers()` is the same reader `doctor`, `worker:code` and `fleet:status` use, so this file
 * cannot drift from them about what the fleet is. `--worker` still names ONE, for comparing two guests.
 *
 * Resolved in `main` rather than at module scope: validating on IMPORT would throw, and
 * `node -e "import(...)"` is the only real check that an .mjs file still loads.
 *
 * @returns {string[]}
 */
function resolveWorkers() {
  if (WORKER) return [assertWorkerUrl(WORKER, { source: "--worker" })];
  const configured = configuredWorkers();
  if (configured.length) return configured.map((w) => w.url);
  throw new Error(
    "no worker to capture with. Set A11Y_WORKERS (npm run fleet:env) for the whole fleet, or pass "
    + "--worker=http://host:8765 to use exactly one.");
}

/** One capture may legitimately take a while: a real page is bigger than a generated one. */
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
/**
 * Minimum gap between requests to ONE publisher, enforced per host rather than per process.
 *
 * It was a `sleep` between captures, which is a property of one process: run four and every publisher sees
 * four times the rate, so politeness silently weakened exactly as the fleet grew. Keyed on the host, the
 * rate a site sees is the same at any fleet size — which is what makes scaling out a decision nobody has
 * to weigh against being rude.
 *
 * Worth stating what the real limiter is, because it was misjudged once: a capture takes ~191 s and almost
 * all of it is NVDA reading a page already loaded. One worker therefore fetches from a given site about
 * once every three minutes, and this gap is ~1% of that cycle. The throttle matters for the case the
 * arithmetic does not cover — several workers drawing pages from the SAME publisher at once, which the
 * corpus makes likely (26 of 77 pages are w3.org).
 */
const POLITE_GAP_MS = 2_000;

/**
 * `--shard=i/n`. The parser and the slice live in `shard.mjs` so they can be tested, and so the job
 * launcher added in the lab-API work uses the same definition rather than a second one that agrees today.
 */
const SHARD = parseShard(process.argv);

// Read-through lines to allow on a real page. 600 rather than the worker's 150: the longest transcript in
// the current real-page corpus is ~145 lines under the old cap AND still reported `maxSteps`, so the true
// length is unknown and 150 was clearly binding. Generous on purpose -- the deadline is what should end a
// read-through on a pathological page, not an arbitrary line count, which is the same argument that took
// MAX_SWEEP_STEPS from 40 to 250.
const REAL_PAGE_STEPS = 600;

const slug = (/** @type {any} */ url) => url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "");

/**
 * Is this worth another attempt?
 *
 * Only a transport condition is. A malformed URL, a programmer error, a thrown assertion — none of those
 * get better by waiting, and treating them as "mid-boot" is how 29 minutes went missing.
 */
function isTransientNetwork(/** @type {any} */ error) {
  const TRANSIENT = new Set([
    "ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "EPIPE",
  ]);
  // `requestJson`'s own timeout rejects with a plain Error and no code; that IS a transport condition and
  // is the common case while a worker boots.
  return TRANSIENT.has(error?.code) || /timed out|timeout/i.test(/** @type {any} */ (error)?.message ?? "");
}

async function waitUntilReady(/** @type {any} */ workerUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = (await requestJson(`${workerUrl}/health`, { timeoutMs: 8_000 })).json;
      // `workerIsUsable`, not `ready === true`: a worker predating the field reports neither, and this
      // loop would have spent all 60 attempts against a healthy guest and then recorded "worker never
      // became ready" as a failure of the PAGE.
      if (workerIsUsable(health)) return true;
    } catch (error) {
      // Retry a NETWORK condition; re-throw anything else. This was a bare `catch`, and it absorbed an
      // `ERR_INVALID_URL` from a malformed `--worker` — spending all 60 attempts and then recording
      // "worker never became ready" as a failure of the PAGE. The comment directly above already warned
      // about that exact misattribution for a different cause; this is the same trap, one line down.
      //
      // Keyed on `error.code`, matching how this repo classifies everywhere else: `capture-faults.mjs`
      // records what matching on prose costs. A code we do not recognise is not ours to swallow.
      if (!isTransientNetwork(error)) throw error;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function capture(/** @type {any} */ page, /** @type {any} */ workerUrl) {
  const response = await captureTolerantly({
    worker: workerUrl,
    // `probeForms` is OFF. These are somebody else's live pages, and the same rule the CLI follows applies
    // with more force here: pressing *Book* on a page we do not own is not a review. `probeFocus` is on —
    // Tab activates nothing.
    //
    // `probeFocusContext` is ON as of 2026-09-02, and it sits on the same side of the line for a simpler
    // reason than `probeNavigation` needed: it presses TAB, which `probeFocus` already presses on every
    // one of these captures. It asks the page title either side of that, so it observes something we were
    // doing anyway rather than doing anything new to somebody's site.
    //
    // `probeFocusReveal` is ON as of 2026-09-05, and it is the FIRST probe here that presses ESCAPE on a
    // page we do not own — so it gets its own entry rather than riding on `probeFocus`'s.
    //
    // It walks up to 8 tab stops and presses Escape twice. The Tab half is free by this list's own test:
    // `probeFocus` already walks the entire ring, up to 150 stops, on every one of these captures. Escape
    // is the new keystroke, and it sits on the same side of the line as Tab rather than with `probeTyping`
    // — it enters nothing into a field, submits nothing, and writes to nobody's system. The most it can do
    // is dismiss a dialog or a consent banner, which is a thing a visitor does.
    //
    // TURNED ON TO CLOSE A GATE HONESTLY RATHER THAN BY WEAKENING A CLAIM. `promote` refused with
    // "1.4.13 (assessed) — no real capture carries focusReveal — the evidence this rule reads was never
    // collected, so it has not been silent, it has been UNASKED". The alternatives were to declare
    // `realPageEvidence: available: false` (untrue: the evidence can be collected) or to downgrade
    // 1.4.13's status (untrue: all 18 corpus cases discriminate). Collecting it is the only option that
    // does not misstate what the tool can do.
    //
    // Its sibling `probeTyping` stays OFF, and the difference is the whole of the consent argument here:
    // typing enters characters into a stranger's field, which is `probeForms`'s problem in another
    // costume. So 3.2.1 can be demonstrated on a real page and 3.2.2 cannot — recorded as
    // `realPageEvidence` on 3.2.2 rather than pretended away for both.
    //
    // `probeNavigation` is ON as of 2026-08-24, and the line it sits on the right side of is worth stating
    // because it is not the same line as `probeForms`. It follows the FIRST LINK, which is ordinary
    // browsing — the thing this tool already did to reach the page — where submitting a form writes to
    // somebody's system. On essentially every real page the first link IS the skip link, which is exactly
    // what 2.4.1 exists to test.
    //
    // Without it, two rules could never fire on a real page: `addInertSkipLink` and `addStaleRouteTitle`
    // both read `interaction.routeChange`, and 0 of 77 real captures carried any. `criterion-coverage.ts`
    // listed both as assessed the whole time. That is the defect `rules:coverage` was built to name — a
    // rule whose evidence is never collected is not covered, it is unexamined.
    //
    // Scope is deliberate: this is the LAB's research corpus of public information pages, not a change to
    // what the CLI does when pointed at an arbitrary URL. `chooseProbe` still owns that decision.
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
    body: {
      // REWRITTEN FOR THE WORKER, not sent as written. A fixture URL says `localhost`, and a worker's
      // localhost is the worker. See `workerReachable`.
      url: workerReachable(page.url, workerUrl),
      probeForms: false, probeFocus: true, probeNavigation: true, probeFocusContext: true,
      probeFocusReveal: true,
      // A DECLARED state, or nothing. `probeForms` stays false above and this does not change that: it
      // activates whatever submit-like control the sweep walks past, on a page we do not own. A
      // `formState` is the page owner's own example, with values recorded in the corpus beside the URL
      // (ADR 0024) — so submitting is something the corpus says to do, not something the probe decides.
      ...(page.formState ? { formState: page.formState } : {}),
      steps: REAL_PAGE_STEPS,
    },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const data = response.json ?? {};
  if (data.error) {
    // CARRY THE FAULT CODE ACROSS. The worker sends `{error, fault}` and this kept only the message, so
    // the host could not tell a wrong-page from a mute screen reader without matching on prose — the
    // exact thing `capture-faults.mjs` exists to avoid. Attached, not parsed.
    const failure = /** @type {NodeJS.ErrnoException} */ (new Error(String(data.error).slice(0, 300)));
    if (data.fault) failure.code = String(data.fault);
    throw failure;
  }
  return data;
}

/**
 * Capture every page, across every worker, writing each as it lands.
 *
 * The unit of work is ONE PAGE, and unlike the synthetic corpus that is not a constraint anybody has to
 * defend: a real page has no good/bad twin to keep on the same guest, so any worker may take any page and
 * the queue needs no grouping. `drainAcrossPool` supplies the shared queue, per-worker failure streaks,
 * eviction and requeue — the same dispatch the synthetic corpus, `evidence:check` and `capture:check` use,
 * rather than a fourth implementation of "hand work to whichever box is free".
 *
 * Each record is written the moment its page finishes, never batched to the end. A run that dies at page
 * 70 of 77 keeps 70 captures; batching would keep none, and these are live fetches that cannot be replayed.
 */
async function captureAcrossPool(/** @type {any} */ pages, /** @type {any} */ workers) {
  const waitTurn = createHostThrottle({ minGapMs: POLITE_GAP_MS });
  const captured = [];
  /** @type {any[]} */
  const failed = [];
  // A PROGRESS FILE, so this run can be ASKED about rather than guessed at.
  //
  // It printed a line per page to stdout and wrote nothing machine-readable, so
  // `lab:status -e job=capture-real-pages` fell back to the DATASET run's file and reported that run's
  // numbers under this job's name — `captured: 29, total: 1431` for a 50-page job. Reading another job's
  // progress as this one's is the first of the six misdiagnoses this file's own repo lists as costing a
  // day, and a status command that fills a gap with the wrong data is worse than one that says "no data".
  //
  // It also unblocks the settle check. `corpus-settled.mjs` asks a run whether it FINISHED; with no
  // progress file to ask, it falls back to the ten-minute clock, so the real-page audits refuse for ten
  // minutes after a run that ended cleanly. The Ansible plan named this work — "give the remaining long
  // jobs the beginRun() treatment" — and only the dataset capture ever got it.
  const progress = beginRun({
    root: OUT,
    worker: workers[0],
    baseUrl: null,
    cases: pages.map((/** @type {any} */ page) => ({ id: page.url })),
    captureTimeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });

  const outcome = await drainAcrossPool({
    workers,
    items: pages,
    keyOf: (page) => page.url,
    prepare: async (worker) => {
      if (!await waitUntilReady(worker)) throw new Error(`worker never became ready: ${worker}`);
      return { worker };
    },
    handle: async (page, { context }) => {
      // Per publisher, not per worker — so this waits only when another worker is already on this site.
      await waitTurn(hostOf(page.url));
      process.stdout.write(`  ${page.role}  ${page.url}${workers.length > 1 ? `  [${context.worker}]` : ""}\n`);
      const evidence = await capture(page, context.worker);
      writeJsonAtomic(resolve(OUT, `${slug(page.url)}.json`), {
        // The label travels WITH the evidence, and names who made the claim. A later step must never have
        // to re-derive it, because re-deriving it means deciding conformance ourselves.
        role: page.role,
        publishedClaim: page.publishedClaim,
        claimSource: page.source,
        demonstrates: page.demonstrates,
        capturedAt: new Date().toISOString(),
        capture: evidence,
      });
      captured.push(page.url);
      progress.captured(page.url, (evidence?.transcript ?? []).length);
    },
    hooks: {
      onWorkerUnusable: (/** @type {any} */ worker, /** @type {any} */ error) =>
        process.stdout.write(`  worker unusable, skipping it: ${worker} (${/** @type {any} */ (error).message})\n`),
      onItemFailed: (/** @type {any} */ page, /** @type {any} */ error) => {
        process.stdout.write(`    FAILED: ${page.url}: ${/** @type {any} */ (error).message}\n`);
        // A WRONG PAGE on a corpus URL is almost always the SITE having moved it, not the tool going
        // wrong — measured 2026-08-26, when 7 of 50 calibration captures failed this way and every one
        // turned out to be a redirect the corpus had never been updated for. Saying so turns "14% of
        // captures failed" into one line of maintenance, and stops the next reader chasing the capture
        // path for a fault that is not there.
        if (error.code === "wrong-page") {
          process.stdout.write("      ^ the site probably MOVED this page. The message above names what "
            + "it served; if that is the same content at a new address, update this entry's url in "
            + "real-page-corpus.mjs rather than debugging the capture.\n");
        }
        progress.failed(page.url, /** @type {any} */ (error).message);
        failed.push(`${page.url}: ${/** @type {any} */ (error).message}`);
      },
      onEvicted: (/** @type {any} */ worker, /** @type {any} */ { consecutiveFailures, handedBack }) =>
        process.stdout.write(`  EVICTING ${worker} after ${consecutiveFailures} consecutive failures; `
          + `${handedBack} page(s) go back to the queue\n`),
    },
  });
  // A page requeued off an evicted worker and then captured is not a failure; the pool's list is what
  // actually failed after every attempt.
  for (const f of outcome.failures) {
    const line = `${f.item?.url ?? f.key ?? "?"}: ${f.error ?? "failed"}`;
    if (!failed.includes(line)) failed.push(line);
  }
  progress.finish(`${captured.length} of ${pages.length} captured, ${failed.length} failed`);
  return { captured: captured.length, failed };
}

/**
 * Refuse to build ONE corpus out of workers running different browsers.
 *
 * `browserVersion` is in the capture cache key precisely because a fleet can run more than one image, and
 * `fleet:status` has reported INCONSISTENT for a long time — but only when a human ran it, and only
 * before a run rather than during one.
 *
 * Measured 2026-08-24: a worker that had been down came back with Edge auto-updated from the pinned
 * .101 to .107 while a corpus run was in flight. The fleet was consistent when the run started and was
 * not when it finished, and nothing noticed. Fifteen pages were captured under the wrong build before I
 * happened to look.
 *
 * Checked HERE, at the boundary, for the same reason `assertWorkerUrl` is: the alternative is discovering
 * it in the evidence weeks later, where a split fleet looks like a page that changed. And re-checked
 * after the run, because "consistent when it started" is exactly the claim that failed.
 *
 * `--allow-mixed-browsers` exists for the case where you know something the check does not, and it says
 * so in the output rather than passing quietly.
 */
async function assertOneBrowserAcross(/** @type {any} */ workers, /** @type {any} */ when) {
  if (ALLOW_MIXED) return;
  const guests = await Promise.all(workers.map(async (/** @type {any} */ url) => {
    try {
      return (await requestJson(`${url}/health`, { timeoutMs: 10_000 })).json ?? null;
    } catch {
      // Unreachable is not INCONSISTENT. A box that is asleep contributes no evidence and no mismatch,
      // and treating silence as a fault is how a check earns a reputation for crying wolf.
      return null;
    }
  }));
  const verdict = fleetConsistency(guests.filter(Boolean));
  if (verdict.consistent) return;
  process.stderr.write(`\nFLEET INCONSISTENT ${when}: ${describeMismatches(verdict.mismatches)}\n`
    + "Two browser builds must never write into one corpus — `browserVersion` is in the capture cache\n"
    + "key for exactly this reason, and a split shows up later as evidence that cannot be compared.\n"
    + "Pin the fleet (`provision-role.yml --tags edge`) or run with --allow-mixed-browsers.\n");
  process.exit(3);
}

/**
 * Serve the fixture pages, when this run needs them.
 *
 * Real pages are somebody else's and already on the internet; our own fixtures are files on disk, and
 * nothing was serving them. Measured 2026-08-25: the first fixture run reported "2/3 captured" and both
 * captures held **2 transcript lines, the first of which was "blank"** — Edge fetched a dead port,
 * served its own error page, and the run called it a success.
 *
 * That is verbatim the failure `page-server.mjs` was written for: *"a stray one can 404 an entire run
 * while it reports success"*. The lease is refcounted and returns the server it found if one is already
 * up, so this cannot kill a server another run is using.
 *
 * Only for fixture URLs. A run over published pages must not start a local server it has no use for,
 * and asking whether any page needs it is cheaper than a flag somebody has to remember.
 */
/**
 * A fixture URL the WORKER can fetch, which is not the one we wrote it as.
 *
 * The workers are separate machines. `localhost:5050` on a worker is the worker — it serves nothing, Edge
 * shows "Hmmm... can't reach this page", and that error page is captured and recorded as evidence.
 * Measured 2026-08-25: three fixture captures whose first transcript line was exactly that heading, from
 * a run that reported "2/3 captured".
 *
 * `guestReachableUrl` was written for this and its own comment describes it — *"every capture fetched the
 * GUEST's localhost … three attempts are burned per page"*. The corpus runner calls it; this one did not,
 * because until fixtures existed every page here was already on the internet.
 */
function workerReachable(/** @type {any} */ url, /** @type {any} */ workerUrl) {
  const parsed = new URL(url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return url;
  const hostAddress = hostAddressForWorker(workerUrl);
  if (!hostAddress) return url;
  parsed.hostname = hostAddress;
  return parsed.toString().replace(/\/$/, "");
}

async function leaseFixtureServer(/** @type {any} */ pages) {
  const local = pages.filter((/** @type {any} */ page) => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(page.url));
  if (!local.length) return null;
  const first = new URL(local[0].url);
  return leasePageServer({
    root: resolve(process.cwd(), "runs/screenreader-dataset/pages"),
    port: Number(first.port),
    // A page this very run intends to capture, so a server answering the WRONG directory is caught here
    // rather than as an empty transcript later.
    probePath: first.pathname.replace(/^\//, ""),
  });
}

async function main() {
  let workers;
  try {
    // Validated HERE, at the boundary, before a single page is fetched. This used to be a truthiness check,
    // and `http://:8765` is truthy — so the run started, and every page paid a five-minute readiness timeout
    // before being recorded as a failure of the page. `assertWorkerUrl` explains what an empty host means.
    workers = resolveWorkers();
  } catch (error) {
    process.stderr.write(`${/** @type {any} */ (error).message}\n`);
    process.exit(2);
  }
  const selected = ROLE ? pagesFor(/** @type {any} */ (ROLE)) : REAL_PAGES;
  const pages = shardOf(selected, SHARD);
  if (!pages.length) {
    process.stderr.write(`no pages for role '${ROLE}'\n`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`Capturing ${pages.length} real page(s)${SHARD.count > 1 ? ` (shard ${SHARD.index + 1}/${SHARD.count} of ${selected.length})` : ""} into ${OUT}\n`);
  process.stdout.write(`Across ${workers.length} worker(s): ${workers.join(", ")}\n`);
  process.stdout.write("Never cached: these pages change, and stale evidence would be paired with a "
    + "current conformance claim.\n");

  // CHECKPOINTING, which is a different thing from caching and the distinction is the whole design.
  //
  // A cache would reuse a capture because the URL matches, which is what these pages must never do. This
  // reuses one only while it is recent enough to belong to the SAME measurement — 50 pages at ~191 s is
  // ~32 minutes across five workers, and a kill loses all of it. The Workbook names checkpointing as the
  // pattern for exactly that; the window is what keeps it from becoming the cache this file refuses.
  const plan = resumePlan({
    urls: pages.map((page) => page.url),
    existing: existingCaptures(),
    now: Date.now(),
    resume: process.argv.includes("--resume"),
  });
  process.stdout.write(describeResume(plan, pages.length));
  // A NEW binding rather than reassigning `pages`, which is const — and the const is right: everything
  // above this line reasoned about the full list (the shard message, the page count), so rebinding it
  // would make those lines describe a set that no longer exists.
  const toCapture = plan.skip.size ? pages.filter((page) => !plan.skip.has(page.url)) : pages;

  // Real pages are fetched from the live web, so this host serves nothing — but it still DRIVES the run,
  // and a sleeping driver stops it while the workers stay healthy.
  const hostNotice = nonAuthoritativeHostNotice({ cwd: process.cwd(), servesPages: false });
  if (hostNotice) process.stdout.write(hostNotice);
  await assertOneBrowserAcross(workers, "before the run");
  // AND that they are running the code this checkout expects. The browser check asks whether the guests
  // agree with EACH OTHER; this asks whether they agree with the commit that will be stamped on the
  // evidence. A fleet can be perfectly consistent and uniformly four commits behind.
  await assertFleetRunsThisCheckout(workers,
    { when: "before the run", allow: ALLOW_STALE, bareMetalUrls: inventoryWorkerUrls() });
  const pageServer = await leaseFixtureServer(pages);
  let captured, failed;
  try {
    ({ captured, failed } = await captureAcrossPool(toCapture, workers));
  } finally {
    await pageServer?.release?.();
  }
  // AND AFTER. A worker can rejoin mid-run with a browser that updated while it was away, which is
  // exactly what happened on 2026-08-24 — so checking only at the start proves only that the start
  // was clean.
  await assertOneBrowserAcross(workers, "by the END of the run");

  // Reported against the WHOLE role, not against what this invocation happened to take. A resumed run
  // saying "3/3 captured" would be true of the run and a lie about the corpus, which is the shape this
  // repo names most often: a number that cannot be judged without the denominator it was computed from.
  process.stdout.write(`\n${captured + plan.reused}/${pages.length} captured`
    + (plan.reused ? ` (${plan.reused} reused by --resume, ${toCapture.length} taken now)` : "") + "\n");
  // Named, not counted. "3 failed" tells you nothing about whether the corpus is usable.
  for (const line of failed) process.stdout.write(`  failed: ${line}\n`);
  process.exit(failed.length ? 1 : 0);
}

// Guarded for the same reason as `build-realism-tier.mjs`: CLAUDE.md makes
// `node -e "import('./this.mjs')"` the only real check that an .mjs file still loads, and unguarded that
// check STARTS A CAPTURE RUN against the fleet. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
