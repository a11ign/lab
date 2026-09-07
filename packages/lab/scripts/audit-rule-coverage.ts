/**
 * Which rules have EVER fired, and on what kind of evidence?
 *
 * ## Why this exists
 *
 * The dominant defect class in this project is not incorrect code, it is UNEXECUTED code. A rule that
 * returns early on every capture it has ever seen has never had its assumptions checked by anything, and
 * every gate reports it as covered because a gate counts findings and it produced none to be wrong about.
 *
 * Measured 2026-08-24, and the reason this file exists: `MAX_TAB_STOPS` was 12 while real pages carry a
 * median of 79 focusable elements, so `addKeyboardUnreachableControl` — which refuses to claim anything
 * unless the tab cycle closes — could never close one, and `addBrokenFocusOrder` found fewer than two
 * shared names and returned early. Both had been inert for the life of the corpus. Raising the cap ran
 * them for the first time and **both were wrong immediately**: 2.1.1 reported keyboard-unreachable
 * controls on 23 of 35 conformant real pages, 2.4.3 on 19. Neither regressed. Both were wrong all along
 * and silent, and `criterion-coverage.ts` listed them as assessed the whole time.
 *
 * This audit is the general form of that. It would have named them both in the morning.
 *
 * ## What it blocks on, and what it merely reports
 *
 * A criterion this project CLAIMS (`assessed` or `partial`) and has never demonstrated is a blocker,
 * because the claim is the product's own coverage statement. Two grades:
 *
 *   - never fired ANYWHERE — the rule has never executed. The claim rests on nothing.
 *   - never fired on a REAL page — the rule has only ever run against a corpus built from the same
 *     assumptions as the rule. That is the exact condition under which 2.1.1 and 2.4.3 looked fine.
 *
 * A criterion whose evidence is structurally unavailable on real pages declares it in
 * `realPageEvidence`, with a reason, and is exempt from the second grade only. 3.3.1 and 4.1.3 are the
 * real cases: the form probe is off for pages we do not own. Prose in `note` cannot carry that, because
 * a check cannot tell a documented impossibility from an undocumented oversight.
 *
 *   npm run rules:coverage
 *   npm run rules:coverage -- --json
 *
 * Needs `runs/`, so it SKIPS HONESTLY where the corpus is absent rather than passing quietly — the same
 * contract `verify.corpus.test.ts` has, and for the same reason: a check that reports success having
 * examined nothing is how "verified" comes to mean "unexamined".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

import { ruleFindings } from "@a11y-witness/judge/rules";
import { oracleCounts } from "@a11y-witness/evidence/verify";
// RULE_CRITERIA lives in coverage.ts and is imported by rules.ts, not re-exported from it. Taken from the
// source rather than the convenient neighbour: locally tsx resolves TypeScript and the mistake is silent,
// while the lab resolves `dist` and it is a hard failure — the stale-dist hazard, one door along.
import { RULE_CRITERIA, SCORED_CRITERIA } from "@a11y-witness/judge/coverage";
import { corpusState, minutesSinceLastWrite } from "../src/training/corpus-settled.mjs";
import { CRITERION_COVERAGE, channelsPresent } from "@a11y-witness/judge/internal";
import { REPO_ROOT, datasetRoot, captureRoot, realCorpusRoot } from "../src/dataset-paths.mjs";

const REPO = REPO_ROOT;
// `CAPTURE_ROOT` was a second env-var name for the same thing `DATASET_CAPTURE_ROOT`/`DATASET_ROOT`
// already cover -- see `audit-size-sensitivity.mjs`, which read the identical line.
const CORPUS = captureRoot(datasetRoot());
const REAL = realCorpusRoot();
/**
 * The eval fixtures, which hold captures of REAL websites and were never counted as such.
 *
 * `2.4.4` reported `68x on the corpus, 0x on a real page — assumptions untested` for as long as this audit
 * has existed, and `docs/known-gaps.md` recorded the fix as "a real page that exhibits it". It was already
 * fixed. `nvda-w3c-bad-before.json` is a capture of `w3.org/WAI/demos/bad/before/home.html`, it carries
 * `"Click here, link"`, and the rule fires on it — verified offline, in milliseconds, before this constant
 * was added.
 *
 * So the rule was validated on real evidence and the audit could not see it, because "real" meant ONE
 * DIRECTORY. That is this repo's most-repeated defect in its usual costume: a number bounded to a
 * population that excludes the evidence, reported as absence. `1.3.1` reached the same state by the
 * exporter stripping the census, and the lesson recorded then was that "the rule never fired" and "the
 * rule never had its evidence" are different answers — this adds a third, "the rule fired where nobody
 * counted".
 */
const EVAL_FIXTURES = resolve(REPO, "packages/lab/src/eval/fixtures/nvda");

