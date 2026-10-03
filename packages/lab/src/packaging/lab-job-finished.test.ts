// no-token: labJobFinishedOrders -- #2729. Importing `work-gate.mjs` reaches `defaultRun` (`execFileSync("gh", ...)`), and this
// file never lets it run: `decide` and the order builders are pure, and the record reader takes an injected directory.
/**
 * #2729: A LAB JOB THAT ENDS WAKES THE ROW THAT DISPATCHED IT, and nobody polls `lab:status` to find out.
 *
 * THE CHAIN, TESTED AS ONE (the last test): `run-job.yml` renders a record with ANSIBLE ITSELF, `readLabJobRecords`
 * reads that very file, and `labJobFinishedOrders` turns it into an order for the holder. The two ends live in packages
 * that cannot import each other (`control` has no dependencies), so the field names are a contract nothing else pins.
 *
 * THE POSITIVES ARE NOT OPTIONAL: an order builder that returned `[]` for everything satisfies every silence case below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, labJobRecordsOrSay, CAUSES, JUDGMENT_CAUSES, START_CAUSES } from "agent-org/src/work-gate.mjs";
import { JUDGMENT_TTL_MS } from "agent-org/src/wake.mjs";
import { labJobFinishedOrders, readLabJobRecords, recordOf, RECORD_WAKE_WINDOW_MS }
  from "agent-org/src/work-gate/lab-job-orders.mjs";
import { causeDeclarations } from "../../../../.agent-org/plugins/causes.mjs";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const MINUTE = 60_000;
const finishedAgo = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString().replace(/\.\d+Z$/, "Z");

const record = (over: Record<string, unknown> = {}) => ({
  schema: 1, job: "evidence-check", row: 2718, invocation: "a1b2c3", outcome: "success", exit: 0, commit: "5a496eb53abc",
  host: "a11y-lab", finishedAt: finishedAgo(2), ...over,
});
type Row = { number: number; labels: { name: string }[]; repoKey?: string };
const held = (n: number, session: string, extra: Record<string, unknown> = {}): Row => ({
  number: n, labels: [{ name: "in-progress" }, { name: `session:${session}` }], ...extra,
});

test("#2729: a finished job wakes the session HOLDING its row, with the result in the prompt", () => {
  const [order, ...rest] = labJobFinishedOrders([held(2718, "orchestrator")], [record({ outcome: "exit-code", exit: 3 })], NOW);
  assert.equal(rest.length, 0);
  assert.equal(order?.session, "orchestrator", "the row's own `session:` label -- no address book");
  assert.equal(order?.cause, "lab-job-finished");
  assert.match(order?.prompt ?? "", /`evidence-check`/);
  assert.match(order?.prompt ?? "", /exit-code, exit 3/, "the exit status is IN the wake, not something to go and look up");
  assert.match(order?.prompt ?? "", /do not poll `lab:status`/);
  assert.equal(order?.causeKey, "orchestrator/lab-job-finished/row-2718/a1b2c3");
});

test("#2729: no order when there is no one to tell, or nothing to tell", () => {
  const cases: [string, Row[], ReturnType<typeof record>[] | null][] = [
    ["a row nobody holds", [{ number: 2718, labels: [{ name: "ready" }] }], [record()]],
    ["a session label without the claim label", [{ number: 2718, labels: [{ name: "session:x" }] }], [record()]],
    ["a different row", [held(2719, "orchestrator")], [record()]],
    ["a row of another repository with the same number", [held(2718, "orchestrator", { repoKey: "agent-org" })], [record()]],
    ["a refused read (null)", [held(2718, "orchestrator")], null],
    ["no records", [held(2718, "orchestrator")], []],
  ];
  for (const [what, rows, records] of cases) {
    assert.deepEqual(labJobFinishedOrders(rows, records, NOW), [], what);
  }
});

test("#2729: a record is worth a wake for a bounded time, and the bound is shorter than the wake ledger's memory", () => {
  const rows = [held(2718, "orchestrator")];
  assert.equal(labJobFinishedOrders(rows, [record({ finishedAt: finishedAgo(89) })], NOW).length, 1, "inside the window");
  assert.deepEqual(labJobFinishedOrders(rows, [record({ finishedAt: finishedAgo(91) })], NOW), [], "outside it");
  // WHY THE INEQUALITY: past `JUDGMENT_TTL_MS` the ledger forgets a delivery and a judgment cause is offered AGAIN, so a
  // record still live then would nag the holder about a job they were told of two hours ago.
  assert.ok(RECORD_WAKE_WINDOW_MS < JUDGMENT_TTL_MS, "the record must die before the ledger forgets it");
  assert.ok(JUDGMENT_CAUSES.includes("lab-job-finished"), "the TTL only applies to a cause the gate calls a judgment");
});

test("#2729: two jobs ending for one row are ONE order, and a later job is a NEW key", () => {
  const rows = [held(2718, "orchestrator")];
  const both = labJobFinishedOrders(rows, [record({ invocation: "bbb" }), record({ job: "train", invocation: "aaa" })], NOW);
  assert.equal(both.length, 1);
  assert.equal(both[0].causeKey, "orchestrator/lab-job-finished/row-2718/aaa+bbb");
  assert.ok(both[0].prompt.indexOf("`train`") < both[0].prompt.indexOf("`evidence-check`"), "listed in a stable order");
  const later = labJobFinishedOrders(rows, [record({ invocation: "ccc" })], NOW);
  assert.notEqual(later[0].causeKey, both[0].causeKey);
});

test("#2729: `decide` emits it, and a drain does not withhold it", () => {
  // `decide` reads the REAL clock, so this record must be young against it: `finishedAgo` is measured from the pinned
  // `NOW`, and a record 2 minutes old at 12:00Z is past the 90-minute wake window by 13:30Z (#2791 met this red).
  const justNow = new Date(Date.now() - 2 * MINUTE).toISOString().replace(/\.\d+Z$/, "Z");
  const state = { prs: [], readyRows: [], openRows: [held(2718, "worker-2718")], labJobs: [record({ finishedAt: justNow })] };
  const mine = (orders: { cause: string }[]) => orders.filter((o) => o.cause === "lab-job-finished");
  assert.equal(mine(decide(state)).length, 1);
  assert.equal(mine(decide({ ...state, drain: true })).length, 1,
    "a window stops the org TAKING ON work, not telling a holder its job ended");
  assert.equal(mine(decide({ ...state, labJobs: undefined })).length, 0, "omitted is `null`: nothing");
  assert.ok(!START_CAUSES.includes("lab-job-finished"));
});

test("#2729: the cause is declared by a11ign's plugin, and is not tool code", () => {
  const declared = causeDeclarations.find((d: { cause: string }) => d.cause === "lab-job-finished");
  assert.equal(declared?.group, "judgment");
  assert.ok(CAUSES.includes("lab-job-finished"));
});

// --- the reader ------------------------------------------------------------------------------------------

test("#2729: readLabJobRecords — an absent directory is empty, a bad file is skipped AND NAMED, an unreadable dir throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-jobs-"));
  try {
    assert.deepEqual(readLabJobRecords({ dir: join(dir, "does-not-exist") }), [], "nothing was ever dispatched with a row");
    writeFileSync(join(dir, "good.json"), JSON.stringify(record()));
    writeFileSync(join(dir, "torn.json"), '{"schema": 1, "job": ');
    writeFileSync(join(dir, "future.json"), JSON.stringify(record({ schema: 2 })));
    writeFileSync(join(dir, "note.txt"), "ignored: not a record");
    const skipped: string[] = [];
    const read = readLabJobRecords({ dir, skipped: (f) => skipped.push(f) });
    assert.deepEqual(read.map((r) => r.invocation), ["a1b2c3"]);
    assert.deepEqual(skipped.sort(), ["future.json", "torn.json"], "one bad record must not hide the good one, or go unmentioned");
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    assert.throws(() => readLabJobRecords({ dir, list: () => { throw denied; } }), /EACCES/);
    const said: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((line: string) => { said.push(String(line)); return true; }) as typeof process.stderr.write;
    try {
      assert.equal(labJobRecordsOrSay(() => { throw denied; }), null, "could not look is null, never []");
    } finally {
      process.stderr.write = realWrite;
    }
    assert.match(said.join(""), /COULD NOT READ lab job records: EACCES/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#2729: recordOf refuses each malformed field (each one alone, against a valid record)", () => {
  assert.ok(recordOf(record()));
  for (const bad of [{ schema: 2 }, { job: "" }, { row: 0 }, { row: "2718" }, { invocation: "" }, { outcome: 7 },
    { exit: "0" }, { finishedAt: "yesterday" }]) {
    assert.equal(recordOf(record(bad)), null, JSON.stringify(bad));
  }
});

// --- the chain: run-job.yml (rendered by ansible) -> reader -> order --------------------------------------

const RUN_JOB = readFileSync(fileURLToPath(new URL("../../../control/ansible/tasks/run-job.yml", import.meta.url)), "utf8");
const HAS_ANSIBLE = spawnSync("ansible-playbook", ["--version"]).status === 0;
const NO_ANSIBLE = "ansible-playbook is not on PATH -- an honest skip, not a pass. The text pins below still ran.";

/** The task block starting at the `- name:` line beginning `from` and ending before the one beginning `to`. */
function tasksBetween(from: string, to: string): string {
  const start = RUN_JOB.indexOf(`- name: "${from}`);
  const end = RUN_JOB.indexOf(`- name: "${to}`, start);
  assert.ok(start >= 0 && end > start, `run-job.yml no longer has tasks from "${from}" to "${to}" -- this pin is blind, not clean`);
  return RUN_JOB.slice(start, end);
}
const VALIDATE = () => tasksBetween("The row waiting on this job must be", "What is this unit doing");
const WRITE = () => tasksBetween("Make the directory the gate reads", "Did this job write into the source tree");

