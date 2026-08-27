/**
 * Does this change make the tool accuse a conformant real page of something new?
 *
 * ## Why this exists
 *
 * `rules:gate` scores the CORPUS and catches a rule that has gone quiet. Nothing caught the opposite —
 * a rule that starts firing where it should not — and on 2026-08-25 eleven separate defects had done
 * exactly that, four of them producing ASSERTIONS and three of those against W3C's own accessibility
 * tutorials. `2.1.1` fired on 66% of conformant real pages. Every gate was green throughout.
 *
 * The corpus cannot catch this class, and that is not a gap to close but a property to design around:
 * every one of the eleven was a shape the corpus does not contain — a page that mutates mid-capture, an
 * icon-font glyph in an accessible name, one element announced with two roles, markup read aloud. A
 * corpus built from the same assumptions as the code cannot falsify them.
 *
 * So the ground truth is the real pages themselves. 86 of them carry a publisher's own declaration of
 * conformance, which is the closest thing this project has to a negative label it did not author.
 *
 * ## What it compares, and why a baseline rather than zero
 *
 * Zero is the wrong target: some findings on those pages are CORRECT. scotcourts really does ship
 * `<button class="inner mobileMenuButton">` with no text and no aria-label; networkrail really does use
 * a filename as alt text. A gate demanding silence would force those to be suppressed, which is the
 * mirror of the defect it exists to prevent.
 *
 * So the baseline records what is currently believed correct, page by page and criterion by criterion,
 * and the gate fails on anything NEW. Removals are reported as improvements and never fail — a change
 * that fixes a false positive should not need permission.
 *
 *   npm run rules:real-pages
 *   npm run rules:real-pages -- --update    # after reviewing each new finding, on purpose
 *
 * **A new finding is not automatically a bug in the tool.** Real pages change under their own publishers,
 * so it can also mean the page changed. Both need a human to look, which is precisely what this asks for.
 *
 * Needs `runs/`, so it SKIPS HONESTLY where the corpus is absent rather than passing quietly.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ruleFindings } from "@a11y-witness/judge/rules";
import { corpusState } from "../src/training/corpus-settled.mjs";
import { pageCensus, domCensus } from "@a11y-witness/evidence/verify";
import { realPageFor } from "../src/training/real-page-corpus.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REAL = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
const BASELINE = resolve(REPO, "packages/lab/baselines/real-page-findings.json");
const UPDATE = process.argv.includes("--update");

/** Below this the corpus is being recaptured and every count describes a state that is already gone. */
// `SETTLED_AFTER_MINUTES` lives in `corpus-settled.mjs` now, with the check that uses it.

type Findings = Record<string, string[]>;

function minutesSinceLastWrite(dir: string): number | null {
  let newest = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      newest = Math.max(newest, statSync(join(dir, entry)).mtimeMs);
    }
  } catch {
    return null;
  }
  return newest ? (Date.now() - newest) / 60_000 : null;
}

