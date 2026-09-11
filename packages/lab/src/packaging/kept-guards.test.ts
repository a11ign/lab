/**
 * Guard triage 1 of 6 (#903) -- names the set of guards that stay on the pull-request path, so "which
 * guards run on a PR" is a list somebody wrote down rather than whatever survives groups 2 to 6.
 *
 * Triage rule from the CI Reset: a guard stays on the PR path only if it catches something that would be
 * wrong in the product, or dangerous in public. Two families qualify -- the leak guards (the repo is
 * public since 2026-09-06, and these are the guards with a real blast radius) and the product-fact pins
 * (each compares two copies of a product fact, which is what a test is).
 *
 * TWO CORRECTIONS TO THE PLAN'S TABLE, found by reading the real tree rather than trusting it: five of the
 * nine files are not under `packages/lab/src/packaging/` at all, contrary to the plan's table; and the plan
 * names `fleet-key-name.test.ts` where the real file is `fleet-key-name-is-one-fact.test.ts`. The second is
 * asserted below, not just corrected in the list, so a rename back to the plan's spelling is caught.
 *
 * ## What this guards, and what it stopped guarding (#931)
 *
 * **It pins the KEPT SET, never the packaging population.** #903 first pinned the whole directory as a
 * closed sum -- `files.length === kept + PENDING_TRIAGE_COUNT`, the pending count a literal -- so that
 * dropping a kept file from the array could not pass silently. It worked, and it taxed every pull request
 * that added or removed ANY test in `packages/lab/src/packaging/`: #923, a workflow row that touched no
 * guard, went red on both `docs` and `ts` for correctly deleting one file, while `main` had been red for
 * 27.8 hours, until its author found and decremented a constant he had no reason to know existed. Six
 * triage rows were about to shrink the directory by ~115 files, each editing the same line. `ceo` ruled the
 * population sum out; this is that change.
 *
 * **What survives is the property the row was filed for.** Every kept file exists on disk, and the kept
 * list cannot silently shrink -- now by pinning the LIST's own length, a number that moves only when a row
 * decides the kept set changes, rather than the population's, which moves whenever anybody adds a test.
 *
 * **What is genuinely lost, stated rather than glossed:** nothing here notices a packaging test appearing or
 * disappearing OUTSIDE the kept set. That was never this guard's job -- it was a side effect of how the
 * mutation got its teeth -- and a pull request that changes the population states its before/after count in
 * its own body, where the reviewer checks it against disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";

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

/**
 * The kept list's own length, PINNED -- the independent signal that lets a dropped entry be caught. A count
 * derived from `KEPT_ON_PR_PATH` itself could not catch `KEPT_ON_PR_PATH` shrinking. It changes only when a
 * row changes what is kept, which is a decision somebody writes down.
 */
const KEPT_COUNT = 10;

/**
 * Every problem with the kept set, given the list and a way to ask whether a path exists. PURE, and it takes
 * no packaging population at all -- which is the whole of #931: nothing outside the kept set is an input.
 *
 * @param {readonly string[]} kept
 * @param {(path: string) => boolean} exists
 * @param {number} expectedCount
 * @returns {string[]}
 */
export function keptSetProblems(kept: readonly string[], exists: (path: string) => boolean, expectedCount: number) {
  const problems: string[] = [];
  if (kept.length !== expectedCount) {
    problems.push(`KEPT_ON_PR_PATH has ${kept.length} entr${kept.length === 1 ? "y" : "ies"}, pinned at `
      + `${expectedCount}. An entry was ${kept.length < expectedCount ? "removed" : "added"} without the pin `
      + "moving. The kept set changes only by a row: if that row exists, update KEPT_COUNT with it; if not, "
      + "`git diff $(git merge-base origin/main HEAD) -- packages/lab/src/packaging/kept-guards.test.ts` shows "
      + "which entry moved -- against the merge base, not origin/main, or an entry ADDED on main after this "
      + "branch was cut reads as one this branch removed.");
  }
  for (const path of kept) {
    if (!exists(path)) problems.push(`${path} is in the kept set and does not exist on disk`);
  }
  return problems;
}

