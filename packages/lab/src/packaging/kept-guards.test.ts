/**
 * Guard triage 1 of 6 (#903) -- names the set of guards that stay on the pull-request path, so "which
 * guards run on a PR" is a list somebody wrote down rather than whatever survives groups 2 to 6.
 *
 * Triage rule from the CI Reset: a guard stays on the PR path only if it catches something that would be
 * wrong in the product, or dangerous in public. Two families qualify -- the leak guards (the repo is
 * public since 2026-09-06, and these are the guards with a real blast radius) and the product-fact pins
 * (each compares two copies of a product fact, which is what a test is).
 *
 * TWO CORRECTIONS TO THE PLAN'S TABLE, found by reading the real tree rather than trusting it -- the same
 * discipline this row's own filing already applied once (five of the nine files are not under
 * `packages/lab/src/packaging/` at all, contrary to the plan's table) and a second the filing missed:
 * the plan names `fleet-key-name.test.ts`; the real file on `origin/main` is
 * `fleet-key-name-is-one-fact.test.ts`. Asserted below, not just corrected in the list, so a future rename
 * back to the plan's spelling is caught rather than silently accepted.
 *
 * THE ACCOUNTING MUST CLOSE, or a kept file quietly dropped from the array below is invisible as long as
 * it still exists on disk. `PENDING_TRIAGE_COUNT` is a PINNED literal (measured once against
 * `origin/main`, 2026-09-10: 207 packaging test files total, 4 of the 9 kept files live under packaging,
 * so 207 - 4 = 203 remain for groups 2 to 6) -- never derived from `KEPT_UNDER_PACKAGING.length`, because
 * a count derived from the very array being mutated cannot catch the array being mutated. Naming which of
 * the 203 goes to which of groups 2-6 is their job (see "Not in scope" on the row), not this one's; this
 * row only has to prove none of them fell through a crack no test was watching.
 *
 * This file adds itself to the packaging population and to the kept set -- it is the guard that keeps the
 * boundary, so it belongs on the PR path by the same rule as everything else here. 207 -> 208; the row's
 * own acceptance text says "unchanged at 207, because this row adds one file and removes none", which is
 * arithmetically impossible for a row that adds a file -- 208 is the corrected, measured number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { walkTree } from "../../../../scripts/tree-wide-guard.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const LEAK_GUARDS = [
  "packages/lab/src/packaging/tracked-source-leak-guard.test.ts",
  "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts",
  "packages/lab/src/packaging/fleet-key-name-is-one-fact.test.ts",
  "packages/lab/src/gates/inventory-is-control-plane-only.test.ts",
];

const PRODUCT_FACT_PINS = [
  "packages/judge/src/asserting-subtypes.test.ts",
  "packages/worker-fleet/src/protocol-guard.test.ts",
  "packages/worker-fleet/src/entry-points.test.ts",
  "packages/lab/src/referenced-scripts.test.ts",
  "packages/lab/src/packaging/generated-paths.test.ts",
];

/** This file itself: the guard that keeps the boundary named here. */
const SELF = "packages/lab/src/packaging/kept-guards.test.ts";

export const KEPT_ON_PR_PATH = [...LEAK_GUARDS, ...PRODUCT_FACT_PINS, SELF];

const KEPT_UNDER_PACKAGING = KEPT_ON_PR_PATH.filter((path) => path.startsWith("packages/lab/src/packaging/"));

// Pinned, not derived -- see the file header. Both measured against origin/main, 2026-09-10, before this
// row's own file existed.
const PACKAGING_TOTAL_BEFORE_THIS_ROW = 207;
const KEPT_UNDER_PACKAGING_BEFORE_THIS_ROW = 4;
const PENDING_TRIAGE_COUNT = PACKAGING_TOTAL_BEFORE_THIS_ROW - KEPT_UNDER_PACKAGING_BEFORE_THIS_ROW;

function packagingTestFiles() {
  return walkTree({ kind: "all", roots: ["packages/lab/src/packaging"] })
    .map((file) => file.path)
    .filter((path) => path.endsWith(".test.ts"));
}

test("#903: all nine plan-named kept files exist on disk, at the paths named here", () => {
  for (const path of KEPT_ON_PR_PATH) {
    assert.ok(existsSync(join(REPO_ROOT, path)), `${path} does not exist`);
  }
});

test("#903: the plan's table names the wrong file for the fleet-key-name guard", () => {
  assert.ok(
    !existsSync(join(REPO_ROOT, "packages/lab/src/packaging/fleet-key-name.test.ts")),
    "the plan's own spelling now exists -- if it was reintroduced deliberately, update this test and the kept list",
  );
  assert.ok(existsSync(join(REPO_ROOT, "packages/lab/src/packaging/fleet-key-name-is-one-fact.test.ts")));
});

test("#903: the packaging population is exhaustively accounted for -- kept plus pending, nothing dropped", () => {
  const files = packagingTestFiles();
  const expected = KEPT_UNDER_PACKAGING.length + PENDING_TRIAGE_COUNT;
  assert.equal(
    files.length,
    expected,
    `packaging holds ${files.length} test file(s); kept (${KEPT_UNDER_PACKAGING.length}) + pending `
      + `(${PENDING_TRIAGE_COUNT}) = ${expected} -- the accounting no longer closes. A file was added, `
      + "removed, or moved without this row's pinned count being updated to match.",
  );
  for (const path of KEPT_UNDER_PACKAGING) {
    assert.ok(files.includes(path), `${path} is in the kept list but the tree walk did not find it`);
  }
});

test("#903 MUTATION TARGET: dropping a kept-under-packaging file from the list, while it stays on disk, breaks the accounting", () => {
  // The row's own named mutation: "delete one of the nine from the list but leave it on disk." Simulated
  // here rather than by editing the real array, so this test proves the LOGIC catches it without this
  // file having to un-fix itself to prove a negative.
  const mutatedKeptCount = KEPT_UNDER_PACKAGING.length - 1;
  const files = packagingTestFiles();
  assert.notEqual(
    files.length,
    mutatedKeptCount + PENDING_TRIAGE_COUNT,
    "removing one kept file from the count must desync the accounting -- if this equality holds, the "
      + "exhaustiveness check cannot see a kept file disappearing from the list",
  );
});
