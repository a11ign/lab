// no-token: gh -- nothing here spawns `gh`: the pull-request step runs against a stub `gh` on PATH, and the rest only READS the YAML,
// naming GH_TOKEN as a string to check which credential the create step is given.
/**
 * #3450 — A11IGN'S `agent-org` PIN FOLLOWS EACH RELEASE BY ITSELF, AND NEVER MERGES ITS OWN PULL REQUEST.
 *
 * `.github/workflows/agent-org-bump.yml` reads the newest release tag of `a11ign/agent-org` inside the range
 * `package.json` declares and, when the lockfile does not already resolve it, opens or updates ONE `deps:` pull
 * request moving the lockfile alone. Two halves are pinned here:
 *
 *   1. THE TEXT (`violations()`): the triggers, the token the pull request is created with, the one fixed branch and the
 *      `deps:` title, and the words that would mean the workflow approves, queues or exempts itself.
 *   2. THE SCRIPTS IT CARRIES, RUN: the selection with the tag list and the lockfile injected, the lockfile-only move
 *      against a stub `pnpm`, and the open-or-update step against a real bare remote and a stub `gh`.
 *
 * `violations()` is run on the real file AND on fixtures that each break one property, because a checker that has never
 * said no is not known to be able to. The emptiness of the forbidden-words list is read against the workflow containing
 * `gh pr create` (the control that the scan sees the create step at all).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const WORKFLOW = join(REPO, ".github/workflows/agent-org-bump.yml");
const BRANCH = "deps/agent-org";
const EXECUTABLE = 0o755;
const SHA_LENGTH = 40;

interface Step { name?: string; id?: string; uses?: string; run?: string; env?: Record<string, string>; if?: string }
interface Workflow { on?: Record<string, unknown>; env?: Record<string, string>; jobs?: Record<string, { steps?: Step[] }> }

const text = () => readFileSync(WORKFLOW, "utf8");
const parse = (source: string) => parseYaml(source) as Workflow;
const stepsOf = (workflow: Workflow): Step[] => Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
const stepNamed = (prefix: string): Step => {
  const found = stepsOf(parse(text())).find((step) => step.name?.startsWith(prefix));
  assert.ok(found, `no step named "${prefix}..."`);
  return found;
};

/** Words that would mean the workflow approves, queues a merge, or exempts itself from the review `main` requires. */
const FORBIDDEN = ["--admin", "gh pr review --approve", "gh pr merge", "bypass", "auto-merge", "enable-auto-merge"];

const hasStep = (workflow: Workflow, needle: string) => stepsOf(workflow).find((step) => step.run?.includes(needle));

function triggerViolations(workflow: Workflow): string[] {
  const triggers = Object.keys(workflow.on ?? {}).sort();
  return JSON.stringify(triggers) === JSON.stringify(["schedule", "workflow_dispatch"]) ? [] : [`triggers are [${triggers}], not exactly schedule and workflow_dispatch`];
}

/** The create step is the one write that must carry the bot token, and the file may not name the default token at all. */
function tokenViolations(workflow: Workflow, source: string): string[] {
  const create = hasStep(workflow, "gh pr create");
  const found: string[] = [];
  if (!create) found.push("no step runs `gh pr create`");
  else if (!/secrets\.A11IGN_BOT_TOKEN/.test(create.env?.GH_TOKEN ?? "")) found.push("the create step's GH_TOKEN is not A11IGN_BOT_TOKEN");
  if (/GITHUB_TOKEN|github\.token/.test(source)) found.push("the file names the default workflow token");
  return found;
}

/** One fixed branch, so a second run updates the open pull request, and a `deps:` title, the handle the gate knows it by. */
function shapeViolations(workflow: Workflow): string[] {
  const create = hasStep(workflow, "gh pr create");
  const found: string[] = [];
  if (workflow.env?.BRANCH !== BRANCH) found.push(`BRANCH is ${workflow.env?.BRANCH}, not the one fixed name ${BRANCH}`);
  if (!create?.run?.includes('--head "$BRANCH"')) found.push("the pull request is not created from $BRANCH");
  if (!create?.run?.includes('title="deps: bump agent-org from')) found.push("the title does not begin `deps:`");
  return found;
}