const onDisk = (path: string) => existsSync(join(REPO_ROOT, path));

test("#903: every kept file exists on disk, and the kept list is the length it is pinned at", () => {
  assert.deepEqual(keptSetProblems(KEPT_ON_PR_PATH, onDisk, KEPT_COUNT), []);
});

test("#903: the plan's table names the wrong file for the fleet-key-name guard", () => {
  assert.ok(
    !existsSync(join(REPO_ROOT, "packages/lab/src/packaging/fleet-key-name.test.ts")),
    "the plan's own spelling now exists -- if it was reintroduced deliberately, update this test and the kept list",
  );
  assert.ok(existsSync(join(REPO_ROOT, "packages/lab/src/packaging/fleet-key-name-is-one-fact.test.ts")));
});

/**
 * A FIXED SYNTHETIC KEPT SET for the two PROPERTY tests below -- never the real list. worker-capture's
 * review of #936: with the real list as their fixture, shrinking it (the kept-set mutation) failed these
 * too, and one of them then said "a population of 9 files failed the guard — it must depend on the kept set
 * alone", which diagnoses the OPPOSITE of what happened. The list had shrunk; nothing had leaked in. A test
 * whose failure message names the wrong cause sends its reader the wrong way, so each property is now tested
 * against inputs it owns, and only the test that is ABOUT the real list fails when the real list changes.
 */
const SYNTHETIC_KEPT = ["kept/a.test.ts", "kept/b.test.ts", "kept/c.test.ts"];

test("#931: adding or removing an UNRELATED packaging test cannot fail this guard", () => {
  // Against a synthetic filesystem, never the real directory: the kept files, plus 0, 1 and 50 unrelated
  // ones -- and the same with one of those removed. None of them is an input to the verdict, which is the
  // property #931 exists for: #923 deleted one file and turned `docs` and `ts` red on a workflow row.
  const unrelated = (n: number) => Array.from({ length: n }, (_, i) => `packages/lab/src/packaging/other-${i}.test.ts`);
  for (const extra of [0, 1, 50]) {
    for (const population of [unrelated(extra), unrelated(extra).slice(1)]) {
      const fs = new Set([...SYNTHETIC_KEPT, ...population]);
      assert.deepEqual(keptSetProblems(SYNTHETIC_KEPT, (p) => fs.has(p), SYNTHETIC_KEPT.length), [],
        `a population of ${fs.size} files failed the guard -- it must depend on the kept set alone`);
    }
  }
});

test("#931 MUTATION TARGET: dropping an entry from the kept list, while it stays on disk, still fails", () => {
  // #903's original mutation, unchanged -- the one that must survive the narrowing. The file is still on
  // disk, so only the pinned length can see it go.
  const dropped = KEPT_ON_PR_PATH.filter((path) => path !== "packages/lab/src/packaging/generated-paths.test.ts");
  const problems = keptSetProblems(dropped, onDisk, KEPT_COUNT);
  assert.equal(problems.length, 1, `expected exactly the length problem; got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /has 9 entries, pinned at 10\. An entry was removed/);
});

test("#931: a kept file deleted from disk still fails, and the message names it by path", () => {
  const missing = "kept/b.test.ts";
  const problems = keptSetProblems(SYNTHETIC_KEPT, (p) => p !== missing, SYNTHETIC_KEPT.length);
  assert.deepEqual(problems, [`${missing} is in the kept set and does not exist on disk`]);
});

test("#931: no pinned count of the whole packaging population remains in this file", () => {
  // Asserted against the file's own source, because the point is an ABSENCE, and an absence nothing checks
  // comes back. COMMENTS STRIPPED first: the header names the old constant while explaining why it went,
  // and a history is not a pin. The names are assembled rather than written out too -- this file reads
  // itself, and a literal in the assertion would match the assertion.
  const source = stripComments(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  for (const name of ["PENDING_" + "TRIAGE_COUNT", "PACKAGING_" + "TOTAL", "walk" + "Tree("]) {
    assert.ok(!source.includes(name), `${name} is back in kept-guards.test.ts -- the population sum #931 removed`);
  }
});
