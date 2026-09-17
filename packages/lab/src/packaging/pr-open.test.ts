// no-token: gh
//
// #1277, and the declaration is DRIVEN rather than asserted. The detector flags this file's closure
// because `armAfterCreate` (`pr-open.mjs`) RETURNS a `["pr", "merge", "--auto", ...]` argv -- a data
// literal, not a spawn -- and `defaultGh` does spawn `gh`, but nothing here reaches it: `checkBody`,
// `bodyFromArgs` and `armAfterCreate` are pure, and `sendToGitHub` takes `run` and `git` injected.
//
// Checked with an instrument rather than by reading: a `gh` on PATH that exits 1 with a loud message,
// run against this whole suite. If any test spawned `gh` it would fail. 17 pass / 0 fail, and the shim
// was confirmed reachable first (`gh --version` -> exit 1) so a silent PATH miss could not read as a
// clean run. A CONSUMER assertion that really spawns `gh` must NOT carry this line.

/**
 * `pr:open`/`pr:edit` (#746) -- check a PR body's Acceptance/Closes with the tree's OWN parser
 * (`packages/agent-org/src/acceptance-commands.mjs`) BEFORE `gh pr create`/`gh pr edit` ever sends it, refusing with the
 * parser's own message. Four real PRs went red on the body in one day, four authors, four modes, none of
 * them a defect in the change -- see `packages/agent-org/src/pr-open.mjs`'s own header for the full account.
 *
 * THE FOUR FIXTURES BELOW ARE RECONSTRUCTED, not archived verbatim -- #708/#723/#727/#736 were each
 * edited to fix the body after the fact (confirmed via `gh api graphql`'s `userContentEdits`, which does
 * not cleanly hand back the exact pre-fix text through consecutive diffs), so each fixture here reproduces
 * the SHAPE #746's own summary table names, verified against the REAL, unmodified
 * `packages/agent-org/src/acceptance-commands.mjs` (never guessed): a duplicate Acceptance header (#708), prose under
 * `Acceptance:` with no `Closes` at all (#723), a piped command the file pre-check cannot parse (#727),
 * and the section living under `## Verified` instead of `## Acceptance` (#736).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { acceptanceEnv, checkBody, bodyFromArgs, armAfterCreate, sendToGitHub, headTreeRefusal, editTreeRefusal,
  main as prOpenMain,
  EXIT_NOTHING_SENT, EXIT_USAGE, EXIT_LANDED_THEN_FAILED } from "../../../agent-org/src/pr-open.mjs";

const NEVER_RUN = () => { throw new Error("checkBody must never RUN a command for a body this test expects to refuse"); };

// --- #746's own four fixtures, one per real PR, reproducing the SHAPE named in the row's summary table ---

const DUPLICATE_BODY_708 = "## Acceptance, all three from #705\n\nSome text.\n\n"
  + "Acceptance: npx tsx --test packages/lab/src/packaging/rescue-hunk.test.ts\n\nCloses #705\n";

const PROSE_THEN_CLOSES_MISSING_BODY_723 = "Some intro.\n\nAcceptance:\n"
  + "Verified in the worktree: prose only; tests pass and the doc updated.\n";

const PIPE_BODY_727 = "Closes #716\n\nAcceptance:\n```\n"
  + "npx tsx --test packages/lab/src/packaging/foo.test.ts | xargs echo\n```\n";

const WRONG_HEADING_BODY_736 = "## Verified\n\nnpx tsx --test packages/lab/src/packaging/acceptance-commands.test.ts\n\n"
  + "Closes: none — reason here\n";

const VALID_BODY = "## Acceptance\n\nnode -e \"process.exit(0)\"\n\nCloses #1\n";

test("#746's own acceptance shape: a DUPLICATE Acceptance section is refused, naming both occurrences "
  + "(#708's real shape)", () => {
  const result = checkBody(DUPLICATE_BODY_708, { run: NEVER_RUN });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((l) => l.includes("DUPLICATE")));
  assert.ok(result.lines.some((l) => l.includes("## Acceptance, all three from #705")));
});

test("#746's own acceptance shape: PROSE under Acceptance is refused as not-a-command, and Closes is "
  + "separately MISSING (#723's real shape)", () => {
  const result = checkBody(PROSE_THEN_CLOSES_MISSING_BODY_723, { run: NEVER_RUN });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((l) => l.includes("is not a command")));
  assert.ok(result.lines.some((l) => l.includes("CLOSES: MISSING")));
});

test("#746's own acceptance shape: a pipe the file pre-check cannot parse is refused, never run (#727's "
  + "real shape, #728's own mechanism)", () => {
  const result = checkBody(PIPE_BODY_727, { run: NEVER_RUN });
  assert.equal(result.ok, false);
  // #728 LANDED, AND THIS TEST NAMED THE MESSAGE IT REPLACED. Its own title says "#728's own
  // mechanism", so it was written expecting the wording to move; what it pinned was
  // `matched no file: node, |, xargs` -- a claim about the FILESYSTEM, and a false one.
  //
  // THE VERDICT IS DELIBERATELY UNCHANGED and asserted first: still `ok: false`, still refused, still
  // "EXECUTED NOTHING". #728 was about the confident wrong answer, not about the refusal, and a fix
  // that quietly let a piped line PASS would have satisfied the row's first line while removing the
  // protection #746 built. Both halves are asserted here so neither can move alone.
  assert.ok(result.lines.some((l) => l.includes("cannot check this line: it contains a pipe")),
    "the refusal must name the construct rather than assert about files that were never asked for");
  assert.ok(result.lines.some((l) => l.includes("EXECUTED NOTHING")),
    "and the section must still report having verified nothing -- that is what stops it reading as a pass");
});

test("#746's own acceptance shape: the section under `## Verified` (not `## Acceptance`) is MISSING "
  + "(#736's real shape)", () => {
  const result = checkBody(WRONG_HEADING_BODY_736, { run: NEVER_RUN });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((l) => l === "ACCEPTANCE: MISSING"));
});

test("#746's own acceptance shape: a valid body checks clean -- the wrapper adds nothing and reformats "
  + "nothing", () => {
  let ran = 0;
  const run = () => { ran += 1; return 0; };
  const result = checkBody(VALID_BODY, { run });
  assert.equal(result.ok, true);
  assert.equal(ran, 1, "the one real command in the body must actually run, exactly as the CI job would");
});

// --- bodyFromArgs: reads the SAME flags gh itself takes, never a shape this wrapper invents ---

test("bodyFromArgs reads --body directly", () => {
  assert.equal(bodyFromArgs(["--title", "x", "--body", "hello"]), "hello");
});

test("bodyFromArgs reads --body-file from disk", () => {
  const path = fileURLToPath(new URL("../../../../package.json", import.meta.url));
  const fromFile = bodyFromArgs(["--body-file", path]);
  assert.equal(fromFile, readFileSync(path, "utf8"));
});

test("bodyFromArgs returns null when neither flag is given -- an interactive session, not checkable", () => {
  assert.equal(bodyFromArgs(["--title", "x"]), null);
});

test("--body wins when both are given, matching gh's own last-flag-wins convention", () => {
  assert.equal(bodyFromArgs(["--body-file", "/nonexistent", "--body", "wins"]), "wins");
});

// --- NO SECOND PARSER: `checkBody` calls the tree's own functions, never re-derives the question ---

test("checkBody's own source imports acceptanceReport and closesDeclarationReport from "
  + "acceptance-commands.mjs, and calls both -- never a local regex re-implementing the question", () => {
  const path = fileURLToPath(new URL("../../../agent-org/src/pr-open.mjs", import.meta.url));
  const source = stripComments(readFileSync(path, "utf8"));
  assert.match(source, /from\s+["']\.\/acceptance-commands\.mjs["']/);
  assert.match(source, /\bacceptanceReport\s*\(/);
  assert.match(source, /\bclosesDeclarationReport\s*\(/);
});

test("MUTATION TARGET: a local regex standing in for the real parser is CAUGHT, not silently equivalent "
  + "-- a hand-rolled 'looks like Acceptance:' check passes #708's duplicate body, which the real parser "
  + "refuses", () => {
  // The shape #746 is built not to create: a naive regex sees ONE `Acceptance:`-shaped line (the inline
  // form) and calls it a day, blind to the SECOND, `## `-heading form earlier in the same body.
  const naiveRegexCheck = (body: string) => /Acceptance:\s*\S/.test(body);
  assert.equal(naiveRegexCheck(DUPLICATE_BODY_708), true,
    "the naive check wrongly says this body is fine");
  const real = checkBody(DUPLICATE_BODY_708, { run: NEVER_RUN });
  assert.equal(real.ok, false, "the real parser correctly refuses the same body -- proving a hand-rolled "
    + "regex would have let #708's exact defect through");
});

// #909: a PR opened READY by this wrapper is armed at creation, on the injected runner's argv -- never a draft,
// never an edit. Drafts are armed by auto-arm.yml on ready_for_review, because GitHub refuses auto-merge on a
// draft; this is the docs-and-tests path, which opens ready and whose flag was set by a workflow run instead.
test("#909: `pr-open create` without --draft arms the PR at creation, by branch, merge commits only", () => {
  const argv = armAfterCreate("create", ["--title", "t", "--body-file", "b.md", "--base", "main", "--head", "ceo/x"]);
  assert.deepEqual(argv, [["pr", "merge", "--auto", "--merge", "ceo/x"]]);
  const eq = armAfterCreate("create", ["--head=ceo/y", "--body", "x"]);
  assert.deepEqual(eq, [["pr", "merge", "--auto", "--merge", "ceo/y"]], "--head=value is read too");
});

test("#909: a draft is NOT armed at creation, and `edit` never arms -- the two paths that must stay quiet", () => {
  assert.deepEqual(armAfterCreate("create", ["--draft", "--title", "t", "--head", "ceo/x"]), []);
  assert.deepEqual(armAfterCreate("create", ["--title", "t", "--head", "ceo/x", "--draft"]), [], "--draft anywhere");
  assert.deepEqual(armAfterCreate("edit", ["--body", "x"]), []);
});

test("#909 MUTATION TARGET: arming uses --merge, never --squash or --rebase (the org merges by merge commit only)", () => {
  const [[, , , method]] = armAfterCreate("create", ["--head", "ceo/x"]);
  assert.equal(method, "--merge");
});

// --- #1277: a failed `gh pr create` says where it stopped, in one line -------------------------------
//
// Measured 2026-09-13 11:32Z filing #1254, with the account's GraphQL budget exhausted: the acceptance
// ran and passed, `gh pr create` failed, and the failure arrived as a raw `execFileSync` throw -- 29
// lines, 9 of them stack, ending in a dump whose `stdout: null, stderr: null` reads as "the command
// produced no output" when the output is four lines above. The two useful lines were present; they were
// buried in twenty-seven that were not, in a file whose three deliberate refusals are each one sentence.

// THE REAL ERROR SHAPE, not a convenient one. `execFileSync` throws with `message` = "Command failed:
// <the argv>" -- the CAUSE (`GraphQL: API rate limit already exceeded`) is written by `gh` to stderr,
// which `stdio: "inherit"` has already put on screen one line above. My first fixture threw an Error
// whose message WAS the cause, so it asserted a line the real failure does not produce.
const ghFails = () => () => {
  throw new Error("Command failed: gh pr create --body-file /tmp/b.md --title probe");
};
const gitStub = (args: string[]) => (args.includes("--abbrev-ref") ? "agent/my-branch" : "abc1234");

test("#1277: a create that FAILS prints one line with the branch, the head and the cause", () => {
  const lines: string[] = [];
  const code = sendToGitHub("create", ["--title", "x"],
    { run: ghFails(), git: gitStub, err: (l: string) => { lines.push(l); } });

  assert.equal(code, EXIT_NOTHING_SENT, "main exits with this");
  assert.equal(lines.length, 1, "ONE line -- the whole point is that it is not a stack");
  assert.match(lines[0], /agent\/my-branch/, "the branch, because the retry needs it");
  assert.match(lines[0], /abc1234/, "and the head the acceptance passed against, which a stack never says");
  assert.match(lines[0], /Command failed: gh pr create/,
    "THE SPAWN'S OWN MESSAGE SURVIVES. It names the argv rather than the cause -- the cause is gh's, "
    + "written to inherited stderr one line above -- and a line that dropped this would leave an "
    + "operator unable to see WHICH command failed when a run spawns more than one");
  assert.doesNotMatch(lines[0], /\n\s+at /, "and no stack frames");
});

test("#1277 POSITIVE CONTROL: a create that SUCCEEDS gains no failure line", () => {
  // Without this, a build that prints the failure line unconditionally passes the test above perfectly.
  const lines: string[] = [];
  const spawned: string[][] = [];
  const code = sendToGitHub("create", ["--title", "x"],
    { run: (args: string[]) => { spawned.push(args); }, git: gitStub, err: (l: string) => { lines.push(l); } });

  assert.equal(code, 0);
  assert.deepEqual(lines, [], "silence on success -- the failure line must move with the outcome");
  assert.equal(spawned[0][0], "pr", "and the command really ran rather than being skipped");
  // The ARM spawn, which no test asserted: `run(args.slice(1))` sent `gh merge --auto --merge` after every
  // ready create, an unknown command thrown raw after the PR already existed. `armAfterCreate`'s own tests
  // check the argv it RETURNS; this checks the argv `sendToGitHub` actually SPAWNS from it.
  assert.deepEqual(spawned.slice(1), [["pr", "merge", "--auto", "--merge"]],
    "a ready create is armed with the whole `gh pr merge` argv, `pr` included");
});

test("#1348: a ready create with --head ARMS THAT HEAD, in both spellings -- through the spawn, not only armAfterCreate's return", () => {
  // #909's tests hold what `armAfterCreate` RETURNS for a head; the positive control above holds the spawn, but its
  // create passes no head. So nothing held that `sendToGitHub` hands the head on: a spawn built from a head-less
  // argv would still arm, as `gh pr merge --auto --merge` with no argument -- which `gh` resolves against the
  // CURRENT checkout's branch. `gitStub` says that branch is `agent/my-branch`, so an arm naming `agent/x` can only
  // have come from `--head`.
  for (const rest of [["--title", "x", "--head", "agent/x"], ["--title", "x", "--head=agent/x"]]) {
    const label = rest.slice(2).join(" ");
    const lines: string[] = [];
    const spawned: string[][] = [];
    const code = sendToGitHub("create", rest,
      { run: (args: string[]) => { spawned.push(args); }, git: gitStub, err: (l: string) => { lines.push(l); } });
    assert.equal(code, 0, label);
    assert.deepEqual(lines, [], `${label}: a create that succeeds prints no failure line`);
    assert.deepEqual(spawned[0], ["pr", "create", ...rest], `${label}: the create carries the head as given`);
    assert.deepEqual(spawned.slice(1), [["pr", "merge", "--auto", "--merge", "agent/x"]],
      `${label}: the arm names the branch just opened, never the checkout's (agent/my-branch)`);
  }
});

test("#1277: the failure line names the MODE, so `edit` and `create` are not confused in a transcript", () => {
  const lines: string[] = [];
  sendToGitHub("edit", ["1254"], { run: ghFails(), git: gitStub, err: (l: string) => { lines.push(l); } });
  assert.match(lines[0], /`gh pr edit` FAILED/);
});

// --- #1283: the failure path must not itself fail, and must not name a branch that does not exist ----

test("#1283: on a DETACHED HEAD the line says `detached at <sha>`, not the literal `HEAD`", () => {
  // `gh pr create` fails on a detached HEAD BY CONSTRUCTION, so the one shape where this message is
  // guaranteed to be read is the shape where `--abbrev-ref` returns the string "HEAD" and the line
  // named a branch nobody can retry from. worker-capture's finding on #1283, from their own run.
  const lines: string[] = [];
  sendToGitHub("create", ["--title", "x"], {
    run: () => { throw new Error("Command failed: gh pr create"); },
    git: (args: string[]) => (args.includes("--abbrev-ref") ? "HEAD" : "deadbee"),
    err: (l: string) => { lines.push(l); },
  });
  assert.match(lines[0], /Detached at `deadbee`/, "one phrase, and the sha once");
  assert.doesNotMatch(lines[0], /deadbee.*deadbee/, "not the sha twice, which the first fix produced");
  assert.doesNotMatch(lines[0], /Branch `HEAD`/, "the literal HEAD is not a branch anyone can retry from");
});

test("#1283: a failing `git` still prints the line -- an error handler that errors loses the cause", () => {
  // Both rev-parse calls sat inside the catch unguarded, so a GIT_DIR pointing elsewhere replaced this
  // message with a raw throw carrying git's error and losing gh's entirely -- worse than the 24-line
  // dump it replaced, which at least contained the answer.
  const lines: string[] = [];
  assert.doesNotThrow(() => sendToGitHub("create", ["--title", "x"], {
    run: () => { throw new Error("Command failed: gh pr create"); },
    git: () => { throw new Error("fatal: not a git repository"); },
    err: (l: string) => { lines.push(l); },
  }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\(unknown\)/, "the facts it could not read say so");
  assert.match(lines[0], /Command failed: gh pr create/,
    "AND gh's own message survives -- losing it is the thing that made the throw worse than the dump");
});

// --- #1344: `create --head B` refuses unless THIS working tree is B, at origin/B's commit ---------------------
//
// `checkBody` runs the Acceptance in whatever directory pr-open started in, and `--head` was read only to arm. So
// the same command and body gave 51 tests from #1313's worktree and "# tests 43 / # pass 43" from the primary --
// and #1343 was created on the 43. `headTreeRefusal` is driven here over an injected `git` answering by argv.

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A `git` answering each argv from `facts` -- an Error is thrown -- and keeping every argv it was asked. */
function gitFacts(facts: Record<string, string | Error>) {
  const asked: string[][] = [];
  const git = (args: string[]) => {
    asked.push(args);
    const answer = facts[args.join(" ")];
    if (answer === undefined) throw new Error(`no fact for: git ${args.join(" ")}`);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { git, asked };
}

test("#1344 case 1: --head B from a tree on ANOTHER branch refuses, naming both refs", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "main" });
  const refusal = headTreeRefusal("create", ["--title", "t", "--head", "agent/x"], { git });
  assert.ok(refusal, "a tree on main must not test agent/x");
  assert.match(refusal, /--head `agent\/x` but this working tree is on `main`/);
  assert.match(refusal, /Nothing ran and nothing was sent/);
  assert.match(headTreeRefusal("create", ["--head=agent/x"], { git }) ?? "", /--head `agent\/x`/, "the = spelling too");
});

