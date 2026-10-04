/**
 * #3161: `changeset version` consumes the changesets and always ships `package.json` and `CHANGELOG.md`, so
 * `changeset status --since` exits 1 on a version commit. #3131 answered with an empty changeset left behind after
 * every release; `ci.yml`'s `changeset` job now skips its enforcement step for the version branch instead.
 *
 * The workflow is PARSED, and the step's `if:` is EVALUATED against contexts, so a comment or an `echo` naming the
 * branch cannot satisfy it. The evaluator is JavaScript on purpose: the expression uses only `&&`, `!`, `==`, `!=`
 * and `startsWith`, which mean the same thing there, and a whitelist below refuses anything else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { VERSION_BRANCH } from "../../../../scripts/release-commit-version-bump.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ENFORCEMENT = "A consumer-visible change must say what it does to a consumer";
const OWNER = "a11ign";

type Step = { id?: string; name?: string; if?: string; run?: string; env?: Record<string, string> };
const ci = parseYaml(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
const enforcement = ci.jobs.changeset.steps.find((step) => step.name === ENFORCEMENT);
const versionStep = ci.jobs.changeset.steps.find((step) => step.id === "version");

/**
 * REAL `merge_group` `head_commit.message`s, read off runs of this repository on 2026-10-03: the `merge-queue-main`
 * ruleset (23681721) has `merge_method: MERGE`, so the message is the MERGE commit's -- the branch on its first line,
 * the pull request title after a blank line. Run 37119901139 (#3195). The version pull request's is the same shape
 * with its own branch and its `release.yml` title; that one is derived, not yet observed (no version pull request
 * has been queued), which is why the ruleset is named in the workflow comment: a switch to SQUASH is where it changes.
 */
const MERGE_MESSAGE = (branch: string, title: string): string => `Merge pull request #3195 from ${OWNER}/${branch}\n\n${title}`;
const REAL_ORDINARY = MERGE_MESSAGE("agent/the-v1-rehearsal-s-3181",
  "The V1 rehearsal's mechanical half, part 1: the outsider job's source, verdict reader and tests (#3181)");

interface Event { eventName?: string; headRef?: string; queueMessage?: string; settled?: string }

/** Evaluates a step's `if:` (JavaScript reads this operator subset the same way) against the given contexts. */
function evaluate(expression: string, context: Record<string, unknown>): boolean {
  assert.match(expression, /^[\w\s.'&|!=(),/-]+$/, "the `if:` uses something this evaluator does not model; extend it before trusting it");
  const startsWith = (text: string, prefix: string): boolean => text.startsWith(prefix);
  return Boolean(new Function("github", "steps", "startsWith", `return (${expression});`)(context.github, context.steps, startsWith));
}

/** Runs the `version` step's own shell against the event, as the runner would, and returns the `queue` output. */
function queueOutput(message: string): string {
  assert.ok(versionStep?.run, "ci.yml's changeset job lost its `version` step; re-read this test");
  assert.equal(versionStep.env?.QUEUE_MESSAGE, "${{ github.event.merge_group.head_commit.message }}",
    "the message must reach the shell as an env var, never interpolated into the script (a title is untrusted text)");
  const dir = mkdtempSync(join(tmpdir(), "a11y-version-step-"));
  try {
    const output = join(dir, "output");
    writeFileSync(output, "");
    execFileSync("bash", ["-c", versionStep.run], {
      env: { PATH: process.env.PATH ?? "", QUEUE_MESSAGE: message, GITHUB_OUTPUT: output, GITHUB_REPOSITORY_OWNER: OWNER },
    });
    return readFileSync(output, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the enforcement step RUNS for this event, the job having found a published package touched. */
function stepRuns(event: Event): boolean {
  const eventName = event.eventName ?? "pull_request";
  const github = { event_name: eventName, head_ref: event.headRef ?? "" };
  const queue = eventName === "merge_group" && evaluate(versionStep?.if ?? "false", { github }) ? queueOutput(event.queueMessage ?? "") : "";
  const steps = {
    precise: { outputs: { changeset: "true" } },
    dependency: { outputs: { settled: event.settled ?? "" } },
    version: { outputs: { queue: queue === "queue=true" ? "true" : "" } },
  };
  return evaluate(enforcement?.if ?? "", { github, steps });
}

test("#3161 POSITIVE CONTROL: the enforcement step exists, has an `if:`, and runs for an ordinary pull request", () => {
  assert.ok(enforcement?.if, `ci.yml's changeset job lost its "${ENFORCEMENT}" step or its \`if:\`; re-read this test`);
  assert.match(enforcement.run ?? "", /changeset status/, "the step must still run `changeset status`");
  assert.equal(stepRuns({ headRef: "agent/some-row-1" }), true);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: REAL_ORDINARY }), true);
});

test("#3161: the step is skipped for a pull request from the version branch", () => {
  assert.equal(VERSION_BRANCH, "release/version-packages");
  assert.equal(stepRuns({ headRef: VERSION_BRANCH }), false);
});

test("#3161: the exemption names ONE branch -- a longer name or a parent still runs the step", () => {
  for (const headRef of [`${VERSION_BRANCH}-x`, `${VERSION_BRANCH}/x`, "release", "release/version-packages2"]) {
    assert.equal(stepRuns({ headRef }), true, `${headRef} must not be exempt`);
  }
});

test("#3161: the version pull request's QUEUE ENTRY is exempt too (`head_ref` is empty on `merge_group`), and only that", () => {
  const version = MERGE_MESSAGE(VERSION_BRANCH, "Version packages");
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: version }), false);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: REAL_ORDINARY }), true);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: MERGE_MESSAGE(`${VERSION_BRANCH}-x`, "Version packages") }), true,
    "the match is exact on the branch: a longer name is still enforced in the queue");
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: MERGE_MESSAGE(`${VERSION_BRANCH}/x`, "Version packages") }), true);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: MERGE_MESSAGE("agent/x", `see ${OWNER}/${VERSION_BRANCH}`) }), true,
    "the branch is read from the FIRST line only, so a title naming it exempts nothing");
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: `Merge pull request #1 from someone-else/${VERSION_BRANCH}\n\nVersion packages` }), true,
    "a fork's branch of the same name is not this repository's");
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: "Version packages (#3200)" }), true,
    "a SQUASH-shaped message is not what this queue writes (merge_method MERGE), so it exempts nothing");
  assert.equal(stepRuns({ eventName: "pull_request", queueMessage: MERGE_MESSAGE(VERSION_BRANCH, "Version packages") }), true,
    "a pull request is exempted by its BRANCH, never by a message");
});

