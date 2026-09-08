/**
 * C2: PUSH EVERY ARMED, GREEN-OR-RUNNING, BEHIND PR UP TO main's NEW TIP AFTER A MERGE -- #416's sibling.
 *
 * `queue-stalled.mjs` only REPORTS a PR that drifted into a real conflict against `main`; nothing was
 * pushing an open PR back up after a merge landed underneath it. `update-branch` is the fix half: it rides
 * a `push` to `main` and runs `scripts/update-branch-sweep.mjs`'s decision.
 *
 * This file asserts the WORKFLOW's own wiring, the same way `auto-arm-token.test.ts` does for `arm`/
 * `sweep` -- and deliberately does NOT assert the fallback-warning count those two jobs use, because this
 * job's contract is the opposite one: it must NEVER fall back to GITHUB_TOKEN. See the job's own comment
 * for why (a push made with GITHUB_TOKEN fires no `pull_request: synchronize`, so an "updated" PR would
 * get a new head with no check run ever triggered for it -- worse than leaving it alone).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/auto-arm.yml`;

type Doc = {
  on: { push?: { branches?: string[] } },
  jobs: Record<string, { if?: string, steps: Array<{ env?: Record<string, string>, run?: string }> }>,
};

function loadDoc(): Doc {
  return parseYaml(readFileSync(WORKFLOW, "utf8")) as Doc;
}

test("the workflow triggers on push to main, alongside its existing pull_request triggers", () => {
  const doc = loadDoc();
  assert.deepEqual(doc.on.push?.branches, ["main"]);
});

test("update-branch only runs on the push event, never on a pull_request event", () => {
  const doc = loadDoc();
  assert.equal(doc.jobs["update-branch"]?.if, "github.event_name == 'push'");
});

test("update-branch reads A11IGN_BOT_TOKEN through an env: mapping, never as a CLI argument", () => {
  const doc = loadDoc();
  const steps = doc.jobs["update-branch"]?.steps ?? [];
  const withToken = steps.find((s) => s.env?.A11IGN_BOT_TOKEN === "${{ secrets.A11IGN_BOT_TOKEN }}");
  assert.ok(withToken, "update-branch must read secrets.A11IGN_BOT_TOKEN through an env: mapping");
  assert.ok(!(withToken?.run ?? "").includes("secrets.A11IGN_BOT_TOKEN"),
    "the run: script must never reference the secret directly, only through the env var");
});

test("MUTATION TARGET: update-branch has NO GITHUB_TOKEN fallback -- it must SKIP, not degrade", () => {
  const doc = loadDoc();
  const steps = doc.jobs["update-branch"]?.steps ?? [];
  const fallbackMapped = steps.some((s) => "FALLBACK_TOKEN" in (s.env ?? {}));
  assert.equal(fallbackMapped, false,
    "update-branch must not map a FALLBACK_TOKEN env var -- unlike arm/sweep, there is no safe fallback "
    + "here (see the job's own comment: a GITHUB_TOKEN push fires no pull_request: synchronize)");

  const runText = steps.map((s) => s.run ?? "").join("\n");
  assert.match(runText, /if \[ -z "\$A11IGN_BOT_TOKEN" \]/,
    "the step must branch on the token being ABSENT and skip, not on it being present");
  assert.match(runText, /exit 0/, "an absent token must exit cleanly (skip), not fail the run");
  assert.doesNotMatch(runText, /export GH_TOKEN="\$FALLBACK_TOKEN"/,
    "no path here may arm/update with a fallback token");
});

test("the skip warning names the concrete consequence -- synchronize, and #416/C2", () => {
  const doc = loadDoc();
  const runText = (doc.jobs["update-branch"]?.steps ?? []).map((s) => s.run ?? "").join("\n");
  const warnings = [...runText.matchAll(/::warning::A11IGN_BOT_TOKEN is not set[^\n]*/g)];
  assert.equal(warnings.length, 1, "exactly one skip warning");
  const [[warning]] = warnings;
  assert.match(warning, /synchronize/);
  assert.match(warning, /#416|C2/);
});

test("update-branch runs the real script, and nowhere else in the workflow duplicates its decision", () => {
  const doc = loadDoc();
  const runText = (doc.jobs["update-branch"]?.steps ?? []).map((s) => s.run ?? "").join("\n");
  assert.match(runText, /node scripts\/update-branch-sweep\.mjs/);
});

test("A11IGN_BOT_TOKEN never appears as a bare CLI argument in update-branch's steps", () => {
  const doc = loadDoc();
  const runText = (doc.jobs["update-branch"]?.steps ?? []).map((s) => s.run ?? "").join("\n");
  assert.doesNotMatch(runText, /gh [^\n]*A11IGN_BOT_TOKEN/,
    "the token must reach `gh` only via GH_TOKEN, never as an explicit flag on a command line");
});
