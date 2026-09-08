/**
 * THE SWEEP MUST ARM THE STANDING QUEUE, AND MUST NOT ARM THE THREE SHAPES THAT ARE NOT ITS TO ARM.
 *
 * `auto-arm.yml` triggers on `pull_request: [opened, ready_for_review]`, so a PR that was ALREADY OPEN
 * when it shipped has no event left to fire and nothing ever arms it (#344). Measured 2026-09-07 11:35Z,
 * four hours after unit 1 shipped: `[276, 183, 181, 172]` open, base `main`, not draft, unarmed — two of
 * them green on `gate` since 01:27 and 01:39.
 *
 * These tests drive `sweepDecision` itself rather than asserting on the workflow's prose, because the
 * predicate's whole value is which PRs it refuses. The two structural assertions at the end exist because
 * a correct predicate wired to nothing is the same silence as no predicate at all — this repository has
 * paid for `refreshBrowseBuffer` (a correct remedy whose trigger was never set, inert on every capture
 * ever taken) and for `scorer:verify` (a security check nothing invoked).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
// A plain `.mjs`, and `scripts/**` IS in the typecheck program (#189), so this resolves and is checked.
import { sweepDecision, EXIT } from "../../../../scripts/auto-arm-sweep.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/auto-arm.yml`;

const pr = (over: Partial<{ labels: string[]; checkRunCount: number }> = {}) =>
  ({ labels: [], checkRunCount: 9, ...over });

test("the ordinary case is ARMED — a tested, unheld, unblocked PR is exactly what the sweep exists for", () => {
  const { arm, reason } = sweepDecision(pr());
  assert.equal(arm, true);
  assert.match(reason, /9 check run/,
    "the reason must carry the NUMBER of runs. `it was tested` and `it was tested by 9 runs` are "
    + "different claims, and a count is what makes the second checkable.");
});

test("`blocked` is refused — a person's refusal is not something a green gate can overturn", () => {
  const { arm, reason } = sweepDecision(pr({ labels: ["blocked"] }));
  assert.equal(arm, false);
  assert.match(reason, /blocked/);
  assert.match(reason, /gate/,
    "the reason must say WHY green is not enough here, or the next reader deletes the check on the "
    + "strength of the PR being green.");
});

test("a `session:` label is a HOLD and is refused, naming the holder (#266)", () => {
  const { arm, reason } = sweepDecision(pr({ labels: ["session:worker-capture"] }));
  assert.equal(arm, false);
  assert.match(reason, /session:worker-capture/,
    "naming the holder is the point: `held` sends you to the label list, `held by worker-capture` sends "
    + "you to a session.");
});

test("EVERY `session:` label is named, not just the first — two sessions is a collision worth seeing", () => {
  const { reason } = sweepDecision(pr({ labels: ["session:worker-capture", "session:dispatcher"] }));
  assert.match(reason, /session:worker-capture/);
  assert.match(reason, /session:dispatcher/);
});

test("a label merely CONTAINING the word is not a hold — `blocked-on-fleet` must not read as `blocked`", () => {
  // Substring matching is how a guard comes to refuse the case it was never written for. The `blocked`
  // check is an exact membership test and this pins it as one.
  assert.equal(sweepDecision(pr({ labels: ["blocked-on-fleet"] })).arm, true);
  assert.equal(sweepDecision(pr({ labels: ["not-session:anything"] })).arm, true);
});

test("ZERO check runs is refused, and the reason says STRANDED rather than anything resembling `wait`", () => {
  const { arm, reason } = sweepDecision(pr({ checkRunCount: 0 }));
  assert.equal(arm, false);
  assert.match(reason, /NO CHECK RUNS EXIST/,
    "`merge-guard.mjs`'s own wording, because it is the same finding: a required context that never ran "
    + "is not a failing check, it is the ABSENCE of one, and it reads as CLEAN.");
  assert.match(reason, /STRANDED/,
    "`stranded` and `slow` need opposite responses — a push against patience — so the two must never "
    + "print the same word.");
});

test("ONE check run is enough — the question is whether anything tested it, not whether everything did", () => {
  // `gate` being green for the current head is GitHub's job and branch protection's, not this sweep's.
  // Re-deciding it here would be a second spelling of a fact that already has an authority.
  assert.equal(sweepDecision(pr({ checkRunCount: 1 })).arm, true);
});

test("`blocked` outranks a green, tested, unheld PR — the refusals are checked before the permission", () => {
  assert.equal(sweepDecision({ labels: ["blocked"], checkRunCount: 400 }).arm, false);
});

test("the exit codes are the contract, and CANNOT_ASK is distinct from a clean drain", () => {
  assert.deepEqual(EXIT, { DRAINED: 0, COULD_NOT_ARM: 1, CANNOT_ASK: 2 });
});

test("auto-arm.yml actually RUNS the sweep — a correct predicate wired to nothing is no predicate", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const sweep = doc.jobs.sweep;
  assert.ok(sweep, "auto-arm.yml must have a `sweep` job; without it every already-open PR is invisible "
    + "to the pipeline for ever (#344).");
  const steps = sweep.steps;
  assert.ok(steps.some((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout")),
    "the sweep runs a script from the repo, so it needs a checkout. Without one the step fails with "
    + "MODULE_NOT_FOUND — the #331 shape, where a workflow's own missing prerequisite reads as a code bug.");
  const runner = steps.find((s) => s.run?.includes("auto-arm-sweep.mjs"));
  assert.ok(runner, "no step runs scripts/auto-arm-sweep.mjs.");
  // #416: GH_TOKEN is no longer a static env: mapping -- it is resolved at runtime (A11IGN_BOT_TOKEN if
  // set, else github.token, see auto-arm-token.test.ts) and exported inside the step's own `run:` script.
  // The gh-token-jobs.test.ts finding this pins is unaffected: the sweep still spawns `gh` with SOME
  // token reaching GH_TOKEN before the node process runs, just no longer via a literal YAML value.
  assert.match(runner?.run ?? "", /export GH_TOKEN=/,
    "the sweep spawns `gh`, so the job must resolve and export GH_TOKEN before running the script — the "
    + "gh-token-jobs.test.ts finding, here in the one workflow whose only action is a `gh` call.");
  assert.ok(runner?.env?.FALLBACK_TOKEN, "the fallback token (github.token) must be mapped in for the "
    + "no-secret case -- see auto-arm-token.test.ts for the fallback logic itself.");
  assert.ok(runner?.env?.GITHUB_REPOSITORY,
    "the script exits CANNOT_ASK without GITHUB_REPOSITORY rather than guessing a repo.");
});

test("the sweep is NOT scheduled, which is the property it exists for", () => {
  // GitHub disables scheduled workflows repository-wide after 60 days of inactivity — `board-liveness.
  // test.ts` pins that same reasoning, and `board-schedule-liveness.test.ts` measured `board-report.yml`
  // firing zero scheduled runs the day after it was added. A sweep whose job is to notice a stalled queue
  // must not fail by stopping silently: its symptom would be PRs quietly not merging, which reads as
  // workers being slow.
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as { on: Record<string, unknown> };
  assert.ok(!("schedule" in doc.on),
    "auto-arm.yml must not be scheduled. It rides `pull_request` — the most frequent event in this repo "
    + "— so the queue drains within one PR of any PR, and no cron can be disabled out from under it.");
  assert.ok("workflow_dispatch" in doc.on,
    "a manual kick is the escape hatch for the case the sweep exists for: a quiet repo with a stranded "
    + "PR and no incoming event to ride.");
});

test("ACCEPTANCE (#404): `reopened` is in the trigger's own event types, so the `arm` job sees a "
  + "REOPENED PR directly rather than waiting on the sweep's next unrelated event", () => {
  // Found resuming #232 and #281, both closed at a deadline with branches kept and reopened to finish --
  // neither was armed by `arm`, only eventually by `sweep` on some LATER PR's event. `sweep` bounds the
  // wait, it does not remove it: a reopened PR is the one case a worker must legitimately arm by hand
  // under ceo's no-re-arm ruling, an exception nobody but the person who hit it could know exists.
  // Adding `reopened` removes the exception rather than documenting it.
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    on: { pull_request: { types: string[] } },
  };
  assert.ok(doc.on.pull_request.types.includes("reopened"),
    "auto-arm.yml's pull_request trigger must include `reopened`, or a REOPENED PR is invisible to `arm` "
    + "and only ever picked up by `sweep`, on some later, unrelated PR event.");
  assert.ok(doc.on.pull_request.types.includes("opened") && doc.on.pull_request.types.includes("ready_for_review"),
    "the original two types must still be there -- this adds a case, it does not replace one.");
});

test("ACCEPTANCE (#415): `synchronize` is in the trigger's own event types, so `arm` sees the PUSH that "
  + "fixes a conflict directly, rather than waiting on the sweep's next unrelated PR event", () => {
  // #402's own shape: opened while `mergeable: CONFLICTING`, GitHub dispatches neither `opened` nor
  // `ready_for_review` (it cannot compute a merge commit for either), so both of this trigger's original
  // events are spent before the conflict can even be fixed. Resolving it is a PUSH -- a `synchronize` --
  // and without this type in the list, `arm` never sees it: the one case a worker had to legitimately
  // arm by hand, under `ceo`'s no-re-arm ruling, because nothing here ever would.
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    on: { pull_request: { types: string[] } },
  };
  assert.ok(doc.on.pull_request.types.includes("synchronize"),
    "auto-arm.yml's pull_request trigger must include `synchronize`, or a PR opened while conflicting is "
    + "permanently unarmed by `arm` and only ever reached by `sweep`, on some later, unrelated PR event.");
  assert.ok(doc.on.pull_request.types.includes("opened") && doc.on.pull_request.types.includes("ready_for_review"),
    "the original two types must still be there -- this adds a case, it does not replace one.");
});

test("ACCEPTANCE (#415): the `arm` job's own condition reads fields present on EVERY pull_request event "
  + "type, so adding `synchronize` does not silently change what `arm` decides for `opened`/`ready_for_review`", () => {
  // `github.event.pull_request.draft` and `.base.ref` are payload fields of the PR itself, not of the
  // event type -- present and correctly populated on a `synchronize` payload exactly as on `opened`. If
  // the condition ever grows a field that is event-type-specific (e.g. something only `opened` carries),
  // this is the test that would need to say so.
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { if?: string }>;
  };
  const condition = doc.jobs.arm.if ?? "";
  assert.match(condition, /pull_request\.draft/, "the draft check must still gate `arm`, so a `synchronize` "
    + "on a draft PR does not attempt an armed merge that `gh pr merge --auto` would refuse anyway");
  assert.match(condition, /base\.ref/, "the base-ref check must still gate `arm`, so a `synchronize` on a "
    + "PR against a branch other than main is not armed");
});

test("MUTATION TARGET (#404/#415): removing `reopened` or `synchronize` from the types array must be "
  + "exactly what this test catches -- pinning it against a STRING rather than a parsed array would miss "
  + "a reordering that drops one", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    on: { pull_request: { types: string[] } },
  };
  assert.equal(doc.on.pull_request.types.length, 4,
    "exactly four trigger types (opened, ready_for_review, reopened, synchronize) -- if this grows or "
    + "shrinks without the tests above changing, something was added or removed without being reasoned "
    + "about here");
});