/**
 * Is this capture of a page out on the web, rather than one we generated?
 *
 * Keyed on the URL and never on the directory, for the reason `capturesIn` already gives about filenames:
 * a directory convention is a second thing to keep in step. `fixtures/tutorials` and `fixtures/books` sit
 * beside the real ones and are authored pages and local files — same class as the corpus, and counting
 * them as real evidence would be the opposite error to the one this fixes.
 *
 * The local page server is excluded by the same test: `<the lab's address>:5050` serves OUR pages over http, so
 * a scheme check alone would admit them.
 */
function isRealPage(capture: unknown): boolean {
  const raw = (capture as { url?: unknown }).url;
  if (typeof raw !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false; // "tutorial: forms-bad (authored from W3C guidance)" — not a URL, and says so
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return !LOCAL_HOST.test(parsed.hostname);
}

/** Loopback, link-local and the RFC1918 ranges the lab and page server live on. */
const LOCAL_HOST = /^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const JSON_OUT = process.argv.includes("--json");

type Tally = { corpus: number; real: number };

/** Claims the product makes about itself. `reachable` and `out-of-scope` claim nothing, so they cannot lie. */
const CLAIMED = new Set(["assessed", "partial"]);

/**
 * Criteria NOTHING else covers, so an unvalidated rule leaves them uncovered outright.
 *
 * `CRITERION_COVERAGE` describes a CRITERION — both layers — while this audit measures whether a RULE
 * fired. Conflating the two makes the audit block on something correct: 1.3.1's rule catches only the
 * no-headings-at-all mode and has never fired, but the scorer has heads for `1.3.1:fake-heading` and
 * `1.3.1:unassociated-table`, so the criterion is genuinely assessed and the coverage claim is true.
 *
 * For a rule-only criterion there is no second layer to carry it, so "the rule never fired" and "the
 * criterion is not assessed" are the same statement. Those block; the rest are reported, because an
 * unvalidated rule is still worth naming even when something else covers its criterion.
 */
// `ReadonlySet<string>` deliberately: inference narrows this to a union of the eleven criterion literals,
// so every `RULE_ONLY.has(someCriterion)` where the criterion is a plain string is a type error — and
// those errors were invisible because `packages/*/scripts` was outside the typecheck entirely.
const RULE_ONLY: ReadonlySet<string> = new Set(
  RULE_CRITERIA.filter((c) => !SCORED_CRITERIA.includes(c as never)));

/**
 * How recently a capture file was written, in minutes, or null when the directory is empty.
 *
 * A corpus being recaptured is a MOVING TARGET, and a number measured against one describes a state that
 * no longer exists by the time it is read. On 2026-08-24 this was not hypothetical: coverage and error
 * rates were reported from a 38-page corpus while a 50-page recapture was overwriting the same files, so
 * every figure quoted was already stale — the very "measured against something that does not match"
 * defect this audit exists to catch, committed by the person running the audit.
 *
 * Deliberately a file-mtime check rather than asking systemd whether a job is running: the question is
 * whether this EVIDENCE is settled, not whether a particular unit happens to be up, and a corpus can be
 * mid-write from a run nobody remembers starting.
 */
// The scanner itself now lives in `corpus-settled.mjs` beside the decision that uses it — this file's
// copy and `check-real-page-findings.ts`'s had already drifted apart in signature.

// `SETTLED_AFTER_MINUTES` now lives in `corpus-settled.mjs`, with the check that uses it — one copy, and
// only as the fallback for a corpus carrying no progress file.

function capturesIn(dir: string): unknown[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    try {
      if (statSync(path).isDirectory()) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { capture?: unknown };
      const capture = (parsed.capture ?? parsed) as { transcript?: unknown };
      // These directories hold manifests and progress files beside the captures. A capture is identified
      // by SHAPE rather than by filename, because a name convention is a second thing to keep in step.
      if (!Array.isArray(capture.transcript)) continue;
      out.push(capture);
    } catch {
      // A capture that will not parse is not this audit's business; `verify.corpus.test.ts` owns that.
      continue;
    }
  }
  return out;
}

