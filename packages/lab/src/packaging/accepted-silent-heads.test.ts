/**
 * `ceo` ruled (2026-09-25, #2536) that `4.1.3:status-waiting` MAY SHIP silent, by an entry the gate reads.
 * Every assertion here goes through the DECIDER, `releasability()`, and never through a message's text
 * alone; the positive controls are the tests that remove the entry and watch the same head block.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "../../../guards/src/test-tmp.mjs";
import { releasability } from "./releasability.mjs";
import { readAcceptedSilentHeads } from "./accepted-silent-heads.mjs";
import { promote } from "../../scripts/promote-model.mjs";

const WAITING = "4.1.3:status-waiting";
const silentHead = (positive = 29) => ({
  threshold: 0.92,
  development: { positive, truePositive: 0, falsePositive: 0, falseNegative: positive, precision: 1, recall: 0 },
});
const findingHead = () => ({
  threshold: 0.9,
  development: { positive: 40, truePositive: 38, falsePositive: 0, falseNegative: 2, precision: 1, recall: 0.95 },
});
const report = (criteria: Record<string, Record<string, unknown>>) =>
  ({ criteria: Object.fromEntries(Object.entries(criteria).map(([c, subtypes]) => [c, { subtypes }])) });
const RULED = readAcceptedSilentHeads();
const ok = { passed: true };
const verdict = (training: object, acceptedSilentHeads = RULED, extra: object = {}) =>
  releasability({ training, acceptance: ok, shipped: null, acceptedSilentHeads, ...extra });

test("the shipped entry file names the ruled head and nothing wider", () => {
  assert.deepEqual(RULED.map((entry) => entry.id), [WAITING]);
  assert.deepEqual(RULED[0].measured, { truePositive: 0, positive: 29, atThreshold: 0.9200663566589355 });
  assert.equal(RULED[0].ruled, "2026-09-25");
  assert.equal(RULED[0].row, "#2536");
});

test("the ruled silent head no longer blocks, and the promotion is told what it took", () => {
  const v = verdict(report({ "4.1.3": { [WAITING]: silentHead() } }));
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.equal(v.acceptedSilent.length, 1);
  assert.match(v.acceptedSilent[0], /^4\.1\.3:status-waiting: SILENT/);
});

test("POSITIVE CONTROL: with the entry removed, the same head blocks", () => {
  const training = report({ "4.1.3": { [WAITING]: silentHead() } });
  for (const none of [[], undefined]) {
    const v = none ? verdict(training, none) : releasability({ training, acceptance: ok, shipped: null });
    assert.equal(v.releasable, false);
    assert.match(v.blockers.join(" "), /4\.1\.3:status-waiting: SILENT — 0 of 29/);
    assert.deepEqual(v.acceptedSilent, []);
  }
});

test("a silent head that is NOT the named one still blocks, beside the excused one", () => {
  for (const other of ["4.1.3:status-progress", "3.3.2:unnamed-form-field", "4.1.3:status-waiting-2"]) {
    const v = verdict(report({ "4.1.3": { [WAITING]: silentHead() }, [other.split(":")[0]]: { [other]: silentHead(12) } }));
    assert.equal(v.releasable, false, other);
    assert.match(v.blockers.join(" "), new RegExp(`${other}: SILENT — 0 of 12`));
    assert.equal(v.blockers.length, 1, `only ${other} blocks; the ruled head stays excused`);
  }
});

test("the named head id listed under a DIFFERENT criterion still blocks", () => {
  const v = verdict(report({ "3.3.2": { [WAITING]: silentHead() } }));
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /4\.1\.3:status-waiting: SILENT/);
});

test("the measured count is provenance, not a match: a retrain reading 0 of 31 does not re-block", () => {
  const v = verdict(report({ "4.1.3": { [WAITING]: silentHead(31) } }));
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.acceptedSilent[0], /0 of 31/);
});

test("a STALE entry is reported under `stale` and does not fail", () => {
  const v = verdict(report({ "4.1.3": { [WAITING]: findingHead() } }));
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.equal(v.stale.length, 1);
  assert.match(v.stale[0], /4\.1\.3:status-waiting: no longer silent — 38 of 40/);
  assert.deepEqual(v.acceptedSilent, []);
});

test("an entry naming a head this candidate does not carry is stale, not a failure", () => {
  const v = verdict(report({ "3.3.2": { "3.3.2:unnamed-form-field": findingHead() } }));
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.stale.join(" "), /4\.1\.3:status-waiting: not in this candidate/);
});

test("CONTROL: a live excuse is not stale, and an empty list has nothing to be stale", () => {
  assert.deepEqual(verdict(report({ "4.1.3": { [WAITING]: silentHead() } })).stale, []);
  assert.deepEqual(verdict(report({ "4.1.3": { [WAITING]: findingHead() } }), []).stale, []);
});

test("the entry excuses the SILENT line only: a held-out regression on the same head still blocks", () => {
  const criteria = (recall: number) => ({ criteria: { "4.1.3": { modelEvaluated: true, precision: 1, recall } } });
  const v = verdict(report({ "4.1.3": { [WAITING]: silentHead() } }), RULED, {
    acceptance: { passed: true, ...criteria(0.609) }, shippedAcceptance: criteria(1),
  });
  assert.equal(v.releasable, false);
  assert.deepEqual(v.blockers, ["4.1.3 held-out recall 1.000 -> 0.609"]);
  assert.equal(v.acceptedSilent.length, 1, "the silent line was excused while the regression stayed a blocker");
});

test("the loader is loud: an unruled head, a stray key or a duplicate is refused", () => {
  const write = (heads: unknown[], extra: object = {}) => {
    const path = join(tempDir("silent-heads-"), "heads.json");
    writeFileSync(path, JSON.stringify({ ruling: "test", heads, ...extra }));
    return path;
  };
  const entry = { id: WAITING, measured: { truePositive: 0, positive: 29 }, ruled: "2026-09-25", row: "#2536" };
  assert.deepEqual(readAcceptedSilentHeads(write([entry])).map((e) => e.id), [WAITING]);
  assert.throws(() => readAcceptedSilentHeads(write([{ ...entry, id: "4.1.3:status-progress" }])), /not a head `ceo` ruled on/);
  assert.throws(() => readAcceptedSilentHeads(write([{ ...entry, id: "*" }])), /not a head `ceo` ruled on/);
  assert.throws(() => readAcceptedSilentHeads(write([{ ...entry, note: "x" }])), /must carry exactly/);
  assert.throws(() => readAcceptedSilentHeads(write([entry, entry])), /lists a head twice/);
  assert.throws(() => readAcceptedSilentHeads(write([entry], { extra: 1 })), /keys are/);
});

test("every caller of releasability() passes the ruled list, so promote and retrain cannot disagree", () => {
  const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));
  const callers = readdirSync(scripts).filter((f) => f.endsWith(".mjs"))
    .filter((f) => /releasability\(\{/.test(readFileSync(join(scripts, f), "utf8")));
  assert.deepEqual(callers.sort(), ["promote-model.mjs", "retrain-pipeline.mjs"],
    "the positive control: discovery must find both real callers, or an empty scan would pass");
  for (const file of callers) {
    assert.match(readFileSync(join(scripts, file), "utf8"), /acceptedSilentHeads:\s*readAcceptedSilentHeads\(\)/, file);
  }
});

// --- promote-model: what the changeset says ---------------------------------------------------------

const ALL_ZERO = { "@a11ign/evidence": "0.0.0", "@a11ign/judge": "0.0.0", "@a11ign/scorer": "0.0.0" };
const acceptance = (recall: number) => ({ passed: true, criteria: { "4.1.3": { modelEvaluated: true, precision: 1, recall } } });
function promoteCandidate(training: object, over: Record<string, unknown> = {}) {
  const dir = join(tempDir("promote-silent-"), "model-under-test");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "training-report.json"), JSON.stringify(training));
  writeFileSync(join(dir, "acceptance-report.json"), JSON.stringify(acceptance(0.609)));
  writeFileSync(join(dir, "model.safetensors"), "not really weights");
  return () => promote({ candidate: dir, candidateName: "under-test", dryRun: true, versions: ALL_ZERO,
    shippedAcceptance: acceptance(1) as never, ...over });
}
const V20 = report({ "4.1.3": { [WAITING]: silentHead() } });

test("promote: without --accept-regression the two held-out lines refuse, and the SILENT line is not among them", () => {
  assert.throws(promoteCandidate(V20), (error: Error) =>
    /held-out recall 1\.000 -> 0\.609/.test(error.message) && !/SILENT/.test(error.message));
});

test("promote: with --accept-regression the changeset says the head is silent and lists the regression lines", () => {
  const { entry } = promoteCandidate(V20, { acceptRegression: true })();
  assert.match(entry, /Shipped with a silent head, by a `ceo` ruling \(#2536\)/);
  assert.match(entry, /does not detect what they exist to detect \(for `4\.1\.3:status-waiting`, waiting-status announcements\)/);
  assert.match(entry, /- 4\.1\.3:status-waiting: SILENT — 0 of 29/);
  assert.match(entry, /- 4\.1\.3 held-out recall 1\.000 -> 0\.609/);
});

test("promote: --accept-regression does not excuse a different silent head", () => {
  const other = report({ "4.1.3": { [WAITING]: silentHead(), "4.1.3:status-progress": silentHead(12) } });
  assert.throws(promoteCandidate(other, { acceptRegression: true }),
    /4\.1\.3:status-progress: SILENT — 0 of 12/);
});