test("#1344 case 1: --head B from a DETACHED HEAD refuses, naming the short sha -- never a branch called HEAD", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "HEAD", "rev-parse --short HEAD": "deadbee" });
  const refusal = headTreeRefusal("create", ["--head", "agent/x"], { git }) ?? "";
  assert.match(refusal, /on a detached HEAD at `deadbee`/, "the primary checkout's shape in the 43-test run");
  assert.doesNotMatch(refusal, /on `HEAD`/);
});

test("#1344 case 2 CONTROL: a tree on B at origin/B's commit is the head being sent -- no refusal", () => {
  const { git, asked } = gitFacts({
    "rev-parse --abbrev-ref HEAD": "agent/x",
    "rev-parse HEAD": SHA_A,
    "rev-parse refs/remotes/origin/agent/x": SHA_A,
  });
  assert.equal(headTreeRefusal("create", ["--title", "t", "--head", "agent/x"], { git }), null);
  assert.deepEqual(asked, [["rev-parse", "--abbrev-ref", "HEAD"], ["rev-parse", "HEAD"],
    ["rev-parse", "refs/remotes/origin/agent/x"]], "and it compared the branch and both commits to say so");
});

test("#1344 CONTROL: no --head, and edit, have nothing to compare -- and ask git nothing", () => {
  const { git, asked } = gitFacts({});
  assert.equal(headTreeRefusal("create", ["--title", "t", "--body-file", "b.md"], { git }), null,
    "without --head, gh opens the checked-out branch, which is the tree under test");
  assert.equal(headTreeRefusal("edit", ["1344", "--body-file", "b.md"], { git }), null);
  assert.deepEqual(asked, []);
});

