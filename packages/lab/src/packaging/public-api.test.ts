/**
 * Each package's public surface is specified in ADR 0004, and nothing asserted it was actually exported.
 *
 * The subpaths are a promise: `evidence` majors every downstream package if it breaks one, `judge`'s
 * `./internal` is documented as carrying no semver guarantee precisely so the rest can be relied on, and the
 * CLI exports `reportLines` so a consumer can render our report shape. A missing export is caught today by
 * `gate:isolation` — but only at release time, against a packed tarball. This catches it in the normal suite,
 * in milliseconds, and it also states the surface in one readable place.
 *
 * Deliberately asserts NAMES and callability, not behaviour: the behaviour is tested in each package. What this
 * guards is the boundary — the thing a rename silently breaks for everyone else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * A module namespace indexed by a runtime string. Checking exports BY NAME is the whole point of this
 * file, and TS types a namespace by its known keys, so the lookup needs a cast. Narrow and named rather
 * than `any` at each site, so the reason survives.
 */
const exportsOf = (mod: object): Record<string, unknown> => mod as Record<string, unknown>;

test("the SOURCE barrels export what the built packages do", async () => {
  // Imported by relative path on purpose. A package-name import resolves to `dist`, so the assertions below
  // verify the BUILT surface — which is what a consumer gets, and the right thing to check. But it means a
  // barrel in `src` could drift from its own build and nothing would notice until the next `tsc`. These check
  // the sources, and they are also the only way coverage can see them.
  const evidenceSrc = await import("../../../evidence/src/verify.js");
  assert.equal(typeof evidenceSrc.captureReachedThePage, "function");
  const judgeInternal = await import("../../../judge/src/internal.js");
  for (const name of ["hasEvidenceFor", "evidenceFor", "findingsFromScores", "scoreCapture", "applyGate"]) {
    assert.equal(typeof exportsOf(judgeInternal)[name], "function", `judge/src/internal must export ${name}`);
  }
  const fleetSrc = await import("../../../worker-fleet/src/index.js");
  assert.equal(typeof fleetSrc.fleetScriptPaths, "function");
  const cliSrc = await import("../../../cli/src/index.js");
  assert.equal(typeof cliSrc.reportLines, "function");
});

test("evidence exports the wire types and the pure predicates", async () => {
  // `.` is types only, so at runtime it is an empty module — importing it still proves the subpath resolves.
  await assert.doesNotReject(() => import("@a11y-witness/evidence"));
  const verify = await import("@a11y-witness/evidence/verify");
  for (const name of ["captureReachedThePage", "captureHasSubstance", "captureIsSelfConsistent",
    "captureRanRequestedProbes", "captureMentionsTitle", "pageCensus", "captureDoubt", "titleOf"]) {
    assert.equal(typeof exportsOf(verify)[name], "function", `evidence/verify must export ${name} (ADR 0004)`);
  }
  const { WCAG_22_AA } = await import("@a11y-witness/evidence/wcag");
  assert.ok(Array.isArray(WCAG_22_AA) && WCAG_22_AA.length > 20, "the criteria list must be populated");
});

test("judge exports its four documented subpaths", async () => {
  const root = await import("@a11y-witness/judge");
  assert.equal(typeof root.judge, "function");
  assert.equal(typeof root.validateJudgment, "function");
  const rules = await import("@a11y-witness/judge/rules");
  assert.equal(typeof rules.ruleFindings, "function");
  const layers = await import("@a11y-witness/judge/layers");
  for (const name of ["layerOf", "orderByLayer"]) assert.equal(typeof exportsOf(layers)[name], "function", name);
  assert.ok(layers.LAYER_LABEL?.perceive, "every layer needs a human label for the report");
  // Exported so a test can drive the REAL gate rather than a copy of it — documented as unstable, which is why
  // it is worth asserting it exists at all rather than assuming.
  const internal = await import("@a11y-witness/judge/internal");
  for (const name of ["hasEvidenceFor", "evidenceFor", "findingsFromScores", "scoreCapture", "applyGate"]) {
    assert.equal(typeof exportsOf(internal)[name], "function", `judge/internal must export ${name} (ADR 0004)`);
  }
});

test("the layer ordering is the waterfall the report depends on", async () => {
  const { layerOf, orderByLayer } = await import("@a11y-witness/judge/layers");
  assert.equal(layerOf("1.1.1"), "perceive");
  assert.equal(layerOf("2.4.4"), "navigate");
  assert.equal(layerOf("4.1.2"), "interact");
  const ordered = orderByLayer([
    { wcag: "4.1.2", issue: "i", evidence: "e", severity: "serious", confidence: 1 },
    { wcag: "1.1.1", issue: "i", evidence: "e", severity: "serious", confidence: 1 },
  ]);
  assert.deepEqual(ordered.map((f) => f.wcag), ["1.1.1", "4.1.2"],
    "a finding about operating a control is useless to someone who could not perceive it");
});

test("worker-fleet exports the lease surface and the script paths", async () => {
  const fleet = await import("@a11y-witness/worker-fleet");
  for (const name of ["leaseWorker", "leaseWorkerPool", "isAfterRun", "guestReachableUrl",
    "hostAddressForWorker", "fleetScriptPaths"]) {
    assert.equal(typeof exportsOf(fleet)[name], "function", `worker-fleet must export ${name} (ADR 0004)`);
  }
  assert.match(fleet.DEFAULT_WORKER, /^https?:\/\//);
  const health = await import("@a11y-witness/worker-fleet/health");
  assert.equal(typeof health.assessWorker, "function");
  const capacity = await import("@a11y-witness/worker-fleet/capacity");
  for (const name of ["availableHostMemoryMb", "workersHostCanRun"]) {
    assert.equal(typeof exportsOf(capacity)[name], "function", name);
  }
});

test("the CLI exports only the renderer, which is the whole documented surface", async () => {
  const cli = await import("a11y-witness");
  assert.equal(typeof cli.reportLines, "function", "reportLines is the entire public API (ADR 0004)");
  // Asserting the surface is SMALL matters as much as asserting it exists: a second way to orchestrate a run
  // would be a second API to keep honest, and ADR 0004 deliberately does not offer one.
  assert.deepEqual(Object.keys(cli).filter((k) => k !== "default"), ["reportLines"]);
});