function violations(source: string): string[] {
  const workflow = parse(source);
  const words = FORBIDDEN.filter((word) => source.includes(word)).map((word) => `the file contains \`${word}\``);
  return [...triggerViolations(workflow), ...tokenViolations(workflow, source), ...shapeViolations(workflow), ...words];
}

test("the workflow is scheduled, opens its pull request as the bot, keeps one branch and one title shape, and never merges", () => {
  assert.deepEqual(violations(text()), []);
});

test("violations() refuses each fixture that breaks one property (the positive controls for the test above)", () => {
  const source = text();
  assert.match(violations(source.replace("workflow_dispatch:", "workflow_dispatch:\n  pull_request:")).join("\n"), /triggers are/);
  assert.match(violations(source.replace("workflow_dispatch:", "")).join("\n"), /triggers are/);
  assert.match(violations(source.replace("GH_TOKEN: ${{ secrets.A11IGN_BOT_TOKEN }}\n          TAG:", "GH_TOKEN: ${{ secrets.A11IGN_BOT_TOKEN || github.token }}\n          TAG:")).join("\n"), /default workflow token/);
  assert.match(violations(source.replace("GH_TOKEN: ${{ secrets.A11IGN_BOT_TOKEN }}\n          TAG:", "GH_TOKEN: ${{ github.token }}\n          TAG:")).join("\n"), /GH_TOKEN is not A11IGN_BOT_TOKEN/);
  assert.match(violations(source.replace("BRANCH: deps/agent-org", "BRANCH: deps/agent-org-${{ github.run_id }}")).join("\n"), /one fixed name/);
  assert.match(violations(source.replace('title="deps:', 'title="chore:')).join("\n"), /does not begin `deps:`/);
  assert.match(violations(`${source}\n          gh pr merge 1 --squash\n`).join("\n"), /`gh pr merge`/);
  assert.match(violations(`${source}\n# bypass\n`).join("\n"), /`bypass`/);
});

test("the emptiness of the forbidden words is read against a workflow that really does `gh pr create`", () => {
  assert.ok(stepsOf(parse(text())).some((step) => step.run?.includes("gh pr create")), "the scan would be empty on a workflow that opens nothing");
});

// ---- the selection, run with the tags and the lockfile injected ----

const sha = (n: number) => n.toString(16).padStart(SHA_LENGTH, "0");
const LOCK = (commit: string) => `  agent-org@https://codeload.github.com/a11ign/agent-org/tar.gz/${commit}:\n    resolution: {}\n`;
const MANIFEST = (range: string) => JSON.stringify({ devDependencies: { "agent-org": `github:a11ign/agent-org#semver:${range}` } });

interface Choice { status: number | null; log: string; output: Record<string, string> }