/** What the rules say about every conformant real page, as `url -> sorted criteria`. */
function currentFindings(): Findings {
  const out: Findings = {};
  let entries: string[];
  try {
    entries = readdirSync(REAL);
  } catch {
    return out;
  }
  for (const file of entries.sort()) {
    if (!file.endsWith(".json")) continue;
    let capture: { url?: string; transcript?: unknown };
    try {
      const parsed = JSON.parse(readFileSync(join(REAL, file), "utf8")) as { capture?: unknown };
      capture = (parsed.capture ?? parsed) as { url?: string; transcript?: unknown };
    } catch {
      continue;
    }
    if (!Array.isArray(capture.transcript)) continue;
    const page = realPageFor(capture.url);
    // Conformant pages only. A page whose publisher declares it INACCESSIBLE is supposed to produce
    // findings, and holding those to a baseline would be measuring the wrong thing entirely.
    if (!page || page.publishedClaim !== "conformant") continue;
    noteEvidence(capture);
    // HONOUR THE PUBLISHER'S OWN EXCEPTIONS, which this gate was ignoring.
    //
    // `publishedClaim: "conformant"` does not mean the publisher claims every criterion. Almost every UK
    // public-sector statement says "partially compliant" with an enumerated list, and `real-page-corpus`
    // records the intersection with our eight in `claimExcludes` — the realism tier already honours it
    // ("publisher exceptions honoured: 37 of 37 page(s)"). This gate read only `publishedClaim`, so it
    // reported findings on criteria the publisher had explicitly declined to claim, under the headline
    // "pages whose publisher declares them conformant". They do not declare that.
    //
    // Measured 2026-08-26, the run that found this: 9 of 12 flagged findings were inside a declared
    // exception — tfl, bl.uk, financial-ombudsman, lbhf, leeds, metoffice/forecast, nationalarchives,
    // nls and sepa all name 1.1.1 in their own statements. A gate that cannot see the mask its own corpus
    // declares is measuring the publisher's honesty, not this tool's accuracy.
    // EXACT criterion entries only. `claimExcludes` may hold a SUBTYPE ("1.1.1:missing-alt"), and these
    // findings are criterion-level — so widening a subtype exclusion to its whole criterion would hide
    // real findings on the subtypes the publisher still claims. All 145 entries are bare criteria today;
    // this refuses to guess if that changes, and `subtypeScoped` makes the skip visible rather than
    // silent, because "we could not attribute it" and "it was not excluded" are different answers.
    const declared = (page.claimExcludes ?? []).map(String);
    const subtypeScoped = declared.filter((entry) => entry.includes(":"));
    if (subtypeScoped.length) {
      process.stdout.write(`  NOTE ${capture.url}: ${subtypeScoped.join(", ")} `
        + "is subtype-scoped and these findings are criterion-level, so it cannot mask them.\n");
    }
    const excluded = new Set(declared.filter((entry) => !entry.includes(":")));
    const criteria = [...new Set(ruleFindings(withCensus(capture))
      .map((finding) => String(finding.wcag).split(" ")[0]))]
      .filter((criterion) => !excluded.has(criterion))
      .sort();
    out[String(capture.url)] = criteria;
  }
  return out;
}

function readBaseline(): Findings | null {
  if (!existsSync(BASELINE)) return null;
  return JSON.parse(readFileSync(BASELINE, "utf8")) as Findings;
}

