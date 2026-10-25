// @ts-check
// Refuse to start a corpus run if the pipeline does not produce the same evidence twice.
//
//   pnpm run gate:stability                       # before any recapture
//   pnpm run gate:stability -- --times=6
//
// ## Why this is a gate and not a tool
//
// The corpus carried a non-deterministic artefact for weeks and nothing caught it. Edge's autofill
// drew a suggestion icon inside recognised inputs, NVDA announced it as an embedded object appended to
// the field, and because `probeForms` submits forms the profile learned more as a run progressed --
// so the rate climbed from 3% to 31% and 26 good/bad pairs ended up disagreeing about it.
//
// Every existing check stayed green throughout, because they count. The counts never moved: one form
// field before, one form field after. Only comparing CONTENT across repeated captures of the same
// unchanged page could have seen it, and that was an ad-hoc tool nobody was required to run.
//
// ## Why these pages
//
// A canary that cannot express the fault is worthless, and choosing one that could not is a mistake
// made three times in a single day here -- each time producing a clean result that was read as
// confirmation. Every page below is present because of a specific mechanism it can exercise, and that
// reason is recorded next to it. Add pages the same way.
//
// This shares `training:repeat`'s comparison (`src/training/repeat-analysis.ts`) rather than reimplementing it, which is the same
// point in miniature: the tool already existed and hand-rolled substitutes were worse.
//
// ## How it captures (A11-263)
//
// It SUBMITS one fleet job with a GROUP per canary: the canary's `--times` repeats are cases of the same page and body, and the service holds a
// group to one box and captures it in order, so a canary's repeats are never split across machines (that would answer "are the boxes
// interchangeable?" while looking like an answer to this question) and the canaries spread across the boxes the job booked. It records the job ID,
// waits once if it was told to (`--wait=`, `A11Y_FLEET_WAIT`), and reads the captures from the manifest; with no wait it prints the ID and exits 75.
// A transient failure is captured again on the same box (`fleet job recapture`), as `training:repeat` always did.
//
//   pnpm run gate:stability -- --local --label=<ticket key> --wait=2h      # submit, wait once, judge
//   pnpm run gate:stability -- --local --collect[=<job ID>]                # judge a job that has finished
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { leasePageServer } from "../src/training/page-server.mjs";
import { renderVerdict, exitCodeFor, crashVerdict } from "../src/gates/verdict.ts";
import { fleetVerdict, renderShards } from "../src/gates/fleet.ts";
import { dispatchUnlessLocal, LOCAL_FLAG } from "../src/gates/dispatch.ts";
import { varianceLines, canaryOutDir, unstableDetail } from "../src/gates/stability-canary.ts";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { datasetRoot, refuseIfRunsReadonly, repeatCapturesRoot } from "../src/dataset-paths.ts";
import { holdingPages, runFleetClient, slugOf, stopExitWith } from "../src/fleet/harness-flow.ts";
import { reachableFromBoxes } from "../src/fleet/fleet-job.ts";
import { analyseRepeats } from "../src/training/repeat-analysis.ts";
import { TRANSPORT_NOT_REPORTED } from "../src/training/repeat-analysis.ts";
import { clearRepeatSet, repeatBody, repeatCollector, repeatJob } from "../src/training/repeat-fleet.ts";
import type { RepeatSet, RepeatTarget } from "../src/training/repeat-fleet.ts";
import type { Loose } from "../src/capture/loose.ts";

/**
 * the canaries that must pass before a corpus run. `--probe-forms`, `--task` and `--url` are the canaries' own fields, not flags of this gate.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success. `--worker=` is named so that an address is dealt with in words
 * (`fleet-job.ts`): it is ignored when `A11Y_FLEET_BOXES` is set and refused, naming the new form, when it is not.
 */
refuseUnknownFlags(["--base=", "--times=", "--worker=", "--boxes=", "--label=", "--wait=", "--collect", LOCAL_FLAG], { entry: import.meta.url, command: "pnpm run gate:stability" });

const arg = (name: Loose, fallback: Loose) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const TIMES = Number(arg("times", "5"));

