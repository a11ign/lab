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
 * names the agent-org suite (5). `guardSweep` is a CI-only job since #3572 (`verify-affected-set.test.ts`). The staged agent-org copy is listed with two test files in the throwaway tool, so an empty
 * listing cannot pass (6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CI_ONLY, agentOrgLayout, ciLikeHome, agentOrgSource, stageAgentOrg, STEPS, agentOrgStaging, bodyHash, jobsGateNeeds, linkNodeModules,
  pinTool, runAgentOrgInClone, runTs, shAsync, stampVerdict, stepsToRun, unaccountedJobs,
} from "../../../../scripts/verify.mjs";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
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

// THE STAGED COPY IS READ, NOT THE SOURCE OF verify.mjs (#3329, review of #3350): a grep for two old names passes when
// the test goes missing under any other, so this stages a throwaway tool and a throwaway tree and lists what arrived.
function stageThrowawayTool(toolFiles: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "verify-stage-"));
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", env: sandboxGitEnv() });
  const tool = join(dir, "tool");
  const root = join(dir, "root");
  for (const [file, text] of Object.entries(toolFiles)) {
    mkdirSync(dirname(join(tool, file)), { recursive: true });
    writeFileSync(join(tool, file), text);
  }
  const helpers = join(root, "packages/lab/src/packaging");
  mkdirSync(helpers, { recursive: true });
  writeFileSync(join(helpers, "board-document-chrome-resolver.test.ts"), 'import "agent-org/src/board-document.mjs";\n');
  writeFileSync(join(helpers, "helper.mjs"), "export {};\n");
  run(tool, "init", "-q");
  run(tool, "add", ".");
  run(tool, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "tool");
  run(tool, "fetch", "-q", ".", "HEAD");
  run(root, "init", "-q");
  const scratch = join(dir, "scratch");
  mkdirSync(scratch);
  const { status } = stageAgentOrg({ toolRepo: tool, scratch, copied: ["src"], root });
  return { dir, status, staged: join(root, "packages/agent-org/src/packaging") };
}

test("the staged agent-org copy holds every test file the tool has, live-tree-independence included (#3329)", () => {
  const tests = ["live-tree-independence.test.ts", "acceptance-commands.test.ts"].map((name) => `src/packaging/${name}`);
  const { dir, status, staged } = stageThrowawayTool(Object.fromEntries(tests.map((file) => [file, "// test\n"])));
  try {
    assert.equal(status, 0, "staging the throwaway tool failed, so the listing below would prove nothing");
    assert.deepEqual(readdirSync(staged).filter((name) => name.endsWith(".test.ts")).sort(),
      ["acceptance-commands.test.ts", "live-tree-independence.test.ts"]);
    assert.ok(existsSync(join(staged, "helper.mjs")), "the lab's packaging helpers were not laid beside the tool's");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// THE `agentOrg` STEP RUNS BESIDE `ts`, SO IT MUST WRITE NOTHING UNDER THE AUTHOR'S TREE (#3333).
// Staged in place it laid the tool at `packages/agent-org` and edited a fixture there, which the tree-walking guards in `ts` read.
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: sandboxGitEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }), encoding: "utf8" }).trim();

