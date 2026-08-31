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
import { probeStates } from "@a11y-witness/evidence/verify";
import { leasePageServer } from "../src/training/page-server.mjs";
import { guestReachableUrl } from "@a11y-witness/worker-fleet";
import { assertWorkerUrl, CAPTURE_CLIENT_TIMEOUT_MS }
  from "../../worker-fleet/src/worker-http.mjs";
import { renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { gateWorkers, acrossFleet, fleetVerdict, renderShards }
  from "../src/gates/fleet.mjs";
import { dispatchUnlessLocal, LOCAL_FLAG } from "../src/gates/dispatch.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { captureTolerantly } from "../src/capture/capture-client.mjs";

refuseUnknownFlags(["--worker=", "--pages=", "--json", LOCAL_FLAG],
  { entry: import.meta.url, command: "npm run gate:probe-order" });

/**
 * The three captures, in order: control-start, treatment, control-end.
 *
 * Named as data so the count is visible at the top of the file -- this gate costs 3 captures per page, not
 * 2, and that 50% is the price of separating an ordering effect from a page that simply changes.
 */
const CAPTURES_PER_PAGE = 3;

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
    // DECLARED to move under its own probes, which is why this gate could never pass.
    //
    // Its search panel opens when the sweep activates a control, so `interaction.focusOrder` goes 10 -> 150
    // between captures of the SAME page in the SAME order. That is D7, and it means the ordering question
    // is unanswerable here — not that coverage fell short. Undeclared, it reduced coverage on every run,
    // so the verdict was permanently INCONCLUSIVE and the job permanently exit 2. A gate that cannot pass
    // is one people stop dispatching, which is how a check comes to be bypassed.
    //
    // A DECLARATION, not a suppression, and it is checked in BOTH directions: a declared page that moves
    // is excluded from coverage and named; a declared page that does NOT move is reported as a STALE
    // declaration, because the reason for the exemption has then gone and the page should be earning its
    // keep again. That is the same rule `NOT_FOR_CASES` and the unclosable map follow — an exemption
    // nobody re-checks is how a work list comes to lie.
    movesUnderItsOwnProbes: "its search panel opens when a control is activated; focusOrder 10 -> 150",
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
  try {
    const { status, json } = await captureTolerantly({
      worker,
      body: { url, task: "Read the page and reach its controls.", probeFocus: true,
        probeForms: false, probeNavigation: false, ...(probeOrder ? { probeOrder } : {}) },
      timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
    });
    if (status !== 200) return { error: `${status} ${JSON.stringify(json).slice(0, 160)}` };
    return { capture: json };
  } catch (error) {
    // A NETWORK FAULT IS NOT AN ORDERING FAULT, and letting it throw made this gate say so. It crashed with
    // `read ETIMEDOUT` on a live site and exited 1 — which in this gate MEANS "the evidence depends on
    // probe order". One exit code for two unrelated events, which is the defect this whole plan is about,
    // in the gate written to find it.
    //
    // Caught and returned so the page becomes INCONCLUSIVE and the pages that DID capture keep their
    // verdicts. Live sites are reachable-until-they-are-not, and a gate that loses four good comparisons
    // because the fifth timed out is one nobody runs.
    return { error: `capture failed: ${error instanceof Error ? error.message : String(error)}` };
  }
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
 * Did the PAGE move under its own probes, rather than the evidence differing by order?
 *
 * READ FROM `probeStates`, WHICH OWNS THIS QUESTION. This hand-rolled the same comparison — the per-probe
 * fingerprint, compared field by field — and the two were written hours apart on the same day, this one
 * first. That is the fact-stated-twice shape in a change made to close a different instance of it, and it
 * would have drifted the moment either side learned a new field: this copy compares four counts, and
 * `FINGERPRINT_KEYS` has six.
 */
function pageChangedUnderProbes(/** @type {any} */ capture) {
  // `sameState === false` is the statement that the shape moved. `undefined` means fewer than two usable
  // fingerprints — nobody asked — and must NOT read as "the page held still", which is why this tests
  // for false rather than for falsiness.
  return probeStates(/** @type {never} */ (capture ?? {}))?.sameState === false;
}

async function main() {
  // THE CONTROL PLANE IS THE DEFAULT; this returns only under `--local`. See gates/dispatch.mjs.
  const { controlPlane } = await dispatchUnlessLocal({ job: "gate-probe-order", argv: process.argv.slice(2) });
  // EVERY WORKER BY DEFAULT, work SHARDED across them. This demanded `--worker` and refused without one,
  // so it captured 10 times on one box while the rest of the fleet idled -- and at twenty boxes that is
  // nineteen idle. Naming one stays available as the escape hatch.
  const named = arg("--worker");
  // VALIDATED, not merely truthy. `http://:8765` is a truthy string that `new URL` rejects, and the cost of
  // accepting it was measured at 29 minutes of readiness timeout recorded as a failure of the PAGE.
  if (named) assertWorkerUrl(named);
  const { workers, scope } = gateWorkers(named);

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
    // EVERY CAPTURE OF A PAGE STAYS ON ONE BOX. Splitting them would make a difference between orders
    // indistinguishable from a difference between machines -- the exact conflation this gate exists to
    // detect, arriving through the scheduler instead of through the probes. So the unit handed to the pool
    // is a PAGE, carrying all of its captures.
    process.stdout.write(`${scope}\n`);
    const outcomes = await acrossFleet(PAGES, workers, (page, worker) =>
      comparePage(page, worker, arg("--pages") ?? baseFor(pages, worker)));
    process.stdout.write(`\nWHERE THE WORK LANDED\n${renderShards(outcomes)}\n`);
    return report_(outcomes, workers.length, controlPlane);
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
    // THE CONTROL'S WORK IS PRINTED, ALWAYS, INCLUDING ZERO. A page that reads SAME because the control
    // subtracted a ticking clock and one that reads SAME because nothing drifted are DIFFERENT FACTS, and
    // only the first is evidence the control is doing anything. An inert control looks exactly like a
    // clean gate -- this repo's oldest lesson, and `explainedByTime` was computed and never surfaced,
    // which is the fifth time in two days a remedy has been left unable to report itself.
    const control = r.explainedByTime === undefined ? "   [control NOT REPORTED]"
      : `   [${r.explainedByTime} difference(s) explained by time]`;
    process.stdout.write(`  ${String(r.verdict).padEnd(12)} ${r.page}${control}`
      + `${r.remedied === false ? "   [browse-mode remedy did NOT run]" : ""}\n`);
    for (const c of r.changes ?? []) {
      process.stdout.write(`      ${c.field}: ${c.before} -> ${c.after}`
        + `${c.lost.length ? `  lost ${JSON.stringify(c.lost.slice(0, 2))}` : ""}`
        + `${c.gained.length ? `  gained ${JSON.stringify(c.gained.slice(0, 2))}` : ""}\n`);
    }
    if (r.detail) process.stdout.write(`      ${r.detail}\n`);
  }
}

