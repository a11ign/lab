// @ts-check
// Capture ONE page N times and report which fields are stable.
//
//   npm run training:repeat -- --url=http://REDACTED-INTERNAL-ADDRESS:5050/<case>/good --times=5
//   npm run training:repeat -- --url=... --worker=http://REDACTED-INTERNAL-ADDRESS:8765 --probe-tables
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
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isTransient } from "./capture-decisions.mjs";
import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS } from "../../../worker-fleet/src/worker-http.mjs";
import { captureTolerantly } from "../../../worker-fleet/src/capture-client.mjs";
import { workerIsUsable } from "../../../worker-fleet/src/worker-health.mjs";
import { assertWorkerUrl } from "../../../worker-fleet/src/worker-http.mjs";
import { captureIsSelfConsistent } from "@a11ign/evidence/verify";
import { refuseUnknownFlags, flagValue } from "@a11ign/worker-fleet/cli-flags";
import { repeatCapturesRoot, refuseIfRunsReadonly } from "../dataset-paths.mjs";
import { EVIDENCE_FIELDS, fieldValues } from "../capture/evidence-diff.mjs";
import { compareIdentity, documentIdentity } from "@a11ign/evidence/document-identity";

/**
 * `--probe-forms` and `--probe-tables` are how a canary reaches the fields that carry interaction
 * evidence, and a canary that cannot express the fault is worthless.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 */
refuseUnknownFlags(["--url=", "--worker=", "--times=", "--steps=", "--task=", "--browser=", "--out=",
   "--probe-forms", "--probe-tables", "--probe-focus", "--probe-navigation", "--reuse"],
  { entry: import.meta.url, command: "npm run training:repeat" });

/**
 * A named `--flag=value`, or the fallback.
 *
 * `fallback` typed rather than inferred: defaulting to `null` infers exactly `null`, so every caller
 * supplying a real default became the error. The same shape `capture-fixtures.mjs` has.
 *
 * @param {string} name
 * @param {string | number | null} [fallback]
 */
// audit §9 "argv parsing": was its own copy of the fifteen-file idiom, now the shared, tested extractor.
const arg = (name, fallback = null) => flagValue(process.argv, name) ?? fallback;

const URL_ARG = arg("url");
// VALIDATED, not merely truthy. `http://:8765` is a truthy string that `new URL` rejects, and every
// client that took it on trust spent five minutes per page in readiness timeouts recorded as a failure
// of the PAGE. This one read `--worker` through the `arg()` helper, so the discovery test that requires
// exactly this could not see it until the flag was named literally in the file.
const WORKER = arg("worker", process.env.A11Y_WORKER);
if (WORKER) assertWorkerUrl(String(WORKER));
const TIMES = Number(arg("times", "5"));
const STEPS = Number(arg("steps", "10"));
const PROBE_TABLES = process.argv.includes("--probe-tables");
// `--probe-forms` and `--task` exist because without them this harness could not exercise the task-button
// or submit probes AT ALL, and those are where the interaction criteria (3.3.1, 4.1.3) live. The
// consequence was not theoretical: an intermittent contaminant in `formChanges.after` — a late document
// announcement credited to an activation, on a page whose finding is silence — reached the corpus with
// `gate:stability` reporting every canary stable, because no canary could reach the code path.
const PROBE_FORMS = process.argv.includes("--probe-forms");
// `focusOrder` has been in the compared fields below since they were widened, and it has been EMPTY on
// every canary ever run, because nothing could ask for the probe. A field that is compared and can never
// hold anything compares equal every time — the mirror of the defect recorded beside those fields, where
// ten were watched and the two carrying interaction evidence were not among them. Named literally rather
// than only through `arg()`, so the discovery test that requires flags to be guarded can see it.
const PROBE_FOCUS = process.argv.includes("--probe-focus");
const PROBE_NAVIGATION = process.argv.includes("--probe-navigation");
const TASK = arg("task");
const REUSE = process.argv.includes("--reuse");
// A new browser preset needs its own stability answer before it is trusted: "Chrome captures" and "Chrome
// captures the SAME THING TWICE" are different claims, and only the second one makes a corpus. Absent means
// the guest's configured browser, so existing invocations are unchanged.
const BROWSER = arg("browser");
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.
// Every capture is kept, not just summarised. The first real run of this harness found two degenerate
// captures and I could not say WHY, because the diagnostics -- stopReason, documentReady,
// readThroughRetry -- had been thrown away with the response. A harness that reports instability
// without keeping the evidence makes you run it twice.
const outArg = arg("out");
const OUT_DIR = outArg ? resolve(String(outArg)) : repeatCapturesRoot();
const BETWEEN_MS = 2_000; // let the guest settle, as a real run would between cases

