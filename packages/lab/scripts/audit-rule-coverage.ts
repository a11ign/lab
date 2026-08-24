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
import { fileURLToPath, pathToFileURL } from "node:url";

import { ruleFindings } from "@a11y-witness/judge/rules";
// RULE_CRITERIA lives in coverage.ts and is imported by rules.ts, not re-exported from it. Taken from the
// source rather than the convenient neighbour: locally tsx resolves TypeScript and the mistake is silent,
// while the lab resolves `dist` and it is a hard failure — the stale-dist hazard, one door along.
import { RULE_CRITERIA, SCORED_CRITERIA } from "@a11y-witness/judge/coverage";
import { CRITERION_COVERAGE, channelsPresent } from "@a11y-witness/judge/internal";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORPUS = resolve(REPO, process.env.CAPTURE_ROOT || "runs/screenreader-dataset/captures");
const REAL = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
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
const RULE_ONLY = new Set(RULE_CRITERIA.filter((c) => !SCORED_CRITERIA.includes(c as never)));

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
    for (const finding of ruleFindings(capture as never)) {
      // `add()` in rules.ts refuses an unlisted criterion, so this cannot be undefined in practice.
      // Guarded anyway: an audit that throws on the evidence it is auditing tells you nothing.
      const row = fires.get(String(finding.wcag).split(" ")[0]);
      if (row) row[kind] += 1;
    }
  };
  for (const [kind, dir] of [["corpus", CORPUS], ["real", REAL]] as const) {
    for (const capture of capturesIn(dir)) {
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

function main(): void {
  const { fires, scanned, realChannels } = tally();
  if (scanned.corpus === 0 && scanned.real === 0) {
    process.stdout.write("\n  SKIPPED: no captures under runs/ — this audit needs a corpus to examine.\n"
      + "  That is an honest skip, not a pass. The lab holds the authoritative copy.\n");
    process.exitCode = 0;
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