test("#3161: the exemption does not disturb the dependency pull request's own settlement", () => {
  assert.equal(stepRuns({ headRef: "dependabot/npm_and_yarn/x", settled: "true" }), false);
});

test("#3161: the branch the queue half exempts is the one release.yml opens the version pull request from", () => {
  const release = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");
  assert.match(release, new RegExp(`--head ${VERSION_BRANCH}\\b`), "release.yml opens the version pull request from a different branch");
});

test("#3161: the version commit carries no empty changeset -- the script no longer calls `changeset add --empty` or writes one", () => {
  const source = readFileSync(join(REPO, "scripts/release-commit-version-bump.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /add\s+--empty|"add",\s*"--empty"/);
  assert.doesNotMatch(source, /writeFileSync|version-packages\.md/);
});

/**
 * #3584: the generic step's BASE. A queue entry behind the version-packages entry contains that entry's consumed bumps, which
 * `origin/main` does not yet hold, so diffing the entry against `origin/main` reads them as its own. The step's `run` is
 * EVALUATED for each event (its `${{ }}` expressions resolved against contexts), never grepped.
 */
const QUEUE_PARENT = "1111111111111111111111111111111111111111";
const MAIN = "origin/main";

/** GitHub's lookup: a path that does not exist on this event is the empty string, not an error. */
function lookup(path: string, context: unknown): string {
  const value = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], context);
  return typeof value === "string" ? value : "";
}

/** Resolves every `${{ a.b || c.d }}` in a `run`; only dotted paths joined by `||` are modelled, and anything else is refused. */
function interpolate(run: string, context: unknown): string {
  return run.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_match, expression: string) => {
    assert.match(expression, /^[\w.-]+(\s*\|\|\s*[\w.-]+)*$/, `\`${expression}\` is not modelled by this evaluator; extend it before trusting it`);
    return expression.split("||").map((path) => lookup(path.trim(), context)).find((value) => value !== "") ?? "";
  });
}

/** What `--since=` the enforcement step passes to `changeset status` on this event. */
function sinceFor(run: string, eventName: "pull_request" | "merge_group"): string {
  const event = eventName === "merge_group" ? { merge_group: { base_sha: QUEUE_PARENT } } : { pull_request: { number: 1 } };
  const context = { github: { event_name: eventName, event }, needs: { changed: { outputs: { base: MAIN } } } };
  const since = /changeset status --since=(\S*);/.exec(interpolate(run, context));
  assert.ok(since, "the step no longer runs `changeset status --since=<ref>;` -- re-read this test");
  return since[1];
}

/** True when `run` diffs a queue entry against its parent AND a pull request against the base. */
function diffsEntryAgainstParent(run: string): boolean {
  return sinceFor(run, "merge_group") === QUEUE_PARENT && sinceFor(run, "pull_request") === MAIN;
}

test("#3584: a queue entry is diffed against its parent and a pull request against the base", () => {
  assert.ok(enforcement?.run, "the enforcement step lost its `run`; re-read this test");
  assert.equal(sinceFor(enforcement.run, "merge_group"), QUEUE_PARENT, "an entry built on the version entry must not be diffed against origin/main");
  assert.equal(sinceFor(enforcement.run, "pull_request"), MAIN, "`merge_group.base_sha` is empty on a pull request, so the base must still be used");
  assert.equal(diffsEntryAgainstParent(enforcement.run), true);
});

test("#3584 POSITIVE CONTROLS: the step as it was is RED on merge_group, and a pull request diffed against base_sha is RED on pull_request", () => {
  assert.ok(enforcement?.run, "the enforcement step lost its `run`; re-read this test");
  const before = enforcement.run.replace("${{ github.event.merge_group.base_sha || needs.changed.outputs.base }}", "${{ needs.changed.outputs.base }}");
  assert.notEqual(before, enforcement.run, "the mutation did not apply: the step's base expression changed shape; re-read this test");
  assert.equal(sinceFor(before, "merge_group"), MAIN, "the old step diffs an entry against origin/main");
  assert.equal(diffsEntryAgainstParent(before), false);

  const wrong = enforcement.run.replace("${{ github.event.merge_group.base_sha || needs.changed.outputs.base }}", "${{ github.event.merge_group.base_sha }}");
  assert.equal(sinceFor(wrong, "pull_request"), "", "base_sha is empty on a pull request");
  assert.equal(diffsEntryAgainstParent(wrong), false);
});
