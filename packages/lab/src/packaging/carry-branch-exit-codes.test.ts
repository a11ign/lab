/**
 * `packages/agent-org/src/carry-branch.mjs` -- the exit-code and PR-note contract, driven entirely through an
 * INJECTED `run`. No repository, no remote, no worktree: every test here answers "given these command
 * results, what does the carry decide and what does it exit with", which is a question about this module,
 * not about git.
 *
 * SPLIT OUT OF `carry-branch.test.ts` (#656) BECAUSE OF WHAT THE FIXTURE COST. That file builds a real
 * three-actor git topology and resets it before EVERY test; these tests never touch it, so each one paid
 * ~7 git spawns for a fixture it did not read. Splitting is what this package already does elsewhere, and
 * it keeps the real-git file honest: what is left there genuinely needs a repository.
 */
// no-token: gh
//
// #1477: carry-branch.mjs spawns `gh` in `noteCarryOnPr`, so the acceptance classifier charges this whole file
// for a token. No test here reaches that spawn -- every `noteCarryOnPr` and `carryMain` test injects its own
// `run`, and nothing in this file calls either with the default one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { noteCarryOnPr, carryMain, EXIT } from "../../../agent-org/src/carry-branch.mjs";
import { stripComments } from "@a11ign/evidence/source-text";

// --- noteCarryOnPr: fake `run`, matching this package's own convention for gh-calling functions ---

test("noteCarryOnPr posts a comment naming the carrier and reason, on the branch's real open PR", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify([{ number: 614 }]);
    return "";
  };
  const result = noteCarryOnPr("agent/pre-push-delete-583", "dispatcher", "97 behind, past the escalation window", { run });
  assert.deepEqual(result, { commented: true, prNumber: 614 });
  const commentCall = calls.find((a) => a[0] === "pr" && a[1] === "comment");
  assert.ok(commentCall, "must post the comment");
  assert.equal(commentCall![2], "614");
  const body = commentCall![commentCall!.indexOf("--body") + 1];
  assert.match(body, /Carried by `dispatcher`/);
  assert.match(body, /97 behind, past the escalation window/);
});

test("noteCarryOnPr reports (never throws) when the branch has no open PR", () => {
  const run = () => JSON.stringify([]);
  const result = noteCarryOnPr("agent/no-pr-branch", "dispatcher", "why", { run });
  assert.equal(result.commented, false);
  assert.match((result as { reason: string }).reason, /no open PR/);
});

test("noteCarryOnPr reports (never throws) when the PR lookup itself fails", () => {
  const run = () => { throw new Error("gh: authentication required"); };
  const result = noteCarryOnPr("agent/x", "dispatcher", "why", { run });
  assert.equal(result.commented, false);
  assert.match((result as { reason: string }).reason, /authentication required/);
});


// --- #1477: a failure AFTER the push landed exits 3, CARRIED NOT NOTED -- never 1, which this script's header
// defines as NOT CARRIED. Measured at 0830dd0e through the real CLI with a stub gh: `gh pr comment` failed after
// `git push` landed, escaped as an uncaught throw, and Node exited 1 under stdout's "CARRIED -- ... pushed." ---

const CARRIED_BRANCH = "agent/x-1477";
const FOUND_PR = JSON.stringify([{ number: 42 }]);

/** An injected `run` for the whole carry, where `failAt` picks the one call that throws. No filesystem, no remote. */
function carryRun(failAt: (cmd: string, args: string[]) => boolean) {
  const calls: string[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(`${cmd} ${args.join(" ")}`);
    if (failAt(cmd, args)) throw new Error(`simulated: ${cmd} ${args.slice(0, 2).join(" ")} failed`);
    if (cmd === "git" && args[0] === "rev-parse") return "1111111111111111111111111111111111111111\n";
    if (cmd === "git" && args[0] === "diff") return " scripts/x.mjs | 1 +\n";
    if (cmd === "gh" && args[1] === "list") return FOUND_PR;
    return "";
  };
  return { run, calls };
}

/** Drives `carryMain` -- the CLI's entry path -- with that `run`, capturing both streams. */
function driveCarry(run: (cmd: string, args: string[]) => string) {
  let out = "";
  let err = "";
  const code = carryMain([CARRIED_BRANCH, "--carrier=worker-judge", "--reason=past the escalation window"], {
    run, stamp: () => {}, workDir: "/nonexistent/carry-1477", cwd: "/nonexistent/repo-1477",
    out: (text: string) => { out += text; }, err: (text: string) => { err += text; } });
  return { code, out, err };
}