test("#1344 case 3: a tree on B but NOT at origin/B's commit refuses, naming both SHAs", () => {
  const { git } = gitFacts({
    "rev-parse --abbrev-ref HEAD": "agent/x",
    "rev-parse HEAD": SHA_A,
    "rev-parse refs/remotes/origin/agent/x": SHA_B,
  });
  const refusal = headTreeRefusal("create", ["--head", "agent/x"], { git }) ?? "";
  assert.match(refusal, new RegExp(`on \`agent/x\` at \`${SHA_A}\`, but \`origin/agent/x\` is \`${SHA_B}\``));
});

test("#1344 case 3: an unpushed B (origin/B unreadable) refuses and says to push -- never a match on a failed read", () => {
  const { git } = gitFacts({
    "rev-parse --abbrev-ref HEAD": "agent/x",
    "rev-parse HEAD": SHA_A,
    "rev-parse refs/remotes/origin/agent/x": new Error("fatal: ambiguous argument"),
  });
  assert.match(headTreeRefusal("create", ["--head", "agent/x"], { git }) ?? "", /unreadable -- push the branch first/);
});

test("#1344 WIRING: main() refuses a mismatched head BEFORE checkBody runs any Acceptance command", () => {
  const source = stripComments(readFileSync(fileURLToPath(new URL("../../../agent-org/src/pr-open.mjs", import.meta.url)), "utf8"));
  const start = source.indexOf("function main(");
  const main = source.slice(start, source.indexOf("\n}\n", start));
  const refusal = main.indexOf("headTreeRefusal(mode, rest,");
  const check = main.indexOf("checkBody(body,");
  assert.ok(refusal > 0 && check > 0, "both calls are in main()");
  assert.ok(refusal < check, "the head is compared before checkBody runs the Acceptance in this tree");
});

