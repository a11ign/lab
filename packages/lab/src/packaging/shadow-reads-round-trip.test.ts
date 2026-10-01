// Row #2849, constraint 4: the tapped `args` must survive a JSON round trip, so a `Map` or a `Date` added to `decide`'s arguments
// later fails HERE and not in a 48-hour shadow window. Its own file because it CALLS `decide` (see `shadow-reads.test.ts`'s header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../../../agent-org/src/work-gate.mjs";

const FIRST_TICK = 1_790_000_000_000;

/** A tick shaped like the gate's: plain arrays and objects, one open draft PR and one Ready row. */
const FIXTURE_ARGS = () => ({
  primaryDrift: null,
  prs: [{ number: 7, isDraft: true, headRefOid: "abc12345deadbeefcafe000011112222",
    statusCheckRollup: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }],
    author: { login: "worker-judge" }, comments: [{ body: "a comment" }], labels: [{ name: "lane:any" }] }],
  readyRows: [{ number: 9001, title: "a ready row", labels: [] }],
  promotableRows: [], chairmanBlocked: [], prFiles: [], drain: false,
});

// CONSTRAINT 4. `decide` is handed plain arrays and objects today, and also reads `Date.now()` itself, so the clock is pinned for
// the two calls: what is compared is the arguments' survival of JSON, not the time between two reads.
const survives = (args: unknown) => {
  const now = Date.now;
  Date.now = () => FIRST_TICK;
  try {
    const clone = JSON.parse(JSON.stringify(args));
    assert.deepEqual(clone, args, "the structure survives the round trip");
    assert.deepEqual(decide(clone as Parameters<typeof decide>[0]), decide(args as Parameters<typeof decide>[0]), "and so does what `decide` says about it");
  } finally {
    Date.now = now;
  }
};

test("the JSON round trip of `args` leaves `decide`'s answer unchanged on a fixture tick -- and that check can fail (positive control)", () => {
  const args = FIXTURE_ARGS();
  const before = JSON.stringify(args);
  survives(args);
  assert.equal(JSON.stringify(args), before, "and `decide` did not mutate its arguments, which the tap records AFTER the call");
  assert.ok(decide(args as Parameters<typeof decide>[0]).length > 0, "the fixture makes `decide` say something, so equal-and-empty is not the whole test");

  // A `Map` in the arguments serialises to `{}`, which is what a later change would do to a window nobody is watching.
  const withMap = { ...FIXTURE_ARGS(), prFiles: new Map([[7, ["a.ts"]]]) as unknown as never[] };
  assert.throws(() => survives(withMap), "a Map in `args` FAILS the round-trip check");
  const withDate = { ...FIXTURE_ARGS(), when: new Date(FIRST_TICK) };
  assert.throws(() => survives(withDate), "and so does a Date");
});
