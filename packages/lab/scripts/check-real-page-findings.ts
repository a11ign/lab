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
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { ruleFindings } from "@a11y-witness/judge/rules";
import { corpusState } from "../src/training/corpus-settled.mjs";
import { domCensus, oracleCounts, pageCensus, censusTargetIsSuspect } from "@a11y-witness/evidence/verify";
import { realPageFor, REAL_PAGES } from "../src/training/real-page-corpus.mjs";
import { REPO_ROOT, realCorpusRoot } from "../src/dataset-paths.mjs";

const REPO = REPO_ROOT;
const REAL = realCorpusRoot();
const BASELINE = resolve(REPO, "packages/lab/baselines/real-page-findings.json");
const UPDATE = process.argv.includes("--update");
const ALLOW_PARTIAL = process.argv.includes("--allow-partial");

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
  return { ...(capture as object), ...oracleCounts(capture as never) } as never;
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

/**
 * The unnamed graphics by name, or nothing if this capture predates them.
 *
 * Silent when absent rather than printing "not recorded": every capture taken before the DOM census
 * learned to name them is in that state, and a line saying so on every historical row would be noise
 * about the corpus rather than news about the page.
 */
function unnamedGraphicLine(dom: { unnamedGraphics?: unknown; unnamedGraphicCount?: unknown } | null): string {
  const names = Array.isArray(dom?.unnamedGraphics) ? (dom.unnamedGraphics as string[]) : [];
  if (!names.length) return "";
  const total = typeof dom?.unnamedGraphicCount === "number" ? dom.unnamedGraphicCount : names.length;
  const more = total > names.length ? `, and ${total - names.length} more` : "";
  return `\n           unnamed graphics: ${names.join(", ")}${more}`;
}

/**
 * The pair verdict: either count alone is ambiguous, together they say whether a zero-heading tree is the
 * page rendering nothing, exposing nothing, or the two agreeing that neither happened.
 */
function domCensusVerdict(
  census: { heading?: number } | null, dom: { heading?: number } | null,
): string {
  if (!census || !dom || typeof dom.heading !== "number") return "";
  if (dom.heading > 0 && census.heading === 0) {
    return "  <- " + dom.heading + " headings in the DOM, 0 in the tree: the page EXPOSES nothing, which "
      + "is a finding about it, not about this tool";
  }
  if (dom.heading === 0 && census.heading === 0) {
    return "  <- no headings in the DOM either, so the page did not render — OUR defect, not theirs";
  }
  return "";
}

/**
 * The census half of the evidence line. Split out of `noteEvidence` purely to keep that function's
 * complexity under gate -- it is not a second concept, it is the same one written out.
 *
 * A SUSPECT CENSUS PRINTS AS SUSPECT, never as "no census recorded" — the two need opposite responses.
 * "not recorded" means an old capture predating the field; a suspect census is one this run actively
 * distrusts, and a report that cannot tell them apart is the "no census recorded" line lying by omission
 * about which of the two it is.
 */
function censusLine(
  census: { heading?: number; link?: number; graphic?: number; graphicUnnamed?: number } | null,
  dom: ReturnType<typeof domCensus>, target: { targetMatch?: string; candidates?: number } | null,
  lines: number,
): string {
  if (census) {
    return `census heading=${census.heading} link=${census.link} graphic=${census.graphic} `
      + `graphicUnnamed=${census.graphicUnnamed}; ${lines} announcement(s)`
      + (dom ? ` | DOM heading=${dom.heading} link=${dom.link} graphic=${dom.graphic}` : " | DOM not counted")
      // WHICH graphics carry no accessible name. `graphicUnnamed=2` sent me to fetch cqc.org.uk by hand
      // and count <svg> elements without a <title>; this is that step, done once, by the capture.
      + unnamedGraphicLine(dom)
      + domCensusVerdict(census, dom);
  }
  if (target && censusTargetIsSuspect(target)) {
    return `census UNUSABLE: targetMatch=${target.targetMatch ?? "?"} candidates=${target.candidates ?? "?"} `
      + "-- a real second CDP target existed and was never confirmed to be this page; "
      + `${lines} announcement(s) (the transcript is unaffected)`;
  }
  return `no census recorded; ${lines} announcement(s)`;
}

