// @ts-check
/**
 * DOES THE ORDER THE PROBES RUN IN CHANGE THE EVIDENCE? — determinism-plan D2.
 *
 * The property this whole plan exists to establish: given the same page, the tool produces the same
 * evidence, and the order the probes ran in does not change it. Nothing asserted that until now, and
 * `capture-core.mjs` declared the opposite in a comment: "ORDER IS LOAD-BEARING from here down".
 *
 * *Continuous Delivery*, "State in Acceptance Tests": establish a known-good starting point, and make the
 * steps atomic, because "the order in which they execute does not matter" eliminates "a major cause of
 * hard-to-track bugs". This is that claim made falsifiable.
 *
 * WHY `gate:stability` COULD NOT ANSWER IT. That gate repeats the same page in the SAME order, so it can
 * only catch timing flakiness. A probe that changes the page for the NEXT probe is invisible to it —
 * which is the failure that actually bit: four withdrawn 2.1.2 rules and a 2.1.1 false positive, every one
 * of them comparing two measurements taken in different states of the page.
 *
 * IT IS EXPECTED TO FAIL WHEN FIRST RUN, and that is the point. Per this repo's own order — "write the
 * check that would detect the problem, run it to confirm the problem is what you think, then fix, then
 * re-run" — a green result here before D3 would mean the gate cannot see the fault, not that there is none.
 *
 * BY CONTENT, NEVER BY COUNT. `compareCapture` is reused rather than reimplemented, and counts are exactly
 * what hid the disjoint-channel defect: the sweep found 4 form fields and the tab walk found 4 stops, with
 * nothing in common, and every count-based guard passed.
 *
 * Exit codes, matching the rest of the gates:
 *   0  the orders agree
 *   1  they DIFFER — the evidence depends on probe order
 *   2  INCONCLUSIVE: a page could not be captured in both orders, so nothing was compared
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { compareCapture } from "../src/capture/evidence-diff.mjs";
import { leasePageServer } from "../src/training/page-server.mjs";
import { guestReachableUrl } from "@a11y-witness/worker-fleet";
import { requestJson, assertWorkerUrl, CAPTURE_CLIENT_TIMEOUT_MS }
  from "../../worker-fleet/src/worker-http.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

refuseUnknownFlags(["--worker=", "--pages=", "--json"],
  { entry: import.meta.url, command: "npm run gate:probe-order" });

const ORDERS = /** @type {const} */ ([undefined, "focus-first"]);

/** Pages whose evidence must not depend on probe order, each with what it exists to catch. */
const PAGES = [
  {
    path: "image-missing-alt-behind-consent/good",
    reason: "a CONFORMANT page behind a consent banner that confines Tab — the shape that refuted three "
      + "2.1.2 rules and made 2.1.1 accuse every control on the page. determinism-plan D1 added it "
      + "precisely so this gate has something that can express the fault.",
  },
  {
    path: "keyboard-trap-modal-cycle/good",
    reason: "a dialog holding focus, dismissible from inside the ring. `anchorToTop` presses Escape before "
      + "the focus walk, so whether this page is still confined by the time it is measured depends on what "
      + "ran first — the coupling in its purest form.",
  },
  {
    path: "form-unlabelled/good",
    reason: "auto-focuses its input, so the sweep leaves NVDA in focus mode. The control: an ordinary page "
      + "with no overlay must agree across orders, or the gate is reporting something other than state.",
  },
];

const arg = (/** @type {string} */ name) =>
  process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

/**
 * Through `requestJson`, never a bare `fetch`. It carries the headers cap and the budget ladder that undici
 * otherwise ignores silently — `budget-ladder.test.ts` DISCOVERS every capture client and refuses a new one
 * that rolls its own, which is how it caught this file.
 *
 * @param {string} worker @param {string} url @param {string | undefined} probeOrder
 */
