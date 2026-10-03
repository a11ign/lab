// no-token: gh -- importing `work-gate.mjs` reaches `defaultRun` (`execFileSync("gh", ...)`), and this file never lets it run: `orgHealthNow` is handed the clock, the last merge, the ledger reader and the log, and `readFleetCaptures` is given a fake `read`.
/**
 * #2980 (found by #2937): THE GATE PASSES THE FLEET FACTS, so the idle-fleet signal fires live.
 *
 * `fleetIdleReading` existed and was tested, and `orgHealthNow` passed it nothing. `orgHealthReadings` reads an OMITTED `fleet` as "this
 * caller does not ask", which is silent on purpose, so the signal was dead and nothing logged a fault. The tests here run `orgHealthNow` itself,
 * which is the only place the omission could be caught.
 *
 * THE POSITIVE CONTROL is the chairman's idle fleet, replayed: a ledger whose last capture was 4.9 days ago and one open `fleet-gated` row. Every
 * "offers nothing" below is only worth something because that one offers an order, and the first test says what it offers.
 *
 * THE LEDGER IS A CONTRACT BETWEEN TWO FILES. The gate cannot import `packages/control` (`agent-org-outward-edges.test.ts`), so it reads
 * `runs/fleet-captures-state.json` with its own reader; the last test builds the ledger with control's REAL writer path (`advanceCaptures`) and asks
 * both readers, so a field renamed on either side is red here.
 *
 * MUTATION, run by hand and recorded on the row: pass `fleet: undefined` from `orgHealthNow` and the first test goes red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceCaptures, captureTimes } from "../../../control/src/fleet-watch.mjs";
import { orgHealthNow, readFleetCaptures, fleetWaitingFacts, stalledPrFacts, stallReasonOf } from "agent-org/src/work-gate.mjs";
import { prNotProgressingReading } from "agent-org/src/org-health.mjs";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const LAST_CAPTURE = NOW - 118 * HOUR_MS;

type Ledger = { since: number; workers: Record<string, { captures: number; seenAt: number; lastRoseAt: number | null; rises: { at: number; by: number }[] }> };

/** A ledger watched for five days in which the fleet last captured 4.9 days ago. */
const IDLE_LEDGER: Ledger = {
  since: NOW - 5 * DAY_MS,
  workers: { w2: { captures: 40, seenAt: NOW, lastRoseAt: LAST_CAPTURE, rises: [] } },
};

const readerOf = (ledger: unknown) => (() => JSON.stringify(ledger)) as never;
const gatedRow = (number: number, extra: Record<string, unknown> = {}) =>
  ({ number, title: `row ${number}`, labels: [{ name: "fleet-gated" }], body: "", blockedBy: { nodes: [] }, ...extra });

const decideArgs = { prs: [], required: [], readyRows: [], prFiles: new Map(), rowBranches: [], openRows: [], primaryDrift: null, claimRefusals: [] };

/** One org-health tick as `main` runs it, over a ledger, with the other readings kept clear (a merge an hour ago, nothing to claim). */
function tickOver(ledger: unknown, openRowsRead: unknown[] | null, over: { readCaptures?: (now: number) => unknown } = {}) {
  const said: string[] = [];
  const orders = orgHealthNow(
    { prsRead: [], readyRead: [], openRowsRead, decideArgs, decided: [] } as never,
    {
      now: NOW, lastMergedAt: () => NOW - HOUR_MS, log: (line: string) => said.push(line), readCopies: () => [] as never,
      readCaptures: (over.readCaptures ?? ((at: number) => readFleetCaptures({ now: at, read: readerOf(ledger) }))) as never,
    },
  );
  return { orders, said };
}

// --- the gate tick ---------------------------------------------------------------------------------------------------------

