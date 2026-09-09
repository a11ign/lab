/**
 * `scripts/row-claim.mjs` answers "is this row claimed?" by reading the BOARD (issue labels), never git
 * history -- #28 and #30 (2026-09-06) were each pulled twice because the documented collision check
 * (`git log --branches='agent/*' --not origin/main -- <path>`) answers "would I collide in this file",
 * not "is somebody already on this row". See that file's own header for the incident and the reasoning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimStatus, decideClaim, fetchLabels, claimRow, dispatchRow, declineRow, moveProjectStatus,
  CLAIM_LABEL, STARTED_LABEL, BLOCKED_LABEL, recordCheck, recordConflict, latestCheckFor,
  worktreeStatus, removeClaimedWorktree, WORKTREE_LABEL_PREFIX,
} from "../../../../scripts/row-claim.mjs";
import { READY_LABEL, WAS_READY_LABEL } from "../../../../scripts/ready-label-audit.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

// Every claim/dispatch/decline test above the #400 section stubs `moveStatus: () => ({ moved: true })` --
// #400 is about the Project Status VIEW specifically, and those tests are about the LABEL, the record.
// Without the stub, the real default `moveProjectStatus` would run against the fake `run` these tests
// already inject for label calls, which answers `""` for a GraphQL snapshot query it was never built to
// serve -- caught and reported (never thrown, per `moveProjectStatus`'s own contract), but noisy and
// beside the point of what each of those tests is actually proving.

// --- claimStatus: pure, no I/O ---

test("claimStatus reads a claimed row -- in-progress plus a session label", () => {
  const status = claimStatus(["backlog", "epic", "ready", "in-progress", "session:worker-contracts"]);
  assert.equal(status.claimed, true);
  assert.deepEqual(status.sessions, ["worker-contracts"]);
});

test("claimStatus reads an unclaimed row -- no in-progress label at all", () => {
  const status = claimStatus(["backlog", "epic", "ready"]);
  assert.equal(status.claimed, false);
  assert.equal(status.started, false);
  assert.deepEqual(status.sessions, []);
});

test("claimed with NO session label yet is still claimed, not conflated with unclaimed", () => {
  // Exactly how #55 itself was claimed: the dispatcher set in-progress before assigning a session, on
  // purpose, so nobody could pull it while briefing was in flight.
  const status = claimStatus(["in-progress"]);
  assert.equal(status.claimed, true);
  assert.deepEqual(status.sessions, []);
});

// --- #176: the THIRD state -- dispatched (in-progress + session, no `started`) vs started ---

test("claimStatus reports DISPATCHED-not-started: in-progress + session, no started label", () => {
  const status = claimStatus(["backlog", "ready", "in-progress", "session:worker-contracts"]);
  assert.equal(status.claimed, true);
  assert.equal(status.started, false);
  assert.deepEqual(status.sessions, ["worker-contracts"]);
});

test("claimStatus reports STARTED: in-progress + session + started, all three present", () => {
  const status = claimStatus(["in-progress", "session:worker-contracts", "started"]);
  assert.equal(status.claimed, true);
  assert.equal(status.started, true);
  assert.deepEqual(status.sessions, ["worker-contracts"]);
});

test("multiple session labels are all reported -- a race leaves both visible until one backs off", () => {
  const status = claimStatus(["in-progress", "session:worker-contracts", "session:worker-judge"]);
  assert.deepEqual(status.sessions.sort(), ["worker-contracts", "worker-judge"]);
});

// --- #656: the claim records the BRANCH, so an escalating session can tell a portable row from a held
// one before it ever offers to take it (see scripts/carry-branch.mjs's own header for the incident) ---

test("claimStatus reads the recorded branch off a branch: label", () => {
  const status = claimStatus(["in-progress", "session:worker-config", "started",
    "branch:agent/pre-push-delete-583"]);
  assert.equal(status.branch, "agent/pre-push-delete-583");
});

test("claimStatus reports branch: null when no branch label is present -- a real, common state (a "
  + "dispatched-not-started row, or a non-code row), never a parse failure", () => {
  const status = claimStatus(["in-progress", "session:worker-config"]);
  assert.equal(status.branch, null);
});

test("#665: claimStatus reads the recorded worktree off a worktree: label", () => {
  const status = claimStatus(["in-progress", "session:worker-config", "started",
    "worktree:/Users/danielbeck/Documents/repos/personal/a11y-wt-worktree-665"]);
  assert.equal(status.worktree, "/Users/danielbeck/Documents/repos/personal/a11y-wt-worktree-665");
});

test("#665: claimStatus reports worktree: null when no worktree label is present", () => {
  const status = claimStatus(["in-progress", "session:worker-config"]);
  assert.equal(status.worktree, null);
});

// --- decideClaim: pure ---

test("decideClaim says proceed on a genuinely unclaimed row", () => {
  assert.deepEqual(decideClaim(["backlog", "ready"], "worker-contracts"), { proceed: true });
});

test("decideClaim refuses when claimed by ANOTHER session, and names them", () => {
  const decision = decideClaim(["in-progress", "session:worker-judge"], "worker-contracts");
  assert.equal(decision.proceed, false);
  assert.match((decision as { reason: string }).reason, /worker-judge/);
});

test("decideClaim refuses but says so honestly when claimed with no session recorded", () => {
  const decision = decideClaim(["in-progress"], "worker-contracts");
  assert.equal(decision.proceed, false);
  assert.match((decision as { reason: string }).reason, /no session label recorded yet/);
});

test("decideClaim proceeds on a row this session ALREADY owns -- resuming, not colliding", () => {
  assert.deepEqual(decideClaim(["in-progress", "session:worker-contracts"], "worker-contracts"),
    { proceed: true });
});

// --- fetchLabels: the vacuity guard ---

function jsonRun(response: string) {
  return () => response;
}

function throwingRun(message: string) {
  return () => { throw new Error(message); };
}

test("fetchLabels parses a well-formed gh response", () => {
  const run = jsonRun(JSON.stringify({ number: 55, title: "A row", labels: [{ name: CLAIM_LABEL }] }));
  const result = fetchLabels(55, { run });
  assert.deepEqual(result.labels, [CLAIM_LABEL]);
});

test("MUTATION: gh itself failing is a thrown error, never an empty (= unclaimed-reading) label list", () => {
  const run = throwingRun("gh: authentication required");
  assert.throws(() => fetchLabels(55, { run }), /could not read issue #55/);
});

test("MUTATION: non-JSON output is a thrown error, never a silent empty list", () => {
  const run = jsonRun("not json at all");
  assert.throws(() => fetchLabels(55, { run }), /was not JSON/);
});

test("MUTATION: a response missing the labels field entirely is refused, not read as zero labels", () => {
  const run = jsonRun(JSON.stringify({ number: 55, title: "A row" }));
  assert.throws(() => fetchLabels(55, { run }), /missing number\/title\/labels/);
});

test("MUTATION: a label object with no name is refused rather than silently skipped", () => {
  const run = jsonRun(JSON.stringify({ number: 55, title: "A row", labels: [{ color: "fbca04" }] }));
  assert.throws(() => fetchLabels(55, { run }), /has no name/);
});

test("CONTROL: a genuinely empty label array is accepted -- that is a real, different state from a failure", () => {
  const run = jsonRun(JSON.stringify({ number: 55, title: "A row", labels: [] }));
  assert.deepEqual(fetchLabels(55, { run }).labels, []);
});

// --- claimRow: claim-then-verify, including the backoff path ---

test("claimRow claims a genuinely unclaimed row: reads, writes, re-reads, confirms", () => {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      // Unclaimed on the first read; claimed by us on the re-read after the write below.
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }];
      return JSON.stringify({ number: 55, title: "A row", labels });
    }
    return ""; // the `edit` call
  };
  const result = claimRow(55, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall, "must have written the claim");
  assert.ok(editCall!.includes(CLAIM_LABEL) && editCall!.includes("session:worker-contracts"));
});

test("claimRow refuses immediately when already claimed by another -- never even attempts to write", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify({ number: 55, title: "A row", labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
  };
  const result = claimRow(55, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.claimed, false);
  assert.ok(!calls.some((a) => a[1] === "edit"), "must not write a claim it knows is already someone else's");
});

test("MUTATION: a race detected on the RE-READ is backed off, not reported as a successful claim", () => {
  // The exact scenario the header describes: this session's write lands, but by the time it re-reads,
  // ANOTHER session's write has also landed -- simulating the propagation-lag race.
  let reads = 0;
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      if (reads === 1) return JSON.stringify({ number: 55, title: "A row", labels: [] });
      return JSON.stringify({ number: 55, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }, { name: "session:worker-judge" }] });
    }
    return "";
  };
  const result = claimRow(55, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.claimed, false);
  assert.match((result as { reason: string }).reason, /lost a race to worker-judge/);
  // The FIRST edit call is the forward write, which also removes `ready` (see the `ready`-removal test
  // below) -- and its `--add-label session:worker-contracts` would satisfy a plain `.includes()` check
  // just as well as the back-off call's `--remove-label session:worker-contracts` does, so identify the
  // back-off call by the ADJACENT PAIR, never by mere membership.
  const removedLabels = (args: string[]) => args
    .map((a, i) => (a === "--remove-label" ? args[i + 1] : null))
    .filter((l): l is string => l !== null);
  const removeCall = calls.find((a) => removedLabels(a).includes("session:worker-contracts"));
  assert.ok(removeCall, "must back off by removing its OWN session label");
  assert.ok(!removedLabels(removeCall!).includes(CLAIM_LABEL),
    "must never remove in-progress -- the other session needs it");
  assert.ok(!removedLabels(removeCall!).includes("session:worker-judge"),
    "must never remove a label that is not its own");
});

// --- dispatchRow: #176's fix -- mark taken at dispatch, before anyone has started ---

test("dispatchRow marks in-progress + session, but deliberately NOT started", () => {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }];
      return JSON.stringify({ number: 176, title: "A row", labels });
    }
    return "";
  };
  const result = dispatchRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(CLAIM_LABEL) && editCall!.includes("session:worker-contracts"));
  assert.ok(!editCall!.includes(STARTED_LABEL), "dispatch must not mark started -- that is claim's job");
});

test("MUTATION: a SECOND dispatch sees the FIRST, and refuses -- the whole point of #176", () => {
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "view") {
      // The board already reflects a prior dispatch to another session -- no `claim` ever ran.
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
    }
    return "";
  };
  const result = dispatchRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.claimed, false);
  assert.match((result as { reason: string }).reason, /worker-judge/);
});

test("claimRow (start) additionally writes STARTED_LABEL, transitioning dispatched -> started", () => {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      // Row was already dispatched to us; claiming it now should re-add the same two labels harmlessly
      // and add `started`.
      const labels = reads === 1
        ? [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }]
        : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }, { name: STARTED_LABEL }];
      return JSON.stringify({ number: 176, title: "A row", labels });
    }
    return "";
  };
  const result = claimRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(STARTED_LABEL), "claim/start must mark started");
});

// --- #656: claimRow records the branch, declineRow removes it ---

test("#656 ACCEPTANCE: claimRow given a branch writes branch:<name> in the SAME edit as the claim", () => {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-config" },
        { name: STARTED_LABEL }, { name: "branch:agent/row-claim-branch-656" }];
      return JSON.stringify({ number: 656, title: "A row", labels });
    }
    return "";
  };
  const result = claimRow(656, "worker-config",
    { run, moveStatus: () => ({ moved: true }), branch: "agent/row-claim-branch-656" });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes("branch:agent/row-claim-branch-656"), "must write the branch label");
});

test("claimRow with NO branch given writes no branch: label at all -- not every claimed row is code, "
  + "and a dispatch-only claim may not have one yet", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") return JSON.stringify({ number: 656, title: "A row", labels: [] });
    return "";
  };
  claimRow(656, "worker-config", { run, moveStatus: () => ({ moved: true }) });
  const editCall = calls.find((a) => a[1] === "edit")!;
  assert.ok(!editCall.some((a) => a.startsWith("branch:")), "no branch was given, none should be written");
});

test("#656 MUTATION: losing the claim race backs off the branch label too, not just session -- a "
  + "back-off must leave nothing of this session's attempt standing", () => {
  let reads = 0;
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      if (reads === 1) return JSON.stringify({ number: 656, title: "A row", labels: [] });
      return JSON.stringify({ number: 656, title: "A row", labels: [{ name: CLAIM_LABEL },
        { name: "session:worker-config" }, { name: "session:worker-judge" }] });
    }
    return "";
  };
  const result = claimRow(656, "worker-config",
    { run, moveStatus: () => ({ moved: true }), branch: "agent/row-claim-branch-656" });
  assert.equal(result.claimed, false);
  const removedLabels = (args: string[]) => args
    .map((a, i) => (a === "--remove-label" ? args[i + 1] : null)).filter((l): l is string => l !== null);
  const backOffCall = calls.find((a) => removedLabels(a).includes("session:worker-config"));
  assert.ok(backOffCall, "must back off");
  assert.ok(removedLabels(backOffCall!).includes("branch:agent/row-claim-branch-656"),
    "the branch label this attempt wrote must be removed alongside the session label it lost with");
});

test("#656 ACCEPTANCE: declineRow removes the recorded branch label when releasing a row", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 656, title: "A row", labels: [{ name: CLAIM_LABEL },
        { name: "session:worker-config" }, { name: STARTED_LABEL },
        { name: "branch:agent/row-claim-branch-656" }] });
    }
    return "";
  };
  const result = declineRow(656, "worker-config", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.declined, true);
  const editCall = calls.find((a) => a[1] === "edit")!;
  const removedLabels = editCall
    .map((a, i) => (a === "--remove-label" ? editCall[i + 1] : null)).filter((l): l is string => l !== null);
  assert.ok(removedLabels.includes("branch:agent/row-claim-branch-656"),
    "declining must remove the stale branch label -- a released row is nobody's, and a lingering "
    + "branch: label would tell a future escalation \"held\" for a row that is actually free");
});

// --- #665: claimRow records the worktree, declineRow removes it (and the directory it names) ---

test("#665 ACCEPTANCE: claimRow given a worktree writes worktree:<path> in the SAME edit as the claim", () => {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-config" },
        { name: STARTED_LABEL }, { name: "worktree:/tmp/a11y-wt-665" }];
      return JSON.stringify({ number: 665, title: "A row", labels });
    }
    return "";
  };
  const result = claimRow(665, "worker-config",
    { run, moveStatus: () => ({ moved: true }), worktree: "/tmp/a11y-wt-665" });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(`${WORKTREE_LABEL_PREFIX}/tmp/a11y-wt-665`), "must write the worktree label");
});

test("#665 ACCEPTANCE: declineRow calls removeWorktree with the recorded path, and removes the label "
  + "once it succeeds", () => {
  const calls: string[][] = [];
  const removeCalls: string[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 665, title: "A row", labels: [{ name: CLAIM_LABEL },
        { name: "session:worker-config" }, { name: STARTED_LABEL },
        { name: "worktree:/tmp/a11y-wt-665" }] });
    }
    return "";
  };
  const removeWorktree = (path: string) => { removeCalls.push(path); return { removed: true } as const; };
  const result = declineRow(665, "worker-config", { run, moveStatus: () => ({ moved: true }), removeWorktree });
  assert.equal(result.declined, true);
  assert.deepEqual(removeCalls, ["/tmp/a11y-wt-665"], "must call removeWorktree with the recorded path");
  const editCall = calls.find((a) => a[1] === "edit")!;
  const removedLabels = editCall
    .map((a, i) => (a === "--remove-label" ? editCall[i + 1] : null)).filter((l): l is string => l !== null);
  assert.ok(removedLabels.includes("worktree:/tmp/a11y-wt-665"), "must remove the stale worktree label too");
});

test("#665 MUTATION direction 1: a DIRTY worktree refuses the WHOLE decline, named -- the label stays, "
  + "so a future reader still knows the claim was open, rather than losing the record while the "
  + "directory (and whatever uncommitted work sits in it) silently survives untracked", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify({ number: 665, title: "A row", labels: [{ name: CLAIM_LABEL },
      { name: "session:worker-config" }, { name: STARTED_LABEL },
      { name: "worktree:/tmp/a11y-wt-665" }] });
  };
  const removeWorktree = () => ({ removed: false as const,
    reason: "/tmp/a11y-wt-665 has uncommitted change(s) -- refusing to remove it: M dirty.txt",
    files: ["M dirty.txt"] });
  const result = declineRow(665, "worker-config", { run, moveStatus: () => ({ moved: true }), removeWorktree });
  assert.equal(result.declined, false);
  assert.match((result as { reason: string }).reason, /uncommitted change/);
  assert.ok(!calls.some((a) => a[1] === "edit"),
    "a dirty worktree must refuse BEFORE any label is touched -- the claim record must stay intact");
});

test("MUTATION: dispatching a `ready` row removes `ready` -- #197's review finding, caught before merge", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: READY_LABEL }, { name: CLAIM_LABEL }, { name: "session:worker-contracts" }] });
    }
    return "";
  };
  dispatchRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall, "must have written the dispatch");
  const removeIndex = editCall!.indexOf("--remove-label");
  assert.ok(removeIndex !== -1 && editCall![removeIndex + 1] === READY_LABEL,
    `dispatching must remove \`ready\` in the same call, so a row is never both pickable and taken -- `
    + `got: ${JSON.stringify(editCall)}`);
});

test("#449 MUTATION TARGET: claiming a `ready` row writes the was-ready marker in the SAME edit that "
  + "removes `ready` -- this is the only place declineRow can later learn the fact", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: READY_LABEL }, { name: CLAIM_LABEL }, { name: "session:worker-contracts" }] });
    }
    return "";
  };
  dispatchRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  const editCall = calls.find((a) => a[1] === "edit")!;
  assert.ok(editCall.includes(WAS_READY_LABEL)
    && editCall[editCall.indexOf(WAS_READY_LABEL) - 1] === "--add-label",
    `the marker must be ADDED, not merely mentioned -- got: ${JSON.stringify(editCall)}`);
});

test("claiming a row that was NEVER `ready` writes no was-ready marker at all", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") return JSON.stringify({ number: 176, title: "A row", labels: [] });
    return "";
  };
  claimRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  const editCall = calls.find((a) => a[1] === "edit")!;
  assert.ok(!editCall.includes(WAS_READY_LABEL), "no marker for a row that was never ready to begin with");
});

test("#444: a runner: label is NEVER removed by a claim -- it survives, unlike ready", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 324, title: "V1 rehearsal",
        labels: [{ name: READY_LABEL }, { name: "runner:worker-audit" }] });
    }
    return "[]"; // eligibility lookups (B2/B4) see an empty answer and fail open
  };
  const result = claimRow(324, "worker-audit", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.claimed, true, `expected a successful claim by the named runner, got: `
    + `${JSON.stringify(result)}`);
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall, "must have written the claim");
  const removedLabels = editCall!.map((a, i) => (a === "--remove-label" ? editCall![i + 1] : null))
    .filter((l): l is string => l !== null);
  assert.ok(!removedLabels.includes("runner:worker-audit"),
    "runner: records WHO a row was reserved for, and stays true after the reservation is honoured");
  assert.ok(removedLabels.includes(READY_LABEL), "ready must still be removed as usual");
});

// --- declineRow: give a row back, #176's second acceptance case ---

test("declineRow returns a dispatched-but-not-started row to genuinely unclaimed, and does NOT invent "
  + "`ready` when there is no was-ready marker (#449)", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }] });
    }
    return "";
  };
  const result = declineRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.deepEqual(result, { declined: true, restoredReady: false, blocked: false, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(CLAIM_LABEL) && editCall!.includes("session:worker-contracts"));
  assert.ok(!editCall!.includes("--add-label"),
    "no was-ready marker present -- nothing to restore, so decline must only remove labels here");
});

test("declineRow also clears STARTED_LABEL when a started row is declined", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }, { name: STARTED_LABEL }] });
    }
    return "";
  };
  const result = declineRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.deepEqual(result, { declined: true, restoredReady: false, blocked: false, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(STARTED_LABEL));
});

// --- #449: declineRow restores the label the row carried BEFORE the claim ---

test("#449 ACCEPTANCE: a claim-then-decline of a row that WAS `ready` restores `ready`, via the "
  + "was-ready marker `writeRowLabels` wrote at claim time", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 171, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-audit" }, { name: STARTED_LABEL },
          { name: WAS_READY_LABEL }] });
    }
    return "";
  };
  const moveCalls: [number, string][] = [];
  const result = declineRow(171, "worker-audit",
    { run, moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; } });
  assert.deepEqual(result, { declined: true, restoredReady: true, blocked: false, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit")!;
  assert.ok(editCall.includes(READY_LABEL) && editCall[editCall.indexOf(READY_LABEL) - 1] === "--add-label",
    "ready must be ADDED back, not merely absent from the removal list");
  assert.ok(editCall.includes(WAS_READY_LABEL), "the marker itself must be removed -- its job is done");
  assert.deepEqual(moveCalls, [[171, "Ready"]], "the Project view must move back to Ready too");
});

test("#449 ACCEPTANCE: MUTATION TARGET -- a decline carrying --blocked leaves `blocked`, not `ready`, "
  + "even though the was-ready marker is present, and records the reason as a comment", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 171, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-audit" }, { name: STARTED_LABEL },
          { name: WAS_READY_LABEL }] });
    }
    return "";
  };
  const moveCalls: [number, string][] = [];
  const result = declineRow(171, "worker-audit", { run,
    moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; },
    blockedReason: "found it depends on unmerged work" });
  assert.deepEqual(result, { declined: true, restoredReady: false, blocked: true, statusMoved: true });
  const editCall = calls.find((a) => a[1] === "edit")!;
  assert.ok(editCall.includes(BLOCKED_LABEL), "blocked must be added");
  assert.ok(!editCall.includes(READY_LABEL), "ready must NOT be added -- the decline is itself a finding");
  const commentCall = calls.find((a) => a[1] === "comment");
  assert.ok(commentCall, "the reason must be recorded somewhere a future reader can see it");
  assert.match(commentCall!.join(" "), /found it depends on unmerged work/);
  assert.deepEqual(moveCalls, [], "no Project Status move for a blocked decline -- no verified option to move to");
});

test("declineRow refuses to release a row held by someone else", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify({ number: 176, title: "A row",
      labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
  };
  const result = declineRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.declined, false);
  assert.match((result as { reason: string }).reason, /worker-judge/);
  assert.ok(!calls.some((a) => a[1] === "edit"), "must not write anything when refusing");
});

test("declineRow says so, rather than silently no-op'ing, when the row was never claimed", () => {
  const run = () => JSON.stringify({ number: 176, title: "A row",
    labels: [{ name: "backlog" }, { name: "ready" }] });
  const result = declineRow(176, "worker-contracts", { run, moveStatus: () => ({ moved: true }) });
  assert.equal(result.declined, false);
  assert.match((result as { reason: string }).reason, /nothing to decline/);
});

// --- #226: recordCheck / recordConflict / latestCheckFor -- the check-log is the denominator, a conflict
// entry paired with the tool's own prior verdict is the numerator. ---

function withTempLogDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "row-claim-log-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("latestCheckFor returns null for an issue nothing ever recorded, never an empty-but-present entry", () => {
  withTempLogDir((dir) => {
    assert.equal(latestCheckFor(join(dir, "does-not-exist.jsonl"), 226), null);
  });
});

test("recordCheck appends an entry latestCheckFor can then read back, verbatim", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordCheck(log, { issueNumber: 226, claimed: false, started: false, sessions: [],
      reachability: { code: 0, output: "#226 is STARTABLE" } });
    const entry = latestCheckFor(log, 226) as { kind: string, issueNumber: number, claimed: boolean,
      reachability: { code: number, output: string } };
    assert.equal(entry.kind, "check");
    assert.equal(entry.issueNumber, 226);
    assert.equal(entry.claimed, false);
    assert.equal(entry.reachability.code, 0);
    assert.match(entry.reachability.output, /STARTABLE/);
  });
});

test("latestCheckFor picks the MOST RECENT check when an issue was checked more than once", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordCheck(log, { issueNumber: 226, claimed: false, started: false, sessions: [],
      reachability: { code: 1, output: "BLOCKED" } });
    recordCheck(log, { issueNumber: 226, claimed: true, started: true, sessions: ["worker-config"],
      reachability: null });
    const entry = latestCheckFor(log, 226) as { claimed: boolean, sessions: string[] };
    assert.equal(entry.claimed, true);
    assert.deepEqual(entry.sessions, ["worker-config"]);
  });
});

test("latestCheckFor never confuses one issue's checks with another's", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordCheck(log, { issueNumber: 83, claimed: false, started: false, sessions: [],
      reachability: { code: 0, output: "#83 is STARTABLE" } });
    recordCheck(log, { issueNumber: 226, claimed: false, started: false, sessions: [],
      reachability: { code: 0, output: "#226 is STARTABLE" } });
    const entry = latestCheckFor(log, 83) as { issueNumber: number };
    assert.equal(entry.issueNumber, 83);
  });
});

test("latestCheckFor ignores CONFLICT entries -- only a check entry is a recorded verdict", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordCheck(log, { issueNumber: 226, claimed: false, started: false, sessions: [],
      reachability: { code: 0, output: "#226 is STARTABLE" } });
    recordConflict(log, { issueNumber: 226, recordedVerdict: null, found: "actually closed" });
    const entry = latestCheckFor(log, 226) as { kind: string };
    assert.equal(entry.kind, "check", "the conflict entry must never be read back as the latest CHECK");
  });
});

test("recordConflict pairs the tool's own verbatim verdict with what the worker found -- both sides kept", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordCheck(log, { issueNumber: 83, claimed: false, started: false, sessions: [],
      reachability: { code: 0, output: "#83 is STARTABLE: every symbol it names is on `main`." } });
    const recordedVerdict = latestCheckFor(log, 83);
    recordConflict(log, { issueNumber: 83, recordedVerdict,
      found: "CLOSED -- the work had merged 25 minutes earlier" });

    const raw = readFileSync(log, "utf8").trim().split("\n").map((l: string) => JSON.parse(l));
    const conflict = raw.find((e: { kind: string }) => e.kind === "conflict");
    assert.equal(conflict.issueNumber, 83);
    assert.match(conflict.found, /CLOSED/);
    assert.ok(conflict.recordedVerdict, "the tool's own prior verdict must travel WITH the finding");
    assert.match(conflict.recordedVerdict.reachability.output, /STARTABLE/,
      "the tool's verbatim answer, not a paraphrase of it");
  });
});

test("recordConflict against an issue nothing ever checked records recordedVerdict: null, not a guess", () => {
  withTempLogDir((dir) => {
    const log = join(dir, "row-claim-check-log.jsonl");
    recordConflict(log, { issueNumber: 999, recordedVerdict: latestCheckFor(log, 999),
      found: "already built, nobody had checked it first" });
    const raw = readFileSync(log, "utf8").trim().split("\n").map((l: string) => JSON.parse(l));
    assert.equal(raw[0].recordedVerdict, null);
  });
});

test("MUTATION: a write failure is never a silent no-op, matching merge-guard's own log", () => {
  withTempLogDir((dir) => {
    // A directory used as a file path makes the write fail deterministically.
    assert.throws(() => recordCheck(dir, { issueNumber: 226, claimed: false, started: false, sessions: [],
      reachability: null }), /could not write the log/);
  });
});

// --- #400: moveProjectStatus and the claim/decline wiring that calls it ---
//
// ARRAYS, PUSHED TO, NEVER A REASSIGNED `let x: T | null = null`. That shape looks harmless and is not:
// a callback stored in `run`/`moveStatus`/`snapshot` and invoked from INSIDE the function under test
// means TS's control-flow narrowing cannot see the assignment as reachable before a later `assert.ok`,
// which narrows the declared-`null` type to `never` rather than to `T` -- a real compile error this file
// hit while adding these tests. Every other test above already uses the array-push form for exactly this
// reason; these follow it rather than reintroducing the trap.

/** A generic pass-through snapshot stub -- skips the real board fetch/write, runs `mutate` directly. */
function noopSnapshot<T>(mutate: () => T): T {
  return mutate();
}

