/**
 * #3159 (sibling of #3137): A DEPENDENCY PULL REQUEST'S CHANGESET ENTRY IS DERIVED FROM ITS DIFF, NEVER FROM ITS TITLE.
 *
 * The `changeset` job reads FILES (`changeset status --since`), so #3137's body fragment cannot clear it: #3155
 * (`yaml` 2.9.0 -> 2.9.1) failed it. `scripts/dependency-changeset.mjs` is the derivation; this calls it over the two
 * REAL diffs the row names (`fixtures/dependency-pr/`, the manifests those pull requests changed, fetched at their
 * base and head commits and trimmed to the keys the derivation reads).
 *
 * THE ROW NAMED THE PACKAGES BY THEIR DIRECTORIES (`@a11ign/cli` and the fleet package under its old scope);
 * THE MANIFESTS SAY OTHERWISE.
 * `packages/cli` is `a11ign`, and `packages/worker-fleet` is `@a11ign/screenreader-fleet` with `yaml` in its
 * `devDependencies`, so only `a11ign` owes a consumer an entry. Read from the fixture, not from the row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

import {
  checkEntries, deriveDependencyChangeset, parseEntry, refusalFor, renderEntry,
} from "../../../../scripts/dependency-changeset.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const OWNED: string[] = JSON.parse(readFileSync(resolve(REPO, "docs/owned-path-facts.json"), "utf8")).owned;

type Manifest = Record<string, unknown>;
interface Fixture { pr: number; title: string; files: string[]; manifests: Record<string, { before: Manifest; after: Manifest }> }

const fixture = (pr: number): Fixture =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `fixtures/dependency-pr/pr${pr}.json`), "utf8"));
const derive = (f: Pick<Fixture, "files" | "manifests">) => deriveDependencyChangeset({ ...f, owned: OWNED });

/** One manifest pair, for the small refusals that need no real pull request. */
const pair = (before: Manifest, after: Manifest) => ({
  files: ["packages/x/package.json"],
  manifests: { "packages/x/package.json": { before: { name: "x", ...before }, after: { name: "x", ...after } } },
});

test("#3155: a runtime bump gets ONE patch entry, for the published package, naming the dependency and both ranges", () => {
  const derived = derive(fixture(3155));
  assert.equal(derived.verdict, "entries");
  assert.deepEqual(derived.entries.map((e) => [e.package, e.bump]), [["a11ign", "patch"]],
    "`@a11ign/screenreader-fleet` has `yaml` in devDependencies and `@a11ign/lab` is private: neither owes a consumer an entry");
  for (const needle of ["yaml", "^2.9.0", "^2.9.1"]) assert.match(derived.entries[0].text, new RegExp(needle.replace("^", "\\^")));
  assert.deepEqual(derived.privatePackages, ["@a11ign/lab"]);
});

test("a diff that moves ONLY devDependencies is EMPTY, recorded rather than inferred from silence", () => {
  const { files, manifests } = fixture(3155);
  const devOnly = { files, manifests: { "packages/worker-fleet/package.json": manifests["packages/worker-fleet/package.json"] } };
  assert.equal(derive(devOnly).verdict, "empty");
  assert.deepEqual(derive(devOnly).entries, []);
});

test("#3157 is REFUSED, and the log names the 0.x minor and the owned path", () => {
  const derived = derive(fixture(3157));
  assert.equal(derived.verdict, "refused");
  const log = derived.reasons.join("\n");
  assert.match(log, /@guidepup\/guidepup in [^:]+: \^?0\.31\.0 -> \^?0\.34\.0 is a 0\.x MINOR bump/);
  assert.match(log, /packages\/nvda-worker\/package\.json is an owned path/);
  assert.deepEqual(derived.entries, [], "a refused diff derives no entry");
});