test("a fleet that captured nothing for 4.9 days with ONE fleet-gated row waiting offers org-health / fleet-idle-while-work-waits to ceo", () => {
  const { orders } = tickOver(IDLE_LEDGER, [gatedRow(2870)]);
  assert.equal(orders.length, 1, "exactly the fleet signal: every other reading is clear");
  assert.equal(orders[0].session, "ceo");
  assert.equal(orders[0].cause, "org-health");
  assert.equal(orders[0].subject, "fleet-idle-while-work-waits");
  assert.match(orders[0].prompt, /#2870/, "what waits");
  assert.match(orders[0].prompt, /0 captures in the last 24 h/);
});

test("the same idle fleet with NOTHING waiting offers nothing -- an idle fleet nobody needs is healthy", () => {
  assert.deepEqual(tickOver(IDLE_LEDGER, []).orders, []);
});

test("a fleet-gated row something else stops does not count as waiting: it is `fleetBatchRows`' selection, not the label's", () => {
  const held = gatedRow(2871, { body: "Not-before: 2099-01-01\n" });
  assert.deepEqual(tickOver(IDLE_LEDGER, [held]).orders, []);
  assert.deepEqual(fleetWaitingFacts([held, gatedRow(2870), { number: 5, labels: [{ name: "ready" }], body: "" }]), { rows: [2870], labJobs: [] });
});

test("a REFUSED fleet read says UNKNOWN on stderr and offers nothing, even with a row waiting", () => {
  const { orders, said } = tickOver(null, [gatedRow(2870)], { readCaptures: () => null });
  assert.deepEqual(orders, []);
  assert.ok(said.some((line) => /fleet-idle-while-work-waits UNKNOWN -- the fleet's captures could not be read/.test(line)), said.join(""));
});

test("a REFUSED open-rows read is unknown too, and `fleetWaitingFacts(null)` is null -- never an empty list", () => {
  const { orders, said } = tickOver(IDLE_LEDGER, null);
  assert.deepEqual(orders, []);
  assert.ok(said.some((line) => /fleet-idle-while-work-waits UNKNOWN -- .*what waits for it was not read/.test(line)), said.join(""));
  assert.equal(fleetWaitingFacts(null), null);
  assert.deepEqual(fleetWaitingFacts([]), { rows: [], labJobs: [] });
});

test("a fleet that captured an hour ago is clear however much waits", () => {
  const busy: Ledger = { since: NOW - 5 * DAY_MS, workers: { w2: { captures: 50, seenAt: NOW, lastRoseAt: NOW - HOUR_MS, rises: [{ at: NOW - HOUR_MS, by: 3 }] } } };
  assert.deepEqual(tickOver(busy, [gatedRow(2870), gatedRow(2871)]).orders, []);
});

// --- the ledger reader ---------------------------------------------------------------------------------------------------

test("readFleetCaptures: counts rises inside 24 h, takes the latest rise across workers, and ignores a rise 24 h old", () => {
  const ledger: Ledger = { since: NOW - 5 * DAY_MS, workers: {
    w2: { captures: 9, seenAt: NOW, lastRoseAt: NOW - 2 * HOUR_MS, rises: [{ at: NOW - 2 * HOUR_MS, by: 4 }, { at: NOW - DAY_MS, by: 99 }] },
    w3: { captures: 3, seenAt: NOW, lastRoseAt: NOW - 5 * HOUR_MS, rises: [{ at: NOW - 5 * HOUR_MS, by: 3 }] },
  } };
  assert.deepEqual(readFleetCaptures({ now: NOW, read: readerOf(ledger) }), { captures24h: 7, lastCaptureAt: NOW - 2 * HOUR_MS });
});

test("readFleetCaptures: a missing file, garbage, and ONE malformed worker are each null -- never zero", () => {
  assert.equal(readFleetCaptures({ now: NOW, read: (() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }) as never }), null);
  assert.equal(readFleetCaptures({ now: NOW, read: (() => "garbage") as never }), null);
  const oneBad = { ...IDLE_LEDGER, workers: { ...IDLE_LEDGER.workers, w3: { captures: "many", rises: [] } } };
  assert.equal(readFleetCaptures({ now: NOW, read: readerOf(oneBad) }), null);
});

test("a ledger YOUNGER than the window with no capture gives NO READING: silent, not an UNKNOWN every tick for a day -- and one that holds a capture is believed", () => {
  const young = { since: NOW - HOUR_MS, workers: { w2: { captures: 40, seenAt: NOW, lastRoseAt: null, rises: [] } } };
  assert.equal(readFleetCaptures({ now: NOW, read: readerOf(young) }), undefined, "not null: null is the stated unknown");
  const quiet = tickOver(young, [gatedRow(2870)]);
  assert.deepEqual(quiet.orders, []);
  assert.ok(!quiet.said.some((line) => /fleet-idle-while-work-waits/.test(line)), `no fleet line at all: ${quiet.said.join("")}`);
  const youngButBusy = { since: NOW - HOUR_MS, workers: { w2: { captures: 44, seenAt: NOW, lastRoseAt: NOW - 600_000, rises: [{ at: NOW - 600_000, by: 4 }] } } };
  assert.deepEqual(readFleetCaptures({ now: NOW, read: readerOf(youngButBusy) }), { captures24h: 4, lastCaptureAt: NOW - 600_000 });
  assert.equal(readFleetCaptures({ now: NOW, read: readerOf({ ...young, since: NOW - DAY_MS }) })?.captures24h, 0, "at exactly 24 h the ledger has watched a whole window");
});

test("the gate's reader and control's `captureTimes` agree on a ledger built by control's own `advanceCaptures`", () => {
  const rows = (w2: number, w3: number) => [{ name: "w2", state: "ready", captures: w2 }, { name: "w3", state: "ready", captures: w3 }];
  let state = null as ReturnType<typeof advanceCaptures> | null;
  for (const [at, counts] of [[NOW - 3 * DAY_MS, [10, 5]], [NOW - 6 * HOUR_MS, [14, 5]], [NOW - 2 * HOUR_MS, [14, 9]], [NOW - HOUR_MS, [2, 9]]] as const) {
    state = advanceCaptures(rows(counts[0], counts[1]) as never, state, at);
  }
  const control = captureTimes(state, NOW);
  assert.ok(control && control.captures24h > 0, "the control is a ledger that actually holds captures");
  assert.deepEqual(readFleetCaptures({ now: NOW, read: readerOf(state) }), { captures24h: control.captures24h, lastCaptureAt: control.lastCaptureAt });
});

/**
 * THE REVIEW'S FINDING ON #3000: a refused head-commit read must not be turned into a stale age. A conflicted draft CREATED nine hours ago and
 * PUSHED ten minutes ago has a listed floor (its creation) nine hours old; if the read of its head commit is refused, `stalledPrFacts` once
 * returned that floor, and `pr-not-progressing` tripped on a 403.
 */
test("a refused head-commit read is `lastActivityAt: null` (UNKNOWN), never the listed creation time as an age -- and the same PR, read, is not stale", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const pr = { number: 2950, isDraft: true, mergeStateStatus: "DIRTY", mergeable: "CONFLICTING", statusCheckRollup: [], headRefOid: hash,
    headRefName: "agent/some-row", labels: [{ name: "session:worker-2936" }], createdAt: new Date(NOW - 9 * HOUR_MS).toISOString(), comments: [], reviews: [] };
  assert.equal(stallReasonOf(pr, ["gate"]), "conflicted", "the control: this PR is one the tick asks about");
  const pushedTenMinutesAgo = stalledPrFacts([pr], ["gate"], { now: NOW, run: () => `${new Date(NOW - 600_000).toISOString()}\n` });
  assert.equal(pushedTenMinutesAgo[0].lastActivityAt, NOW - 600_000, "read: the push is the newest activity");
  assert.equal(prNotProgressingReading({ now: NOW, stalledPrs: pushedTenMinutesAgo }).status, "clear");
  const refused = stalledPrFacts([pr], ["gate"], { now: NOW, run: () => { throw new Error("HTTP 403"); } });
  assert.equal(refused[0].lastActivityAt, null, "refused: no age, not nine hours");
  assert.equal(prNotProgressingReading({ now: NOW, stalledPrs: refused }).status, "unknown");
});