/** Runs the `Choose` step's own script. `tags` are names; each gets a distinct commit, `commitOf` names it. */
function choose({ tags, range = "^0.7.0", locked }: { tags: string[]; range?: string; locked: string }): Choice & { commitOf: (tag: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "agent-org-bump-"));
  try {
    const commitOf = (tag: string) => sha(tags.indexOf(tag) + 1);
    writeFileSync(join(dir, "tags.txt"), tags.map((tag) => `${commitOf(tag)}\trefs/tags/${tag}`).join("\n"));
    writeFileSync(join(dir, "package.json"), MANIFEST(range));
    writeFileSync(join(dir, "pnpm-lock.yaml"), LOCK(locked === "none" ? sha(0xfff) : locked));
    writeFileSync(join(dir, "out"), "");
    const result = spawnSync("bash", ["-c", stepNamed("Choose").run!], {
      cwd: dir, encoding: "utf8",
      env: { PATH: process.env.PATH!, TAGS_FILE: join(dir, "tags.txt"), PACKAGE_JSON: join(dir, "package.json"), LOCKFILE: join(dir, "pnpm-lock.yaml"), GITHUB_OUTPUT: join(dir, "out") },
    });
    const output = Object.fromEntries(readFileSync(join(dir, "out"), "utf8").split("\n").filter(Boolean).map((line) => [line.split("=")[0], line.slice(line.indexOf("=") + 1)]));
    return { status: result.status, log: `${result.stdout}${result.stderr}`, output, commitOf };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TAGS = ["v0.7.9", "v0.7.10", "v0.8.0", "v0.8.0-rc1", "latest"];

test("(5) the newest in-range release is picked numerically: v0.7.10 over v0.7.9, never v0.8.0, an rc or a bare name", () => {
  const picked = choose({ tags: TAGS, locked: sha(1) });
  assert.equal(picked.status, 0, picked.log);
  assert.deepEqual([picked.output.action, picked.output.tag, picked.output.commit, picked.output.from], ["bump", "v0.7.10", picked.commitOf("v0.7.10"), "v0.7.9"]);
  assert.match(picked.log, /::warning::v0\.8\.0 is newer than the range/, "the out-of-range release is named, not silent");
});

test("(5) only an out-of-range release is the refusal, with no tag and a red exit", () => {
  const refused = choose({ tags: ["v0.8.0"], locked: "none" });
  assert.equal(refused.status, 1);
  assert.equal(refused.output.action, "refuse");
  assert.equal(refused.output.tag, "");
  assert.match(refused.log, /::error::.*v0\.8\.0 is outside the declared range \^0\.7\.0/);
});

test("(5) the positive control: the same call over an in-range list returns a tag", () => {
  const picked = choose({ tags: ["v0.7.9"], locked: "none" });
  assert.deepEqual([picked.status, picked.output.action, picked.output.tag], [0, "bump", "v0.7.9"]);
});

test("(5) an annotated tag's peeled commit is the one chosen, not the tag object's own sha", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-org-bump-"));
  try {
    writeFileSync(join(dir, "tags.txt"), `${sha(0xaa)}\trefs/tags/v0.7.9\n${sha(0xbb)}\trefs/tags/v0.7.9^{}\n`);
    writeFileSync(join(dir, "package.json"), MANIFEST("^0.7.0"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), LOCK(sha(1)));
    writeFileSync(join(dir, "out"), "");
    const result = spawnSync("bash", ["-c", stepNamed("Choose").run!], { cwd: dir, encoding: "utf8",
      env: { PATH: process.env.PATH!, TAGS_FILE: join(dir, "tags.txt"), PACKAGE_JSON: join(dir, "package.json"), LOCKFILE: join(dir, "pnpm-lock.yaml"), GITHUB_OUTPUT: join(dir, "out") } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(dir, "out"), "utf8"), new RegExp(`commit=${sha(0xbb)}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(6) a lockfile already at the chosen tag's commit yields no pull request", () => {
  const tags = ["v0.7.9", "v0.7.10"];
  const current = choose({ tags, locked: sha(2) });
  assert.deepEqual([current.status, current.output.action, current.output.tag], [0, "none", "v0.7.10"]);
  assert.match(current.log, /nothing to do/);
  const behind = choose({ tags, locked: sha(1) });
  assert.equal(behind.output.action, "bump", "one release behind is a bump: the control for the line above");
});

test("a lockfile that names no commit, a range it cannot read, or no readable tag is a refusal and never 'already current'", () => {
  const noCommit = choose({ tags: ["v0.7.9"], locked: sha(1) });
  assert.equal(noCommit.status, 0);
  const dir = mkdtempSync(join(tmpdir(), "agent-org-bump-"));
  try {
    const run = (files: { tags: string; manifest: string; lock: string }) => {
      writeFileSync(join(dir, "tags.txt"), files.tags);
      writeFileSync(join(dir, "package.json"), files.manifest);
      writeFileSync(join(dir, "pnpm-lock.yaml"), files.lock);
      writeFileSync(join(dir, "out"), "");
      return spawnSync("bash", ["-c", stepNamed("Choose").run!], { cwd: dir, encoding: "utf8",
        env: { PATH: process.env.PATH!, TAGS_FILE: join(dir, "tags.txt"), PACKAGE_JSON: join(dir, "package.json"), LOCKFILE: join(dir, "pnpm-lock.yaml"), GITHUB_OUTPUT: join(dir, "out") } });
    };
    const good = { tags: `${sha(1)}\trefs/tags/v0.7.9\n`, manifest: MANIFEST("^0.7.0"), lock: LOCK(sha(1)) };
    assert.equal(run(good).status, 0);
    assert.match(run({ ...good, lock: "nothing here\n" }).stdout, /does not name a commit/);
    assert.match(run({ ...good, manifest: MANIFEST(">=0.7.0 <0.8.0") }).stdout, /not one this workflow reads/);
    assert.match(run({ ...good, tags: "" }).stdout, /no release tag/);
    for (const refused of [{ ...good, lock: "x" }, { ...good, tags: "" }]) assert.equal(run(refused).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the lockfile-only move, against a stub `pnpm` ----

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", env: sandboxGitEnv() });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function executable(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, EXECUTABLE);
}

/** A work tree at a commit holding a manifest and a lockfile, plus a `bin/` for stubs. */
function scratch(): { dir: string; work: string; bin: string; remote: string } {
  const dir = mkdtempSync(join(tmpdir(), "agent-org-bump-"));
  const [work, bin, remote] = ["work", "bin", "remote.git"].map((name) => join(dir, name));
  mkdirSync(work); mkdirSync(bin);
  git(dir, "init", "--bare", "-b", "main", remote);
  git(dir, "init", "-b", "main", work);
  writeFileSync(join(work, "package.json"), MANIFEST("^0.7.0"));
  writeFileSync(join(work, "pnpm-lock.yaml"), LOCK(sha(1)));
  git(work, "add", "."); git(work, "commit", "-m", "base"); git(work, "remote", "add", "origin", remote);
  git(work, "push", "origin", "main");
  return { dir, work, bin, remote };
}

function move(commit: string, pnpmBody: string) {
  const { dir, work, bin } = scratch();
  try {
    executable(join(bin, "pnpm"), pnpmBody);
    const result = spawnSync("bash", ["-c", stepNamed("Move the pin").run!], { cwd: work, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, COMMIT: commit } });
    return { status: result.status, log: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BUMP_LOCK = `printf '  agent-org@https://codeload.github.com/a11ign/agent-org/tar.gz/${sha(2)}:\\n' > pnpm-lock.yaml`;

test("(4) the move accepts a lockfile-only change that lands on the chosen commit", () => {
  const moved = move(sha(2), BUMP_LOCK);
  assert.equal(moved.status, 0, moved.log);
});

test("(4) the move refuses a diff that touches package.json, a changed range, or any file but the lockfile", () => {
  const range = move(sha(2), `${BUMP_LOCK}\nprintf '{}' > package.json`);
  assert.equal(range.status, 1);
  assert.match(range.log, /may change pnpm-lock\.yaml alone/);
  const untracked = move(sha(2), `${BUMP_LOCK}\nprintf x > stray.txt`);
  assert.equal(untracked.status, 1, "an untracked file is part of the move too");
});

test("(4) the move refuses a resolver that landed on another commit, and one that moved nothing", () => {
  const other = move(sha(3), BUMP_LOCK);
  assert.equal(other.status, 1);
  assert.match(other.log, /not the chosen/);
  const nothing = move(sha(2), "true");
  assert.equal(nothing.status, 1, "an unchanged lockfile is not a bump");
});

// ---- opening or updating the pull request, against a real bare remote and a stub `gh` ----

interface PullRequestRun { status: number | null; log: string; calls: string[]; remoteTip: string | null }

/** Runs the create-or-update step once. `open` is the number `gh pr list` reports (empty: none open). */
function openOrUpdate(env: { dir: string; work: string; bin: string; remote: string }, { commit, open }: { commit: string; open: string }): PullRequestRun {
  const { dir, work, bin, remote } = env;
  executable(join(bin, "gh"), `echo "$*" >> "${dir}/calls"\ncase "$*" in "pr list"*) echo "${open}" ;; esac`);
  git(work, "switch", "-C", "main", "origin/main");
  writeFileSync(join(work, "pnpm-lock.yaml"), LOCK(commit));
  const result = spawnSync("bash", ["-c", stepNamed("Open the pull request").run!], {
    cwd: work, encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: "stub", TAG: "v0.7.9", COMMIT: commit, FROM: "v0.7.4", BRANCH, GITHUB_REPOSITORY: "o/r", RUNNER_TEMP: dir },
  });
  const calls = spawnSync("sh", ["-c", `cat "${dir}/calls" 2>/dev/null || true`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const tip = spawnSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${BRANCH}`], { cwd: remote, encoding: "utf8", env: sandboxGitEnv() });
  return { status: result.status, log: `${result.stdout}${result.stderr}`, calls, remoteTip: tip.status === 0 ? tip.stdout.trim() : null };
}

test("(3) a first run opens one pull request from the fixed branch; a second at the same tag pushes and edits nothing", () => {
  const env = scratch();
  try {
    const first = openOrUpdate(env, { commit: sha(2), open: "" });
    assert.equal(first.status, 0, first.log);
    assert.ok(first.remoteTip, "the branch was pushed");
    const create = first.calls.filter((call) => call.startsWith("pr create"));
    assert.equal(create.length, 1);
    assert.match(create[0], new RegExp(`--head ${BRANCH} .*--title deps: bump agent-org from v0\\.7\\.4 to v0\\.7\\.9`));

    const second = openOrUpdate(env, { commit: sha(2), open: "7" });
    assert.equal(second.status, 0, second.log);
    assert.match(second.log, /already at v0\.7\.9: nothing to push and nothing to edit/);
    assert.equal(second.remoteTip, first.remoteTip, "the branch tip did not move");
    assert.deepEqual(second.calls.filter((call) => /^pr (create|edit)/.test(call)), create, "no second create and no edit");
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test("(3) a newer release with a pull request open updates THAT pull request instead of opening another", () => {
  const env = scratch();
  try {
    const first = openOrUpdate(env, { commit: sha(2), open: "" });
    const newer = openOrUpdate(env, { commit: sha(3), open: "7" });
    assert.equal(newer.status, 0, newer.log);
    assert.notEqual(newer.remoteTip, first.remoteTip, "the branch moved to the newer release");
    assert.equal(newer.calls.filter((call) => call.startsWith("pr create")).length, 1, "still the one create, from the first run");
    assert.equal(newer.calls.filter((call) => call.startsWith("pr edit 7")).length, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test("the body states what the merge gate reads: an Acceptance command and a well-formed Closes declaration", () => {
  const run = stepNamed("Open the pull request").run!;
  const body = run.slice(run.indexOf("<<BODY"), run.lastIndexOf("BODY\n"));
  assert.equal([...body.matchAll(/^\s*Acceptance:\s*$/gm)].length, 1, "exactly one Acceptance section (a duplicate is merge-blocking)");
  assert.match(body, /^\s*Closes: none — .+$/m, "a Closes declaration with an em dash and a reason (a missing one is merge-blocking)");
  assert.match(body, /pnpm exec rstest run --config=scripts\/rstest\/rstest\.config\.mjs --include \S+\.test\.ts/);
});
