/**
 * A fixture pair proves nothing if its evidence channel never reached either capture.
 *
 * `docs/fixture-pair-proof-audit.md` is the full audit this closes. In short: the acceptance the
 * good-sibling commit stated — "the good half produces no finding for its sibling's criterion" — is
 * necessary and not sufficient. A good half whose relevant probe never ran, or whose evidence channel came
 * back empty for an unrelated reason (a consent banner, a wrong CDP target), produces no finding for the
 * same reason a stopped clock is right twice a day. That is the BLIND state `check-signals` already
 * refuses for the synthetic corpus; nothing did the equivalent for these five real-page pairs.
 *
 * This reads both captures of each pair from `runs/real-page-corpus/` and asserts the three things that
 * actually make a pair mean something:
 *
 *   1. the criterion's declared evidence channel (`CRITERION_COVERAGE[criterion].channels`) reached BOTH
 *      captures — neither is BLIND;
 *   2. the bad half still contains the criterion — the rule has not gone deaf on its own fixture;
 *   3. the good half does not — the rule does not accuse its own conformant sibling.
 *
 * DERIVED from `REAL_PAGES`, never a second hand-written list of the five pairs — that is the exact shape
 * `real-page-corpus.test.ts`'s own `caseOf` helper already uses for pairing, reused rather than restated.
 *
 * Neither `rules:real-pages` nor `rules:coverage` closes this per pair (see the audit): the first skips
 * every non-conformant half outright and only diffs a whole-page baseline; the second validates a
 * criterion the moment ANY real capture anywhere fires it, which 2.1.1 in particular has a documented
 * history of doing on unrelated conformant pages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ruleFindings } from "@a11y-witness/judge/rules";
import { channelsPresent, CRITERION_COVERAGE } from "@a11y-witness/judge/internal";
import { oracleCounts } from "@a11y-witness/evidence/verify";
import { REAL_PAGES } from "./real-page-corpus.mjs";
import { realCorpusRoot } from "../dataset-paths.mjs";

/** Same derivation `real-page-corpus.test.ts` uses to pair a fixture with its sibling. */
function caseOf(url: string): string {
  return url.replace(/\/(good|bad)\.html$/, "");
}

interface Pair { id: string; criterion: string; badUrl: string; goodUrl: string }

/**
 * The five (or more) pairs, derived from `REAL_PAGES` rather than named here — a hand-written list is the
 * second copy this repo has paid for before. A fixture with no sibling (there is none today; a bad-only
 * fixture would simply not appear here) is `real-page-corpus.test.ts`'s own gap to enforce, not this one's.
 */
function fixturePairs(): Pair[] {
  const fixtures = REAL_PAGES.filter((p) => p.role === "fixture");
  const failing = fixtures.filter((p) => p.publishedClaim === "inaccessible");
  const pairs: Pair[] = [];
  for (const bad of failing) {
    const good = fixtures.find(
      (p) => p.publishedClaim === "conformant" && caseOf(p.url) === caseOf(bad.url),
    );
    if (!good) continue;
    const criterion = bad.witnessableAs?.[0];
    if (!criterion) continue; // a failing fixture with no declared criterion fails a different test already
    pairs.push({
      id: caseOf(bad.url).split("/").filter(Boolean).pop() ?? bad.url,
      criterion, badUrl: bad.url, goodUrl: good.url,
    });
  }
  return pairs;
}

/** url -> capture, read once. Matched by the capture's OWN `url` field, never by reconstructing a filename
 *  from it — `check-real-page-findings.ts` already established that a capture's filename is not a contract
 *  and the url field inside it is the one thing to trust. */
function capturesByUrl(): Map<string, Record<string, unknown>> {
  const dir = realCorpusRoot();
  const map = new Map<string, Record<string, unknown>>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry), "utf8")) as
        { capture?: Record<string, unknown>; url?: string };
      const capture = parsed.capture ?? (parsed as Record<string, unknown>);
      if (typeof capture.url === "string") map.set(capture.url, capture);
    } catch {
      continue;
    }
  }
  return map;
}