const isPush = (cmd: string, args: string[]) => cmd === "git" && args[0] === "push";
const isComment = (cmd: string, args: string[]) => cmd === "gh" && args[0] === "pr" && args[1] === "comment";

test("#1477 ACCEPTANCE: the push LANDED, then the PR note throws -- exit 3 naming the pushed branch and the PR, never 1", () => {
  const { run, calls } = carryRun(isComment);
  const { code, out, err } = driveCarry(run);
  assert.equal(code, EXIT.CARRIED_NOT_NOTED, `a failure after the push must be CARRIED NOT NOTED; got exit ${code}, stderr: ${err}`);
  assert.ok(out.includes(`CARRIED -- ${CARRIED_BRANCH} merged with origin/main and pushed.`));
  assert.match(err, /^CARRIED, NOT NOTED \(exit 3\) -- agent\/x-1477 WAS pushed; /);
  assert.match(err, /found PR #42 for agent\/x-1477, but could not post the note on it -- simulated/);
  assert.doesNotMatch(err, /NOT CARRIED:/);
  const pushAt = calls.findIndex((c) => c.startsWith("git push"));
  const commentAt = calls.findIndex((c) => c.startsWith("gh pr comment"));
  assert.ok(pushAt >= 0 && commentAt > pushAt, `the push must precede the failing note: ${JSON.stringify(calls)}`);
});

test("#1477 CONTROL: a failure BEFORE the push -- the fetch -- stays NOT CARRIED, exit 1, and nothing is pushed or noted", () => {
  const { run, calls } = carryRun((cmd, args) => cmd === "git" && args[0] === "fetch");
  const { code, out, err } = driveCarry(run);
  assert.equal(code, EXIT.NOT_CARRIED);
  assert.match(err, /^NOT CARRIED: could not fetch origin\/main -- simulated/);
  assert.equal(out, "");
  assert.ok(!calls.some((c) => c.startsWith("git push") || c.startsWith("gh ")), JSON.stringify(calls));
});

test("#1477 CONTROL: the push ITSELF refused stays NOT CARRIED, exit 1, and no note is attempted", () => {
  const { run, calls } = carryRun(isPush);
  const { code, err } = driveCarry(run);
  assert.equal(code, EXIT.NOT_CARRIED);
  assert.match(err, /^NOT CARRIED: push refused/);
  assert.ok(!calls.some((c) => c.startsWith("gh ")), JSON.stringify(calls));
});

test("#1477 CONTROL: every call succeeds -- exit 0, CARRIED and noted on the PR, nothing on stderr", () => {
  const { run } = carryRun(() => false);
  const { code, out, err } = driveCarry(run);
  assert.equal(code, EXIT.CARRIED);
  assert.ok(out.includes("Noted on PR #42."));
  assert.equal(err, "");
});

test("#1477: noteCarryOnPr reports (never throws) when the COMMENT itself fails, naming the PR it found", () => {
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "comment") throw new Error("gh: GraphQL rate limit");
    return FOUND_PR;
  };
  const result = noteCarryOnPr(CARRIED_BRANCH, "worker-judge", "why", { run });
  assert.equal(result.commented, false);
  assert.match((result as { reason: string }).reason, /found PR #42 .*could not post the note on it -- gh: GraphQL rate limit/);
});

test("#1477 WIRING: `main` applies carryMain's exit code and makes no carry decision of its own", () => {
  const source = stripComments(readFileSync(new URL("../../../agent-org/src/carry-branch.mjs", import.meta.url), "utf8"));
  const start = source.indexOf("function main(");
  assert.ok(start >= 0, "main not found");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  assert.match(body, /process\.exitCode = carryMain\(process\.argv\.slice\(2\)\)/);
  assert.doesNotMatch(body, /noteCarryOnPr|carryBranch\(/, "main must not carry or note outside carryMain");
});

test("#1477: the exit codes are the ones this script's header documents -- 3 is CARRIED, NOT NOTED", () => {
  assert.deepEqual({ ...EXIT }, { CARRIED: 0, NOT_CARRIED: 1, USAGE: 2, CARRIED_NOT_NOTED: 3 });
  const header = readFileSync(new URL("../../../agent-org/src/carry-branch.mjs", import.meta.url), "utf8").split("import ")[0];
  assert.match(header, /^\/\/ +3 +CARRIED, NOT NOTED -- the branch WAS pushed/m, "the header must document exit 3");
});