test("moveProjectStatus snapshots first, then moves the field, in that order", () => {
  const order: string[] = [];
  const run = (cmd: string, args: string[]) => { order.push(args[1] ?? args[0]); return ""; };
  const snapshot = <T,>(mutate: () => T): T => { order.push("SNAPSHOT"); return mutate(); };
  const result = moveProjectStatus(400, "In progress", { run, snapshot, log: () => {} });
  assert.deepEqual(result, { moved: true });
  assert.deepEqual(order, ["SNAPSHOT", "item-edit"],
    "the snapshot must run, and complete, BEFORE the mutation it protects");
});

test("moveProjectStatus calls gh project item-edit with the real field name and the given Status option", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => { calls.push(args); return ""; };
  moveProjectStatus(400, "Ready", { run, snapshot: noopSnapshot, log: () => {} });
  const editCall = calls.find((a) => a[1] === "item-edit");
  assert.ok(editCall, "must call gh project item-edit");
  assert.ok(editCall!.includes("--field") && editCall![editCall!.indexOf("--field") + 1] === "Status");
  assert.ok(editCall!.includes("--value") && editCall![editCall!.indexOf("--value") + 1] === "Ready");
  assert.ok(editCall!.some((a) => a.includes("/issues/400")), "must name the real issue by its URL");
});

