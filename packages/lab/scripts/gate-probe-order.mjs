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
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
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
  // THE REAL PAGES, and the plan's own success measure. Everything above is a page built for this gate, so
  // a green result on them alone demonstrates the property on the pages I chose — not on the one that
  // produced the problem. `nls.uk/join/` read 7 distinct stops of 7 tabbable and stayed SILENT in one run,
  // and was ACCUSED in another at the same commit; that row is why `docs/determinism-plan.md` exists.
  //
  // A live site can change between the two captures and that would read as order-dependence. The window is
  // the two captures back to back, about a minute, and the verdict names the field — a real edit shows up
  // as content moving, an ordering fault as a channel emptying. It is a confounder to read for, not a
  // reason to test only pages that cannot surprise us.
  {
    url: "https://www.nls.uk/join/",
    reason: "THE page the plan names: same commit, same page, two different verdicts. If the property holds "
      + "anywhere it has to hold here.",
  },
  {
    url: "https://tfl.gov.uk/modes/tube/",
    reason: "a consent banner confining Tab to link-and-buttons over a page with 4,107 DOM links — the "
      + "shape that refuted three 2.1.2 rules, at a scale no corpus page reaches.",
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

/**
 * Did THE PAGE change under the probes, as opposed to the probes disagreeing about one page? — D7.
 *
 * `pageState` is fingerprinted before each probe. Two probes seeing different counts means the page moved:
 * the sweep's disclosure probe activates a control, and on `nls.uk/join/` that opened a search panel and
 * confined the next probe to 10 tab stops where an untouched page gave 150.
 *
 * That is a DIFFERENT FAULT from order-dependence and needs a different answer — you cannot un-click a
 * disclosure, so the remedy is to see it rather than to prevent it. Reporting both as FAIL would make the
 * gate unactionable on any page with a menu.
 *
 * @param {any} capture
 */
function pageChangedUnderProbes(capture) {
  const states = (capture?.diagnostics ?? []).filter((/** @type {any} */ m) => m?.event === "pageState");
  if (states.length < 2) return false;
  const shape = (/** @type {any} */ s) => JSON.stringify([s.tabbable, s.formField, s.link, s.heading]);
  return states.some((/** @type {any} */ s) => shape(s) !== shape(states[0]));
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

/** Presentation only — extracted because the comparison and the rendering are different jobs. */
function report(/** @type {any[]} */ results) {
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    return;
  }
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

/**
 * @param {string} worker
 * @param {string} base the guest-reachable page root — the guest's localhost is not ours
 */
async function compareOrders(worker, base) {
  const results = [];
  for (const page of PAGES) {
    // A corpus path is served from the leased page server; a real page is fetched from the live web and
    // needs no base. Named `url` vs `path` rather than inferred, so an absolute URL cannot be silently
    // concatenated onto localhost — which is the failure that returns Edge's own error page and compares
    // identical under both orders.
    const url = page.url ?? `${base}/${page.path}.html`;
    const taken = [];
    for (const order of ORDERS) taken.push(await capture(worker, url, order));
    const failed = taken.find((t) => t.error);
    if (failed) {
      // INCONCLUSIVE, never a pass. A page that could not be captured in both orders was not compared, and
      // "not compared" reading as "agrees" is the defect this whole plan is about, one layer out.
      results.push({ page: page.url ?? page.path, verdict: "INCONCLUSIVE", detail: failed.error });
      continue;
    }
    const diff = compareCapture(/** @type {never} */ (taken[0].capture), /** @type {never} */ (taken[1].capture));
    // The SECOND capture is the permuted one, and it is the only one with a preceding probe, so it is the
    // only one where the remedy can have run. Reported beside the verdict rather than assumed.
    const remedied = establishedBrowseMode(taken[1].capture);
    // A page that moved under its own probes is reported as PAGE-MOVED, never as an ordering fault: the two
    // need opposite responses, and conflating them makes this gate unactionable on any page with a menu.
    const pageMoved = taken.some((/** @type {any} */ c) => pageChangedUnderProbes(c.capture));
    const verdict = diff.verdict !== "SAME" && pageMoved ? "PAGE-MOVED" : diff.verdict;
    results.push({ page: page.url ?? page.path, verdict, changes: diff.changes,
      phrases: diff.phrases, remedied, pageMoved });
  }

  report(results);

  const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");
  const differing = results.filter((r) => r.verdict === "CHANGED" || r.verdict === "DRIFT");
  const moved = results.filter((r) => r.verdict === "PAGE-MOVED");
  // A PAGE THAT MOVED UNDER ITS OWN PROBES WAS EXAMINED, and the answer is known — a control the sweep
  // activated altered what the next probe could see. It is reported, not counted as a failure and not as a
  // coverage gap: unfixable by restoring the screen reader's state, and the disclosure probe it comes from
  // is how 4.1.3 and half of 3.3.1 are reachable at all.
  if (moved.length) {
    process.stdout.write(`\n${moved.length} page(s) CHANGED UNDER THEIR OWN PROBES — see D7. Not an `
      + "ordering fault: the page the second probe read was not the page the first one did.\n");
  }
  // A PASS THAT DID NOT EXERCISE THE REMEDY IS NOT EVIDENCE FOR IT. Agreement while `establishBrowseMode`
  // never ran means the two orders happened to match — a weaker claim than "the state is restored between
  // probes", and the shape that let an inert `refreshBrowseBuffer` collect three green runs. Counted as NOT
  // EXAMINED, which is what makes `gateVerdict` refuse to call it a pass.
  const unexercised = results.filter((r) => r.remedied === false);
  const verdict = gateVerdict({
    examined: results.length - inconclusive.length - unexercised.length,
    of: PAGES.length,
    source: "corpus pages and live sites, each captured in both probe orders",
    failures: differing.length,
  });
  if (unexercised.length) {
    process.stdout.write(`\n${unexercised.length} page(s) agreed without D3's browse-mode remedy running, `
      + "so they are counted as unexamined rather than as passes.\n");
  }
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  process.exit(exitCodeFor(verdict));
}

// Refuses to run when imported. Every npm entry point here does this, and a test discovers the ones that
// do not: a module that captures on import turns `import()` — which is how the tests check a file loads at
// all — into a live run against the fleet.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