// --- #1446: `edit N` refuses unless THIS working tree is PR N's head branch, at its commit -------------------
//
// The edit half of #1344, reproduced 21:59Z: `pr-open edit 1454` from a worktree at da9858fb printed
// `ACCEPTANCE: RAN ... -> pass` and wrote the probe's marker, for a PR whose head is 9d954d13. `edit` names only a
// PR, so its head is READ -- through an injected `prHead` here, so no test reaches GitHub.

/** A PR-head reader answering from `heads` -- an Error is thrown -- and keeping every (repo, number) it was asked. */
function prHeads(heads: Record<string, { ref: string; oid: string } | Error | null>) {
  const asked: string[][] = [];
  const prHead = (repo: string, number: string) => {
    asked.push([repo, number]);
    const head = heads[number];
    if (head instanceof Error) throw head;
    return head ?? null;
  };
  return { prHead, asked };
}

test("#1446 case 1: edit N from a tree on ANOTHER branch refuses, naming PR N's head and the tree", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "agent/other", "rev-parse HEAD": SHA_B });
  const { prHead, asked } = prHeads({ 1454: { ref: "agent/x", oid: SHA_A } });
  const refusal = editTreeRefusal("edit", ["1454", "--repo", "owner/repo", "--body-file", "b.md"], { git, prHead }) ?? "";
  assert.match(refusal, new RegExp(`PR #1454's head is \`agent/x\` at \`${SHA_A}\`, but this working tree is on \`agent/other\` at \`${SHA_B}\``));
  assert.match(refusal, /Nothing ran and nothing was sent/);
  assert.deepEqual(asked, [["owner/repo", "1454"]], "the head was read for that PR, from the --repo given");
});