/** The page-server base URL as THIS box can reach it. Derived per worker; localhost is not shared. */
function baseFor(/** @type {any} */ pages, /** @type {string} */ worker) {
  // The GUEST fetches these pages and its localhost is not ours. `guestReachableUrl` owns that rewrite --
  // reused rather than re-derived, because deriving it independently is how "every capture fetched the
  // GUEST's localhost" happened once already. The worker is named rather than leased, so the lease is
  // stated as `explicit` with a release that does nothing: there is nothing here to put back.
  return guestReachableUrl(pages.url, { worker, source: "explicit", release: async () => {} });
}

/**
 * ONE page, in BOTH probe orders, on ONE box.
 *
 * The two captures must share a machine: a difference between orders and a difference between machines
 * would otherwise be indistinguishable, which is the conflation this gate exists to detect arriving
 * through the scheduler rather than through the probes.
 */
async function comparePage(/** @type {any} */ page, /** @type {string} */ worker, /** @type {string} */ base) {
  // A corpus path is served from the leased page server; a real page is fetched from the live web and
  // needs no base. Named `url` vs `path` rather than inferred, so an absolute URL cannot be silently
  // concatenated onto localhost -- which is the failure that returns Edge's own error page and compares
  // identical under both orders.
  const url = page.url ?? `${base}/${page.path}.html`;
  // THREE CAPTURES: A1, B, A2. The gate used to take two, changing the probe order AND letting time pass,
  // so a difference could be either -- a textbook confound. On `tfl.gov.uk` the clock ticked 22:43 -> 22:47
  // and a disruption banner appeared between them, and the gate could not tell that from an ordering fault.
  //
  // The remedy for a confound is a CONTROL, and this repo already owns the instrument: `gate:stability`
  // repeats an identical capture to measure the noise floor. A1 vs A2 is that floor for THIS page, right
  // now. The control BRACKETS the treatment rather than following it, so it spans a longer window
  // (t=0->2 against t=0->1) and therefore slightly over-states drift -- conservative in the right
  // direction for a tool that asserts: it cannot invent an ordering fault, it may miss a marginal one.
  const a1 = await capture(worker, url, undefined);
  const b = await capture(worker, url, "focus-first");
  const a2 = await capture(worker, url, undefined);
  const failed = [a1, b, a2].find((/** @type {any} */ c) => c.error);
  // INCONCLUSIVE, never a pass. A page that could not be captured all three ways was not compared, and
  // "not compared" reading as "agrees" is the defect this whole plan is about, one layer out. THROWN so it
  // reduces the fleet's coverage, rather than returned as a result that looks judged.
  if (failed) throw new Error(failed.error);

  const treatment = compareCapture(/** @type {never} */ (a1.capture), /** @type {never} */ (b.capture));
  const control = compareCapture(/** @type {never} */ (a1.capture), /** @type {never} */ (a2.capture));
  const ordering = differencesNotExplainedBy(treatment, control);

  // The PERMUTED capture is the only one with a preceding probe, so it is the only one where the remedy
  // can have run. Reported beside the verdict rather than assumed.
  const remedied = establishedBrowseMode(b.capture);
  // The fingerprint's own statement that the page's SHAPE moved, which is a different claim from content
  // drifting -- and still worth separating, because it says the probes changed the page rather than time.
  const pageMoved = [a1, b, a2].some((/** @type {any} */ c) => pageChangedUnderProbes(c.capture));
  const verdict = ordering.length ? (pageMoved ? "PAGE-MOVED" : treatment.verdict) : "SAME";
  return { page: page.url ?? page.path, worker, verdict, changes: ordering,
    phrases: treatment.phrases, remedied, pageMoved,
    // Named so a reader can see the control did its job. A gate that silently subtracts is one nobody can
    // check, and "explained by time" is exactly the claim that needs to be auditable.
    explainedByTime: treatment.changes.length - ordering.length };
}

