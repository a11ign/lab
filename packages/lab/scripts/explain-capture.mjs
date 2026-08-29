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
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { captureSupports, consentBanner } from "@a11y-witness/evidence/verify";

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
function report(capture, /** @type {string} */ source) {
  const url = mark(capture, "landedOnRequested")?.requested ?? capture.url ?? "(unknown page)";
  const lines = [`\n${url}`, `  from ${source}`, ""];
  for (const [heading, rows] of /** @type {[string, string[]][]} */ ([
    ["DID IT CAPTURE THE PAGE YOU ASKED FOR?", reachedThePage(capture)],
    ["DID THE SCREEN READER REACH THE CONTENT?", reachedTheContent(capture)],
    ["WAS ANYTHING IN THE WAY?", wasAnythingInTheWay(capture)],
    ["DID THE PAGE HOLD STILL?", heldStill(capture)],
  ])) {
    lines.push(`  ${heading}`, ...rows, "");
  }
  // The point of the whole report: which claims this capture can carry. A reader who stops here should
  // know whether an absence is evidence or an artefact.
  const doubts = lines.filter((l) => l.includes("NOT RECORDED") || l.trimStart().startsWith("!") || l.trimStart().startsWith("NO "));
  lines.push(doubts.length
    ? `  ${doubts.length} thing(s) above qualify what this capture can support. An absence in this evidence`
      + " is not yet evidence of absence."
    : "  Nothing qualifies this capture: what it does not report, the page does not have.");
  return lines.join("\n");
}

/** Resolve an argument to capture files: a path, a directory, or a substring of an id. */
function findCaptures(/** @type {string} */ needle) {
  if (existsSync(needle) && !needle.endsWith("/")) return [needle];
  const roots = ["runs/real-page-corpus", "runs/screenreader-dataset/captures", "runs/repeat-captures"]
    .map((r) => resolve(process.cwd(), r)).filter((r) => existsSync(r));
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