// One id per gate RUN, so two runs dispatched at once (as #3132's rounds were) cannot share a capture directory.
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;

/**
 * This gate LEASES what it needs, rather than requiring you to have set it up.
 *
 * It could not run at all before: the canary URLs pointed at a page server nobody started -- so all five canaries reported "harness did not start" and the gate exited 2. A gate that a corpus
 * run is forbidden to start without, and that cannot start itself, is a gate that gets skipped; `release:gate` was broken from the day it was written for the same reason, and
 * `capture:check` went unrun for months because it "cost a ceremony". This project's own rule: automate a check or lose it.
 *
 * The lease puts things back as it found them -- a page server somebody else is serving is left alone.
 */
const DATASET_ROOT = datasetRoot();
const PAGES_PORT = Number(process.env.DATASET_PAGES_PORT || 5050);

/**
 * Canaries, each with the mechanism it exists to catch.
 *
 * `reason` is not documentation. It is the thing to check before trusting a PASS: if a page cannot
 * express the fault you care about, its stability tells you nothing about that fault.
 */
export const CANARIES = [
  {
    path: "form-unlabelled/good",
    reason: "auto-focuses its input, which is what surfaces Edge's autofill affordance — the exact " +
      "page that still produced U+FFFC after a fix verified on a page that does not auto-focus",
  },
  {
    path: "form-error-silent/bad",
    reason: "submits a form, which is how the profile LEARNS the values that later become suggestions",
  },
  // THE SAME CASE, ACTUALLY SUBMITTING — added 2026-09-06, and the pair is the point.
  //
  // The canary above has no `task` and no `probeForms`, so nothing is activated and `postSubmitNames` is
  // EMPTY on all five repeats. Comparing an empty field five times and reporting it stable is the trap
  // this file's own header names, and it is why `form-error-silent` could be a canary while the channel it
  // is named for went unwatched.
  //
  // WHAT THIS IS FOR, measured 2026-09-06 and unexplained: two consecutive `evidence:check` runs disagreed
  // about whether long post-submit announcements are FRAGMENTED. Run 1 had `form-error-silent` joined
  // (63->59) and `icon-button-unnamed` unchanged; run 2, one commit later, had `form-error-silent` back to
  // split and `icon-button-unnamed` joined (53->49) — the same shape moving between cases:
  //
  //     split   "...retained for records and reviewed each"  +  "year by the site team."
  //     joined  "...retained for records and reviewed each year by the site team."
  //
  // Either the fragmentation is intermittent, or a change between those runs caused it. One run each way
  // cannot tell them apart, and `postSubmitFields`/`postSubmitNames` is the evidence 3.3.1 and 4.1.3 are
  // decided from — so a recapture would bake whichever way each case landed into the corpus that ships.
  // Content comparison across five repeats is the only thing that can answer it, which is this gate's
  // whole reason for existing: the corpus once carried a nondeterministic artefact for weeks with every
  // count-based check green, because the counts never moved.
  {
    path: "form-error-silent/good",
    task: "Submit the request without entering a reference number and understand what needs fixing.",
    probeForms: true,
    reason: "the ONLY canary whose post-submit read produces the long announcements that were seen "
      + "fragmenting; `--task` is mandatory here, since `--probe-forms` alone activates nothing and would "
      + "compare an empty `postSubmitNames` five times over",
  },
  {
    path: "table-unassociated-headers/bad",
    reason: "the table walk returned 4, 2, 4, 4, 1, 4, 4 cells across 18 captures once; tables are " +
      "the other field with a history of non-determinism",
  },
  {
    path: "disclosure-state-silent/good",
    reason: "state changes depend on an interaction landing, which is timing-sensitive in a way a " +
      "static read is not",
  },
  {
    path: "image-missing-alt/good",
    reason: "the simplest page there is — if this one varies, the fault is in the pipeline rather " +
      "than in anything the page does",
  },
  {
    // The page that proved this gate had a blind spot. An intermittent late document announcement was
    // credited to the activation here — `after: "Energy results, document"` on a page whose entire
    // finding is that activating the filter announces NOTHING — and it reached the corpus while every
    // canary reported stable, because no canary drove a task-button probe and `formChanges` was not even
    // among the compared fields.
    path: "filter-status-silent-solar/bad",
    task: "Show solar tours and notice the result count.",
    probeForms: true,
    reason: "the only canary that activates a control and measures what the page says back; the " +
      "interaction criteria (3.3.1, 4.1.3) are unreachable without it, and a contaminant lived here",
  },
  {
    // determinism-plan D5. Every canary above is a single-state page, and this gate exists to prove the
    // tool is deterministic — so until 2026-08-28 it could not observe the non-determinism that actually
    // cost this project four withdrawn 2.1.2 rules and a 2.1.1 false positive. That is this gate's own rule
    // pointed at itself: "a canary that cannot express the fault is worthless".
    //
    // A CONFORMANT page behind a focus-confining consent banner. The sweep walks the page behind it while
    // Tab is held in a ring of link-and-buttons, which is the state disagreement everything else missed;
    // `probeFocus` is what makes the two channels both present, and without it this is just another static
    // page.
    path: "image-missing-alt-behind-consent/good",
    probeFocus: true,
    reason: "the only canary whose page has TWO STATES — an overlay confining Tab while the sweep walks " +
      "behind it. `gate:probe-order` measured headings 5->0, links 6->1 and graphics 1->0 on this page " +
      "when the probes were permuted; nothing in this list could have seen that",
  },
  {
    // REPLACES the National Library of Scotland's join page (nls.uk, #3905), which was the plan's own
    // success measure:
    //
    //     nls.uk join    one run: 7 distinct stops of 7 tabbable, SILENT
    //                    another run, same commit: ACCUSED
    //
    // That page cannot be a canary, because it is first-visit-only BY CONSTRUCTION: it loads Civic Cookie
    // Control through Google Tag Manager with `initialState: notify, notifyOnce: true`, so the consent panel
    // opens on a profile's FIRST visit and never again. On a cold profile capture 1 was a different page
    // from captures 2-5 (no "English" in the transcript, 24 events, first focus event "Close Cookie Control")
    // and the gate read UNSTABLE for a reason that is the page's, not the pipeline's. The gate is NOT taught
    // to throw that first capture away (ceo, #3130): the first visit IS a reader's visit, and the panel is the
    // first thing a screen-reader user meets. That difference is recorded in docs/known-gaps.md instead.
    //
    // THIS ONE IS CHOSEN FOR HAVING NO FIRST-VISIT-ONLY STATE. Read 2026-10-07 off the page's own served
    // files: the HTML and its six scripts (examples.js, app.js, disclosureMenu.js, skipto.js,
    // details4everybody.js, svg4everybody.js) contain no `localStorage`, `sessionStorage`, `document.cookie`
    // or `indexedDB`, and no consent, banner or onboarding markup. The only cookie the server sets is
    // Cloudflare's `__cf_bm`, HttpOnly and never read by the page, so it cannot change what a reader meets.
    //
    // It is a LIVE page, as the old entry was: the determinism plan's headline claim is a real site repeating
    // identically, and the other canaries are localhost fixtures. Its disclosure menus are what `probeFocus`
    // exists for (the sweep opens panels and the focus walk then sees a different page, the mechanism that made
    // nls.uk move). It does NOT reproduce nls.uk's consent state, which is the point of replacing it.
    //
    // A live site can also change on its own, and that would read as instability. The repeats run back to
    // back, and `repeat-capture` reports WHICH FIELD varies — a page edit moves content, our fault empties
    // a channel. A confounder to read for, not a reason to test only pages that cannot surprise us.
    url: "https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/",
    probeFocus: true,
    reason: "the live page with no first-visit-only state (no consent panel, banner or onboarding; no " +
      "client storage in any script it serves) that replaced the nls.uk join page, whose Civic `notifyOnce` panel " +
      "made a cold profile's first capture a different page; its disclosure menus are what `probeFocus` " +
      "exercises, and a real site repeating identically is the determinism plan's headline claim",
  },
];