test("the refusals one at a time: each fires on its own diff and on no other", () => {
  const ranges = (from: string, to: string) => pair({ dependencies: { yaml: from } }, { dependencies: { yaml: to } });
  assert.match(refusalFor({ path: "p", package: "x", private: false, section: "dependencies", dependency: "yaml", from: "^2.9.0", to: "^3.0.0" }) ?? "", /MAJOR/);
  assert.equal(derive(ranges("^2.9.0", "^2.9.1")).verdict, "entries");
  assert.equal(derive(ranges("^1.2.0", "^1.3.0")).verdict, "entries", "a 1.x minor is an ordinary compatible bump");
  assert.match(derive(ranges("^2.9.0", "^3.0.0")).reasons.join(), /MAJOR/);
  assert.match(derive(ranges("^0.2.0", "^0.3.0")).reasons.join(), /0\.x MINOR/);
  assert.match(derive(ranges("^0.0.2", "^0.0.3")).reasons.join(), /0\.0\.x/);
  assert.match(derive(ranges("^2.9.1", "^2.9.0")).reasons.join(), /downgrade/);
  assert.match(derive(ranges("github:a11ign/agent-org#semver:^0.1.0", "github:a11ign/agent-org#semver:^0.2.0")).reasons.join(), /not a plain version/);
  assert.match(derive(pair({ dependencies: {} }, { dependencies: { yaml: "^2.9.0" } })).reasons.join(), /was added/);
  assert.match(derive(pair({ version: "1.0.0" }, { version: "1.0.1" })).reasons.join(), /other than a dependency range/);
  assert.match(derive({ ...ranges("^2.9.0", "^2.9.1"), files: ["packages/x/package.json", "packages/x/src/a.ts"] }).reasons.join(), /packages\/x\/src\/a\.ts is not a manifest/);
});

/** What each wrong entry for #3155 looks like, built the wrong way on purpose. */
const derived3155 = () => derive(fixture(3155));
const fromTheTitle = () => ({ package: "a11ign", bump: "patch", text: fixture(3155).title });

test("POSITIVE CONTROLS: an entry built from the TITLE, an `--empty` over a runtime range and a patch for a private package are each REFUSED", () => {
  assert.match(checkEntries([fromTheTitle()], derived3155()).join(), /never from the title/);
  assert.match(checkEntries([parseEntry("---\n---\n")], derived3155()).join(), /empty changeset over a diff that moves a runtime range/);
  assert.match(checkEntries([{ package: "@a11ign/lab", bump: "patch", text: "x" }], derived3155()).join(), /private package/);
  assert.match(checkEntries([{ package: "@a11ign/screenreader-fleet", bump: "patch", text: "x" }], derived3155()).join(), /does not move/);
  assert.match(checkEntries([{ package: "a11ign", bump: "minor", text: derived3155().entries[0].text }], derived3155()).join(), /never from the title/);
});

test("THE NEGATIVE CONTROL: the entry the derivation renders, parsed back, is accepted; an empty one is accepted over a dev-only diff", () => {
  const derived = derived3155();
  assert.deepEqual(checkEntries(derived.entries.map((e) => parseEntry(renderEntry(e))), derived), []);
  assert.deepEqual(checkEntries([], derived), [], "a pull request carrying no entry is the normal case: it is compiled at version time");
  const { files, manifests } = fixture(3155);
  const devOnly = derive({ files, manifests: { "packages/worker-fleet/package.json": manifests["packages/worker-fleet/package.json"] } });
  assert.deepEqual(checkEntries([parseEntry("---\n---\n")], devOnly), []);
});

test("an entry set that leaves out a package the diff moves is refused", () => {
  const two = deriveDependencyChangeset({
    files: ["packages/a/package.json", "packages/b/package.json"],
    owned: OWNED,
    manifests: Object.fromEntries(["a", "b"].map((n) => [`packages/${n}/package.json`, {
      before: { name: n, dependencies: { yaml: "^2.9.0" } }, after: { name: n, dependencies: { yaml: "^2.9.1" } },
    }])),
  });
  assert.equal(two.entries.length, 2);
  assert.match(checkEntries([parseEntry(renderEntry(two.entries[0]))], two).join(), /no entry for b/);
});

test("THE POPULATION IS NOT EMPTY: the fixtures carry the real manifests the two pull requests changed", () => {
  for (const pr of [3155, 3157]) {
    const f = fixture(pr);
    assert.ok(Object.keys(f.manifests).length >= 3, `#${pr}'s fixture lost its manifests`);
    assert.ok(f.files.includes("pnpm-lock.yaml"), `#${pr}'s fixture lost its lockfile`);
  }
});

