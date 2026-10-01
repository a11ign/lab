/**
 * `shadow-window.mjs` is the runner for ADR 0040 decision 5 (1) (row #2846, child 5d of #69): ONE tick of the
 * CANDIDATE gate over a COPY of the state, diffed against the orders the live tick RECORDED, appended to a diff
 * record. The live tick's recording is #2849's (`<stateDir>/shadow-reads/<tickUtcMs>.json` = `{ tick, args, orders }`);
 * these fixtures write that exact format into a real temp directory, and the candidate is a real module run as a real
 * child process, so "exits non-zero" and "reads the copy" are observed and not stubbed.
 *
 * POSITIVE CONTROLS, so no emptiness assertion here can pass on an empty population: the dropping candidate is
 * recorded as a difference naming the dropped cause key, the identical candidate records an EMPTY difference over a
 * non-empty order list, and the symlink-to-live case is refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shadowTick, gapBetween, COPY_MARKER, READS_DIR } from "../../../agent-org/src/shadow-window.mjs";

const RUNNER = fileURLToPath(new URL("../../../agent-org/src/shadow-window.mjs", import.meta.url));

/** The order `decide` makes for a row in these fixtures; the candidate fixtures below make the same one. */
const orderFor = (row: string) => ({ causeKey: `row:${row}`, cause: "ready-row", session: "s", subject: row, discriminator: "d", prompt: "p" });
const DECIDE = "(args) => args.rows.map((r) => ({ causeKey: `row:${r}`, cause: 'ready-row', session: 's', subject: r, discriminator: 'd', prompt: 'p' }))";

const CANDIDATES = {
  identical: `export const decide = ${DECIDE};`,
  dropsFirst: `export const decide = (args) => (${DECIDE})(args).slice(1);`,
  exitsThree: "export function decide() { process.exit(3); }",
  throws: "export function decide() { throw new Error('candidate blew up'); }",
  notOrders: "export function decide() { return { not: 'an array' }; }",
  // Reads the COPY through the env var the runner hands every candidate, one order per ledger line.
  readsCopyLedger: `import { readFileSync } from "node:fs";
export function decide() {
  const dir = process.env.A11IGN_SHADOW_STATE_DIR;
  return readFileSync(dir + "/wake-ledger", "utf8").split("\\n").filter(Boolean)
    .map((l) => ({ causeKey: "ledger:" + l, cause: "ledger", session: "s", subject: l, discriminator: "d", prompt: "p" }));
}`,
};

type Rig = { root: string; live: string; copy: string; record: string; candidate: (name: keyof typeof CANDIDATES) => string };

/** A live state directory shaped like the real one (files, a subdirectory), a copy path, a record path, and candidate modules. */
function rig(): Rig {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-shadow-window-")));
  const live = join(root, "live");
  mkdirSync(join(live, READS_DIR), { recursive: true });
  mkdirSync(join(live, "reviewer-absences"));
  writeFileSync(join(live, "wake-ledger"), "line-1\n");
  writeFileSync(join(live, "claim-stalls.json"), "{}\n");
  writeFileSync(join(live, "reviewer-absences", "reviewer-7"), "absent\n");
  const candidate = (name: keyof typeof CANDIDATES) => {
    const path = join(root, `${name}.mjs`);
    writeFileSync(path, CANDIDATES[name]);
    return path;
  };
  return { root, live, copy: join(root, "copy"), record: join(root, "out", "diff.jsonl"), candidate };
}

/** Write one tick the way #2849's live tick leaves it. */
function writeTick(live: string, tickMs: number, tick: number, rows: string[]) {
  writeFileSync(join(live, READS_DIR, `${tickMs}.json`), JSON.stringify({ tick, args: { rows }, orders: rows.map(orderFor) }));
}

/** Every file under `dir`, by relative path, with its bytes -- recursive, because the live directory has subdirectories. */
function tree(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, tree(full, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = readFileSync(full, "utf8");
  }
  return out;
}

