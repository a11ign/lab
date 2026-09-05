// @ts-check
/**
 * WHAT ACTUALLY HAPPENED ON THIS PAGE — in sentences, from evidence the capture already recorded.
 *
 * A capture carries about thirty diagnostic marks. `landedOnRequested` says whether the browser showed the
 * page you asked for. `pageServed` says whether anything served it. `structureCrossCheck` compares what
 * the screen reader swept against what the accessibility tree exposes. `readThrough.stopReason` says
 * whether the read finished or ran out of budget. `pageState` says whether the page moved between probes.
 *
 * NOTHING READ ANY OF THEM. Every question about a capture was answered by ssh-ing to the lab, writing
 * Python by hand, globbing for a file and guessing its shape — and on 2026-08-29 that produced FOUR wrong
 * answers in one session, each of which looked like a real number:
 *
 *   read the WRAPPER instead of `capture`      -> "0 stops, 0 form fields" for a page with 20 and 14
 *   probed a box a gate was using              -> twelve 429s read as sub-second capture times
 *   timed an idle-after-response connection    -> `keepAliveTimeout` reported as a NAT reap
 *   scanned with `git ls-files`                -> a new file omitted, so the check examined nothing
 *
 * Three were caught only because the number looked odd afterwards. That is not a process.
 *
 * ## The rule this output follows
 *
 * ABSENT IS NEVER "FINE". A mark that was not recorded prints as NOT RECORDED, never as OK. This project's
 * most expensive defects are all one shape — `census.heading` absent read as zero, `sameState: undefined`
 * read as false, a recovery metric read with `?? 0`, an empty probe read as "the page announced nothing" —
 * and a diagnostic tool that repeats it would be worse than none, because it would be trusted.
 *
 * ## What it is FOR
 *
 * Not only debugging. The last question — what this capture can and cannot support — is the feedback loop
 * into how pages are captured at all. "It got stuck behind a cookie banner" and "the page has no headings"
 * produce the same empty evidence, and until you can tell them apart you are guessing about the page when
 * the fault is in the capture.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { captureSupports, consentBanner } from "@a11y-witness/evidence/verify";
import { datasetRoot, captureRoot, realCorpusRoot, repeatCapturesRoot } from "../src/dataset-paths.mjs";

refuseUnknownFlags(["--json"], { entry: import.meta.url, command: "npm run capture:explain" });

/** A capture file is sometimes wrapped in provenance. Unwrapping it is the first thing that goes wrong. */
export function captureOf(/** @type {any} */ parsed) {
  // MEASURED: reading the wrapper's `interaction` gives `undefined`, which every `?? []` turns into an
  // empty array — so a page with 20 tab stops and 14 form fields reported ZERO of each, and the wrong
  // answer was one keystroke from being acted on. The shape is checked, not assumed.
  return parsed && typeof parsed === "object" && parsed.capture ? parsed.capture : parsed;
}

/**
 * The stop reasons that mean the read REACHED THE END, rather than gave up.
 *
 * Getting this wrong is not cosmetic and it happened immediately: the first version treated anything but
 * `exhausted` as incomplete, so it reported "the read did NOT finish" on 106 of 106 real captures — a 100%
 * failure rate that was entirely the measure. `repeatBottom` is arrow-down producing the same phrase at the
 * bottom of the document, and `wrap` is a substantial phrase coming round again; both are the read finding
 * the end. `maxSteps`, `deadline`, `stepError` and `silent` are the read being cut short.
 *
 * Read off `phraseAction` in `capture-pure.mjs`, not inferred from the names.
 */
/**
 * NOT DEFINED HERE ANY MORE. `captureSupports` owns this set, and this tool asks it rather than keeping a
 * second copy — capture-integrity-plan C6. Two spellings of one fact is the defect this repo has recorded
 * five times in a day; the probe order lived in six places and they drifted. Kept as a named re-export so
 * the reasoning above still has something to point at.
 */