test("#1446 case 1: edit N from a DETACHED HEAD refuses -- never a branch called HEAD", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "HEAD", "rev-parse HEAD": SHA_A });
  const { prHead } = prHeads({ 7: { ref: "agent/x", oid: SHA_A } });
  const refusal = editTreeRefusal("edit", ["7", "--body-file", "b.md"], { git, prHead }) ?? "";
  assert.match(refusal, new RegExp(`on a detached HEAD at \`${SHA_A}\``), "the same commit, but no branch -- still not the head");
});

test("#1446 case 2 CONTROL: a tree on PR N's head branch at its commit runs as today -- no refusal", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "agent/x", "rev-parse HEAD": SHA_A });
  const { prHead, asked } = prHeads({ 1454: { ref: "agent/x", oid: SHA_A } });
  assert.equal(editTreeRefusal("edit", ["1454", "--body-file", "b.md"], { git, prHead }), null);
  assert.deepEqual(asked, [["DanBeckDev/a11y-witness", "1454"]], "with no --repo, the head is read from this repository");
});

test("#1446 case 3: a tree on the head branch but NOT at the PR's head commit refuses, naming both SHAs", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "agent/x", "rev-parse HEAD": SHA_B });
  const { prHead } = prHeads({ 1454: { ref: "agent/x", oid: SHA_A } });
  const refusal = editTreeRefusal("edit", ["1454"], { git, prHead }) ?? "";
  assert.match(refusal, new RegExp(`at \`${SHA_A}\`, but this working tree is on \`agent/x\` at \`${SHA_B}\``));
});

