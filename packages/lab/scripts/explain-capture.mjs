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
const REACHED_THE_END = new Set(["exhausted", "repeatBottom", "wrap"]);

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

/** Did the screen reader reach the content, or stop short of it? @param {any} capture */
export function reachedTheContent(capture) {
  const read = mark(capture, "readThrough");
  const cross = mark(capture, "structureCrossCheck");
  const truncated = mark(capture, "truncatedAnnouncements");
  const out = [];
  if (!read) out.push(absent("whether the read-through finished"));
  else if (REACHED_THE_END.has(read.stopReason)) {
    out.push(`    YES the read reached the end of the page (${read.stopReason}) after ${read.count} step(s)`);
  } else {
    // A read that ran out of budget did NOT see the whole page, and everything downstream is a claim about
    // the part it saw. That is the difference between "this page has no headings" and "we stopped looking".
    out.push(`    NO  the read stopped at ${JSON.stringify(read.stopReason)} after ${read.count} step(s)`
      + " — anything absent below may simply be past where it stopped");
  }
  if (!cross) out.push(absent("whether the sweep agrees with the accessibility tree"));
  else if (cross.agrees) out.push(`    YES the sweep agrees with the tree on all ${cross.compared} type(s)`);
  else {
    for (const d of cross.disagreements ?? []) {
      out.push(`    NO  ${d.type}: the sweep announced ${d.sweep}, the tree exposes ${d.elementsList}`
        + `${d.kind ? ` (${d.kind})` : ""} — a gap here is a question about this TOOL, not about the page`);
    }
  }
  const cut = truncated?.truncated ?? [];
  if (cut.length) out.push(`    !   ${cut.length} announcement(s) arrived truncated, e.g. ${JSON.stringify(String(cut[0].heard).slice(0, 60))}`);
  return out;
}

/** Was something in the way — a banner, an overlay, a modal? @param {any} capture */
export function wasAnythingInTheWay(capture) {
  const confinement = mark(capture, "focusConfinement");
  const dialogs = mark(capture, "desktopDialogsDismissed");
  const opens = (capture.transcript ?? []).slice(0, 3).join(" ").toLowerCase();
  const out = [];
  // THE QUESTION THAT KEEPS BEING GUESSED AT. A page that opens on a consent banner and a page with
  // nothing to say produce similar-looking evidence, and the difference decides whether a finding is
  // about the site or about us.
  const banner = /cookie|consent|accept all|privacy settings/.test(opens);
  out.push(banner
    ? `    !   THE PAGE OPENS ON A CONSENT BANNER — the transcript starts ${JSON.stringify((capture.transcript ?? [])[0] ?? "")}.`
      + " Everything below describes the page WITH that banner present"
    : "    no consent banner in the opening announcements");
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
