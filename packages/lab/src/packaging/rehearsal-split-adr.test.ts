/**
 * ADR 0042 (#3185, child of the chairman's direction of 2026-10-03 on the V1 rehearsal, #928): THE REHEARSAL SPLITS INTO AN
 * AUTOMATED OUTSIDER JOB AND A WEEKLY REVIEW, AND NEITHER IS A GATE BEFORE A PUBLISH.
 *
 * The ADR's deliverable is seven DECISIONS, a COST stated against the first rehearsal's five defects (which an automated job
 * would have caught and which it would not), the sentence that a post-publish check cannot prevent that publish, six
 * alternatives rejected, falsifiers written as readings, and an APPENDIX giving a row number and a blocker for each row that
 * carries it out. A document that lost a decision, softened the cost to a sentence, dropped the post-publish admission, left an
 * alternative out, or listed a row with the wrong blocker would still LOOK finished. So this reads it and refuses each of those.
 *
 * WHAT IT DOES NOT PROVE, said here so nobody cites it as more: it cannot re-take a reading (a reading is a moment, at the
 * commit the ADR names), so it proves a reading IS PRESENT with output beneath it, not that the output is right. It cannot
 * judge a decision, and it does not check that a row in the appendix exists or is blocked by what the appendix says.
 *
 * THE CHECK IS A PURE FUNCTION over text, `checkAdr` (the shape of `continuous-delivery-adr.test.ts`), so the same checks run
 * over a hand-written complete fixture (must PASS) and over that fixture with one thing broken at a time (each must be
 * REFUSED, naming what is missing). A check that refuses everything and one that passes anything both fail here.
 *
 * The section and fence helpers are that file's, copied: it exports neither, and importing a test file runs its tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADR_FILE = "0042-the-v1-rehearsal-splits-into-an-automated-outsider-job-and-a-weekly-review.md";
const ADR_0041_FILE = "0041-every-repository-releases-itself-continuously.md";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ADR_DIR = `${REPO_ROOT}docs/adr/`;

const DECISION_COUNT = 7;
/** What each decision must say in its `**Decision:**` paragraph, so a heading over unrelated prose is refused. */
const DECISION_MARKERS: readonly RegExp[] = [
  /mechanical half/i, /outside the `a11ign` organisation/, /POLLING/, /ONE `regression` row/, /INELIGIBLE/, /ONE pull request/, /WITHDRAWN/,
];
const POST_PUBLISH_DECISION = 4;
/** Done-when's own sentence: decision 4 must say it in terms, not leave it to be inferred. */
const POST_PUBLISH_ADMISSION = /post-publish\s+check\s+cannot\s+prevent\s+THAT\s+publish/i;

/** The first rehearsal's five defects, each of which the cost must classify as caught or not caught by an automated job. */
const FIRST_REHEARSAL_DEFECTS = ["#796", "#801", "#808", "#811", "#812"] as const;
const COST_HEADING = /^### THE COST\b/m;
const COST_DELAY = /follows a publish by up to seven days/i;

/** What Done-when 2 says Alternatives rejected holds at least: what it is, the phrase that shows it, and a sentence the fixture uses. */
const REQUIRED_ALTERNATIVES: readonly { what: string; marker: RegExp; fixtureText: string }[] = [
  { what: "keeping the hand rehearsal as a per-release gate", marker: /hand rehearsal as a per-release gate/i, fixtureText: "Keep the hand rehearsal as a per-release gate." },
  { what: "blocking the next publish on a red verdict", marker: /block the next publish on a red verdict/i, fixtureText: "Block the next publish on a red verdict." },
  { what: "pushing the release by `repository_dispatch`", marker: /`repository_dispatch`/, fixtureText: "Push the release by `repository_dispatch`." },
  { what: "publishing to a pre-release dist-tag, testing, then promoting", marker: /pre-release dist-tag/i, fixtureText: "Publish to a pre-release dist-tag, test, then promote." },
  { what: "using `DanBeckDev/a11ign-v1-rehearsal`", marker: /DanBeckDev\/a11ign-v1-rehearsal/, fixtureText: "Use `DanBeckDev/a11ign-v1-rehearsal`." },
  { what: "using an `a11ign-ai-*` or bot account", marker: /`a11ign-ai-\*` or bot account/, fixtureText: "Use an `a11ign-ai-*` or bot account." },
];

