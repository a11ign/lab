/**
 * The per-publisher rate limit that makes the real-page fleet safe to scale.
 *
 * `capture-real-pages` used a fixed sleep between captures. That is a property of one PROCESS: run four
 * workers and every publisher sees four times the rate, so the politeness guarantee weakened exactly as the
 * fleet grew — the opposite of what you want from a scaling change. Keyed on the host instead, the rate a
 * site sees is constant at any fleet size.
 *
 * The test that matters is the concurrent one. A throttle that only computes a wait from what it READ is
 * correct with one caller and useless with several: two callers reading the same `nextAllowed` both decide
 * they may go now, which is precisely the burst it exists to prevent, under precisely the condition it was
 * added for. Reserving the slot before yielding is what makes it a queue.
 *
 * Time is injected. A throttle proved by a test that actually waits two seconds is a test nobody runs twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createHostThrottle, hostOf } from "./host-throttle.mjs";

/**
 * A clock that moves ONLY when a test says so.
 *
 * `sleep` deliberately does not advance it. The first version of this did, and it quietly broke the one
 * test that mattered: four callers issued in the same tick each saw the clock jump before the next was
 * issued, so "four workers arriving at the same instant" was really four arriving two seconds apart, and
 * the concurrent case went untested while appearing to fail. A fake clock that advances inside `sleep`
 * cannot express simultaneity, which is the only thing this module is about.
 */
function fakeClock() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { waits.push(ms); },
    advance: (ms: number) => { t += ms; },
    waits,
  };
}

test("the first request to a host never waits", async () => {
  const clock = fakeClock();
  const waitTurn = createHostThrottle({ minGapMs: 2000, now: clock.now, sleep: clock.sleep });
  assert.equal(await waitTurn("www.w3.org"), 0);
  assert.deepEqual(clock.waits, []);
});

test("a second request to the SAME host waits the gap", async () => {
  const clock = fakeClock();
  const waitTurn = createHostThrottle({ minGapMs: 2000, now: clock.now, sleep: clock.sleep });
  await waitTurn("www.w3.org");
  assert.equal(await waitTurn("www.w3.org"), 2000);
});

test("a different host is not made to wait behind an unrelated one", async () => {
  // 41 publishers, most with one page. Throttling them against each other would serialise the whole run
  // for no benefit to anybody — the load a site feels is its own, not the fleet's total.
  const clock = fakeClock();
  const waitTurn = createHostThrottle({ minGapMs: 2000, now: clock.now, sleep: clock.sleep });
  await waitTurn("www.w3.org");
  assert.equal(await waitTurn("www.gov.uk"), 0);
  assert.equal(await waitTurn("tfl.gov.uk"), 0);
});

test("CONCURRENT callers on one host queue, they do not all go at once", async () => {
  // The case the whole module exists for, and the one a read-then-wait implementation fails: four workers
  // drawing four w3.org pages at the same instant. Reserved-before-await makes them 0, 1x, 2x, 3x.
  const clock = fakeClock();
  const waitTurn = createHostThrottle({ minGapMs: 2000, now: clock.now, sleep: clock.sleep });
  const granted = await Promise.all([
    waitTurn("www.w3.org"), waitTurn("www.w3.org"), waitTurn("www.w3.org"), waitTurn("www.w3.org"),
  ]);
  assert.deepEqual(granted, [0, 2000, 4000, 6000],
    "concurrent callers on one host must be spaced by the gap; equal values mean they all went together");
});

test("an idle host does not bank up credit for a burst", async () => {
  // Without `Math.max(now, allowed)` a host untouched for an hour carries a stale timestamp, and the next
  // several requests would each compute a negative wait and fire together — a burst earned by doing nothing.
  const clock = fakeClock();
  const waitTurn = createHostThrottle({ minGapMs: 2000, now: clock.now, sleep: clock.sleep });
  await waitTurn("www.w3.org");
  clock.advance(3_600_000);
  assert.equal(await waitTurn("www.w3.org"), 0, "first after a long idle goes immediately");
  assert.equal(await waitTurn("www.w3.org"), 2000, "and the NEXT one is spaced from that, not from an hour ago");
});

test("the throttle is keyed on the publisher, not the page", () => {
  // Two pages from one publisher must share a slot; the same path on two publishers must not.
  assert.equal(hostOf("https://www.w3.org/WAI/demos/bad/before/news.html"), "www.w3.org");
  assert.equal(hostOf("https://www.w3.org/WAI/tutorials/images/decorative/"), "www.w3.org");
  assert.notEqual(hostOf("https://www.gov.uk/a"), hostOf("https://www.nhs.uk/a"));
});
