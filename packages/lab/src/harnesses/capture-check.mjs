// @ts-check
// capture-check.mjs — capture-regression test (ADR 0003, Phase 1).
//
// Drives the REAL capture worker over the bundled W3C tutorial pages and asserts
// the stable raw signals each page should yield. NVDA's transcript varies
// run-to-run, so we never diff exact text: we assert structural counts, whether
// the interaction probes fired, and the presence/absence of key announced
// substrings. Semantic WCAG classification is the judge's job (`npm run eval`).
//
// MUST run in an interactive desktop session with NVDA set up — see
// .github/workflows/capture-regression.yml. Exits non-zero on any failed check.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { captureWithNvda } from "@a11ign/nvda-worker";
import { capturedText } from "./captured-text.mjs";
import { leasePageServer } from "../training/page-server.mjs";
import { hostPagesBase } from "@a11ign/worker-fleet/host-address";
import { CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl, requestJson } from "@a11ign/worker-fleet/worker-http";
import { refuseUnknownFlags, flagValue } from "@a11ign/worker-fleet/cli-flags";
import { captureTolerantly } from "@a11ign/worker-fleet/capture-client";

/**
 * the capture-layer regression check. `--worker=` mistyped falls back to in-process mode, which
 * REFUSES while a worker is serving — so the check reports a refusal rather than running.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--worker="], { entry: import.meta.url, command: "npm run capture:check" });

// Drive a live WORKER over HTTP instead of NVDA in-process.
//
//   npm run capture:check -- --worker=http://REDACTED-INTERNAL-ADDRESS:8765
//
// This exists because the in-process path is why this check never ran. It refuses while a worker is
// serving -- correctly, since NVDA is one machine-wide resource -- so running it meant stopping the
// worker on the guest, driving a scheduled task in an interactive session, and starting it again. That
// is a ceremony, and this repo's own rule is that anything a human has to remember is something that
// does not happen: capture-core changed many times without it ever being run once.
//
// Nothing is lost. Every assertion below is a pure function of the capture RESULT -- transcript,
// structure, interaction -- all of which the worker returns over HTTP. If anything the worker path is
// the better test, because it is the path production uses. The in-process mode stays the default so
// capture-regression.yml on a Windows runner, which has no worker, is unaffected.
const WORKER_ARG = flagValue(process.argv, "worker");
// Validated only WHEN GIVEN: no `--worker` is a legitimate mode here (in-process NVDA, which is what
// `capture-regression.yml` runs on a Windows runner). So absence is a mode and a malformed value is an
// error, and those must not collapse into one check — `undefined` and `http://:8765` are both falsy.
const WORKER = validatedWorker(WORKER_ARG);

/** A clean message and exit 2, not a stack trace: a legible failure is the whole point of validating. */
function validatedWorker(/** @type {any} */ raw) {
  if (raw === undefined) return undefined;
  try {
    return assertWorkerUrl(raw, { source: "--worker" });
  } catch (error) {
    process.stderr.write(`${/** @type {any} */ (error).message}\n`);
    process.exit(2);
  }
}
// `requestJson`, not `fetch`: undici stops waiting for response HEADERS at 300 s whatever the
// AbortSignal says, and the worker writes its status and body together at the END of a capture.
// See worker-http.mjs -- this budget sits at or above that cap, so it never applied.

const STEPS = 40; // tutorial pages are tiny; a small read-through cap keeps it fast
const pagesDir = join(dirname(fileURLToPath(import.meta.url)), "../eval/pages/tutorials");

