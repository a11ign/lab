/**
 * `capture-regression.yml` runs the capture checks on a REAL Windows runner — the only automated place NVDA
 * actually runs. It used to be path-filtered on a push to `main` so doc edits did not spend Windows minutes,
 * and this file used to pin that filter against the worker and training packages after M8's mechanical path
 * rewrite silently narrowed it to a directory holding no capture code at all.
 *
 * RELEASE-TIME ONLY SINCE 2026-09-06 (chairman's direction): the workflow left `push`/`pull_request` entirely
 * for `workflow_call`/`workflow_dispatch`, called unconditionally as a job from `release.yml` against the
 * exact shipping sha. There is no path filter left to pin — it does not trigger on a diff at all, so "does the
 * filter cover the worker package" is not a question this file could mean any more. See
 * `workflow-path-coverage.test.ts`'s `NOT_A_GATE` entry for the same fact stated there.
 *
 * What survives: a moved harness still makes the job fail with MODULE_NOT_FOUND on the runner, so checking the
 * referenced paths exist is still worth doing here, cheaply, before spending Windows minutes to find out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/capture-regression.yml"), "utf8");

test("every program the capture workflow runs exists at the path it names", () => {
  // A moved harness makes the job fail on the runner with MODULE_NOT_FOUND — visible, but only after spending
  // Windows minutes to find out. Cheaper to know here.
  const referenced = [...workflow.matchAll(/node\s+(packages\/[A-Za-z0-9._/-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, "found no program invocations in the workflow; the scan is broken");
  for (const path of referenced) {
    assert.ok(existsSync(join(root, path)), `capture-regression.yml runs ${path}, which does not exist`);
  }
});