export { captureSupports };

const mark = (/** @type {any} */ capture, /** @type {string} */ event) =>
  (capture.diagnostics ?? []).find((/** @type {any} */ m) => m && m.event === event) ?? null;

/** `NOT RECORDED` is a distinct answer from `no`, and collapsing them is this repo's oldest defect. */
const absent = (/** @type {string} */ what) => `    NOT RECORDED — this capture cannot say ${what}`;

/**
 * Did the browser show the page that was asked for, and did anything serve it?
 * @param {any} capture
 */
export function reachedThePage(capture) {
  const landed = mark(capture, "landedOnRequested");
  const served = mark(capture, "pageServed");
  const out = [];
  out.push(landed
    ? `    ${landed.ok ? "YES" : "NO "} the browser showed ${JSON.stringify(landed.actual)}`
      + `${landed.ok ? "" : ` — you asked for ${JSON.stringify(landed.requested)}`}`
      + ` (after ${landed.waitedMs} ms, ${landed.attempts} attempt(s))`
    : absent("whether the browser showed the page requested"));
  // The URL being right and the page being served are DIFFERENT questions: an error page has the address
  // you asked for. That distinction cost four captures-that-looked-valid before it was checked.
  out.push(served
    ? served.status === null || served.status === undefined
      ? `    ?   nothing could read the HTTP status${served.unavailable ? ` — ${served.unavailable}` : ""}`
      : `    ${served.status >= 200 && served.status < 300 ? "YES" : "NO "} the server answered HTTP ${served.status}`
    : absent("whether anything actually served the page (older capture)"));
  return out;
}

/**
 * The worker's cross-check in ONE shape, whatever age the capture is.
 *
 * Since known-gaps §13 the worker records `sameCounts` / `differsOn` / `sweepEntries` /
 * `oracleDistinctNames` and renders no verdict. Every capture before it spells the same facts
 * `agrees` / `disagreements` / `sweep` / `elementsList` and adds a `kind` the worker could not justify.
 *
 * Normalised here rather than branched at each read: four `??` pairs inline took the caller to a
 * complexity of 20 against a limit of 15, and none of them was telling the reader anything except that
 * two vocabularies exist.
 *
 * @param {any} cross the `structureCrossCheck` mark, or undefined
 */
function crossCheckOf(cross) {
  if (!cross) return null;
  const differences = cross.differsOn ?? cross.disagreements ?? [];
  return {
    compared: cross.compared,
    sameCounts: cross.sameCounts ?? cross.agrees,
    differences: differences.map((/** @type {any} */ d) => ({
      type: d.type,
      entries: d.sweepEntries ?? d.sweep,
      names: d.oracleDistinctNames ?? d.elementsList,
      // Only a pre-§13 capture has one, and it is shown as recorded rather than hidden: it is what that
      // capture actually said, and a reader comparing an old report against a new one needs to see why
      // they differ.
      recordedVerdict: d.kind ?? null,
    })),
  };
}

/**
 * DOES THE SWEEP AGREE WITH THE TREE — the HOST'S verdict, not the worker's.
 *
 * `structureCrossCheck` runs on the worker, which has no announcement grammar (it is plain node, and
 * `parseAnnouncement` is TypeScript), so it compares the sweep's ENTRY COUNT against the census's distinct
 * NAMES. Those are different quantities: two links sharing a name are two announcements and one name
 * (reported `phantom`), and one landmark entry can announce several (reported `truncated`).
 *
 * Measured on 675 fresh protocol-7 captures the worker put agreement at 51%, with 191 `link/phantom` and
 * 139 `landmark/truncated`. Scoring the SAME captures host-side: links 60/60 exact, and 47 of 60 agreeing
 * on all five types. The worker records the evidence and the host interprets it — the split C1 established,
 * which this report was still reading from the wrong side of.
 *
 * The raw worker number is still printed, because a diagnostic that disagrees with the verdict is worth
 * seeing rather than hiding.
 *
 * SINCE 2026-08-29 THE WORKER RENDERS NO `kind` (known-gaps §13): it records `sweepEntries` and
 * `oracleDistinctNames` and leaves the verdict to the host, which is the split described above. Both
 * shapes are read here because this tool is pointed at captures of any age — every capture taken before
 * that change carries `agrees`/`disagreements`/`kind`, and a reader that could not open them would make
 * the whole existing corpus unexplainable to fix a naming problem.
 *
 * @param {any} capture
 * @returns {string[]}
 */