// Each check has:
//  - signature: text unique to THIS page that NVDA must have announced. This is
//    the Root-1 capture-integrity net: if NVDA read the wrong content (the Edge
//    start page / MSN feed / welcome screen / browser chrome), the signature is
//    absent and the whole check fails loudly instead of silently asserting
//    against polluted data. None of these strings occur in that chrome.
//  - assert: the deterministic raw signals for the page (NVDA's transcript
//    varies run-to-run, so we never diff exact text). [label, passed, actual].
const CHECKS = [
  {
    page: "structure-good.html",
    signature: /City Library/i,
    assert: (/** @type {any} */ r) => [
      ["read-through produced lines", r.transcript.length >= 3, r.transcript.length],
      // Specifically the h1: this is the announcement the readiness gate used to eat.
      ["read-through announces a heading level",
        r.transcript.some((/** @type {any} */ p) => /heading, level/i.test(p)),
        r.transcript.filter((/** @type {any} */ p) => /heading, level/i.test(p)).length],
      ["structural nav found headings", r.structure.headings.length >= 3, r.structure.headings.length],
      ["structural nav found landmarks", r.structure.landmarks.length >= 1, r.structure.landmarks.length],
    ],
  },
  {
    page: "structure-bad.html",
    signature: /City Library/i,
    // The point of the bad page: visual titles and div-soup expose NO real
    // headings or landmarks, even though it looks structured.
    assert: (/** @type {any} */ r) => [
      ["no real headings exposed", r.structure.headings.length === 0, r.structure.headings.length],
      ["no landmarks exposed", r.structure.landmarks.length === 0, r.structure.landmarks.length],
    ],
  },
  // Unlike the form-submit probe below, the disclosure probe re-reads the control's
  // state from the accessibility tree instead of waiting for a spontaneous
  // announcement, so it IS deterministic and the good/bad distinction can be gated.
  // Gate it: asserting only that the probe "fired" is what let a silent regression
  // through before, when both pages returned a document re-announce and a broken
  // disclosure became indistinguishable from a working one.
  {
    page: "disclosure-good.html",
    signature: /password|FAQ/i,
    assert: (/** @type {any} */ r) => [
      ["disclosure probe fired", r.interaction.stateChanges.length >= 1, r.interaction.stateChanges.length],
      ["found a collapsed control", /collapsed/i.test(r.interaction.stateChanges[0]?.control ?? ""), r.interaction.stateChanges[0]?.control],
      ["state updated to expanded", /\bexpanded\b/i.test(r.interaction.stateChanges[0]?.after ?? ""), r.interaction.stateChanges[0]?.after],
    ],
  },
  {
    page: "disclosure-bad.html",
    signature: /password|FAQ/i,
    assert: (/** @type {any} */ r) => [
      ["disclosure probe fired", r.interaction.stateChanges.length >= 1, r.interaction.stateChanges.length],
      // The whole point of the bad page: it reveals the panel but never updates
      // aria-expanded, so the re-read must still say "collapsed".
      ["state NOT updated (still collapsed)", /\bcollapsed\b/i.test(r.interaction.stateChanges[0]?.after ?? ""), r.interaction.stateChanges[0]?.after],
      ["state does not claim expanded", !/\bexpanded\b/i.test(r.interaction.stateChanges[0]?.after ?? ""), r.interaction.stateChanges[0]?.after],
    ],
  },
  // CI gates only on the robust signal: the form-submit probe fires and finds
  // the submit control. Whether the error was CONVEYED (the good/bad distinction)
  // is NOT gated here — NVDA's post-submit announcements are nondeterministic in
  // both channels (live-region and field re-read), even on a stable machine, so
  // gating on it would flake. The dump records both signals for visibility, and
  // the semantic distinction is validated by `npm run eval` on representative
  // fixtures (see ADR 0003 Phase 1b).
  {
    page: "forms-validation-good.html",
    signature: /Newsletter|Email address/i,
    probeForms: true,
    assert: (/** @type {any} */ r) => [
      ["form-submit probe fired", r.interaction.formChanges.length >= 1, r.interaction.formChanges.length],
      ["submit control identified", /sign ?up|submit|button/i.test(r.interaction.formChanges[0]?.control ?? ""), r.interaction.formChanges[0]?.control],
    ],
  },
  {
    page: "forms-validation-bad.html",
    signature: /Newsletter|Email address/i,
    probeForms: true,
    assert: (/** @type {any} */ r) => [
      ["form-submit probe fired", r.interaction.formChanges.length >= 1, r.interaction.formChanges.length],
    ],
  },
];

// Everything NVDA announced for a capture, flattened — used to confirm page identity.
/** What the worker believed it had loaded. A title matching the target with a transcript from elsewhere is
 * the stale-virtual-buffer fault specifically; both matching means the read, not the navigation, failed. */
function titleOf(/** @type {any} */ r) {
  return (r.diagnostics ?? []).find((/** @type {any} */ m) => m && m.event === "documentReady")?.title ?? null;
}