/** Runs the REAL tasks from run-job.yml, lifted byte for byte, against localhost with HOME pointed at a scratch dir. */
function renderPlaybook(tasks: string, home: string, extras: string[]) {
  const play = ["- hosts: localhost", "  gather_facts: false", "  vars:", "    job_name: evidence-check",
    "    job_invocation: {stdout: \"a1b2c3\\n\"}", "    job_outcome: success", "    job_exit: \"0\"",
    "    lab_commit: {stdout: \"5a496eb53abcdef0123456789abcdef012345678\\n\"}", "  tasks:",
    ...tasks.trimEnd().split("\n").map((line) => (line === "" ? line : `    ${line}`)), ""].join("\n");
  const file = join(home, "play.yml");
  writeFileSync(file, play);
  return spawnSync("ansible-playbook", [file, ...extras], { cwd: home, encoding: "utf8",
    env: { ...process.env, HOME: home, ANSIBLE_LOCALHOST_WARNING: "False", ANSIBLE_INVENTORY_UNPARSED_WARNING: "False" } });
}

test("#2729 (text): the playbook writes exactly the fields the gate reads, and only when a row was named", () => {
  const write = WRITE();
  for (const field of ["schema", "job", "row", "invocation", "outcome", "exit", "commit", "host", "finishedAt"]) {
    assert.match(write, new RegExp(`"${field}":`), `run-job.yml must write "${field}" -- the gate's reader takes it`);
  }
  assert.equal((write.match(/when: row is defined/g) ?? []).length, 2, "both tasks are conditional on a named row");
  assert.match(write, /delegate_to: localhost/, "the gate reads the CONTROL host's disk, not the lab's");
  const releasedAt = RUN_JOB.indexOf('- name: "Release the unit');
  const recordedAt = RUN_JOB.indexOf('- name: "Tell the gate this job ended');
  const assertedAt = RUN_JOB.indexOf('- name: "Fail if it did not succeed');
  assert.ok(releasedAt < recordedAt && recordedAt < assertedAt,
    "after the release (the name is free when the holder wakes) and BEFORE the assert (a failed job is recorded too)");
});

