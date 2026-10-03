// no-token: gh -- reads ci.yml, scripts/verify.mjs and two markdown files and calls pure functions; no `gh` or network is reached
/**
 * #3210: `pnpm run verify` IS CI'S GATE RUN LOCALLY, AND THIS PINS THAT IT STAYS SO.
 *
 * The chairman measured the first-run pass rate at 35% (#928) and read why: authors ran "the affected files" while
 * CI runs the changed files transitively, every tree-wide guard and the whole agent-org suite. `scripts/verify.mjs`
 * is the one command that runs what `gate` waits for. What it must not do is keep a SECOND list of CI's jobs, so the
 * population here is read off `ci.yml`, and every refusal below is over a pure function with the reader injected.
 *
 * POSITIVE CONTROLS, named where each emptiness or absence is asserted: the real `ci.yml` yields a non-empty set that
 * includes `ts` and `guardSweep` (1), the green stamp reads green (3), and `stepsToRun` of a docs-only diff still
 * names `guardSweep` (5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CI_ONLY, HOST_ONLY_AGENT_ORG_TESTS, STEPS, agentOrgStaging, bodyHash, jobsGateNeeds, stampVerdict, stepsToRun, unaccountedJobs,
} from "../../../../scripts/verify.mjs";
import { classify, knownPackages } from "../../../../scripts/ci-changed.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const CI = read(".github/workflows/ci.yml");
const VERIFY = read("scripts/verify.mjs");

// 1. EVERY JOB `gate` NEEDS IS ACCOUNTED FOR.
test("the real ci.yml's gate needs a non-empty set that includes ts and guardSweep (the positive control)", () => {
  const needed = jobsGateNeeds(CI);
  assert.ok(needed.length > 0, "gate's `needs` was not found in ci.yml, so every assertion below would pass on nothing");
  assert.ok(needed.includes("ts") && needed.includes("guardSweep"), `gate needs ${needed.join(", ")}`);
});

test("every job gate needs is a verify step or a CI_ONLY entry with a reason, in the real ci.yml", () => {
  assert.deepEqual(unaccountedJobs(jobsGateNeeds(CI)), []);
});

test("a job added to gate's needs in a copy of ci.yml, and to neither list, is refused", () => {
  const copy = CI.replace(/(\n {2}gate:\n {4}needs: \[[^\]]*)\]/, "$1, newJob]");
  assert.notEqual(copy, CI, "the fixture edit did not apply");
  assert.deepEqual(unaccountedJobs(jobsGateNeeds(copy)), ["newJob"]);
});

test("a CI_ONLY entry with an empty reason does not account for its job", () => {
  assert.deepEqual(unaccountedJobs(["ansible"], STEPS, { ansible: "  " }), ["ansible"]);
});

test("CI_ONLY names only jobs gate needs, and none of them is also a step", () => {
  const needed = new Set(jobsGateNeeds(CI));
  const stepIds = new Set(STEPS.map((step: { id: string }) => step.id));
  for (const job of Object.keys(CI_ONLY)) {
    assert.ok(needed.has(job), `${job} is on CI_ONLY but gate does not need it`);
    assert.ok(!stepIds.has(job), `${job} is both a step and on CI_ONLY`);
  }
  assert.ok(Object.keys(CI_ONLY).length > 0, "the CI-only list is empty, which the row says it must not be");
});

test("every agent-org test verify leaves out is a named test file with a reason that cites its row", () => {
  const left = Object.entries(HOST_ONLY_AGENT_ORG_TESTS) as Array<[string, string]>;
  assert.ok(left.length > 0, "the host-only list is empty; either the omission is gone (delete this test) or the list lost its entry");
  for (const [file, reason] of left) {
    assert.match(file, /\.test\.(ts|mjs)$/);
    assert.ok(reason.trim().length > 0, `${file} is left out with no reason`);
  }
  assert.match(VERIFY, /filed as #\d+/, "the comment on the omission names the row that removes it");
});

// 2. `verify` CALLS THE SELECTOR `ci.yml` CALLS, AND DOES NOT COPY IT.
test("verify imports ci-changed.mjs and reaches select-changed-tests.mjs through test-changed.mjs, as ci.yml does", () => {
  assert.match(VERIFY, /^import \{[^}]*\bclassify\b[^}]*\} from "\.\/ci-changed\.mjs";$/m);
  assert.match(VERIFY, /"scripts\/test-changed\.mjs"/);
  assert.match(read("scripts/test-changed.mjs"), /select-changed-tests\.mjs/);
  assert.match(read(".github/workflows/reusable-build-test.yml"), /node scripts\/select-changed-tests\.mjs/);
});

test("verify defines none of the selection or classification logic it is meant to reuse", () => {
  for (const copied of ["classify", "selectTests", "selectionFor", "discoverTestFiles", "changedPackages", "testFilesToRun"]) {
    assert.doesNotMatch(VERIFY, new RegExp(`function ${copied}\\b`), `verify.mjs defines its own ${copied}`);
  }
});

test("the agentOrg ref and copied files are read from ci.yml, and a ci.yml without them is refused", () => {
  const staged = agentOrgStaging(CI);
  assert.ok(staged && staged.ref === "main" && staged.copied.includes("src"), JSON.stringify(staged));
  assert.equal(agentOrgStaging(CI.replace("AGENT_ORG_REF:", "SOMETHING_ELSE:")), null);
  assert.equal(agentOrgStaging(CI.replace("../packages/agent-org/\n", "../elsewhere/\n")), null);
});

// 3 AND 4. A STAMP IS GREEN ONLY FOR ITS OWN HEAD AND BODY, AND ONLY WHEN EVERY STEP RAN.
const SHA_LENGTH = 40;
const HEAD = "a".repeat(SHA_LENGTH);
const BODY = "Acceptance:\n```bash\ntrue\n```\nCloses: none -- test\n";

function greenStamp() {
  const steps = Object.fromEntries(
    STEPS.map((step: { id: string; runsWhen: string | null }) => [step.id, { status: "pass", ms: 1 }]));
  return { head: HEAD, dirty: false, bodyHash: bodyHash(BODY), steps, wallMs: 1 };
}

test("a stamp for this head and this body, every step passed, reads green (the positive control)", () => {
  assert.deepEqual(stampVerdict({ stamp: greenStamp(), head: HEAD, body: BODY }), { green: true, reasons: [] });
});

test("a stamp for another head reads red", () => {
  const verdict = stampVerdict({ stamp: greenStamp(), head: "b".repeat(SHA_LENGTH), body: BODY });
  assert.equal(verdict.green, false);
  assert.match(verdict.reasons.join("\n"), /head/);
});

test("a stamp whose body hash differs from the body now reads red, and so does a stamp made without a body", () => {
  const edited = stampVerdict({ stamp: greenStamp(), head: HEAD, body: `${BODY}edited` });
  assert.equal(edited.green, false);
  assert.match(edited.reasons.join("\n"), /body/);
  assert.equal(stampVerdict({ stamp: greenStamp(), head: HEAD, body: null }).green, false);
});

test("no stamp, and a stamp made on a dirty tree, read red", () => {
  assert.equal(stampVerdict({ stamp: null, head: HEAD, body: BODY }).green, false);
  assert.equal(stampVerdict({ stamp: { ...greenStamp(), dirty: true }, head: HEAD, body: BODY }).green, false);
});

test("a step that did not run is not green: each step missing from an otherwise green stamp reads red", () => {
  for (const { id } of STEPS) {
    const stamp = greenStamp();
    delete stamp.steps[id];
    const verdict = stampVerdict({ stamp, head: HEAD, body: BODY });
    assert.equal(verdict.green, false, `a stamp without ${id} read green`);
    assert.match(verdict.reasons.join("\n"), new RegExp(`step ${id}: did not run`));
  }
});

test("a failed or skipped step is red, and `not-needed` is green only for a step CI itself may skip", () => {
  for (const status of ["fail", "skipped"]) {
    const stamp = greenStamp();
    stamp.steps.python = { status, ms: 1 };
    assert.equal(stampVerdict({ stamp, head: HEAD, body: BODY }).green, false, status);
  }
  const skippable = greenStamp();
  skippable.steps.python = { status: "not-needed", ms: 0 };
  assert.equal(stampVerdict({ stamp: skippable, head: HEAD, body: BODY }).green, true);
  const never = greenStamp();
  never.steps.guardSweep = { status: "not-needed", ms: 0 };
  assert.equal(stampVerdict({ stamp: never, head: HEAD, body: BODY }).green, false,
    "guardSweep reading not-needed is a step that never ran");
});

// 5. A BARE DIFF OF A DOCS FILE STILL RUNS THE TREE-WIDE GUARDS (#2348).
test("a diff of one docs file still runs the tree-wide guards, the agent-org suite and the body checks", () => {
  const root = new URL(".", ROOT).pathname;
  const classification = classify(["docs/backlog.md"], knownPackages(root), {}, { repoRoot: root });
  const run = new Map(stepsToRun(classification).map((step: { id: string; run: boolean }) => [step.id, step.run]));
  for (const always of ["guardSweep", "agentOrg", "acceptance", "ownedPaths"]) {
    assert.equal(run.get(always), true, `${always} did not run for a docs-only diff`);
  }
  assert.equal(run.get("python"), false, "python ran for a docs-only diff, so the selection is not CI's");
});

test("ci.yml's guardSweep job is not conditioned on `changed`'s outputs, which is what verify mirrors", () => {
  const block = CI.split("\n  guardSweep:\n")[1]?.split(/\n {2}[A-Za-z]+:\n/)[0] ?? "";
  assert.ok(block.length > 0, "guardSweep was not found in ci.yml");
  assert.doesNotMatch(block, /needs\.changed\.outputs/);
});

// 4 OF THE DONE-WHEN: THE SENTENCE IS IN BOTH FILES, AND THE BRIEF DOES NOT QUOTE THE STAMP'S FIELDS.
test("CONTRIBUTING.md and the engineer brief say a PR is ready only when verify is green", () => {
  for (const file of ["CONTRIBUTING.md", ".agent-org/roles/engineer.md"]) {
    const text = read(file);
    assert.match(text, /ready only when `pnpm run verify` is green/, `${file} does not say it`);
    assert.match(text, /a partial local run is not "passing"/, `${file} does not say a partial run is not passing`);
  }
});

test("the engineer brief quotes no second copy of the stamp's fields", () => {
  const brief = read(".agent-org/roles/engineer.md");
  for (const field of ["bodyHash", "verify-stamp", "wallMs", "dirty"]) {
    assert.ok(!brief.includes(field), `the brief names the stamp field ${field}`);
  }
});