async function capture(worker, url, probeOrder) {
  const { status, json } = await requestJson(`${worker.replace(/\/$/, "")}/capture`, {
    method: "POST",
    body: { url, task: "Read the page and reach its controls.", probeFocus: true,
      probeForms: false, probeNavigation: false, ...(probeOrder ? { probeOrder } : {}) },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  if (status !== 200) return { error: `${status} ${JSON.stringify(json).slice(0, 160)}` };
  return { capture: json };
}

/**
 * Did the remedy this gate is meant to prove actually RUN on that capture?
 *
 * A green gate is not evidence on its own. `refreshBrowseBuffer` guarded on a flag nothing ever assigned,
 * returned early on every capture ever taken, and three `capture:check` runs passed — results it had no
 * part in producing would have vouched for it. So D3's `establishBrowseMode` marks itself, and this reads
 * the mark: agreement WITHOUT it means the orders happened to match, which is a different claim.
 *
 * @param {any} capture
 */
function establishedBrowseMode(capture) {
  return (capture?.diagnostics ?? []).some((/** @type {any} */ m) => m?.event === "establishBrowseMode");
}

async function main() {
  const worker = arg("--worker");
  if (!worker) {
    process.stderr.write("gate:probe-order needs --worker=<url>. It captures each page twice, so it cannot "
      + "run without one.\n");
    process.exit(2);
  }
  // VALIDATED, not merely truthy. `http://:8765` is a truthy string that `new URL` rejects, and the cost of
  // accepting it was measured at 29 minutes of readiness timeout recorded as a failure of the PAGE.
  assertWorkerUrl(worker);

  // LEASED, NOT ASSUMED, and this is not housekeeping — it is the difference between a gate and a false
  // pass. Edge serves its OWN error page when the port is dead, so two probe orders against nothing would
  // compare IDENTICAL and this would report PASS. That exact failure is on record here: a run whose page
  // server was stopped underneath it read a dead port for 46 captures and every one "succeeded".
  //
  // `probePath` names a page that must actually be served, so "serving" means serving THIS dataset rather
  // than merely holding the port. Released in the `finally`, so a gate that throws leaves the host as it
  // found it, and the lease is refcounted so a concurrent run is not torn down.
  const pages = await leasePageServer({
    root: resolve(process.env.DATASET_ROOT ?? "runs/screenreader-dataset", "pages"),
    port: 5050,
    probePath: `${PAGES[0].path}.html`,
  });
  try {
    // The GUEST fetches these pages and its localhost is not ours. `guestReachableUrl` owns that rewrite —
    // it is reused rather than re-derived here, because deriving it independently is how "every capture
    // fetched the GUEST's localhost" happened once already. The worker is named rather than leased, so the
    // lease is stated as `explicit` with a release that does nothing: there is nothing here to put back.
    const named = /** @type {const} */ ({ worker, source: "explicit", release: async () => {} });
    return await compareOrders(worker, arg("--pages") ?? guestReachableUrl(pages.url, named));
  } finally {
    await pages.release();
  }
}

/**
 * @param {string} worker
 * @param {string} base the guest-reachable page root — the guest's localhost is not ours
 */
async function compareOrders(worker, base) {
  const results = [];
  for (const page of PAGES) {
    const url = `${base}/${page.path}.html`;
    const taken = [];
    for (const order of ORDERS) taken.push(await capture(worker, url, order));
    const failed = taken.find((t) => t.error);
    if (failed) {
      // INCONCLUSIVE, never a pass. A page that could not be captured in both orders was not compared, and
      // "not compared" reading as "agrees" is the defect this whole plan is about, one layer out.
      results.push({ page: page.path, verdict: "INCONCLUSIVE", detail: failed.error });
      continue;
    }
    const diff = compareCapture(/** @type {never} */ (taken[0].capture), /** @type {never} */ (taken[1].capture));
    // The SECOND capture is the permuted one, and it is the only one with a preceding probe, so it is the
    // only one where the remedy can have run. Reported beside the verdict rather than assumed.
    const remedied = establishedBrowseMode(taken[1].capture);
    results.push({ page: page.path, verdict: diff.verdict, changes: diff.changes, phrases: diff.phrases,
      remedied });
  }

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } else {
    for (const r of results) {
      process.stdout.write(`  ${String(r.verdict).padEnd(12)} ${r.page}`
        + `${r.remedied === false ? "   [browse-mode remedy did NOT run]" : ""}\n`);
      for (const c of r.changes ?? []) {
        process.stdout.write(`      ${c.field}: ${c.before} -> ${c.after}`
          + `${c.lost.length ? `  lost ${JSON.stringify(c.lost.slice(0, 2))}` : ""}`
          + `${c.gained.length ? `  gained ${JSON.stringify(c.gained.slice(0, 2))}` : ""}\n`);
      }
      if (r.detail) process.stdout.write(`      ${r.detail}\n`);
    }
  }

  const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");
  const differing = results.filter((r) => r.verdict === "CHANGED" || r.verdict === "DRIFT");
  if (inconclusive.length) {
    process.stdout.write(`\nINCONCLUSIVE — ${inconclusive.length} page(s) were not captured in both orders, `
      + "so nothing was compared for them. This is not a pass.\n");
    process.exit(2);
  }
  if (differing.length) {
    process.stdout.write(`\nFAIL — the evidence depends on PROBE ORDER for ${differing.length} of `
      + `${results.length} page(s). A capture is meant to describe the page, not the sequence used to read `
      + "it; see docs/determinism-plan.md D3.\n");
    process.exit(1);
  }
  // A PASS THAT DID NOT EXERCISE THE REMEDY IS NOT EVIDENCE FOR IT. Agreement while `establishBrowseMode`
  // never ran means the two orders happened to match — a different and much weaker claim than "the state is
  // restored between probes", and exactly the shape that let an inert `refreshBrowseBuffer` collect three
  // green runs.
  const unexercised = results.filter((r) => r.remedied === false);
  if (unexercised.length) {
    process.stdout.write(`\nINCONCLUSIVE — the orders agree, but D3's browse-mode remedy did not run on `
      + `${unexercised.length} of ${results.length} page(s), so this says nothing about whether restoring `
      + "the state is what makes them agree.\n");
    process.exit(2);
  }
  process.stdout.write(`\nPASS — all ${results.length} page(s) give the same evidence under both probe `
    + "orders, with the browse-mode remedy exercised on every one.\n");
}

// Refuses to run when imported. Every npm entry point here does this, and a test discovers the ones that
// do not: a module that captures on import turns `import()` — which is how the tests check a file loads at
// all — into a live run against the fleet.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
