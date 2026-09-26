/**
 * ADR 0040 (#2615, child 2 of #69): `agent-org` AS A STANDALONE, PROJECT-AGNOSTIC TOOL, decided before any of it is extracted.
 *
 * The ADR's deliverable is a set of DECISIONS and an APPENDIX: nine decisions, each with a reading taken by a command; the
 * chairman's three asks; and, for each child row that gates the extraction, the Region, Acceptance and Done-when confirmed or
 * amended, so `product-manager` promotes from the appendix and nobody re-derives them. A document that lost a decision, or
 * whose "reading" became a sentence, or whose appendix entry lost its Acceptance would still LOOK finished. So this reads it
 * and refuses each of those.
 *
 * WHAT IT DOES NOT PROVE, said here so nobody cites it as more: it cannot re-take a reading (a reading is a moment, at the
 * commit the ADR names), so it proves a reading IS PRESENT with output beneath it, not that the output is right. It cannot judge
 * a decision. And it proves a Region path EXISTS or is one the ADR reserves, not that the row's Region is the right one.
 *
 * THE CHECK IS A PURE FUNCTION over text, `checkAdr`, so the same checks run over a hand-written complete fixture (must PASS)
 * and over that fixture with one thing broken at a time (each must be REFUSED, and must name what is missing). A check that
 * refuses everything and one that passes anything both fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADR_FILE = "0040-agent-org-is-a-standalone-project-agnostic-tool.md";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ADR_DIR = `${REPO_ROOT}docs/adr/`;

/** The nine decisions `ceo` named (#2615), in the order the ADR states them. */
const DECISION_COUNT = 9;
/** The merge path, the licence and the fixture project: the three decisions that RECORD a ruling and must say so, citing #69. */
const MERGE_PATH_DECISION = 6;
/** The decision that carries the relicensing check, whose command must mention the licence. */
const LICENCE_DECISION = 7;
const FIXTURE_DECISION = 8;
const RULED_DECISIONS: readonly number[] = [MERGE_PATH_DECISION, LICENCE_DECISION, FIXTURE_DECISION];
/** The four surfaces decision 1 sizes as a number of files. */
const SURFACE_COUNT = 4;
/** The chairman's three asks (a), (b), (c) of #69, 07:53Z. */
const ASKS = ["a", "b", "c"] as const;
/** The children the ADR confirms or amends, in the order the chain runs; extra entries (3g, W) may sit among them. */
const REQUIRED_CHILDREN = ["3a", "3b", "3c", "3d", "3e", "3f", "4", "5"] as const;

