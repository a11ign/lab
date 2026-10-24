import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseYaml } from "yaml";
import { workflowCode } from "./workflow-code.ts";

/**
 * A11-180: `auto-arm.yml` ARMS WITH NO DECLARATION. It refused a pull request whose `checks (cross-repo)` leg newly failed unless its body named an open row
 * (`Cross-repo-red:`, a11ign/a11ign#5188). That leg was `continue-on-error`, so `gate` could not see it; the leg is gone with the tests it ran, a red test is now a red
 * `gate`, and a body has nothing to clear. Without the leg the refusal read `pending` for ever and left every pull request unarmed, so it went too. What the file still does
 * (the arming sweep, the approving review, the `hold:` filter) is the keeper here: the workflow was kept because ticket mode still arms lab pull requests through it (lab#141).
 */
const code = workflowCode("auto-arm.yml");
type Workflow = { on: { pull_request_target: { types: string[] } }; jobs: Record<string, { steps?: Array<{ run?: string }> }> };
const workflow = parseYaml(code) as Workflow;
const runLines = (job: string) => (workflow.jobs[job].steps ?? []).map((step) => step.run ?? "").join("\n");

test("no cross-repo refusal is left: no library, no deadline, no `Cross-repo-red:` exit, no leg named", () => {
  assert.doesNotMatch(code, /CROSS_REPO|cross_repo|Cross-repo-red|cross-repo-red|checks \(cross-repo\)/);
});

test("a body edit no longer asks again: `edited` is not a trigger, and the others are", () => {
  assert.deepEqual(workflow.on.pull_request_target.types, ["opened", "ready_for_review", "reopened", "synchronize"]);
});

test("positive control: the jobs that arm are still here, and both arm with auto-merge (the keeper of this change)", () => {
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["arm", "arm-approved", "relay"]);
  assert.match(runLines("arm"), /pr merge --auto --merge "\$n"/);
  assert.match(runLines("arm"), /-f \.github\/auto-arm\.jq/, "the sweep still selects through the committed filter");
  assert.match(runLines("arm-approved"), /pr merge --auto --merge "\$PULL_REQUEST"/);
});