function tally(): { fires: Map<string, Tally>; scanned: Tally; realChannels: Set<string> } {
  const fires = new Map<string, Tally>(RULE_CRITERIA.map((c) => [c, { corpus: 0, real: 0 }]));
  const scanned: Tally = { corpus: 0, real: 0 };
  // Which evidence channels any real capture actually carried. A rule whose channel is absent everywhere
  // did not stay SILENT on real pages — it had nothing to read, and those are different verdicts needing
  // different work: find a page that exhibits the failure, versus collect the evidence at all.
  const realChannels = new Set<string>();
  const noteChannels = (capture: unknown): void => {
    for (const channel of channelsPresent(capture as never)) realChannels.add(channel);
  };
  const record = (kind: "corpus" | "real", capture: unknown): void => {
    for (const finding of ruleFindings(withCensus(capture))) {
      // `add()` in rules.ts refuses an unlisted criterion, so this cannot be undefined in practice.
      // Guarded anyway: an audit that throws on the evidence it is auditing tells you nothing.
      const row = fires.get(String(finding.wcag).split(" ")[0]);
      if (row) row[kind] += 1;
    }
  };
  // Three sources, two populations. The eval fixtures hold captures of real websites BESIDE authored ones,
  // so the directory cannot decide the kind and `isRealPage` reads the capture's own URL instead. A
  // fixture that is not of a real page is skipped entirely rather than counted as corpus: it is neither,
  // and inflating the corpus count would misstate what the left-hand column was computed from.
  const sources = [
    { kind: "corpus" as const, dir: CORPUS, realOnly: false },
    { kind: "real" as const, dir: REAL, realOnly: false },
    { kind: "real" as const, dir: EVAL_FIXTURES, realOnly: true },
  ];
  for (const { kind, dir, realOnly } of sources) {
    for (const capture of capturesIn(dir)) {
      if (realOnly && !isRealPage(capture)) continue;
      scanned[kind] += 1;
      record(kind, capture);
      if (kind === "real") noteChannels(capture);
    }
  }
  return { fires, scanned, realChannels };
}

type Verdict = {
  criterion: string; status: string; corpus: number; real: number;
  grade: "unproven" | "corpus-only" | "declared-unavailable" | "no-channel" | "validated";
  because?: string;
};

function grade(criterion: string, count: Tally, realChannels: Set<string>): Verdict {
  const declared = CRITERION_COVERAGE[criterion];
  const status = declared?.status ?? "undeclared";
  const base = { criterion, status, corpus: count.corpus, real: count.real };
  if (count.real > 0) return { ...base, grade: "validated" };
  if (declared?.realPageEvidence?.available === false) {
    return { ...base, grade: "declared-unavailable", because: declared.realPageEvidence.because };
  }
  // NOTHING TO READ is not the same as NOTHING TO SAY. If not one real capture carries any channel this
  // criterion is decided from, the rule never got the chance to be wrong — reporting that as "assumptions
  // untested" would be true but useless, because it points at finding a better page when the work is
  // collecting the evidence at all. 1.4.2 reads DOM media attributes and 76 of 77 real captures carry an
  // empty media list: no public-body information page autoplays sound.
  const channels = declared?.channels ?? [];
  const exercised = channels.some((c) => realChannels.has(c));
  if (channels.length && !exercised) {
    return { ...base, grade: "no-channel",
      because: `no real capture carries ${channels.join(" or ")} — the evidence this rule reads was `
        + "never collected, so it has not been silent, it has been unasked" };
  }
  return {
    ...base,
    grade: count.corpus === 0 ? "unproven" : "corpus-only",
    // EXERCISED AND SILENT is not the same as NEVER RUN, and the remedy differs. If real captures carry
    // the channel, the rule read them and found nothing — which on a conformant page is the CORRECT
    // outcome and weak evidence it does not false-positive. The work is then finding a page that
    // actually exhibits the failure, not collecting evidence.
    //
    // Deliberately not treated as validation. "A head that has gone silent scores perfect precision" is
    // this project's most expensive lesson, and a broken rule is silent on conformant pages too.
    because: exercised
      ? `its evidence channel IS present on real captures, so it ran and stayed silent — which on a `
        + "conformant page is the right answer. What is missing is a real page that exhibits the failure"
      : undefined,
  };
}

/**
 * How many real-page captures a complete corpus holds today.
 *
 * `runs/` is gitignored, so a developer's copy is only ever as fresh as its last sync — and a PARTIAL copy
 * produces exactly the wrong answer here: fewer captures means fewer fires, so a rule that is validated on
 * the lab reads as "never fired anywhere" on a laptop. That is a false blocker, and a check that cries
 * wolf gets switched off.
 *
 * So a short corpus reports INCONCLUSIVE and names where the authoritative answer lives, exactly as
 * `rules:gate` does. Not a pass: "this copy cannot tell" and "nothing is wrong" are different answers.
 */
const EXPECTED_REAL_CAPTURES = 60;

