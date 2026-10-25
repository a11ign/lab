// @ts-check
/**
 * Capture the real-page corpus (ADR 0010).
 *
 *   node packages/lab/src/training/capture-real-pages.mjs [--role=calibration|training] --label=<ticket key> [--boxes=<n|ready|name,name>] [--wait=<duration>]
 *   node packages/lab/src/training/capture-real-pages.mjs --collect[=<job ID>]
 *
 * IT SUBMITS A FLEET JOB AND RUNS NO CAPTURE (A11-263). Each page is a case, grouped by PUBLISHER, so the control plane captures one site's pages one after another on one box and
 * no site ever sees two at once. That is stricter than the 2 s per-host gap it replaces (a capture takes about 191 s), and it holds at any fleet size for the reason the gap did.
 * The client records the job ID, waits once if it was told to (`A11Y_FLEET_WAIT`, `--wait=`), and writes each page's record from the manifest; without a wait it prints
 * the ID and the collect command and exits 75.
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
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { capturablePages, isRecordedRefusal, pagesFor, REAL_PAGES } from "./real-page-corpus.mjs";
import { parseShard, shardOf } from "./shard.mjs";
import { leasePageServer } from "./page-server.mjs";
import { realCorpusRoot, datasetRoot, refuseIfRunsReadonly, runsRoot } from "../dataset-paths.ts";
import { assertOneBrowserAcross as refuseSplitFleet, manifestProbe } from "./capture-fleet-guard.mjs";
import { appendRunRecord, captureRunsFile, runRecordFromManifest } from "./capture-run-record.mjs";
import { assertFleetRunsThisCheckout } from "@a11ign/screenreader-fleet/worker-code-check";
import { writeJsonAtomic } from "./write-atomic.mjs";
import { refuseUnknownFlags, flagValue } from "@a11ign/screenreader-fleet/cli-flags";
import { beginRun, continueRun } from "./capture-progress.mjs";
import { resumePlan, describeResume } from "./real-page-resume.mjs";
import { discoverRoles, roleCoverageLine } from "./real-page-role-coverage.mjs";
import { identityChecksFor, servedRequestedPageLine } from "./real-page-identity-summary.mjs";
import { FleetInputError, LEFT_THE_FLEET, fleetInputs, reachableFromBoxes, whyNoCapture, workerAddressNotice } from "../fleet/fleet-job.ts";
import { collectFlow, follow, pageServerEndsNotice, submitJob, uncollectedNotice } from "../fleet/capture-flow.ts";
// BY CODE, not the literal string — architecture-audit.md §5, item 4. `capture-faults.mjs` has no
// imports of its own, so it is safe from any portable tree; a renamed fault must not be able to make
// this branch silently stop firing.
import { FAULT } from "@a11ign/screenreader-worker/capture-faults";

/**
 * THE script that ran four shards against `--worker=http://:8765` for 29 minutes. `--shard=` arrives
 * through `parseShard`, so a regex over this file would not find it — which is why the list is read out
 * by hand rather than derived.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 *
 * `--worker=` is still NAMED: it is refused (or ignored, when the catalogue also passes `A11Y_FLEET_BOXES`) with the new form.
 */
refuseUnknownFlags(["--role=", "--worker=", "--shard=", "--allow-mixed-browsers", "--allow-stale-workers",
  "--allow-unchecked-fields", "--resume", "--boxes=", "--label=", "--wait=", "--collect"],
{ entry: import.meta.url, command: "npm run lab:job -- -e job=capture-real-pages" });

const ROLE = flagValue(process.argv, "role") ?? null;
/** Build one corpus from two browser builds anyway. Says so in the output; never the default. */
const ALLOW_MIXED = process.argv.includes("--allow-mixed-browsers");
/** Capture with a fleet that is not running this checkout. Says so in the output; never the default. */
const ALLOW_STALE = process.argv.includes("--allow-stale-workers");
/**
 * Capture on guests that were never ASKED about a `MUST_MATCH` field (#2047). Says so in the output,
 * naming each field and its reporter count; never the default.
 *
 * Its own flag rather than a second meaning for `--allow-mixed-browsers`: that one says *the guests
 * differ and I accept it*, this says *the guests were never asked*, and an operator who accepted the
 * first must not be taken to have accepted the second.
 */
