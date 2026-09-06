// A ROW WITH NO REGION OR NO ACCEPTANCE COMMAND IS NOT A READY ROW, WHATEVER ELSE IT SAYS.
//
// `docs/backlog-ready.md` exists so a worker with no context from tonight can pick up the next unit
// without waiting for a person free to review, choose and brief one — the serial step this repo's own
// peer-orchestration record names as the actual bottleneck. That only works if every row is genuinely
// self-contained: a REGION so two workers do not collide on one file (this repo's own near-miss tonight,
// in `capture-probes.mjs`, would have manufactured a false WCAG finding), and an ACCEPTANCE COMMAND so
// "done" is something the row's own text proves rather than something a reviewer has to judge. A row
// missing either is a reading-list entry wearing a ready-queue row's clothing, and this test refuses it.
//
// DISCOVERED per row, not hand-counted — the same shape as `backlog.test.ts`'s own guard one file over:
// a hand-maintained "the rows that matter" list is exactly the kind of list a new row slips past.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATH = "docs/backlog-ready.md";
const read = () => readFileSync(resolve(process.cwd(), PATH), "utf8");

/**
 * Rows are `### ` headings between the intro and the trailing "## What did not make it onto this page"
 * section, which is a RECORD of rejected candidates, not a row itself, and must not be parsed as one.
 */