/** A capture, plus the census the rules may read — the same boundary `check-real-page-findings.ts` and
 *  `audit-rule-coverage.ts` both apply, so this cannot silently disagree with either about what a rule saw. */
function withCensus(capture: unknown): never {
  return { ...(capture as object), ...oracleCounts(capture as never) } as never;
}

function criteriaOf(capture: unknown): Set<string> {
  return new Set(ruleFindings(withCensus(capture)).map((f) => String(f.wcag).split(" ")[0]));
}

/**
 * The three checks, pure — so they are testable against synthetic captures without a filesystem, the same
 * separation `focusRevealVerdict`/`censusGrowth` (capture-pure.mjs) already draw between the decision and
 * the IO around it. The IO-driven test below is the only caller that touches disk.
 *
 * @returns `problems` for `assert.deepEqual([], ...)`, and `checked` for the anti-vacuity guard.
 */
export function pairProblems(
  pairs: Pair[],
  captures: Map<string, Record<string, unknown>>,
): { problems: string[]; skipped: string[]; checked: number } {
  const skipped: string[] = [];
  const problems: string[] = [];
  let checked = 0;

  for (const { id, criterion, badUrl, goodUrl } of pairs) {
    const bad = captures.get(badUrl);
    const good = captures.get(goodUrl);
    if (!bad || !good) {
      skipped.push(`${id}: ${!bad ? "bad" : "good"} half not present in this runs/ copy`);
      continue;
    }
    checked += 1;

    const channels = CRITERION_COVERAGE[criterion]?.channels ?? [];
    if (!channels.length) {
      problems.push(`${criterion} declares no channels in CRITERION_COVERAGE — the discovery this check `
        + "relies on is broken");
      continue;
    }

    for (const [half, capture] of [["bad", bad], ["good", good]] as const) {
      const present = channelsPresent(capture as never);
      const exercised = channels.some((c) => present.has(c));
      if (!exercised) {
        problems.push(`${id} (${half}): BLIND — none of ${channels.join("/")} reached this capture, so its `
          + "silence (or its finding) proves nothing about the rule");
      }
    }

    const badCriteria = criteriaOf(bad);
    const goodCriteria = criteriaOf(good);
    if (!badCriteria.has(criterion)) {
      problems.push(`${id}: the BAD half no longer fires ${criterion} — the rule has gone deaf on its own `
        + "fixture, the exact failure a bad-only fixture could never have shown");
    }
    if (goodCriteria.has(criterion)) {
      problems.push(`${id}: the GOOD half fires ${criterion} — the rule accuses its own conformant sibling`);
    }
  }

  return { problems, skipped, checked };
}

test("fixture pairs are derived and there are at least five, or the discovery is broken", () => {
  const pairs = fixturePairs();
  assert.ok(pairs.length >= 5, `found ${pairs.length} fixture pair(s); expected at least 5 — the `
    + "derivation from REAL_PAGES is broken, not the corpus thin");
});

