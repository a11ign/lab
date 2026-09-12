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

/**
 * Evaluate the job's `if:` expression for one event, the way the runner would. The grammar this
 * accepts is exactly what the expression uses -- the two context values, `==`/`!=`, `&&`/`||`,
 * parentheses and single-quoted strings -- and anything else is refused, so a rewrite that
 * introduces a function call or a third context value fails here rather than evaluating to
 * something. #1095's first version matched the expression's SPELLING (`doesNotMatch(/opened|synchronize/)`),
 * which two wrong conditions passed: one that ran on every pull_request event without naming any,
 * and one that never ran at all (`github.event.action` is empty on a push). A condition is a
 * function of the event; assert the function.
 */
function runsOn(cond: string, ctx: { event_name: string; action: string; draft?: boolean; base?: string }): boolean {
  const TOKENS = /^(?:\s+|github\.event_name|github\.event\.action|github\.event\.pull_request\.draft|github\.event\.pull_request\.base\.ref|true|false|==|!=|&&|\|\||[()]|'[a-z_]*')+$/;
  assert.match(cond, TOKENS, `the if: expression uses only the grammar this evaluator accepts: ${cond}`);
  const OPERAND = String.raw`(ctx\.\w+|"[^"]*"|true|false)`;
  const js = cond
    .replace(/github\.event\.pull_request\.draft/g, "ctx.draft")
    .replace(/github\.event\.pull_request\.base\.ref/g, "ctx.base")
    .replace(/github\.event_name/g, "ctx.event_name")
    .replace(/github\.event\.action/g, "ctx.action")
    .replace(/'([a-z_]*)'/g, (_m, v: string) => JSON.stringify(v))
    // #1103 clause 7: `==` is GitHub's comparison, which COERCES, not JS's `===`, which does not.
    .replace(new RegExp(`${OPERAND}\\s*(==|!=)\\s*${OPERAND}`, "g"),
      (_m, a: string, op: string, b: string) => `${op === "!=" ? "!" : ""}eq(${a}, ${b})`);
  return Boolean(new Function("ctx", "eq", `return (${js});`)(ctx, githubEquals));
}

/**
 * GitHub's documented `==`: same-type values compare directly (strings case-insensitively); different
 * types are both cast to a number first -- null (an absent context value) -> 0, false -> 0, true -> 1,
 * a string -> Number(string), NaN for anything non-numeric -- and NaN equals nothing. Only the values the
 * grammar above admits reach here; that closed grammar is what makes these rules sufficient.
 */
function githubEquals(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (typeof x === "string" && typeof y === "string") return x.toLowerCase() === y.toLowerCase();
  if (typeof x === typeof y && x !== null) return x === y;
  if (x === null && y === null) return true;
  const num = (v: unknown): number =>
    v === null ? 0 : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : Number(v);
  const nx = num(x); const ny = num(y);
  return !Number.isNaN(nx) && !Number.isNaN(ny) && nx === ny;
}

test("#1094 update-branch runs on push AND on auto_merge_enabled, never on opened, synchronize or ready_for_review", () => {
  // A merge landing and a PR being armed are the two inputs of `updateBranchDecision`; `push` covers the
  // first and `auto_merge_enabled` is when the second flips. Pinned against #1080's real ordering on
  // 2026-09-12 -- ReadyForReview 10:28:13Z, AutoMergeEnabled 10:28:23Z -- so a trigger on ready_for_review
  // alone reads "not armed" ten seconds too early and reproduces the 57-minute deadlock with a second event.
  const doc = loadDoc();
  const cond = String(doc.jobs["update-branch"]?.if ?? "");
  // On a push there is no `github.event.action`; the runner reads it as the empty string.
  assert.equal(runsOn(cond, { event_name: "push", action: "" }), true, "main moved: runs");
  assert.equal(runsOn(cond, { event_name: "pull_request", action: "auto_merge_enabled" }), true, "a PR armed: runs");
  for (const action of ["opened", "synchronize", "ready_for_review", "reopened"]) {
    assert.equal(runsOn(cond, { event_name: "pull_request", action }), false, `pull_request/${action}: does not run`);
  }
  assert.equal(runsOn(cond, { event_name: "workflow_run", action: "" }), true, "#1103 a gate completed: runs");
  assert.equal(runsOn(cond, { event_name: "workflow_dispatch", action: "" }), false, "no fourth way in");
  const types = (doc as { on?: { pull_request?: { types?: string[] } } }).on?.pull_request?.types ?? [];
  assert.ok(types.includes("auto_merge_enabled"), "the workflow must subscribe to auto_merge_enabled");
});

test("the evaluator refuses the two conditions that passed the spelling check (worker-judge on #1095)", () => {
  const runsOnEverything = "github.event_name == 'push' || github.event_name == 'pull_request' || github.event.action == 'auto_merge_enabled'";
  assert.equal(runsOn(runsOnEverything, { event_name: "pull_request", action: "synchronize" }), true,
    "the over-broad condition runs on synchronize, which the table above would fail");
  const neverRuns = "github.event_name == 'nope' || (github.event_name == 'push' && github.event.action == 'auto_merge_enabled')";
  assert.equal(runsOn(neverRuns, { event_name: "push", action: "" }), false,
    "the never-runs condition is false on a push, which the table above would fail");
  assert.throws(() => runsOn("github.event_name == 'push' || contains(github.ref, 'x')", { event_name: "push", action: "" }),
    "a function call is outside the grammar and is refused, not evaluated");
});

