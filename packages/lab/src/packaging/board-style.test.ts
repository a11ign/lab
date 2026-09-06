import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collect } from "../../../../scripts/board-data.mjs";
import { document, BODY_WORD_CAP, bodyOnly, bodyCapRefusal, summaryFor }
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
let cached: string | undefined;
function buildDocument(): string {
  cached ??= document(collect(new Date(Date.now() - 24 * 3600_000).toISOString()));
  return cached;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("sections one to five carry no repository internals", () => {
  const body = decisionSections(buildDocument());
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
  const bad = headings(decisionSections(buildDocument())).filter((h) =>
    !VERB.test(h) || /\?$/.test(h) || /^\d+\.\s/.test(h));
  assert.deepEqual(bad, [],
    "a heading that is a topic, a question, or a numbered label does not carry the story on its own");
});

test("the checks above FAIL on edition 1, which is what makes them worth running", () => {
  // MUTATION CHECK, against the real thing rather than a contrived string: this is edition 1's actual
  // shape -- numbered topic headings, a question, and repository internals in the decision sections. A
  // style guard that has never been shown to reject anything is decoration.
  const editionOne = [
    "# a11y-witness — board report",
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
function documentWith(counts: { strays: number; merges: number; open: number; closed: number }): string {
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
    achievements: [],
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

// `bodyOnly` is IMPORTED, not restated — issue #88 moved it into board-document.mjs so the generator
// itself could ask "is my own output too long" without a second copy of the boundary logic. This file
// used to carry its own, which is exactly how the cap could exist as a test here and nowhere the
// generator itself ever looked.

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

test(`the body fits two pages: sections one to five stay under ${BODY_WORD_CAP} words`, () => {
  const words = wordCount(bodyOnly(buildDocument()));
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
  for (const [what, re] of [
    ["are we on the date", /\bdate\b|\bSeptember\b|on track|at risk/i],
    ["what changed since yesterday", /since yesterday|today|now|moved|found/i],
    ["what the board must decide", /decide|approve|name|confirm/i],
  ] as [string, RegExp][]) {
    assert.match(summary.text, re, `the summary does not appear to answer: ${what}`);
  }
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
