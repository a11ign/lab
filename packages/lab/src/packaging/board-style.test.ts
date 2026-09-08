import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collect } from "../../../../scripts/board-data.mjs";
import { document, BODY_WORD_CAP, bodyOnly, bodyCapRefusal, summaryFor, DECISIONS, RISKS, STAGES, numberWord }
  from "../../../../scripts/board-document.mjs";

/* THE BOARD'S STYLE, ENFORCED ON THE RENDERED DOCUMENT AND NEVER ON THE TEMPLATE.
 *
 * A template can satisfy a rule its output then breaks -- a section that reads well with data and badly
 * without it, a heading assembled from a figure that turns out to be absent. The board reads the output,
 * so the output is what is asserted.
 *
 * The two rules come from board feedback on edition 1, which read like an engineer's post-mortem. The
 * style guides are copied into `docs/board/style/` so this is checked against them rather than against
 * anyone's memory of them.
 *
 * WHAT THESE ASSERTIONS ARE NOT. "Contains a verb" and "reads as a claim" are judgements, and what is
 * mechanised here is a PROXY for each: a curated verb set, no question form, no section numbering, and a
 * full stop. A document can satisfy every check below and still be badly written. What the proxies do
 * catch is the specific way edition 1 failed -- topic headings, numbered sections, and repository
 * internals on a page the board reads -- and the mutation test at the bottom proves they catch it.
 */

/** Everything before the appendix: the part the board reads for decisions. */
function decisionSections(md: string): string {
  const i = md.indexOf("## Appendix");
  return i === -1 ? md : md.slice(0, i);
}