const ALLOW_UNCHECKED_FIELDS = process.argv.includes("--allow-unchecked-fields");
/** `--collect` collects the newest uncollected real-page job; `--collect=<job ID>` a named one. Undefined when the flag is absent. */
const COLLECT = process.argv.find((arg) => arg === "--collect" || arg.startsWith("--collect="))?.slice("--collect".length + 1);
/** What this client's pending files are filed under, so `--collect` reads a real-page job and never a dataset or evidence-check one. */
const JOB_KIND = "real-pages";
const OUT = realCorpusRoot();

/**
 * The captures already on disk, as `{ url, capturedAt, capture }` — `url`/`capturedAt` are the two fields
 * resume reasons about; `capture` (#780) is the full record, kept so a caller can derive facts (document
 * identity among them) without re-reading and re-parsing every file a second time.
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
          // A CAPTURE, identified by shape. This directory held `abstention-sweep*.json` until `cbea0d3b`
          // moved it to `runs/abstention/`, and can hold other reports, which carry no `capture.url` — they
          // would read as `url: ""`, match no wanted page and be harmless, which is accidentally safe rather
          // than deliberately. `capturesIn` in `audit-rule-coverage.ts` identifies by shape for the same
          // reason and says why: a name convention is a second thing to keep in step.
          const url = parsed?.capture?.url;
          return typeof url === "string" && url
            ? { url, capturedAt: parsed.capturedAt, capture: parsed.capture } : null;
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
 * THE BODY EVERY REAL PAGE IS CAPTURED WITH, sent exactly (the service adds `url` and nothing else).
 *
 * A hand-argued policy, and the reasons for each probe are the comments inside, kept where the decision is made.
 *
 * @param {{ formState?: unknown }} page
 */
export function realPageBody(page) {
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
  return {
    probeForms: false, probeFocus: true, probeNavigation: true, probeFocusContext: true,
    probeFocusReveal: true,
    // A DECLARED state, or nothing. `probeForms` stays false above and this does not change that: it
    // activates whatever submit-like control the sweep walks past, on a page we do not own. A
    // `formState` is the page owner's own example, with values recorded in the corpus beside the URL
    // (ADR 0024) — so submitting is something the corpus says to do, not something the probe decides.
    ...(page.formState ? { formState: page.formState } : {}),
    steps: REAL_PAGE_STEPS,
  };
}

/**
 * The page's case ID in the job: its slug, which is also its file name, unless that is not a valid case ID. A slug is lower-cased for the ID (two IDs that differ only in
 * letter case are one file on some disks, and the service refuses them), shortened with a hash of the URL when it is too long, and given the same hash when it would repeat another.
 *
 * @param {string[]} urls
 * @returns {Map<string, string>} URL to case ID
 */
export function caseIdsFor(urls) {
  /** @type {Map<string, string>} */ const ids = new Map();
  const taken = new Set();
  const hash = (/** @type {string} */ url) => createHash("sha1").update(url).digest("hex").slice(0, 10);
  for (const url of urls) {
    let id = slug(url).toLowerCase();
    if (!id || id === "manifest" || id.length > MAX_ID) id = `${id.slice(0, MAX_ID - 11)}-${hash(url)}`;
    if (taken.has(id)) id = `${id.slice(0, MAX_ID - 11)}-${hash(url)}`;
    taken.add(id);
    ids.set(url, id);
  }
  return ids;
}

/** The longest case ID the service takes is 161; a margin is kept for the hash. */
const MAX_ID = 150;

/**
 * The publisher a URL belongs to, as a group name (letters, digits and `. _ + -`): a port's colon becomes a dash. Pages of one site are one group, so the service
 * captures them one after another on one box and no publisher sees two captures at once, however many boxes the job has.
 * @param {string} url
 */
export const publisherOf = (url) => new URL(url).host.replace(/[^A-Za-z0-9._+-]/g, "-");

