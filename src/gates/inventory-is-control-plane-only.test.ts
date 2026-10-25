import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declareTreeWideGuard, walkTree } from "@a11ign/toolchain/lib/tree-wide-guard";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = join(import.meta.dirname, "../../../..");

/**
 * `inventory.yml` IS CONTROL-PLANE ONLY, AND THIS ASKS THE WHOLE TREE RATHER THAN THE PART SOMEBODY GREPPED.
 *
 * The file is gitignored and untracked, so a `git pull` DELETES it from any checkout holding one. The
 * control plane keeps its copy deliberately. Every other machine loses it silently, and code that reads it
 * there fails — or worse, reads an empty fleet.
 *
 * THIS TEST EXISTS BECAUSE I ANSWERED THAT QUESTION WRONG, CONFIDENTLY, AN HOUR BEFORE IT BROKE. Asked
 * whether anything on the lab reads `inventory.yml`, I grepped `packages/control/ansible/`,
 * `packages/lab/scripts/` and `packages/nvda-worker/src/`, found only comments, and reported the pull safe.
 * `packages/lab/src/gates/fleet.ts` reads it and runs ON THE LAB. `gate:stability` died there minutes
 * later: *"no workers in inventory.yml, and none named — a gate cannot examine nothing."*
 *
 * My method was sound and my POPULATION was three directories I thought of. So this walks every tracked
 * source file `git ls-files` returns — the population is the repository, not a memory of it.
 *
 * #795: the walk itself (the scrubbed `git ls-files` call, and the assertion that its own count is real)
 * now lives in `walkTree`, shared with every other tree-wide guard rather than re-derived here.
 */
const tracked = (): string[] =>
  walkTree({ kind: "all", roots: [] }).map((f) => f.path)
    .filter((f) => /\.(mjs|ts|js)$/.test(f) && !f.includes("node_modules"));

/** Reaching the inventory means importing the reader, not merely naming the file in prose. */
const READER = "inventoryWorkerUrls";

/**
 * Modules OUTSIDE `packages/control` that reach the inventory reader, each with why it is safe.
 *
 * Safe here means ONE thing: it must work when the file is absent. `A11Y_WORKERS` is how — every lab job
 * receives it, derived from the inventory on the control plane where the file actually lives.
 */
const NON_CONTROL_READERS: Record<string, string> = {
  // `packages/lab/src/gates/fleet.ts` was the module that broke (`gate:stability` died on the lab with "no workers in inventory.yml"): it read A11Y_WORKERS first and fell back to the
  // inventory. The gates SUBMIT a fleet job now (A11-263), which names boxes and never gives an address, so `gateWorkers` is gone with the pool and `fleet.ts` reads no inventory at all.
  // `capture-real-pages.mjs` and `capture-screenreader-dataset.mjs` were classified here as exposed until they gained the same fallback; they read none either.
};

test("nothing outside packages/control reaches the inventory unless it is classified", () => {
  const mentions = (f: string): boolean => { try { return readFileSync(join(REPO, f), "utf8").includes(READER); } catch { return false; } };
  const all = tracked();

  // ANTI-VACUITY, on the population and on the detector. No lab file reaches the reader any more (the gates submit a fleet job, A11-263), so "the reader is found somewhere outside control"
  // can no longer be the control: the walk must be real, and the detector must be able to see the reader in a source that has it.
  assert.ok(all.length > 100, "the walk found almost no source files; it examined nothing, which is the defect this test exists for");
  assert.ok(`const workers = ${READER}();`.includes(READER), "the detector cannot see the reader it is looking for");

  const unclassified = all.filter((f) => !f.startsWith("packages/control/") && !/\.test\.(ts|mjs|js)$/.test(f) && mentions(f) && !(f in NON_CONTROL_READERS)).sort();
  assert.deepEqual(unclassified, [],
    "these reach the inventory from outside packages/control and are classified nowhere. `inventory.yml` "
    + "is gitignored, so a pull DELETES it from their machine: each must work without it (read "
    + "A11Y_WORKERS first) or say here why it cannot be there:\n  " + unclassified.join("\n  "));
});

test("the classification names no file that has gone", () => {
  // A stale entry exempts nothing while making the exposure look larger, and hides a rename: the renamed
  // file would fail the test above as a surprise and the obvious fix would be to add it.
  const all = new Set(tracked());
  for (const path of Object.keys(NON_CONTROL_READERS)) {
    assert.ok(all.has(path), `${path} is classified here and is no longer tracked`);
  }
});

test("the gates read no inventory and choose no boxes: they submit a job, and the service books them", () => {
  // The remedy this test used to prove -- `gateWorkers` falling back to A11Y_WORKERS -- is gone with the thing it protected. What replaces it is the absence: `fleet.ts` mentions neither the
  // reader nor the variable, so a pull that deletes `inventory.yml` from the lab cannot take a gate down.
  const source = readFileSync(join(REPO, "packages/lab/src/gates/fleet.ts"), "utf8");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /inventoryWorkerUrls|A11Y_WORKERS|gateWorkers|acrossFleet/, "fleet.ts chooses boxes or reads the inventory again");
});