/** The five sections `docs/adr/README.md` prescribes, by the heading each is written under. */
const PRESCRIBED_SECTIONS: readonly [string, RegExp][] = [
  ["Context", /^## Context\s*$/m],
  ["Decision", /^## Decision\s*$/m],
  ["Consequences", /^## Consequences\b.*$/m],
  ["Alternatives rejected", /^## Alternatives rejected\s*$/m],
  ["What would falsify this", /^## What would falsify this\s*$/m],
];

/** `###`: a decision, an ask and an appendix entry are all third-level headings. */
const ENTRY_LEVEL = 3;

/** 1..n. */
function countTo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

const FENCE = "```";
const OUTER_FENCE = "````";

/**
 * A slice of `text` from the heading matching `start` to the next heading of the same or a higher level.
 * FENCE-AWARE: a row body in the appendix sits inside a fence and carries headings of its own (`## Region`), which are that
 * row's and not the document's, so a heading inside a fence never starts or ends a section.
 */
function section(text: string, start: RegExp, level: number): string | undefined {
  const lines = text.split("\n");
  let fence: string | undefined;
  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const opener = /^(`{3,})/.exec(line);
    if (fence === undefined && opener) fence = opener[1];
    else if (fence !== undefined && line.trim() === fence) fence = undefined;
    else if (fence === undefined) {
      const heading = /^(#{1,6}) /.exec(line);
      if (!heading) continue;
      if (from < 0 && start.test(line)) from = i;
      else if (from >= 0 && heading[1]!.length <= level) return lines.slice(from, i).join("\n");
    }
  }
  return from < 0 ? undefined : lines.slice(from).join("\n");
}

/** Every fenced block in `text`, as its info string and its lines. Handles a longer outer fence. */
function fencedBlocks(text: string): { info: string; lines: string[] }[] {
  const blocks: { info: string; lines: string[] }[] = [];
  let open: { fence: string; info: string; lines: string[] } | undefined;
  for (const line of text.split("\n")) {
    const opener = /^(`{3,})(.*)$/.exec(line);
    if (!open && opener) {
      open = { fence: opener[1]!, info: opener[2]!.trim(), lines: [] };
    } else if (open && line.trim() === open.fence) {
      blocks.push({ info: open.info, lines: open.lines });
      open = undefined;
    } else if (open) {
      open.lines.push(line);
    }
  }
  return blocks;
}

/** A reading is a fenced block whose first line is `$ <command>` and which has real output beneath it. */
function readings(text: string): { command: string }[] {
  const found: { command: string }[] = [];
  for (const b of fencedBlocks(text)) {
    const first = b.lines.findIndex((l) => l.trim() !== "");
    if (first < 0 || !b.lines[first]!.startsWith("$ ")) continue;
    if (b.lines.slice(first + 1).some((l) => l.trim() !== "")) found.push({ command: b.lines[first]!.slice(2) });
  }
  return found;
}

const SURFACE_LINE = (n: number): RegExp => new RegExp(`\\*\\*Surface ${n} —[^*]*\\b\\d[\\d,]*\\s+(?:\\w+\\s+){0,3}files?\\b`);

function decisionOneProblems(body: string): string[] {
  const problems: string[] = [];
  for (const n of countTo(SURFACE_COUNT)) {
    if (!SURFACE_LINE(n).test(body)) problems.push(`DECISION 1 does not size surface ${n} as a number of files ("**Surface ${n} — N files.**")`);
  }
  if (!/^\*\*Sum:\*\*[\s\S]*?\b\d+ distinct files\b[\s\S]*?\b\d+ rows\b[\s\S]*?\bparallel\b/m.test(body)) {
    problems.push('DECISION 1 has no "**Sum:**" naming the distinct files, the number of rows and which go in parallel');
  }
  return problems;
}

function decisionProblems(text: string): string[] {
  const problems: string[] = [];
  const found = [...text.matchAll(/^### DECISION (\d+)\b/gm)].map((m) => Number(m[1]));
  const expected = countTo(DECISION_COUNT);
  if (found.join(",") !== expected.join(",")) {
    const missing = expected.filter((n) => !found.includes(n));
    problems.push(`decisions must be DECISION 1..${DECISION_COUNT} in order; found [${found.join(", ")}]`
      + (missing.length > 0 ? `; missing DECISION ${missing.join(", DECISION ")}` : "; out of order or repeated"));
  }
  for (const n of found) {
    const body = section(text, new RegExp(`^### DECISION ${n}\\b`, "m"), ENTRY_LEVEL) ?? "";
    const taken = readings(body);
    if (taken.length === 0) problems.push(`DECISION ${n} has no reading: a fenced block whose first line is "$ <command>" with its output beneath`);
    if (!/^\*\*Decision:\*\*\s*\S/m.test(body)) problems.push(`DECISION ${n} states no decision ("**Decision:** ...")`);
    if (!/^\*\*Owner:\*\*\s*\S/m.test(body)) problems.push(`DECISION ${n} names no owner ("**Owner:** ...")`);
    if (RULED_DECISIONS.includes(n) && !/^\*\*RULED\b[^\n]*#69/m.test(body)) {
      problems.push(`DECISION ${n} does not state the ruling it records and cite #69 ("**RULED (#69, …)**")`);
    }
    if (n === LICENCE_DECISION && !taken.some((r) => /licen[cs]e/i.test(r.command))) {
      problems.push(`DECISION ${n} carries no relicensing reading: no reading whose command names the licence`);
    }
    if (n === 1) problems.push(...decisionOneProblems(body));
  }
  return problems;
}

function askProblems(text: string): string[] {
  const part = section(text, /^## The three asks of #69\b/m, 2);
  if (part === undefined) return ["no section \"The three asks of #69\""];
  const problems: string[] = [];
  for (const a of ASKS) {
    const one = section(part, new RegExp(`^### ASK \\(${a}\\)`, "m"), ENTRY_LEVEL);
    if (one === undefined) problems.push(`ASK (${a}) is missing`);
    else if (readings(one).length === 0) problems.push(`ASK (${a}) has no reading`);
  }
  const documents = section(part, /^### The documents layer\b/m, ENTRY_LEVEL);
  if (documents === undefined) problems.push("no \"The documents layer\" section");
  else {
    if (readings(documents).length === 0) problems.push("the documents layer has no reading");
    if (!/FIRST PUBLISH/.test(documents) || !/critical path/.test(documents)) problems.push("the documents layer does not say its move is a FIRST PUBLISH on the critical path");
  }
  return problems;
}

/** The paragraph that says what this ADR changes in 0039 (Done-when 5): ONE paragraph, naming 0039 and whether its readings need a re-read. */
function supersessionProblems(text: string): string[] {
  const part = section(text, /^## What this changes in ADR 0039\s*$/m, 2);
  if (part === undefined) return ["no \"What this changes in ADR 0039\" section"];
  const paragraphs = part.split("\n").slice(1).join("\n").split(/\n\s*\n/).filter((p) => p.trim() !== "");
  const problems: string[] = [];
  if (paragraphs.length !== 1) problems.push(`the 0039 section must be ONE paragraph; found ${paragraphs.length}`);
  if (!/re-?read/i.test(part)) problems.push("the 0039 section does not say whether its item-by-item readings need a re-read");
  return problems;
}

/** One appendix entry's body, checked as the row it will become: the three headings `product-manager` files under. */
function rowBodyProblems(id: string, body: string): string[] {
  const problems: string[] = [];
  const part = (name: string): string | undefined => section(`\n${body}`, new RegExp(`^## ${name}\\s*$`, "m"), 2);
  const region = part("Region");
  const acceptance = part("Acceptance");
  if (region === undefined) problems.push(`CHILD ${id} has no "## Region"`);
  else if (!fencedBlocks(region).some((b) => b.lines.some((l) => l.trim() !== ""))) problems.push(`CHILD ${id}'s Region lists no path`);
  if (acceptance === undefined) problems.push(`CHILD ${id} has no "## Acceptance"`);
  else if (!fencedBlocks(acceptance).some((b) => b.info === "bash" && b.lines.some((l) => l.trim() !== ""))) {
    problems.push(`CHILD ${id}'s Acceptance has no non-empty bash command`);
  }
  if (part("Done-when") === undefined) problems.push(`CHILD ${id} has no "## Done-when"`);
  return problems;
}

/** Entry ids in the order found, and whether the required ones appear as an in-order subsequence. */
function appendixProblems(text: string): string[] {
  const appendix = section(text, /^## Appendix\b/m, 2);
  if (appendix === undefined) return ["no \"## Appendix\" holding the child rows"];
  const problems: string[] = [];
  const found = [...appendix.matchAll(/^### (?:CHILD|NEW ROW) (\S+)/gm)].map((m) => m[1]!);
  let at = -1;
  for (const id of REQUIRED_CHILDREN) {
    const next = found.indexOf(id, at + 1);
    if (next < 0) problems.push(`appendix has no CHILD ${id} (or it is out of order); found [${found.join(", ")}]`);
    else at = next;
  }
  for (const id of found) {
    const rowText = section(appendix, new RegExp(`^### (?:CHILD|NEW ROW) ${id}(?![\\w])`, "m"), ENTRY_LEVEL) ?? "";
    if (!/^\*\*Verdict:?\s*(?:CONFIRMED|AMENDED|NEW)\b/m.test(rowText)) problems.push(`CHILD ${id} states no verdict ("**Verdict: CONFIRMED|AMENDED|NEW …**")`);
    const bodies = fencedBlocks(rowText).filter((b) => b.info === "markdown");
    if (bodies.length !== 1) problems.push(`CHILD ${id} must hold exactly one fenced markdown body; found ${bodies.length}`);
    else problems.push(...rowBodyProblems(id, bodies[0]!.lines.join("\n")));
  }
  return problems;
}

/**
 * Paths an appendix Region may name that do not exist yet because THE ROW CREATES THEM. Named here, so a misspelt path is refused
 * rather than reserved: a Region must name files that exist or are reserved by it (Done-when 4 of #2615).
 */
const RESERVED_BY_A_ROW: readonly RegExp[] = [
  /^\.agent-org\//,
  /^packages\/agent-org\/src\/(?:lib\/|project-config\.mjs$|project-vocabulary\.mjs$|host-config\.mjs$|cause-declaration\.mjs$|shadow-gate\.mjs$)/,
  /^packages\/lab\/src\/packaging\/(?:project-config|multi-board-claim|multi-board-gate|project-vocabulary|project-roles|host-project-paths|shadow-gate|agent-org-extraction|agent-org-outward-edges)\.test\.ts$/,
];

/** The paths each appendix entry's Region lists: the lines of the FIRST fenced block under its `## Region`. */
function regionPaths(text: string): string[] {
  const appendix = section(text, /^## Appendix\b/m, 2) ?? "";
  return fencedBlocks(appendix).filter((b) => b.info === "markdown").flatMap((body) => {
    const region = section(`\n${body.lines.join("\n")}`, /^## Region\s*$/m, 2) ?? "";
    return (fencedBlocks(region)[0]?.lines ?? []).map((l) => l.trim()).filter((l) => l !== "");
  });
}

/** Every path in every appendix Region must exist (`exists`) or be reserved by the row that creates it. */
function regionPathProblems(text: string, exists: (path: string) => boolean): string[] {
  return regionPaths(text)
    .filter((path) => !exists(path) && !RESERVED_BY_A_ROW.some((r) => r.test(path)))
    .map((path) => `Region path "${path}" neither exists nor is reserved by a row`);
}

/**
 * Every check, as a list of what is missing. EMPTY means the document is complete in the ways this can see.
 * Also takes the README's text ("the index lists it" is a fact about a second file) and a way to ask whether a path exists.
 */
export function checkAdr(text: string, indexText: string, fileName = ADR_FILE, exists: (path: string) => boolean = () => true): string[] {
  const problems: string[] = [];
  for (const [name, heading] of PRESCRIBED_SECTIONS) {
    if (!heading.test(text)) problems.push(`prescribed section missing: ${name}`);
  }
  if (!/^\*\*Measured at commit `[0-9a-f]{9,40}`/m.test(text)) {
    problems.push("no \"**Measured at commit `<sha>`**\" line: a reading is a moment and must name its commit");
  }
  if (!/still OPEN/.test(text)) problems.push("does not say the two questions still open on #69 are open (and nothing more)");
  problems.push(...supersessionProblems(text));
  problems.push(...decisionProblems(text));
  problems.push(...askProblems(text));
  const sum = section(text, /^## The sum\s*$/m, 2);
  if (sum === undefined || !/^\*\*Sum:\*\*[^\n]*\b\d+ rows\b/m.test(sum)) problems.push("no \"**Sum:** ... N rows\" sentence in \"## The sum\"");
  if (sum === undefined || !/^\*\*First two:\*\*\s*\S/m.test(sum)) problems.push("no \"**First two:**\" line naming the rows that go first in \"## The sum\"");
  problems.push(...appendixProblems(text));
  problems.push(...regionPathProblems(text, exists));
  if (!indexText.includes(`](./${fileName})`)) problems.push(`docs/adr/README.md does not index ${fileName}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// THE HAND-WRITTEN COMPLETE FIXTURE. It is small on purpose and is not the ADR: if the real document changes
// shape, the fixture still says what "complete" means to this check.
// ---------------------------------------------------------------------------------------------------------

function fixtureDecision(n: number, options: FixtureOptions): string {
  const reading = n === options.proseReadingIn
    ? "The count was seven files, taken by a grep."
    : [FENCE, n === LICENCE_DECISION && !options.noLicenceReading ? "$ git log --format=%ae -- pkg | sort -u  # licence and authors" : "$ git grep -l needle | wc -l", "7", FENCE].join("\n");
  const surfaces = n === 1
    ? [
      countTo(SURFACE_COUNT).map((s) => `**Surface ${s} — ${s + 2} files.**`).join(" "),
      "",
      options.noSum ? "**Sum:** several." : "**Sum:** 9 distinct files and 10 rows, 3b and 3c in parallel.",
    ].join("\n")
    : "";
  const ruled = RULED_DECISIONS.includes(n) && n !== options.unruled ? "**RULED (#69, 07:20Z):** recorded, not reopened." : "";
  return [`### DECISION ${n} — a fixture decision`, "", reading, "", surfaces, "", ruled, "", "**Decision:** it becomes two things.", "", "**Owner:** engineer.", ""].join("\n");
}

function fixtureAsk(a: string, options: FixtureOptions): string {
  const reading = a === "b" && options.askWithoutReading
    ? "The wording lives in one file."
    : [FENCE, "$ git grep -l needle | wc -l", "7", FENCE].join("\n");
  return [`### ASK (${a}) — a fixture ask`, "", reading, ""].join("\n");
}

function fixtureRow(id: string, options: { acceptance?: boolean; path?: string } = {}): string {
  const acceptance = options.acceptance === false ? "" : ["## Acceptance", "", "```bash", "npx rstest run --include x.test.ts", "```", ""].join("\n");
  return [
    `### CHILD ${id}`,
    "",
    `**Verdict: AMENDED, small.**`,
    "",
    OUTER_FENCE + "markdown",
    "## Region",
    "",
    "```",
    options.path ?? "docs/x.md",
    "```",
    "",
    acceptance,
    "## Done-when",
    "",
    "1. It is done.",
    OUTER_FENCE,
    "",
  ].join("\n");
}

interface FixtureOptions {
  without?: number; proseReadingIn?: number; rowWithoutAcceptance?: string; unruled?: number; noLicenceReading?: boolean;
  noSum?: boolean; askWithoutReading?: boolean; noSupersession?: boolean; twoParagraphSupersession?: boolean; badRegionPath?: boolean;
}

function fixtureAdr(options: FixtureOptions = {}): string {
  const decisions = countTo(DECISION_COUNT).filter((n) => n !== options.without).map((n) => fixtureDecision(n, options));
  const rows = [...REQUIRED_CHILDREN, "3g"].map((id) => fixtureRow(id, {
    acceptance: id !== options.rowWithoutAcceptance,
    path: options.badRegionPath === true && id === "3g" ? "docs/nope.md" : undefined,
  }));
  const supersession = options.noSupersession === true ? [] : [
    "## What this changes in ADR 0039", "",
    options.twoParagraphSupersession === true ? "It withdraws a paragraph.\n\nItems 1 to 4 need a re-read." : "It withdraws a paragraph, and items 1 to 4 need a re-read.", "",
  ];
  return [
    "# ADR 9999: a fixture",
    "",
    "**Measured at commit `c77c1ba0f`, 2026-09-26.** Two questions on #69 are still OPEN.",
    "",
    ...supersession,
    "## Context", "", "c", "",
    "## Decision", "", "d", "",
    "## The nine decisions", "",
    ...decisions,
    "## The three asks of #69 (07:53Z), and the documents layer", "",
    ...ASKS.map((a) => fixtureAsk(a, options)),
    "### The documents layer, and the placeholder repositories", "",
    FENCE, "$ npm view pkg version", "E404", FENCE, "", "Its move is a FIRST PUBLISH on the critical path.", "",
    "## The sum", "",
    "**Sum:** the work is 10 rows.", "",
    "**First two:** 3a and 3g.", "",
    "## Consequences (including the ones the chairman will not like)", "", "c", "",
    "## Alternatives rejected", "", "a", "",
    "## What would falsify this", "", "f", "",
    "## Appendix: the children", "",
    ...rows,
  ].join("\n");
}

const FIXTURE_INDEX = `| [9999](./${ADR_FILE}) | fixture | accepted |`;
/** In the fixture every path exists except the one a control plants. */
const FIXTURE_EXISTS = (path: string): boolean => path !== "docs/nope.md";

// ---------------------------------------------------------------------------------------------------------
// POSITIVE CONTROL: this is where the emptiness assertions in the real-document test below point. The check
// must PASS a complete document and REFUSE each broken one, naming what is missing.
// ---------------------------------------------------------------------------------------------------------

test("control: the complete fixture PASSES, so the check does not refuse everything", () => {
  assert.deepEqual(checkAdr(fixtureAdr(), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS), []);
});

test("control: a decision removed is REFUSED, naming the decision", () => {
  const problems = checkAdr(fixtureAdr({ without: 5 }), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS);
  assert.ok(problems.some((p) => /missing DECISION 5\b/.test(p)), problems.join("\n"));
});

test("control: a reading turned into prose is REFUSED, naming the decision, and only that", () => {
  const problems = checkAdr(fixtureAdr({ proseReadingIn: 3 }), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS);
  assert.deepEqual(problems.filter((p) => p.startsWith("DECISION 3 has no reading")).length, 1, problems.join("\n"));
  assert.equal(problems.length, 1, `only the prose reading may be reported:\n${problems.join("\n")}`);
});

test("control: an appendix entry without an Acceptance is REFUSED, naming the child", () => {
  const problems = checkAdr(fixtureAdr({ rowWithoutAcceptance: "3d" }), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS);
  assert.deepEqual(problems, ['CHILD 3d has no "## Acceptance"']);
});

test("control: the three breakages the row names, together, are each REPORTED, none masking another", () => {
  const problems = checkAdr(fixtureAdr({ without: 2, proseReadingIn: 4, rowWithoutAcceptance: "5" }), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS);
  for (const wanted of [/missing DECISION 2\b/, /^DECISION 4 has no reading/, /^CHILD 5 has no "## Acceptance"/]) {
    assert.ok(problems.some((p) => wanted.test(p)), `${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

test("control: each ruling, the licence reading, the sum, an ask's reading and the 0039 paragraph REFUSE when absent", () => {
  const cases: [string, FixtureOptions, RegExp][] = [
    ["a ruling not stated", { unruled: 7 }, /DECISION 7 does not state the ruling/],
    ["the licence reading", { noLicenceReading: true }, /DECISION 7 carries no relicensing reading/],
    ["decision 1's sum", { noSum: true }, /DECISION 1 has no "\*\*Sum:\*\*"/],
    ["ask (b)'s reading", { askWithoutReading: true }, /ASK \(b\) has no reading/],
    ["the 0039 paragraph", { noSupersession: true }, /no "What this changes in ADR 0039" section/],
    ["a one-paragraph 0039 section", { twoParagraphSupersession: true }, /must be ONE paragraph/],
    ["a Region path that neither exists nor is reserved", { badRegionPath: true }, /Region path "docs\/nope\.md" neither exists/],
  ];
  for (const [what, options, wanted] of cases) {
    const problems = checkAdr(fixtureAdr(options), FIXTURE_INDEX, ADR_FILE, FIXTURE_EXISTS);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

test("control: a section, the commit, the open-questions line, a verdict and the index each REFUSE when absent", () => {
  const full = fixtureAdr();
  const cases: [string, string, string, RegExp][] = [
    ["a prescribed section", full.replace("## Alternatives rejected", "## Other ideas"), FIXTURE_INDEX, /Alternatives rejected/],
    ["the commit", full.replace("**Measured at commit `c77c1ba0f`, 2026-09-26.**", ""), FIXTURE_INDEX, /Measured at commit/],
    ["the open-questions line", full.replace("still OPEN", "settled"), FIXTURE_INDEX, /still open on #69/],
    ["a verdict", full.replace("**Verdict: AMENDED, small.**", ""), FIXTURE_INDEX, /states no verdict/],
    ["the sum sentence", full.replace("**Sum:** the work is 10 rows.", "**Sum:** several."), FIXTURE_INDEX, /"\*\*Sum:\*\* \.\.\. N rows"/],
    ["a surface size", full.replace("**Surface 3 — 5 files.**", "**Surface 3 — large.**"), FIXTURE_INDEX, /does not size surface 3/],
    ["a required child", full.replace("### CHILD 3c\n", "### CHILD 3z\n"), FIXTURE_INDEX, /no CHILD 3c/],
    ["the index entry", full, "| nothing |", /does not index/],
  ];
  for (const [what, text, index, wanted] of cases) {
    const problems = checkAdr(text, index, ADR_FILE, FIXTURE_EXISTS);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

// ---------------------------------------------------------------------------------------------------------
// THE REAL DOCUMENT.
// ---------------------------------------------------------------------------------------------------------

test("ADR 0040 has all nine decisions, each with a reading, the three asks and every child row of the appendix", () => {
  const text = readFileSync(`${ADR_DIR}${ADR_FILE}`, "utf8");
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  // The population is proved non-empty by the controls above (the complete fixture passes and each broken one reports);
  // this asserts the real document reports nothing, and that it really holds nine decisions and the required children.
  assert.equal([...text.matchAll(/^### DECISION \d+\b/gm)].length, DECISION_COUNT);
  const appendix = section(text, /^## Appendix\b/m, 2) ?? "";
  for (const id of REQUIRED_CHILDREN) assert.ok(new RegExp(`^### CHILD ${id}\\b`, "m").test(appendix), `CHILD ${id} is in the appendix`);
  assert.deepEqual(checkAdr(text, index, ADR_FILE, (path) => existsSync(`${REPO_ROOT}${path}`)), []);
});