/**
 * The service cases of a set of real pages: one case per page, its body the policy above, grouped by publisher. Fixture URLs are rewritten to an address the boxes can reach.
 *
 * @param {{ pages: any[], out: string, reachable?: (url: string) => string }} request
 */
export function realPagesJob({ pages, out, reachable = (url) => url }) {
  const ids = caseIdsFor(pages.map((page) => page.url));
  /** @type {Record<string, string>} */ const names = {};
  /** @type {Record<string, { url: string, role: string, publishedClaim: unknown, source: unknown, demonstrates: unknown }>} */ const described = {};
  /** @type {import("../fleet/fleet-job.ts").FleetGroups} */ const groups = {};
  const cases = pages.map((page) => {
    const id = /** @type {string} */ (ids.get(page.url));
    names[id] = resolve(out, `${slug(page.url)}.json`);
    described[id] = { url: page.url, role: page.role, publishedClaim: page.publishedClaim, source: page.source, demonstrates: page.demonstrates };
    groups[publisherOf(page.url)] = {};
    return { id, url: reachable(page.url), body: realPageBody(page), group: publisherOf(page.url) };
  });
  return { cases, groups, names, described };
}

/**
 * @typedef {{
 *   out: string, progress: import("./capture-progress.mjs").RunRecorder,
 *   assertFleetRunsThisCheckout: (boxes: string[], options: { when: string, read: (box: string) => Promise<string | null> }) => Promise<unknown>,
 *   assertOneBrowser: (manifest: import("../fleet/fleet-job.ts").Manifest, when: string) => Promise<unknown>,
 *   recordRun?: (manifest: import("../fleet/fleet-job.ts").Manifest) => Promise<unknown> | unknown,
 *   afterRun?: (wanted: Set<string>) => any[],
 *   log?: (line: string) => void,
 * }} RealPagesIo
 * @typedef {{ pages: Record<string, { url: string, role: string, publishedClaim: unknown, source: unknown, demonstrates: unknown }>, wanted: string[], total: number, reused: number, taken: number, resubmitted?: Record<string, boolean> }} RealPagesExtra
 */

/** @param {string} url @param {string} message @param {string | undefined} fault @param {(line: string) => void} log */
function reportFailed(url, message, fault, log) {
  log(`    FAILED: ${url}: ${message}`);
  // A WRONG PAGE on a corpus URL is almost always the SITE having moved it, not the tool going
  // wrong — measured 2026-08-26, when 7 of 50 calibration captures failed this way and every one
  // turned out to be a redirect the corpus had never been updated for. Saying so turns "14% of
  // captures failed" into one line of maintenance, and stops the next reader chasing the capture
  // path for a fault that is not there.
  if (fault === FAULT.WRONG_PAGE) {
    log("      ^ the site probably MOVED this page. The message above names what "
      + "it served; if that is the same content at a new address, update this entry's url in "
      + "real-page-corpus.mjs rather than debugging the capture.");
  }
}

/**
 * Collect a real-page job: write each page's record in the shape its readers read, and report what failed.
 *
 * Each record is the page's published claim beside the evidence, labelled by who made the claim. Nothing is re-captured: a real page that failed is a failure of that
 * page, named, and the corpus is whole or it is not. The preflights run first, over the boxes the job used, and end the run before anything is written.
 *
 * @param {RealPagesIo} io
 * @returns {import("../fleet/capture-flow.ts").Collector}
 */
export function realPagesCollector(io) {
  return async (fetched, pending) => {
    const { manifest } = fetched;
    const extra = /** @type {RealPagesExtra} */ (pending.extra);
    const used = [...new Set(manifest.captures.filter((c) => c.status === "done").map((c) => c.box))];
    if (used.length) await io.assertFleetRunsThisCheckout(used, { when: "at collect", read: async (box) => manifest.boxes.find((b) => b.name === box)?.workerCode ?? null });
    await io.assertOneBrowser(manifest, "at the END of the run");
    await io.recordRun?.(manifest);
    io.progress.setWorkers(manifest.boxes.map((box) => box.name));
    const lost = manifest.captures.filter((entry) => collectPage(io, fetched, extra, entry) === "lost").map((entry) => /** @type {string} */ (entry.case));
    if (lost.length) return { recapture: [], resubmit: resubmission(manifest, lost, pending, extra), exit: 0 };
    return { recapture: [], exit: summarise({ io, extra }) };
  };
}

