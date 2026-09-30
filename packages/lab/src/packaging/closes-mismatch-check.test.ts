/**
 * #549: a PR body can declare `Closes: none` and still close two issues, and nothing compared what the
 * author DECLARED against what GitHub RESOLVED. Measured live, same day: #545 declared `none` and closed
 * #492 and #494 anyway; #537 declared `none` and closed #494. Both cost a hand-reopen -- #492 twice.
 *
 * These fixtures are the ones the issue itself names, driving `closesMismatchReport` directly with an
 * INJECTED `resolved` array rather than a live `closingIssuesReferences` query -- the same "inject the
 * fact, never fetch it" shape every other `merge-guard/*-rule.test.ts` file already uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closesMismatchReport, findClosingPhrase, isRepoWideResolutionFault, recentClosesSiblings, refusal,
  REPO_WIDE_LINES,
} from "../../../agent-org/src/closes-mismatch-check.mjs";
import type { ClosesDeclaration } from "../../../agent-org/src/acceptance-commands.mjs";

const NONE: ClosesDeclaration = { kind: "none", reason: "docs-only change" };
const CLOSES = (numbers: number[]): ClosesDeclaration => ({ kind: "closes", numbers });

// --- findClosingPhrase ---

test("findClosingPhrase: finds a real `closes #N` line, case-insensitively, and names the line number", () => {
  const body = "Some prose.\n\nThe wiring PR (#530) closes #494 once it lands.\n\nMore prose.";
  const found = findClosingPhrase(body, 494);
  assert.ok(found);
  assert.equal(found?.line, 3);
  assert.match(found?.text ?? "", /closes #494/);
});

test("findClosingPhrase: the exact #545/#537 shape -- a closing verb mid-sentence, not at line start", () => {
  const body = "A closed row whose acceptance now says it closes #492, which needs a look.";
  const found = findClosingPhrase(body, 492);
  assert.ok(found, "the exact incident shape must be locatable");
});

test("findClosingPhrase: null when the number never appears with a closing keyword", () => {
  const body = "This PR references #487 in passing, with no closing verb nearby.";
  assert.equal(findClosingPhrase(body, 487), null);
});

test("findClosingPhrase: a bare mention with no closing keyword at all is not found", () => {
  const body = "See #510 for background.";
  assert.equal(findClosingPhrase(body, 510), null);
});

// --- closesMismatchReport: the issue's own four fixtures, verbatim ---

test("#549 FIXTURE 1: declared none + resolved [492,494] -> REFUSED, naming both", () => {
  const body = "Closes: none — cleanup only.\n\nThe wiring PR (#530) closes #494.\n"
    + "A closed row whose acceptance now says it closes #492.";
  const report = closesMismatchReport(NONE, [492, 494], body);
  assert.equal(report.ok, false);
  if (report.ok === false) {
    assert.equal(report.reasons.length, 2);
    assert.ok(report.reasons.some((r) => r.includes("#492")));
    assert.ok(report.reasons.some((r) => r.includes("#494")));
    // THE DIFFERENCE, NOT JUST THAT THERE IS ONE -- the issue's own acceptance line.
    assert.ok(report.reasons.some((r) => /line \d+/.test(r)),
      "at least one reason must point at the actual line, not just the number");
  }
});

test("#549 FIXTURE 2: declared [487] + resolved [] -> REFUSED, naming 487 as declared-but-unresolvable", () => {
  const report = closesMismatchReport(CLOSES([487]), [], "Closes #487\n\nSome description.");
  assert.equal(report.ok, false);
  if (report.ok === false) {
    assert.equal(report.reasons.length, 1);
    assert.match(report.reasons[0], /#487/);
    assert.match(report.reasons[0], /will NOT close it/);
  }
});

test("#549 FIXTURE 3: declared [510,497] + resolved [510,497] -> allowed", () => {
  const report = closesMismatchReport(CLOSES([510, 497]), [510, 497], "Closes #510, #497");
  assert.deepEqual(report, { ok: true });
});

test("#549 FIXTURE 4: declared none + resolved [] -> allowed", () => {
  const report = closesMismatchReport(NONE, [], "Closes: none — docs only.");
  assert.deepEqual(report, { ok: true });
});

// --- The `resolved` order/set does not matter, and a lookup FAILURE is a distinct, never-clean state ---

test("resolved order is irrelevant -- this is a SET comparison, not a sequence one", () => {
  const report = closesMismatchReport(CLOSES([497, 510]), [510, 497], "Closes #497, #510");
  assert.deepEqual(report, { ok: true });
});

test("resolved: null (the lookup failed) is CANNOT ASK, never treated as a clean/empty match", () => {
  const report = closesMismatchReport(NONE, null, "Closes: none — reason");
  assert.equal(report.ok, null);
  if (report.ok === null) {
    assert.match(report.reason, /closingIssuesReferences/);
  }
});

// --- missing/malformed declarations are this comparison's non-concern -- closesDeclarationReport's job ---

test("a MISSING declaration is treated as declaring nothing, for this comparison only", () => {
  const report = closesMismatchReport({ kind: "missing" }, [], "no closes line at all");
  assert.deepEqual(report, { ok: true });
});

test("a MISSING declaration with a real resolved closure is still reported, same as `none`", () => {
  const report = closesMismatchReport({ kind: "missing" }, [494], "the wiring PR closes #494");
  assert.equal(report.ok, false);
});

test("a MALFORMED declaration is treated as declaring nothing, for this comparison only", () => {
  const report = closesMismatchReport({ kind: "malformed", detail: "no #<number>" }, [], "Closes: something");
  assert.deepEqual(report, { ok: true });
});

// --- MUTATION TARGET: the comparison must run in BOTH directions, not just one ---

test("#549 MUTATION TARGET: an accidental closure with NO declared numbers at all is still caught -- not "
  + "only when some numbers were declared", () => {
  const report = closesMismatchReport(CLOSES([]), [999], "no closing phrase written deliberately");
  assert.equal(report.ok, false);
});

test("#549 MUTATION TARGET: extra undeclared closures alongside correctly-declared ones are still named", () => {
  // #510 was declared and correctly resolved; #999 was never declared but GitHub resolves it anyway --
  // both real, independent facts, and only the second is a fault.
  const report = closesMismatchReport(CLOSES([510]), [510, 999], "Closes #510");
  assert.equal(report.ok, false);
  if (report.ok === false) {
    assert.equal(report.reasons.length, 1);
    assert.match(report.reasons[0], /#999/);
  }
});

// --- MUTATION TARGET: a well-formed PR must NEVER be refused -- a false refusal stops the whole queue,
// not just this row, since this check runs unconditionally in mergeSafety's required `gate` context ---

test("#549 MUTATION TARGET: a genuinely clean PR (declared matches resolved, several numbers, any order) "
  + "is never refused -- this is the failure mode that stops the pipeline, not just one row", () => {
  const clean = [
    [CLOSES([510, 497]), [510, 497]],
    [CLOSES([497, 510]), [510, 497]],
    [NONE, []],
    [CLOSES([1]), [1]],
  ] as const;
  for (const [declaration, resolved] of clean) {
    const report = closesMismatchReport(declaration, [...resolved], "irrelevant body for this check");
    assert.deepEqual(report, { ok: true },
      `expected a clean match to be allowed: declared ${JSON.stringify(declaration)}, resolved ${JSON.stringify(resolved)}`);
  }
});

// --- #2810: GitHub resolving NOTHING for every recent PR is a repo-wide condition, not this body ---

const sibling = (number: number, resolved: number[] = []) => ({ number, resolved });
const THREE_DEAD = [sibling(1), sibling(2), sibling(3)];
const LONE = { declared: [2810], resolved: [] as number[] };
const openPr = (number: number, body: string, resolved: number[] = []) => ({ number, body, resolved });

test("#2810 decider: declares, resolves none, and all 3 siblings resolve none -> repo-wide", () => {
  assert.equal(isRepoWideResolutionFault(LONE, THREE_DEAD), true);
});

test("#2810 decider POSITIVE CONTROLS: every other input is a lone mismatch", () => {
  const cases: [string, Parameters<typeof isRepoWideResolutionFault>][] = [
    ["one sibling resolves a number", [LONE, [sibling(1), sibling(2, [77]), sibling(3)]]],
    ["fewer than 3 siblings declare a Closes", [LONE, [sibling(1), sibling(2)]]],
    ["no siblings at all", [LONE, []]],
    ["the sibling lookup could not ask (null)", [LONE, null]],
    ["the PR under test has an accidental closure", [{ declared: [2810], resolved: [55] }, THREE_DEAD]],
    ["the PR under test resolved its own declaration", [{ declared: [2810], resolved: [2810] }, THREE_DEAD]],
    ["the PR under test declares no number", [{ declared: [], resolved: [] }, THREE_DEAD]],
  ];
  for (const [name, args] of cases) assert.equal(isRepoWideResolutionFault(...args), false, name);
});

test("#2810 siblings: the 3 newest OTHER open PRs declaring a non-empty Closes, drafts included", () => {
  const prs = [
    openPr(10, "Closes #1"), openPr(9, "Closes: none — docs only"), openPr(8, "no declaration"),
    openPr(7, "Closes #2, #3", [2]), openPr(6, "Closes #4"), openPr(5, "Closes #5"),
  ];
  assert.deepEqual(recentClosesSiblings(prs, 10), [sibling(7, [2]), sibling(6), sibling(5)]);
  assert.equal(recentClosesSiblings(null, 10), null, "could not ask stays null, never []");
});

const OPEN_REFUSAL = closesMismatchReport(CLOSES([2810]), [], "Closes #2810");

test("#2810 repo-wide message names the condition and replaces the per-body advice", () => {
  assert.equal(OPEN_REFUSAL.ok, false);
  const { lines } = refusal(OPEN_REFUSAL as { ok: false; reasons: string[] }, true);
  const text = lines.join("\n");
  assert.match(text, /last 3 open PRs that declare one/);
  assert.match(text, /repo-wide and not this body/);
  assert.match(text, /Do not edit the body\. Do not rerun\. Do not write `Closes: none`/);
  assert.match(text, /merge stays blocked/);
  assert.match(text, /`product-manager`/);
  assert.doesNotMatch(text, /confirm #/);
  assert.deepEqual(lines.slice(1), [...REPO_WIDE_LINES]);
});

test("#2810 a lone mismatch keeps today's message byte for byte", () => {
  const { lines, exit } = refusal(OPEN_REFUSAL as { ok: false; reasons: string[] }, false);
  assert.equal(exit, 1);
  assert.deepEqual(lines, [
    "CLOSES MISMATCH: REFUSED -- what you declared and what GitHub will actually close disagree:",
    "  you declared #2810, but GitHub will NOT close it -- the declaration did not produce a real closing "
      + 'reference (confirm #2810 exists in this repo, and that the line reads exactly "Closes #2810")',
  ]);
});

test("#2810 the exit STAYS 1 for both wordings, and refusal accepts no ok report to turn into an exit 0", () => {
  const refused = OPEN_REFUSAL as { ok: false; reasons: string[] };
  for (const repoWide of [true, false]) assert.equal(refusal(refused, repoWide).exit, 1);
});

// --- the whole CLI against a fake `gh`, so the exit code is read from a real process ---

function runCheck(ghAnswers: { own: number[]; open: unknown[] | "fail" }) {
  const dir = mkdtempSync(join(tmpdir(), "closes-check-"));
  const fake = join(dir, "gh");
  const open = ghAnswers.open === "fail" ? null : { data: { repository: { pullRequests: { nodes: ghAnswers.open } } } };
  const own = { data: { repository: { pullRequest: { closingIssuesReferences: {
    nodes: ghAnswers.own.map((number) => ({ number, title: "t", labels: { nodes: [] } })) } } } } };
  writeFileSync(join(dir, "own.json"), JSON.stringify(own));
  writeFileSync(join(dir, "open.json"), JSON.stringify(open));
  writeFileSync(fake, `#!/bin/sh
case "$*" in
  *pullRequests*) [ "${ghAnswers.open === "fail"}" = true ] && exit 1; cat "${dir}/open.json" ;;
  *) cat "${dir}/own.json" ;;
esac
`);
  chmodSync(fake, 0o755);
  const result = spawnSync(process.execPath, ["packages/agent-org/src/closes-mismatch-check.mjs", "2810"], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PR_BODY: "Closes #2810" },
  });
  return { status: result.status, out: result.stdout };
}

const deadNode = (number: number) => ({ number, body: `Closes #${number}`, closingIssuesReferences: { nodes: [] } });

test("#2810 CLI: repo-wide condition prints the diagnostic and still exits 1", () => {
  const { status, out } = runCheck({ own: [], open: [deadNode(2810), deadNode(2809), deadNode(2808), deadNode(2807)] });
  assert.equal(status, 1);
  assert.match(out, /repo-wide and not this body/);
});

test("#2810 CLI: a lone mismatch (a sibling resolved) keeps today's words and exit 1", () => {
  const live = { number: 2808, body: "Closes #5", closingIssuesReferences: { nodes: [{ number: 5 }] } };
  const { status, out } = runCheck({ own: [], open: [deadNode(2809), live, deadNode(2807), deadNode(2806)] });
  assert.equal(status, 1);
  assert.match(out, /will NOT close it/);
  assert.doesNotMatch(out, /repo-wide/);
});

test("#2810 CLI: a sibling lookup that could not ask is a lone mismatch, exit 1", () => {
  const { status, out } = runCheck({ own: [], open: "fail" });
  assert.equal(status, 1);
  assert.match(out, /will NOT close it/);
});