/**
 * EVERY CANARY NAMES EXACTLY ONE SOURCE, checked at load rather than trusted.
 *
 * A canary carrying `url` while `judgeCanary` destructured only `path` produced `=== undefined (5x) ===`
 * and reported STABLE: the URL became `<base>/undefined`, Edge served its own error page, and an error page
 * repeats identically five times. On a gate whose entire question is "does this repeat identically", that is
 * the worst possible false pass.
 *
 * The comment describing that exact trap was already in this file, above code that did not implement it --
 * an edit that failed halfway and was not noticed. So this is an assertion rather than a note: a canary with
 * neither field, or with both, stops the gate before it captures anything.
 */
for (const canary of CANARIES) {
  const named = [canary.path, canary.url].filter(Boolean).length;
  if (named !== 1) {
    throw new Error(`canary ${JSON.stringify(canary.reason?.slice(0, 40) ?? "?")} must name exactly one of `
      + `\`path\` (served from the corpus) or \`url\` (a live page); it names ${named}`);
  }
}

const nameOf = (canary: Loose): string => canary.url ?? canary.path;

/** The group a canary is: its name, as a service case's ID can spell it. */
const groupOf = (canary: Loose): string => slugOf(nameOf(canary));

/**
 * One canary, judged from the repeats the job took.
 *
 * Extracted so each canary's verdict is a function of the captures it was given and what the report says, with nothing leased or sent.
 */