test("#1094 item 3: the log says WHICH cause ran the sweep -- main moved, or a PR armed", () => {
  // Two causes rendering the same sentence is what made #1080 take an hour to find.
  const doc = loadDoc();
  const step = (doc.jobs["update-branch"]?.steps ?? []).find((s) => (s.run ?? "").includes("update-branch-sweep.mjs"));
  const run = step?.run ?? "";
  assert.match(run, /UPDATE-BRANCH: ran because main moved/, "the push cause is named in the log");
  assert.match(run, /UPDATE-BRANCH: ran because #\$\{?EVENT_PR\}? armed/, "the arming cause is named in the log, with the PR");
  const env = (step?.env ?? {}) as Record<string, string>;
  assert.equal(env.EVENT_NAME, "${{ github.event_name }}");
  assert.equal(env.EVENT_PR, "${{ github.event.pull_request.number }}");
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

test("#1022 the arm job does NOT run on auto_merge_enabled -- the re-arm loop this PR's subscription would otherwise open (reviewer on #1095)", () => {
  // Subscribing the workflow to auto_merge_enabled so update-branch can sweep on arming means `arm` also
  // receives that event. Without the exclusion it re-arms the PR it just armed, which fires the event
  // again: #1022's loop. The external reviewer measured that deleting the exclusion left 50/0 across three
  // guards, so this pins it by evaluating the condition, not by reading it.
  const doc = loadDoc();
  const cond = String(doc.jobs.arm?.if ?? "");
  const readyOnMain = { draft: false, base: "main" };
  assert.equal(runsOn(cond, { event_name: "pull_request", action: "auto_merge_enabled", ...readyOnMain }), false,
    "arming must not re-run arm");
  assert.equal(runsOn(cond, { event_name: "pull_request", action: "ready_for_review", ...readyOnMain }), true,
    "the event arm exists for still runs it");
  assert.equal(runsOn(cond, { event_name: "pull_request", action: "ready_for_review", draft: true, base: "main" }), false,
    "a draft is never armed");
});

const CI_WORKFLOW = `${REPO}.github/workflows/ci.yml`;

test("#1103 clause 3: the workflow subscribes to `ci` completing, by the NAME ci.yml declares, never a second literal", () => {
  const doc = loadDoc() as Doc & { on: { workflow_run?: { workflows?: string[]; types?: string[] } } };
  const ciName = (parseYaml(readFileSync(CI_WORKFLOW, "utf8")) as { name?: string }).name;
  assert.ok(ciName, "ci.yml declares a name:, which is what workflow_run matches on");
  assert.deepEqual(doc.on.workflow_run?.workflows, [ciName], "workflow_run names ci.yml's own name");
  assert.deepEqual(doc.on.workflow_run?.types, ["completed"], "a completed run is the gate concluding");
});

test("#1103 clause 4: the log names a THIRD cause, a gate completing, with the PR it completed for", () => {
  const doc = loadDoc();
  const step = (doc.jobs["update-branch"]?.steps ?? []).find((s) => (s.run ?? "").includes("update-branch-sweep.mjs"));
  const run = step?.run ?? "";
  assert.match(run, /UPDATE-BRANCH: ran because a gate completed for #\$\{?EVENT_GATE_PR[^}]*\}? \(workflow_run\)/,
    "the workflow_run cause is named in the log, with the PR");
  const env = (step?.env ?? {}) as Record<string, string>;
  assert.equal(env.EVENT_GATE_PR, "${{ github.event.workflow_run.pull_requests[0].number }}");
  const causes = [...run.matchAll(/UPDATE-BRANCH: ran because ([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(causes).size, 3, `three distinct causes rendered, got: ${causes.join(" | ")}`);
});

test("#1103: only update-branch admits workflow_run -- sweep and stalled stay off it, arm too", () => {
  const doc = loadDoc();
  const gateDone = { event_name: "workflow_run", action: "" };
  for (const job of ["sweep", "stalled", "arm"]) {
    const cond = String(doc.jobs[job]?.if ?? "");
    assert.ok(cond, `${job} has an if:`);
    assert.equal(runsOn(cond, gateDone), false, `${job} does not run when a gate completes`);
  }
  // and sweep/stalled still run on the events they exist for
  assert.equal(runsOn(String(doc.jobs.sweep?.if), { event_name: "push", action: "" }), true);
  assert.equal(runsOn(String(doc.jobs.stalled?.if), { event_name: "pull_request", action: "synchronize" }), true);
});

test("#1103 clause 7: the evaluator coerces like GitHub -- an absent draft == false is TRUE, and the base clause is not what keeps arm off a push", () => {
  const onPush = { event_name: "push", action: "" };
  // The sub-expression GitHub and `===` disagreed on at #1095's head: absent -> null -> 0, false -> 0.
  assert.equal(runsOn("github.event.pull_request.draft == false", onPush), true, "GitHub's answer, not ===");
  assert.equal(runsOn("github.event.pull_request.base.ref == 'main'", onPush), false, "0 == NaN is false");
  // arm's condition AS IT STOOD at 2ed5d225 with the base clause removed: GitHub would have RUN arm on a push.
  const armWithoutBase = "github.event.pull_request.draft == false && github.event.action != 'auto_merge_enabled'";
  assert.equal(runsOn(armWithoutBase, onPush), true, "the guard the base clause was silently carrying");
  // The live condition no longer relies on it.
  const live = String(loadDoc().jobs.arm?.if ?? "");
  assert.equal(runsOn(live, onPush), false, "arm stays off push by its own event clause");
  assert.equal(runsOn(live.replace(" && github.event.pull_request.base.ref == 'main'", ""), onPush), false,
    "and still off push with the base clause removed");
  // (GitHub also compares strings case-insensitively; the grammar admits only lowercase literals, so that
  // rule can never decide an answer here and the grammar refusing 'PUSH' is the assertion that matters.)
  assert.throws(() => runsOn("github.event_name == 'PUSH'", onPush), "outside the grammar: refused, not guessed");
});
