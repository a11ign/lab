/**
 * ADR 0041 (#3129, child of #69 and of the chairman's CI/CD direction on #928): EVERY REPOSITORY RELEASES ITSELF, CONTINUOUSLY.
 *
 * The ADR's deliverable is seven DECISIONS, the four DORA metrics each defined with the place its input is read, the seven
 * repositories each with a release mechanism, and an APPENDIX naming every row filed beside it with what it is blocked by. A
 * document that lost a decision, left a metric without an input, dropped a repository, turned a reading into a sentence, or
 * listed a row without its number would still LOOK finished. So this reads it and refuses each of those.
 *
 * WHAT IT DOES NOT PROVE, said here so nobody cites it as more: it cannot re-take a reading (a reading is a moment, at the
 * commit the ADR names), so it proves a reading IS PRESENT with output beneath it, not that the output is right. It cannot
 * judge a decision, and it does not check that a row in the appendix exists or is blocked by what the appendix says.
 *
 * THE CHECK IS A PURE FUNCTION over text, `checkAdr` (the shape of `agent-org-standalone-adr.test.ts`), so the same checks run
 * over a hand-written complete fixture (must PASS) and over that fixture with one thing broken at a time (each must be
 * REFUSED, naming what is missing). A check that refuses everything and one that passes anything both fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADR_FILE = "0041-every-repository-releases-itself-continuously.md";
const ADR_0040_FILE = "0040-agent-org-is-a-standalone-project-agnostic-tool.md";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ADR_DIR = `${REPO_ROOT}docs/adr/`;

/** The seven decisions `ceo` ruled on the chairman's direction, in the order the ADR states them. */
const DECISION_COUNT = 7;
const DORA_DECISION = 7;
/** What each decision must say in its `**Decision:**` paragraph, so a heading over unrelated prose is refused. */
const DECISION_MARKERS: readonly RegExp[] = [
  /its own release pipeline/i, /version pull request/i, /ABSENT/, /Dependabot/, /a move is done when/i, /cut from `main`/i, /never from the org's own state/i,
];
/** The seven repositories, each owed a release mechanism. */
const REPOSITORIES = ["a11ign", "agent-org", "screenreader-worker", "screenreader-fleet", "documents", "lab", "control"] as const;
const MECHANISM = /OIDC|git tag/;
/** The four DORA metrics, each defined with an input. */
const DORA_METRICS = ["DEPLOYMENT FREQUENCY", "LEAD TIME", "CHANGE FAILURE RATE", "TIME TO RESTORE"] as const;
/**
 * Every row the real document's appendix must name: the nine filed beside the ADR (#928, 2026-10-03), the cross-repository
 * refusal test filed for decision 1, the five split moves, the `cli` move, and the monorepo's own release.
 * Listing only the first nine let the other nine be deleted with the Acceptance still green (review of #3144).
 */
const ROWS_FILED_BESIDE: readonly number[] = [
  3130, 3131, 3132, 3133, 3134, 3135, 3136, 3137, 3138,
  3143,
  2701, 2702, 2703, 2704, 2705, 3125,
  3126,
];
/** What the row's Done-when 2 says Alternatives rejected holds at least: what it is, the phrase that shows it, and a sentence the fixture uses. */
const REQUIRED_ALTERNATIVES: readonly { what: string; marker: RegExp; fixtureText: string }[] = [
  { what: "a shared release train", marker: /shared release train/i, fixtureText: "A shared release train for all repositories." },
  { what: "conventional commits with no version commit", marker: /conventional commits/i, fixtureText: "Conventional commits with no version commit." },
  { what: "a direct push of the bump to `main`", marker: /direct push of the version bump/i, fixtureText: "A direct push of the version bump to `main`." },
  { what: "the fleet verdict as a blocking check on every pull request", marker: /blocking check on every pull request/i, fixtureText: "The verdict as a blocking check on every pull request." },
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
    const decided = /^\*\*Decision:\*\*\s*(\S[^\n]*(?:\n(?!\n)[^\n]*)*)/m.exec(body)?.[1];
    if (decided === undefined) problems.push(`DECISION ${n} states no decision ("**Decision:** ...")`);
    else if (DECISION_MARKERS[n - 1] !== undefined && !DECISION_MARKERS[n - 1]!.test(decided)) {
      problems.push(`DECISION ${n} does not say what it must (${DECISION_MARKERS[n - 1]})`);
    }
    if (!/^\*\*Owner:\*\*\s*\S/m.test(body)) problems.push(`DECISION ${n} names no owner ("**Owner:** ...")`);
    if (n === DORA_DECISION) problems.push(...doraProblems(body));
  }
  return problems;
}