test("#2729 (rendered): the record ansible writes is read back by the gate's own reader and becomes an order",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const home = mkdtempSync(join(tmpdir(), "lab-job-record-"));
    try {
      const run = renderPlaybook(WRITE(), home, ["-e", "row=2718"]);
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      const dir = join(home, ".cache/a11ign/lab-jobs");
      assert.deepEqual(readdirSync(dir), ["evidence-check-a1b2c3.json"], "one file per InvocationID");
      const [read, ...rest] = readLabJobRecords({ dir });
      assert.equal(rest.length, 0);
      assert.deepEqual({ job: read.job, row: read.row, invocation: read.invocation, outcome: read.outcome, exit: read.exit,
        commit: read.commit }, { job: "evidence-check", row: 2718, invocation: "a1b2c3", outcome: "success", exit: 0,
        commit: "5a496eb53abc" });
      const [order] = labJobFinishedOrders([held(2718, "orchestrator")], [read], Date.now());
      assert.equal(order?.session, "orchestrator", "the whole chain: ansible wrote it, the gate read it, the holder is named");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

test("#2729 (rendered): with no `row` nothing is written — the dispatcher who named no row is not polled for",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const home = mkdtempSync(join(tmpdir(), "lab-job-norow-"));
    try {
      const run = renderPlaybook(WRITE(), home, []);
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      assert.throws(() => readdirSync(join(home, ".cache/a11ign/lab-jobs")), /ENOENT/);
      // A task that RAN and failed is `ignore_errors`, so status 0 and an absent file cannot tell "skipped" from "failed quietly".
      assert.doesNotMatch(`${run.stdout}${run.stderr}`, /ignoring/, "both tasks were skipped by `when`, not run and swallowed");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

test("#2729 (rendered): a `row` that is not a row number is refused BEFORE the job would start",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const home = mkdtempSync(join(tmpdir(), "lab-job-badrow-"));
    try {
      mkdirSync(home, { recursive: true });
      for (const bad of ["abc", "0", "27x", "-3", "2718;rm"]) {
        const run = renderPlaybook(VALIDATE(), home, ["-e", `row=${bad}`]);
        assert.notEqual(run.status, 0, `row=${bad} must be refused`);
        assert.match(`${run.stdout}${run.stderr}`, /is not a row number/);
      }
      assert.equal(renderPlaybook(VALIDATE(), home, ["-e", "row=2718"]).status, 0, "POSITIVE CONTROL: a real row number passes");
      assert.equal(renderPlaybook(VALIDATE(), home, []).status, 0, "and no row at all passes");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