function writeAll(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const LAYOUT_PATHS = 3;

test("agentOrgLayout puts every path the step writes under the scratch directory, and none under the author's tree", () => {
  const repo = realpathSync(new URL(".", ROOT).pathname);
  const scratch = join(tmpdir(), "verify-agent-org-layout");
  const paths = Object.values(agentOrgLayout(scratch)) as string[];
  assert.equal(paths.length, LAYOUT_PATHS, "the positive control: the layout names the clone, the tool's directory and the fixture");
  for (const path of paths) {
    assert.ok(path.startsWith(`${scratch}/`), `${path} is not under the scratch directory`);
    assert.ok(!path.startsWith(`${repo}/`), `${path} is under the author's tree`);
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

test("the tool is archived at the commit the fetch pinned, though another fetch has since rewritten FETCH_HEAD (#3333)", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-pin-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe", env: sandboxGitEnv() });
  try {
    const origin = join(dir, "origin");
    mkdirSync(origin);
    git(origin, "init", "-q", "-b", "main");
    writeAll(origin, { "src/current.test.ts": "" });
    git(origin, "add", "."); git(origin, "commit", "-qm", "main");
    git(origin, "checkout", "-q", "-b", "agent/old");
    rmSync(join(origin, "src/current.test.ts"));
    writeAll(origin, { "src/deleted-since.test.ts": "" });
    git(origin, "add", "-A"); git(origin, "commit", "-qm", "old");
    git(origin, "checkout", "-q", "main");
    const tool = join(dir, "tool");
    git(dir, "clone", "-q", origin, tool);
    const log = openSync(join(dir, "pin.log"), "w");
    const pinned = pinTool({ toolRepo: tool, ref: "main", log });
    git(tool, "fetch", "-q", "origin", "agent/old"); // what another session's fetch does to the shared checkout
    const staged = (commit: string | undefined) => {
      const root = join(dir, `root-${commit ? "pinned" : "head"}`);
      mkdirSync(join(root, "packages/lab/src/packaging"), { recursive: true });
      writeFileSync(join(root, "packages/lab/src/packaging/board-document-chrome-resolver.test.ts"), "");
      git(root, "init", "-q");
      assert.equal(stageAgentOrg({ toolRepo: tool, scratch: dir, copied: ["src"], root, stdio: "ignore", ...(commit ? { commit } : {}) }).status, 0);
      return readdirSync(join(root, "packages/agent-org/src")).filter((name) => name !== "packaging").sort(); // `packaging` is the lab's helpers laid beside
    };
    assert.deepEqual(staged(undefined), ["deleted-since.test.ts"], "the control: FETCH_HEAD alone WAS the other fetch's, so the clobber is real here");
    assert.deepEqual(staged(pinned.commit), ["current.test.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("linkNodeModules links each entry to where the source gets it, and @a11ign/* with the same relative targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-link-"));
  try {
    writeAll(dir, { "from/plain/index.js": "", "elsewhere/pkg/index.js": "" });
    symlinkSync(join(dir, "elsewhere/pkg"), join(dir, "from/linked"));
    mkdirSync(join(dir, "from/@a11ign"));
    symlinkSync("../../packages/lab", join(dir, "from/@a11ign/lab"));
    linkNodeModules({ from: join(dir, "from"), to: join(dir, "clone/node_modules") });
    assert.equal(realpathSync(join(dir, "clone/node_modules/plain")), realpathSync(join(dir, "from/plain")));
    assert.equal(realpathSync(join(dir, "clone/node_modules/linked")), realpathSync(join(dir, "elsewhere/pkg")));
    assert.equal(readlinkSync(join(dir, "clone/node_modules/@a11ign/lab")), "../../packages/lab",
      "a workspace link must stay relative, so the clone's resolves to the clone's own packages/");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the agentOrg suite runs in a clone of the head: the author's tree is clean DURING the run and after it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-clone-test-"));
  const [author, origin, tool, scratch] = ["author", "origin", "tool", "scratch"].map((name) => join(dir, name));
  const fixture = "packages/lab/src/packaging/board-document-chrome-resolver.test.ts";
  try {
    mkdirSync(author); mkdirSync(origin); mkdirSync(scratch);
    writeAll(author, { [fixture]: 'import "agent-org/src/board-document.mjs";\n', "packages/lab/src/packaging/sibling.mjs": "" });
    git(author, "init", "-q", "-b", "main"); git(author, "add", "."); git(author, "commit", "-q", "-m", "author");
    // The author's node_modules: the real one, which `tsx` is found through. Ignored, as in the real repository.
    symlinkSync(realpathSync(new URL("node_modules", ROOT).pathname), join(author, "node_modules"));
    writeFileSync(join(author, ".gitignore"), "node_modules\n");
    git(author, "add", ".gitignore"); git(author, "commit", "-q", "-m", "ignore");
    // The tool's one test reports, from INSIDE the suite, where it ran and whether the author's tree was clean then.
    const report = join(dir, "report.json");
    writeAll(origin, {
      "src/probe.test.mjs": `import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
test("probe", () => writeFileSync(${JSON.stringify(report)}, JSON.stringify({ cwd: process.cwd(),
  authorStatus: execFileSync("git", ["status", "--porcelain"], { cwd: ${JSON.stringify(author)}, encoding: "utf8" }) })));\n`,
      "host/h": "", ".github/g": "", "CHANGELOG.md": "", "package.json": "{}", LICENSE: "", "README.md": "",
    });
    git(origin, "init", "-q", "-b", "main"); git(origin, "add", "."); git(origin, "commit", "-q", "-m", "tool");
    git(dir, "clone", "-q", origin, tool);
    const log = openSync(join(dir, "run.log"), "w");
    let status: string;
    // Run directly under `node --test`, the suite inside would inherit this marker and refuse to start ("run() called recursively").
    const marker = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    try {
      status = await runAgentOrgInClone({ repo: author, toolRepo: tool, ref: "main", copied: ["src", "host", ".github", "CHANGELOG.md", "package.json", "LICENSE", "README.md"], scratch, log });
    } finally {
      closeSync(log);
      if (marker !== undefined) process.env.NODE_TEST_CONTEXT = marker;
    }
    assert.equal(status, "pass", readFileSync(join(dir, "run.log"), "utf8"));
    const seen = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(realpathSync(seen.cwd.replace(/\/tree$/, "")) + "/tree", `${realpathSync(scratch)}/tree`, "the suite ran somewhere other than the clone");
    assert.equal(seen.authorStatus, "", "the author's tree had a change while the suite ran");
    assert.equal(git(author, "status", "--porcelain"), "");
    assert.ok(!existsSync(join(author, "packages/agent-org")), "the tool was staged under the author's packages/");
    assert.equal(readFileSync(join(author, fixture), "utf8"), 'import "agent-org/src/board-document.mjs";\n', "the fixture was edited in place");
    assert.ok(!existsSync(agentOrgLayout(scratch).clone), "the clone was left behind");
    assert.equal(git(author, "worktree", "list").split("\n").length, 1, "the clone's worktree entry was left behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  never.steps.agentOrg = { status: "not-needed", ms: 0 };
  assert.equal(stampVerdict({ stamp: never, head: HEAD, body: BODY }).green, false,
    "agentOrg reading not-needed is a step that never ran");
});

// 5. A BARE DIFF OF A DOCS FILE STILL RUNS THE AGENT-ORG SUITE AND THE BODY CHECKS (#2348); THE TREE-WIDE GUARDS LEFT IN #3572.
test("a diff of one docs file still runs the agent-org suite and the body checks", () => {
  const root = new URL(".", ROOT).pathname;
  const classification = classify(["docs/backlog.md"], knownPackages(root), {}, { repoRoot: root });
  const run = new Map(stepsToRun(classification).map((step: { id: string; run: boolean }) => [step.id, step.run]));
  for (const always of ["agentOrg", "acceptance", "ownedPaths"]) {
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

// #3368: THE TOOL'S SUITE READS `~/.claude/projects`, WHICH A CI RUNNER DOES NOT HAVE AND THIS HOST HAS 3 GB OF.
test("ciLikeHome links everything of the real home except the transcripts, so no test finds a different machine", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-like-home-"));
  try {
    const home = join(dir, "home");
    mkdirSync(join(home, ".claude/projects"), { recursive: true });
    writeFileSync(join(home, ".claude/projects/session.jsonl"), "{}\n");
    writeFileSync(join(home, ".claude/settings.json"), "{}");
    mkdirSync(join(home, ".cache/node"), { recursive: true });
    writeFileSync(join(home, ".gitconfig"), "[user]\n");
    const into = ciLikeHome({ home, into: join(dir, "into") });
    assert.deepEqual(readdirSync(join(into, ".claude")), ["settings.json"], "the transcripts are not visible, the rest of ~/.claude is");
    assert.deepEqual(readdirSync(into).sort(), [".cache", ".claude", ".gitconfig"], "every other entry of the home is there");
    assert.equal(readFileSync(join(into, ".gitconfig"), "utf8"), "[user]\n", "and reads as the real one does");
    assert.ok(existsSync(join(into, ".cache/node")), "a directory entry resolves through its link");
    assert.ok(existsSync(join(home, ".claude/projects/session.jsonl")), "the real transcripts are untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ciLikeHome of a home with no ~/.claude is a home with no ~/.claude/projects, not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-like-home-"));
  try {
    mkdirSync(join(dir, "home"));
    writeFileSync(join(dir, "home/.bashrc"), "");
    const into = ciLikeHome({ home: join(dir, "home"), into: join(dir, "into") });
    assert.deepEqual(readdirSync(into).sort(), [".bashrc", ".claude"]);
    assert.deepEqual(readdirSync(join(into, ".claude")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the agentOrg suite is run with the transcript-free home, and a command's env reaches the child", async () => {
  const source = read("scripts/verify.mjs");
  assert.match(source, /shAsync\("node", \["--import", "tsx", "--test"[^\n]*\n[^\n]*\{ \.\.\.at\(clone\), env: \{ HOME: ciLikeHome\(/, "the suite's command no longer gets the home");
  const dir = mkdtempSync(join(tmpdir(), "sh-env-"));
  try {
    const out = join(dir, "out");
    const log = openSync(out, "w");
    const { status } = await shAsync(process.execPath, ["-p", "process.env.HOME"], { cwd: dir, stdio: ["ignore", log, "ignore"], env: { HOME: "/x/y" } });
    closeSync(log);
    assert.equal(status, 0);
    assert.equal(readFileSync(out, "utf8").trim(), "/x/y");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