const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const T1 = Date.UTC(2026, 9, 1, 8, 0, 0);
const MINUTE = 60_000;

function withRig(body: (r: Rig) => void) {
  const r = rig();
  try { body(r); } finally { rmSync(r.root, { recursive: true, force: true }); }
}

test("one invocation appends exactly one record carrying the tick, both gates' orders and the difference", () => {
  withRig((r) => {
    writeTick(r.live, T1, 41, ["a", "b"]);
    const result = shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") });
    assert.equal(result.status, "RECORDED");
    const [record, ...rest] = lines(r.record);
    assert.equal(rest.length, 0, "exactly one record");
    assert.equal(record.tick, 41);
    assert.equal(record.utc, new Date(T1).toISOString());
    assert.deepEqual(record.live, ["a", "b"].map(orderFor));
    assert.deepEqual(record.candidate, ["a", "b"].map(orderFor));
    assert.equal(record.candidateExit, 0);
    assert.deepEqual(record.differences, []);
    assert.deepEqual(record.causes, { live: ["ready-row"], candidate: ["ready-row"] });
  });
});

test("POSITIVE CONTROL: a candidate identical to the live gate records an EMPTY difference over a non-empty order list", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a", "b", "c"]);
    shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") });
    const [record] = lines(r.record);
    assert.ok(record.live.length >= 1 && record.candidate.length === record.live.length, "the empty diff is over real orders");
    assert.deepEqual(record.differences, []);
  });
});

test("POSITIVE CONTROL: a candidate that drops one order is recorded as a difference naming that order's cause key", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a", "b", "c"]);
    shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("dropsFirst") });
    const [record] = lines(r.record);
    assert.equal(record.differences.length, 1);
    assert.equal(record.differences[0].causeKey, "row:a");
    assert.deepEqual(record.differences[0].live, orderFor("a"));
    assert.equal(record.differences[0].candidate, null);
  });
});

test("two invocations append two records and rewrite neither; a third with nothing new is QUIET and appends nothing", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    writeTick(r.live, T1 + 2 * MINUTE, 2, ["a", "b"]);
    const run = () => shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") });
    run();
    const afterOne = readFileSync(r.record, "utf8");
    run();
    const afterTwo = readFileSync(r.record, "utf8");
    assert.ok(afterTwo.startsWith(afterOne), "the first record is byte-identical after the second invocation");
    assert.deepEqual(lines(r.record).map((l) => l.tick), [1, 2]);
    assert.equal(run().status, "QUIET");
    assert.equal(readFileSync(r.record, "utf8"), afterTwo, "a quiet invocation appends nothing");
  });
});

test("the OLDEST unrecorded tick is taken, not the newest, and a gap in the numbering is recorded rather than hidden", () => {
  withRig((r) => {
    writeTick(r.live, T1 + 4 * MINUTE, 5, ["e"]);
    writeTick(r.live, T1, 1, ["a"]);
    writeTick(r.live, T1 + 2 * MINUTE, 2, ["b"]);
    const run = () => shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") });
    run(); run(); run();
    const recorded = lines(r.record);
    assert.deepEqual(recorded.map((l) => l.tick), [1, 2, 5]);
    assert.equal(recorded[1].gapBefore, null);
    assert.deepEqual(recorded[2].gapBefore, { missing: 2, firstMissing: 3 });
    assert.equal(gapBetween(null, 7), null, "the first record has nothing before it to be a gap from");
    assert.equal(gapBetween(4, "x"), null, "a tick number that is not an integer claims no gap");
  });
});

test("the live directory's bytes are identical before and after a run", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a", "b"]);
    const before = tree(r.live);
    assert.ok(Object.keys(before).length >= 4, "the snapshot holds real entries, subdirectory included");
    shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") });
    assert.deepEqual(tree(r.live), before);
  });
});