/**
 * What the TREATMENT shows and the CONTROL does not — the ordering effect, with time subtracted.
 *
 * Compared FIELD BY FIELD rather than as a whole: a page whose clock ticks changes `structure.formFields`
 * in both, so that field is explained; if the treatment ALSO moved `interaction.focusOrder` and the control
 * did not, that one is the ordering effect and must survive.
 *
 * Matched on the field NAME and not on the exact lost/gained phrases, deliberately. A clock reads 22:43,
 * 22:47 and 22:51 across three captures, so the phrases differ in every comparison while the field is the
 * same one drifting. Requiring identical phrases would explain away nothing and the control would be inert
 * -- which is the failure mode to watch for here, since an inert control looks exactly like a clean gate.
 */
export function differencesNotExplainedBy(/** @type {any} */ treatment, /** @type {any} */ control) {
  const drifting = new Set(control.changes.map((/** @type {any} */ c) => c.field));
  return treatment.changes.filter((/** @type {any} */ c) => !drifting.has(c.field));
}

/**
 * Which PAGE-MOVED results were expected, and which declarations have gone stale.
 *
 * A page that moves under its own probes cannot answer the ordering question — we know why its evidence
 * differs and still not whether order also mattered. Counting it as a pass is the defect this gate exists
 * to prevent, so it is excluded from coverage. But `nls.uk/join/` moves EVERY time (its search panel opens
 * when a control is activated), so leaving it undeclared kept coverage permanently short and the gate
 * permanently INCONCLUSIVE. A gate that cannot pass is one people stop dispatching.
 *
 * So a page may DECLARE it, and the declaration is checked in both directions:
 *
 *   undeclared + moved  reduces coverage, exactly as before — this is the case the rule was written for
 *   declared + moved    out of scope for the question, named and excluded
 *   declared + NOT moved  STALE: the reason has gone, and the page should be earning its keep again
 *
 * The third is what stops a declaration becoming a permanent excuse — the same rule the unclosable veto
 * map and `NOT_FOR_CASES` follow, both of which caught a stale entry on their first run.
 *
 * @param {Array<{page: string, verdict: string}>} judged
 * @param {Array<{url?: string, path?: string, movesUnderItsOwnProbes?: string}>} pages
 */
export function classifyMovers(judged, pages) {
  const declared = new Set(pages.filter((page) => page.movesUnderItsOwnProbes)
    .map((page) => page.url ?? page.path));
  const movedAll = judged.filter((r) => r.verdict === "PAGE-MOVED");
  return {
    undeclared: movedAll.filter((r) => !declared.has(r.page)),
    expected: movedAll.filter((r) => declared.has(r.page)),
    stale: judged.filter((r) => declared.has(r.page) && r.verdict !== "PAGE-MOVED"),
  };
}

/**
 * The fleet's verdict over the PAGES — the boxes are how the work was spread, not what was examined.
 *
 * Three separate things reduce COVERAGE rather than counting as failures, and each was learned the hard
 * way. A page that could not be captured in both orders was not compared. A page that MOVED under its own
 * probes has an unanswerable ordering question — we know why the evidence differs and still not whether
 * order also mattered; my first version counted those as examined and produced `PASS — all 5 of 5` on a
 * run where two pages gave two answers. And a pass where `establishBrowseMode` never ran is agreement by
 * luck, not evidence for the remedy — the shape that let an inert `refreshBrowseBuffer` collect three
 * green runs.
 */
