/**
 * ADR 0039 (#2614, child 2 of #69): THE ORG MACHINERY OF THE SPLIT, WRITTEN DOWN BEFORE ANY OF IT IS BUILT.
 *
 * The ADR's deliverable is an INVENTORY: ten items, each with a reading taken by a command, a size a reader
 * can recheck, a decision, an owner, and a ready-to-file row body in the appendix. An inventory that lost an
 * item, or whose "reading" became a sentence, or whose row body lost its Acceptance would still LOOK finished,
 * and `product-manager` files rows from it. So this reads the document and refuses each of those.
 *
 * WHAT IT DOES NOT PROVE, said here so nobody cites it as more: it cannot re-take a reading (a reading is a
 * moment, at the commit the ADR names), so it proves a reading IS PRESENT with output beneath it, not that the
 * output is right. And it cannot judge a decision. A reader who doubts a number re-runs its command at the
 * commit the ADR names; that is what the commit is for.
 *
 * THE CHECK IS A PURE FUNCTION over text, `checkAdr`, so the same checks run over a hand-written complete
 * fixture (must PASS) and over that fixture with one thing broken at a time (each must be REFUSED, and must
 * name what is missing). A check that refuses everything and one that passes anything both fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADR_FILE = "0039-the-split-is-mostly-org-machinery.md";
const ADR_DIR = fileURLToPath(new URL("../../../../docs/adr/", import.meta.url));

/** The ten items `ceo` named (#69, 2026-09-26), in the order the ADR states them. */
const ITEM_COUNT = 10;