test("#1446: a PR head that cannot be read refuses -- a failed read is never a match", () => {
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "agent/x", "rev-parse HEAD": SHA_A });
  for (const answer of [new Error("gh: HTTP 404"), null]) {
    const { prHead } = prHeads({ 1454: answer });
    assert.match(editTreeRefusal("edit", ["1454"], { git, prHead }) ?? "", /could not read PR #1454's head/);
  }
});

test("#1446: a head read that answers without a ref or without a commit refuses -- a partial answer is never a match", () => {
  // The unreadable-head test above covers a read that throws or answers null; this is the third shape, an object with
  // a field missing, which GitHub's own API can return for a PR whose head repository was deleted.
  const { git } = gitFacts({ "rev-parse --abbrev-ref HEAD": "", "rev-parse HEAD": "" });
  for (const partial of [{ ref: "agent/x", oid: "" }, { ref: "", oid: SHA_A }]) {
    const { prHead } = prHeads({ 1454: partial });
    assert.match(editTreeRefusal("edit", ["1454"], { git, prHead }) ?? "", /could not read PR #1454's head/,
      `${JSON.stringify(partial)} must be refused as unreadable`);
  }
});

test("#1446: edit must be given a PR NUMBER first, and create asks nothing here", () => {
  const { git, asked: gitAsked } = gitFacts({});
  const { prHead, asked } = prHeads({});
  assert.match(editTreeRefusal("edit", ["agent/x", "--body-file", "b.md"], { git, prHead }) ?? "", /takes the PR NUMBER first/);
  assert.equal(editTreeRefusal("create", ["--head", "agent/x"], { git, prHead }), null, "create is #1344's check");
  assert.deepEqual(asked, [], "no head was read for either");
  assert.deepEqual(gitAsked, []);
});