function noteEvidence(capture: { url?: string; transcript?: unknown; diagnostics?: unknown }): void {
  const census = pageCensus(capture as never);
  const dom = domCensus(capture as never);
  const target = rawTargetMatch(capture);
  if (target) TARGET_MATCH.set(String(capture.url), target);
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
  if (dom) DOM_CENSUS.set(String(capture.url), dom);
  const opening = openingLines.map((line) => JSON.stringify(line.slice(0, 60))).join(" ");
  EVIDENCE.set(String(capture.url),
    censusLine(census, dom, target, lines) + (opening ? `\n           opens: ${opening}` : ""));
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
/**
 * Write the baseline, unless doing so would erase what we already know. Returns the exit code.
 *
 * Its own function because `main` crossed the physical-line budget the moment the refusal went in, and
 * `function-size.test.ts` caught it — the budget doing exactly its job, since deciding whether a write is
 * safe and orchestrating the run are two different things.
 */
function updateBaseline(current: Record<string, string[]>, pages: number): number {
  const stale = staleBaselineKeys(current, readBaseline());
  if (stale.length) {
    process.stdout.write(`\n  ${stale.length} baseline key(s) name a URL the corpus no longer declares — `
      + "dropping them,\n  because the page was renamed or removed on purpose and the old address is the "
      + "stale record:\n");
    for (const url of stale) process.stdout.write(`    ${url.replace(/^https:\/\//, "")}\n`);
  }
  const dropped = pagesTheUpdateWouldDrop(current, readBaseline());
  if (dropped.length && !ALLOW_PARTIAL) {
    refuseToWriteFromPartialCoverage(dropped);
    return 2;
  }
  if (dropped.length) {
    process.stdout.write(`\n  --allow-partial: dropping ${dropped.length} baseline entr(y/ies) on purpose.\n`);
    for (const { url, findings } of dropped) {
      process.stdout.write(`    dropping ${url.replace(/^https:\/\//, "")} ${JSON.stringify(findings)}\n`);
    }
  }
  writeBaseline(current);
  const total = Object.values(current).reduce((n, list) => n + list.length, 0);
  process.stdout.write(`\n  Baseline updated: ${total} finding(s) across ${pages} conformant real page(s).\n`
    + "  Every one of these is now asserted to be CORRECT. Review before committing.\n");
  return 0;
}

/**
 * Baseline entries this update would ERASE, because the page behind them was not captured this run.
 *
 * `--update` wrote `currentFindings()` straight over the file, so the baseline silently became "whatever
 * happened to be on disk". A run that captured one ROLE therefore deleted every entry belonging to the
 * other — and `capture-real-pages` DEFAULTS to `--role=training`, so `--pipeline=real-pages` does exactly
 * that: it captures 39 of 89 pages and then scores and rewrites against all of them.
 *
 * Measured 2026-08-27, by doing it: a calibration-only capture followed by `--update` took the baseline
 * from 85 pages to 81 and erased `events.bl.uk`'s known 2.4.3. Nothing said so. The next capture of those
 * pages would then report their findings as NEW and refuse a promotion, which reads as a regression and
 * is this file rewriting its own memory.
 *
 * **A count of what is present cannot see what is missing**, which is why this compares against the
 * BASELINE rather than against the corpus definition: a page absent from both disk and the baseline is
 * new and unremarkable, while a page the baseline knows and disk does not is memory loss.
 *
 * The idiom is this repo's own — `training:check-signals:complete` refuses a partial corpus rather than
 * scoring what happens to be on disk, and `evidence:check` returns INCONCLUSIVE on PARTIAL coverage
 * rather than only on zero. A claim written from evidence we do not have is worse than no claim.
 */
export function pagesTheUpdateWouldDrop(
  current: Record<string, string[]>,
  baseline: Record<string, string[]> | null,
): Array<{ url: string; findings: string[] }> {
  if (!baseline) return [];
  return Object.entries(baseline)
    .filter(([url]) => !(url in current))
    // A URL THE CORPUS NO LONGER DECLARES IS NOT MEMORY LOSS, and conflating the two made this guard
    // refuse the very run it was built to let through.
    //
    // Two ways a baseline key can be absent from a fresh scoring, and they are opposites. The page is
    // still in `REAL_PAGES` and simply was not captured — that is partial coverage, and writing now
    // erases what we know. Or the corpus no longer lists that URL at all, because it was RENAMED or
    // removed on purpose: `www.bl.uk/whats-on/` became `events.bl.uk/`, and its 2.4.3 reappeared under
    // the new address on the very next run. Keeping the old key would be the memory loss, not dropping it.
    //
    // Measured 2026-08-27: five baseline keys were stale URLs corrected earlier the same day, and a guard
    // that could not tell them from uncaptured pages would have forced `--allow-partial` on a complete
    // run — which is how an escape hatch becomes the normal path and stops meaning anything.
    .filter(([url]) => REAL_PAGES.some((page) => page.url === url))
    .map(([url, findings]) => ({ url, findings: findings as string[] }));
}

/** Baseline keys the corpus no longer declares — reported, never refused. */
export function staleBaselineKeys(
  current: Record<string, string[]>,
  baseline: Record<string, string[]> | null,
): string[] {
  if (!baseline) return [];
  return Object.keys(baseline)
    .filter((url) => !(url in current) && !REAL_PAGES.some((page) => page.url === url));
}

/** Say which pages, which findings, and the one command that fixes it. */
function refuseToWriteFromPartialCoverage(dropped: Array<{ url: string; findings: string[] }>): void {
  const roles = [...new Set(dropped
    .map(({ url }) => REAL_PAGES.find((page) => page.url === url)?.role ?? "no longer in the corpus"))];
  process.stdout.write(`\n  REFUSING to update: ${dropped.length} page(s) in the baseline were not captured `
    + "this run,\n  so writing now would erase what we know about them.\n\n");
  for (const { url, findings } of dropped.slice(0, 10)) {
    const role = REAL_PAGES.find((page) => page.url === url)?.role ?? "not in the corpus";
    process.stdout.write(`    ${url.replace(/^https:\/\//, "")}\n`
      + `      baseline holds ${JSON.stringify(findings)}, role=${role}\n`);
  }
  if (dropped.length > 10) process.stdout.write(`    ... and ${dropped.length - 10} more\n`);
  process.stdout.write("\n  Capture them first — `capture-real-pages` DEFAULTS to --role=training, so a run\n"
    + `  that named one role has only that one. Missing role(s): ${roles.join(", ")}.\n`
    + "    npm run lab:pipeline -- --pipeline=real-pages     # captures EVERY role, then updates\n\n"
    + "  If the baseline should genuinely shrink — a page removed from the corpus on purpose —\n"
    + "  `--allow-partial` says so out loud and names every entry it drops.\n");
}

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
    // AND THE DOM HAS TO AGREE, or this bucket accuses the tool of the page's defect.
    //
    // The tree alone cannot tell "we read a shell" from "the page exposes nothing", and until the DOM was
    // counted it was the only signal available — so every zero-heading capture was filed as furniture and
    // the report said "anything they say is about this tool". Measured 2026-08-27 on the Met Office
    // warnings page: `census heading=0` against `DOM heading=55, link=281`. The page rendered in full and
    // exposed none of it, which is a finding about the page, and this function was calling it ours.
    //
    // Worse than merely wrong: `noteEvidence` had ALREADY computed the correct verdict and printed it on
    // the very next line, so the report contradicted itself in adjacent sentences — the headline excusing
    // the page while the evidence beneath convicted it. A remedy that reaches one consumer and not the
    // one that CLASSIFIES is this repo's most expensive recurring shape, committed inside the report
    // written to expose it.
    //
    // An UNCOUNTED DOM stays furniture. That is the conservative direction: an older capture carrying no
    // DOM census cannot demonstrate the page rendered, and claiming a finding on evidence we do not have
    // is the one error this report must never make.
    const domHeadings = DOM_CENSUS.get(url)?.heading;
    if (typeof domHeadings === "number" && domHeadings > 0) continue;
    const text = opening.join(" ").toLowerCase();
    if (/cookie|consent|privacy preference|usercentrics|onetrust/.test(text)) consent.push(url);
    else if (opening[0]?.trim().toLowerCase() === "blank") shell.push(url);
  }
  return { consent, shell };
}