interface Step { id?: string; if?: string; run?: string; env?: Record<string, string> }
const changesetSteps = (): Step[] => {
  const ci = parseYaml(readFileSync(resolve(REPO, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  return ci.jobs.changeset.steps;
};

/**
 * #3220: a REAL `merge_group` `head_commit.message`, run 37120613262 (#3155's queue entry, whose `changeset` job failed). The
 * `merge-queue-main` ruleset (23681721) has `merge_method: MERGE`, so the message is the MERGE commit's: the branch on its first
 * line, a blank line, then the pull request's title. `startsWith(..., 'deps:')` on it is false, which is what ejected the entry.
 */
const REAL_QUEUE_MESSAGE = "Merge pull request #3155 from a11ign/dependabot/npm_and_yarn/yaml-2.9.1\n\ndeps: bump yaml from 2.9.0 to 2.9.1";
const OWNER = "a11ign";

/** Evaluates a step's `if:` (JavaScript reads this operator subset the same way) against the given contexts. */
function evaluate(expression: string, context: Record<string, unknown>): boolean {
  assert.match(expression, /^[\w\s.'&|!=(),:/-]+$/, "the `if:` uses something this evaluator does not model; extend it before trusting it");
  const startsWith = (text: string, prefix: string): boolean => text.startsWith(prefix);
  return Boolean(new Function("github", "steps", "startsWith", `return (${expression});`)(context.github, context.steps, startsWith));
}

/** Runs the queue-recognition step's own shell on a queue entry's message, as the runner would, and returns whether it set `queue`. */
function recognisedInTheQueue(step: Step, message: string): boolean {
  assert.equal(step.env?.QUEUE_MESSAGE, "${{ github.event.merge_group.head_commit.message }}",
    "the message must reach the shell as an env var, never interpolated into the script (a title is untrusted text)");
  const dir = mkdtempSync(join(tmpdir(), "a11y-deps-queue-step-"));
  try {
    const output = join(dir, "output");
    writeFileSync(output, "");
    execFileSync("bash", ["-c", step.run ?? ""], { env: { PATH: process.env.PATH ?? "", QUEUE_MESSAGE: message, GITHUB_OUTPUT: output, GITHUB_REPOSITORY_OWNER: OWNER } });
    return readFileSync(output, "utf8").trim() === "queue=true";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the `dependency` step RUNS for this event, the job having found a published package touched. */
function dependencyStepRuns(event: { title?: string; queueMessage?: string }): boolean {
  const steps = changesetSteps();
  const dependency = steps.find((s) => s.run?.includes("dependency-changeset.mjs check"));
  const recogniser = steps.find((s) => s.id === "dependencyQueue");
  assert.ok(dependency?.if && recogniser?.run, "ci.yml's `changeset` job lost the derivation or the step that recognises its queue entry; re-read this test");
  const queue = event.queueMessage !== undefined && evaluate(recogniser.if ?? "false", { github: { event_name: "merge_group" } })
    && recognisedInTheQueue(recogniser, event.queueMessage);
  return evaluate(dependency.if, {
    github: { event: { pull_request: { title: event.title ?? "" } } },
    steps: { precise: { outputs: { changeset: "true" } }, dependencyQueue: { outputs: { queue: queue ? "true" : "" } } },
  });
}

test("THE JOB IS WIRED: a `deps:` pull request is read from the diff; any other pull request keeps the old rule", () => {
  const steps = changesetSteps();
  const dependency = steps.find((s) => s.run?.includes("dependency-changeset.mjs check"));
  assert.ok(dependency, "ci.yml's `changeset` job no longer runs the derivation");
  assert.ok(dependency.id, "the derivation step needs an id for the standard step to read its outcome");
  assert.equal(dependencyStepRuns({ title: "deps: bump yaml from 2.9.0 to 2.9.1" }), true, "the pull_request event is recognised by its title prefix");
  assert.equal(dependencyStepRuns({ title: "Fix the thing" }), false);
  const standard = steps.find((s) => s.run?.includes("changeset status --since"));
  assert.ok(standard, "the standard `changeset status` step must stay, for every pull request that is not a dependency one");
  assert.match(standard.if ?? "", new RegExp(`steps\\.${dependency.id}\\.outputs\\.settled`), "the standard step stands down only when the derivation settled");
  assert.ok(steps.indexOf(dependency) < steps.indexOf(standard));
  assert.doesNotMatch(dependency.run ?? "", /github\.event\.pull_request\.title/, "the title is never interpolated into a shell line");
  assert.match(dependency.run ?? "", /--since=\$\{\{ github\.event\.merge_group\.base_sha \}\}/,
    "a queue entry is diffed against its own parent, or entry 2 is blamed for entry 1's files and ejected");
});

test("#3220: a dependency pull request's QUEUE ENTRY (a MERGE commit, not a squash) is read from the diff, and only that", () => {
  assert.equal(dependencyStepRuns({ queueMessage: REAL_QUEUE_MESSAGE }), true, "the real entry that was ejected twice (#3155) must reach the derivation");
  const message = (branch: string, title: string) => `Merge pull request #1 from ${OWNER}/${branch}\n\n${title}`;
  assert.equal(dependencyStepRuns({ queueMessage: message("agent/some-row-1", "The thing (#1)") }), false, "an ordinary entry keeps the old rule");
  assert.equal(dependencyStepRuns({ queueMessage: message("agent/x", "see deps: bump") }), false, "the title is read from the START of its line");
  assert.equal(dependencyStepRuns({ queueMessage: "Merge pull request #1 from a11ign/agent/x\n\nbody\ndeps: bump yaml" }), false, "only the title line counts");
  assert.equal(dependencyStepRuns({ queueMessage: "deps: bump yaml from 2.9.0 to 2.9.1 (#3155)" }), false,
    "a SQUASH-shaped message is not what this queue writes (merge_method MERGE), so it is not claimed to be recognised");
  assert.equal(dependencyStepRuns({ title: "Fix the thing", queueMessage: undefined }), false);
});

/** A throwaway QUEUE: entry 1 (`main` plus an unrelated source file) and, on top of it, entry 2 (the dependency bump). */
function repoWithAnEntryAheadInTheQueue(): { root: string; entryOne: string; run: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "dependency-queue-3159-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sandboxGitEnv(), encoding: "utf8" });
  const write = (path: string, body: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  const manifest = (yaml: string) => `${JSON.stringify({ name: "a", version: "1.0.0", dependencies: { yaml } }, null, 2)}\n`;
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  write("docs/owned-path-facts.json", `${JSON.stringify({ owned: [] })}\n`);
  write("packages/a/package.json", manifest("^2.9.0"));
  git("add", "-A");
  git("commit", "-qm", "first");
  git("checkout", "-qb", "gh-readonly-queue/main/entry-2");
  write("packages/a/src/entry-one.mjs", "export const one = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "entry 1: another pull request, already ahead in the queue");
  const entryOne = git("rev-parse", "HEAD").trim();
  write("packages/a/package.json", manifest("^2.9.1"));
  git("commit", "-qam", "deps: bump yaml");
  const script = resolve(REPO, "scripts/dependency-changeset.mjs");
  const run = (...args: string[]) => {
    try {
      return execFileSync("node", [script, ...args], { cwd: root, encoding: "utf8" });
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? error);
    }
  };
  return { root, entryOne, run };
}

test("A QUEUE ENTRY is judged on its OWN diff: entry 1's files ahead of it must not eject it, and without `--since` they would", () => {
  const { root, entryOne, run } = repoWithAnEntryAheadInTheQueue();
  try {
    const alone = run("check", "--base=main", `--since=${entryOne}`);
    assert.match(alone, /ACCEPTED \(entries\)/);
    assert.match(alone, /a: patch -- Updates the `yaml` dependency range from `\^2\.9\.0` to `\^2\.9\.1`\./);
    const contaminated = run("check", "--base=main");
    assert.match(contaminated, /REFUSED/, "positive control: against `main` alone entry 1's file is in the diff, which is the ejection");
    assert.match(contaminated, /entry-one\.mjs/);
    assert.match(run("check", "--base=main", "--since="), /REFUSED/, "an empty `--since` (a pull_request event) falls back to the base");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway repository: `main` moves on after the branch leaves it, then the branch bumps one runtime range. */
function repoWhereMainMovedOn(): { root: string; run: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "dependency-changeset-3159-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sandboxGitEnv(), encoding: "utf8" });
  const write = (path: string, body: object) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `${JSON.stringify(body, null, 2)}\n`);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  write("docs/owned-path-facts.json", { owned: ["packages/nvda-worker/"] });
  write("package.json", { name: "root", private: true, version: "1.0.0" });
  write("packages/a/package.json", { name: "a", version: "1.0.0", dependencies: { yaml: "^2.9.0" } });
  git("add", "-A");
  git("commit", "-qm", "first");
  git("checkout", "-qb", "dependabot/yaml");
  write("packages/a/package.json", { name: "a", version: "1.0.0", dependencies: { yaml: "^2.9.1" } });
  git("commit", "-qam", "deps: bump yaml");
  git("checkout", "-q", "main");
  write("packages/a/package.json", { name: "a", version: "1.0.1", dependencies: { yaml: "^2.9.0" } });
  git("commit", "-qam", "main moves on: the SAME manifest changes its version");
  git("checkout", "-q", "dependabot/yaml");
  const script = resolve(REPO, "scripts/dependency-changeset.mjs");
  return { root, run: (...args) => execFileSync("node", [script, ...args], { cwd: root, encoding: "utf8" }) };
}

test("the `before` side is the MERGE-BASE: what `main` moved since the branch left is not the pull request's doing", () => {
  const { root, run } = repoWhereMainMovedOn();
  try {
    const out = run("check", "--base=main");
    assert.match(out, /ACCEPTED \(entries\)/);
    assert.match(out, /a: patch -- Updates the `yaml` dependency range from `\^2\.9\.0` to `\^2\.9\.1`\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway repository whose package `a` was released (tag `a@1.0.0`) and has since had three ranges moved. */
function repoReleasedThenBumped(): { root: string; run: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "dependency-compile-3159-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: sandboxGitEnv(), encoding: "utf8" });
  const write = (path: string, body: object) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `${JSON.stringify(body, null, 2)}\n`);
  };
  const manifest = (yaml: string, dev: string, sibling: string) => ({
    name: "a", version: "1.0.0", dependencies: { yaml, b: sibling }, devDependencies: { tsx: dev },
  });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  write("packages/a/package.json", manifest("^2.9.0", "^4.22.0", "^1.0.0"));
  write("packages/b/package.json", { name: "b", version: "1.0.0" });
  git("add", "-A");
  git("commit", "-qm", "released");
  git("tag", "a@1.0.0");
  write("packages/a/package.json", manifest("^2.9.1", "^4.23.0", "^1.1.0"));
  git("commit", "-qam", "deps: bump yaml, tsx and the sibling");
  mkdirSync(join(root, ".changeset"));
  const script = resolve(REPO, "scripts/dependency-changeset.mjs");
  return { root, run: (...args) => execFileSync("node", [script, ...args], { cwd: root, encoding: "utf8" }) };
}

test("VERSION TIME: `compile` writes the entry from the manifest at the last release tag, and only for a THIRD-PARTY RUNTIME range", () => {
  const { root, run } = repoReleasedThenBumped();
  try {
    const dry = run("compile", "--dry-run");
    assert.match(dry, /dependency-ranges-a\.md/);
    assert.match(dry, /"a": patch/);
    assert.match(dry, /`yaml` dependency range from `\^2\.9\.0` to `\^2\.9\.1`/);
    assert.doesNotMatch(dry, /tsx/, "a devDependencies move owes the changelog nothing");
    assert.doesNotMatch(dry, /`b`/, "a workspace sibling's range belongs to `changeset version`, not to this");
    assert.throws(() => readFileSync(join(root, ".changeset/dependency-ranges-a.md"), "utf8"), /ENOENT/, "a dry run writes nothing");
    run("compile");
    assert.equal(readFileSync(join(root, ".changeset/dependency-ranges-a.md"), "utf8"),
      '---\n"a": patch\n---\n\nUpdates the `yaml` dependency range from `^2.9.0` to `^2.9.1`.\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("`compile` over a package with no release tag says nothing moved, rather than inventing a baseline", () => {
  const { root, run } = repoReleasedThenBumped();
  try {
    execFileSync("git", ["tag", "-d", "a@1.0.0"], { cwd: root, env: sandboxGitEnv() });
    assert.match(run("compile", "--dry-run"), /no published package's third-party runtime ranges moved/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