test("#1446 WIRING: main() refuses an edit off PR N's head BEFORE checkBody runs any Acceptance command", () => {
  const source = stripComments(readFileSync(fileURLToPath(new URL("../../../agent-org/src/pr-open.mjs", import.meta.url)), "utf8"));
  const start = source.indexOf("function main(");
  const main = source.slice(start, source.indexOf("\n}\n", start));
  const refusal = main.indexOf("editTreeRefusal(mode, rest,");
  const check = main.indexOf("checkBody(body,");
  assert.ok(refusal > 0 && check > 0, "both calls are in main()");
  assert.ok(refusal < check, "the edit's head is compared before checkBody runs the Acceptance in this tree");
});

// --- #1479: a failure AFTER the landed create exits with its own code, naming what landed ---------------------
//
// `gh pr create` is guarded; the arm that follows it was not, and `main` had no try. A throwing arm left Node to
// exit 1, the code this script sets when nothing was sent, for a PR that exists. Driven through `main` itself
// with every spawn injected, so no test reaches GitHub or runs an Acceptance command.

/** `main` on a body that checks clean, with the create's and the arm's outcomes chosen by the test. */
function driveMain(argv: string[], outcomes: { create: () => void; arm: () => void }) {
  const spawned: string[][] = [];
  const errs: string[] = [];
  let code: number | undefined;
  let thrown: unknown = null;
  try {
    code = prOpenMain(argv, {
      runAcceptance: () => 0,
      run: (args: string[]) => { spawned.push(args); (args[1] === "merge" ? outcomes.arm : outcomes.create)(); },
      git: gitStub,
      err: (l: string) => { errs.push(l); },
      out: () => {},
    });
  } catch (error) {
    thrown = error;
  }
  return { code, thrown, spawned, errs };
}
const succeeds = () => {};
const armFails = () => { throw new Error("Command failed: gh pr merge --auto --merge"); };
const READY_CREATE = ["create", "--title", "x", "--body", VALID_BODY];

test("#1479 ACCEPTANCE: a create that LANDS and an arm that then FAILS exits EXIT_LANDED_THEN_FAILED, naming the PR that exists", () => {
  const r = driveMain(READY_CREATE, { create: succeeds, arm: armFails });
  assert.equal(r.thrown, null, "the arm's failure is caught, never left to Node's uncaught-throw exit");
  assert.equal(r.code, EXIT_LANDED_THEN_FAILED);
  assert.ok(![0, EXIT_NOTHING_SENT, EXIT_USAGE].includes(EXIT_LANDED_THEN_FAILED), "a code no other outcome uses");
  assert.deepEqual(r.spawned.map((a) => a.slice(0, 2)), [["pr", "create"], ["pr", "merge"]], "the create really ran first");
  assert.equal(r.errs.length, 1, "one line");
  assert.match(r.errs[0], /`gh pr create` LANDED/, "it says the write landed");
  assert.match(r.errs[0], /the PR for `agent\/my-branch` at `abc1234` exists/, "and names the branch whose PR exists");
  assert.match(r.errs[0], /run only `gh pr merge --auto --merge`/, "the one step to re-run, which is the step that failed");
  assert.match(r.errs[0], /Command failed: gh pr merge/, "with the spawn's own message");
  assert.doesNotMatch(r.errs[0], /nothing was created/, "never the pre-write refusal's words");
});

test("#1479: with --head, the step to re-run carries that branch", () => {
  // The line's branch is the checkout's: #1344 has already refused a --head that is not the checkout's branch.
  const r = driveMain([...READY_CREATE, "--head", "agent/my-branch"], { create: succeeds, arm: armFails });
  assert.equal(r.code, EXIT_LANDED_THEN_FAILED);
  assert.match(r.errs[0], /run only `gh pr merge --auto --merge agent\/my-branch`/);
});