function judgeCanary(canary: Loose, set: RepeatSet, report: ReturnType<typeof analyseRepeats>): Loose {
  const name = nameOf(canary);
  const outDir = set.target.outDir;
  process.stdout.write(`\n=== ${name} (${set.target.times}x) ===\n    why: ${canary.reason}\n`);
  // Too few usable captures is not a PASS. A gate that passes when it could not measure is worse than no gate, because it launders "unknown" into "fine".
  if (report.tooFew) {
    const detail = `only ${report.usable} usable capture(s) — could not judge`;
    process.stdout.write(`  INCONCLUSIVE — ${detail}\n${report.stderr}`);
    return { path: name, ok: false, unstable: false, detail };
  }
  const varies = varianceLines(report.stdout);
  if (report.exit === 0) {
    process.stdout.write(`  STABLE — ${report.usable} usable, all fields identical\n`);
    return { path: name, ok: true, detail: `${report.usable} usable, all fields identical` };
  }
  return interpretFailure(report, name, outDir, varies);
}

/**
 * What a non-zero exit from the analysis actually MEANS.
 *
 * Three different outcomes come back the same way -- a field varies, a capture errored, a capture heard nothing -- and only the first is evidence that the pipeline is nondeterministic.
 * Collapsing them into one failure once made a transient capture error read exactly like genuine instability and cost a re-run to discover the page was fine.
 */
function interpretFailure(report: ReturnType<typeof analyseRepeats>, path: string, outDir: string, varies: string[]): Loose {
  const out = report.stdout;
  const empty = /(\d+) capture\(s\) heard nothing/.exec(out)?.[1];
  const failedRuns = out.split("\n").filter((l) => l.trim().startsWith("FAILED")).map((l) => l.trim());
  const detail = varies.length ? `UNSTABLE: ${unstableDetail({ lines: varies, outDir })}`
    : empty ? `${empty} empty capture(s) — the foreground flake, not instability`
    : failedRuns.length ? `${failedRuns.length} capture(s) errored: ${failedRuns[0]}`
    : "a capture was rejected or served another document";
  if (varies.length) process.stdout.write(`${varies.map((v) => `  ${v}\n`).join("")}  captures kept in ${outDir}\n`);
  // Only a VARIES is evidence of nondeterminism. An errored or empty capture is a flake in the run, so it is reported and retried rather than treated as a verdict.
  process.stdout.write(`  ${varies.length ? "UNSTABLE" : "INCONCLUSIVE"} — ${detail}\n`);
  return { path, ok: false, unstable: varies.length > 0, detail };
}