test("the copy is refreshed at the start of each invocation: a line the live ledger gained between two runs is seen by the second", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    writeTick(r.live, T1 + 2 * MINUTE, 2, ["a"]);
    const run = () => shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("readsCopyLedger") });
    run();
    appendFileSync(join(r.live, "wake-ledger"), "line-2\n");
    run();
    const [first, second] = lines(r.record);
    assert.deepEqual(first.candidate.map((o: { subject: string }) => o.subject), ["line-1"]);
    assert.deepEqual(second.candidate.map((o: { subject: string }) => o.subject), ["line-1", "line-2"]);
    assert.ok(readFileSync(join(r.copy, COPY_MARKER), "utf8").length > 0, "the copy carries the marker that says the runner made it");
  });
});

for (const [name, exit] of [["exitsThree", 3], ["throws", 1]] as const) {
  test(`a candidate that fails (${name}) is recorded as a difference naming the exit, not swallowed and not a crash`, () => {
    withRig((r) => {
      writeTick(r.live, T1, 1, ["a"]);
      const result = shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate(name) });
      assert.equal(result.status, "RECORDED");
      const [record] = lines(r.record);
      assert.equal(record.candidateExit, exit);
      assert.equal(record.candidate, null);
      assert.equal(record.differences.length, 1);
      assert.equal(record.differences[0].causeKey, `candidate-exit:${exit}`);
      assert.ok(name !== "throws" || record.differences[0].error.includes("candidate blew up"), "the failure's own words are kept");
    });
  });
}

test("a candidate that exits 0 with something that is not a list of orders is a difference too", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("notOrders") });
    const [record] = lines(r.record);
    assert.equal(record.differences[0].causeKey, "candidate-exit:0");
    assert.match(record.differences[0].error, /not a JSON array/);
  });
});

test("POSITIVE CONTROL: the live directory, and a symlink to it, are REFUSED as the copy before any read or write", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    const before = tree(r.live);
    const link = join(r.root, "link-to-live");
    symlinkSync(r.live, link);
    for (const copyDir of [r.live, link]) {
      assert.throws(() => shadowTick({ liveDir: r.live, copyDir, recordPath: r.record, candidate: r.candidate("identical") }), /REFUSING/);
    }
    assert.deepEqual(tree(r.live), before, "refusing touched nothing in the live directory");
    assert.throws(() => readFileSync(r.record), /ENOENT/, "no record was written");
  });
});

test("a copy or a record path INSIDE the live directory is refused, because either would be a write there", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    const before = tree(r.live);
    assert.throws(() => shadowTick({ liveDir: r.live, copyDir: join(r.live, "copy"), recordPath: r.record, candidate: r.candidate("identical") }), /inside the live/);
    assert.throws(() => shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: join(r.live, "diff.jsonl"), candidate: r.candidate("identical") }), /inside the live/);
    assert.deepEqual(tree(r.live), before);
  });
});

test("a non-empty directory the runner did not make is never emptied", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    mkdirSync(r.copy);
    writeFileSync(join(r.copy, "somebody-elses.txt"), "keep me\n");
    assert.throws(() => shadowTick({ liveDir: r.live, copyDir: r.copy, recordPath: r.record, candidate: r.candidate("identical") }), /was not made by this runner/);
    assert.equal(readFileSync(join(r.copy, "somebody-elses.txt"), "utf8"), "keep me\n");
  });
});

test("the command line records a tick, says QUIET when there is none, and exits 2 on a refusal", () => {
  withRig((r) => {
    writeTick(r.live, T1, 1, ["a"]);
    const argv = (copy: string) => [RUNNER, `--live-dir=${r.live}`, `--copy-dir=${copy}`, `--record=${r.record}`, `--candidate=${r.candidate("identical")}`];
    const first = spawnSync(process.execPath, argv(r.copy), { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^RECORDED tick 1 .*: 0 difference\(s\)/);
    assert.match(spawnSync(process.execPath, argv(r.copy), { encoding: "utf8" }).stdout, /^QUIET/);
    const refused = spawnSync(process.execPath, argv(r.live), { encoding: "utf8" });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /REFUSING/);
  });
});
