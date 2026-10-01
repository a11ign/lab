// Row #2849 (the split, child 5d-0 of #69): the live gate taps its own `decide` call, for the shadow runner (#2846).
//
// Every claim below runs the real writer against a real temporary directory, and the controls are in this file:
// the marker-absent case is only worth anything beside the marker-present one that writes a file, and the pruner is
// shown removing exactly one of 31. THE ROUND TRIP OF `args` THROUGH `decide` IS IN `shadow-reads-round-trip.test.ts`: it calls
// `decide`, which reaches `work-gate.mjs` and so charges the token-less acceptance job a `token` it would refuse (#827, #2610), and
// this file is the row's Acceptance, so it imports only `shadow-reads.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_TICKS, SHADOW_READS_DIR, SHADOW_WINDOW_MARKER, pruneShadowReads, tapShadowReads }
  from "../../../agent-org/src/shadow-reads.mjs";

const FIRST_TICK = 1_790_000_000_000;
const TWO_MINUTES = 120_000;

/** A fresh state directory, with or without the marker that opens the window. */
function stateDir(open: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "shadow-reads-"));
  if (open) writeFileSync(join(dir, SHADOW_WINDOW_MARKER), "");
  return dir;
}
const recordsIn = (dir: string) => readdirSync(join(dir, SHADOW_READS_DIR)).sort();
const quiet = () => undefined;

/** A tick shaped like the gate's: plain arrays and objects, one open draft PR and one Ready row. */
const FIXTURE_ARGS = () => ({
  primaryDrift: null,
  prs: [{ number: 7, isDraft: true, headRefOid: "abc12345deadbeefcafe000011112222",
    statusCheckRollup: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }],
    author: { login: "worker-judge" }, comments: [{ body: "a comment" }], labels: [{ name: "lane:any" }] }],
  readyRows: [{ number: 9001, title: "a ready row", labels: [] }],
  promotableRows: [], chairmanBlocked: [], prFiles: [], drain: false,
});

test("marker ABSENT: a tap writes nothing and creates no directory -- and the same call with the marker present writes (the control)", () => {
  const closed = stateDir(false);
  const open = stateDir(true);
  try {
    const result = tapShadowReads({ args: FIXTURE_ARGS(), orders: [], tick: FIRST_TICK, stateDir: closed, log: quiet });
    assert.deepEqual(result, { recorded: false });
    assert.deepEqual(readdirSync(closed), [], "nothing at all was created, the directory included");
    // POSITIVE CONTROL: the identical call, marker present, gives a file -- so the emptiness above is not a tap that never writes.
    const written = tapShadowReads({ args: FIXTURE_ARGS(), orders: [], tick: FIRST_TICK, stateDir: open, log: quiet });
    assert.equal(written.recorded, true);
    assert.deepEqual(recordsIn(open), [`${FIRST_TICK}.json`]);
  } finally {
    rmSync(closed, { recursive: true, force: true });
    rmSync(open, { recursive: true, force: true });
  }
});