/** The four falsifiers, numbered, and the four things Done-when 3 says must be named UNMEASURED. */
const FALSIFIER_COUNT = 4;
const UNMEASURED_THINGS: readonly [string, RegExp][] = [
  ["the publish-to-run latency", /publish-to-run latency/i],
  ["whether an inactive repository's schedule is disabled", /schedule is disabled/i],
  ["the false-red rate", /false-red rate/i],
  ["what the weekly review yields", /weekly review yields/i],
];

/** Done-when 5: each row the appendix must name, with what it must say it is blocked by (a pattern per blocker; `nothing` for none). */
const APPENDIX_ROWS: readonly { row: number; carries: readonly number[]; blockedBy: readonly RegExp[] }[] = [
  { row: 3181, carries: [2, 3, 4], blockedBy: [/\bnothing\b/i] },
  { row: 3182, carries: [2, 3], blockedBy: [/#3181\b/, /chairman/i] },
  { row: 3183, carries: [5], blockedBy: [/\bnothing\b/i] },
  { row: 3184, carries: [1, 4, 6], blockedBy: [/#3181\b/, /#3182\b/, /#3160\b/, /#3185\b/] },
  { row: 3130, carries: [7], blockedBy: [/#3184\b/] },
];

/** The five sections `docs/adr/README.md` prescribes, by the heading each is written under. */
const PRESCRIBED_SECTIONS: readonly [string, RegExp][] = [
  ["Context", /^## Context\s*$/m],
  ["Decision", /^## Decision\s*$/m],
  ["Consequences", /^## Consequences\b.*$/m],
  ["Alternatives rejected", /^## Alternatives rejected\s*$/m],
  ["What would falsify this", /^## What would falsify this\s*$/m],
];

const ENTRY_LEVEL = 3;
/** How much of a command a refusal quotes. */
const COMMAND_PREVIEW = 80;
const FENCE = "```";

/** 1..n. */
function countTo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/**
 * A slice of `text` from the heading matching `start` to the next heading of the same or a higher level.
 * FENCE-AWARE: a heading inside a fenced block (a reading's output) is not the document's, so it never starts or ends a section.
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

/** Every fenced block in `text`, as its info string and its lines. */
function fencedBlocks(text: string): { info: string; lines: string[] }[] {
  const blocks: { info: string; lines: string[] }[] = [];
  let open: { fence: string; info: string; lines: string[] } | undefined;
  for (const line of text.split("\n")) {
    const opener = /^(`{3,})(.*)$/.exec(line);
    if (!open && opener) open = { fence: opener[1]!, info: opener[2]!.trim(), lines: [] };
    else if (open && line.trim() === open.fence) {
      blocks.push({ info: open.info, lines: open.lines });
      open = undefined;
    } else if (open) open.lines.push(line);
  }
  return blocks;
}

/**
 * Every command in a fenced block: a line that starts `$ <command>`, with whether real output sits beneath it before the next
 * command. A block may hold several commands, and EACH is a reading only if it has output of its own.
 */
function commandBlocks(text: string): { command: string; hasOutput: boolean }[] {
  const found: { command: string; hasOutput: boolean }[] = [];
  for (const b of fencedBlocks(text)) {
    const starts = b.lines.flatMap((l, i) => (l.startsWith("$ ") ? [i] : []));
    if (b.lines.findIndex((l) => l.trim() !== "") !== starts[0]) continue;
    starts.forEach((at, k) => {
      const output = b.lines.slice(at + 1, starts[k + 1] ?? b.lines.length);
      found.push({ command: b.lines[at]!.slice(2), hasOutput: output.some((l) => l.trim() !== "") });
    });
  }
  return found;
}

/** Decision `n`'s text, from its heading to the next decision (or the end of `## Decision`). */
function decisionBody(text: string, n: number): string {
  return section(text, new RegExp(`^### DECISION ${n}\\b`, "m"), ENTRY_LEVEL) ?? "";
}

/** The `**Decision:**` paragraph of a decision body, up to the first blank line. */
function decidedParagraph(body: string): string | undefined {
  return /^\*\*Decision:\*\*\s*(\S[^\n]*(?:\n(?!\n)[^\n]*)*)/m.exec(body)?.[1];
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
    const body = decisionBody(text, n);
    if (commandBlocks(body).filter((c) => c.hasOutput).length === 0) {
      problems.push(`DECISION ${n} has no reading: a fenced block whose first line is "$ <command>" with its output beneath`);
    }
    const decided = decidedParagraph(body);
    if (decided === undefined) problems.push(`DECISION ${n} states no decision ("**Decision:** ...")`);
    else if (DECISION_MARKERS[n - 1] !== undefined && !DECISION_MARKERS[n - 1]!.test(decided)) {
      problems.push(`DECISION ${n} does not say what it must (${DECISION_MARKERS[n - 1]})`);
    }
    if (!/^\*\*Owner:\*\*\s*\S/m.test(body)) problems.push(`DECISION ${n} names no owner ("**Owner:** ...")`);
  }
  return problems;
}

/** A reading with a command and no output beneath it is a sentence wearing a fence, wherever it sits in the document. */
function emptyReadingProblems(text: string): string[] {
  return commandBlocks(text).filter((c) => !c.hasOutput).map((c) => `a reading has a command and no output beneath it: $ ${c.command.slice(0, COMMAND_PREVIEW)}`);
}

/** Decision 4 must SAY a post-publish check cannot prevent that publish, in its own decision paragraph. */
function postPublishProblems(text: string): string[] {
  const decided = decidedParagraph(decisionBody(text, POST_PUBLISH_DECISION)) ?? "";
  return POST_PUBLISH_ADMISSION.test(decided) ? [] : [`DECISION ${POST_PUBLISH_DECISION} does not say that a post-publish check cannot prevent THAT publish`];
}

/** The defect's table row (`| #796 | ...`) from the cost section, or undefined. */
function defectRow(cost: string, defect: string): string | undefined {
  return cost.split("\n").find((l) => l.startsWith(`| ${defect} |`));
}

/**
 * The cost: it must say a judgement now FOLLOWS a publish, and classify each of the first rehearsal's five defects as caught or
 * not caught by an automated job, naming at least one of each (a table of only one kind has not said what is lost).
 */
function costProblems(text: string): string[] {
  const cost = section(text, COST_HEADING, ENTRY_LEVEL);
  if (cost === undefined) return ['no "### THE COST" under Consequences'];
  const problems: string[] = [];
  if (!COST_DELAY.test(cost)) problems.push("THE COST does not say a judgement now follows a publish by up to seven days");
  const kinds = new Set<string>();
  for (const defect of FIRST_REHEARSAL_DEFECTS) {
    const row = defectRow(cost, defect);
    if (row === undefined) problems.push(`THE COST names no row for the first rehearsal's defect ${defect}`);
    else if (/\bNOT CAUGHT\b/.test(row)) kinds.add("not");
    else if (/\bCAUGHT\b/.test(row)) kinds.add("caught");
    else problems.push(`THE COST does not say whether an automated job would have caught ${defect} ("CAUGHT" or "NOT CAUGHT")`);
  }
  if (!kinds.has("caught")) problems.push("THE COST names no defect an automated job would have CAUGHT");
  if (!kinds.has("not")) problems.push("THE COST names no defect an automated job would NOT have caught");
  return problems;
}

function alternativeProblems(text: string): string[] {
  const part = section(text, /^## Alternatives rejected\s*$/m, 2) ?? "";
  return REQUIRED_ALTERNATIVES.filter((a) => !a.marker.test(part)).map((a) => `Alternatives rejected does not hold ${a.what}`);
}

/** Four numbered falsifiers, and the four UNMEASURED things named as such. */
function falsifierProblems(text: string): string[] {
  const part = section(text, /^## What would falsify this\s*$/m, 2) ?? "";
  const numbered = new Set([...part.matchAll(/\*\*Falsified if\*\* \((\d+)\)/g)].map((m) => Number(m[1])));
  const problems = countTo(FALSIFIER_COUNT).filter((n) => !numbered.has(n)).map((n) => `"What would falsify this" has no falsifier (${n}) ("**Falsified if** (${n}) ...")`);
  const unmeasured = /\*\*UNMEASURED[^\n]*(?:\n(?!\n)[^\n]*)*/.exec(part)?.[0];
  if (unmeasured === undefined) return [...problems, '"What would falsify this" names nothing UNMEASURED ("**UNMEASURED** ...")'];
  return [...problems, ...UNMEASURED_THINGS.filter(([, marker]) => !marker.test(unmeasured)).map(([what]) => `UNMEASURED does not name ${what}`)];
}

/** The appendix: one `### ROW <n>` per required row, each carrying its decisions and saying what blocks it; every decision carried. */
function appendixProblems(text: string, required: typeof APPENDIX_ROWS): string[] {
  const appendix = section(text, /^## Appendix\b/m, 2);
  if (appendix === undefined) return ['no "## Appendix" naming the rows filed beside the ADR'];
  const problems: string[] = [];
  const carried = new Set<number>();
  for (const { row, blockedBy } of required) {
    const body = section(appendix, new RegExp(`^### ROW ${row}\\b`, "m"), ENTRY_LEVEL);
    if (body === undefined) {
      problems.push(`appendix names no row #${row}`);
      continue;
    }
    const carries = /^\*\*Carries:\*\*([^\n]*)/m.exec(body)?.[1] ?? "";
    for (const d of carries.matchAll(/DECISION (\d+)/g)) carried.add(Number(d[1]));
    if (!/DECISION \d+/.test(carries)) problems.push(`ROW ${row} carries no decision ("**Carries:** DECISION n")`);
    const blocked = /^\*\*Blocked by:\*\*\s*(\S[^\n]*)/m.exec(body)?.[1];
    if (blocked === undefined) problems.push(`ROW ${row} says nothing about what blocks it ("**Blocked by:** #m, or nothing")`);
    else for (const wanted of blockedBy.filter((b) => !b.test(blocked))) problems.push(`ROW ${row}'s "Blocked by" does not say ${wanted}`);
  }
  for (const d of countTo(DECISION_COUNT).filter((n) => !carried.has(n))) problems.push(`no row in the appendix carries DECISION ${d}`);
  return problems;
}

/**
 * Every check, as a list of what is missing. EMPTY means the document is complete in the ways this can see.
 * Also takes the README's text ("the index lists it" is a fact about a second file).
 */
export function checkAdr(text: string, indexText: string, fileName = ADR_FILE, required = APPENDIX_ROWS): string[] {
  const problems: string[] = [];
  for (const [name, heading] of PRESCRIBED_SECTIONS) {
    if (!heading.test(text)) problems.push(`prescribed section missing: ${name}`);
  }
  if (!/^\*\*Measured at commit `[0-9a-f]{9,40}`/m.test(text)) {
    problems.push('no "**Measured at commit `<sha>`**" line: a reading is a moment and must name its commit');
  }
  problems.push(...decisionProblems(text), ...postPublishProblems(text), ...emptyReadingProblems(text), ...costProblems(text), ...alternativeProblems(text));
  problems.push(...falsifierProblems(text), ...appendixProblems(text, required));
  if (!indexText.includes(`](./${fileName})`)) problems.push(`docs/adr/README.md does not index ${fileName}`);
  return problems;
}

/** Done-when 4: ADR 0041's Status carries a pointer to this ADR, dated. */
export function pointerProblems(adr0041Text: string, fileName = ADR_FILE): string[] {
  const status = section(adr0041Text, /^## Status\s*$/m, 2) ?? "";
  const pointer = status.split("\n").find((l) => l.includes(`](./${fileName})`));
  if (pointer === undefined) return [`ADR 0041's Status does not point at ${fileName}`];
  return /\b\d{4}-\d{2}-\d{2}\b/.test(pointer) ? [] : ["ADR 0041's pointer to ADR 0042 carries no date"];
}

// ---------------------------------------------------------------------------------------------------------
// THE HAND-WRITTEN COMPLETE FIXTURE. It is small on purpose and is not the ADR: if the real document changes
// shape, the fixture still says what "complete" means to this check.
// ---------------------------------------------------------------------------------------------------------

interface FixtureOptions {
  without?: number;
  proseReadingIn?: number;
  commandOnlyIn?: number;
  secondCommandOnlyIn?: number;
  wrongContentIn?: number;
  noPostPublishAdmission?: boolean;
  noCost?: boolean;
  noDelaySentence?: boolean;
  withoutDefect?: string;
  unclassifiedDefect?: string;
  allCaught?: boolean;
  noneCaught?: boolean;
  withoutAlternative?: string;
  withoutFalsifier?: number;
  noUnmeasured?: boolean;
  withoutUnmeasured?: string;
  withoutRow?: number;
  rowWithoutBlocker?: number;
  rowWithWrongBlocker?: number;
  noAppendix?: boolean;
  uncarriedDecision?: number;
}

const FIXTURE_DECISION_TEXT = [
  "the mechanical half is automated.", "a job outside the `a11ign` organisation.", "the repository learns by POLLING.",
  "a red verdict files ONE `regression` row. A post-publish check cannot prevent THAT publish.", "the review names the INELIGIBLE sessions.",
  "the swap is ONE pull request.", "the hand-rehearsal request is WITHDRAWN.",
];

function fixtureDecision(n: number, options: FixtureOptions): string {
  const reading = n === options.proseReadingIn
    ? "The count was seven files, taken by a grep."
    : n === options.commandOnlyIn ? [FENCE, "$ git grep -l needle | wc -l", FENCE].join("\n")
      : [FENCE, "$ git grep -l needle | wc -l", "7", ...(n === options.secondCommandOnlyIn ? ["$ git grep -l other"] : []), FENCE].join("\n");
  const said = n === options.wrongContentIn ? "something unrelated."
    : n === POST_PUBLISH_DECISION && options.noPostPublishAdmission === true ? "a red verdict files ONE `regression` row."
      : FIXTURE_DECISION_TEXT[n - 1]!;
  return [`### DECISION ${n} — a fixture decision`, "", reading, "", `**Decision:** ${said}`, "", "**Owner:** engineer.", ""].join("\n");
}

function fixtureDefectRow(defect: string, index: number, options: FixtureOptions): string {
  const verdict = options.unclassifiedDefect === defect ? "unsure"
    : options.allCaught === true || (index === 0 && options.noneCaught !== true) ? "CAUGHT: it fails the documented path"
      : "NOT CAUGHT: a judgement about what the report says";
  return `| ${defect} | a fixture defect | ${verdict} |`;
}

function fixtureCost(options: FixtureOptions): string {
  if (options.noCost === true) return "";
  const rows = FIRST_REHEARSAL_DEFECTS.filter((d) => d !== options.withoutDefect).map((d, i) => fixtureDefectRow(d, i, options));
  return [
    "### THE COST, stated", "",
    options.noDelaySentence === true ? "A judgement is later." : "A stranger's judgement now follows a publish by up to seven days.", "",
    "| defect | what | the automated job |", "|---|---|---|", ...rows, "",
  ].join("\n");
}

function fixtureFalsifiers(options: FixtureOptions): string {
  const falsifiers = countTo(FALSIFIER_COUNT).filter((n) => n !== options.withoutFalsifier).map((n) => `- **Falsified if** (${n}) the sky falls.`);
  const things = UNMEASURED_THINGS.filter(([what]) => what !== options.withoutUnmeasured).map(([what]) => what);
  return [
    ...falsifiers, "",
    options.noUnmeasured === true ? "" : `**UNMEASURED:** ${things.join("; ")}.`, "",
  ].join("\n");
}

/** What the fixture says each row is blocked by, written out rather than derived from the patterns the check uses. */
const FIXTURE_BLOCKED: Record<number, string> = {
  3181: "nothing", 3182: "#3181 and the chairman's one ask", 3183: "nothing", 3184: "#3181, #3182, #3160 and #3185", 3130: "#3184",
};

function fixtureAppendix(options: FixtureOptions): string[] {
  if (options.noAppendix === true) return [];
  const rows = APPENDIX_ROWS.filter((r) => r.row !== options.withoutRow).map((r) => {
    const carries = r.carries.map((d) => (d === options.uncarriedDecision ? 1 : d));
    const blocked = r.row === options.rowWithWrongBlocker ? "#1" : FIXTURE_BLOCKED[r.row]!;
    return [
      `### ROW ${r.row} — a fixture row`, "",
      `**Carries:** ${carries.map((d) => `DECISION ${d}`).join(", ")}.`,
      r.row === options.rowWithoutBlocker ? "" : `**Blocked by:** ${blocked}.`, "",
    ].join("\n");
  });
  return ["## Appendix: the rows filed beside this ADR", "", ...rows];
}

function fixtureAdr(options: FixtureOptions = {}): string {
  const decisions = countTo(DECISION_COUNT).filter((n) => n !== options.without).map((n) => fixtureDecision(n, options));
  const alternatives = REQUIRED_ALTERNATIVES.filter((a) => a.what !== options.withoutAlternative).map((a) => `- **${a.fixtureText}** Rejected.`);
  return [
    "# ADR 9999: a fixture",
    "",
    "**Measured at commit `97f7e9371`, 2026-10-03.**",
    "",
    "## Context", "", "c", "",
    "## Decision", "",
    ...decisions,
    "## Consequences", "", "c", "",
    fixtureCost(options),
    "## Alternatives rejected", "",
    ...alternatives,
    "",
    "## What would falsify this", "",
    fixtureFalsifiers(options),
    ...fixtureAppendix(options),
  ].join("\n");
}

const FIXTURE_INDEX = `| [9999](./${ADR_FILE}) | fixture | accepted |`;
const FIXTURE_0041 = `## Status\n\n**EXTENDED 2026-10-03 BY [ADR 9999](./${ADR_FILE}).**\n\n## Context\n`;

// ---------------------------------------------------------------------------------------------------------
// POSITIVE CONTROL: this is where the emptiness assertions in the real-document test below point. The check
// must PASS a complete document and REFUSE each broken one, naming what is missing.
// ---------------------------------------------------------------------------------------------------------

const check = (options: FixtureOptions): string[] => checkAdr(fixtureAdr(options), FIXTURE_INDEX);

test("control: the complete fixture PASSES, so the check does not refuse everything", () => {
  assert.deepEqual(check({}), []);
  assert.deepEqual(pointerProblems(FIXTURE_0041), []);
});

test("control: each thing the row names is REFUSED when broken, naming what is missing", () => {
  const cases: [string, FixtureOptions, RegExp][] = [
    ["a decision missing", { without: 5 }, /missing DECISION 5\b/],
    ["a decision under a heading with other content", { wrongContentIn: 3 }, /^DECISION 3 does not say what it must/],
    ["a reading turned into prose", { proseReadingIn: 3 }, /^DECISION 3 has no reading/],
    ["a reading with a command and no output", { commandOnlyIn: 2 }, /^a reading has a command and no output beneath it/],
    ["a second command in a block with no output", { secondCommandOnlyIn: 2 }, /^a reading has a command and no output beneath it/],
    ["no statement that a post-publish check cannot prevent that publish", { noPostPublishAdmission: true }, /does not say that a post-publish check cannot prevent THAT publish/],
    ["no cost section", { noCost: true }, /no "### THE COST"/],
    ["a cost with no delay stated", { noDelaySentence: true }, /does not say a judgement now follows a publish/],
    ["a cost that omits one of the five defects", { withoutDefect: "#811" }, /names no row for the first rehearsal's defect #811/],
    ["a defect not classified as caught or not", { unclassifiedDefect: "#812" }, /does not say whether an automated job would have caught #812/],
    ["a cost that says every defect was caught", { allCaught: true }, /names no defect an automated job would NOT have caught/],
    ["a cost that says no defect was caught", { noneCaught: true }, /names no defect an automated job would have CAUGHT/],
    ["an alternative not rejected", { withoutAlternative: "blocking the next publish on a red verdict" }, /does not hold blocking the next publish/],
    ["a falsifier missing", { withoutFalsifier: 3 }, /has no falsifier \(3\)/],
    ["nothing named UNMEASURED", { noUnmeasured: true }, /names nothing UNMEASURED/],
    ["one thing left out of UNMEASURED", { withoutUnmeasured: "the false-red rate" }, /UNMEASURED does not name the false-red rate/],
    ["a row not named in the appendix", { withoutRow: 3183 }, /appendix names no row #3183/],
    ["a row that does not say what blocks it", { rowWithoutBlocker: 3182 }, /^ROW 3182 says nothing about what blocks it/],
    ["a row blocked by the wrong thing", { rowWithWrongBlocker: 3184 }, /^ROW 3184's "Blocked by" does not say \/#3181/],
    ["no appendix", { noAppendix: true }, /no "## Appendix"/],
    ["a decision no row carries", { uncarriedDecision: 7 }, /no row in the appendix carries DECISION 7/],
  ];
  for (const [what, options, wanted] of cases) {
    const problems = check(options);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
});

test("control: a prose reading breaks nothing else, and two breakages are each reported without masking the other", () => {
  assert.equal(check({ proseReadingIn: 4 }).length, 1, check({ proseReadingIn: 4 }).join("\n"));
  const both = check({ without: 2, withoutFalsifier: 1 });
  for (const wanted of [/missing DECISION 2\b/, /has no falsifier \(1\)/]) assert.ok(both.some((p) => wanted.test(p)), both.join("\n"));
});

test("control: a section, the commit, the index entry and the 0041 pointer each REFUSE when absent", () => {
  const full = fixtureAdr();
  const cases: [string, string, string, RegExp][] = [
    ["a prescribed section", full.replace("## Alternatives rejected", "## Other ideas"), FIXTURE_INDEX, /Alternatives rejected/],
    ["the commit", full.replace("**Measured at commit `97f7e9371`, 2026-10-03.**", ""), FIXTURE_INDEX, /Measured at commit/],
    ["the index entry", full, "| nothing |", /does not index/],
  ];
  for (const [what, text, index, wanted] of cases) {
    const problems = checkAdr(text, index);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
  assert.deepEqual(pointerProblems("## Status\n\nnothing here\n\n## Context\n"), [`ADR 0041's Status does not point at ${ADR_FILE}`]);
  assert.deepEqual(pointerProblems(FIXTURE_0041.replace("2026-10-03", "recently")), ["ADR 0041's pointer to ADR 0042 carries no date"]);
});

// ---------------------------------------------------------------------------------------------------------
// THE REAL DOCUMENT.
// ---------------------------------------------------------------------------------------------------------

test("ADR 0042 has all seven decisions with readings, the cost against the five defects, the six alternatives, its falsifiers and every row", () => {
  const text = readFileSync(`${ADR_DIR}${ADR_FILE}`, "utf8");
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  // The population is proved non-empty by the controls above (the complete fixture passes and each broken one reports);
  // this asserts the real document reports nothing, and that it really holds seven decisions and exactly the listed rows,
  // so a row added to the appendix without being listed here is as visible as one deleted from it.
  assert.equal([...text.matchAll(/^### DECISION \d+\b/gm)].length, DECISION_COUNT);
  const appendixRows = [...text.matchAll(/^### ROW (\d+)\b/gm)].map((m) => Number(m[1]));
  assert.deepEqual([...appendixRows].sort(), APPENDIX_ROWS.map((r) => r.row).sort());
  assert.deepEqual(checkAdr(text, index), []);
  assert.deepEqual(pointerProblems(readFileSync(`${ADR_DIR}${ADR_0041_FILE}`, "utf8")), []);
});
