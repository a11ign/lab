/**
 * #3159 (sibling of #3137): A DEPENDENCY PULL REQUEST'S CHANGESET ENTRY IS DERIVED FROM ITS DIFF, NEVER FROM ITS TITLE.
 *
 * The `changeset` job reads FILES (`changeset status --since`), so #3137's body fragment cannot clear it: #3155
 * (`yaml` 2.9.0 -> 2.9.1) failed it. `scripts/dependency-changeset.mjs` is the derivation; this calls it over the two
 * REAL diffs the row names (`fixtures/dependency-pr/`, the manifests those pull requests changed, fetched at their
 * base and head commits and trimmed to the keys the derivation reads).
 *
 * THE ROW NAMED THE PACKAGES BY THEIR DIRECTORIES (`@a11ign/cli`, `@a11ign/worker-fleet`); THE MANIFESTS SAY OTHERWISE.
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

interface Step { id?: string; if?: string; run?: string }
const changesetSteps = (): Step[] => {
  const ci = parseYaml(readFileSync(resolve(REPO, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  return ci.jobs.changeset.steps;
};

test("THE JOB IS WIRED: a `deps:` pull request, and its queue entry, is read from the diff; any other pull request keeps the old rule", () => {
  const steps = changesetSteps();
  const dependency = steps.find((s) => s.run?.includes("dependency-changeset.mjs check"));
  assert.ok(dependency, "ci.yml's `changeset` job no longer runs the derivation");
  assert.ok(dependency.id, "the derivation step needs an id for the standard step to read its outcome");
  assert.match(dependency.if ?? "", /startsWith\(github\.event\.pull_request\.title/, "the pull_request event is recognised by its title prefix");
  assert.match(dependency.if ?? "", /merge_group\.head_commit\.message/, "the queue entry is recognised too, or the merge group ejects the pull request this job passed");
  assert.match(dependency.if ?? "", /'deps:'/);
  const standard = steps.find((s) => s.run?.includes("changeset status --since"));
  assert.ok(standard, "the standard `changeset status` step must stay, for every pull request that is not a dependency one");
  assert.match(standard.if ?? "", new RegExp(`steps\\.${dependency.id}\\.outputs\\.settled`), "the standard step stands down only when the derivation settled");
  assert.ok(steps.indexOf(dependency) < steps.indexOf(standard));
  assert.doesNotMatch(dependency.run ?? "", /github\.event\.pull_request\.title/, "the title is never interpolated into a shell line");
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
