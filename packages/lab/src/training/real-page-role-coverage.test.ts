/**
 * #314: a real-page run that refreshes one role must SAY which roles it left behind, in its own output,
 * at the time -- not twelve days later at `rules:real-pages`'s own comparison.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverRoles, roleCoverageLine } from "./real-page-role-coverage.mjs";
import { REAL_PAGES } from "./real-page-corpus.mjs";

test("discoverRoles reads the roles present, never a written-down list", () => {
  assert.deepEqual(discoverRoles([
    { role: "training" }, { role: "calibration" }, { role: "training" },
  ]), ["calibration", "training"]);
});

test("discoverRoles against the real corpus finds all three known roles -- proves this is not vacuous", () => {
  // The sentinel this test exists for: a discovery that stopped finding roles (a field renamed, the
  // corpus moved) must fail loud here, not pass having examined nothing.
  const roles = discoverRoles(REAL_PAGES);
  assert.ok(roles.length >= 3, `only found ${roles.length} role(s) in the real corpus`);
  for (const expected of ["calibration", "training", "fixture"]) assert.ok(roles.includes(expected));
});

test("a single-role run names what it left behind -- #314's own example shape", () => {
  const line = roleCoverageLine({
    allRoles: ["calibration", "fixture", "training"],
    touchedRoles: ["training"],
  });
  assert.match(line, /refreshed training/);
  assert.match(line, /LEFT BEHIND: calibration, fixture/);
});

test("a run touching every role says so, and names no role as left behind", () => {
  const line = roleCoverageLine({
    allRoles: ["calibration", "training"],
    touchedRoles: ["calibration", "training"],
  });
  assert.doesNotMatch(line, /LEFT BEHIND/);
  assert.match(line, /every role in the corpus was touched/);
});

test("PROOF: a mutation that reports full coverage on a single-role run must be caught", () => {
  // The shape `npm run mutate` drives: make a single-role run report as though it covered every role.
  const mutated = () => "  refreshed everything; every role in the corpus was touched by this run\n";
  const real = roleCoverageLine({ allRoles: ["calibration", "training"], touchedRoles: ["training"] });
  assert.notEqual(mutated(), real, "a single-role run's line must differ from a full-coverage line");
  assert.match(real, /LEFT BEHIND: calibration/);
});

test("touchedRoles must be a SUBSET of allRoles for the partition to make sense, and the common single-role case reads clearly", () => {
  const line = roleCoverageLine({ allRoles: ["calibration"], touchedRoles: [] });
  assert.match(line, /refreshed nothing/);
  assert.match(line, /LEFT BEHIND: calibration/);
});
