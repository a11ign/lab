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
 * (`scripts/acceptance-commands.mjs`) BEFORE `gh pr create`/`gh pr edit` ever sends it, refusing with the
 * parser's own message. Four real PRs went red on the body in one day, four authors, four modes, none of
 * them a defect in the change -- see `scripts/pr-open.mjs`'s own header for the full account.
 *
 * THE FOUR FIXTURES BELOW ARE RECONSTRUCTED, not archived verbatim -- #708/#723/#727/#736 were each
 * edited to fix the body after the fact (confirmed via `gh api graphql`'s `userContentEdits`, which does
 * not cleanly hand back the exact pre-fix text through consecutive diffs), so each fixture here reproduces
 * the SHAPE #746's own summary table names, verified against the REAL, unmodified
 * `scripts/acceptance-commands.mjs` (never guessed): a duplicate Acceptance header (#708), prose under
 * `Acceptance:` with no `Closes` at all (#723), a piped command the file pre-check cannot parse (#727),
 * and the section living under `## Verified` instead of `## Acceptance` (#736).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { checkBody, bodyFromArgs, armAfterCreate, sendToGitHub } from "../../../../scripts/pr-open.mjs";

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
  const path = fileURLToPath(new URL("../../../../scripts/pr-open.mjs", import.meta.url));
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
  const ok = sendToGitHub("create", ["--title", "x"],
    { run: ghFails(), git: gitStub, err: (l: string) => { lines.push(l); } });

  assert.equal(ok, false, "the caller sets exit 1 from this");
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
  const ok = sendToGitHub("create", ["--title", "x"],
    { run: (args: string[]) => { spawned.push(args); }, git: gitStub, err: (l: string) => { lines.push(l); } });

  assert.equal(ok, true);
  assert.deepEqual(lines, [], "silence on success -- the failure line must move with the outcome");
  assert.equal(spawned[0][0], "pr", "and the command really ran rather than being skipped");
  // The ARM spawn, which no test asserted: `run(args.slice(1))` sent `gh merge --auto --merge` after every
  // ready create, an unknown command thrown raw after the PR already existed. `armAfterCreate`'s own tests
  // check the argv it RETURNS; this checks the argv `sendToGitHub` actually SPAWNS from it.
  assert.deepEqual(spawned.slice(1), [["pr", "merge", "--auto", "--merge"]],
    "a ready create is armed with the whole `gh pr merge` argv, `pr` included");
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
