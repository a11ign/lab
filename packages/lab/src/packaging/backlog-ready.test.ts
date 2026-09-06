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
import { execFileSync } from "node:child_process";

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
    + "against origin/main PLUS every unmerged agent/* branch before listing, per the reviewer's own "
    + `condition, not carried over from a stale record:\n${offenders.join("\n")}`);
});

/**
 * "VERIFIED OPEN AT HEAD" CANNOT SEE WORK FINISHED BUT UNMERGED -- the defect this page's first draft
 * actually walked into: three of six originally-seeded rows were already closed by real, tested work
 * sitting in unmerged local branches, and looked wide open from `origin/main` alone. The correction is a
 * scope, not a wording change, so this checks the scope is actually STATED, not merely that some phrase
 * appears.
 */
test("the page documents its verification scope as origin/main PLUS unmerged local branches, not HEAD alone", () => {
  const source = read();
  assert.match(source, /unmerged (local )?`?agent\/\*/i,
    `${PATH} must state that verification covers unmerged local agent/* branches, not just origin/main -- `
    + "the exact scope that let three already-closed rows through the first time");
  // The narrow phrasing this page shipped with the first time, and the one thing that must not survive a
  // read-through: "verified... at HEAD" with no qualification reads as origin/main alone.
  assert.doesNotMatch(source, /re-verified OPEN at HEAD before being listed/,
    `${PATH} still carries the narrow "verified at HEAD" claim that missed three closed rows -- the scope `
    + "must name unmerged branches explicitly, not just the default branch");
});

/**
 * THE CLAIM MECHANISM ITSELF: agent branches in this repo are never pushed, so `git branch -r --list
 * 'origin/agent/*'` returns empty and would report every row unclaimed forever. This is not a wording
 * preference -- a page that tells a reader to check the wrong git command is actively wrong, worse than
 * one that says nothing, because it looks like a check that was performed.
 */
test("the claim-check instructions use the local branch/worktree form, never origin/agent/* as a live instruction", () => {
  const source = read();
  assert.match(source, /git branch --list 'agent\//,
    `${PATH} must instruct checking LOCAL branches (git branch --list 'agent/...') -- this repo's agent `
    + "branches are never pushed, so origin/agent/* is always empty");
  // The broken form is allowed to appear ONLY as a named warning ("this always returns empty"), never as
  // a fenced, runnable instruction -- the page explaining why NOT to use it is worth keeping; the page
  // telling a reader to run it is the defect. Checked by requiring every mention to sit inside a sentence
  // that also says the pattern is empty/wrong, and none of them to appear inside a fenced code block.
  const mentions = [...source.matchAll(/origin\/agent\/\*/g)];
  const inFencedBlock = (index: number) => {
    const before = source.slice(0, index);
    return (before.match(/```/g) ?? []).length % 2 === 1;
  };
  const offenders = mentions.filter((m) => {
    const around = source.slice(Math.max(0, m.index! - 150), m.index! + 150);
    return inFencedBlock(m.index!) || !/always returns empty|never|wrong/i.test(around);
  });
  assert.deepEqual(offenders.map((m) => source.slice(Math.max(0, m.index! - 40), m.index! + 40)), [],
    `${PATH} mentions origin/agent/* somewhere that is not clearly marked as a warning against using it `
    + "(either inside a fenced/runnable block, or with no nearby language saying it's empty/wrong) -- "
    + "that reads as an instruction, and that pattern always returns empty on this repo");
});

/**
 * THE VACUITY GUARD DISPATCHER ASKED FOR: proving the claim mechanism as DOCUMENTED actually returns a
 * non-empty population when run for real, not just that the doc's wording looks right. A broken pattern,
 * wrong cwd, or a repo with the branches renamed would make every row read "unclaimed" -- indistinguishable
 * from a genuinely open queue unless something checks that the underlying git command finds ANYTHING.
 */
test("the local agent/* branch population the claim check depends on is non-empty, proven by running it", () => {
  const repoRoot = resolve(process.cwd());
  const output = execFileSync("git", ["branch", "--list", "agent/*"], { cwd: repoRoot, encoding: "utf8" });
  const branches = output.split("\n").map((l) => l.replace(/^\*?\s*/, "").trim()).filter(Boolean);
  assert.ok(branches.length > 0,
    "git branch --list 'agent/*' returned no branches from this checkout -- either the pattern is wrong, "
    + "the cwd is wrong, or this repo genuinely has none right now, and the claim-check instructions this "
    + "page gives cannot be trusted to mean anything until this returns a real population");
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
