/**
 * `scripts/row-claim.mjs` answers "is this row claimed?" by reading the BOARD (issue labels), never git
 * history -- #28 and #30 (2026-09-06) were each pulled twice because the documented collision check
 * (`git log --branches='agent/*' --not origin/main -- <path>`) answers "would I collide in this file",
 * not "is somebody already on this row". See that file's own header for the incident and the reasoning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimStatus, decideClaim, fetchLabels, claimRow, CLAIM_LABEL }
  from "../../../../scripts/row-claim.mjs";

// --- claimStatus: pure, no I/O ---

test("claimStatus reads a claimed row -- in-progress plus a session label", () => {
  const status = claimStatus(["backlog", "epic", "ready", "in-progress", "session:worker-contracts"]);
  assert.equal(status.claimed, true);
  assert.deepEqual(status.sessions, ["worker-contracts"]);
});

test("claimStatus reads an unclaimed row -- no in-progress label at all", () => {
  const status = claimStatus(["backlog", "epic", "ready"]);
  assert.equal(status.claimed, false);
  assert.deepEqual(status.sessions, []);
});

test("claimed with NO session label yet is still claimed, not conflated with unclaimed", () => {
  // Exactly how #55 itself was claimed: the dispatcher set in-progress before assigning a session, on
  // purpose, so nobody could pull it while briefing was in flight.
  const status = claimStatus(["in-progress"]);
  assert.equal(status.claimed, true);
  assert.deepEqual(status.sessions, []);
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
  const removeCall = calls.find((a) => a.includes("--remove-label"));
  assert.ok(removeCall, "must back off by removing its OWN session label");
  assert.ok(removeCall!.includes("session:worker-contracts"));
  assert.ok(!removeCall!.includes(CLAIM_LABEL), "must never remove in-progress -- the other session needs it");
  assert.ok(!removeCall!.includes("session:worker-judge"), "must never remove a label that is not its own");
});

// --- Live, read-only smoke test against the real repo ---

test("fetchLabels against the real #55 succeeds structurally, live", () => {
  // Not asserting a specific claimed state -- issue state can move. The contract under test is narrower:
  // a real gh call against a real, existing issue returns a well-formed result without throwing.
  const result = fetchLabels(55);
  assert.equal(result.number, 55);
  assert.ok(Array.isArray(result.labels));
});