/** The canary, as a repeat target: its group, where its captures are kept, and the body it asks the worker for. */
function targetOf(canary: Loose, base: string): RepeatTarget {
  const name = nameOf(canary);
  // A corpus canary is served from the leased page server; a REAL page is fetched from the live web and takes no base. Explicit fields, never sniffed from the string.
  const url = canary.url ?? `${base}/${canary.path}`;
  return {
    group: groupOf(canary), url, times: TIMES,
    // Its OWN directory, per canary and per run: the shared one was overwritten by the next canary, so the captures of a failed run were gone before anyone could read why it failed (#3273).
    outDir: canaryOutDir({ root: repeatCapturesRoot(), runId: RUN_ID, name }),
    body: repeatBody({ probeForms: canary.probeForms, task: canary.task, probeFocus: canary.probeFocus }),
  };
}

/** The job this gate submits: ONE group per canary, `TIMES` repeats of the same page and body in each. */
export function stabilityJob(base: string, canaries: readonly Loose[] = CANARIES): ReturnType<typeof repeatJob> {
  return repeatJob(canaries.map((canary) => targetOf(canary, base)));
}

/**
 * The gate. Everything with an effect lives in here, and NOTHING is leased at module scope.
 *
 * That distinction is not stylistic, and it is the reason this function exists. A lease at module scope meant merely IMPORTING this file leased something -- and `node -e "import('./stability-gate.ts')"`
 * is CLAUDE.md's only real check that an .mjs file still loads, so the file most expensive to import was the one the rules said to import.
 */
async function main() {
  // THE CONTROL PLANE IS THE DEFAULT. This returns only when `--local` was asked for; otherwise it
  // dispatches to the lab and exits with that job's status. See gates/dispatch.mjs for why a gate in
  // particular must not be able to produce an unattributable verdict.
  const controlPlane = (await dispatchUnlessLocal({ job: "gate-stability", argv: process.argv.slice(2) })).controlPlane;
  // The captures and the pending file are written under `runs/`: `A11Y_RUNS_READONLY=1` asks "would this have touched it" without letting it.
  refuseIfRunsReadonly(repeatCapturesRoot());
  const exit = await runFleetClient({
    argv: process.argv.slice(2), root: repeatCapturesRoot(), kind: "stability-gate",
    hint: (job) => `pnpm run gate:stability -- ${LOCAL_FLAG} --collect=${job}`,
    // A job that failed, was cancelled or could not be reached is NOT a canary found unstable: exit 1 means "a canary was UNSTABLE" here, so those are INCONCLUSIVE (2).
    // The run's own 75 (submitted, not waited on) and 124 (the wait ran out, the job goes on) are not verdicts either and are kept.
    stopExit: stopExitWith(2),
    prepare: async () => {
      // Leased before the job is submitted and released when the run ends, so a gate that throws half way through still leaves the host as it found it. ONE page server serves every box -- the
      // lease is refcounted, and five boxes fetching the same corpus is exactly what it is for.
      const pages = await leasePageServer({ root: resolve(DATASET_ROOT, "pages"), port: PAGES_PORT, probePath: `${CANARIES.find((c) => c.path)?.path ?? CANARIES[0].path}.html` });
      return holdingPages(pages, () => {
        // The BOXES fetch these pages and a box's localhost is not ours: a localhost URL is made the address the boxes reach this host on. Skipping it is how every capture came to fetch the
        // guest's own localhost, showing Edge "localhost refused to connect" and burning three attempts per page.
        const base = arg("base", reachableFromBoxes(pages.url));
        const job = stabilityJob(base);
        for (const target of job.extra.targets) clearRepeatSet(target);
        process.stdout.write(`pages ${base} · ${CANARIES.length} canaries x ${TIMES} captures, one group each\n`);
        return job;
      });
    },
    collect: repeatCollector((sets) => reportSets(sets, controlPlane), { log: (line) => process.stdout.write(`${line}\n`) }),
  });
  process.exit(exit);
}