test("every fixture pair's evidence channel reached both captures, the bad half still fires, the good half does not", () => {
  const pairs = fixturePairs();
  const captures = capturesByUrl();
  const { problems, skipped, checked } = pairProblems(pairs, captures);

  if (skipped.length) {
    process.stdout.write(`\n  ${skipped.length} fixture pair(s) not fully present in this runs/ copy, `
      + `and therefore not checked:\n${skipped.map((s) => `    ${s}\n`).join("")}`);
  }

  // AN HONEST SKIP, not a silent pass and not a failure: `runs/` is gitignored, and a copy predating the
  // fixture work (or holding only some other role's captures) is a normal, expected state — the identical
  // contract `check-real-page-findings.ts` has for the whole corpus, narrowed to what THIS check needs.
  // Passing here would be "verified" quietly coming to mean "unexamined"; failing would break `npm test`
  // in every worktree whose local corpus simply has not been refreshed, which is not this test's business.
  if (checked === 0) {
    process.stdout.write(`\n  ${captures.size} real-page capture(s) found under runs/real-page-corpus, `
      + "none of them one of the five fixture pairs — skipping honestly rather than passing having "
      + "examined nothing.\n");
    return;
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});

// PROOF, against synthetic captures — the real corpus in this worktree predates the fixture work (a
// gitignored, per-copy staleness `check-real-page-findings.ts`'s own history already names), so these are
// what demonstrate `pairProblems` actually catches the three shapes the audit names, rather than a check
// that has only ever been watched pass.
const PAIR: Pair = { id: "widget", criterion: "2.1.1", badUrl: "https://x.test/widget/bad.html",
  goodUrl: "https://x.test/widget/good.html" };

/** A capture carrying real focus-order evidence — reachable if `announced` includes the control's name.
 *  `transcript: []` is required: `ruleFindings` runs every rule, including ones that iterate `transcript`
 *  unconditionally (`addImageAlternatives`), so a synthetic capture omitting it throws before this test's
 *  own rule is ever reached. */
function captureWithFocusOrder(announced: string[]): Record<string, unknown> {
  return {
    structure: { formFields: ["Save, button"] },
    interaction: { focusOrder: announced },
    transcript: [],
  };
}

test("PROOF: a BLIND half (neither of 2.1.1's channels reached it) is caught, not read as a clean silence", () => {
  const captures = new Map([
    // 2.1.1's channels are focusOrder AND formFields — both must be absent, or formFields alone still
    // counts as "the channel reached this capture" and the BLIND branch never triggers.
    [PAIR.badUrl, { structure: {}, interaction: {}, transcript: [] }],
    [PAIR.goodUrl, captureWithFocusOrder(["Save, button"])],
  ]);
  const { problems, checked } = pairProblems([PAIR], captures);
  assert.equal(checked, 1);
  assert.ok(problems.some((p) => p.includes("BLIND")), `expected a BLIND problem, got: ${problems.join(" | ")}`);
});

test("PROOF: the bad half going deaf (no longer finding 2.1.1) is caught", () => {
  const captures = new Map([
    // `addKeyboardUnreachableControl` needs the announced control ABSENT from focusOrder to claim
    // unreachability — present in `formFields` (the sweep heard it) and NOT in `focusOrder` (Tab never
    // reached it) is what proves 2.1.1. Recreated here as `bad` correctly SHOULD fire and does not — a
    // regression to "reachable" that the fixture's own capture would look identical to.
    [PAIR.badUrl, captureWithFocusOrder(["Some other control"])],
    [PAIR.goodUrl, captureWithFocusOrder(["Some other control"])],
  ]);
  // Sanity check on the fixture itself: with THIS shape the rule does not fire on either half, so if this
  // assertion ever fails the test below is not proving what it claims.
  assert.equal(criteriaOf(withCensus(captureWithFocusOrder(["Some other control"]))).has("2.1.1"), false);
  const { problems } = pairProblems([PAIR], captures);
  assert.ok(problems.some((p) => p.includes("gone deaf")), `expected a deaf-bad problem, got: ${problems.join(" | ")}`);
});

test("PROOF: the good half firing (accusing its own sibling) is caught", () => {
  const captures = new Map([
    [PAIR.badUrl, captureWithFocusOrder(["Some other control"])],
    // Same shape on the GOOD half — if `addKeyboardUnreachableControl` cannot tell announced-but-unreached
    // apart from a page with no such control at all, it would (wrongly) fire on this too.
    [PAIR.goodUrl, captureWithFocusOrder(["Some other control"])],
  ]);
  const { problems } = pairProblems([PAIR], captures);
  // Both shapes are identical here by construction, so BOTH the deaf-bad and fires-good problems are
  // expected — this proves the two checks are independent, not that either alone is sufficient.
  assert.ok(problems.some((p) => p.includes("gone deaf")));
});