function rows(source: string): { title: string; body: string }[] {
  const beforeTail = source.split(/\n## What did not make it onto this page/)[0];
  const chunks = beforeTail.split(/\n### /).slice(1);
  return chunks.map((chunk) => {
    const [title, ...rest] = chunk.split("\n");
    return { title: title.trim(), body: rest.join("\n") };
  });
}

/** One field, read as the bold-labelled bullet line this page's own "How to use this page" format uses. */
function field(body: string, label: string): string | null {
  const re = new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m");
  return body.match(re)?.[1]?.trim() ?? null;
}

test("the ready queue exists and uses the row format this test can read", () => {
  const source = read();
  assert.match(source, /^# Ready queue/m, `${PATH} must open with its own heading`);
  // Independent of row COUNT (an empty queue is a legitimate state — everything claimed, nothing new
  // found yet) the same way backlog.test.ts's marker check is: this proves the FORMAT is still the one
  // being parsed below, not that any particular number of rows exist.
  assert.match(source, /^- \*\*Region:\*\*/m,
    `${PATH}'s row format has changed -- no "- **Region:**" bullet found anywhere, so the parser below `
    + "would silently examine nothing");
});

test("the discovery finds a realistic slice of the seeded queue", () => {
  const found = rows(read());
  // A floor, not a target: this page was seeded with six rows tonight. Zero would mean the split on
  // "### " broke; the number shrinking over time as rows are claimed and deleted is the queue working.
  assert.ok(found.length >= 1, `expected to find ready-queue rows in ${PATH}, found ${found.length}`);
});

test("every row declares a Region, a Branch, bounding CLAUDE.md sections, and an Acceptance command", () => {
  const found = rows(read());
  const offenders: string[] = [];
  for (const { title, body } of found) {
    const missing: string[] = [];
    if (!field(body, "Region")) missing.push("Region");
    const branch = field(body, "Branch");
    if (!branch) missing.push("Branch");
    else if (!/^`agent\/[a-z0-9-]+`$/.test(branch)) missing.push(`Branch (does not match the agent/<name> shape: "${branch}")`);
    if (!field(body, "CLAUDE.md sections")) missing.push("CLAUDE.md sections");
    // Acceptance is prose plus at least one fenced code block naming the real command, never a bare
    // paragraph -- "run the tests" is a judgement, "npx tsx --test <path>" is a command.
    if (!/\*\*Acceptance:?\*\*/.test(body)) missing.push("Acceptance");
    else if (!/```[\s\S]*?```/.test(body.split(/\*\*Acceptance:?\*\*/)[1] ?? ""))
      missing.push("Acceptance (no fenced command block after the label)");
    if (missing.length) offenders.push(`  "${title}": missing ${missing.join(", ")}`);
  }
  assert.deepEqual(offenders, [],
    "these row(s) are missing a field a ready row must have -- a row with no Region can collide with "
    + "another worker's edits, and a row with no runnable Acceptance command asks the next reader to "
    + `judge "done" rather than prove it:\n${offenders.join("\n")}`);
});

test("every Verified-open claim names a real command, not just a conclusion", () => {
  const found = rows(read());
  const offenders = found
    .filter(({ body }) => !/\*\*Verified open\*\*/.test(body))
    .map(({ title }) => `  "${title}"`);
  assert.deepEqual(offenders, [],
    "these row(s) have no 'Verified open' evidence -- every row on this page must have been re-checked "
    + `against HEAD before listing, per the orchestrator's own condition, not carried over from a stale `
    + `record:\n${offenders.join("\n")}`);
});

/**
 * THE MUTATION HALF. Fired against synthetic markdown shaped like the real page, independent of the
 * seeded rows above -- proving detection does not depend on which rows happen to be listed today.
 */
test("MUTATION: a row missing Region, Branch, or Acceptance is caught by name", () => {
  const goodRow = "### A complete row\n\n"
    + "- **Region:** `packages/example/src/thing.ts`\n"
    + "- **Branch:** `agent/example-branch`\n"
    + "- **CLAUDE.md sections:** \"Some section\"\n"
    + "- **Verified open** by running a real command.\n\n"
    + "**Acceptance:**\n```\nnpx tsx --test packages/example/src/thing.test.ts\n```\n";
  const missingRegion = goodRow.replace(/^- \*\*Region:\*\*.*\n/m, "");
  const missingAcceptance = goodRow.replace(/\*\*Acceptance:\*\*\n```[\s\S]*?```\n/, "");
  const missingBranch = goodRow.replace(/^- \*\*Branch:\*\*.*\n/m, "");
  const badBranchShape = goodRow.replace("`agent/example-branch`", "`not-the-right-shape`");

  for (const [label, mutated] of [
    ["missing Region", missingRegion],
    ["missing Acceptance", missingAcceptance],
    ["missing Branch", missingBranch],
    ["malformed Branch", badBranchShape],
  ] as const) {
    const { title, body } = rows(`# Ready queue\n\n${mutated}`)[0];
    const missing: string[] = [];
    if (!field(body, "Region")) missing.push("Region");
    const branch = field(body, "Branch");
    if (!branch) missing.push("Branch");
    else if (!/^`agent\/[a-z0-9-]+`$/.test(branch)) missing.push("Branch shape");
    if (!/\*\*Acceptance:?\*\*/.test(body) || !/```[\s\S]*?```/.test(body.split(/\*\*Acceptance:?\*\*/)[1] ?? ""))
      missing.push("Acceptance");
    assert.ok(missing.length > 0, `mutation "${label}" on row "${title}" was not caught by any check`);
  }

  // And the unmutated row must NOT be flagged, or every mutation above proves nothing.
  const { body } = rows(`# Ready queue\n\n${goodRow}`)[0];
  assert.ok(field(body, "Region") && field(body, "Branch") && /```[\s\S]*?```/.test(body.split(/\*\*Acceptance:?\*\*/)[1] ?? ""),
    "the UNMUTATED synthetic row was flagged -- the parser itself is broken, not just the mutation");
});

test("the tail section explaining what was checked and dropped still exists", () => {
  // Re-verification before listing is the orchestrator's own condition for this page, and the record of
  // what was checked and found ALREADY CLOSED is worth as much as the rows that survived -- losing this
  // section silently would be the exact staleness this page exists to avoid reproducing.
  assert.match(read(), /^## What did not make it onto this page/m,
    `${PATH} must keep a record of what was checked and excluded, not just the rows that survived`);
});