export function sweepAgreesWithTheTree(capture) {
  const cross = crossCheckOf(mark(capture, "structureCrossCheck"));
  const out = [];
  const completeness = Object.entries(captureSupports(capture).absence);
  const off = completeness.filter(([, support]) => !support.ok);
  if (completeness.length === 0) out.push(absent("whether the sweep agrees with the accessibility tree"));
  else if (off.length === 0) out.push(`    YES the sweep agrees with the tree on all ${completeness.length} type(s)`);
  else for (const [type, support] of off) out.push(`    NO  ${type}: ${support.why}`);
  if (cross && cross.sameCounts === false && off.length === 0) {
    out.push("    (the worker's own cross-check disagreed; it compares entry COUNTS against distinct"
      + " NAMES and cannot resolve them — the line above is the authoritative one)");
  }
  if (!cross) out.push(absent("the worker's raw cross-check"));
  else if (cross.sameCounts) out.push(`    - worker cross-check: same counts on ${cross.compared} type(s)`);
  else {
    for (const d of cross.differences) {
      out.push(`    - worker cross-check: ${d.type} sweep entries ${d.entries} vs tree distinct names ${d.names}`
        + `${d.recordedVerdict ? ` (recorded "${d.recordedVerdict}" — a verdict the worker cannot compute)` : ""}`
        + " — RAW, and see this function's note on what it compares");
    }
  }
  return out;
}

/** Did the screen reader reach the content, or stop short of it? @param {any} capture */
export function reachedTheContent(capture) {
  const read = mark(capture, "readThrough");
  const truncated = mark(capture, "truncatedAnnouncements");
  const out = [];
  const supports = captureSupports(capture);
  if (!read) out.push(absent("whether the read-through finished"));
  else if (supports.ordering.ok) {
    out.push(`    YES the read reached the end of the page (${read.stopReason}) after ${read.count} step(s)`);
  } else {
    // A read that ran out of budget did NOT see the whole page, and everything downstream is a claim about
    // the part it saw. That is the difference between "this page has no headings" and "we stopped looking".
    out.push(`    NO  the read stopped at ${JSON.stringify(read.stopReason)} after ${read.count} step(s)`
      + " — anything absent below may simply be past where it stopped");
  }
  out.push(...sweepAgreesWithTheTree(capture));
  const cut = truncated?.truncated ?? [];
  if (cut.length) out.push(`    !   ${cut.length} announcement(s) arrived truncated, e.g. ${JSON.stringify(String(cut[0].heard).slice(0, 60))}`);
  // WHAT THIS CAPTURE CAN BEAR A CLAIM ABOUT, from the same function the rules read. The point of C6 is
  // that a reader of a finding and the rule that made it cite ONE answer, not two derivations of it.
  const cannot = Object.entries(supports.absence).filter(([, s]) => !s.ok);
  out.push(cannot.length === 0
    ? "    YES absence is claimable on every type the tree counts"
    : `    NO  absence is NOT claimable on ${cannot.map(([t]) => t).join(", ")}`
      + ` — ${cannot[0][1].why}`);
  out.push(`    ${supports.naming.ok ? "YES" : "NO "} naming: ${supports.naming.why}`);
  return out;
}