// A probe-forms run with no task cannot activate anything, so it would compare an empty field five times
// and call it stable. Refuse rather than pass vacuously.

/**
 * A field as a LIST, whatever it is. One helper rather than `?? []` at every field, because each of those
 * is a branch and eighteen of them took `comparable` past the complexity limit — for no reading benefit,
 * since every line was doing the same thing.
 */
const list = (/** @type {any} */ value) => (Array.isArray(value) ? value : []);

/**
 * The fields worth comparing: everything a dataset signal can read — DERIVED from `evidence-diff.mjs`'s
 * `EVIDENCE_FIELDS`/`fieldValues` rather than a second, hand-maintained list and a second flatten.
 *
 * THE UNIFICATION, and why it replaced two independently-drifting copies: `gate:stability` (this file) and
 * `evidence:check` (`evidence-diff.mjs`) ask the same question of the same captures -- is the evidence the
 * SAME -- and each kept its own answer to "what counts as evidence" and "how do I flatten an object field
 * to compare it". They had already drifted once (`stability-fields.test.ts`'s own header: three separately
 * maintained lists, three different holes) and were pinned equal by a test rather than merged, which is
 * this repo's THIRD remedy, chosen only when the first two are unavailable. They were not unavailable here.
 *
 * Found 2026-09-06: `evidence-diff.mjs` gained a `NOT_EVIDENCE_KEYS` deny-list for `atMs` (a wall-clock
 * key inside `focusEvents.log` entries), fixed there, and `gate:stability` failed on the identical
 * `focusEvents` canaries two hours later — because `repeat-capture.mjs`'s OWN `flatten()` had no deny-list
 * at all and this file never learned of the fix. That is the fact-stated-twice shape at its most
 * expensive: the two gates that decide whether evidence is trustworthy disagreeing about what evidence IS.
 *
 * `transcript` stays this file's own concern, unchanged: `evidence-diff.mjs` compares it separately too
 * (as a SET, with drift named rather than exact-order equality), so it was never part of the shared table.
 */
export function comparable(/** @type {any} */ capture) {
  /** @type {Record<string, any[]>} */
  const out = { transcript: list(capture.transcript) };
  for (const field of EVIDENCE_FIELDS) {
    out[field[1]] = fieldValues(capture, field);
  }
  return out;
}

/**
 * WERE ALL N CAPTURES SERVED THE SAME DOCUMENT? — #687.
 *
 * This gate's whole premise is "one page, captured repeatedly, compared by CONTENT", and until now
 * nothing checked the premise. A canary served a different document — a consent wall, a sign-in
 * redirect, an outage page — reports EVERY field unstable, and the reader is sent to look for a
 * nondeterministic probe. Measured on `https://calendly.com/` (#685): two captures eight minutes apart
 * on one worker were served `accounts.google.com`'s sign-in wall and `calendly.com/scheduling`, and
 * every record said `url: "https://calendly.com/"`.
 *
 * Compared PAIRWISE AGAINST THE FIRST rather than by digest equality across the set: identity components
 * are optional, so two captures can be UNCOMPARABLE rather than equal or different, and a set of digests
 * would silently read "unexamined" as "differs". Returns the pairs that DIFFER, never the ones nobody
 * could compare.
 *
 * @param {any[]} captures the raw captures, in order
 * @returns {{ at: number, differing: any[] }[]} one entry per capture served a different document
 */
export function servedDifferentDocuments(captures) {
  if (captures.length < 2) return [];
  const first = documentIdentity(captures[0]);
  const differed = [];
  for (let i = 1; i < captures.length; i += 1) {
    const result = compareIdentity(first, documentIdentity(captures[i]));
    if (result.verdict === "DIFFERENT_DOCUMENT") differed.push({ at: i + 1, differing: result.differing });
  }
  return differed;
}

let recoveries = 0;
let pollsSurvived = 0;

