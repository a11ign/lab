// no-token: gh -- reads ci.yml, scripts/verify.mjs and two markdown files and calls pure functions; no `gh` or network is reached
/**
 * #3210: `pnpm run verify` IS CI'S GATE RUN LOCALLY, AND THIS PINS THAT IT STAYS SO.
 *
 * The chairman measured the first-run pass rate at 35% (#928) and read why: authors ran "the affected files" while
 * CI runs the changed files transitively, and every tree-wide guard. `scripts/verify.mjs`
 * is the one command that runs what `gate` waits for. What it must not do is keep a SECOND list of CI's jobs, so the
 * population here is read off `ci.yml`, and every refusal below is over a pure function with the reader injected.
 *
 * POSITIVE CONTROLS, named where each emptiness or absence is asserted: the real `ci.yml` yields a non-empty set that
 * includes `ts` and `guardSweep` (1), the green stamp reads green (3), and `stepsToRun` of a docs-only diff still
 * names the body checks (5). `guardSweep` is a CI-only job since #3572 (`verify-affected-set.test.ts`). The `agentOrg` job and its mirror step were deleted
 * by #3885, so no test here stages another repository's tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CI_ONLY, agentOrgSource, STEPS, bodyHash, jobsGateNeeds, linkNodeModules, makeScratch, removeScratch, runTs, shAsync, stampVerdict, stepsToRun, unaccountedJobs,
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

// A NORMAL CHECKOUT HAS NO SIBLING GIT CHECKOUT OF THE TOOL, AND THE STEP MUST NOT DEPEND ON ONE (review of #3342).
const source = (env: Record<string, string>, present: string[]) =>
  agentOrgSource({ env, sibling: "/w/agent-org", cache: "/w/.git/verify-agent-org", isCheckout: (dir) => present.includes(dir) });

test("agentOrgSource: the env var wins, then a sibling checkout, then a clone in the git dir, made only when absent", () => {
  assert.deepEqual(source({ A11Y_AGENT_ORG_REPO: "/x" }, ["/w/agent-org"]), { dir: "/x", clone: false });
  assert.deepEqual(source({}, ["/w/agent-org"]), { dir: "/w/agent-org", clone: false });
  assert.deepEqual(source({}, []), { dir: "/w/.git/verify-agent-org", clone: true }, "no checkout to hand must clone, not fail");
  assert.deepEqual(source({}, ["/w/.git/verify-agent-org"]), { dir: "/w/.git/verify-agent-org", clone: false });
});

test("an explicit A11Y_AGENT_ORG_REPO that is not a checkout is never replaced by a clone", () => {
  assert.equal(source({ A11Y_AGENT_ORG_REPO: "/nope" }, []).clone, false);
});

test("CONTRIBUTING.md documents where the agent-org step finds the tool, including the clone", () => {
  const text = read("CONTRIBUTING.md");
  assert.match(text, /A11Y_AGENT_ORG_REPO/);
  assert.match(text, /clones `a11ign\/agent-org` once/);
});

test("linkNodeModules links each entry to where the source gets it, and @a11ign/* with the same relative targets", () => {
  const dir = makeScratch("verify-link-");
  try {
    for (const file of ["from/plain/index.js", "elsewhere/pkg/index.js"]) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "");
    }
    symlinkSync(join(dir, "elsewhere/pkg"), join(dir, "from/linked"));
    mkdirSync(join(dir, "from/@a11ign"));
    symlinkSync("../../packages/lab", join(dir, "from/@a11ign/lab"));
    linkNodeModules({ from: join(dir, "from"), to: join(dir, "clone/node_modules") });
    assert.equal(realpathSync(join(dir, "clone/node_modules/plain")), realpathSync(join(dir, "from/plain")));
    assert.equal(realpathSync(join(dir, "clone/node_modules/linked")), realpathSync(join(dir, "elsewhere/pkg")));
    assert.equal(readlinkSync(join(dir, "clone/node_modules/@a11ign/lab")), "../../packages/lab",
      "a workspace link must stay relative, so the clone's resolves to the clone's own packages/");
  } finally {
    removeScratch(dir);
  }
});

const TICK_MS = 20;
const CHILD_MS = 400;
const FREE_LOOP_TICKS = 5;
const TS_COMMANDS = 4;

test("shAsync leaves the event loop free while its child runs, which a spawnSync does not (#3333)", async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, TICK_MS);
  try {
    const { status } = await shAsync("node", ["-e", `setTimeout(() => {}, ${CHILD_MS})`], { cwd: tmpdir(), stdio: "ignore" });
    assert.equal(status, 0, "the positive control: the child ran and exited 0");
    assert.ok(ticks >= FREE_LOOP_TICKS, `only ${ticks} timer ticks ran during a ${CHILD_MS}ms child: the loop was blocked`);
  } finally {
    clearInterval(timer);
  }
});

test("`ts` runs every command through the non-blocking runner, in order, and stops at the first that fails (#3333)", async () => {
  const seen: string[] = [];
  const run = (failing: string | null) => async (command: string, args: string[]) => {
    seen.push([command, ...args].join(" "));
    return { status: seen.at(-1)?.includes(failing ?? "\0") ? 1 : 0 };
  };
  const ranFiles = () => ({ testFiles: 1, tests: 1, failedFiles: 0, failedTests: 0 });
  // #3574: the default reads THIS worktree's newest run record, so a red run just before would add a first leg to the four commands.
  const noRecord = () => ({ name: null, files: [], dropped: [] });
  assert.equal(await runTs({ base: "origin/main" }, run(null), ranFiles, noRecord), "pass");
  assert.equal(seen.length, TS_COMMANDS, "the positive control: all four commands were handed to the runner");
  assert.match(seen.at(-1) ?? "", / rstest run .*--changed=origin\/main$/);
  seen.length = 0;
  assert.equal(await runTs({ base: "origin/main" }, run("lint"), ranFiles, noRecord), "fail");
  assert.equal(seen.length, 2, "docs:coverage and lint ran, and typecheck did not run after lint failed");
});

// 2. `verify` CALLS THE SELECTOR `ci.yml` CALLS, AND DOES NOT COPY IT.
// The tests the `ts` step runs are rstest's own `--changed` selection since #3572, pinned in `verify-affected-set.test.ts`.
test("verify imports ci-changed.mjs's classify, as ci.yml does, and no longer reaches the hand-built selector", () => {
  assert.match(VERIFY, /^import \{[^}]*\bclassify\b[^}]*\} from "\.\/ci-changed\.mjs";$/m);
  assert.doesNotMatch(VERIFY, /"scripts\/test-changed\.mjs"/);
});

test("verify defines none of the selection or classification logic it is meant to reuse", () => {
  for (const copied of ["classify", "selectTests", "selectionFor", "discoverTestFiles", "changedPackages", "testFilesToRun"]) {
    assert.doesNotMatch(VERIFY, new RegExp(`function ${copied}\\b`), `verify.mjs defines its own ${copied}`);
  }
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
  never.steps.acceptance = { status: "not-needed", ms: 0 };
  assert.equal(stampVerdict({ stamp: never, head: HEAD, body: BODY }).green, false,
    "acceptance reading not-needed is a step that never ran");
});

// 5. A BARE DIFF OF A DOCS FILE STILL RUNS THE BODY CHECKS (#2348); THE TREE-WIDE GUARDS LEFT IN #3572.
test("a diff of one docs file still runs the body checks", () => {
  const root = new URL(".", ROOT).pathname;
  const classification = classify(["docs/backlog.md"], knownPackages(root), { repoRoot: root });
  const run = new Map(stepsToRun(classification).map((step: { id: string; run: boolean }) => [step.id, step.run]));
  for (const always of ["acceptance", "ownedPaths"]) {
    assert.equal(run.get(always), true, `${always} did not run for a docs-only diff`);
  }
  assert.equal(run.get("python"), false, "python ran for a docs-only diff, so the selection is not CI's");
});

test("ci.yml's guardSweep job is not conditioned on `changed`'s outputs, which is why it is CI-only rather than a skippable step", () => {
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

// #2348: A DOCS-ONLY PR STILL REACHES THE TREE-WIDE GUARDS. #2329 merged with `ts` SKIPPED and turned `main` red, because a guard
// whose population is `docs/` first ran in trunk-guard. ceo's ruling is to run the sweep on every PR rather than select guards by
// the paths each reads (a path-to-guard table is a second list that drifts), so the property pinned here is that the sweep job is NOT
// conditional on any diff classification. These four lived in `select-changed-tests.test.ts` and moved when it was deleted (#3573):
// they pin `ci.yml`, not the selector.
const REPO_ROOT = fileURLToPath(ROOT).replace(/\/$/, "");

/** A job's own block in `ci.yml` text, from its key to the next job at the same indent (or EOF). */
function jobBlockOf(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `ci.yml has no \`${name}\` job`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Does the job carry an `if:` reading `needs.changed.outputs.*`, i.e. is it selected by what the diff touched? */
function selectedByTheDiff(block: string): boolean {
  return /\n {4}if: .*needs\.changed\.outputs\./.test(block);
}

test("#2357: a docs-only diff now SELECTS `ts` (a test reads docs), yet #2348's sweep stays unselected by the diff", () => {
  // #2348 pinned the opposite premise -- a docs-only diff skips `ts` -- to justify the unconditional sweep. #2357 moved it: `ts` now runs
  // for a docs diff when a test reads docs. The sweep keeps its own reason (a path-to-guard table is a second list that drifts), pinned
  // by the two tests below, so it is NOT made conditional on this.
  const result = classify(["docs/known-gaps.md"], knownPackages(REPO_ROOT));
  assert.equal(result.ts, true, "a docs-only diff skips `ts` again, which is #2329 -- re-read #2357");
});

test("#2348: the guard sweep job runs `pnpm run guards:sweep` and is not selected by the diff", () => {
  const block = jobBlockOf(CI, "guardSweep");
  assert.match(block, /run: pnpm run guards:sweep\n/, "the job no longer runs the sweep");
  assert.equal(selectedByTheDiff(block), false,
    "guardSweep is conditional on needs.changed.outputs.* -- a docs-only PR would skip it, which is #2329");
});

test("#2348 CONTROL: the detector fires on a sweep made conditional on `ts`, and on the real `ts` job", () => {
  const conditional = jobBlockOf(CI, "guardSweep")
    .replace("    needs: changed\n", "    needs: changed\n    if: needs.changed.outputs.ts == 'true'\n");
  assert.equal(selectedByTheDiff(conditional), true, "the mutation did not change the block, so the detector proves nothing");
  assert.equal(selectedByTheDiff(jobBlockOf(CI, "ts")), true, "`ts` is the job a docs-only diff skips; the detector must see it");
});

test("#2348: `gate` waits for the sweep and reads its result", () => {
  const gate = jobBlockOf(CI, "gate");
  assert.match(gate, /needs: \[[^\]]*\bguardSweep\b/, "gate does not need guardSweep, so a red sweep would not block a merge");
  assert.ok(gate.includes("needs.guardSweep.result"), "gate names guardSweep in `needs` but never reads its result");
});