/**
 * One page of the job: write its record, or fail it, saying why. A box that left the fleet took its unsent pages with it; a real page is independent of its neighbours, so each such
 * page is `lost` here and submitted again, once, in a new job.
 *
 * @param {RealPagesIo} io @param {import("../fleet/fleet-job.ts").FetchedJob} fetched @param {RealPagesExtra} extra @param {import("../fleet/fleet-job.ts").ManifestCapture} entry
 * @returns {"written" | "failed" | "lost"}
 */
function collectPage(io, fetched, extra, entry) {
  const log = io.log ?? (() => {});
  const caseId = /** @type {string} */ (entry.case);
  const page = extra.pages[caseId];
  const record = fetched.record(entry);
  const evidence = record?.capture;
  if (entry.status === "done" && evidence && !evidence.error) {
    log(`  ${page.role}  ${page.url}  [${entry.box}]`);
    // The label travels WITH the evidence, and names who made the claim. A later step must never have
    // to re-derive it, because re-deriving it means deciding conformance ourselves.
    writeJsonAtomic(resolve(io.out, `${slug(page.url)}.json`), {
      role: page.role, publishedClaim: page.publishedClaim, claimSource: page.source, demonstrates: page.demonstrates,
      capturedAt: record.capturedAt, capture: evidence,
    });
    io.progress.captured(page.url, (evidence.transcript ?? []).length);
    return "written";
  }
  const message = String(evidence?.error ?? whyNoCapture(entry, record)).slice(0, 300);
  if (LEFT_THE_FLEET.test(message) && !extra.resubmitted?.[caseId]) {
    io.progress.recapturing(page.url, "the box left the fleet; the page is submitted again");
    return "lost";
  }
  reportFailed(page.url, message, evidence?.fault, log);
  io.progress.failed(page.url, message);
  return "failed";
}

/** The pages whose box left, as a job of their own, marked so a second loss fails them instead of submitting them for ever. */
function resubmission(/** @type {import("../fleet/fleet-job.ts").Manifest} */ manifest, /** @type {string[]} */ lost, /** @type {import("../fleet/fleet-job.ts").Pending} */ pending, /** @type {RealPagesExtra} */ extra) {
  const wanted = new Set(lost);
  const cases = (manifest.cases ?? []).filter((c) => wanted.has(c.id)).map((c) => ({ id: c.id, url: c.url, body: c.body, group: c.group }));
  const marked = { ...(extra.resubmitted ?? {}), ...Object.fromEntries(lost.map((id) => [id, true])) };
  return {
    cases, groups: Object.fromEntries(cases.map((c) => [c.group, {}])), names: Object.fromEntries(cases.map((c) => [c.id, pending.names[c.id] ?? ""])),
    extra: { ...extra, resubmitted: marked },
  };
}

/**
 * End the run: the progress file's outcome, and what the corpus now holds. Reported against the WHOLE role, not against what this invocation happened to take. A resumed
 * run saying "3/3 captured" would be true of the run and a lie about the corpus. Counted from the progress file, so a page re-captured in a second job is counted once, in
 * the run it belongs to. Returns the exit code: 1 when any page failed.
 *
 * @param {{ io: RealPagesIo, extra: RealPagesExtra }} run
 */
