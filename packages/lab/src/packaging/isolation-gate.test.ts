/**
 * The isolation gate must reject a package a consumer could not use — and accept one they could.
 *
 * ADR 0007 makes this gate the check the whole multi-package plan rests on, and states the condition for
 * accepting it: **it is not trusted until it has been shown to reject a package with a deliberately omitted
 * dependency and one with a deliberately truncated `"files"`.** A gate written against an unverified shape
 * is the count-based check all over again.
 *
 * The third fixture is the one that makes the other two mean anything. A gate that always failed would
 * "reject" both broken packages and look correct, so `sound` must PASS — otherwise this test proves only
 * that the gate can say no.
 *
 * Costs about 3.5 s: three `npm pack` + `npm install` cycles into throwaway directories. Kept in the normal
 * suite rather than hidden behind an env var, because this project's most repeated failure is a check that
 * exists and does not run — `capture-check` was mandatory and never ran, `release:gate` was broken from the
 * day it was written. A visible three seconds is the cheaper mistake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Four levels up, to the REPO ROOT. The gate is monorepo tooling, not a package: it has to pack and install
// every package including this one, so it cannot live inside any of them. Its tests live here because `lab` is
// where this repo's internal tooling tests live.
import { checkIsolation, internalDependencies, declaredBins, allPackages } from "../../../../scripts/isolation-gate.mjs";

const fixture = (name: string) => fileURLToPath(new URL(`../../../../scripts/isolation-fixtures/${name}`, import.meta.url));

test("a correctly packaged package PASSES, so the gate is not merely always-failing", () => {
  const verdict = checkIsolation(fixture("sound"));
  assert.equal(verdict.ok, true, `the sound fixture should install and run, got: ${verdict.detail}`);
  assert.match(verdict.detail, /works when installed/);
});

test("an undeclared dependency is REJECTED", () => {
  // The phantom npm's hoisting permits: in the workspace the import resolves from the root `node_modules`
  // and everything looks fine. ADR 0005 accepts that risk explicitly and names this gate as the reason it
  // is acceptable.
  const verdict = checkIsolation(fixture("omitted-dependency"));
  assert.equal(verdict.ok, false, "an undeclared dependency must not pass");
  assert.match(verdict.detail, /MODULE_NOT_FOUND/);
});

test("a file dropped by \"files\" is REJECTED", () => {
  // The asset an allow-list loses silently — the package publishes cleanly and breaks on first import.
  // `.ps1`, `.cmd` and `.safetensors` payloads in this repo are exactly this shape.
  const verdict = checkIsolation(fixture("truncated-files"));
  assert.equal(verdict.ok, false, "a package missing one of its own files must not pass");
  assert.match(verdict.detail, /MODULE_NOT_FOUND/);
});

test("a package with no smoke test is REJECTED rather than silently passed", () => {
  // `packages/README.md` is a directory with no manifest; more importantly, a real package that forgot its
  // smoke test must not be waved through, or the gate becomes a decoration on exactly the packages nobody
  // remembered to cover.
  const verdict = checkIsolation(fileURLToPath(new URL("../../../../packages", import.meta.url)));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.stage, "setup");
});

test("a package's unpublished siblings are resolved, so the gate can install them", () => {
  // The gate only ever handled LEAF packages, and nothing noticed until `judge` arrived with two internal
  // dependencies. Nothing is published, so npm cannot fetch `@a11ign/evidence` from the registry — it
  // fails the install with E404, and the gate would report a broken package that is perfectly fine. npm 7+
  // auto-installs peer dependencies too, so a peer on an unpublished sibling fails the same way.
  const judge = fileURLToPath(new URL("../../../../packages/judge", import.meta.url));
  const resolved = internalDependencies(judge).map((dir: string) => dir.split("/").pop());
  assert.deepEqual(resolved.sort(), ["evidence", "scorer"],
    "judge depends on evidence and peers on scorer; both must be packed alongside it");
});

test("a dependency on a sibling that does not exist is an ERROR, not a silent skip", () => {
  // The failure this prevents is a typo'd internal dependency quietly falling through to the registry, where
  // it 404s during install and looks like a broken package instead of a broken manifest.
  const fixture = fileURLToPath(new URL("../../../../scripts/isolation-fixtures/missing-sibling", import.meta.url));
  assert.throws(() => internalDependencies(fixture), /not a package in this repo/);
});

test("a platform-declined check is SKIPPED, not failed — and not counted as a pass either", () => {
  // Exit 3 means the smoke test could not make a check on THIS machine: guidepup refusing to import without a
  // screen reader, or a host-capacity read that is macOS-only because the fleet drives UTM. That is a platform
  // limit, not a packaging defect.
  //
  // It mattered more than it looks. `gate:isolation` is the FIRST leg of `release:gate`, so treating a decline
  // as a failure stopped the chain on the Linux control plane — the only machine with the Python venv the
  // judge needs — and every model-quality gate behind it silently never ran. A gate that cannot run somewhere
  // must say so, the way this file already announces private packages rather than quietly covering less.
  const verdict = checkIsolation(fixture("platform-declined"));

  assert.equal(verdict.skipped, true, `a decline must be a skip, got: ${JSON.stringify(verdict)}`);
  assert.notEqual(verdict.ok, true, "a skip must NOT be reported as usable-when-installed");
  assert.match(verdict.detail, /cannot verify/);
});

test("a decline is distinguishable from a real failure, which is the whole point", () => {
  // If these two produced the same verdict the distinction would be decorative. `omitted-dependency` is a
  // genuine packaging defect and must stay a failure no matter what the platform is.
  const declined = checkIsolation(fixture("platform-declined"));
  const broken = checkIsolation(fixture("omitted-dependency"));

  assert.equal(declined.skipped, true);
  assert.notEqual(broken.skipped, true, "an undeclared dependency is a DEFECT, never a platform limit");
  assert.equal(broken.ok, false);
});

/**
 * #1129: a DECLARED BIN THAT NEVER REACHES THE CONSUMER, which every check above was structurally unable
 * to see.
 *
 * The row asked for `npm pack` plus an install outside the workspace, on the premise that nothing here
 * opens the tarball. That premise did not survive: this gate has packed and installed since ADR 0007, and
 * three of the row's four clauses were already honoured — the install is outside the repo, the population
 * is derived, and a package with no smoke test is REFUSED rather than skipped. What survived is the one
 * clause about `bin`, and it survived because it is real:
 *
 * **Measured 2026-09-12 on this repo — pointing all five of `@a11ign/worker-fleet`'s bins at a file that
 * does not exist left `checkIsolation` reporting `ok: true`.** Nine bins are declared across four
 * published packages; exactly one (`a11ign`) was ever executed, two were checked for existence, and
 * `worker-fleet`'s five were not looked at.
 *
 * The reason it hid is npm's, not ours: an install links a shim for a bin whose target it received and
 * creates NOTHING for one it did not — no warning, exit 0. So a consumer's `command not found` is the
 * first anyone hears of it, and on the registry that costs a version number rather than a test run.
 */