/**
 * Why did this capture fail its identity check?
 *
 * "Read the wrong content" and "read nothing at all" are different faults with different repairs, and this
 * message used to claim the first for both. That cost real time: four identity failures on
 * `structure-bad.html` read as the stale-virtual-buffer fault, because that page's structure fields are all
 * empty BY DESIGN (div-soup exposes no headings or landmarks), so identity rests entirely on the transcript —
 * and an empty transcript is the signature of a mute screen reader on a loaded host, not of a wrong page.
 *
 * The title is included for the non-empty case because it is what separates the two remaining explanations: a
 * correct title with someone else's content is the stale buffer, while a wrong title means the navigation
 * itself went somewhere unexpected.
 */
function identityFailureCause(/** @type {any} */ r) {
  const heard = r.transcript?.length ?? 0;
  if (heard === 0) {
    return "read NOTHING — the screen reader was silent, which is not the same as reading the wrong page";
  }
  return `read ${heard} line(s) of OTHER content, first ${JSON.stringify(r.transcript[0]).slice(0, 60)},`
    + ` while documentReady reported the title ${JSON.stringify(titleOf(r))}`;
}


// Browser focus on a shared CI desktop is racy: a transient window/banner can
// steal focus so NVDA reads chrome instead of our page. We can't make a single
// attempt deterministic, but the integrity signature lets us VERIFY each capture
// and RETRY until we have genuinely read the target page (or give up loudly).
const MAX_ATTEMPTS = 4;

// The guest cannot reach the host's filesystem, so worker mode serves the same pages over HTTP and
// addresses them by the host's LAN IP -- the same reason evidence-check derives `hostPages`.
/** @type {string | null} */
let pagesBase = null;