function report(verdicts: Verdict[], scanned: Tally): number {
  const unvalidated = verdicts.filter((v) => CLAIMED.has(v.status)
    && (v.grade === "unproven" || v.grade === "corpus-only" || v.grade === "no-channel"));
  const blocking = unvalidated.filter((v) => RULE_ONLY.has(v.criterion));
  const alsoScored = unvalidated.filter((v) => !RULE_ONLY.has(v.criterion));

  process.stdout.write(`\n  Rule coverage — what has actually FIRED, over ${scanned.corpus} corpus and `
    + `${scanned.real} real capture(s)\n\n`);
  process.stdout.write("  criterion  claimed    corpus     real   verdict\n");
  for (const v of [...verdicts].sort((a, b) => a.criterion.localeCompare(b.criterion))) {
    const label = {
      unproven: "NEVER FIRED ANYWHERE — the claim rests on nothing",
      "corpus-only": "never on a REAL page — assumptions untested",
      "declared-unavailable": "no real-page evidence possible, declared",
      "no-channel": "its evidence channel is absent from EVERY real capture",
      validated: "validated on real evidence",
    }[v.grade];
    process.stdout.write(`  ${v.criterion.padEnd(10)} ${v.status.padEnd(9)} `
      + `${String(v.corpus).padStart(6)} ${String(v.real).padStart(8)}   ${label}\n`);
  }

  if (alsoScored.length) {
    process.stdout.write(`\n  ${alsoScored.length} rule(s) unvalidated on a real page whose criterion the `
      + "TRAINED SCORER also covers, so the criterion is not left uncovered:\n");
    for (const v of alsoScored) {
      process.stdout.write(`    ${v.criterion} — rule fired ${v.corpus}x on the corpus, ${v.real}x on a `
        + "real page. Reported, not blocking.\n");
    }
  }

  if (!blocking.length) {
    process.stdout.write("\n  PASS — every RULE-ONLY criterion has fired on a real page, or declares why "
      + "it cannot. Nothing this project claims rests solely on an untested rule.\n");
    return 0;
  }

  if (scanned.real < EXPECTED_REAL_CAPTURES) {
    process.stdout.write(`\n  INCONCLUSIVE — this copy of runs/ holds ${scanned.real} real-page capture(s), `
      + `below the ${EXPECTED_REAL_CAPTURES} a complete corpus carries.\n  Fewer captures means fewer `
      + "fires, so the verdicts above understate coverage and cannot be acted on.\n  This is NOT a pass. "
      + "The authoritative answer is `npm run lab:job -- -e job=rules-coverage`.\n");
    return 2;
  }

  process.stdout.write(`\n  ${blocking.length} RULE-ONLY criterion(a) claimed but never demonstrated on a `
    + "real page — nothing else covers these:\n");
  for (const v of blocking) {
    process.stdout.write(`    ${v.criterion} (${v.status}) — `
      + (v.grade === "no-channel"
        ? `${v.because}.\n`
        : v.grade === "unproven"
        ? "has never fired on ANY capture. A rule that never executes is an untested assumption with a "
          + "criterion number.\n"
        : `fired ${v.corpus}x on the corpus and never on a real page. The corpus is built from the same `
          + `assumptions as the rule, so it cannot falsify them.${v.because ? ` — ${v.because}` : ""}\n`));
  }
  process.stdout.write("\n  Close one by capturing a real page that exercises it, by downgrading the claim "
    + "in `criterion-coverage.ts`,\n  or — where the evidence genuinely cannot exist on a page we do not "
    + "own — by declaring `realPageEvidence` with a reason.\n");
  return 1;
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

function main(): void {
  const { fires, scanned, realChannels } = tally();
  if (scanned.corpus === 0 && scanned.real === 0) {
    process.stdout.write("\n  SKIPPED: no captures under runs/ — this audit needs a corpus to examine.\n"
      + "  That is an honest skip, not a pass. The lab holds the authoritative copy.\n");
    process.exitCode = 0;
    return;
  }
  // ASKED, not inferred from file age. See `corpus-settled.mjs`: the run records `finishedAt` itself, and
  // a clean finish thirty seconds ago is settled however new the files are.
  const settle = corpusState({
    datasetRoots: [resolve(CORPUS, "..")],
    evidenceDirs: [CORPUS, REAL],
    minutesSinceLastWrite,
  });
  if (settle.blocking) {
    process.stdout.write(`\n  ${settle.state === "abandoned" ? "ABANDONED RUN" : "IN FLUX"} — ${settle.why}.\n`
      + "  This is NOT a pass and NOT a failure; it is a refusal to measure a moving target.\n");
    process.exitCode = 2;
    return;
  }
  const verdicts = RULE_CRITERIA.map((c) => grade(c, fires.get(c) ?? { corpus: 0, real: 0 }, realChannels));
  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ scanned, verdicts }, null, 2)}\n`);
    process.exitCode = verdicts.some((v) => CLAIMED.has(v.status) && RULE_ONLY.has(v.criterion)
      && (v.grade === "unproven" || v.grade === "corpus-only" || v.grade === "no-channel")) ? 1 : 0;
    return;
  }
  process.exitCode = report(verdicts, scanned);
}

// Guarded, so importing this module cannot walk 3,200 captures as a side effect — and so
// `node -e "import(...)"` stays a usable check that the file still loads.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

export { grade, EXPECTED_REAL_CAPTURES };
