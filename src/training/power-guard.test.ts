/**
 * The guard exists because a sleeping host is indistinguishable from a dead worker, so its own logic
 * must not add a second way to be wrong.
 *
 * A recapture died here with every case reporting `the worker did not come back within 10 minutes`. The
 * guest was healthy; the Mac had run to 1% and hibernated. The run cannot tell those apart, and neither
 * could I — the first diagnosis was host memory over-commitment, built from symptoms measured only after
 * the event.
 *
 * `powerVerdict` is pure precisely so these can run without a Mac in a particular battery state. A guard
 * you can only test by draining a laptop is a guard nobody tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { powerVerdict } from "./power-guard.mjs";

test("AC power is always allowed, whatever the battery reads", () => {
  // A charging laptop at 3% is fine — it is not going to sleep. Refusing here would block the exact
  // recovery the operator just performed.
  assert.equal(powerVerdict({ onAcPower: true, batteryPercent: 3, estimatedHours: 15 }).ok, true);
});

test("a multi-hour run on battery is REFUSED, because its failure would be misleading", () => {
  const verdict = powerVerdict({ onAcPower: false, batteryPercent: 95, estimatedHours: 8 });
  assert.equal(verdict.ok, false);
  // The message has to name the real consequence, or the operator overrides it as pedantry. A full
  // battery is refused too: 95% does not survive 8 hours of driving a VM.
  // `assert.ok` on the typeof, not `assert.equal` of it: only this form narrows `string | undefined`
  // for the match below. The ok:true branch carries no reason, so the union is real.
  assert.ok(typeof verdict.reason === "string", "a refusal must carry a reason");
  assert.match(verdict.reason, /unreachable worker|broken guest/,
    `the refusal must explain what a sleeping host looks like from inside a run; got: ${verdict.reason}`);
  // AND IT MUST NAME THE ROUTE THAT MAKES THIS HOST IRRELEVANT, not only the override that accepts the
  // risk. For months `--allow-battery` was the sole exit, and `capture-host.mjs` records the result: the
  // flag was passed rather than the dependency understood. A guard offering one escape teaches people to
  // take it. Without this assertion a revert to override-only passes, because the sentence above survives.
  assert.match(verdict.reason, /lab:job/,
    `an overnight run belongs on the lab; the refusal must say so, not just offer the override. Got: ${verdict.reason}`);
});

test("a short run on a healthy battery proceeds", () => {
  // The guard must not become a blanket ban on unplugged work — that is how guards get switched off.
  assert.equal(powerVerdict({ onAcPower: false, batteryPercent: 80, estimatedHours: 0.2 }).ok, true);
});

test("a short run on a nearly flat battery is refused", () => {
  const verdict = powerVerdict({ onAcPower: false, batteryPercent: 9, estimatedHours: 0.2 });
  assert.equal(verdict.ok, false);
  assert.ok(typeof verdict.reason === "string", "a refusal must carry a reason");
  assert.match(verdict.reason, /9%/, "the refusal must quote the reading it acted on");
});

test("the boundary is stated, not incidental", () => {
  // 30% is the documented floor; asserting both sides stops a later edit moving it silently.
  assert.equal(powerVerdict({ onAcPower: false, batteryPercent: 30, estimatedHours: 0.1 }).ok, true);
  assert.equal(powerVerdict({ onAcPower: false, batteryPercent: 29, estimatedHours: 0.1 }).ok, false);
});

test("an unmeasurable host is allowed through, never blocked", () => {
  // "We could not ask" must not become "the answer is no" — the same conflation this project forbids in
  // its capture gates. On a non-Mac `hostPowerState` reports AC, and this is the verdict that follows.
  assert.equal(powerVerdict({ onAcPower: true, batteryPercent: 100, estimatedHours: 99 }).ok, true);
});