function summarise({ io, extra }) {
  const log = io.log ?? (() => {});
  const cases = Object.entries(io.progress.snapshot().cases);
  const captured = cases.filter(([, c]) => c.status === "captured").length;
  const failed = cases.filter(([, c]) => c.status === "failed").map(([url, c]) => `${url}: ${c.reason}`);
  io.progress.finish(`${captured} of ${cases.length} captured, ${failed.length} failed`);
  log(`\n${captured + extra.reused}/${extra.total} captured`
    + (extra.reused ? ` (${extra.reused} reused by --resume, ${extra.taken} taken now)` : ""));
  // Named, not counted. "3 failed" tells you nothing about whether the corpus is usable.
  for (const line of failed) log(`  failed: ${line}`);
  // #780: THE MEASUREMENT #688 MADE BY HAND, MADE DURABLE. Read FRESH, after the run -- a capture just
  // taken is not yet in the `existing` snapshot resume planning read at the top. Scoped to THIS role's
  // own pages, the same population the captured/failed count above already reports against.
  const wanted = new Set(extra.wanted);
  const written = io.afterRun?.(wanted) ?? [];
  if (io.afterRun) log(servedRequestedPageLine(identityChecksFor(written)).replace(/\n$/, ""));
  return failed.length ? 1 : 0;
}

/**
 * A recorded refusal is not visited (#955): its outcome -- the site geo-redirected and the capture refused the
 * page it landed on -- is already on record, and reproducing it costs fleet time for a known answer. Named
 * on every run, so "not captured" can never read as "forgotten".
 * @param {readonly import("./real-page-corpus.mjs").RealPage[]} declared
 */
