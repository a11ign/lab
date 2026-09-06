import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

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
 * `packages/lab/src/gates/fleet.mjs` reads it and runs ON THE LAB. `gate:stability` died there minutes
 * later: *"no workers in inventory.yml, and none named — a gate cannot examine nothing."*
 *
 * My method was sound and my POPULATION was three directories I thought of. So this walks every tracked
 * source file `git ls-files` returns — the population is the repository, not a memory of it.
 */
const tracked = (): string[] =>
  // SCRUB GIT_* — a leaked GIT_DIR redirects this `ls-files` onto another repository, and the population
  // would then be somebody else's tracked files. That is this test's own defect, one layer down.
  execFileSync("git", ["ls-files"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter((f) => /\.(mjs|ts|js)$/.test(f) && !f.includes("node_modules"));

/** Reaching the inventory means importing the reader, not merely naming the file in prose. */
const READER = "inventoryWorkerUrls";

/**
 * Modules OUTSIDE `packages/control` that reach the inventory reader, each with why it is safe.
 *
 * Safe here means ONE thing: it must work when the file is absent. `A11Y_WORKERS` is how — every lab job
 * receives it, derived from the inventory on the control plane where the file actually lives.
 */
const NON_CONTROL_READERS: Record<string, string> = {
  "packages/worker-fleet/src/fleet-env.mjs":
    "IT IS the reader — `inventoryWorkerUrls` is defined here. A library, not a caller: it runs wherever "
    + "its importer runs, so the obligation is on them, and it takes `inventoryPath` injected so a test "
    + "can point it at the example file.",
  "packages/lab/src/gates/fleet.mjs":
    "Reads A11Y_WORKERS FIRST and falls back to the inventory, so it works on the lab where the file is "
    + "gone. This is the module that broke; the fallback is the fix.",
  "packages/lab/src/training/capture-real-pages.mjs":
    "UNVERIFIED — runs on the lab and reaches the reader. Must gain the same A11Y_WORKERS-first fallback; "
    + "until it does this entry records a known exposure rather than a cleared one.",
  "packages/worker-fleet/src/check-worker-code.mjs":
    "UNVERIFIED, and the most exposed of them. This is `assertFleetRunsThisCheckout`, called at the "
    + "boundary of BOTH capture entry points, so it runs on the lab. If the inventory is absent there it "
    + "resolves an empty pool — and this guard's job is to REFUSE a stale fleet, so an empty pool is the "
    + "one failure it must never have: nothing to compare means nothing to refuse. Found by THIS TEST on "
    + "its first run, not by the hand-written list above, which is the whole argument for it.",
  "packages/worker-fleet/src/local-vm.ts":
    "Local UTM VM support, which runs on a developer's Mac and nowhere else — the deprecated local-worker "
    + "path. That machine is the control plane, so the file is present. Classified rather than exempted "
    + "because 'runs where the file lives' is a claim that stops being true if this is ever imported by "
    + "something the lab runs.",
  "packages/lab/src/training/capture-screenreader-dataset.mjs":
    "UNVERIFIED — same exposure as its sibling above, and it is the corpus capture path, so a silent "
    + "empty fleet here is the most expensive version of this defect.",
};

test("nothing outside packages/control reaches the inventory unless it is classified", () => {
  const reaching = tracked().filter((f) => {
    if (f.startsWith("packages/control/")) return false;
    if (/\.test\.(ts|mjs|js)$/.test(f)) return false;
    try { return readFileSync(join(REPO, f), "utf8").includes(READER); } catch { return false; }
  }).sort();

  // ANTI-VACUITY: the reader must be found SOMEWHERE, or a rename has made this examine nothing.
  assert.ok(reaching.length > 0,
    `no file outside packages/control mentions ${READER}; has it been renamed? This test would then pass `
    + "having checked nothing, which is the defect it exists for.");

  const unclassified = reaching.filter((f) => !(f in NON_CONTROL_READERS));
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

test("the gate falls back to A11Y_WORKERS, which is the whole remedy", async () => {
  const { gateWorkers } = await import("./fleet.mjs");
  const got = gateWorkers(undefined, { env: { A11Y_WORKERS: "http://a:8765,http://b:8765" }, inventory: () => [] });
  assert.deepEqual(got.workers, ["http://a:8765", "http://b:8765"]);
  assert.match(got.scope, /from A11Y_WORKERS/, "the scope must SAY where the fleet came from");
  assert.throws(() => gateWorkers(undefined, { env: {}, inventory: () => [] }),
    /a gate cannot examine nothing/, "with neither source it must still refuse, not examine nothing");
});