/** The five sections `docs/adr/README.md` prescribes, by the heading each is written under. */
const PRESCRIBED_SECTIONS: readonly [string, RegExp][] = [
  ["Context", /^## Context\s*$/m],
  ["Decision", /^## Decision\s*$/m],
  ["Consequences", /^## Consequences\b.*$/m],
  ["Alternatives rejected", /^## Alternatives rejected\s*$/m],
  ["What would falsify this", /^## What would falsify this\s*$/m],
];

/** The three findings found by reading, each of which must carry a stated decision. */
const FINDING_COUNT = 3;
const CLAIM_COUNT = 3;

/** `###`: an item, a row and a finding are all third-level headings. */
const ENTRY_LEVEL = 3;

/** 1..n. */
function countTo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

const FENCE = "```";
const OUTER_FENCE = "````";

/**
 * A slice of `text` from the heading matching `start` to the next heading of the same or a higher level.
 * FENCE-AWARE: a row body in the appendix sits inside a fence and carries headings of its own (`## Region`),
 * which are that row's and not the document's, so a heading inside a fence never starts or ends a section.
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
function readingsOf(itemText: string): number {
  return fencedBlocks(itemText).filter((b) => {
    const first = b.lines.findIndex((l) => l.trim() !== "");
    if (first < 0 || !b.lines[first]!.startsWith("$ ")) return false;
    return b.lines.slice(first + 1).some((l) => l.trim() !== "");
  }).length;
}

const SIZE_LINE = /^\*\*Size:\*\*[^\n]*?\b\d[\d,]*\s+(?:\w+\s+){0,3}(?:files?|workflows?)\b/m;

function itemProblems(text: string): string[] {
  const problems: string[] = [];
  const found = [...text.matchAll(/^### ITEM (\d+)\b/gm)].map((m) => Number(m[1]));
  const expected = countTo(ITEM_COUNT);
  if (found.join(",") !== expected.join(",")) {
    const missing = expected.filter((n) => !found.includes(n));
    problems.push(`items must be ITEM 1..${ITEM_COUNT} in order; found [${found.join(", ")}]`
      + (missing.length > 0 ? `; missing ITEM ${missing.join(", ITEM ")}` : "; out of order or repeated"));
  }
  for (const n of found) {
    const body = section(text, new RegExp(`^### ITEM ${n}\\b`, "m"), ENTRY_LEVEL) ?? "";
    if (readingsOf(body) === 0) problems.push(`ITEM ${n} has no reading: a fenced block whose first line is "$ <command>" with its output beneath`);
    if (!SIZE_LINE.test(body)) problems.push(`ITEM ${n} states no size as a number of files or workflows ("**Size:** N files")`);
    if (!/^\*\*Decision:\*\*\s*\S/m.test(body)) problems.push(`ITEM ${n} states no decision ("**Decision:** ...")`);
    if (!/^\*\*Owner:\*\*\s*\S/m.test(body)) problems.push(`ITEM ${n} names no owner ("**Owner:** ...")`);
  }
  return problems;
}

/** One appendix row body, checked as the row it will become: the three headings `product-manager` files under. */
function rowBodyProblems(n: number, body: string): string[] {
  const problems: string[] = [];
  const part = (name: string): string | undefined => section(`\n${body}`, new RegExp(`^## ${name}\\s*$`, "m"), 2);
  const region = part("Region");
  const acceptance = part("Acceptance");
  if (region === undefined) problems.push(`ROW ${n} has no "## Region"`);
  else if (!fencedBlocks(region).some((b) => b.lines.some((l) => l.trim() !== ""))) problems.push(`ROW ${n}'s Region lists no path`);
  if (acceptance === undefined) problems.push(`ROW ${n} has no "## Acceptance"`);
  else if (!fencedBlocks(acceptance).some((b) => b.info === "bash" && b.lines.some((l) => l.trim() !== ""))) {
    problems.push(`ROW ${n}'s Acceptance has no non-empty bash command`);
  }
  if (part("Done-when") === undefined) problems.push(`ROW ${n} has no "## Done-when"`);
  return problems;
}

function appendixProblems(text: string): string[] {
  const appendix = section(text, /^## Appendix\b/m, 2);
  if (appendix === undefined) return ["no \"## Appendix\" holding the row bodies"];
  const problems: string[] = [];
  const found = [...appendix.matchAll(/^### ROW (\d+)\b/gm)].map((m) => Number(m[1]));
  const expected = countTo(ITEM_COUNT);
  if (found.join(",") !== expected.join(",")) {
    problems.push(`appendix must hold ROW 1..${ITEM_COUNT} in order; found [${found.join(", ")}]`);
  }
  for (const n of found) {
    const rowText = section(appendix, new RegExp(`^### ROW ${n}\\b`, "m"), ENTRY_LEVEL) ?? "";
    const bodies = fencedBlocks(rowText).filter((b) => b.info === "markdown");
    if (bodies.length !== 1) problems.push(`ROW ${n} must hold exactly one fenced markdown body; found ${bodies.length}`);
    else problems.push(...rowBodyProblems(n, bodies[0]!.lines.join("\n")));
  }
  return problems;
}

function decidedProblems(text: string, spec: { heading: RegExp; entry: RegExp; count: number; noun: string }): string[] {
  const { heading, entry, count, noun } = spec;
  const part = section(text, heading, 2);
  if (part === undefined) return [`no section for the ${noun}s`];
  const entries = [...part.matchAll(entry)].length;
  const problems: string[] = [];
  if (entries !== count) problems.push(`the ${noun}s section must hold exactly ${count} entries; found ${entries}`);
  for (let i = 1; i <= count; i++) {
    const one = section(part, new RegExp(`^### ${noun} ${i}\\b`, "m"), ENTRY_LEVEL);
    if (one === undefined) problems.push(`${noun} ${i} is missing`);
    else if (!/^\*\*Decision:\*\*\s*\S/m.test(one)) problems.push(`${noun} ${i} states no decision ("**Decision:** ...")`);
  }
  return problems;
}

/**
 * Every check, as a list of what is missing. EMPTY means the document is complete in the ways this can see.
 * Also takes the README's text, because "the index lists it" is a fact about a second file.
 */
export function checkAdr(text: string, indexText: string, fileName = ADR_FILE): string[] {
  const problems: string[] = [];
  for (const [name, heading] of PRESCRIBED_SECTIONS) {
    if (!heading.test(text)) problems.push(`prescribed section missing: ${name}`);
  }
  if (!/^\*\*Measured at commit `[0-9a-f]{9,40}`/m.test(text)) {
    problems.push("no \"**Measured at commit `<sha>`**\" line: a reading is a moment and must name its commit");
  }
  problems.push(...itemProblems(text));
  problems.push(...decidedProblems(text, { heading: /^## The three findings\b/m, entry: /^### Finding \d+\b/gm, count: FINDING_COUNT, noun: "Finding" }));
  const claims = section(text, /^## The chairman's three claims\b/m, 2);
  if (claims === undefined) problems.push("no section reading the chairman's three claims against the measurements");
  else if ([...claims.matchAll(/^### Claim \d+\b/gm)].length !== CLAIM_COUNT) {
    problems.push(`the chairman's claims section must answer exactly ${CLAIM_COUNT} claims`);
  }
  if (!/^\*\*Sum:\*\*[^\n]*\b\d+\s+rows\b/m.test(text)) problems.push("no \"**Sum:** ... N rows\" sentence");
  if (!/^\*\*First two:\*\*\s*\S/m.test(text)) problems.push("no \"**First two:**\" line naming the two rows that go first");
  problems.push(...appendixProblems(text));
  if (!indexText.includes(`](./${fileName})`)) problems.push(`docs/adr/README.md does not index ${fileName}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// THE HAND-WRITTEN COMPLETE FIXTURE. It is small on purpose and is not the ADR: if the real document changes
// shape, the fixture still says what "complete" means to this check.
// ---------------------------------------------------------------------------------------------------------

function fixtureItem(n: number): string {
  return [
    `### ITEM ${n} — a fixture item`,
    "",
    `${FENCE}`,
    "$ git grep -l needle | wc -l",
    "7",
    `${FENCE}`,
    "",
    "**Size:** 7 files (the reading above).",
    "",
    "**Decision:** it becomes two things.",
    "",
    "**Owner:** engineer.",
    "",
  ].join("\n");
}

function fixtureRow(n: number, options: { acceptance?: boolean } = {}): string {
  const acceptance = options.acceptance === false ? "" : ["## Acceptance", "", "```bash", "npx rstest run --include x.test.ts", "```", ""].join("\n");
  return [
    `### ROW ${n}`,
    "",
    OUTER_FENCE + "markdown",
    "## What it is",
    "",
    "A fixture row.",
    "",
    "## Region",
    "",
    "```",
    "docs/x.md",
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

interface FixtureOptions { without?: number; proseReadingIn?: number; rowWithoutAcceptance?: number }

function fixtureAdr(options: FixtureOptions = {}): string {
  const items = countTo(ITEM_COUNT)
    .filter((n) => n !== options.without)
    .map((n) => (n === options.proseReadingIn
      ? fixtureItem(n).replace(/```\n\$ [^\n]*\n7\n```/, "The count was seven files, taken by a grep.")
      : fixtureItem(n)));
  const rows = countTo(ITEM_COUNT)
    .map((n) => fixtureRow(n, { acceptance: n !== options.rowWithoutAcceptance }));
  return [
    "# ADR 9999: a fixture",
    "",
    "**Measured at commit `c77c1ba0f`, 2026-09-26.**",
    "",
    "## Context", "", "c", "",
    "## Decision", "", "d", "",
    "## Consequences (including the ones the chairman will not like)", "", "c", "",
    "## Alternatives rejected", "", "a", "",
    "## What would falsify this", "", "f", "",
    "## The ten items", "",
    ...items,
    "## The three findings", "",
    ...countTo(FINDING_COUNT).map((n) => `### Finding ${n}\n\n**Decision:** decided.\n`),
    "## The chairman's three claims read against the measurements", "",
    ...countTo(CLAIM_COUNT).map((n) => `### Claim ${n}\n\nanswered.\n`),
    "## The sum", "",
    "**Sum:** 10 rows.", "",
    "**First two:** rows 1 and 6.", "",
    "## Appendix: the row bodies", "",
    ...rows,
  ].join("\n");
}

const FIXTURE_INDEX = `| [9999](./${ADR_FILE}) | fixture | accepted |`;

// ---------------------------------------------------------------------------------------------------------
// POSITIVE CONTROL: this is where the emptiness assertions in the real-document test below point. The check
// must PASS a complete document and REFUSE each broken one, naming what is missing.
// ---------------------------------------------------------------------------------------------------------

test("control: the complete fixture PASSES, so the check does not refuse everything", () => {
  assert.deepEqual(checkAdr(fixtureAdr(), FIXTURE_INDEX), []);
});

test("control: an item removed is REFUSED, naming the item", () => {
  const problems = checkAdr(fixtureAdr({ without: 5 }), FIXTURE_INDEX);
  assert.ok(problems.some((p) => /missing ITEM 5\b/.test(p)), problems.join("\n"));
});

test("control: a reading turned into prose is REFUSED, naming the item", () => {
  const problems = checkAdr(fixtureAdr({ proseReadingIn: 3 }), FIXTURE_INDEX);
  assert.deepEqual(problems.filter((p) => p.startsWith("ITEM 3 has no reading")).length, 1, problems.join("\n"));
  assert.equal(problems.length, 1, `only the prose reading may be reported:\n${problems.join("\n")}`);
});

test("control: an appendix body without an Acceptance is REFUSED, naming the row", () => {
  const problems = checkAdr(fixtureAdr({ rowWithoutAcceptance: 7 }), FIXTURE_INDEX);
  assert.deepEqual(problems, ['ROW 7 has no "## Acceptance"']);
});

test("control: the three breakages together are each REPORTED, none masking another", () => {
  const problems = checkAdr(fixtureAdr({ without: 2, proseReadingIn: 4, rowWithoutAcceptance: 9 }), FIXTURE_INDEX);
  for (const wanted of [/missing ITEM 2\b/, /^ITEM 4 has no reading/, /^ROW 9 has no "## Acceptance"/]) {
    assert.ok(problems.some((p) => wanted.test(p)), `${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

test("control: a section, a finding's decision, the commit, the sum and the index each REFUSE when absent", () => {
  const full = fixtureAdr();
  const cases: [string, string, string, RegExp][] = [
    ["a prescribed section", full.replace("## Alternatives rejected", "## Other ideas"), FIXTURE_INDEX, /Alternatives rejected/],
    ["a finding's decision", full.replace("### Finding 2\n\n**Decision:** decided.", "### Finding 2\n\nundecided."), FIXTURE_INDEX, /Finding 2 states no decision/],
    ["the commit", full.replace("**Measured at commit `c77c1ba0f`, 2026-09-26.**", ""), FIXTURE_INDEX, /Measured at commit/],
    ["a size", full.replace("**Size:** 7 files (the reading above).", "**Size:** large."), FIXTURE_INDEX, /ITEM 1 states no size/],
    ["the sum", full.replace("**Sum:** 10 rows.", "**Sum:** several."), FIXTURE_INDEX, /Sum/],
    ["the index entry", full, "| nothing |", /does not index/],
  ];
  for (const [what, text, index, wanted] of cases) {
    const problems = checkAdr(text, index);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

// ---------------------------------------------------------------------------------------------------------
// THE REAL DOCUMENT.
// ---------------------------------------------------------------------------------------------------------

test("ADR 0039 has all ten items, each with a reading, a size, a decision, an owner and a row body", () => {
  const text = readFileSync(`${ADR_DIR}${ADR_FILE}`, "utf8");
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  // The population is proved non-empty by the control above (the complete fixture passes and each broken
  // one reports); this asserts the real document reports nothing, and that it really holds ten items.
  assert.equal([...text.matchAll(/^### ITEM \d+\b/gm)].length, ITEM_COUNT);
  assert.deepEqual(checkAdr(text, index), []);
});