/** A reading with a command and no output beneath it is a sentence wearing a fence, wherever it sits in the document. */
function emptyReadingProblems(text: string): string[] {
  return commandBlocks(text).filter((c) => !c.hasOutput).map((c) => `a reading has a command and no output beneath it: $ ${c.command.slice(0, COMMAND_PREVIEW)}`);
}

/** The DORA decision: four metrics, each with a definition and an input that names a command, and the baseline. */
function doraProblems(body: string): string[] {
  const problems: string[] = [];
  const heads = [...body.matchAll(/^#### (.+?)\s*$/gm)].map((m) => m[1]!);
  for (const metric of DORA_METRICS) {
    if (!heads.includes(metric)) {
      problems.push(`DECISION ${DORA_DECISION} does not define the metric ${metric}`);
      continue;
    }
    const part = section(body, new RegExp(`^#### ${metric}\\s*$`, "m"), ENTRY_LEVEL + 1) ?? "";
    if (!/^\*\*Definition:\*\*\s*\S/m.test(part)) problems.push(`${metric} has no definition ("**Definition:** ...")`);
    const input = /^\*\*Input:\*\*([\s\S]*)$/m.exec(part)?.[1] ?? "";
    if (!/`[a-z][^`]*\s[^`]+`/.test(input)) problems.push(`${metric} names no place its input is read: no command in backticks under "**Input:**"`);
  }
  if (!/^\*\*Baseline, stated:\*\*[\s\S]*?\b1 release in 14 days\b[\s\S]*?\bUNDEFINED\b/m.test(body)) {
    problems.push(`DECISION ${DORA_DECISION} states no baseline ("**Baseline, stated:** ... 1 release in 14 days ... UNDEFINED")`);
  }
  return problems;
}

/** Each of the seven repositories is a table row naming a release mechanism (OIDC publish, or a tag plus a GitHub Release). */
function repositoryProblems(text: string): string[] {
  const part = section(text, /^## The seven repositories\s*$/m, 2);
  if (part === undefined) return ['no "## The seven repositories" section'];
  const rows = part.split("\n").filter((l) => l.startsWith("|")).map((l) => l.split("|").map((c) => c.trim()));
  return REPOSITORIES.flatMap((name) => {
    const row = rows.find((cells) => cells[1] === `\`${name}\``);
    if (row === undefined) return [`the seven repositories do not name \`${name}\``];
    return MECHANISM.test(row.slice(2).join(" ")) ? [] : [`\`${name}\` has no release mechanism (OIDC publish, or git tag plus GitHub Release)`];
  });
}

function alternativeProblems(text: string): string[] {
  const part = section(text, /^## Alternatives rejected\s*$/m, 2) ?? "";
  return REQUIRED_ALTERNATIVES.filter((a) => !a.marker.test(part)).map((a) => `Alternatives rejected does not hold ${a.what}`);
}

/** The appendix: one `### ROW <n>` per row, each carrying a decision and saying what blocks it; every decision carried; the required rows named. */
function appendixProblems(text: string, requiredRows: readonly number[]): string[] {
  const appendix = section(text, /^## Appendix\b/m, 2);
  if (appendix === undefined) return ['no "## Appendix" naming the rows filed beside the ADR'];
  const problems: string[] = [];
  const rows = [...appendix.matchAll(/^### ROW (\d+)\b/gm)].map((m) => Number(m[1]));
  for (const n of requiredRows.filter((r) => !rows.includes(r))) problems.push(`appendix names no row #${n}`);
  const carried = new Set<number>();
  for (const n of rows) {
    const body = section(appendix, new RegExp(`^### ROW ${n}\\b`, "m"), ENTRY_LEVEL) ?? "";
    const carries = /^\*\*Carries:\*\*([^\n]*)/m.exec(body)?.[1] ?? "";
    for (const d of carries.matchAll(/DECISION (\d+)/g)) carried.add(Number(d[1]));
    if (!/DECISION \d+/.test(carries)) problems.push(`ROW ${n} carries no decision ("**Carries:** DECISION n")`);
    if (!/^\*\*Blocked by:\*\*\s*\S/m.test(body)) problems.push(`ROW ${n} says nothing about what blocks it ("**Blocked by:** #m, or nothing")`);
  }
  for (const d of countTo(DECISION_COUNT).filter((n) => !carried.has(n))) problems.push(`no row in the appendix carries DECISION ${d}`);
  return problems;
}

/**
 * Every check, as a list of what is missing. EMPTY means the document is complete in the ways this can see.
 * Also takes the README's text ("the index lists it" is a fact about a second file) and the rows the appendix must name.
 */
export function checkAdr(text: string, indexText: string, fileName = ADR_FILE, requiredRows: readonly number[] = []): string[] {
  const problems: string[] = [];
  for (const [name, heading] of PRESCRIBED_SECTIONS) {
    if (!heading.test(text)) problems.push(`prescribed section missing: ${name}`);
  }
  if (!/^\*\*Measured at commit `[0-9a-f]{9,40}`/m.test(text)) {
    problems.push('no "**Measured at commit `<sha>`**" line: a reading is a moment and must name its commit');
  }
  problems.push(...decisionProblems(text), ...emptyReadingProblems(text), ...repositoryProblems(text), ...alternativeProblems(text));
  if (!/\*\*Falsified if\*\*/.test(section(text, /^## What would falsify this\s*$/m, 2) ?? "")) {
    problems.push('"What would falsify this" names nothing ("**Falsified if** ...")');
  }
  problems.push(...appendixProblems(text, requiredRows));
  if (!indexText.includes(`](./${fileName})`)) problems.push(`docs/adr/README.md does not index ${fileName}`);
  return problems;
}

/** Done-when 3: ADR 0040's Status carries a pointer to this ADR, dated. */
export function pointerProblems(adr0040Text: string, fileName = ADR_FILE): string[] {
  const status = section(adr0040Text, /^## Status\s*$/m, 2) ?? "";
  const pointer = status.split("\n").find((l) => l.includes(`](./${fileName})`));
  if (pointer === undefined) return [`ADR 0040's Status does not point at ${fileName}`];
  return /\b\d{4}-\d{2}-\d{2}\b/.test(pointer) ? [] : ["ADR 0040's pointer to ADR 0041 carries no date"];
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
  withoutMetric?: string;
  metricWithoutInput?: string;
  noBaseline?: boolean;
  withoutRepository?: string;
  repositoryWithoutMechanism?: string;
  withoutAlternative?: string;
  noFalsifier?: boolean;
  withoutRow?: number;
  rowWithoutBlocker?: number;
  noAppendix?: boolean;
  uncarriedDecision?: number;
}

const FIXTURE_FIRST_ROW = 100;
const FIXTURE_ROWS = countTo(DECISION_COUNT).map((i) => FIXTURE_FIRST_ROW + i);
/** The fixture's row `i` carries decision `i`, so removing the row that carries the last decision leaves it uncarried. */
const FIXTURE_DECISION_TEXT = [
  "each repository has its own release pipeline.", "the release workflow opens a version pull request.", "a verdict that is ABSENT is not a pass.",
  "Dependabot first, Renovate only if it cannot.", "a move is done when its repository releases on its own.", "the first release is cut from `main` as it stands.",
  "four metrics, read never from the org's own state.",
];

function fixtureMetric(name: string, options: FixtureOptions): string {
  const input = options.metricWithoutInput === name ? "**Input:** somewhere." : "**Input:** `npm view <package> time --json`.";
  return [`#### ${name}`, "", "**Definition:** a thing, defined.", input, ""].join("\n");
}

function fixtureDecision(n: number, options: FixtureOptions): string {
  const reading = n === options.proseReadingIn
    ? "The count was seven files, taken by a grep."
    : n === options.commandOnlyIn ? [FENCE, "$ git grep -l needle | wc -l", FENCE].join("\n")
      : [FENCE, "$ git grep -l needle | wc -l", "7", ...(n === options.secondCommandOnlyIn ? ["$ git grep -l other"] : []), FENCE].join("\n");
  const said = n === options.wrongContentIn ? "something unrelated." : FIXTURE_DECISION_TEXT[n - 1]!;
  const dora = n === DORA_DECISION
    ? [...DORA_METRICS.filter((m) => m !== options.withoutMetric).map((m) => fixtureMetric(m, options)),
      options.noBaseline === true ? "" : "**Baseline, stated:** 1 release in 14 days; the rest UNDEFINED.", ""].join("\n")
    : "";
  return [`### DECISION ${n} — a fixture decision`, "", reading, "", `**Decision:** ${said}`, "", "**Owner:** engineer.", "", dora].join("\n");
}

function fixtureRepositories(options: FixtureOptions): string {
  const rows = REPOSITORIES.filter((r) => r !== options.withoutRepository)
    .map((r) => `| \`${r}\` | merge | ${r === options.repositoryWithoutMechanism ? "somehow" : r === "lab" ? "git tag plus GitHub Release" : "npm OIDC"} |`);
  return ["## The seven repositories", "", "| repository | releases by | mechanism |", "|---|---|---|", ...rows, ""].join("\n");
}

function fixtureAppendix(options: FixtureOptions): string[] {
  if (options.noAppendix === true) return [];
  const rows = FIXTURE_ROWS.filter((n) => n !== options.withoutRow).map((n, i) => [
    `### ROW ${n} — a fixture row`, "",
    `**Carries:** DECISION ${options.uncarriedDecision === i + 1 ? 1 : i + 1}.`,
    n === options.rowWithoutBlocker ? "" : "**Blocked by:** nothing.", "",
  ].join("\n"));
  return ["## Appendix: the rows filed beside this ADR", "", ...rows];
}

function fixtureAdr(options: FixtureOptions = {}): string {
  const decisions = countTo(DECISION_COUNT).filter((n) => n !== options.without).map((n) => fixtureDecision(n, options));
  const alternatives = REQUIRED_ALTERNATIVES.filter((a) => a.what !== options.withoutAlternative).map((a) => `- **${a.fixtureText}** Rejected.`);
  return [
    "# ADR 9999: a fixture",
    "",
    "**Measured at commit `308b2de5b`, 2026-10-03.**",
    "",
    "## Context", "", "c", "",
    fixtureRepositories(options),
    "## Decision", "",
    ...decisions,
    "## Consequences", "", "c", "",
    "## Alternatives rejected", "",
    ...alternatives,
    "",
    "## What would falsify this", "",
    options.noFalsifier === true ? "nothing" : "- **Falsified if** the sky falls.", "",
    ...fixtureAppendix(options),
  ].join("\n");
}

const FIXTURE_INDEX = `| [9999](./${ADR_FILE}) | fixture | accepted |`;
const FIXTURE_0040 = `## Status\n\n**EXTENDED 2026-10-03 BY [ADR 9999](./${ADR_FILE}).**\n\n## Context\n`;

// ---------------------------------------------------------------------------------------------------------
// POSITIVE CONTROL: this is where the emptiness assertions in the real-document test below point. The check
// must PASS a complete document and REFUSE each broken one, naming what is missing.
// ---------------------------------------------------------------------------------------------------------

const check = (options: FixtureOptions): string[] => checkAdr(fixtureAdr(options), FIXTURE_INDEX, ADR_FILE, FIXTURE_ROWS);

test("control: the complete fixture PASSES, so the check does not refuse everything", () => {
  assert.deepEqual(check({}), []);
  assert.deepEqual(pointerProblems(FIXTURE_0040), []);
});

test("control: each thing the row names is REFUSED when broken, naming what is missing, and only that", () => {
  const cases: [string, FixtureOptions, RegExp][] = [
    ["a decision missing", { without: 5 }, /missing DECISION 5\b/],
    ["a decision under a heading with other content", { wrongContentIn: 3 }, /^DECISION 3 does not say what it must/],
    ["a reading turned into prose", { proseReadingIn: 3 }, /^DECISION 3 has no reading/],
    ["a reading with a command and no output", { commandOnlyIn: 2 }, /^a reading has a command and no output beneath it/],
    ["a second command in a block with no output", { secondCommandOnlyIn: 2 }, /^a reading has a command and no output beneath it/],
    ["a metric not defined", { withoutMetric: "LEAD TIME" }, /does not define the metric LEAD TIME/],
    ["a metric with no input", { metricWithoutInput: "TIME TO RESTORE" }, /^TIME TO RESTORE names no place its input is read/],
    ["no baseline", { noBaseline: true }, /states no baseline/],
    ["a repository not named", { withoutRepository: "control" }, /do not name `control`/],
    ["a repository with no release mechanism", { repositoryWithoutMechanism: "documents" }, /`documents` has no release mechanism/],
    ["an alternative not rejected", { withoutAlternative: "a shared release train" }, /does not hold a shared release train/],
    ["nothing that would falsify it", { noFalsifier: true }, /names nothing/],
    ["a row not named in the appendix", { withoutRow: 104 }, /appendix names no row #104/],
    ["a row that does not say what blocks it", { rowWithoutBlocker: 103 }, /^ROW 103 says nothing about what blocks it/],
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
  const both = check({ without: 2, metricWithoutInput: "LEAD TIME" });
  for (const wanted of [/missing DECISION 2\b/, /^LEAD TIME names no place/]) assert.ok(both.some((p) => wanted.test(p)), both.join("\n"));
});

test("control: a section, the commit, the index entry and the 0040 pointer each REFUSE when absent", () => {
  const full = fixtureAdr();
  const cases: [string, string, string, RegExp][] = [
    ["a prescribed section", full.replace("## Alternatives rejected", "## Other ideas"), FIXTURE_INDEX, /Alternatives rejected/],
    ["the commit", full.replace("**Measured at commit `308b2de5b`, 2026-10-03.**", ""), FIXTURE_INDEX, /Measured at commit/],
    ["the index entry", full, "| nothing |", /does not index/],
  ];
  for (const [what, text, index, wanted] of cases) {
    const problems = checkAdr(text, index, ADR_FILE, FIXTURE_ROWS);
    assert.ok(problems.some((p) => wanted.test(p)), `${what}: ${wanted} not reported in:\n${problems.join("\n")}`);
  }
  assert.deepEqual(pointerProblems("## Status\n\nnothing here\n\n## Context\n"), [`ADR 0040's Status does not point at ${ADR_FILE}`]);
  assert.deepEqual(pointerProblems(FIXTURE_0040.replace("2026-10-03", "recently")), ["ADR 0040's pointer to ADR 0041 carries no date"]);
});

// ---------------------------------------------------------------------------------------------------------
// THE REAL DOCUMENT.
// ---------------------------------------------------------------------------------------------------------

test("ADR 0041 has all seven decisions with readings, the four metrics, the seven repositories and every row filed beside it", () => {
  const text = readFileSync(`${ADR_DIR}${ADR_FILE}`, "utf8");
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  // The population is proved non-empty by the controls above (the complete fixture passes and each broken one reports);
  // this asserts the real document reports nothing, and that it really holds seven decisions and exactly the listed rows,
  // so a row added to the appendix without being listed here is as visible as one deleted from it.
  assert.equal([...text.matchAll(/^### DECISION \d+\b/gm)].length, DECISION_COUNT);
  const appendixRows = [...text.matchAll(/^### ROW (\d+)\b/gm)].map((m) => Number(m[1]));
  assert.deepEqual([...appendixRows].sort(), [...ROWS_FILED_BESIDE].sort());
  assert.deepEqual(checkAdr(text, index, ADR_FILE, ROWS_FILED_BESIDE), []);
  assert.deepEqual(pointerProblems(readFileSync(`${ADR_DIR}${ADR_0040_FILE}`, "utf8")), []);
});
