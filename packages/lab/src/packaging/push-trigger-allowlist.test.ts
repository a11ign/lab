/**
 * ONLY A WATCHDOG MAY TRIGGER ON A PUSH TO MAIN.
 *
 * The chairman's rule (`ci.yml`'s own header, 2026-09-06) is that a check gating code must run on the PR,
 * before the merge, because a check that runs after a merge cannot stop it -- and `push: branches: [main]`
 * is exactly that class. `board-liveness.yml` and `npm-token-liveness.yml` keep it anyway, and correctly:
 * both are watchdogs asking whether a SCHEDULED job elsewhere has gone silent, and a watchdog that is
 * itself scheduled has the disease it watches for -- GitHub disables a cron after 60 days with no repo
 * activity, silently. `push` is immune to that specific failure because a push IS activity. Neither
 * workflow gates anything: `continue-on-error: true`, no required check, nothing they run can block a
 * merge. They are not in the class the rule addresses.
 *
 * So the rule this file pins is narrower than "no push trigger anywhere": a workflow may trigger on push
 * to main ONLY if it is on the allowlist below AND is structurally a watchdog -- non-gating, no build
 * step, no full-suite run. The allowlist is a closed set with a reason attached to each entry; a third
 * push-triggered workflow fails here until someone argues its case here, in writing, the same way the
 * first two already have.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS_DIR = `${REPO}.github/workflows/`;
const readWorkflow = (name: string) => readFileSync(`${WORKFLOWS_DIR}${name}`, "utf8");

// Every entry needs a reason, and the reason is what a reviewer checks -- not the presence of a key.
const PUSH_TO_MAIN_ALLOWLIST: Record<string, string> = {
  "board-liveness.yml": "watchdog for board-report.yml's schedule; push is the one trigger immune to "
    + "GitHub's 60-day scheduled-workflow disable, which is the exact failure this checks for",
  "npm-token-liveness.yml": "sibling watchdog for the first-publish NPM_TOKEN (#73); same reasoning as "
    + "board-liveness.yml, same immunity requirement",
};

const triggersOnPushToMain = (doc: unknown): boolean => {
  const on = (doc as { on?: Record<string, unknown> })?.on;
  const push = on?.push;
  if (push === undefined) return false;
  if (push === null) return true; // `push:` with no filter at all means every branch, main included
  const branches = (push as { branches?: unknown }).branches;
  if (branches === undefined) return true; // no `branches:` filter -- every branch, main included
  return Array.isArray(branches) && branches.includes("main");
};

const allWorkflowFiles = (): string[] => readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"));

test("every workflow triggering on push to main is on the closed allowlist, with a reason", () => {
  const offenders: string[] = [];
  for (const file of allWorkflowFiles()) {
    const doc = parseYaml(readWorkflow(file));
    if (triggersOnPushToMain(doc) && !(file in PUSH_TO_MAIN_ALLOWLIST)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(", ")} trigger(s) on push to main and are not on PUSH_TO_MAIN_ALLOWLIST -- a check `
    + "that gates code must run on the PR (chairman's direction, 2026-09-06: a check that runs after the "
    + "merge cannot stop it). If this is a non-gating watchdog immune to the schedule-disable problem the "
    + "same way board-liveness.yml is, add it to the allowlist here with that argument written out.");
});

test("the allowlist names exactly the two known watchdogs -- a shrinking or silently-growing list is a signal", () => {
  assert.deepEqual(Object.keys(PUSH_TO_MAIN_ALLOWLIST).sort(),
    ["board-liveness.yml", "npm-token-liveness.yml"]);
});

// STRUCTURAL PROOF that each allowlisted entry is actually a watchdog and not a gate wearing the allowlist
// as cover -- the allowlist alone is just a list of filenames; these assertions are what makes it cost
// something to add a third one.
for (const file of Object.keys(PUSH_TO_MAIN_ALLOWLIST)) {
  test(`${file}: structurally a watchdog -- continue-on-error, no build step, no full-suite run`, () => {
    const text = readWorkflow(file);
    const doc = parseYaml(text) as { jobs: Record<string, { steps: Array<Record<string, unknown>> }> };

    assert.match(text, /continue-on-error:\s*true/,
      `${file} triggers on push and must be continue-on-error, or a red push blocks nothing but still `
      + "reads as a gate to whoever sees it fail");

    const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
    const runLines = steps.map((s) => String(s.run ?? "")).join("\n");

    assert.ok(!/npm run build\b/.test(runLines),
      `${file} runs a full monorepo build -- a watchdog answering "is a schedule silent" needs no build `
      + "step at all, and one here is a sign this has grown into something that gates");
    assert.ok(!/\b(npm test|npm run test|pytest|ansible-playbook|npx tsx --test)\b/.test(runLines),
      `${file} invokes a full test suite -- that is minutes of runtime on every push to main, which is `
      + "exactly the cost the chairman's rule moved off push in the first place");
  });
}

test("PROOF: a synthetic third push-to-main workflow, not on the allowlist, fails the guard above", () => {
  const dir = mkdtempSync(join(tmpdir(), "push-trigger-proof-"));
  try {
    const fixture = join(dir, "sneaky-gate.yml");
    writeFileSync(fixture, "on:\n  push:\n    branches: [main]\njobs:\n  x:\n    runs-on: ubuntu-latest\n"
      + "    steps: []\n");
    const doc = parseYaml(readFileSync(fixture, "utf8"));
    assert.ok(triggersOnPushToMain(doc), "the fixture itself must trigger on push to main, or this proves "
      + "nothing");
    assert.ok(!("sneaky-gate.yml" in PUSH_TO_MAIN_ALLOWLIST),
      "the fixture must not already be on the allowlist, or this proves nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