/** Was something in the way — a banner, an overlay, a modal? @param {any} capture */
export function wasAnythingInTheWay(capture) {
  const confinement = mark(capture, "focusConfinement");
  const dialogs = mark(capture, "desktopDialogsDismissed");
  const out = [];
  // THE QUESTION THAT KEEPS BEING GUESSED AT. A page that opens on a consent banner and a page with
  // nothing to say produce similar-looking evidence, and the difference decides whether a finding is
  // about the site or about us.
  // ONE DEFINITION, in `consentBanner`. This was a regex here and would have drifted from the one the
  // rules read — the "fact stated twice" defect, which cost five incidents in a day.
  const banner = consentBanner(capture);
  out.push(banner.present
    ? `    ${banner.blocking ? "!!" : "! "}  CONSENT BANNER — ${banner.why}`
    : `    ${banner.why}`);
  if (confinement) {
    out.push(confinement.confined
      ? `    !   focus was CONFINED to ${confinement.ring} control(s) of ${confinement.controlsOnPage} announced`
      : `    focus was not confined (ring ${confinement.ring}, ${confinement.controlsOnPage} announced)`);
  } else out.push(absent("whether focus was confined"));
  if (dialogs?.dialogs?.length) {
    out.push(`    !   ${dialogs.dialogs.length} desktop dialog(s) were dismissed before capturing — a guest`
      + " left in that state swallows keystrokes");
  }
  return out;
}

/** Did the page hold still while the probes ran? @param {any} capture */
export function heldStill(capture) {
  const states = (capture.diagnostics ?? []).filter((/** @type {any} */ m) => m?.event === "pageState" && !m.error);
  const settled = mark(capture, "pageSettled");
  const out = [];
  out.push(settled
    ? settled.settled === false
      ? `    !   the DOM was STILL CHANGING after ${settled.waitedMs} ms — captured as it stood`
      : `    YES the DOM settled after ${settled.reads} read(s) (${settled.waitedMs} ms)`
    : absent("whether the DOM settled before reading"));
  if (states.length < 2) {
    out.push(absent("whether the page moved BETWEEN probes — fewer than two fingerprints"));
    return out;
  }
  const keys = ["tabbable", "formField", "link", "landmark", "heading", "graphic"];
  const moved = keys.filter((k) => new Set(states.map((/** @type {any} */ s) => s[k]))
    .size > 1 && states.every((/** @type {any} */ s) => typeof s[k] === "number"));
  out.push(moved.length
    ? `    !   THE PAGE CHANGED UNDER ITS OWN PROBES: ${moved.join(", ")} moved between `
      + `${states.map((/** @type {any} */ s) => s.beforeProbe).join(" and ")}`
      + " — two probes saw different pages, so comparing them compares two things"
    : `    YES the page held still across ${states.length} probe(s)`);
  return out;
}

/** @param {any} capture */
/**
 * WHAT DID THIS CAPTURE ASK? — read from `observed`, which the capture records for itself since protocol 10.
 *
 * Every other section here is archaeology: it reconstructs what happened from a scatter of marks. This one
 * is not, and that is the point — the capture states it, so a channel nobody asked about says so in its own
 * words rather than being inferred from a missing mark.
 *
 * It also makes this report's closing line TRUE. "What it does not report, the page does not have" was a
 * claim nothing checked; a channel that was never asked is exactly the case where it is false, and until
 * now the report had no way to know. Measured across the corpus before this field existed: `formChanges`
 * empty on 4,830 captures of 6,467 and **3,006 of those never asked**.
 *
 * @param {any} capture
 * @returns {string[]}
 */