async function captureOnce() {
  // TOLERANT OF A LOST SOCKET. This posted straight to `/capture` and treated `ETIMEDOUT` as a failed
  // capture -- so a dropped response discarded 12-520 s of screen-reader work the worker had already
  // finished and stored. Measured 2026-08-28: three `gate:stability` canaries lost that way across two
  // runs, on three different pages and three different boxes, each turning the gate INCONCLUSIVE.
  const response = await captureTolerantly({
    worker: String(WORKER),
    body: {
      url: URL_ARG, steps: STEPS, probeTables: PROBE_TABLES, reuseScreenReader: REUSE,
      ...(BROWSER ? { browser: BROWSER } : {}),
      // The task is what selects which button the probe activates -- a control whose announced name
      // shares a meaningful word with it -- so a probe-forms run without one activates nothing and
      // reports a stable empty field, which looks exactly like a pass.
      ...(PROBE_FORMS ? { probeForms: true } : {}),
      ...(PROBE_FOCUS ? { probeFocus: true } : {}),
      // `--probe-navigation`, because a canary that cannot express the fault is worthless and
      // 2.4.2's evidence — and any live region a LINK fires — exists only when this probe runs.
      ...(PROBE_NAVIGATION ? { probeNavigation: true } : {}),
      ...(TASK ? { task: TASK } : {}),
    },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  // COUNTED AND REPORTED, because "the recovery worked" and "the transport was quiet" produce the same
  // clean result -- and crediting a remedy for a result it had no part in producing is the
  // `refreshBrowseBuffer` defect this repo has now paid for three times in one day.
  if (response.recovered) recoveries += 1;
  pollsSurvived += response.pollsSurvived ?? 0;
  const body = response.json ?? {};
  if (!response.ok || body.error) {
    // Carry the worker's fault CODE, not just its prose. `isTransient` matches on codes; matching on
    // message text is the check that silently stops working when somebody rewords a throw site.
    throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`),
      { code: body.fault, status: response.status });
  }
  return body;
}

/**
 * Wait until the worker will actually take work.
 *
 * This tool had neither a readiness wait nor a retry, while the dataset runner has both -- so the
 * STABILITY GATE, which is the precondition for a corpus run, was going through the least robust
 * client in the codebase. One capture errored during a gate run purely because it started moments
 * after `worker:deploy` rebooted the guests, and the gate reported a perfectly stable page as failed.
 *
 * `ready` and not `ok`: `ok` only ever meant "the HTTP server is answering", and a worker answered it
 * while NVDA could not start.
 */
async function waitForReady(deadlineMs = 300_000) {
  const deadline = Date.now() + deadlineMs;
  let announced = false;
  while (Date.now() < deadline) {
    try {
      const health = (await requestJson(`${String(WORKER).replace(/\/$/, "")}/health`, { timeoutMs: 15_000 })).json;
      // `workerIsUsable`, not `health.ready`: an older worker reports no `ready` field at all, and testing
      // it for truthiness waits out the whole budget against a guest that was fine. It also covers `busy`,
      // so this no longer fires a capture at a worker mid-capture and collects a 429.
      if (workerIsUsable(health)) return;
      if (!announced) { console.log("  waiting for the worker to report ready ..."); announced = true; }
    } catch {
      if (!announced) { console.log("  waiting for the worker to answer ..."); announced = true; }
    }
    await sleep(5_000);
  }
  throw new Error(`worker never reported ready within ${deadlineMs / 1000}s`);
}

/**
 * One capture, retrying only INFRASTRUCTURE failures.
 *
 * The distinction is the whole point of this tool: a transient fault (a worker still booting, a mute
 * screen reader it recovered from, a wedged capture that timed out) says nothing about the page, so
 * retrying it is correct. Differing CONTENT is never retried -- that is the signal being measured, and
 * retrying it away would turn the gate into a rubber stamp.
 */
async function captureWithRetry(attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await captureOnce();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      console.log(`    transient (${/** @type {any} */ (error).code ?? /** @type {any} */ (error).message.slice(0, 40)}), retrying ${attempt}/${attempts - 1}`);
      await waitForReady();
    }
  }
}

/**
 * Only when RUN, never on import.
 *
 * Two separate things ran at module scope: the usage guards, which called `process.exit(2)` on the
 * IMPORTING process, and the capture run itself -- `mkdirSync`, then `waitForReady`, then five real
 * captures against a worker. `stability-gate.mjs` SPAWNS this script per canary, so importing it to check
 * it still loads meant driving the fleet.
 *
 * The usage guards move in here with the run, deliberately: a missing `--url` is a mistake made by a
 * CALLER, and there is no caller when the file is merely imported.
 */
async function main() {
  refuseIfRunsReadonly(OUT_DIR);
  if (PROBE_FORMS && !TASK) {
    console.error("--probe-forms needs --task=\"...\": the task selects which control is activated, so " +
      "without one nothing is activated and the run reports a stable empty result.");
    process.exit(2);
  }

  if (!URL_ARG || !WORKER) {
    console.error("usage: npm run training:repeat -- --url=<page> [--worker=<url>] [--times=5] " +
      "[--probe-tables] [--probe-forms] [--task=\"...\"] [--reuse]\n" +
      "  --worker may come from A11Y_WORKER; get one from scripts/local-worker/worker-ctl.sh pool");
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Before the FIRST capture, not just between retries. The gate runs straight after `worker:deploy`
  // reboots the guests, and a capture issued into a still-booting worker is what made a stable page
  // report as failed.
  await waitForReady();
  const runs = [];
  const raw = [];  // same order as `runs`
  const errors = [];
  for (let n = 1; n <= TIMES; n += 1) {
    process.stdout.write(`capture ${n}/${TIMES} ... `);
    try {
      const capture = await captureWithRetry();
      runs.push(comparable(capture));
      raw.push(capture); // the gates read the real shape (structure.headings), not the flattened one
      writeFileSync(resolve(OUT_DIR, `capture-${n}.json`), JSON.stringify(capture, null, 2) + "\n", "utf8");
      const retried = (capture.diagnostics ?? []).some((/** @type {any} */ e) => e.event === "readThroughRetry");
      console.log(`${capture.transcript.length} phrases${retried ? " (read-through retried)" : ""}`);
    } catch (e) {
      errors.push(`${n}: ${/** @type {any} */ (e).message}`);
      console.log(`FAILED ${/** @type {any} */ (e).message}`);
    }
    if (n < TIMES) await sleep(BETWEEN_MS);
  }

  report({ runs, raw, errors });
}

/**
 * Which captures were served another document, and what that does to everything printed after it.
 *
 * Split out of `report` for the same reason `report` was split out of `main`: the lint gate's
 * complexity-15 limit, and extraction is the honest fix rather than a suppression.
 *
 * @param {{ at: number, differing: any[] }[]} servedDifferently
 */
function printServedDifferently(servedDifferently) {
  // PRINTED BEFORE the field list, because it changes what the field list MEANS. Every field varying
  // across two different documents is the expected result, not a finding about a probe.
  for (const { at, differing } of servedDifferently) {
    console.log(`  DIFFERENT DOCUMENT  capture ${at} was not served the page capture 1 was: `
      + differing.map((/** @type {any} */ d) =>
        `${d.component} ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`).join("; "));
  }
  if (servedDifferently.length) {
    console.log("  ^ the instability above is a fact about the PAGE, not about this pipeline. Settle "
      + "which document you meant to capture before reading any field as unstable.");
  }
}

/**
 * The verdict. Split from `main` to stay inside the lint gate's 70-line and complexity-15 limits --
 * which is the honest fix for a long function, rather than a suppression.
 */
function report(/** @type {any} */ { runs, raw, errors }) {
  // A capture with no phrases heard nothing at all -- the known ForegroundLockTimeout/foreground
  // flake. It is a failure, and it is a DIFFERENT failure from a probe that varies. Comparing it
  // against real captures would report every field as unstable and bury the question being asked.
  // So it is excluded from the comparison and named loudly, never quietly dropped.
  const empty = runs.filter((/** @type {any} */ r) => r.transcript.length === 0);
  // Captures the PRODUCTION pipeline would reject must not be compared here.
  //
  // `captureIsSelfConsistent` catches a capture whose read-through announced a heading while the heading
  // sweep found none -- the page was not traversed. The dataset runner already rejects and retries those
  // (capture-screenreader-dataset.mjs applies isEvidence), so comparing them here reports instability
  // that a real run would never have accepted.
  //
  // That is not hypothetical: the first capture after a worker restart came back HTTP 200 with empty
  // headings, formFields and stateChanges. It had a non-empty transcript, so the empty-capture filter
  // below did not catch it, and this tool declared four fields UNSTABLE. Two correct fixes were nearly
  // reverted on the strength of it.
  //
  // No title needed: this is the one gate in `isEvidence` that reads only the capture, and it is exactly
  // the one this failure trips.
  // Indexed against `raw`, because the gate reads `capture.structure.headings` and `runs` holds the
  // FLATTENED comparison shape where that path does not exist. Applying it to the flat object made every
  // capture look inconsistent -- caught by running the tool, which is the only check that catches this.
  const traversed = runs.map((/** @type {any} */ r, /** @type {any} */ i) => r.transcript.length > 0 && captureIsSelfConsistent(raw[i]));
  const inconsistent = runs.filter((/** @type {any} */ _, /** @type {any} */ i) => runs[i].transcript.length > 0 && !traversed[i]);
  const usable = runs.filter((/** @type {any} */ _, /** @type {any} */ i) => traversed[i]);
  // THE PREMISE, CHECKED. Indexed against `raw` for the same reason `traversed` is: identity reads the
  // capture's diagnostic marks, which the flattened comparison shape does not carry.
  const servedDifferently = servedDifferentDocuments(
    raw.filter((/** @type {any} */ _, /** @type {any} */ i) => traversed[i]));

  if (usable.length < 2) {
    console.error(`\nOnly ${usable.length} usable capture(s); nothing to compare.`);
    if (empty.length) console.error(`  ${empty.length} returned 0 phrases (the foreground flake)`);
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  }

  console.log(`\n${usable.length}/${TIMES} usable` +
    (empty.length ? `, ${empty.length} empty` : "") +
    (inconsistent.length ? `, ${inconsistent.length} rejected (not traversed)` : "") +
    (errors.length ? `, ${errors.length} failed` : "") +
    ` (${REUSE ? "reused" : "fresh"} NVDA each time)\n`);

  const unstable = compareFields(usable);

  printServedDifferently(servedDifferently);
  for (const e of errors) console.log(`  FAILED    ${e}`);
  if (empty.length) {
    console.log(`  EMPTY     ${empty.length} capture(s) heard nothing at all — the foreground flake, ` +
      "excluded from the comparison above because it would mark every field unstable");
  }
  // ALWAYS PRINTED, including the zero. A line that appears only when something happened cannot tell
  // "nothing happened" from "nobody looked" -- the distinction every diagnostic mark in this repo exists
  // to preserve.
  console.log(`sockets recovered: ${recoveries} (a capture the worker had finished and we nearly re-paid for)`);
  // The ASYNC equivalent, and it must be printed by the same rule: always, including the zero. Under the
  // synchronous protocol a dropped response destroyed a capture; now it costs one poll -- so this is the
  // number that says whether the network is still dropping things, independently of whether that hurts.
  console.log(`polls survived: ${pollsSurvived} (transport failures the async path absorbed)`);
  console.log(`\nraw captures kept in ${OUT_DIR} (diagnostics included)`);
  console.log(`${unstable === 0 ? "All compared fields are stable." : `${unstable} field(s) vary on an unchanged page.`}`);
  // A varying field is a failure: evidence that depends on timing rather than on the page. An empty
  // capture or an error is a failure too, just a different one -- so all three fail the run.
  // An inconsistent capture is a failure like the others -- production would retry it -- so it fails the
  // run rather than being quietly dropped from the comparison.
  // ONE LIST, not a five-term conjunction, and the reason is the lint gate's complexity limit rather
  // than taste -- each `&&` is a branch. The semantics are unchanged: all five are failures, they are
  // just DIFFERENT failures, which is why each is printed above under its own name rather than summed.
  //
  // A capture served another document fails the run like the other four, and for the same reason: this
  // gate must not report a canary STABLE, or usefully unstable, over a page it was never given.
  const failures = [unstable, errors.length, empty.length, inconsistent.length, servedDifferently.length];
  process.exit(failures.some((/** @type {number} */ n) => n > 0) ? 1 : 0);
}

/**
 * Field by field, is the evidence identical across runs? Returns how many varied.
 *
 * Split out of `report` to stay inside the complexity gate, and it is a real concern rather than a slice
 * taken to satisfy lint: this is the comparison the whole tool exists to make. Everything around it is
 * deciding WHICH captures are eligible to be compared.
 */
function compareFields(/** @type {any} */ usable) {
  let unstable = 0;
  for (const field of Object.keys(usable[0])) {
    const distinct = new Set(usable.map((/** @type {any} */ r) => JSON.stringify(r[field])));
    const counts = usable.map((/** @type {any} */ r) => r[field].length).join(",");
    if (distinct.size === 1) {
      console.log(`  STABLE    ${field.padEnd(13)} ${usable[0][field].length} item(s), identical every time`);
      continue;
    }
    unstable += 1;
    console.log(`  VARIES    ${field.padEnd(13)} counts ${counts} across runs`);
    // Show the variants, because "it varies" is not actionable and the difference usually names the
    // cause -- a missing header, a truncated walk, a lagging announcement.
    for (const shape of distinct) {
      const parsed = JSON.parse(shape);
      console.log(`      ${parsed.length}: ${JSON.stringify(parsed).slice(0, 110)}`);
    }
  }
  return unstable;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