async function captureOnce(/** @type {any} */ check) {
  if (!WORKER) {
    return captureWithNvda(pathToFileURL(join(pagesDir, check.page)).href,
      { steps: STEPS, probeForms: !!check.probeForms });
  }
  const response = await captureTolerantly({
    worker: String(WORKER),
    body: { url: `${pagesBase}/${check.page}`, steps: STEPS, probeForms: !!check.probeForms },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const body = response.json ?? {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function captureConfirmed(/** @type {any} */ check) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await captureOnce(check);
    } catch (e) {
      console.log(`  attempt ${attempt}/${MAX_ATTEMPTS}: capture threw: ${(e && /** @type {any} */ (e).message) || e}`);
      continue;
    }
    if (check.signature.test(capturedText(result))) return result; // genuinely read the target page
    console.log(`  attempt ${attempt}/${MAX_ATTEMPTS}: page identity NOT confirmed (${check.signature})`
      + ` — ${identityFailureCause(result)}`);
  }
  return null;
}

// Assert the DIAGNOSTICS discriminate, not just that the capture is good.
//
// This exists because they did not. A dataset run rejected 25% of its captures for reading
// a blank document, and the worker recorded success for every one of them: across 73 kept
// captures `afterStart.lastSpoken` was empty 73/73 and `windowsActivate ok:false` never
// fired once. The file header named afterStart as the first thing to check when a capture
// comes back empty, and it could not tell empty from healthy.
//
// So on a capture we have just CONFIRMED read the right page, documentReady must say so. If
// this assertion ever fails, the indicator has stopped tracking reality — which is the
// failure that hid a quarter of a run. See docs/nvda-correctness-audit.md, Root C.
// Every fixture page here has headings and controls, so a read-through that carries no role
// information at all is a regression regardless of which page it is.
//
// This exists because a count-based check could not see content rot. The readiness gate was
// overwriting the read-through's first line with the document title, which deleted the h1's
// "heading, level 1, ..." announcement from every page -- and nothing went red: the phrase
// COUNT was unchanged, and the heading assertions below read the structural sweep, which uses
// a different NVDA command and was unaffected. Across 90 captures, "heading, level N" phrases
// fell from 105 to 15 and every check stayed green.
const ROLE_WORD = /\b(button|link|graphic|edit|heading|table|row|column|form|list)\b/i;

function fidelityAssertions(/** @type {any} */ result) {
  const spoken = result.transcript ?? [];
  const withRole = spoken.filter((/** @type {any} */ phrase) => ROLE_WORD.test(phrase));
  return [
    ["read-through carries role information", withRole.length > 0, `${withRole.length}/${spoken.length} phrases`],
  ];
}

function diagnosticsAssertions(/** @type {any} */ result) {
  const ready = (result.diagnostics ?? []).find((/** @type {any} */ e) => e.event === "documentReady");
  return [
    ["documentReady recorded", !!ready, ready ? "present" : "MISSING"],
    ["documentReady agrees the page was read", ready?.ok === true, ready?.title ?? null],
  ];
}

async function runCheck(/** @type {any} */ check) {
  process.stdout.write(`\n=== ${check.page} ===\n`);
  const result = await captureConfirmed(check);
  if (!result) {
    console.log(`  FAIL  page identity NOT confirmed after ${MAX_ATTEMPTS} attempts (could not read the target page)`);
    return 1;
  }
  // Dump the full (confirmed) capture so a failure shows exactly what NVDA produced.
  console.log(`  headings:    ${JSON.stringify(result.structure.headings)}`);
  console.log(`  landmarks:   ${JSON.stringify(result.structure.landmarks)}`);
  console.log(`  formFields:  ${JSON.stringify(result.structure.formFields)}`);
  console.log(`  stateChanges:${JSON.stringify(result.interaction.stateChanges)}`);
  console.log(`  formChanges: ${JSON.stringify(result.interaction.formChanges)}`);
  console.log(`  postSubmit:  ${JSON.stringify(result.interaction.postSubmitFields)}`);
  console.log(`  PASS  page identity confirmed (${check.signature})`);
  let failed = 0;
  const assertions = [...diagnosticsAssertions(result), ...fidelityAssertions(result), ...check.assert(result)];
  for (const [label, passed, actual] of assertions) {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(actual)})`);
    if (!passed) failed++;
  }
  return failed;
}

// Refuse to run alongside a live worker. NVDA is a single machine-wide resource, and this
// script drives it directly: two drivers on one machine stop each other's screen reader.
// Learned by doing it -- this check ran while the worker held a reused NVDA, stopped it on
// exit, and the worker then died on `Cannot connect to NVDA`.
async function workerIsServing() {
  const port = Number(process.env.A11Y_PORT || 8765);
  try {
    // `requestJson`, not `fetch` -- audit §9's "the HTTP client" row. Still a local, 2 s probe with no
    // exposure to undici's 300 s cap, but a second hand-rolled client for the same worker API is the
    // duplication this eliminates.
    const response = await requestJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 2000 });
    return response.ok;
  } catch {
    return false; // nothing listening is exactly what we want
  }
}

/**
 * Guarded, because importing this file used to RUN it.
 *
 * CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check that an .mjs file still loads, and
 * unguarded that check started an in-process capture: on this Mac it tried to spawn Edge through `cmd` and
 * died with `spawn cmd ENOENT`, and on the Windows worker it would have started NVDA — against the same
 * screen reader `a11ysrv` drives, which is the exact collision the first check below exists to prevent.
 */
async function main() {
  // In worker mode the worker SHOULD be serving -- that is what we are driving.
  if (!WORKER && await workerIsServing()) {
    console.error(
      "A capture worker is already serving on this machine. It drives the same NVDA this check " +
        "would, and whichever finishes first stops the other's screen reader.\n" +
        "Stop it first:  Stop-ScheduledTask -TaskName a11ysrv\n" +
        "Then re-run, and start it again afterwards."
    );
    process.exit(2);
  }

  let lease = null;
  if (WORKER) {
    lease = await leasePageServer({
      root: pagesDir,
      port: Number(process.env.DATASET_PAGES_PORT || 5050),
      probePath: CHECKS[0].page,
    });
    pagesBase = hostPagesBase(WORKER, process.env.DATASET_PAGES_PORT || 5050);
    console.log(`Driving worker ${WORKER}\nPages ${pagesBase}\n`);
  }

  let failures = 0;
  try {
    for (const check of CHECKS) failures += await runCheck(check);
  } finally {
    if (lease) await lease.release();
  }

  console.log(`\n${failures === 0 ? "ALL CAPTURE CHECKS PASSED" : `${failures} CAPTURE CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