test("moveProjectStatus NEVER THROWS -- an unexpected gh failure is reported, not a claim failure, and is "
  + "distinguished from the not-on-board case (ceo's ruling: 'could not ask' vs 'asked and wrote' must not "
  + "look the same)", () => {
  const run = (): string => { throw new Error("resource not found, please check the URL"); };
  const logs: string[] = [];
  const result = moveProjectStatus(400, "In progress",
    { run, snapshot: noopSnapshot, log: (line: string) => { logs.push(line); } });
  assert.equal(result.moved, false);
  assert.match((result as { reason: string }).reason, /resource not found/);
  assert.equal((result as { notOnBoard: boolean }).notOnBoard, false,
    "an unrelated gh failure must not be mistaken for the row simply being off the board");
  assert.ok(logs.some((l) => /could not move #400/.test(l)), "the failure must be reported, not swallowed silently");
});

test("moveProjectStatus recognises gh's real 'not an item in project' wording as notOnBoard, verbatim as "
  + "observed against the real API on issue #393 (closed, never added to Project 2)", () => {
  const run = (): string => {
    throw new Error("https://github.com/DanBeckDev/a11y-witness/issues/393 is not an item in project 2; "
      + "add it first with `gh project item-add`");
  };
  const result = moveProjectStatus(393, "Ready", { run, snapshot: noopSnapshot, log: () => {} });
  assert.equal(result.moved, false);
  assert.equal((result as { notOnBoard: boolean }).notOnBoard, true);
});

test("moveProjectStatus reports (never throws) when the SNAPSHOT itself fails, per #399's own rule", () => {
  // `withBoardSnapshot`'s whole contract is that a failed snapshot means the mutation is never even
  // attempted -- proven here by a `run` that would throw if the mutation ran, and asserting it did not.
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => { calls.push(args); return ""; };
  const snapshot = (): never => { throw new Error("board-snapshot: could not write the snapshot"); };
  const result = moveProjectStatus(400, "In progress", { run, snapshot, log: () => {} });
  assert.equal(result.moved, false);
  assert.ok(!calls.some((a) => a[1] === "item-edit"),
    "the mutation must never run without a snapshot in front of it");
});

test("MUTATION target: claimRow moves Status to 'In progress' on a successful claim", () => {
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }];
      return JSON.stringify({ number: 400, title: "A row", labels });
    }
    return "";
  };
  const moveCalls: [number, string][] = [];
  const result = claimRow(400, "worker-contracts",
    { run, moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; } });
  assert.deepEqual(result, { claimed: true, statusMoved: true });
  assert.deepEqual(moveCalls, [[400, "In progress"]]);
});