export function whatItAsked(capture) {
  const observed = capture?.observed;
  if (!observed || typeof observed !== "object") {
    return [absent("which channels it asked about — it predates CAPTURE_PROTOCOL_VERSION 10")];
  }
  const rows = [];
  for (const [channel, seen] of Object.entries(/** @type {Record<string, any>} */ (observed))) {
    if (!seen?.asked) {
      // "NOT ASKED" rather than "no": the channel is empty and that is a fact about this run, not the page.
      rows.push(`    NOT ASKED  ${channel} — ${seen?.why ?? "no reason recorded"}`);
    } else if (seen.complete === false) {
      rows.push(`    ! ${channel} asked, and the sweep did NOT run out — stopped `
        + `${JSON.stringify(seen.stop ?? {})}. An absence here is about the sweep, not the page.`);
    } else if (seen.complete === true) {
      rows.push(`    ok ${channel} — asked, and NVDA itself said there were no more`);
    } else {
      // A THIRD STATE, and inventing either of the other two would be the defect this field removes.
      // `tableCells` walks a grid with Ctrl+Alt+Arrow and has no "no next heading" to exhaust, so it can
      // report that it ran and cannot report that it finished.
      rows.push(`    ~ ${channel} — asked, but this channel has no exhaustion signal to report`);
    }
  }
  return rows.length ? rows : [absent("which channels it asked about — `observed` is empty")];
}

/**
 * THE INTERACTION PROBES: which ones RAN, and what each one concluded.
 *
 * `whatItAsked` above reads `observed`, which covers the SWEEP channels. The interaction probes are not in
 * it — `stateChanges` deliberately has no `observed` entry, and `focusReveal`, `focusEvents`,
 * `focusContext` and `routeChange` post-date it — so their verdicts live only in diagnostic marks, and
 * nothing read them. That is the hole this section fills, and it is a hole with a measured cost.
 *
 * MEASURED 2026-09-05: a real-page capture was fetched to confirm the 1.4.13 probe had run. `capture`
 * carries no top-level `focusReveal` — it lives under `interaction` — so reading `cap.focusReveal` returned
 * `undefined` and the conclusion drawn was "the probe never ran", which would have cost a whole recapture
 * round. The probe HAD run, and its mark said so in full: `asked: true, revealed: false, why: "nothing
 * appeared on focus", tabs: 8`. That is this repo's *"a guess at the JSON shape"* defect, and
 * `capture:explain`'s own header names it — *"every question was answered by ssh, hand-written Python and
 * a guess at the JSON shape, which produced four wrong answers in one session"*. The remedy is not to
 * remember the path; it is for the tool to read the mark so nobody has to.
 *
 * THREE STATES, never two. A probe that never ran, a probe that ran and could not ask, and a probe that ran
 * and found nothing are three different facts, and only the third says anything about the page. This is the
 * same distinction `observed` draws for sweeps and `404` vs `202` draws for a lost capture result.
 *
 * @param {any} capture
 * @returns {string[]}
 */
export function whichProbesRan(capture) {
  return INTERACTION_PROBES.map(({ events, what }) => {
    // The FIRST name that is present. A probe renamed between protocol versions is one probe, and keying
    // on either name alone reports NOT ASKED for every capture on the other side of the rename.
    const event = events.find((name) => mark(capture, name)) ?? events[0];
    const m = mark(capture, event);
    // NO MARK IS THE INTERESTING CASE and it must not read as "found nothing". A probe writes its mark on
    // every path it takes, including the ones it abandons, so an absent mark means it was never reached --
    // the flag was off, or something earlier threw.
    if (!m) return `    NOT ASKED  ${what} — no ${event} mark, so this probe never ran`;
    if (m.skipped) return `    NOT ASKED  ${what} — ${event} stopped: ${JSON.stringify(m.skipped)}`;
    if (m.error) return `    !  ${what} — ${event} ERRORED: ${JSON.stringify(String(m.error).slice(0, 120))}`;
    // `asked: false` is the probe's own way of saying its precondition was missing -- `observed.<ch>.why`
    // names WHICH precondition, because "nobody asked" and "asked without the probe that makes it
    // meaningful" need opposite fixes.
    if (m.asked === false) return `    NOT ASKED  ${what} — ${m.why ?? "no reason recorded"}`;
    return `    ok ${what} — ${summariseProbeMark(m)}`;
  });
}

