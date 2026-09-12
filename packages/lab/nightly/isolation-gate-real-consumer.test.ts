/**
 * #1143: THE SIX-PACKAGE PACK-AND-INSTALL, MOVED OFF THE PR PATH — one test, not the file it came from.
 *
 * `isolation-gate.test.ts` sits at `packages/lab/src/packaging/`, which matches the PR suite's glob
 * `packages/*|/src/**|/*.test.ts`, and #1139 made it the most expensive single thing in that suite.
 * Measured per test at #1139's head:
 *
 * ```
 * every bin the six published packages declare is reachable   21,458 ms
 * a decline is distinguishable from a real failure             2,365 ms
 * a correctly packaged package PASSES                          1,870 ms
 * a declared bin that IS packed passes                         1,695 ms
 * a package with NO bin is a declared case                     1,640 ms
 * a platform-declined check is SKIPPED, not failed             1,326 ms
 * an undeclared dependency is REJECTED                         1,266 ms
 * a file dropped by "files" is REJECTED                        1,171 ms
 * a declared bin whose target is not in the package            1,108 ms
 * …4 more, sub-millisecond
 * ```
 *
 * **21.5 s of the 24.6 s is ONE test.** The row asked for a `git mv` of the whole file; that would take
 * eleven other tests with it to save three seconds, and three of them — `sound` PASSES, an undeclared
 * dependency REJECTED, a file dropped by `"files"` REJECTED — are **ADR 0007's own trust condition**: the
 * gate *"is not trusted until it has been shown to reject a package with a deliberately omitted dependency
 * and one with a deliberately truncated `files`."* Those are exactly the assertions that must fire on a PR
 * that touches the gate. So the move is one test.
 *
 * **MEASURED AFTER THE MOVE, because the first version of this comment claimed the PR suite ends up faster
 * than it was before #1139 and that is false:**
 *
 * ```
 * isolation-gate.test.ts at origin/main      8.6 s   12 tests
 * at #1139's head                           33.2 s   13 tests
 * after this move                           13.2 s   12 tests
 * the moved test, alone, nightly            22.0 s    1 test
 * ```
 *
 * **13.2 s, not 8.6 s.** The move gives back the 21.5 s this row is about; it does NOT give back the ~4.6 s
 * of three new FIXTURE tests #1139 also added, which are cheap, are on the PR path deliberately, and are
 * what proves the bin check is not merely always-failing. Saying "faster than before" would have been a
 * true-sounding sentence with the wrong subtraction under it.
 *
 * WHY THIS IS THE RIGHT TENANT rather than #908's vacuity residual: that one costs ~0.5 s and its cost was
 * argued. This one is measured and large, which is the only kind of cost worth a separate population.
 *
 * WHAT MOVED AND WHAT DID NOT. This file runs the SAME assertion over the SAME derived population; only
 * where it runs changed. The seed that kept the glob non-empty is deleted in the same commit, by its own
 * instruction — *"When #908's first residual lands, this file may go."* That matters beyond tidiness:
 * while the seed exists, `--min=1` is satisfied by the seed ALONE, so this test could be deleted and the
 * nightly job would stay green. A floor that a placeholder satisfies is a floor holding nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// THREE levels up, not four: this file is at `packages/lab/nightly/`, the original at
// `packages/lab/src/packaging/`. The row warned that "a test written for the PR path may name paths
// relative to its own location, and a move that silently changes what it resolves is the defect this repo
// files most" -- so this was re-derived rather than copied, and the assertion below would fail loudly on a
// wrong specifier rather than quietly examining nothing.
import { checkIsolation, allPackages } from "../../../scripts/isolation-gate.mjs";

test("every bin the six published packages declare is reachable in a real consumer install", () => {
  // The population, derived rather than typed: this is the assertion that would have caught the live
  // defect #1139 found -- all five of `@a11ign/worker-fleet`'s bins pointed at a file that does not exist,
  // and the gate returned `ok: true`, because npm creates no shim, silently, for a target it never
  // received. Slow on purpose: six real packs and installs, which is why it is here and not on the PR path.
  const packages = allPackages();
  assert.ok(packages.length >= 1,
    "no published packages found -- the import resolved to something, but the walk is empty, which is the "
    + "shape a wrong relative specifier would produce and the one this file must not pass quietly");

  const failures = packages
    .map((dir: string) => ({ dir, verdict: checkIsolation(dir) }))
    .filter(({ verdict }: { verdict: { stage: string } }) => verdict.stage === "bin");
  assert.deepEqual(
    failures.map(({ dir, verdict }: { dir: string; verdict: { detail: string } }) => `${dir}: ${verdict.detail}`),
    []);
});