test("claimRow's own claimed:true does not depend on the Status move succeeding -- #400's explicit case: "
  + "a row not on the Project must not fail the claim, and is reported as the permitted gap it is, "
  + "not as a half-applied failure", () => {
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }];
      return JSON.stringify({ number: 400, title: "A row", labels });
    }
    return "";
  };
  const result = claimRow(400, "worker-contracts",
    { run, moveStatus: () => ({ moved: false, reason: "not on the Project", notOnBoard: true }) });
  assert.deepEqual(result, { claimed: true, statusMoved: false, notOnBoard: true, statusReason: "not on the Project" },
    "the label write is the real claim and must succeed regardless of the Project view, and the row-absent "
    + "case must be distinguishable from a genuine half-applied failure");
});

test("claimRow reports a GENUINE Status-write failure as half-applied -- ceo's ruling: 'asked and wrote' "
  + "must never look like a plain success, even though the label (the record) still stands", () => {
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "view") {
      reads += 1;
      const labels = reads === 1 ? [] : [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }];
      return JSON.stringify({ number: 400, title: "A row", labels });
    }
    return "";
  };
  const result = claimRow(400, "worker-contracts",
    { run, moveStatus: () => ({ moved: false, reason: "gh: authentication failed", notOnBoard: false }) });
  assert.deepEqual(result,
    { claimed: true, statusMoved: false, notOnBoard: false, statusReason: "gh: authentication failed" });
});

