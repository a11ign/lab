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
import { checkIsolation, internalDependencies } from "../../../../scripts/isolation-gate.mjs";

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
  // dependencies. Nothing is published, so npm cannot fetch `@a11y-witness/evidence` from the registry — it
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
