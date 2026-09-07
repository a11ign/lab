/**
 * `scripts/row-claim.mjs` answers "is this row claimed?" by reading the BOARD (issue labels), never git
 * history -- #28 and #30 (2026-09-06) were each pulled twice because the documented collision check
 * (`git log --branches='agent/*' --not origin/main -- <path>`) answers "would I collide in this file",
 * not "is somebody already on this row". See that file's own header for the incident and the reasoning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimStatus, decideClaim, fetchLabels, claimRow, dispatchRow, declineRow, CLAIM_LABEL, STARTED_LABEL,
  recordCheck, recordConflict, latestCheckFor,
} from "../../../../scripts/row-claim.mjs";
import { READY_LABEL } from "../../../../scripts/ready-label-audit.mjs";

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
  const result = claimRow(55, "worker-contracts", { run });
  assert.deepEqual(result, { claimed: true });
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
  const result = claimRow(55, "worker-contracts", { run });
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
  const result = claimRow(55, "worker-contracts", { run });
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
  const result = dispatchRow(176, "worker-contracts", { run });
  assert.deepEqual(result, { claimed: true });
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
  const result = dispatchRow(176, "worker-contracts", { run });
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
  const result = claimRow(176, "worker-contracts", { run });
  assert.deepEqual(result, { claimed: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(STARTED_LABEL), "claim/start must mark started");
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
  dispatchRow(176, "worker-contracts", { run });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall, "must have written the dispatch");
  const removeIndex = editCall!.indexOf("--remove-label");
  assert.ok(removeIndex !== -1 && editCall![removeIndex + 1] === READY_LABEL,
    `dispatching must remove \`ready\` in the same call, so a row is never both pickable and taken -- `
    + `got: ${JSON.stringify(editCall)}`);
});

// --- declineRow: give a row back, #176's second acceptance case ---

test("declineRow returns a dispatched-but-not-started row to genuinely unclaimed", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return JSON.stringify({ number: 176, title: "A row",
        labels: [{ name: CLAIM_LABEL }, { name: "session:worker-contracts" }] });
    }
    return "";
  };
  const result = declineRow(176, "worker-contracts", { run });
  assert.deepEqual(result, { declined: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(CLAIM_LABEL) && editCall!.includes("session:worker-contracts"));
  assert.ok(!editCall!.includes("--add-label"), "decline must only ever remove labels, never add");
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
  const result = declineRow(176, "worker-contracts", { run });
  assert.deepEqual(result, { declined: true });
  const editCall = calls.find((a) => a[1] === "edit");
  assert.ok(editCall!.includes(STARTED_LABEL));
});

test("declineRow refuses to release a row held by someone else", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify({ number: 176, title: "A row",
      labels: [{ name: CLAIM_LABEL }, { name: "session:worker-judge" }] });
  };
  const result = declineRow(176, "worker-contracts", { run });
  assert.equal(result.declined, false);
  assert.match((result as { reason: string }).reason, /worker-judge/);
  assert.ok(!calls.some((a) => a[1] === "edit"), "must not write anything when refusing");
});

test("declineRow says so, rather than silently no-op'ing, when the row was never claimed", () => {
  const run = () => JSON.stringify({ number: 176, title: "A row",
    labels: [{ name: "backlog" }, { name: "ready" }] });
  const result = declineRow(176, "worker-contracts", { run });
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

// --- Live, read-only smoke test against the real repo ---

test("fetchLabels against the real #55 succeeds structurally, live", () => {
  // Not asserting a specific claimed state -- issue state can move. The contract under test is narrower:
  // a real gh call against a real, existing issue returns a well-formed result without throwing.
  const result = fetchLabels(55);
  assert.equal(result.number, 55);
  assert.ok(Array.isArray(result.labels));
});