/** url -> its census, so the summary can ask whether a capture ever reached the page. */
const CENSUS = new Map<string, { heading?: number }>();

/**
 * url -> the CDP target diagnostic straight off the RAW mark, never through `pageCensus`/`domCensus`.
 *
 * Those two now return `null` for a suspect census — correctly, so no rule is handed a different
 * document's numbers — which means the very thing this report needs to SHOW is exactly what they hide.
 * This is the one place that has to see it anyway: a furniture check that cannot say "this census is not
 * this page's" cannot say anything about it at all, and `docs/backlog.md`'s row is what asked for it.
 */
const TARGET_MATCH = new Map<string, { targetMatch?: string; candidates?: number }>();

/** The `structureCensus` mark's target diagnostic, read directly rather than through a nulling reader. */
function rawTargetMatch(capture: { diagnostics?: unknown }): { targetMatch?: string; candidates?: number } | null {
  const marks = Array.isArray(capture.diagnostics) ? capture.diagnostics : [];
  for (const mark of marks) {
    if (typeof mark !== "object" || mark === null) continue;
    const record = mark as { event?: unknown; targetMatch?: unknown; candidates?: unknown };
    if (record.event !== "structureCensus") continue;
    return {
      targetMatch: typeof record.targetMatch === "string" ? record.targetMatch : undefined,
      candidates: typeof record.candidates === "number" ? record.candidates : undefined,
    };
  }
  return null;
}

