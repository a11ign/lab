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
import { compareCapture } from "../src/capture/evidence-diff.ts";
import { probeStates } from "@a11ign/evidence/verify";
import { leasePageServer } from "../src/training/page-server.mjs";
import { renderVerdict, exitCodeFor } from "../src/gates/verdict.ts";
import { datasetRoot, refuseIfRunsReadonly, repeatCapturesRoot } from "../src/dataset-paths.ts";
import { fleetVerdict, renderShards } from "../src/gates/fleet.ts";
import { dispatchUnlessLocal, LOCAL_FLAG } from "../src/gates/dispatch.ts";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { holdingPages, runFleetClient, slugOf, stopExitWith } from "../src/fleet/harness-flow.ts";
import { reachableFromBoxes, whyNoCapture } from "../src/fleet/fleet-job.ts";
import type { FleetCase, FleetGroups } from "../src/fleet/fleet-job.ts";
import type { Collector } from "../src/fleet/capture-flow.ts";
import type { Loose } from "../src/capture/loose.ts";

// `--worker=` is named so that an address is dealt with in words (`fleet-job.ts`): ignored when `A11Y_FLEET_BOXES` is set, refused, naming the new form, when it is not.
refuseUnknownFlags(["--worker=", "--pages=", "--json", "--boxes=", "--label=", "--wait=", "--collect", LOCAL_FLAG],
  { entry: import.meta.url, command: "npm run gate:probe-order" });

/**
 * The three captures, in order: control-start, treatment, control-end.
 *
 * Named as data so the count is visible at the top of the file -- this gate costs 3 captures per page, not
 * 2, and that 50% is the price of separating an ordering effect from a page that simply changes.
 */
const CAPTURES_PER_PAGE = 3;