/** Judge every canary from the repeats the job took, and say what the fleet's verdict is. */
/** `controlPlane` is where the run was driven from, kept in the verdict's provenance. */
export function reportSets(sets: RepeatSet[], controlPlane = ""): number {
  const byGroup = new Map(CANARIES.map((canary) => [groupOf(canary), canary]));
  const outcomes = sets.map((set) => {
    const canary = byGroup.get(set.target.group);
    if (!canary) throw new Error(`the job holds a group ${set.target.group} that is no canary of this gate: it was submitted by another version of it`);
    const report = analyseRepeats({ raw: set.raw, errors: set.errors, times: set.target.times, reuse: false, outDir: set.target.outDir });
    const result = judgeCanary(canary, set, report);
    // UNJUDGEABLE IS A NULL RESULT, so it reduces coverage rather than counting as a clean page. "Two captures errored" and "the page was stable" must never reach the verdict as the same thing.
    const unjudgeable = !result.ok && !result.unstable;
    return { item: canary, worker: set.box ?? "(no box took it)", result: unjudgeable ? null : result, error: unjudgeable ? String(result.detail) : null };
  });
  process.stdout.write(`\nWHERE THE WORK LANDED\n${renderShards(outcomes)}\n`);
  return reportFleet(outcomes, { workerCount: new Set(outcomes.map((o) => o.worker)).size, times: sets[0]?.target.times ?? TIMES, controlPlane });
}

/**
 * The fleet's verdict over the CANARIES.
 *
 * The boxes are how the work was spread, not what was examined, so the denominator stays the canary list
 * exactly as it was when this ran on one machine. An unstable canary is a FAILURE; one that could not be
 * judged reduces COVERAGE -- "we could not measure" and "it varied" need opposite responses, and a gate
 * that passes when it could not measure launders unknown into fine.
 */
function reportFleet(outcomes: Loose[], { workerCount, times, controlPlane }: { workerCount: number; times: number; controlPlane: string }): number {
  const judged = outcomes.filter((o) => o.result);
  const unstable = judged.filter((o) => o.result.unstable);
  const unjudgeable = outcomes.filter((o) => !o.result);

  for (const o of unstable) process.stdout.write(`  UNSTABLE ${o.item.path ?? o.item.url} on ${o.worker}: ${o.result.detail}\n`);
  for (const o of unjudgeable) process.stdout.write(`  UNJUDGEABLE ${o.item.path ?? o.item.url} on ${o.worker}: ${o.error}\n`);
  // SURFACED, not swallowed, and ABSENCE IS NOT ZERO. The transport counts used to be read off each capture's report and printed only when above zero, so a run where the line stopped being
  // printed was indistinguishable from a clean one. The service owns the transport now and its records carry neither number, so the gate says so once.
  process.stdout.write(`\n"${TRANSPORT_NOT_REPORTED.map((line) => line.split(":")[0]).join('" and "')}" were NOT REPORTED for these captures — the metric is missing, which is not the same as zero\n`);

  if (unjudgeable.length) {
    process.stdout.write(`\n${unjudgeable.length} canary(s) could not be judged — errored or too few `
      + "usable captures. If the same one keeps failing, that is a worker problem rather than a "
      + "determinism one, and the box is named above.\n");
  }
  if (unstable.length) {
    process.stdout.write("\nDo NOT start a corpus run. Evidence that varies for the same unchanged page "
      + "is indistinguishable from evidence that differs because the page differs, which is the one defect "
      + "this project cannot tolerate.\n");
  }
  const verdict = fleetVerdict(outcomes, {
    of: CANARIES.length,
    what: `${CANARIES.length} canaries x ${times} captures compared by CONTENT`,
    workers: workerCount,
    failed: unstable.length,
    controlPlane,
  });
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  return exitCodeFor(verdict);
}

/**
 * A throw out of `main` is a crash of the HARNESS, not a reading of a canary, and Node would exit 1 for it -- the code that
 * means "a canary was found UNSTABLE" (a11ign/a11ign#3977). The error is printed in full first: the code says THAT no verdict
 * was read, the stack says why.
 */
function exitOnCrash(error: unknown) {
  console.error(error);
  const verdict = crashVerdict("gate:stability", error);
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  process.exit(exitCodeFor(verdict));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main().catch(exitOnCrash);