function reportRecordedRefusals(declared) {
  for (const { url, refused } of declared.filter(isRecordedRefusal)) {
    process.stdout.write(`  not visited, a recorded refusal: ${url} -> ${refused?.fault} `
      + `(${refused?.reason} to ${refused?.observed}), as recorded on #955\n`);
  }
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
async function leaseFixtureServer(/** @type {any} */ pages) {
  const local = pages.filter((/** @type {any} */ page) => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(page.url));
  if (!local.length) return null;
  const first = new URL(local[0].url);
  return leasePageServer({
    root: resolve(datasetRoot(), "pages"),
    port: Number(first.port),
    // A page this very run intends to capture, so a server answering the WRONG directory is caught here
    // rather than as an empty transcript later.
    probePath: first.pathname.replace(/^\//, ""),
  });
}

/** The fleet waivers, applied where the flags are parsed: the check is `capture-fleet-guard.mjs`, over the manifest's boxes. @param {import("../fleet/fleet-job.ts").Manifest} manifest @param {string} when */
async function assertOneBrowser(manifest, when) {
  await refuseSplitFleet(manifest.boxes.map((box) => box.name), when,
    { allowMixedBrowsers: ALLOW_MIXED, allowUncheckedFields: ALLOW_UNCHECKED_FIELDS, probe: manifestProbe(manifest) });
}

/** This run's line in `runs/capture-runs.jsonl` (#4459), from the manifest. A record that cannot be written is said and never changes the exit. */
function recordRun(/** @type {string} */ startedAt, /** @type {import("../fleet/fleet-job.ts").Manifest} */ manifest) {
  const file = captureRunsFile(runsRoot());
  try {
    appendRunRecord(runRecordFromManifest({ startedAt, manifest }), file);
  } catch (error) {
    process.stderr.write(`CAPTURE RUN RECORD NOT WRITTEN to ${file}: ${/** @type {Error} */ (error).message}\n`);
  }
}

/** @param {import("../fleet/fleet-job.ts").FleetInputs} inputs @param {import("./capture-progress.mjs").RunRecorder} progress */
function flowFor(inputs, progress) {
  const startedAt = progress.snapshot().startedAt;
  return {
    root: OUT,
    inputs,
    hint: (/** @type {string} */ job) => `node packages/lab/src/training/capture-real-pages.mjs --collect=${job}`,
    collect: realPagesCollector({
      out: OUT,
      progress,
      assertFleetRunsThisCheckout: (boxes, { when, read }) => assertFleetRunsThisCheckout(boxes, { when, allow: ALLOW_STALE, read, bareMetalUrls: [] }),
      assertOneBrowser,
      recordRun: (manifest) => recordRun(startedAt, manifest),
      afterRun: (wanted) => existingCaptures().filter((entry) => wanted.has(entry.url)),
      log: (line) => process.stdout.write(`${line}\n`),
    }),
  };
}

/** @param {import("./capture-progress.mjs").RunRecorder} progress @param {number} total @param {number} reused */
export function finishWithoutJob(progress, total, reused) {
  progress.finish("0 of 0 captured, 0 failed");
  process.stdout.write(`\n${reused}/${total} captured (${reused} reused by --resume, 0 taken now)\n`);
}

/** @param {import("../fleet/fleet-job.ts").FleetInputs} inputs */
async function submit(inputs) {
  const declared = ROLE ? pagesFor(/** @type {any} */ (ROLE)) : REAL_PAGES;
  const selected = capturablePages(declared);
  reportRecordedRefusals(declared);
  const pages = shardOf(selected, SHARD);
  if (!pages.length) {
    process.stderr.write(`no pages for role '${ROLE}'\n`);
    process.exitCode = 2;
    return;
  }
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`Capturing ${pages.length} real page(s)${SHARD.count > 1 ? ` (shard ${SHARD.index + 1}/${SHARD.count} of ${selected.length})` : ""} into ${OUT}\n`);
  process.stdout.write(`As a fleet job on ${inputs.boxes} box(es), grouped by publisher\n`);
  process.stdout.write("Never cached: these pages change, and stale evidence would be paired with a "
    + "current conformance claim.\n");
  // #314: a role NOT named here is silently left on whatever baseline it last had, and that fact used to
  // surface only twelve days later at `rules:real-pages`'s own comparison. Named at the START, against
  // the corpus's own roles rather than a written-down list, so a role added later cannot be left off it.
  process.stdout.write(roleCoverageLine({
    allRoles: discoverRoles(REAL_PAGES),
    touchedRoles: discoverRoles(selected),
  }));

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

  // Real pages are fetched from the live web, so this host serves nothing -- but it still FOLLOWS the run, and a sleeping driver stops it while the boxes stay healthy.
  const hostNotice = nonAuthoritativeHostNotice({ cwd: process.cwd(), servesPages: false });
  if (hostNotice) process.stdout.write(hostNotice);
  const pageServer = await leaseFixtureServer(pages);
  try {
    const earlier = uncollectedNotice(OUT, JOB_KIND);
    if (earlier) process.stderr.write(earlier);
    const progress = beginRun({ root: OUT, worker: null, baseUrl: null, cases: toCapture.map((page) => ({ id: page.url })) });
    // Everything was captured recently enough to be this measurement (`--resume`): nothing to submit, and the run says so as it always did.
    if (!toCapture.length) return finishWithoutJob(progress, pages.length, plan.reused);
    const job = realPagesJob({ pages: toCapture, out: OUT, reachable: (url) => reachableFromBoxes(url) });
    const flow = flowFor(inputs, progress);
    const pending = submitJob(flow, {
      kind: JOB_KIND, ...job,
      extra: { pages: job.described, wanted: pages.map((page) => page.url), total: pages.length, reused: plan.reused, taken: toCapture.length },
    });
    progress.addFleetJob({ id: pending.job, kind: JOB_KIND, submittedAt: pending.submittedAt });
    process.exitCode = await follow(flow, [pending]);
    const ends = pageServerEndsNotice(process.exitCode, pageServer?.started === true);
    if (ends) process.stderr.write(ends);
  } finally {
    await pageServer?.release?.();
  }
}

async function main() {
  refuseIfRunsReadonly(realCorpusRoot());
  const args = process.argv.slice(2);
  const notice = workerAddressNotice({ argv: args });
  if (notice) process.stderr.write(notice);
  const inputs = fleetInputs(args, process.env, { forCollect: COLLECT !== undefined });
  if (COLLECT === undefined) {
    await submit(inputs);
    return;
  }
  process.exitCode = await collectFlow(flowFor(inputs, continueRun(OUT)), COLLECT || undefined, JOB_KIND);
}

// Guarded for the same reason as `build-realism-tier.ts`: CLAUDE.md makes
// `node -e "import('./this.mjs')"` the only real check that an .mjs file still loads, and unguarded that
// check STARTS A CAPTURE RUN against the fleet. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = error instanceof FleetInputError ? 2 : 1;
  });
}