const headings = (md: string): string[] =>
  md.split("\n").filter((l) => /^#{2,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "").trim());

/** A finite verb, as a PROXY for "this heading makes a claim". Curated, not exhaustive. */
const VERB = /\b(is|are|was|were|has|have|had|will|would|can|cannot|must|should|may|do|does|did|stands?|costs?|needs?|makes?|made|found|finds?|set|sets|gives?|gave|buys?|reads?|carries|carried|consumed|arrives?|remains?|moves?|moved|means?|proves?|shows?|asks?|asked|recommends?|publish|publishes|published|leaves?|lets?|runs?|ran|took|takes?|explains?|measures?|opened?|stops?|tells?|says?|comes?|goes?|works?|adds?|drives?)\b/i;

function firstSentence(block: string): string {
  const prose = block.split("\n")
    .find((l) => l.trim() && !/^#/.test(l) && !/^[|>*-]/.test(l) && !/^\d+\./.test(l));
  return (prose ?? "").replace(/\*\*/g, "").trim();
}

// BUILT ONCE. Each call reaches the issue tracker over the network, and three sections asserting on
// three separately-fetched documents would be three different documents -- which is the "two correct
// counts over different windows" defect, arriving inside the test that polices it.
//
// NEEDS A REAL LOCAL `main` BRANCH, BY DESIGN. `board-data.mjs`'s `mergeState` reads `git log main
// --merges` deliberately against the LOCAL branch rather than `origin/main` -- its own header explains
// why: work merged locally but not yet pushed must still be counted, or a hold reads as a stall. That is
// correct for the tool's real home (the lab, or a long-lived local checkout) and structurally unmet by an
// ephemeral CI checkout, which has no local `main` at all -- `ci.yml`'s `docs`/`ts` jobs check out one
// commit (or, on a PR, the merge ref) with no branch named `main` locally, ever. Rewriting `mergeState` to
// use `origin/main` would silently reintroduce the exact defect it was written to avoid, so the fix
// belongs here: skip honestly, the same idiom `verify.corpus.test.ts` uses for a gitignored corpus this
// checkout does not have.
let cached: string | null | undefined;
function buildDocument(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = document(collect(new Date(Date.now() - 24 * 3600_000).toISOString()));
  } catch (error) {
    const message = String((error as { stderr?: string; message?: string }).stderr ?? error);
    if (!/unknown revision|ambiguous argument 'main'/.test(message)) throw error;
    console.log("SKIPPED: no local `main` branch in this checkout (an ephemeral CI checkout, not the "
      + "lab) -- board-data.mjs's mergeState needs one by design. This is an honest skip, not a pass.");
    cached = null;
  }
  return cached;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("sections one to five carry no repository internals", () => {
  const doc = buildDocument();
  if (doc === null) return;
  const body = decisionSections(doc);
  const offences: string[] = [];
  const scan = (label: string, re: RegExp) => {
    for (const line of body.split("\n")) {
      if (re.test(line)) offences.push(`${label}: ${line.trim().slice(0, 100)}`);
    }
  };
  scan("code span", /`/);
  scan("file name", /\.(md|mjs|ts|json|yml)\b/);
  scan("issue number", /#\d+/);
  scan("commit identifier", /\b[0-9a-f]{7,}\b/);
  assert.deepEqual(offences, [],
    "the board reads outcomes and decisions, not the repository. Identifiers belong in the appendix, "
    + "described in words with the exact reference beside them.");
});

test("the document and every section open with a complete sentence, not a topic", () => {
  const md = buildDocument();
  if (md === null) return;
  const blocks = decisionSections(md).split(/\n(?=## )/);
  const bad: string[] = [];
  for (const block of blocks) {
    const s = firstSentence(block);
    if (!s) continue;
    if (!/\.$|\.\s*$/.test(s)) bad.push(`does not end in a full stop: ${s.slice(0, 80)}`);
    if (!VERB.test(s)) bad.push(`contains no verb, so it is a topic rather than an answer: ${s.slice(0, 80)}`);
  }
  assert.deepEqual(bad, [],
    "the first sentence of the document and of every section must be a complete answer someone could "
    + "act on");
});

test("every heading is a claim, so the headings alone tell the story", () => {
  const doc = buildDocument();
  if (doc === null) return;
  const bad = headings(decisionSections(doc)).filter((h) =>
    !VERB.test(h) || /\?$/.test(h) || /^\d+\.\s/.test(h));
  assert.deepEqual(bad, [],
    "a heading that is a topic, a question, or a numbered label does not carry the story on its own");
});

test("the checks above FAIL on edition 1, which is what makes them worth running", () => {
  // MUTATION CHECK, against the real thing rather than a contrived string: this is edition 1's actual
  // shape -- numbered topic headings, a question, and repository internals in the decision sections. A
  // style guard that has never been shown to reject anything is decoration.
  const editionOne = [
    "# a11ign — board report",
    "",
    "## 1. Are we on track",
    "",
    "AT RISK. 8 blockers remain, and #3 has no known size — see `docs/backlog.md` for the derivation.",
    "",
    "## 2. Time to V1",
    "",
    "V1 is not defined in `PLAN.md`.",
  ].join("\n");

  const body = decisionSections(editionOne);
  assert.match(body, /`/, "edition 1 carried code spans in its decision sections");
  assert.match(body, /#\d+/, "edition 1 carried issue numbers in its decision sections");
  assert.match(body, /\.md\b/, "edition 1 named markdown files in its decision sections");

  const bad = headings(body).filter((h) => !VERB.test(h) || /\?$/.test(h) || /^\d+\.\s/.test(h));
  assert.ok(bad.length >= 2,
    `the heading check must reject edition 1's topic headings; it rejected ${bad.length}`);
});

/** A fact set with distinctive counts, so a HARDCODED number in the prose stands out.
 *
 * The board found the defect this catches: section 4 said "Six saved changes carry the wrong author"
 * while the appendix said 14, because the six was typed from an earlier reading and the fourteen was
 * computed. Both were true of something -- six was the count over the last 25 changes, fourteen over the
 * window the report actually states -- which is this project's most-recorded defect, arriving in the
 * document written to display it.
 *
 * Asserting "every number in the body also appears in the appendix" would over-fire on ordinary prose, so
 * this drives the DATA instead: render with counts nothing would type by accident, and require the prose
 * to show them. A typed number cannot follow.
 */
function documentWith(counts: { strays: number; merges: number; open: number; closed: number; achievements?: number }): string {
  const issue = (n: number, milestone: string | null) => Array.from({ length: n }, (_, k) => ({
    number: k + 1, title: `item ${k + 1}`, state: "OPEN", url: "", labelNames: [],
    milestone: milestone ? { title: milestone } : null,
  }));
  return document({
    since: "2026-09-06T00:00:00Z", sinceLabel: "the stated window",
    all: [], open: issue(counts.open, MILESTONE_TITLE), closed: issue(counts.closed, null),
    milestones: [], release: { title: MILESTONE_TITLE, due_on: "2026-09-20T00:00:00Z",
      open_issues: counts.open, closed_issues: counts.closed },
    merges: Array.from({ length: counts.merges }, () => ({ sha: "x", at: "", subject: "" })),
    unpushed: 0,
    strays: Array.from({ length: counts.strays }, () => ({ sha: "x", email: "test@example.com" })),
    latestGate: null, gateIsFresh: false,
    fleetHours: { status: "not instrumented", note: "no total exists." },
    achievements: Array.from({ length: counts.achievements ?? 0 },
      (_, k) => ({ claim: `achievement ${k + 1}`, boardClaim: `Achievement ${k + 1}.`, at: "2026-09-06T00:00:00Z" })),
  });
}

const MILESTONE_TITLE = "v0.1.0 — first publish";

test("no count in the prose is typed; each is driven by the data it claims to report", () => {
  // SCOPED TO THE BODY, and the first version of this check was not.
  //
  // It searched every line matching the keyword, and the APPENDIX row matches the same keyword -- so a
  // hardcoded number in the body passed because the correctly-computed appendix row sat beside it and
  // satisfied the `some()`. Proved by mutation: reinstating the typed "Six" left this test green. That is
  // a guard reading the right document in the wrong place, which is this project's defect of record, in
  // the test written to catch it.
  const whole = documentWith({ strays: 731, merges: 947, open: 613, closed: 829 });
  const md = decisionSections(whole);
  // THE WRONG-AUTHOR EXPECTATION IS GONE, AND ITS ABSENCE IS THE HONEST OUTCOME.
  //
  // That count moved to the appendix on 2026-09-06 -- disclosed, but changing no decision, so it left the
  // risks table -- and in doing so it left PROSE ENTIRELY: it now appears only in the generated numbers
  // table. First this check went vacuous (its keyword matched nothing in the body, and the vacuity guard
  // said so). Then, rescoped to the whole document, it PASSED A MUTATION: hardcoding the prose changed
  // nothing, because the table's own value satisfied the `some()`.
  //
  // A check that cannot fail is worse than no check, so it is removed rather than left looking like
  // cover. There is nothing left to type wrongly for this figure -- which is the better fix and the
  // reason the coverage loss is acceptable.
  // ONLY COUNTS THAT APPEAR IN PROSE. The merge count and the wrong-author count both moved to the
  // appendix's generated table, where the value is `String(d.x.length)` and there is no prose to type
  // wrongly -- an expectation on them passes whatever the prose says, which is cover rather than a check.
  // These two are the counts a person could still type by hand, in the two sentences that carry them.
  const expectations: [string, number, RegExp, string][] = [
    ["work blocking the release", 613, /pieces of work must finish/i, md],
    ["work needing no board decision", 613, /needs a board decision/i, md],
  ];
  const bad: string[] = [];
  for (const [what, value, where, scope] of expectations) {
    const lines = scope.split("\n").filter((l) => where.test(l));
    assert.ok(lines.length > 0, `no line in the document mentions ${what}; this check is vacuous`);
    if (!lines.some((l) => l.includes(String(value)))) {
      bad.push(`${what}: the document reports something other than ${value} — `
        + `${lines[0].trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, [],
    "a number typed into the prose cannot follow the data, and will disagree with the appendix the "
    + "first time the data moves");
});

test("the body and the appendix report the same count for the same thing", () => {
  const md = documentWith({ strays: 731, merges: 947, open: 613, closed: 829 });
  const cut = md.indexOf("## Appendix");
  const body = md.slice(0, cut);
  const appendix = md.slice(cut);
  const bad: string[] = [];
  for (const [label, value] of [["wrong-author count", 731], ["merge count", 947]] as [string, number][]) {
    const inBody = body.includes(String(value));
    const inAppendix = appendix.includes(String(value));
    if (inBody && !inAppendix) bad.push(`${label}: ${value} appears in the body and not in the appendix`);
  }
  assert.deepEqual(bad, [],
    "every figure the body states must be sourced in the appendix under the same window; the board found "
    + "one that was not, and the two disagreed");
});

/**
 * #284, WIDENING THE GUARD ABOVE TO FIND ITS OWN SUBJECTS. "no count in the prose is typed" is enumerated
 * -- a hand-written array naming two sentences -- and the achievements/decisions/risks/stages counts were
 * never in it, so an edition shipped "four things demonstrable" above three bullets and nothing caught it.
 *
 * DISCOVERED, NOT RE-ENUMERATED: rather than typing a third magic number into a test array (the exact
 * habit that let the first three drift), this reads `DECISIONS`/`RISKS`/`STAGES` — now exported — so the
 * expected value is the SAME array `section4`/`section5` render from, at test time. A wrong count beside
 * any of the three can never pass, because there is no longer a second, independent number to agree with
 * by accident.
 *
 * ACHIEVEMENTS IS ALSO PERTURBED, not just read live — it is the one count that flows through `d` rather
 * than living as a module constant, so `documentWith` can render it at two different lengths and prove the
 * heading's number MOVES with the list, the strongest form of "derived, not typed" this file has for any
 * count.
 */
test("the achievements, decisions, risks and stages counts in prose are sourced from the same lists the generator renders, not retyped", () => {
  const three = documentWith({ strays: 0, merges: 0, open: 613, closed: 0, achievements: 3 });
  const five = documentWith({ strays: 0, merges: 0, open: 613, closed: 0, achievements: 5 });

  assert.match(three, new RegExp(`We made ${numberWord(3)} things? demonstrable today`, "i"),
    "3 achievements must render as the word for 3");
  assert.match(five, new RegExp(`We made ${numberWord(5)} things demonstrable today`, "i"),
    "5 achievements must render as the word for 5, PROVING the count moved rather than being fixed prose");
  assert.doesNotMatch(five, new RegExp(`We made ${numberWord(3)} things demonstrable today`, "i"));

  const md = decisionSections(five);
  const costsNothing = DECISIONS.filter((x) => x.costsNothing).length;
  const liveExpectations: [string, RegExp][] = [
    ["decisions asked", new RegExp(`board is asked for ${numberWord(DECISIONS.length).toLowerCase()} `
      + "decisions", "i")],
    ["decisions costing nothing", new RegExp(`${numberWord(costsNothing).toLowerCase()} of them cost `
      + "nothing to make", "i")],
    ["decisions restated", new RegExp(`These ${numberWord(DECISIONS.length).toLowerCase()} do`, "i")],
    ["live risks", RISKS.length === 1
      ? /One risk is live/i
      : new RegExp(`${numberWord(RISKS.length)} risks are live`, "i")],
    ["programme stages", new RegExp(`first of ${numberWord(STAGES.length).toLowerCase()} stages`, "i")],
  ];
  const bad: string[] = [];
  for (const [what, re] of liveExpectations) {
    if (!re.test(md)) bad.push(`${what}: no line matches ${re} — the sentence and DECISIONS/RISKS/STAGES `
      + "have drifted apart, or the prose was retyped independently of the list");
  }
  assert.deepEqual(bad, []);
});

/**
 * #284. Section five's own header records the exact defect this reproduces: a heading read "We are not
 * asking for money" above a body recommending a purchase, and once fixed, a SECOND heading inside the same
 * section repeated the first's claim under different words. Neither the "topic vs. claim" check above nor
 * a heading-negates-body check (deliberately not built — that is judgement, see the issue) can see this;
 * it needs its own mechanical proxy.
 *
 * OVERLAP COEFFICIENT OVER SIGNIFICANT WORDS (intersection over the SMALLER heading's word count), not
 * Jaccard and not exact-string equality. The real defect used different verbs ("asking" / "recommend
 * buying") around the same shared subject ("the five machines"), so two headings must be flagged for
 * restating one claim even when no long substring repeats verbatim -- and Jaccard under-fires exactly
 * here: a heading with several EXTRA clauses (an aside, a second fact) dilutes the union and hides a real
 * repeat. Overlap coefficient asks a narrower, more honest question -- "of the SHORTER heading's own
 * content, how much also appears in the other" -- which is what "restates" actually means. Threshold
 * calibrated against this repo's own real, current board document: the highest overlap between any two
 * unrelated headings there is 0.25; 0.5 leaves a clear margin on both sides.
 */
const STOPWORDS = new Set(["the", "a", "an", "is", "are", "we", "for", "to", "of", "and", "it", "this",
  "that", "its", "in", "on", "at", "be", "was", "were", "will", "would", "has", "have", "had", "not",
  "no", "so", "than", "then", "now", "with", "as", "our", "their"]);

function significantWords(heading: string): Set<string> {
  return new Set(heading.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((w) => b.has(w)).length;
  return intersection / Math.min(a.size, b.size);
}

/** Every `##`/`###` heading, grouped by the `##` SECTION it falls under -- a `###` restating its own `##`
 *  is exactly the historical defect, so the grouping must include the section's own top heading. */
function headingsBySection(md: string): string[][] {
  const groups: string[][] = [];
  let current: string[] | null = null;
  for (const line of md.split("\n")) {
    if (/^##\s/.test(line)) { current = []; groups.push(current); }
    if (/^#{2,4}\s/.test(line) && current) current.push(line.replace(/^#+\s*/, "").trim());
  }
  return groups;
}

const SIMILARITY_THRESHOLD = 0.5;

/** Every pair within one heading group that restates the same claim, as human-readable complaints. */
function restatedPairs(group: string[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const score = overlapCoefficient(significantWords(group[i]), significantWords(group[j]));
      if (score >= SIMILARITY_THRESHOLD) {
        bad.push(`"${group[i]}" and "${group[j]}" share ${Math.round(score * 100)}% of their `
          + "significant words -- the second restates the first rather than adding to it");
      }
    }
  }
  return bad;
}

test("no two headings in one section state the same claim", () => {
  const doc = buildDocument();
  if (doc === null) return;
  const bad = headingsBySection(decisionSections(doc)).flatMap(restatedPairs);
  assert.deepEqual(bad, [],
    "a reader who reads only the headings must never meet the same claim twice in one section");
});

test("the heading-similarity check REJECTS the actual defect it was written for", () => {
  // MUTATION AGAINST THE REAL SHAPE, not a contrived string -- section five's own header names it:
  // "We are asking for the five machines..." then, further down the same section, "We recommend buying
  // the five machines...". Different verbs, same subject; a substring check would miss it.
  const reproduction = [
    "# a11ign — board report, 7 September 2026",
    "",
    "## We are asking for the five machines.",
    "",
    "Body text.",
    "",
    "### We recommend buying the five machines.",
    "",
    "More body text.",
    "",
    "## Appendix",
  ].join("\n");
  const groups = headingsBySection(decisionSections(reproduction));
  const flagged = groups.some((group) => group.some((a, i) => group.slice(i + 1).some((b) =>
    overlapCoefficient(significantWords(a), significantWords(b)) >= SIMILARITY_THRESHOLD)));
  assert.ok(flagged, "the check must reject two headings that restate the same claim about the same "
    + "five machines under different verbs");
});

test("the summary states WHEN it was written, and that time is within 60 minutes of the render", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const summary = summaryFor(today);
  if (!summary) return;   // its absence is the previous test's finding, not this one's

  // EFFECTIVE FROM 2026-09-09, NAMED RATHER THAN INFERRED. The board's direction arrived on the morning
  // of the 8th, after that day's summary had already been written the evening before under the old
  // convention. A test that fails on a document written correctly under the rule that was in force when
  // it was written is a test that gets disabled, not obeyed. The 8th's summary is rewritten at 07:30 by
  // hand; from the 9th this asserts it.
  const EFFECTIVE_FROM = "2026-09-09";  // mutation probe
  if (today < EFFECTIVE_FROM) return;

  // THE BOARD ASKED FOR THIS, and the reason is the only reason that matters here: "it should be 30 mins
  // before as it should be as fresh as possible as a lot happens over night." A summary written the
  // evening before is a forecast about a night that has not happened yet, and every overnight merge makes
  // it staler -- on 8 September the queue went from twelve open pull requests to zero between the summary
  // being written and the edition rendering.
  //
  // So the summary NAMES the minute it was written, and this asserts the claim is true rather than
  // decorative. A stated time nothing checks is the same shape as a gate that reports cleanly having
  // examined nothing.
  const { statedWritingTime } = await import("../../../../scripts/board-summary-check.mjs");
  const londonNow = new Intl.DateTimeFormat("en-GB",
    { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const stated = statedWritingTime(summary.text, londonNow);
  assert.ok(stated,
    "the summary must open by naming when it was written -- \"Written at 07:30 on 8 September\" -- "
    + "because a document the board reads at 08:00 must say how old its one hand-written paragraph is");

  const drift = stated.driftMinutes;

  // 60 MINUTES, NOT 30. The board asked for 30 minutes and the WRITING is scheduled for 07:30, but this
  // test also runs in CI at arbitrary times of day against a summary written that morning. Sixty minutes
  // is the window that makes it a real assertion at 08:00 without failing every unrelated PR -- and the
  // schedule, not this number, is what actually delivers the 30 minutes.
  const WINDOW_MINUTES = 60;
  if (drift > WINDOW_MINUTES) {
    assert.ok(drift <= WINDOW_MINUTES,
      `the summary says it was written at ${stated.stated} and London now reads ${londonNow} -- ${drift} `
      + `minutes later. Past ${WINDOW_MINUTES} it is not the fresh paragraph the board asked for; `
      + "rewrite it from the state at this moment rather than adjusting the time it claims.");
  }
});

test("relative time words never appear in the body -- a dated document names the date, or says yesterday", () => {
  const doc = buildDocument();
  if (doc === null) return;
  const body = decisionSections(doc);
  const offences = ["this morning", "this afternoon", "tonight"]
    .filter((phrase) => new RegExp(phrase, "i").test(body));
  assert.deepEqual(offences, [],
    "a sentence in a dated document must name the date, or say \"yesterday\" against a stated window -- "
    + "never a time-of-day word whose reader cannot recover when it was written");
});

// `bodyOnly` is IMPORTED, not restated — issue #88 moved it into board-document.mjs so the generator
// itself could ask "is my own output too long" without a second copy of the boundary logic. This file
// used to carry its own, which is exactly how the cap could exist as a test here and nowhere the
// generator itself ever looked.

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

test(`the body fits two pages: sections one to five stay under ${BODY_WORD_CAP} words`, () => {
  const doc = buildDocument();
  if (doc === null) return;
  const words = wordCount(bodyOnly(doc));
  assert.ok(words <= BODY_WORD_CAP,
    `the body is ${words} words against a cap of ${BODY_WORD_CAP}. Cut repetition and evidence-in-prose `
    + "— evidence belongs in the appendix — never a decision or a number.");
});

test("bodyCapRefusal is null when the body fits", () => {
  const fits = `\n## Section\n\n${"word ".repeat(10)}\n\n## Appendix\n\nevidence`;
  assert.equal(bodyCapRefusal({ achievements: [] }, fits), null);
});

/**
 * ISSUE #88: the refusal must name the TRADE, not just the number, or it leaves the same silent
 * displacement it was written to stop -- whoever is editing under time pressure deletes whatever is
 * nearest, and that was never the guard's decision to delegate.
 */
test("bodyCapRefusal over the cap names the overflow and lists achievements OLDEST FIRST", () => {
  const over = `\n## Section\n\n${"word ".repeat(BODY_WORD_CAP + 50)}\n\n## Appendix\n\nevidence`;
  const d = {
    achievements: [
      { claim: "Newer claim.", boardClaim: "Newer claim.", at: "2026-09-06T00:00:00Z" },
      { claim: "Older claim.", boardClaim: "Older claim.", at: "2020-01-01T00:00:00Z" },
    ],
  };
  const refusal = bodyCapRefusal(d, over);
  assert.ok(refusal, "a body over the cap must produce a refusal message, not a silent pass");
  assert.match(refusal!, new RegExp(`REFUSES.*${BODY_WORD_CAP}`));
  assert.match(refusal!, /\[0] "Older claim\."\s+written 2020-01-01/,
    "the OLDEST achievement (by `at`) must be listed first, not document order");
  assert.match(refusal!, /\[1] "Newer claim\."\s+written 2026-09-06/);
});

test("bodyCapRefusal with no achievements names the prose, not a retire target that does not exist", () => {
  const over = `\n## Section\n\n${"word ".repeat(BODY_WORD_CAP + 20)}\n\n## Appendix\n\nevidence`;
  const refusal = bodyCapRefusal({ achievements: [] }, over);
  assert.match(refusal!, /no achievements are recorded to retire/i);
});

test("the word cap REJECTS edition 2, which is why it exists", () => {
  // MUTATION AGAINST THE REAL THING. Edition 2 ran to 1,864 words across four pages of body and the
  // chairman called it too long for a daily. A cap that does not reject the document that caused it is
  // a cap chosen to be satisfied.
  const editionTwoBodyWords = 1864;
  assert.ok(editionTwoBodyWords > BODY_WORD_CAP,
    `the cap is ${BODY_WORD_CAP} and edition 2's body was ${editionTwoBodyWords} words; a cap that `
    + "admits the document it was written for is decoration");
});

/**
 * #284: "what changed since yesterday" used to check for the bare word "today" anywhere in the text --
 * satisfied by ANY sentence mentioning "today" for any reason, whether or not it actually answers what
 * changed. Now requires "since yesterday" itself, or the summary naming TODAY'S REAL DATE -- derived from
 * the same ISO date `summaryFor` was asked for, via `Intl.DateTimeFormat` rather than a second, hand-typed
 * month-name table (`board-document.mjs`'s own `longDate` is private; re-deriving the mapping by hand is
 * the fact-stated-twice shape this repo keeps finding in its own tooling).
 */
function namesTodayByDate(text: string, iso: string): boolean {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d);
  return new RegExp(`\\b${day}(st|nd|rd|th)?\\b`, "i").test(text) && new RegExp(`\\b${month}\\b`, "i").test(text);
}

test("an edition cannot be published without a hand-written summary for that day", () => {
  const today = new Date().toISOString().slice(0, 10);
  const summary = summaryFor(today);
  assert.ok(summary,
    `docs/board/summaries/${today}.md is missing. A missing summary is a MISSING EDITION, never a `
    + "summary-less document — a summary assembled from the sections is the thing the chairman's rules "
    + "forbid.");
  assert.ok(summary.words <= 120,
    `the summary is ${summary.words} words, over the 120-word cap that makes it a summary`);
  // It must ANSWER the three questions, not merely be short.
  assert.match(summary.text, /\bdate\b|\bSeptember\b|on track|at risk/i,
    "the summary does not appear to answer: are we on the date");
  assert.ok(/since yesterday/i.test(summary.text) || namesTodayByDate(summary.text, today),
    "the summary does not appear to answer: what changed since yesterday -- it must say \"since "
    + "yesterday\" or name today's actual date, not merely contain the word \"today\" somewhere unrelated");
  assert.match(summary.text, /decide|approve|name|confirm/i,
    "the summary does not appear to answer: what the board must decide");
});

test("the chairman's conditions are in the repository beside the other guides", () => {
  assert.ok(existsSync(path.join(REPO, "docs/board/style/chairman-guidelines.md")),
    "the conditions the document is written to must be checkable against the text, not recalled");
});

test("the style guides the document is written to are in the repository", () => {
  // Checked against the FILES, not against memory of them -- which is the whole reason they were copied
  // in. A guide that lives only in a message is a guide the next reader cannot check the document against.
  for (const name of ["executive.md", "eli15.md", "README.md"]) {
    assert.ok(existsSync(path.join(REPO, "docs/board/style", name)),
      `docs/board/style/${name} is missing, so the document is being checked against nothing`);
  }
});

/* A COUNT THAT SILENTLY DROPS ROWS IS WORSE THAN ONE THAT COUNTS THE WRONG THING.
 *
 * `meta` marks a row that is not work -- the daily report's own issue (#20), whose comments ARE the
 * editions, so it is open for ever and can never be worked. Counted, it inflates the total by one
 * permanently and the figure stops meaning what a reader thinks it means.
 *
 * Excluding it is right. Excluding it WITHOUT SAYING SO is the thing this repo has paid for repeatedly:
 * a number whose population nobody can reconstruct. So the exclusion is enforced in `countable()` and
 * STATED in the source column beside the figure, and this test pins both halves together -- a fix that
 * drops the sentence leaves a count nobody can check.
 */
test("meta rows are excluded from the counted set, and the document says so", async () => {
  const { countable, META_LABEL } = await import("../../../../scripts/board-data.mjs");
  const rows = [
    { number: 1, state: "OPEN", labelNames: ["backlog"] },
    { number: 2, state: "OPEN", labelNames: ["backlog", META_LABEL] },
  ];
  // `countable` comes from an untyped .mjs, so the row type is stated here rather than inferred —
  // `tsx` runs this file happily and `tsc` does not, which is the whole reason the typecheck is a
  // separate gate from the tests.
  const counted = countable(rows) as Array<{ number: number }>;
  assert.deepEqual(counted.map((r) => r.number), [1],
    "a row labelled meta must not reach the counted set");

  const doc = readFileSync(path.join(REPO, "scripts/board-document.mjs"), "utf8");
  assert.match(doc, /excluding rows marked as containers rather than work/,
    "the document must PRINT the exclusion beside the count — an unexplained exclusion is a figure "
    + "whose population a reader cannot reconstruct, which is the defect this whole file exists for");
});
/* ONE ENTRY, ONE FILE — AND NOTHING ENFORCED IT UNTIL THIS TEST.
 *
 * #159 names each file by the entry's own identity plus a hash of it. That is stable and unique while the
 * identity holds still, and it says nothing about what happens when somebody EDITS an identity: the entry
 * is written under a new name, the old file stays, and `reported()` reads BOTH. Found by simulating
 * exactly that on the real directory -- two gates for one command, and `order` values of 10 and 10, so
 * the record silently carried a duplicate AND the tie-break between them was arbitrary.
 *
 * A duplicated entry is not a cosmetic fault here. The board document quotes these figures, and the one
 * thing it must never do is report a number twice or report the wrong one of two.
 *
 * REFUSED AT PUSH RATHER THAN AT RENDER, deliberately. The 08:00 job runs unattended, and a refusal there
 * is a missing edition; a refusal here is a red test in front of the person who caused it.
 */
test("no two recorded entries share an identity or an order", () => {
  for (const [kind, identity] of [["gates", "command"], ["achievements", "issue"]] as const) {
    const dir = path.join(REPO, "docs/board/reported", kind);
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir).filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: f, body: JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));

    const byIdentity = new Map<string, string[]>();
    const byOrder = new Map<number, string[]>();
    for (const { file, body } of entries) {
      const id = String(body[identity]);
      byIdentity.set(id, [...(byIdentity.get(id) ?? []), file]);
      byOrder.set(body.order, [...(byOrder.get(body.order) ?? []), file]);
      assert.ok(typeof body.order === "number",
        `${kind}/${file} has no numeric order. An entry with no place in the sequence is appended `
        + "silently, and the document renders in that order — so it would move what the board reads "
        + "without anybody choosing to");
    }
    for (const [id, files] of byIdentity) {
      assert.equal(files.length, 1,
        `${kind}: ${files.length} files carry ${identity} ${JSON.stringify(id)} — ${files.join(", ")}. `
        + "Editing an identity writes a new file and leaves the old one, and BOTH are read, so the "
        + "document would quote the same measurement twice. Delete the stale file.");
    }
    for (const [order, files] of byOrder) {
      assert.equal(files.length, 1,
        `${kind}: ${files.length} files share order ${order} — ${files.join(", ")}. The tie-break `
        + "between them is the filename, which is not a decision anybody made about what the board reads.");
    }
  }
});

/* A KIND ON DISK THAT THE CONSTANT DOES NOT NAME IS SILENTLY DROPPED FROM THE DOCUMENT.
 *
 * `REPORTED_KINDS` governs which subdirectories of `docs/board/reported/` are read. Shrink it and
 * `reported()` returns no key for the missing kind, `?? []` turns that into an empty list, and the
 * edition renders ZERO achievements without failing anything. Measured: the full suite passes with the
 * constant shrunk, and the document loses all five.
 *
 * FOUND BY MUTATION, NOT BY READING -- and the first attempt found the wrong thing. `reported()` was
 * still hardcoding both kinds while claiming to derive them, so shrinking the constant changed nothing
 * and looked like coverage rather than a silent no-op edit. The mutation is what separated "the guard
 * does not bite" from "the code never read the constant".
 *
 * THE DIRECTION THAT MATTERS IS DISK -> CONSTANT. A kind the constant names but disk lacks is an empty
 * list, which is honest. A kind on disk the constant does not name is evidence that exists and is never
 * read, which is this project's oldest defect: unchecked is not clean.
 */
test("every entry directory on disk is named in REPORTED_KINDS", async () => {
  const { REPORTED_KINDS, reported } = await import("../../../../scripts/board-data.mjs");
  const root = path.join(REPO, "docs/board/reported");
  const onDisk = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);

  for (const kind of onDisk) {
    assert.ok((REPORTED_KINDS as string[]).includes(kind),
      `docs/board/reported/${kind}/ holds records that nothing reads: it is not in REPORTED_KINDS, so `
      + "`reported()` returns no key for it and the edition renders that section empty without failing. "
      + "Add it to the constant, or delete the directory — evidence that exists and is never read is "
      + "worse than evidence that is absent, because absence is visible");
  }
  // AND THE OTHER DIRECTION, so the constant cannot name a kind that does not exist: a phantom kind
  // contributes an empty list to every count and nothing ever says why it is empty.
  const built = reported();
  for (const kind of REPORTED_KINDS as string[]) {
    assert.ok(onDisk.includes(kind) || (built as Record<string, unknown>)[kind] !== undefined,
      `REPORTED_KINDS names ${kind}, which has no directory and no key in reported()`);
  }
});