/**
 * Captures whose census could not be vouched for — a real second CDP target existed (or nothing was ever
 * recorded to compare against) and neither was confirmed to be the page this capture navigated to.
 *
 * THE SAME RULE `pageCensus`/`domCensus` APPLY, asked of the raw mark instead of a nulled reader —
 * `censusTargetIsSuspect` is imported rather than restated, because a second copy of "is this trustworthy"
 * is exactly the shape that let `3.3.2:unnamed-form-field` survive its own deletion twice.
 *
 * Distinct from `furnitureCaptures()`: furniture is a page NVDA never reached at all (zero headings, DOM
 * agrees), so every criterion on it is blind. A suspect census is narrower and stranger — the TRANSCRIPT is
 * fine, `bathingwaters.sepa.org.uk` and `lbhf.gov.uk/council-tax` both proved it — only the AX-tree/DOM
 * counts are alien, so only the census-reading criteria (1.3.1:no-headings, 2.1.2's tabbable denominator,
 * 3.1.2's partLangCount, 2.4.1) go blind on it. Reported and reduced from coverage anyway, at the PAGE
 * level, for the same reason `furnitureCaptures()` already makes that simplification: a per-criterion
 * coverage model is not what this gate needs to solve to stop treating a wrong document as a clean one.
 */
function suspectCensusCaptures(): string[] {
  const suspect: string[] = [];
  for (const [url, target] of TARGET_MATCH) {
    if (censusTargetIsSuspect(target)) suspect.push(url);
  }
  return suspect;
}

/**
 * url -> what the DOM actually contained, which is the other half of that question.
 *
 * Recorded separately from `CENSUS` because they answer different things and the difference IS the
 * verdict: the tree is what a screen reader can reach, the DOM is what the page put there.
 */
const DOM_CENSUS = new Map<string, { heading?: number }>();

/** url -> its opening announcements, kept so the summary above can be computed without a second read. */
const OPENINGS = new Map<string, string[]>();

/**
 * Report what changed against the baseline, and derive the verdict from what was actually READABLE.
 *
 * Split from `main` for the line budget, and it is a real phase rather than a slice taken to satisfy it:
 * everything above decides WHAT to compare, and everything here decides what that comparison is worth.
 */