test("#1479 CONTROL: a create that FAILS still exits EXIT_NOTHING_SENT and never arms; a run where every call succeeds exits 0", () => {
  const failed = driveMain(READY_CREATE, { create: ghFails(), arm: succeeds });
  assert.equal(failed.thrown, null);
  assert.equal(failed.code, EXIT_NOTHING_SENT);
  assert.deepEqual(failed.spawned.map((a) => a[1]), ["create"], "nothing is armed after a create that failed");
  assert.equal(failed.errs.length, 1);
  assert.match(failed.errs[0], /nothing was created/);
  const clean = driveMain(READY_CREATE, { create: succeeds, arm: succeeds });
  assert.equal(clean.thrown, null);
  assert.equal(clean.code, 0);
  assert.deepEqual(clean.errs, []);
  assert.deepEqual(clean.spawned.map((a) => a[1]), ["create", "merge"], "and the arm really ran");
});

test("#1479: the script's header documents every exit code main returns, each on its own line", () => {
  const text = readFileSync(fileURLToPath(new URL("../../../agent-org/src/pr-open.mjs", import.meta.url)), "utf8");
  const header = text.slice(0, text.indexOf("\nimport "));
  for (const code of [0, EXIT_NOTHING_SENT, EXIT_USAGE, EXIT_LANDED_THEN_FAILED]) {
    assert.match(header, new RegExp(`^//\\s+${code}\\s+\\S`, "m"), `exit ${code} has its own line in the header`);
  }
});

// --- #1578: the Acceptance child resolves `gh` from its OWN PATH, never from pr-open's ---

test("#1578 CONTROL: with no override the Acceptance child's environment is the process's, unchanged", () => {
  const env = { PATH: "/usr/bin:/bin", HOME: "/home/x" };
  assert.equal(acceptanceEnv(env), env, "no A11Y_ACCEPTANCE_PATH: the very same environment, not a copy");
  const empty = { ...env, A11Y_ACCEPTANCE_PATH: "" };
  assert.equal(acceptanceEnv(empty), empty, "an EMPTY override is no override -- it must not prepend `:`");
});

test("#1578: the override is prepended to the child's PATH and nothing else changes", () => {
  const env = { PATH: "/usr/bin:/bin", HOME: "/home/x", A11Y_ACCEPTANCE_PATH: "/tmp/shim" };
  assert.deepEqual(acceptanceEnv(env), { ...env, PATH: "/tmp/shim:/usr/bin:/bin" });
  assert.equal(env.PATH, "/usr/bin:/bin", "the process's own environment is not mutated");
  assert.equal(acceptanceEnv({ A11Y_ACCEPTANCE_PATH: "/tmp/shim" }).PATH, "/tmp/shim", "and with no PATH at all");
});

/** Owner read/write/execute, group and others read/execute: a script `PATH` can run. */
const EXECUTABLE = 0o755;

/** A directory holding a `gh` that records its argv and exits 0. */
function recordingGh(): { dir: string; marker: string } {
  const dir = mkdtempSync(join(tmpdir(), "a11y-1578-"));
  const marker = join(dir, "calls");
  writeFileSync(join(dir, "gh"), `#!/bin/sh\necho "$*" >> "${marker}"\nexit 0\n`);
  chmodSync(join(dir, "gh"), EXECUTABLE);
  return { dir, marker };
}

test("#1578 ACCEPTANCE, MUTATION TARGET: driven through main(), the Acceptance reaches the override's gh while create still gets its call", () => {
  // `gh --version` makes no network call even from a real `gh`, so a regression here cannot become a live tracker
  // call: it would only fail to reach the recorder, which is exactly what this asserts against.
  const body = "## Acceptance\n\ngh --version\n\nCloses #1\n";
  const { dir, marker } = recordingGh();
  const spawned: string[][] = [];
  const saved = process.env.A11Y_ACCEPTANCE_PATH;
  process.env.A11Y_ACCEPTANCE_PATH = dir;
  let code: number | undefined;
  try {
    code = prOpenMain(["create", "--draft", "--body", body], {
      run: (args: string[]) => { spawned.push(args); },
      git: () => "agent/x", out: () => {}, err: () => {},
    });
  } finally {
    if (saved === undefined) delete process.env.A11Y_ACCEPTANCE_PATH; else process.env.A11Y_ACCEPTANCE_PATH = saved;
  }
  const recorded = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
  rmSync(dir, { recursive: true, force: true });
  assert.equal(recorded, "--version", "the Acceptance child resolved `gh` from A11Y_ACCEPTANCE_PATH");
  assert.equal(code, 0, "the body checked clean and the create was sent");
  assert.deepEqual(spawned.map((args) => args.slice(0, 2)), [["pr", "create"]],
    "pr-open's own create still went through its injected `gh`, untouched by the override");
});