function writeBaseline(findings: Findings): void {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(findings, null, 2)}\n`);
}

type Change = { url: string; criterion: string };

function compare(current: Findings, baseline: Findings): { added: Change[]; removed: Change[] } {
  const added: Change[] = [];
  const removed: Change[] = [];
  for (const [url, criteria] of Object.entries(current)) {
    const was = new Set(baseline[url] ?? []);
    for (const criterion of criteria) if (!was.has(criterion)) added.push({ url, criterion });
  }
  for (const [url, criteria] of Object.entries(baseline)) {
    const now = new Set(current[url] ?? []);
    // A page absent from `current` has no capture in this copy of runs/, which is a question about the
    // copy rather than about the rules. Reporting it as an improvement would be a lie in the safe
    // direction, and this file's whole point is that the safe direction still has to be true.
    if (!current[url]) continue;
    for (const criterion of criteria) if (!now.has(criterion)) removed.push({ url, criterion });
  }
  return { added, removed };
}

/**
 * A capture, plus the census the rules are allowed to read.
 *
 * `ruleFindings` expects `census` as a FIELD; a raw capture records it as a `structureCensus` diagnostic,
 * and only `pageCensus` extracts it. The CLI has always built it — `census: pageCensus(cap)` — and these
 * audits passed the raw capture, so every census-reading rule was silently unreachable HERE while working
 * in the product.
 *
 * Caught by two gates disagreeing about one corpus: `rules:gate` reported `1.3.1:no-headings 29/29 EXACT`
 * while this reported the same criterion as having fired `0x`. The same defect was fixed in
 * `score-rules.ts` hours earlier and did not reach this path — the shape this repo names most often.
 */
function withCensus(capture: unknown): never {
  return { ...(capture as object), census: pageCensus(capture as never) ?? undefined } as never;
}

/**
 * One line of the evidence behind a finding, so the verdict can be judged where it is printed.
 *
 * Deliberately the CENSUS and the transcript size: those are what the census-reading rules decide on, and
 * `heading=0 link=0 graphic=0` versus `heading=0 link=47 graphic=12` is the difference between "the tree
 * was never built" and "this page really has no headings" — a distinction no count can carry.
 */
function describeEvidence(url: string): string {
  return EVIDENCE.get(url) ?? "(no capture found for this url in runs/)";
}

/** url -> one line of the evidence behind it, filled while walking the captures rather than re-reading. */
const EVIDENCE = new Map<string, string>();

function noteEvidence(capture: { url?: string; transcript?: unknown }): void {
  const census = pageCensus(capture as never);
  const dom = domCensus(capture as never);
  const lines = Array.isArray(capture.transcript) ? capture.transcript.length : 0;
  // The FIRST few announcements as well as the counts. The counts said `heading=0` on a page whose
  // published HTML carries forty of them, and a count cannot tell you whether the tool read a cookie
  // wall, a loading shell, or the page — which are three different verdicts needing three different
  // responses. What the screen reader SAID is the only thing that distinguishes them, and fetching it by
  // hand afterwards is the step this line exists to remove.
  const openingLines = (Array.isArray(capture.transcript) ? capture.transcript : [])
    .slice(0, 3).map((line) => String(line));
  OPENINGS.set(String(capture.url), openingLines);
  if (census) CENSUS.set(String(capture.url), census);
  const opening = openingLines.map((line) => JSON.stringify(line.slice(0, 60))).join(" ");
  // THE PAIR, because either alone is ambiguous. A tree census of zero headings means the page did not
  // render OR the page exposes nothing; the DOM count is the only thing that separates them, and that
  // ambiguity is what forced a page out of the corpus with its verdict unattributable.
  const verdict = census && dom && typeof dom.heading === "number"
    ? (dom.heading > 0 && census.heading === 0
        ? `  <- ${dom.heading} headings in the DOM, 0 in the tree: the page EXPOSES nothing, which is a `
          + "finding about it, not about this tool"
        : (dom.heading === 0 && census.heading === 0
            ? "  <- no headings in the DOM either, so the page did not render — OUR defect, not theirs"
            : ""))
    : "";
  EVIDENCE.set(String(capture.url), (census
    ? `census heading=${census.heading} link=${census.link} graphic=${census.graphic} `
      + `graphicUnnamed=${census.graphicUnnamed}; ${lines} announcement(s)`
      + (dom ? ` | DOM heading=${dom.heading} link=${dom.link} graphic=${dom.graphic}` : " | DOM not counted")
      + verdict
    : `no census recorded; ${lines} announcement(s)`) + (opening ? `\n           opens: ${opening}` : ""));
}

/**
 * Captures that read the site's FURNITURE rather than its page, counted across the whole corpus.
 *
 * Two were found by reading transcripts on 2026-08-26 and both produce findings that are about this tool,
 * not about the page: the Met Office warnings page opened `"blank"` and announced 27 lines of navigation
 * with zero headings, while its published HTML carries forty; and networkrail opened
 * `"heading, level 2, This website uses cookies"`, so `graphicUnnamed=21` counted a consent overlay's
 * icons. Neither cookie banners nor render-readiness is handled anywhere in the capture path — every wait
 * there is speech-based, and speech settles just as happily on a shell as on a page.
 *
 * A count is what turns "I found two" into "how much of this corpus is like that", which is the question
 * that decides whether this is two pages to re-capture or a capture-path change.
 */
function furnitureCaptures(): { consent: string[]; shell: string[] } {
  const consent: string[] = [];
  const shell: string[] = [];
  for (const [url, opening] of OPENINGS) {
    // STOPPED at the furniture, not merely started there — and the first version of this check got that
    // wrong, reporting 50 of 86. Every UK public-sector site opens with a cookie banner and the read-through
    // goes straight past it: networkrail opens on Cookiebot and still reaches 69 announcements and 11
    // headings. "Has a banner" and "never got past the banner" are different facts, and a count that
    // merges them is the defect this file exists to report, committed inside the report.
    //
    // The tree is the discriminator: a capture that reached the page has HEADINGS in its census. One that
    // did not has the site's chrome — nav, logo, banner — and nothing under it.
    const reachedThePage = (CENSUS.get(url)?.heading ?? 0) > 0;
    if (reachedThePage) continue;
    const text = opening.join(" ").toLowerCase();
    if (/cookie|consent|privacy preference|usercentrics|onetrust/.test(text)) consent.push(url);
    else if (opening[0]?.trim().toLowerCase() === "blank") shell.push(url);
  }
  return { consent, shell };
}

/** url -> its census, so the summary can ask whether a capture ever reached the page. */
const CENSUS = new Map<string, { heading?: number }>();

/** url -> its opening announcements, kept so the summary above can be computed without a second read. */
const OPENINGS = new Map<string, string[]>();

function main(): void {
  // ASKED, not inferred from file age — the same fix `audit-rule-coverage.ts` took, applied here too.
  // It was applied to ONE of the three audits that carry this guard, which is the shape this repo names
  // most often, and it showed up immediately: this refused a run that had finished 0.6 minutes earlier.
  const settle = corpusState({
    datasetRoots: [REAL],
    evidenceDirs: [REAL],
    minutesSinceLastWrite: (dirs: string[]) => minutesSinceLastWrite(dirs[0]),
  });
  if (settle.blocking) {
    process.stdout.write(`\n  ${settle.state === "abandoned" ? "ABANDONED RUN" : "IN FLUX"} — ${settle.why}.\n`
      + "  This is NOT a pass and NOT a failure; it is a refusal to measure a moving target.\n");
    process.exitCode = 2;
    return;
  }

  const current = currentFindings();
  const pages = Object.keys(current).length;
  if (!pages) {
    process.stdout.write("\n  SKIPPED: no real-page captures under runs/ — this gate needs them.\n"
      + "  That is an honest skip, not a pass. The lab holds the authoritative copy.\n");
    return;
  }

  if (UPDATE) {
    writeBaseline(current);
    const total = Object.values(current).reduce((n, list) => n + list.length, 0);
    process.stdout.write(`\n  Baseline updated: ${total} finding(s) across ${pages} conformant real page(s).\n`
      + "  Every one of these is now asserted to be CORRECT. Review before committing.\n");
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    process.stdout.write("\n  No baseline yet. Create one with `npm run rules:real-pages -- --update`,\n"
      + "  having checked each finding it records — the file is a claim that they are all correct.\n");
    process.exitCode = 2;
    return;
  }

  const { added, removed } = compare(current, baseline);
  process.stdout.write(`\n  ${pages} conformant real page(s) scored against the baseline.\n`);
  for (const change of removed) {
    process.stdout.write(`  GONE   ${change.criterion} on ${change.url.replace(/^https:\/\//, "")}\n`);
  }
  if (removed.length) {
    process.stdout.write(`  ${removed.length} finding(s) no longer reported. Not a failure — if that was a `
      + "false positive, this is the fix landing.\n  Run with --update to accept.\n");
  }
  if (!added.length) {
    process.stdout.write("\n  PASS — no conformant page gained a finding.\n");
    return;
  }
  process.stdout.write(`\n  ${added.length} NEW finding(s) on pages whose publisher declares them conformant:\n`);
  for (const change of added) {
    process.stdout.write(`    ${change.criterion}  ${change.url.replace(/^https:\/\//, "")}\n`);
    // THE EVIDENCE, not just the URL. This told the reader to "read the evidence for each" and then gave
    // them a list of URLs — so reading it meant an ssh session and ad-hoc JSON, which is the step this
    // repo removes everywhere else. The census is the whole basis of the two rules most likely to appear
    // here, and it also settles the question a bare count cannot: a census reading zero for EVERYTHING is
    // a tree that was never built, which is not the same finding as a page that genuinely has none.
    process.stdout.write(`           ${describeEvidence(change.url)}\n`);
  }
  const furniture = furnitureCaptures();
  if (furniture.consent.length || furniture.shell.length) {
    process.stdout.write(`\n  ${furniture.consent.length} capture(s) opened on a COOKIE/CONSENT overlay and `
      + `${furniture.shell.length} on an unrendered SHELL and NEVER REACHED A HEADING — those read the `
      + "site's furniture, not its page, so any finding on them is about this tool.\n");
    for (const url of [...furniture.consent, ...furniture.shell].slice(0, 8)) {
      process.stdout.write(`    furniture: ${url.replace(/^https:\/\//, "")}\n`);
    }
  }
  process.stdout.write("\n  Read the evidence for each before doing anything else. It is one of three things:\n"
    + "    - the tool is wrong, and this is the defect class that ran for eleven separate causes;\n"
    + "    - the PAGE changed, since these are live sites their publishers keep editing;\n"
    + "    - the finding is right and the publisher's claim is not — which has happened, twice.\n"
    + "  Only the third takes `--update`.\n");
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

export { compare };
