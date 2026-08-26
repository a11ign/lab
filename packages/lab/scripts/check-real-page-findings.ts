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
import { pageCensus } from "@a11y-witness/evidence/verify";
import { realPageFor } from "../src/training/real-page-corpus.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REAL = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
const BASELINE = resolve(REPO, "packages/lab/baselines/real-page-findings.json");
const UPDATE = process.argv.includes("--update");

/** Below this the corpus is being recaptured and every count describes a state that is already gone. */
const SETTLED_AFTER_MINUTES = 10;

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
    const criteria = [...new Set(ruleFindings(withCensus(capture))
      .map((finding) => String(finding.wcag).split(" ")[0]))].sort();
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

function main(): void {
  const idle = minutesSinceLastWrite(REAL);
  if (idle !== null && idle < SETTLED_AFTER_MINUTES) {
    process.stdout.write(`\n  IN FLUX — a capture was written ${idle.toFixed(1)} minute(s) ago. Every count\n`
      + "  below describes a state that will have changed by the time you read it. Wait for the run.\n"
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