/**
 * One probe mark in one line, WITHOUT choosing which fields matter.
 *
 * Naming the fields per probe would be a second spelling of each probe's own output, and this repo has
 * paid for that shape repeatedly -- a hand-written field list that silently examined nothing for the one
 * member with a different shape. So this prints what the mark actually carries, minus the bookkeeping
 * every mark has, and a probe that grows a field shows it here without anyone editing this function.
 *
 * @param {Record<string, any>} m
 * @returns {string}
 */
function summariseProbeMark(m) {
  const skip = new Set(["event", "atMs", "asked"]);
  const parts = Object.entries(m)
    .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${oneLine(v)}`);
  return parts.length ? parts.join(" ") : "ran, and recorded nothing beyond having run";
}

/**
 * One mark FIELD, short enough to read beside seven others.
 *
 * A COUNT AND A SAMPLE for a list, never the list. `focusEventLog` carries 116 focus events and printing
 * them whole buried the other seven probes' verdicts in a wall of JSON -- which is the failure this whole
 * report exists to fix, arriving through the fix itself. The count is the part that discriminates (*"a
 * number beats a word"*: "examination was INCOMPLETE" cannot tell you whether two links were missed or two
 * hundred), and one element says what the list is MADE of. The full field is on the mark for anyone who
 * wants it; this is the reading view.
 *
 * @param {unknown} v
 * @returns {string}
 */
function oneLine(v) {
  if (typeof v === "string") return JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}…` : v);
  if (!Array.isArray(v)) return JSON.stringify(v);
  if (v.length === 0) return "[]";
  const first = JSON.stringify(v[0]);
  const sample = first.length > 80 ? `${first.slice(0, 80)}…` : first;
  return v.length === 1 ? `[${sample}]` : `[${v.length} entries, e.g. ${sample}]`;
}

/**
 * The interaction probes this report accounts for, each with the QUESTION it answers rather than its
 * function name -- a reader asking "was 1.4.13 assessed" does not know the probe is called `focusReveal`.
 *
 * Declared here and pinned by `explain-capture.test.ts` against the marks real captures carry, in BOTH
 * directions: a probe on disk that this list does not name is a hole, and a name here that no capture
 * carries is a phantom contributing nothing. That is `evidence-fields.test.ts`'s rule, applied to a report
 * rather than to a comparison, and it is here because the SAME defect has now been found in four tools.
 */
export const INTERACTION_PROBES = Object.freeze([
  { events: ["focusOrder"], what: "the tab order (2.4.3, 2.1.1)" },
  { events: ["focusContext"], what: "whether focus alone changed the page's context (3.2.1)" },
  { events: ["focusReveal"], what: "whether focus REVEALED content, and whether it can be dismissed (1.4.13)" },
  { events: ["focusConfinement"], what: "whether focus could leave (2.1.2)" },
  { events: ["dialogEscape"], what: "whether Escape closed a dialog (2.1.2)" },
  { events: ["focusEventLog"], what: "whether a script removed focus when it was received (2.4.7)" },
  { events: ["routeChange"], what: "whether the title followed the route (2.4.2)" },
  // THE TYPING PROBE'S ONLY MARK, and it names where it landed rather than what it concluded — which is
  // still the answer to "did this probe run", the question this section asks. Naming it as the typing
  // probe rather than excluding it as bookkeeping is the difference between 3.2.2 being accounted for
  // and being invisible.
  { events: ["typingLanding"], what: "the typing probe: whether typing changed the context (3.2.2)" },
  { events: ["arrowNavigation", "arrowNavLanding"], what: "whether arrows moved inside the widget (2.1.1)" },
  // TWO NAMES FOR ONE PROBE, and finding that out is why the both-directions test exists. The mark is
  // `formFill` on current captures and `formProbe` on 1,182 older ones -- so a report keyed on either name
  // alone says NOT ASKED for half the corpus, which is the *"a probe never ran"* reading of a rename.
  // Newest first; the first name found is the one reported.
  { events: ["formFill", "formProbe"], what: "the form probe: validation and status announcements (3.3.1, 4.1.3)" },
  { events: ["interaction"], what: "the disclosure probe: state changes (4.1.2)" },
]);