test("claimRow does NOT move Status when the claim itself is refused (already held by another)", () => {
  const run = () => JSON.stringify({ number: 400, title: "A row",
    labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
  const moveCalls: [number, string][] = [];
  const result = claimRow(400, "worker-contracts",
    { run, moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; } });
  assert.equal(result.claimed, false);
  assert.deepEqual(moveCalls, [], "a row this session never actually claimed must not have its view moved");
});

test("MUTATION target: declineRow moves Status BACK to 'Ready' on a successful decline of a row that "
  + "WAS ready before the claim", () => {
  const run = (cmd: string, args: string[]) => {
    if (args[1] === "view") {
      return JSON.stringify({ number: 400, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }, { name: STARTED_LABEL },
          { name: WAS_READY_LABEL }] });
    }
    return "";
  };
  const moveCalls: [number, string][] = [];
  const result = declineRow(400, "worker-contracts",
    { run, moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; } });
  assert.deepEqual(result, { declined: true, restoredReady: true, blocked: false, statusMoved: true });
  assert.deepEqual(moveCalls, [[400, "Ready"]]);
});

test("declineRow's own declined:true does not depend on the Status move succeeding, and distinguishes "
  + "not-on-board from a genuine half-applied failure the same way claimRow does", () => {
  const run = () => JSON.stringify({ number: 400, title: "A row",
    labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }, { name: STARTED_LABEL },
      { name: WAS_READY_LABEL }] });
  const notOnBoardResult = declineRow(400, "worker-contracts",
    { run, moveStatus: () => ({ moved: false, reason: "not on the Project", notOnBoard: true }) });
  assert.deepEqual(notOnBoardResult, { declined: true, restoredReady: true, blocked: false,
    statusMoved: false, notOnBoard: true, statusReason: "not on the Project" });

  const halfAppliedResult = declineRow(400, "worker-contracts",
    { run, moveStatus: () => ({ moved: false, reason: "gh: rate limited", notOnBoard: false }) });
  assert.deepEqual(halfAppliedResult, { declined: true, restoredReady: true, blocked: false,
    statusMoved: false, notOnBoard: false, statusReason: "gh: rate limited" });
});

