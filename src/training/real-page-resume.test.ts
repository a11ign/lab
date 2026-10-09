/**
 * `--resume` on real pages must reuse only evidence that belongs to THIS measurement.
 *
 * The dataset capture resumes against a page hash, because the fixture is ours and "has this page
 * changed" has an exact answer. A real page has none, which is why these captures never cache:
 * *"a cache hit here would silently pair today's claim against yesterday's page."*
 *
 * So the risk resume introduces is not wasted work, it is a corpus scored as one measurement that is
 * actually two — half from this run and half from Tuesday, compared against a conformance claim made
 * about neither moment. Every assertion below is about refusing that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePlan, describeResume, RESUME_WINDOW_MS } from "./real-page-resume.mjs";

const NOW = Date.parse("2026-08-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

test("without --resume nothing is skipped, whatever is on disk", () => {
  // The default must be a full capture. A resume that happens by accident is how a corpus comes to be
  // half from another day with nobody having chosen that.
  const plan = resumePlan({
    urls: ["https://a.example/"], now: NOW, resume: false,
    existing: [{ url: "https://a.example/", capturedAt: ago(MINUTE) }],
  });
  assert.equal(plan.skip.size, 0);
  assert.equal(plan.reused, 0);
});

test("a recent capture is reused, and its age is reported", () => {
  const plan = resumePlan({
    urls: ["https://a.example/", "https://b.example/"], now: NOW, resume: true,
    existing: [{ url: "https://a.example/", capturedAt: ago(3 * MINUTE) }],
  });
  assert.deepEqual([...plan.skip], ["https://a.example/"]);
  assert.equal(Math.round((plan.oldestMs ?? 0) / MINUTE), 3);
  assert.match(describeResume(plan, 2), /reusing 1 of 2 capture\(s\), oldest 3 minute\(s\) old/);
});

test("a capture older than the window is RECAPTURED, not reused", () => {
  // The assertion the whole module exists for. Outside the window the evidence is a different moment,
  // and pairing it with today's is the failure that made these captures uncacheable in the first place.
  const plan = resumePlan({
    urls: ["https://a.example/"], now: NOW, resume: true,
    existing: [{ url: "https://a.example/", capturedAt: ago(RESUME_WINDOW_MS + MINUTE) }],
  });
  assert.equal(plan.skip.size, 0, "stale evidence must not be reused merely because the URL matches");
  assert.deepEqual(plan.staleUrls, ["https://a.example/"]);
  assert.match(describeResume(plan, 1), /older than the window/);
});

test("a capture with NO timestamp is recaptured", () => {
  // Evidence that cannot say when it was taken cannot be shown to belong to this measurement. "Probably
  // fine" is exactly the assumption being refused — and an absent field reads as a passing one unless
  // something makes it not.
  for (const capturedAt of [null, undefined, "not-a-date"]) {
    const plan = resumePlan({
      urls: ["https://a.example/"], now: NOW, resume: true,
      existing: [{ url: "https://a.example/", capturedAt: capturedAt as never }],
    });
    assert.equal(plan.skip.size, 0, `capturedAt=${String(capturedAt)} must not be reused`);
    assert.deepEqual(plan.staleUrls, ["https://a.example/"]);
  }
});

test("a capture dated in the FUTURE is recaptured", () => {
  // Clock skew between the lab and a worker, or a hand-edited file. A negative age would otherwise pass
  // the window test trivially and reuse evidence of unknown provenance.
  const plan = resumePlan({
    urls: ["https://a.example/"], now: NOW, resume: true,
    existing: [{ url: "https://a.example/", capturedAt: new Date(NOW + MINUTE).toISOString() }],
  });
  assert.equal(plan.skip.size, 0);
  assert.deepEqual(plan.staleUrls, ["https://a.example/"]);
});

test("a capture for a URL this run is not taking is ignored entirely", () => {
  // A role-scoped run must not be influenced by the other role's captures sitting in the same directory.
  const plan = resumePlan({
    urls: ["https://a.example/"], now: NOW, resume: true,
    existing: [{ url: "https://elsewhere.example/", capturedAt: ago(MINUTE) }],
  });
  assert.equal(plan.skip.size, 0);
  assert.deepEqual(plan.staleUrls, [], "an unrelated capture is not stale, it is none of this run's business");
});

test("the report distinguishes 'nothing to reuse' from 'nothing reusable'", () => {
  // Two different situations that a bare "resumed 0" collapses: a first run, and a run whose evidence is
  // all too old. The second is worth knowing — it means the window is wrong or the gap was long.
  const firstRun = resumePlan({ urls: ["https://a.example/"], now: NOW, resume: true, existing: [] });
  assert.match(describeResume(firstRun, 1), /this is a full run/);

  const allStale = resumePlan({
    urls: ["https://a.example/"], now: NOW, resume: true,
    existing: [{ url: "https://a.example/", capturedAt: ago(RESUME_WINDOW_MS * 2) }],
  });
  assert.match(describeResume(allStale, 1), /nothing reusable/);
});