function report(/** @type {any} */ capture, /** @type {string} */ source) {
  const url = mark(capture, "landedOnRequested")?.requested ?? capture.url ?? "(unknown page)";
  const lines = [`\n${url}`, `  from ${source}`, ""];
  for (const [heading, rows] of /** @type {[string, string[]][]} */ ([
    ["DID IT CAPTURE THE PAGE YOU ASKED FOR?", reachedThePage(capture)],
    ["DID THE SCREEN READER REACH THE CONTENT?", reachedTheContent(capture)],
    ["WAS ANYTHING IN THE WAY?", wasAnythingInTheWay(capture)],
    ["DID THE PAGE HOLD STILL?", heldStill(capture)],
    ["WHAT DID IT ASK?", whatItAsked(capture)],
    ["WHICH INTERACTION PROBES RAN?", whichProbesRan(capture)],
  ])) {
    lines.push(`  ${heading}`, ...rows, "");
  }
  // The point of the whole report: which claims this capture can carry. A reader who stops here should
  // know whether an absence is evidence or an artefact.
  // `NOT ASKED` joins the list because it is the plainest qualification there is: the channel is empty
  // and nobody looked. Leaving it out would let the closing line claim the page lacks something the
  // capture never asked about — the exact sentence this field was added to stop being said.
  const doubts = lines.filter((l) => l.includes("NOT RECORDED") || l.includes("NOT ASKED")
    || l.trimStart().startsWith("!") || l.trimStart().startsWith("NO "));
  lines.push(doubts.length
    ? `  ${doubts.length} thing(s) above qualify what this capture can support. An absence in this evidence`
      + " is not yet evidence of absence."
    : "  Nothing qualifies this capture: what it does not report, the page does not have.");
  return lines.join("\n");
}

/** Resolve an argument to capture files: a path, a directory, or a substring of an id. */
function findCaptures(/** @type {string} */ needle) {
  if (existsSync(needle) && !needle.endsWith("/")) return [needle];
  const roots = [realCorpusRoot(), captureRoot(datasetRoot()), repeatCapturesRoot()]
    .filter((r) => existsSync(r));
  const hits = [];
  for (const root of roots) {
    for (const f of readdirSync(root)) {
      if (f.endsWith(".json") && f.toLowerCase().includes(needle.toLowerCase())) hits.push(join(root, f));
    }
  }
  return hits;
}

async function main() {
  const needle = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!needle) {
    process.stderr.write("npm run capture:explain -- <file | case-id | url-fragment>\n\n"
      + "  What actually happened on a page, from the marks the capture already recorded.\n"
      + "  Answers: did it reach the page, did the screen reader reach the content, was anything in\n"
      + "  the way (a consent banner, a modal), and did the page hold still while the probes ran.\n");
    process.exit(2);
  }
  const files = findCaptures(needle);
  if (!files.length) {
    // NAMES WHERE IT LOOKED. "Not found" without saying where is how an empty search reads as an answer.
    process.stderr.write(`no capture matching ${JSON.stringify(needle)} under runs/real-page-corpus, `
      + "runs/screenreader-dataset/captures or runs/repeat-captures.\n");
    process.exit(2);
  }
  for (const file of files.slice(0, 8)) {
    const capture = captureOf(JSON.parse(readFileSync(file, "utf8")));
    process.stdout.write(`${report(capture, file.replace(`${process.cwd()}/`, ""))}\n`);
  }
  if (files.length > 8) process.stdout.write(`\n... and ${files.length - 8} more matched; narrow the search.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
