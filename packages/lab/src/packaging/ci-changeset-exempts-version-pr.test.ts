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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { VERSION_BRANCH } from "../../../../scripts/release-commit-version-bump.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ENFORCEMENT = "A consumer-visible change must say what it does to a consumer";

type Step = { name?: string; if?: string; run?: string };
const ci = parseYaml(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
const enforcement = ci.jobs.changeset.steps.find((step) => step.name === ENFORCEMENT);

interface Event { eventName?: string; headRef?: string; queueMessage?: string; settled?: string }

/** Whether the enforcement step RUNS for this event, the job having found a published package touched. */
function stepRuns(event: Event): boolean {
  const expression = enforcement?.if ?? "";
  assert.match(expression, /^[\w\s.'&|!=(),/-]+$/, "the `if:` uses something this evaluator does not model; extend it before trusting it");
  const github = {
    event_name: event.eventName ?? "pull_request",
    head_ref: event.headRef ?? "",
    event: { merge_group: { head_commit: { message: event.queueMessage ?? "" } } },
  };
  const steps = { precise: { outputs: { changeset: "true" } }, dependency: { outputs: { settled: event.settled ?? "" } } };
  const startsWith = (text: string, prefix: string): boolean => text.startsWith(prefix);
  return Boolean(new Function("github", "steps", "startsWith", `return (${expression});`)(github, steps, startsWith));
}

test("#3161 POSITIVE CONTROL: the enforcement step exists, has an `if:`, and runs for an ordinary pull request", () => {
  assert.ok(enforcement?.if, `ci.yml's changeset job lost its "${ENFORCEMENT}" step or its \`if:\`; re-read this test`);
  assert.match(enforcement.run ?? "", /changeset status/, "the step must still run `changeset status`");
  assert.equal(stepRuns({ headRef: "agent/some-row-1" }), true);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: "feat: something (#1)" }), true);
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
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: "Version packages (#3200)" }), false);
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: "feat: a Version packages note (#3200)" }), true);
  assert.equal(stepRuns({ eventName: "pull_request", queueMessage: "Version packages (#3200)" }), true,
    "a pull request is exempted by its BRANCH, never by a title anybody can type");
});

test("#3161: the exemption does not disturb the dependency pull request's own settlement", () => {
  assert.equal(stepRuns({ headRef: "dependabot/npm_and_yarn/x", settled: "true" }), false);
});

test("#3161: the queue half matches the title release.yml gives the version pull request", () => {
  const release = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");
  const title = /--title "([^"]+)"/.exec(release)?.[1];
  assert.ok(title, "release.yml no longer creates the version pull request with a literal --title");
  assert.equal(stepRuns({ eventName: "merge_group", queueMessage: `${title} (#1)` }), false);
});

test("#3161: the version commit carries no empty changeset -- the script no longer calls `changeset add --empty` or writes one", () => {
  const source = readFileSync(join(REPO, "scripts/release-commit-version-bump.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /add\s+--empty|"add",\s*"--empty"/);
  assert.doesNotMatch(source, /writeFileSync|version-packages\.md/);
});