test("declineRow does NOT move Status when the decline itself is refused (not this session's row)", () => {
  const run = () => JSON.stringify({ number: 400, title: "A row",
    labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
  const moveCalls: [number, string][] = [];
  const result = declineRow(400, "worker-contracts",
    { run, moveStatus: (n: number, s: string) => { moveCalls.push([n, s]); return { moved: true }; } });
  assert.equal(result.declined, false);
  assert.deepEqual(moveCalls, []);
});

// --- #665: worktreeStatus / removeClaimedWorktree, driven against REAL git worktrees -- the questions
// these functions answer ("is this directory safe to delete") cannot be honestly proven against a fake
// `run`, the same reasoning #656's carry-branch.test.ts already applies to its own detached-worktree
// mechanism. `sandboxGitEnv()` scrubs `GIT_*`, the discipline `test-support/git-sandbox.ts` documents at
// length: `cwd` is not isolation for a spawned git process, `GIT_DIR` is. ---

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: sandboxGitEnv() });
}

/** A real primary checkout plus ONE real linked worktree off it -- the shape `declineRow` releases. */
function withRealWorktree<T>(fn: (t: { primary: string; worktree: string }) => T): T {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "row-claim-worktree-")));
  const primary = join(root, "primary");
  const worktree = join(root, "wt");
  try {
    execFileSync("git", ["init", "--quiet", primary], { env: sandboxGitEnv() });
    git(primary, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    writeFileSync(join(primary, "file.txt"), "committed\n");
    git(primary, ["add", "file.txt"]);
    git(primary, ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "initial"]);
    git(primary, ["worktree", "add", "-q", "-b", "agent/test-branch", worktree]);
    return fn({ primary, worktree });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("#665: worktreeStatus reads a freshly created worktree as clean", () => {
  withRealWorktree(({ worktree }) => {
    assert.deepEqual(worktreeStatus(worktree), { clean: true });
  });
});

test("#665: worktreeStatus names every dirty file in a worktree with uncommitted changes", () => {
  withRealWorktree(({ worktree }) => {
    writeFileSync(join(worktree, "file.txt"), "uncommitted work\n");
    writeFileSync(join(worktree, "new-file.txt"), "untracked too\n");
    const status = worktreeStatus(worktree);
    assert.equal(status.clean, false);
    assert.equal((status as { files: string[] }).files.length, 2,
      `expected 2 dirty entries, got: ${JSON.stringify(status)}`);
  });
});

test("#665: worktreeStatus reads a path that no longer exists as clean -- nothing there to lose", () => {
  assert.deepEqual(worktreeStatus("/tmp/definitely-does-not-exist-row-claim-665"), { clean: true });
});

test("#665 ACCEPTANCE: removeClaimedWorktree removes a real, clean worktree", () => {
  withRealWorktree(({ primary, worktree }) => {
    const result = removeClaimedWorktree(worktree,
      { run: (cmd: string, args: string[]) => git(primary, args) });
    assert.deepEqual(result, { removed: true });
    const remaining = git(primary, ["worktree", "list", "--porcelain"]);
    assert.ok(!remaining.includes(worktree), "the worktree must actually be gone from git's own list");
  });
});

test("#665 ACCEPTANCE / MUTATION direction 1 (the issue's own instruction): a DIRTY worktree is REFUSED "
  + "by name, and is NOT removed -- git's own worktree list still shows it afterward", () => {
  withRealWorktree(({ primary, worktree }) => {
    writeFileSync(join(worktree, "file.txt"), "uncommitted work nobody has anywhere else\n");
    const result = removeClaimedWorktree(worktree,
      { run: (cmd: string, args: string[]) => git(primary, args) });
    assert.equal(result.removed, false);
    assert.match((result as { reason: string }).reason, /uncommitted change/);
    assert.ok((result as { files: string[] }).files.some((f) => f.includes("file.txt")),
      "the refusal must name the dirty file, per the issue's own acceptance");
    const remaining = git(primary, ["worktree", "list", "--porcelain"]);
    assert.ok(remaining.includes(worktree), "the worktree must still be registered -- nothing was removed");
  });
});

test("removeClaimedWorktree on an already-gone path reports removed:true -- nothing left to lose, and "
  + "refusing a decline over a directory that is already absent would be the housekeeping failure this "
  + "row exists to fix, one layer over", () => {
  assert.deepEqual(removeClaimedWorktree("/tmp/definitely-does-not-exist-row-claim-665"), { removed: true });
});

// --- #665's own required mutation, the issue's exact words: "drop the removal. The count grows by one
// per released claim -- assert that, rather than asserting the removal happened, because the defect is
// cumulative and only shows in the count." Driven against REAL worktrees for the same reason as above. ---

test("#665 MUTATION direction 2 (the issue's own instruction): drop the removal, and released claims "
  + "accumulate worktrees one per decline; wire it back in, and the count returns to baseline every time", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "row-claim-count-")));
  const primary = join(root, "primary");
  try {
    execFileSync("git", ["init", "--quiet", primary], { env: sandboxGitEnv() });
    git(primary, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    writeFileSync(join(primary, "file.txt"), "committed\n");
    git(primary, ["add", "file.txt"]);
    git(primary, ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "initial"]);
    const run = (cmd: string, args: string[]) => git(primary, args);
    const worktreeCount = () => (git(primary, ["worktree", "list", "--porcelain"]).match(/^worktree /gm) ?? []).length;
    const baseline = worktreeCount();

    // THE MUTATION: three "claim, do the work, decline" cycles with the removal DROPPED -- the exact
    // shape `declineRow` had before #665, where the label came off but the directory never did.
    for (let i = 0; i < 3; i += 1) {
      const wt = join(root, `dropped-${i}`);
      git(primary, ["worktree", "add", "-q", "-b", `agent/dropped-${i}`, wt]);
      // ... claim, work, decline -- but NOTHING removes `wt`, which is the bug this row fixes.
    }
    assert.equal(worktreeCount(), baseline + 3,
      "without the removal, three released claims must leave three worktrees behind -- the count IS the "
      + "defect, proven directly rather than asserting the removal ran");

    // THE FIX, same three cycles, WITH removeClaimedWorktree wired in -- the count returns to baseline
    // after every single decline, not just at the end.
    for (let i = 0; i < 3; i += 1) {
      const wt = join(root, `fixed-${i}`);
      git(primary, ["worktree", "add", "-q", "-b", `agent/fixed-${i}`, wt]);
      const before = worktreeCount();
      const result = removeClaimedWorktree(wt, { run });
      assert.equal(result.removed, true);
      assert.equal(worktreeCount(), before - 1,
        `decline ${i} must remove exactly the one worktree it recorded, immediately -- not batched, not `
        + "deferred to a later sweep");
    }
    assert.equal(worktreeCount(), baseline + 3,
      "the fixed cycles must leave the count exactly where the dropped ones left it -- three behind from "
      + "the mutation above, zero added by the three cycles that correctly cleaned up after themselves");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