test("a declared bin whose target is not in the package is REJECTED, though the package imports fine", () => {
  // NOT a `"files"` omission -- that one cannot happen. The first version of this test tried to lose the
  // bin by leaving it out of `files` and the gate passed, correctly: `npm pack --dry-run --json` showed
  // npm force-includes a bin target regardless of the allow-list. So the class is narrower than the row
  // supposed, and it is the class this repo is exposed to: four of nine declared bins point into `dist/`,
  // which is gitignored build output, and a pack whose build did not run loses all four silently.
  const verdict = checkIsolation(fixture("dangling-bin"));
  assert.equal(verdict.ok, false, "a bin a consumer cannot run must not pass");
  assert.equal(verdict.stage, "bin", `expected the bin stage, got ${verdict.stage}: ${verdict.detail}`);
  assert.match(verdict.detail, /a11ign-fixture-dangling/, "the verdict must name the bin that is missing");
  // The fixture's own smoke test passes against this tarball -- it imports the package and never spawns
  // anything. Asserting that here is what makes the test above a claim about the BIN rather than about
  // the fixture being broken in some general way.
  assert.doesNotMatch(verdict.detail, /works when installed/);
});

test("a declared bin that IS packed passes, so the bin check is not merely always-failing", () => {
  const verdict = checkIsolation(fixture("linked-bin"));
  assert.equal(verdict.ok, true, `a packed bin should install and link, got: ${verdict.detail}`);
  assert.match(verdict.detail, /1 bin\(s\) on PATH/);
});

test("a package with NO bin is a declared case, not an absence that reads like a pass", () => {
  // The shape that has cost this repo most is a check whose "nothing to do" and "everything fine" render
  // identically. `sound` declares no bin at all, and its PASS line has to SAY so.
  const verdict = checkIsolation(fixture("sound"));
  assert.equal(verdict.ok, true, verdict.detail);
  assert.match(verdict.detail, /no bins declared/);
});

test("declaredBins reads the string shorthand, which links the unscoped package name", () => {
  // `"bin": "./cli.mjs"` links ONE name -- the package name with the scope dropped. Reading only the
  // object form would report such a package as declaring no bins, and the check would pass by not looking.
  assert.deepEqual(declaredBins({ name: "@a11ign/worker-fleet", bin: "./dist/doctor.mjs" }), ["worker-fleet"]);
  assert.deepEqual(declaredBins({ name: "a11ign", bin: "./dist/cli.js" }), ["a11ign"]);
  assert.deepEqual(declaredBins({ name: "@a11ign/evidence" }), []);
  assert.deepEqual(declaredBins({ name: "@a11ign/scorer", bin: { one: "./a.mjs", two: "./b.mjs" } }), ["one", "two"]);
});

test("every bin the six published packages declare is reachable in a real consumer install", () => {
  // The population, derived rather than typed: this is the assertion that would have caught the live
  // defect, and it is the reason the row was filed. Slow on purpose -- it is six real packs and installs.
  const failures = allPackages()
    .map((dir) => ({ dir, verdict: checkIsolation(dir) }))
    .filter(({ verdict }) => verdict.stage === "bin");
  assert.deepEqual(failures.map(({ dir, verdict }) => `${dir}: ${verdict.detail}`), []);
});
