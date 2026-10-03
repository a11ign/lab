/**
 * #3276: THE `agentOrg` JOB GIVES THE TOOL'S GATE THE FULL-HISTORY CHECKOUT IT RATCHETS AGAINST.
 *
 * agent-org#111 (#3245) made the tool's pin-ratchet read a base from `AGENT_ORG_TOOL_REPO`, and made a strict reading in
 * `GITHUB_ACTIONS` a test failure. This project lays the tool out inside its own tree, so `git` finds the PROJECT's
 * repository there, not the tool's; the variable must therefore name a separate, full-history clone of the tool. Measured
 * on #3156's run 37129844926: `AGENT_ORG_TOOL_REPO=(unset)`, 1 of 4802 failed, and `gate` went red with it on every pull
 * request from then on.
 *
 * Three facts make the variable mean something, and dropping any one reds the suite again: the clone has HISTORY (a
 * shallow one has no base), it SURVIVES the layout step (the old `rm -rf agent-org` deleted it), and it lives OUTSIDE the
 * workspace (naming the project's own checkout was measured to fail: the project holds no `src` at its base).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, string | number> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const ciText = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const parsed = (text: string): Workflow => parseYaml(text) as Workflow;

const TOOL_CLONE_PATH = /^"?\$RUNNER_TEMP\/[\w.-]+"?$/;

/** Every way the `agentOrg` job can fail to hand the tool a base; empty means it hands one. */
function refusals(ci: Workflow): string[] {
  const steps = ci.jobs.agentOrg?.steps ?? [];
  const checkout = steps.find((s) => s.with?.repository === "a11ign/agent-org");
  const layout = steps.find((s) => s.run?.includes("cp -r src host"));
  if (!checkout || !layout?.run) return ["the job no longer checks out a11ign/agent-org and lays it out; this pin has lost its subject"];
  const found: string[] = [];
  if (String(checkout.with?.["fetch-depth"]) !== "0") found.push("the tool is checked out shallow, so it has no base to ratchet against");
  if (/^\s*rm -rf agent-org\s*$/m.test(layout.run)) found.push("the tool's clone is deleted after the layout, leaving AGENT_ORG_TOOL_REPO nothing to name");
  const exported = /echo "AGENT_ORG_TOOL_REPO=(\S+)" >> "\$GITHUB_ENV"/.exec(layout.run)?.[1];
  if (!exported) return [...found, "AGENT_ORG_TOOL_REPO is never exported to the suite step"];
  if (!TOOL_CLONE_PATH.test(exported)) found.push(`AGENT_ORG_TOOL_REPO names ${exported}, which is not a clone kept under $RUNNER_TEMP, outside the workspace`);
  const target = exported.replace(/[$.]/g, "\\$&");
  const moved = new RegExp(`^\\s*mv agent-org "?${target}"?\\s*$`, "m").test(layout.run);
  if (!moved) found.push(`nothing moves the tool's clone to ${exported}, so the variable names a directory that does not exist`);
  return found;
}

test("#3276: the agentOrg job keeps a full-history clone of the tool outside the workspace and exports where it is", () => {
  assert.deepEqual(refusals(parsed(ciText)), []);
});

test("POSITIVE CONTROL (#3276): dropping any one of the three facts is refused, by name", () => {
  const mutations: [string, string, RegExp][] = [
    ["shallow", ciText.replace("fetch-depth: 0\n      - name: Put the tool", "fetch-depth: 1\n      - name: Put the tool"), /shallow/],
    ["deleted", ciText.replace(/mv agent-org "\$RUNNER_TEMP\/agent-org-checkout"/, "rm -rf agent-org"), /deleted|does not exist/],
    ["inside the workspace", ciText.replaceAll("$RUNNER_TEMP/agent-org-checkout", "$GITHUB_WORKSPACE/agent-org"), /outside the workspace/],
    ["unexported", ciText.replace(/.*AGENT_ORG_TOOL_REPO=.*\n/, ""), /never exported/],
  ];
  for (const [label, text, expected] of mutations) {
    assert.notEqual(text, ciText, `${label}: the mutation changed nothing, so it proves nothing`);
    assert.match(refusals(parsed(text)).join("; "), expected, label);
  }
});