function report_(/** @type {any[]} */ outcomes, /** @type {number} */ workerCount,
  /** @type {string} */ controlPlane) {
  const judged = outcomes.filter((o) => o.result).map((o) => o.result);
  report(judged);
  for (const o of outcomes.filter((x) => !x.result)) {
    process.stdout.write(`  INCONCLUSIVE ${o.item.url ?? o.item.path} on ${o.worker}: ${o.error}\n`);
  }

  const differing = judged.filter((r) => r.verdict === "CHANGED" || r.verdict === "DRIFT");
  const unexercised = judged.filter((/** @type {any} */ r) => r.remedied === false);
  const { undeclared: allUndeclared, expected: expectedMovers, stale: staleDeclarations } =
    classifyMovers(judged, PAGES);
  // A LIVE SITE THAT MOVED IS REPORTED, NOT COUNTED — and the reason is not leniency.
  //
  // The controlled corpus pages are the ones this gate can hold still. A live site cannot be: measured
  // 2026-08-31, `tfl.gov.uk` was SAME on one run and PAGE-MOVED on the next, and the difference names
  // itself — `structure.graphics: 25 -> 25 lost ["central, graphic"] gained ["now at 23:25"]`. That is a
  // CLOCK, not a probe effect, and the control cannot subtract it because the text differs between every
  // capture rather than between two of them.
  //
  // So requiring full coverage over live sites made this gate's verdict a coin flip, on top of the
  // permanently-short coverage the declaration above fixed. It still FAILS on a live site that reports
  // CHANGED — an ordering fault is an ordering fault wherever it is found, and `differing` is unchanged.
  // What it no longer does is call a run inconclusive because a public website ticked.
  const isLive = (/** @type {any} */ r) => String(r.page).startsWith("http");
  const moved = allUndeclared.filter((r) => !isLive(r));
  const liveMovers = allUndeclared.filter(isLive);
  if (liveMovers.length) {
    process.stdout.write(`\n${liveMovers.length} LIVE SITE(S) moved between captures, so the ordering `
      + "question is unanswerable for them this run. Reported, and not counted against coverage — a public "
      + "page can change under anyone. A live site reporting CHANGED still fails:\n");
    for (const r of liveMovers) process.stdout.write(`    ${r.page}\n`);
  }
  if (moved.length) {
    process.stdout.write(`\n${moved.length} page(s) CHANGED UNDER THEIR OWN PROBES and did not declare it `
      + "— see D7. A control the sweep activated altered what the next probe could see, so whether ORDER "
      + "also matters is unanswerable for them, and they are counted as unexamined rather than as passes.\n");
  }
  if (expectedMovers.length) {
    process.stdout.write(`\n${expectedMovers.length} page(s) moved under their own probes AS DECLARED, so `
      + "the ordering question is out of scope for them rather than unanswered. They are named here and "
      + "excluded from coverage:\n");
    for (const r of expectedMovers) process.stdout.write(`    ${r.page}\n`);
  }
  if (staleDeclarations.length) {
    process.stdout.write(`\n${staleDeclarations.length} page(s) are DECLARED to move under their own probes `
      + "and did not. The declaration has outlived its reason — delete it, and let the page count again:\n");
    for (const r of staleDeclarations) process.stdout.write(`    ${r.page}\n`);
  }
  if (unexercised.length) {
    process.stdout.write(`\n${unexercised.length} page(s) agreed WITHOUT the browse-mode remedy running. `
      + "That is agreement by luck, not evidence the state is restored, so it is not counted as examined.\n");
  }
  const verdict = fleetVerdict(
    outcomes.map((o) => ({
      // A judged-but-unexaminable page is `result: null` to the fleet verdict for the same reason an
      // errored one is: coverage counts what was ANSWERED, and these three cases have no answer.
      result: o.result && !moved.includes(o.result) && !unexercised.includes(o.result)
        && !expectedMovers.includes(o.result) && !liveMovers.includes(o.result) ? o.result : null,
      error: o.error,
    })),
    { of: PAGES.length - expectedMovers.length - liveMovers.length, what: `corpus pages and live sites, each captured ${CAPTURES_PER_PAGE}x (control, treatment, control)`,
      workers: workerCount, failed: differing.length, controlPlane });
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  process.exit(exitCodeFor(verdict));
}


// Refuses to run when imported. Every npm entry point here does this, and a test discovers the ones that
// do not: a module that captures on import turns `import()` — which is how the tests check a file loads at
// all — into a live run against the fleet.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
