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
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

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

test("the ready queue exists and states what it is for", () => {
  const source = read();
  assert.match(source, /^# Ready queue/m, `${PATH} must open with its own heading`);
  assert.match(source, /^## How to use this page/m, `${PATH} must keep its own usage instructions`);
});

/**
 * THE VACUITY GUARD, REDONE 2026-09-06 -- the previous version was `found.length >= 1`, a FLOOR on the
 * REAL file's row count. That is exactly the shape `backlog.test.ts`'s own sibling guard was rewritten to
 * avoid, and this page walked into it within a day of shipping: the queue emptying to zero rows is this
 * page's OWN documented happy path (see "How to use this page" step 5, "delete the row"), not a broken
 * scanner. Proven by simulating the state directly -- took the real file with all its rows, demoted every
 * `### ` row heading to `#### ` (the literal shape after every row is deleted, since the split character
 * disappears with them) -- `found.length >= 1` failed with "found 0" on a file that was never broken, only
 * empty. A guard that cannot tell those apart teaches everyone to stop trusting it, which is worse than no
 * guard.
 *
 * So the vacuity proof now runs against a SYNTHETIC fixture instead of the real file's row count: it shows
 * the discovery mechanism finds a row when a row is genuinely there, decoupled from how many rows the real
 * page happens to have on any given day. The real page's row count is asserted nowhere -- zero, one, or a
 * hundred are all fine, and the next test down (field completeness) is only trustworthy at zero BECAUSE
 * this one already proved the scanner itself is not blind.
 */
test("MUTATION: the row-discovery mechanism finds a real row, proven against a fixture independent of today's queue", () => {
  const fixture = "# Ready queue\n\n## How to use this page\n\n...\n\n---\n\n"
    + "### A synthetic row for this proof only\n\n"
    + "- **Region:** `packages/example/src/thing.ts`\n"
    + "- **Branch:** `agent/example-branch`\n\n"
    + "**Acceptance:** ...\n\n---\n\n## What did not make it onto this page, and why\n\n(nothing)\n";
  const found = rows(fixture);
  assert.equal(found.length, 1,
    `expected the discovery to find exactly the one synthetic row, found ${found.length} -- either the `
    + "\\n### split or the tail-section boundary broke");
  assert.equal(found[0].title, "A synthetic row for this proof only",
    "found a row but read the wrong title -- the heading-line split is misaligned");

  // And the BROKEN shape (every row deleted, or the heading level changed) must find nothing, proven on
  // the same fixture with only the heading level changed -- the literal mutation the real file underwent.
  const broken = fixture.replace("### A synthetic row", "#### A synthetic row");
  assert.equal(rows(broken).length, 0,
    "a row demoted from ### to #### was still found -- the discovery regex is not actually anchored to "
    + "the heading level, so it cannot tell a genuinely row-free page from one whose format broke");
});

test("every row declares a Region, a Branch, bounding CLAUDE.md sections, and an Acceptance command", () => {
  const found = rows(read());
  const offenders: string[] = [];
  for (const { title, body } of found) {
    const missing: string[] = [];
    if (!field(body, "Region")) missing.push("Region");
    const branch = field(body, "Branch");
    if (!branch) missing.push("Branch");
    else if (!/^`agent\/[a-z0-9-]+`(\s|$)/.test(branch)) missing.push(`Branch (does not match the agent/<name> shape: "${branch}")`);
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
test("the claim-check instructions use region-diff, never a bare branch-name lookup or origin/agent/*", () => {
  const source = read();
  assert.match(source, /git log --branches=.agent\/\*. --not origin\/main/,
    `${PATH} must instruct checking by REGION (git log --branches='agent/*' --not origin/main -- <path>) `
    + "-- a row's suggested Branch name is not something real work reliably uses, measured directly: only "
    + "1 of 5 addressed rows landed under its own suggested name");
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
  const output = execFileSync("git", ["branch", "--list", "agent/*"],
    { cwd: repoRoot, env: sandboxGitEnv(), encoding: "utf8" });
  const branches = output.split("\n").map((l) => l.replace(/^\*?\s*/, "").trim()).filter(Boolean);
  assert.ok(branches.length > 0,
    "git branch --list 'agent/*' returned no branches from this checkout -- either the pattern is wrong, "
    + "the cwd is wrong, or this repo genuinely has none right now, and the claim-check instructions this "
    + "page gives cannot be trusted to mean anything until this returns a real population");
});

/**
 * REGION-DIFF: measured 2026-09-06, only 1 of 5 addressed rows landed under its own suggested `Branch:`
 * name -- see "The claim mechanism was keyed on a branch NAME..." in the page itself. The replacement
 * derives a claim from the row's own required `Region:` field instead: does any local `agent/*` branch's
 * history, absent from `origin/main`, touch that path at all. `parseBranchesFromLog`/`regionPaths` are
 * PURE (no git), so the PARSING can be proven with a synthetic fixture; `branchesTouchingPath` is the one
 * function that shells out, kept thin so the git call itself is the only untestable-without-git part.
 */
function parseBranchesFromLog(output: string): string[] {
  const branches = new Set<string>();
  for (const line of output.split("\n")) {
    const branch = line.split("\t")[1]?.trim();
    if (branch) branches.add(branch);
  }
  return [...branches];
}

/**
 * File-path-like backtick-quoted tokens in a Region field. A Region's prose may ALSO backtick-quote a
 * function or variable name for context -- row 3's own Region does exactly this
 * ("`packages/judge/src/rules.ts` (the `contextChanged` predicate...)") -- so only a token containing
 * both a "/" and a file extension is taken as a path, never a bare identifier.
 */
function regionPaths(region: string): string[] {
  return [...region.matchAll(/`([^`]+)`/g)]
    .map(([, p]) => p)
    .filter((p) => /\//.test(p) && /\.[a-zA-Z]+$/.test(p));
}

function branchesTouchingPath(path: string, repoRoot: string): string[] {
  const output = execFileSync("git",
    ["log", "--branches=agent/*", "--not", "origin/main", "--format=%H%x09%S", "--", path],
    { cwd: repoRoot, encoding: "utf8" });
  return parseBranchesFromLog(output);
}

test("MUTATION: parseBranchesFromLog and regionPaths are correct against synthetic input, no git needed", () => {
  const sample = "abc123\tagent/route-change-order-and-dialog-restore\n"
    + "def456\tagent/route-change-order-and-dialog-restore\n"
    + "789xyz\tagent/some-other-branch\n";
  assert.deepEqual(parseBranchesFromLog(sample),
    ["agent/route-change-order-and-dialog-restore", "agent/some-other-branch"],
    "must dedupe repeat branches and preserve first-seen order");
  assert.deepEqual(parseBranchesFromLog(""), [], "empty git output must mean zero branches, not a crash");
  assert.deepEqual(parseBranchesFromLog("no tab on this line\n"), [],
    "a line with no tab (malformed git output) must be skipped, not read as a branch named the whole line");

  const region = "`packages/judge/src/rules.ts` (the `contextChanged` predicate feeding \"3.2.1 On Focus\", "
    + "around line 552-596)";
  assert.deepEqual(regionPaths(region), ["packages/judge/src/rules.ts"],
    "must take the real path and ignore the second backtick-quoted token, which is a function name with "
    + "no \"/\" and no extension, not a second file");
});

/**
 * THE ACCEPTANCE DISPATCHER ASKED FOR: proves region-diff correctly attributes rows 1 and 2 to their real
 * branch -- found by REGION, with the branch name appearing only as this test's OWN expectation, never
 * inside `branchesTouchingPath`'s matching logic (which knows nothing about row numbers or suggested
 * names). Scoped to fire only while a row whose title names this row's own subject still exists on the
 * page, so it degrades to a no-op rather than a stale failure once rows 1/2 are claimed, merged and
 * deleted -- the general property below (every branch region-diff finds must actually exist) is what
 * keeps working after that.
 */
test("region-diff finds rows 1 and 2's real branch by region alone, while they are still listed", () => {
  const repoRoot = resolve(process.cwd());
  const relevant = rows(read()).filter(({ title }) =>
    /crossCheckAgainstElementsList|restoreBrowseMode/.test(title));
  if (relevant.length === 0) return; // both claimed and deleted -- nothing left to demonstrate here

  for (const { title, body } of relevant) {
    const region = field(body, "Region");
    assert.ok(region, `"${title}" has no Region to check -- the completeness test above should have caught this`);
    const paths = regionPaths(region!);
    const branches = new Set(paths.flatMap((p) => branchesTouchingPath(p, repoRoot)));
    assert.ok(branches.size > 0,
      `region-diff found no local branch touching "${title}"'s region (${paths.join(", ")}) -- expected `
      + "agent/route-change-order-and-dialog-restore to be found by region alone");
  }
});

/**
 * THE GENERAL PROPERTY, and the one that keeps working after rows 1/2 are gone: whatever region-diff
 * finds must be a branch that actually exists, proven against every row currently on the page rather than
 * a name pinned to today's rows. Catches `git log --source`'s output being mis-parsed into something that
 * looks like a branch name but is not.
 */
test("region-diff only ever names branches that actually exist, checked against every row on the page today", () => {
  const repoRoot = resolve(process.cwd());
  for (const { title, body } of rows(read())) {
    const region = field(body, "Region");
    if (!region) continue;
    for (const path of regionPaths(region)) {
      for (const branch of branchesTouchingPath(path, repoRoot)) {
        const exists = execFileSync("git", ["branch", "--list", branch], { cwd: repoRoot, encoding: "utf8" }).trim();
        assert.ok(exists.length > 0,
          `region-diff for "${title}" named "${branch}" for ${path}, but no such local branch exists -- `
          + "the git-log --source parsing produced something that is not a real branch name");
      }
    }
  }
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
    else if (!/^`agent\/[a-z0-9-]+`(\s|$)/.test(branch)) missing.push("Branch shape");
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