function reportAgainstBaseline({ added, pages }: { added: Change[]; pages: number }): void {
  const furniture = furnitureCaptures();
  if (furniture.consent.length || furniture.shell.length) {
    process.stdout.write(`\n  ${furniture.consent.length} capture(s) opened on a COOKIE/CONSENT overlay `
      + `and ${furniture.shell.length} on an unrendered SHELL, and NEVER REACHED A HEADING — those read `
      + "the site's furniture, not its page, so anything they say is about this tool.\n");
    for (const url of [...furniture.consent, ...furniture.shell].slice(0, 8)) {
      process.stdout.write(`    furniture: ${url.replace(/^https:\/\//, "")}\n`);
      process.stdout.write(`           ${describeEvidence(url)}\n`);
    }
  }

  // THE OTHER SHAPE: not furniture (NVDA reached the page fine), but the CENSUS did not. Named separately
  // from furniture on purpose -- see `suspectCensusCaptures`'s own comment -- because the two need
  // different remedies: a furniture capture wants a longer wait or the banner clicked through; a suspect
  // census wants `choosePageTarget` to see a real second target, which no amount of waiting fixes.
  const suspectCensus = suspectCensusCaptures();
  if (suspectCensus.length) {
    process.stdout.write(`\n  ${suspectCensus.length} capture(s) have a census this run does not trust: a `
      + "real second CDP target existed and none was confirmed to be the page navigated to. The census "
      + "reads as ABSENT to every rule rather than as this OTHER document's numbers; the transcript is "
      + "unaffected.\n");
    for (const url of suspectCensus.slice(0, 8)) {
      process.stdout.write(`    suspect census: ${url.replace(/^https:\/\//, "")}\n`);
      process.stdout.write(`           ${describeEvidence(url)}\n`);
    }
  }

  if (added.length) {
    process.stdout.write(`\n  ${added.length} NEW finding(s) on pages whose publisher declares them `
      + "conformant:\n");
  }
  for (const change of added) {
    process.stdout.write(`    ${change.criterion}  ${change.url.replace(/^https:\/\//, "")}\n`);
    // THE EVIDENCE, not just the URL. This told the reader to "read the evidence for each" and then gave
    // them a list of URLs — so reading it meant an ssh session and ad-hoc JSON, which is the step this
    // repo removes everywhere else. The census is the whole basis of the two rules most likely to appear
    // here, and it also settles the question a bare count cannot: a census reading zero for EVERYTHING is
    // a tree that was never built, which is not the same finding as a page that genuinely has none.
    process.stdout.write(`           ${describeEvidence(change.url)}\n`);
  }
  if (added.length) {
    process.stdout.write("\n  Read the evidence for each before doing anything else. It is one of three "
      + "things:\n"
      + "    - the tool is wrong, and this is the defect class that ran for eleven separate causes;\n"
      + "    - the PAGE changed, since these are live sites their publishers keep editing;\n"
      + "    - the finding is right and the publisher's claim is not — which has happened, twice.\n"
      + "  Only the third takes `--update`.\n");
  }

  // A FURNITURE CAPTURE IS NOT AN EXAMINED PAGE, and until now it did not reduce anything. This gate
  // already DETECTS them — captures that opened on a cookie overlay or an unrendered shell and never
  // reached a heading — and says outright that "anything they say is about this tool". Then it reported
  // `PASS — no conformant page gained a finding` regardless of how many there were.
  //
  // So a run where most of the sample read a consent banner passed. CLAUDE.md records the same confusion
  // as a metric that "merged 'has a cookie banner' with 'never got past one'"; this is that merge inside a
  // gate. They now reduce COVERAGE, so the verdict is INCONCLUSIVE rather than a pass — determinism-plan D6.
  //
  // A SUSPECT CENSUS REDUCES COVERAGE THE SAME WAY, at the same page-level granularity -- see
  // `suspectCensusCaptures`'s own comment for why that over-counts slightly (only the census-reading
  // criteria are actually blind, not the transcript-based ones) and why that is the right simplification
  // for this gate rather than a defect in it.
  const unusable = furniture.consent.length + furniture.shell.length + suspectCensus.length;
  const verdict = gateVerdict({
    examined: pages - unusable,
    of: pages,
    source: "conformant real pages scored against the baseline",
    failures: added.length,
  });
  process.stdout.write(`\n  ${renderVerdict(verdict)}\n`);
  process.exitCode = exitCodeFor(verdict);
}

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
    process.exitCode = updateBaseline(current, pages);
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
  // REPORTED WHETHER OR NOT ANYTHING FAILED, and it used to print only alongside findings. A capture
  // that read the site's furniture instead of its page is a defect regardless: if it matches a baseline
  // entry made from an equally bad capture, the gate says PASS and the corpus quietly holds evidence of
  // a cookie banner. A bad capture that reproduces itself looks exactly like stability.
  reportAgainstBaseline({ added, pages });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

export { compare };