/** Pages whose evidence must not depend on probe order, each with what it exists to catch. */
export const PAGES = [
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

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

/** The body of each capture of a page. B changes ONLY the probe order, so any difference it shows is the order's. */
const BODY = { task: "Read the page and reach its controls.", probeFocus: true, probeForms: false, probeNavigation: false };

/** A1, B, A2: the control brackets the treatment, in the order they must run. Named as data so the order is visible at the top of the file. */
const ORDER = [
  { key: "a1", body: { ...BODY } },
  { key: "b", body: { ...BODY, probeOrder: "focus-first" } },
  { key: "a2", body: { ...BODY } },
] as const;

const groupOf = (page: Loose): string => slugOf(page.url ?? page.path);

/**
 * The cases of a set of pages: ONE GROUP of three per page, A1, B and A2 in that order, so the service holds all three to one box and sends them one after another.
 *
 * EVERY CAPTURE OF A PAGE STAYS ON ONE BOX. Splitting them would make a difference between orders indistinguishable from a difference between machines -- the exact conflation this gate
 * exists to detect, arriving through the scheduler instead of through the probes.
 */
export function probeOrderCases(pages: readonly Loose[], base: string): { cases: FleetCase[]; groups: FleetGroups } {
  const cases: FleetCase[] = [];
  const groups: FleetGroups = {};
  for (const page of pages) {
    // A corpus path is served from the leased page server; a real page is fetched from the live web and needs no base. Named `url` vs `path` rather than inferred, so an absolute URL cannot be
    // silently concatenated onto localhost -- which is the failure that returns Edge's own error page and compares identical under both orders.
    const url = page.url ?? `${base}/${page.path}.html`;
    const group = groupOf(page);
    for (const { key, body } of ORDER) cases.push({ id: `${group}.${key}`, url, body: { ...body }, group });
    groups[group] = {};
  }
  return { cases, groups };
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
function establishedBrowseMode(capture: Loose) {
  return (capture?.diagnostics ?? []).some((m: Loose) => m?.event === "establishBrowseMode");
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
function pageChangedUnderProbes(capture: Loose) {
  // `sameState === false` is the statement that the shape moved. `undefined` means fewer than two usable
  // fingerprints — nobody asked — and must NOT read as "the page held still", which is why this tests
  // for false rather than for falsiness.
  return probeStates(((capture ?? {}) as never))?.sameState === false;
}

async function main() {
  // THE CONTROL PLANE IS THE DEFAULT; this returns only under `--local`. See gates/dispatch.mjs.
  const controlPlane = (await dispatchUnlessLocal({ job: "gate-probe-order", argv: process.argv.slice(2) })).controlPlane;
  // The pending file is written under `runs/`: `A11Y_RUNS_READONLY=1` asks "would this have touched it" without letting it.
  refuseIfRunsReadonly(repeatCapturesRoot());
  const exit = await runFleetClient({
    argv: process.argv.slice(2), root: resolve(repeatCapturesRoot(), "probe-order"), kind: "gate-probe-order",
    hint: (job) => `npm run gate:probe-order -- ${LOCAL_FLAG} --collect=${job}`,
    // Exit 1 means "the evidence depends on probe order" here, so a job that failed, was cancelled or could not be reached is INCONCLUSIVE (2). The run's own 75 and 124 are kept.
    stopExit: stopExitWith(2),
    prepare: async () => {
      // LEASED, NOT ASSUMED, and this is not housekeeping -- it is the difference between a gate and a false pass. Edge serves its OWN error page when the port is dead, so two probe orders against
      // nothing would compare IDENTICAL and this would report PASS. That exact failure is on record here: a run whose page server was stopped underneath it read a dead port for 46 captures and
      // every one "succeeded". `probePath` names a page that must actually be served, so "serving" means serving THIS dataset rather than merely holding the port. Released when the run ends.
      const pages = await leasePageServer({ root: resolve(datasetRoot(), "pages"), port: 5050, probePath: `${PAGES[0].path}.html` });
      return holdingPages(pages, () => {
        // The BOXES fetch these pages and a box's localhost is not ours: a localhost URL is made the address the boxes reach this host on. Reused rather than re-derived, because deriving it
        // independently is how "every capture fetched the GUEST's localhost" happened once already.
        const base = arg("--pages") ?? reachableFromBoxes(pages.url);
        process.stdout.write(`${PAGES.length} pages x ${CAPTURES_PER_PAGE} captures, one group each (a box holds all three of a page)\n`);
        return { ...probeOrderCases(PAGES, base), extra: { round: 1, base, settled: {} } };
      });
    },
    collect: probeOrderCollector(controlPlane),
  });
  process.exit(exit);
}

/** What each page came to: the box that took it, and either its judged result or why it has none. */
type PageOutcome = { worker: string; result: Loose | null; error: string | null };

/** How many times a page is submitted: the first, and one more, whole, in a new job. A second failure is INCONCLUSIVE. */
const PAGE_ROUNDS = 2;

/** What the job took of ONE page: its three captures by key, or why they are not all there. A network fault is not an ordering fault: the page becomes INCONCLUSIVE and the others keep their verdicts. */
function takenOf(group: string, fetched: Parameters<Collector>[0]): { worker: string; taken: Record<string, Loose>; error: string | null } | null {
  const entries = fetched.manifest.captures.filter((c) => c.group === group);
  if (!entries.length) return null;
  const taken: Record<string, Loose> = {};
  let error: string | null = null;
  for (const { key } of ORDER) {
    const entry = entries.find((c) => c.case === `${group}.${key}`);
    const record = entry ? fetched.record(entry) : null;
    const body = record?.capture as Loose | undefined;
    if (entry?.status === "done" && body && !body.error) taken[key] = body;
    else error ??= entry ? whyNoCapture(entry, record) : `no capture of ${key} came back`;
  }
  return { worker: entries[0]?.box ?? "(no box took it)", taken, error };
}

/**
 * The collector. It judges each page from its three captures, and a page whose captures failed is submitted again, WHOLE, in one new job -- once.
 *
 * This replaces "moved to another worker until every worker has failed", which the service cannot express: it never names a box it was not asked for, and a re-capture is pinned to the box its
 * group was taken on. One retry keeps it bounded, and a second failure is INCONCLUSIVE (exit 2): "could not capture it" is never "agrees".
 */
/** `controlPlane` is where the run was driven from, kept in the verdict's provenance. */
export function probeOrderCollector(controlPlane = ""): Collector {
  return async (fetched, pending) => {
    const extra = pending.extra as { round: number; base: string; settled: Record<string, PageOutcome> };
    const outcomes: Record<string, PageOutcome> = { ...extra.settled };
    const retry: Loose[] = [];
    for (const page of PAGES) {
      const group = groupOf(page);
      const found = takenOf(group, fetched);
      if (!found) continue;
      const { worker, taken, error } = found;
      if (error === null) outcomes[group] = { worker, result: judgePage(page, worker, taken), error: null };
      else if (extra.round < PAGE_ROUNDS) retry.push(page);
      else outcomes[group] = { worker, result: null, error };
    }
    if (retry.length) {
      process.stdout.write(`${retry.length} page(s) could not be captured all three ways; submitting ${retry.length === 1 ? "it" : "them"} again, whole, once: ${retry.map(groupOf).join(", ")}\n`);
      return { recapture: [], resubmit: { ...probeOrderCases(retry, extra.base), names: {}, extra: { round: extra.round + 1, base: extra.base, settled: outcomes } }, exit: 0 };
    }
    return { recapture: [], exit: reportOutcomes(controlPlane, PAGES.map((page) => ({
      item: page, ...(outcomes[groupOf(page)] ?? { worker: "(no box took it)", result: null, error: "the job holds no capture of this page" }),
    }))) };
  };
}

/** Presentation only — extracted because the comparison and the rendering are different jobs. */
function report(results: Loose[]) {
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

/**
 * ONE page, judged from its three captures: A1, B and A2, which the service took on ONE box.
 *
 * The three must share a machine: a difference between orders and a difference between machines would otherwise be indistinguishable, which is the conflation this gate exists to detect
 * arriving through the scheduler rather than through the probes.
 */
export function judgePage(page: Loose, worker: string, taken: Record<string, Loose>) {
  const { a1, b, a2 } = { a1: { capture: taken.a1 }, b: { capture: taken.b }, a2: { capture: taken.a2 } };
  // THREE CAPTURES: A1, B, A2. The gate used to take two, changing the probe order AND letting time pass,
  // so a difference could be either -- a textbook confound. On `tfl.gov.uk` the clock ticked 22:43 -> 22:47
  // and a disruption banner appeared between them, and the gate could not tell that from an ordering fault.
  //
  // The remedy for a confound is a CONTROL, and this repo already owns the instrument: `gate:stability`
  // repeats an identical capture to measure the noise floor. A1 vs A2 is that floor for THIS page, right
  // now. The control BRACKETS the treatment rather than following it, so it spans a longer window
  // (t=0->2 against t=0->1) and therefore slightly over-states drift -- conservative in the right
  // direction for a tool that asserts: it cannot invent an ordering fault, it may miss a marginal one.
  const treatment = compareCapture((a1.capture as never), (b.capture as never));
  const control = compareCapture((a1.capture as never), (a2.capture as never));
  const ordering = differencesNotExplainedBy(treatment, control);

  // The PERMUTED capture is the only one with a preceding probe, so it is the only one where the remedy
  // can have run. Reported beside the verdict rather than assumed.
  const remedied = establishedBrowseMode(b.capture);
  // The fingerprint's own statement that the page's SHAPE moved, which is a different claim from content
  // drifting -- and still worth separating, because it says the probes changed the page rather than time.
  const pageMoved = [a1, b, a2].some((c: Loose) => pageChangedUnderProbes(c.capture));
  // DIFFERENT_DOCUMENT FIRST, and it is not defensive tidying. `compareCapture` returns no `changes` for
  // it (#687), so `ordering` is empty and this would otherwise fall to "SAME" -- a gate reporting that two
  // captures of DIFFERENT PAGES agreed about probe ordering, which is the exact "clean report over an
  // unexamined tree" shape this file's own control was built to avoid one layer up.
  const servedDifferently = [treatment, control].find((c) => c.verdict === "DIFFERENT_DOCUMENT");
  const verdict = servedDifferently ? "DIFFERENT-DOCUMENT"
    : ordering.length ? (pageMoved ? "PAGE-MOVED" : treatment.verdict) : "SAME";
  return { page: page.url ?? page.path, worker, verdict, changes: ordering,
    phrases: treatment.phrases, remedied, pageMoved,
    // WHICH documents, when they differed. A verdict naming no page is one nobody can act on.
    servedDifferently: servedDifferently?.identity.differing ?? null,
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
export function differencesNotExplainedBy(treatment: Loose, control: Loose) {
  const drifting = new Set(control.changes.map((c: Loose) => c.field));
  return treatment.changes.filter((c: Loose) => !drifting.has(c.field));
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
export function classifyMovers(judged: Array<{ page: string; verdict: string; }>, pages: Array<{ url?: string; path?: string; movesUnderItsOwnProbes?: string; }>) {
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
function reportOutcomes(controlPlane: string, outcomes: Loose[]): number {
  process.stdout.write(`\nWHERE THE WORK LANDED\n${renderShards(outcomes)}\n`);
  const workerCount = new Set(outcomes.map((o) => o.worker)).size;
  const judged = outcomes.filter((o) => o.result).map((o) => o.result);
  report(judged);
  for (const o of outcomes.filter((x) => !x.result)) {
    process.stdout.write(`  INCONCLUSIVE ${o.item.url ?? o.item.path} on ${o.worker}: ${o.error}\n`);
  }

  const differing = judged.filter((r) => r.verdict === "CHANGED" || r.verdict === "DRIFT");
  // UNEXAMINED, not failed, and not a pass either (#687). Three captures of DIFFERENT DOCUMENTS cannot
  // answer whether ORDER mattered -- the same reasoning this file already applies to a page that moved
  // under its own probes. Left out of `differing`, it would have counted as an examined PASS.
  const servedDifferently = judged.filter((r: Loose) => r.verdict === "DIFFERENT-DOCUMENT");
  const unexercised = judged.filter((r: Loose) => r.remedied === false);
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
  const isLive = (r: Loose) => String(r.page).startsWith("http");
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
  if (servedDifferently.length) {
    process.stdout.write(`\n${servedDifferently.length} page(s) were SERVED A DIFFERENT DOCUMENT between `
      + "captures, so the ordering question is unanswerable for them — the three captures are not of one "
      + "page. Counted as unexamined rather than as passes:\n");
    for (const r of servedDifferently) {
      process.stdout.write(`    ${r.page}: ${(r.servedDifferently ?? [])
        .map((d: Loose) => `${d.component} ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`)
        .join("; ")}\n`);
    }
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
        && !expectedMovers.includes(o.result) && !liveMovers.includes(o.result)
        && !servedDifferently.includes(o.result) ? o.result : null,
      error: o.error,
    })),
    { of: PAGES.length - expectedMovers.length - liveMovers.length, what: `corpus pages and live sites, each captured ${CAPTURES_PER_PAGE}x (control, treatment, control)`,
      workers: workerCount, failed: differing.length, controlPlane });
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  return exitCodeFor(verdict);
}


// Refuses to run when imported. Every npm entry point here does this, and a test discovers the ones that
// do not: a module that captures on import turns `import()` — which is how the tests check a file loads at
// all — into a live run against the fleet.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