test("marker present: one call writes one `<tick>.json` carrying `args` and `orders`, and a second writes a second and rewrites neither", () => {
  const dir = stateDir(true);
  try {
    const args = FIXTURE_ARGS();
    const orders = [{ cause: "ready-row-unclaimed", session: "worker-4" }];
    tapShadowReads({ args, orders, tick: FIRST_TICK, stateDir: dir, log: quiet });
    const firstFile = join(dir, SHADOW_READS_DIR, `${FIRST_TICK}.json`);
    const firstBytes = readFileSync(firstFile, "utf8");
    assert.deepEqual(JSON.parse(firstBytes), { tick: FIRST_TICK, args, orders });

    const second = FIRST_TICK + TWO_MINUTES;
    tapShadowReads({ args, orders: [], tick: second, stateDir: dir, log: quiet });
    assert.deepEqual(recordsIn(dir), [`${FIRST_TICK}.json`, `${second}.json`]);
    assert.equal(readFileSync(firstFile, "utf8"), firstBytes, "the first record is byte-identical after the second call");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, SHADOW_READS_DIR, `${second}.json`), "utf8")).orders, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bounded: the thirty-first call leaves 30 files and removes the OLDEST; no `.tmp` name survives", () => {
  const dir = stateDir(true);
  try {
    const ticks = Array.from({ length: KEEP_TICKS + 1 }, (_, i) => FIRST_TICK + i * TWO_MINUTES);
    for (const tick of ticks.slice(0, KEEP_TICKS)) tapShadowReads({ args: {}, orders: [], tick, stateDir: dir, log: quiet });
    assert.equal(recordsIn(dir).length, KEEP_TICKS, "thirty calls keep all thirty -- the bound has not fired early");
    tapShadowReads({ args: {}, orders: [], tick: ticks[KEEP_TICKS], stateDir: dir, log: quiet });
    const names = recordsIn(dir);
    assert.equal(names.length, KEEP_TICKS);
    assert.ok(!names.includes(`${ticks[0]}.json`), "the oldest went");
    assert.ok(names.includes(`${ticks[1]}.json`) && names.includes(`${ticks[KEEP_TICKS]}.json`), "the second-oldest and the newest stayed");
    assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), [], "no temp name survives a successful write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the pruner, given 31 files, removes exactly one -- the oldest, by NUMBER and not by name (positive control)", () => {
  const dir = stateDir(false);
  try {
    // 9 digits then 10: a string sort would put "10..." before "9..." and remove the wrong one.
    const ticks = [999_999_999, ...Array.from({ length: KEEP_TICKS }, (_, i) => 1_000_000_000 + i)];
    for (const tick of ticks) writeFileSync(join(dir, `${tick}.json`), "{}");
    const { removed, diagnostics } = pruneShadowReads(dir);
    assert.deepEqual(removed, ["999999999.json"]);
    assert.deepEqual(diagnostics, []);
    assert.equal(readdirSync(dir).length, KEEP_TICKS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the pruner sweeps temp debris an interrupted write left, and leaves files that are not ticks alone", () => {
  const dir = stateDir(false);
  try {
    writeFileSync(join(dir, ".123.json.tmp"), "half");
    writeFileSync(join(dir, "README"), "not ours");
    writeFileSync(join(dir, "456.json"), "{}");
    const { removed } = pruneShadowReads(dir);
    assert.deepEqual(removed, [".123.json.tmp"]);
    assert.deepEqual(readdirSync(dir).sort(), ["456.json", "README"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a write that cannot happen returns a diagnostic naming the cause, writes it to the log, and does not throw", () => {
  const dir = stateDir(true);
  try {
    // The records directory is a FILE, so `mkdir` fails whoever runs this -- unlike a chmod, which root ignores.
    writeFileSync(join(dir, SHADOW_READS_DIR), "in the way");
    const lines: string[] = [];
    const result = tapShadowReads({ args: FIXTURE_ARGS(), orders: [], tick: FIRST_TICK, stateDir: dir, log: (line) => lines.push(line) });
    assert.equal(result.recorded, false);
    assert.match(result.diagnostic ?? "", /could not record tick 1790000000000/);
    assert.match(result.diagnostic ?? "", /EEXIST|ENOTDIR/, "it names the cause, not just the failure");
    assert.equal(lines.length, 1, "and it said so once on the log");
    assert.match(lines[0], /^shadow-reads: .*EEXIST|ENOTDIR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an `args` that cannot be serialised is a diagnostic too, not a thrown error out of the tick", () => {
  const dir = stateDir(true);
  try {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = tapShadowReads({ args: circular, orders: [], tick: FIRST_TICK, stateDir: dir, log: quiet });
    assert.equal(result.recorded, false);
    assert.match(result.diagnostic ?? "", /circular/i);
    assert.equal(existsSync(join(dir, SHADOW_READS_DIR, `${FIRST_TICK}.json`)), false, "and no record was left behind");
    assert.deepEqual(readdirSync(join(dir, SHADOW_READS_DIR)).filter((name) => name.endsWith(".json")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unwritable state directory is a diagnostic as well (skipped honestly when the process may write anyway)", (t) => {
  const dir = stateDir(true);
  try {
    mkdirSync(join(dir, SHADOW_READS_DIR));
    chmodSync(join(dir, SHADOW_READS_DIR), 0o500);
    // root ignores the mode bits, and a test that passes for that reason proves nothing -- so say it is skipped.
    if (process.getuid?.() === 0) return t.skip("running as root: mode bits do not bind, the file-in-the-way test above covers the failure");
    const result = tapShadowReads({ args: {}, orders: [], tick: FIRST_TICK, stateDir: dir, log: quiet });
    assert.equal(result.recorded, false);
    assert.match(result.diagnostic ?? "", /EACCES/);
  } finally {
    chmodSync(join(dir, SHADOW_READS_DIR), 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});
