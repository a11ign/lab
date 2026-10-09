/**
 * #1626: `axe-calibration.mjs` is tested WITHOUT a browser -- the population it selects, the shape it
 * writes, its refusal without an install, and that a per-page failure is RECORDED rather than skipped.
 *
 * Nothing here launches Chromium: `scanCalibrationPages` takes an injectable `launch`, the same seam
 * `packages/cli/src/scan/axe.ts`'s `axeAvailable` uses for the identical reason -- neither a missing
 * browser nor a fake one can be produced from CI without uninstalling a real dependency or faking the
 * launch, so a fake `launch` is supplied instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conformantCalibrationPages, installRefusal, scanCalibrationPages, axeVersion,
} from "../../scripts/axe-calibration.mjs";

// --- Selection: derived from role + publishedClaim, never a URL list ---

/**
 * #1626 MUTATION TARGET. A synthetic corpus, deliberately using URLs no real page carries: a selection
 * that filtered by a URL LIST (frozen at today's real 46) would find NONE of these and return `[]`, while
 * a selection that reads `role`/`publishedClaim` off the entries it is given finds exactly the one that
 * qualifies. Plant that mutation (replace the role/claim filter with a fixed list of today's real URLs)
 * and this test goes red.
 */
const SYNTHETIC = [
  { url: "https://synthetic.example/calibration-conformant", role: "calibration", publishedClaim: "conformant" },
  { url: "https://synthetic.example/calibration-inaccessible", role: "calibration", publishedClaim: "inaccessible" },
  { url: "https://synthetic.example/training-conformant", role: "training", publishedClaim: "conformant" },
  { url: "https://synthetic.example/calibration-undeclared", role: "calibration" },
];

test("#1626: selects a calibration page published conformant, and nothing else", () => {
  assert.deepEqual(conformantCalibrationPages(SYNTHETIC).map((p) => p.url),
    ["https://synthetic.example/calibration-conformant"]);
});

test("#1626: an inaccessible calibration page is excluded -- only a CONFORMANT claim licenses axe here", () => {
  const urls = conformantCalibrationPages(SYNTHETIC).map((p) => p.url);
  assert.ok(!urls.includes("https://synthetic.example/calibration-inaccessible"));
});

test("#1626: a conformant page outside the calibration role is excluded -- the role, not just the claim", () => {
  // The bug this guards: filtering on publishedClaim alone (forgetting role) would keep this one too.
  const urls = conformantCalibrationPages(SYNTHETIC).map((p) => p.url);
  assert.ok(!urls.includes("https://synthetic.example/training-conformant"));
});

test("#1626: an undeclared claim is excluded, not treated as conformant by default", () => {
  const urls = conformantCalibrationPages(SYNTHETIC).map((p) => p.url);
  assert.ok(!urls.includes("https://synthetic.example/calibration-undeclared"));
});

test("#1626: against the real corpus, this is #1614's own population -- 46 conformant calibration pages", () => {
  // The number is a fact about REAL_PAGES today, not typed here to be re-derived: it is the same measurement
  // #1614 and this row's own premise both cite, so a corpus edit that moves it is exactly what should be
  // re-noticed, not silently absorbed by a test that never looked.
  const pages = conformantCalibrationPages();
  assert.equal(pages.length, 46);
  assert.ok(pages.every((p) => p.role === "calibration" && p.publishedClaim === "conformant"));
});

// --- Refusal without an install ---

test("#1626: refuses when the browser executable is not on disk, naming the path and the install job", () => {
  return installRefusal({ existsSync: () => false, chromiumExecutablePath: () => "/nowhere/chrome" })
    .then((refusal) => {
      assert.match(String(refusal), /\/nowhere\/chrome/);
      assert.match(String(refusal), /install-axe-browser/);
    });
});

test("#1626: does not refuse when the browser executable is on disk", () => {
  return installRefusal({ existsSync: () => true, chromiumExecutablePath: () => "/somewhere/chrome" })
    .then((refusal) => assert.equal(refusal, null));
});

// --- Output shape, and a page's own failure is recorded, not skipped ---

const fakeLaunch = ({ throwsOn = new Set<string>() } = {}) => async () => ({
  browserVersion: "999.0.0-fake",
  scanOne: async (url: string) => {
    if (throwsOn.has(url)) throw new Error(`navigation failed: ${url}`);
    return { violations: [{ id: "color-contrast", tags: ["wcag2aa", "wcag143"] }] };
  },
  close: async () => {},
});

test("#1626: a clean page's record carries the shape done-when 2 names", async () => {
  const [result] = await scanCalibrationPages(
    [{ url: "https://ok.example/" }],
    { launch: fakeLaunch(), now: () => 42, axeVersion: () => "4.12.1-fake" },
  );
  assert.deepEqual(result, {
    url: "https://ok.example/",
    axeVersion: "4.12.1-fake",
    browserVersion: "999.0.0-fake",
    runTimeMs: 0,
    failed: false,
    violatedCriteria: ["1.4.3"],
    ruleIds: ["color-contrast"],
  });
});

test("#1626: a page axe cannot examine is recorded as FAILED, and the run continues to the next page", async () => {
  const results = await scanCalibrationPages(
    [{ url: "https://bad.example/" }, { url: "https://ok.example/" }],
    { launch: fakeLaunch({ throwsOn: new Set(["https://bad.example/"]) }), now: () => 0, axeVersion: () => "4.12.1-fake" },
  );
  // NOT skipped: both pages are present, in order, and the failure is a field on its own record.
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://bad.example/");
  assert.equal(results[0].failed, true);
  assert.match(results[0].error, /navigation failed/);
  assert.equal(results[1].failed, false);
});

test("#1626: one browser for the whole run -- launch is called once, not once per page", async () => {
  let launches = 0;
  const launch = async () => {
    launches++;
    return fakeLaunch()();
  };
  await scanCalibrationPages(
    [{ url: "https://a.example/" }, { url: "https://b.example/" }, { url: "https://c.example/" }],
    { launch, now: () => 0, axeVersion: () => "4.12.1-fake" },
  );
  assert.equal(launches, 1);
});

test("#1626: axeVersion reads the installed axe-core's own package.json, not a typed string", () => {
  assert.match(axeVersion(), /^\d+\.\d+\.\d+$/);
});
