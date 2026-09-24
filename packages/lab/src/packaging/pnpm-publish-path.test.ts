/**
 * THE PUBLISH PATH IS pnpm'S, AND THE CONSUMER'S HALF IS STILL npm'S (#2301, child 4 of #57).
 *
 * This move can look finished and not be, in five ways, each pinned below against the thing it would break:
 *
 *   - `release.yml` still installs, or publishes, through npm: the release would resolve a different tree than
 *     the one the lockfile records, or publish through a tool nobody rehearsed;
 *   - the provenance request reaches one of the two steps that need it but not the other, so the dry run
 *     proves a publish the real one does not make;
 *   - the isolation gate installs the tarballs with pnpm, which proves nothing about the stranger who runs
 *     `npm install a11ign`, or packs with npm, which checks a tarball nobody publishes;
 *   - a packed `package.json` carries `workspace:` (installs for nobody), or an internal range the sibling
 *     packed beside it does not satisfy (npm answers that from the REGISTRY, silently, and the consumer runs a
 *     different copy than the one that was tested);
 *   - `package-lock.json` is deleted and a script still reads it, so a question that used to say "yes, install"
 *     now says "no" forever and nothing fails.
 *
 * What none of this can show is the signing itself, or that the runner's npm accepts an OIDC token: those
 * happen only on a real publish, which this row does not make. The dry run's rehearsal step is what reaches as
 * far as a dry run can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { checkIsolation, packedRangeProblems, satisfies } from "../../../guards/src/isolation-gate.mjs";
import { pnpmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import { refusal } from "../../../../scripts/release-publish-rehearsal.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(join(REPO, path), "utf8");

interface Step { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> }
const releaseSteps = (): Step[] =>
  (parse(read(".github/workflows/release.yml")) as { jobs: { release: { steps: Step[] } } }).jobs.release.steps;
const stepNamed = (fragment: string): Step => {
  const found = releaseSteps().filter((step) => (step.name ?? "").includes(fragment));
  assert.equal(found.length, 1, `exactly one release step should be named like "${fragment}", found ${found.length}`);
  return found[0];
};
const commandLines = (step: Step): string[] =>
  (step.run ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));

// --- release.yml -----------------------------------------------------------------------------------------

test("#2301: the release job installs with pnpm, frozen, with pnpm on PATH before setup-node asks for its cache", () => {
  const steps = releaseSteps();
  const setup = steps.findIndex((step) => (step.uses ?? "").startsWith("pnpm/action-setup@"));
  const node = steps.findIndex((step) => (step.uses ?? "").startsWith("actions/setup-node@"));
  assert.ok(setup >= 0 && node >= 0, "positive control: both setup steps are found");
  assert.ok(setup < node, "`cache: pnpm` shells out to pnpm, so it must already be installed");
  assert.equal(steps[node].with?.cache, "pnpm");
  assert.equal(steps[node].with?.["registry-url"], "https://registry.npmjs.org",
    "registry-url is what writes the .npmrc npm publishes with");
  const installs = steps.flatMap(commandLines).filter((line) => /\b(npm|pnpm) (ci|install)\b/.test(line));
  assert.ok(installs.includes("pnpm install --frozen-lockfile"));
  assert.deepEqual(installs.filter((line) => line !== "pnpm install --frozen-lockfile"), [],
    "no other install: an npm one resolves a tree the lockfile does not describe");
});

test("#2301: nothing in the release job runs npx, which would pick its own tool", () => {
  const offenders = releaseSteps().flatMap(commandLines).filter((line) => /\bnpx\b/.test(line));
  assert.deepEqual(offenders, []);
  assert.ok(releaseSteps().flatMap(commandLines).some((line) => line.startsWith("pnpm exec changeset ")),
    "positive control: the changeset steps are still there, run through pnpm");
});

test("#2301: the Publish step runs `pnpm exec changeset publish`, gated as before, with provenance and NO token", () => {
  const publish = stepNamed("Publish");
  assert.match(publish.run ?? "", /^pnpm exec changeset publish/);
  assert.match(publish.run ?? "", /inputs\.dist-tag/, "the dist-tag channel must still reach the command");
  assert.equal(publish.if, "inputs.dry-run == false && inputs.confirm == 'publish-for-real'");
  assert.equal(publish.env?.NPM_CONFIG_PROVENANCE, "true");
  assert.equal("NODE_AUTH_TOKEN" in (publish.env ?? {}), false,
    "the trusted-publisher OIDC path is only exercised while no registry token is set");
});

test("#2301: the dry run REHEARSES the pnpm-to-npm hand-off with the same provenance variable, and only on a dry run", () => {
  const rehearsal = stepNamed("pnpm-to-npm publish hand-off");
  assert.equal(rehearsal.if, "inputs.dry-run == true", "a real publish must not also rehearse itself");
  assert.equal(rehearsal.env?.NPM_CONFIG_PROVENANCE, stepNamed("Publish").env?.NPM_CONFIG_PROVENANCE,
    "the rehearsal must be handed the SAME request the publish is, or it shows a different publish");
  assert.equal(rehearsal.run, "node scripts/release-publish-rehearsal.mjs");
  const names = releaseSteps().map((step) => step.name ?? "");
  assert.ok(names.indexOf(rehearsal.name as string) > names.findIndex((n) => n.startsWith("Pack every package")),
    "the rehearsal comes after the pack: it hands the packed set on");
});

test("#2301: `release:version` refreshes the pnpm lockfile, and the release commit stages that one", () => {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  assert.equal(scripts["release:version"], "changeset version && pnpm install --lockfile-only");
  const bump = read("scripts/release-commit-version-bump.mjs");
  assert.match(stripComments(bump), /"pnpm-lock\.yaml"/);
});

// --- the isolation gate ----------------------------------------------------------------------------------

test("#2301: the gate PACKS with pnpm and INSTALLS with npm, and never the other way about", () => {
  const code = stripComments(read("packages/guards/src/isolation-gate.mjs"));
  assert.match(code, /runPnpm\(\["pack", "--pack-destination"/, "the tarballs the consumer receives are pnpm's");
  assert.match(code, /runPnpm\(\["pack", "--dry-run", "--json"\]/, "what ships is asked of the tool that ships it");
  assert.match(code, /runNpm\(\["install", "--silent", "--no-workspaces"/, "the stranger installs with npm");
  assert.doesNotMatch(code, /runNpm\(\["pack"/, "an npm pack would check a tarball nobody publishes");
  assert.doesNotMatch(code, /runPnpm\(\["(install|add)"/, "a pnpm install would prove the wrong thing about a consumer");
});

test("satisfies: the four spellings changesets writes, and `null` for anything else", () => {
  assert.equal(satisfies("0.1.0", "0.1.0"), true);
  assert.equal(satisfies("0.1.1", "0.1.0"), false, "an exact range is exact");
  assert.equal(satisfies("0.1.5", "^0.1.0"), true);
  assert.equal(satisfies("0.2.0", "^0.1.0"), false, "a caret on 0.x holds the minor");
  assert.equal(satisfies("0.0.4", "^0.0.3"), false, "a caret on 0.0.x holds the patch");
  assert.equal(satisfies("1.9.0", "^1.2.3"), true);
  assert.equal(satisfies("2.0.0", "^1.2.3"), false);
  assert.equal(satisfies("1.2.9", "~1.2.3"), true);
  assert.equal(satisfies("1.3.0", "~1.2.3"), false);
  assert.equal(satisfies("1.2.3", ">=1.0.0"), true);
  assert.equal(satisfies("0.9.0", ">=1.0.0"), false);
  for (const unreadable of ["*", "latest", "workspace:*", "1.x", "^1.2.3 || ^2", "1.0.0-beta.1"]) {
    assert.equal(satisfies("1.2.3", unreadable), null, `${unreadable} must be UNVERIFIABLE, not assumed satisfied`);
  }
});

test("packedRangeProblems: workspace: protocol, an unreadable range and an excluded sibling are each named", () => {
  const evidence = { name: "@a11ign/evidence", version: "0.1.0" };
  const sound = { name: "@a11ign/judge", version: "0.1.0", dependencies: { "@a11ign/evidence": "0.1.0", left: "^1.0.0" } };
  assert.deepEqual(packedRangeProblems([sound, evidence]), [], "CONTROL: the shape a release produces passes");
  const workspace = { ...sound, dependencies: { "@a11ign/evidence": "workspace:*" } };
  assert.match(packedRangeProblems([workspace, evidence])[0], /judge -> @a11ign\/evidence@workspace:\*: the workspace: protocol/);
  const stale = { ...sound, dependencies: { "@a11ign/evidence": "0.0.0" } };
  assert.match(packedRangeProblems([stale, evidence])[0], /packed beside it is 0\.1\.0, which that range excludes/);
  const vague = { ...sound, peerDependencies: { "@a11ign/evidence": "*" } , dependencies: {} };
  assert.match(packedRangeProblems([vague, evidence])[0], /not a range this gate can check/);
  const optionalAbsent = { ...sound, dependencies: {}, optionalDependencies: { "@a11ign/pdf": "workspace:^" } };
  assert.equal(packedRangeProblems([optionalAbsent]).length, 1, "workspace: is refused even when the sibling is not in the pack set");
});

/** Two packages in a scratch directory, `range-user` depending on its sibling `range-leaf` at `range` (the gate finds a sibling by directory name). */
function withSiblingPair(range: string, run: (user: string) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-range-")));
  try {
    for (const [dir, manifest] of [
      ["range-leaf", { name: "@a11ign/range-leaf", version: "1.0.0", main: "index.js", files: ["index.js"] }],
      ["range-user", { name: "@a11ign/range-user", version: "1.0.0", main: "index.js", files: ["index.js"],
        dependencies: { "@a11ign/range-leaf": range } }],
    ] as const) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
      writeFileSync(join(root, dir, "index.js"), "module.exports = 1;\n");
    }
    writeFileSync(join(root, "range-user", "isolation-smoke.mjs"), "console.log('unreached when the ranges are wrong');\n");
    run(join(root, "range-user"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("#2301: the real gate REFUSES a tarball whose internal range excludes the sibling packed beside it", () => {
  withSiblingPair("^2.0.0", (a) => {
    const verdict = checkIsolation(a);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.stage, "ranges", `refused at the range check, before npm was asked to install: ${verdict.detail}`);
    assert.match(verdict.detail, /range-user -> @a11ign\/range-leaf@\^2\.0\.0.*excludes/);
  });
});

test("#2301 CONTROL: the same pair with a satisfied range gets PAST the range check", () => {
  withSiblingPair("^1.0.0", (a) => {
    const verdict = checkIsolation(a);
    assert.notEqual(verdict.stage, "ranges", `a satisfied range must not be refused as a range: ${verdict.detail}`);
  });
});

// --- pnpmCliInvocation -----------------------------------------------------------------------------------

/** Runs `fn` with PATH and `npm_execpath` set, and puts both back. */
function withEnvironment(env: { PATH: string; npm_execpath?: string }, fn: () => void): void {
  const saved = { PATH: process.env.PATH, npm_execpath: process.env.npm_execpath };
  process.env.PATH = env.PATH;
  if (env.npm_execpath === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = env.npm_execpath;
  try {
    fn();
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.npm_execpath === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = saved.npm_execpath;
  }
}

function withBin(names: string[], run: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "a11y-pnpm-bin-")));
  try {
    for (const name of names) writeFileSync(join(dir, name), "#!/bin/sh\n");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("pnpmCliInvocation: a pnpm on PATH is spawned as it is, with the arguments unchanged", () => {
  withBin(["pnpm"], (dir) => withEnvironment({ PATH: dir }, () => {
    assert.deepEqual(pnpmCliInvocation(["pack", "--json"]), { command: join(dir, "pnpm"), args: ["pack", "--json"] });
  }));
});

test("pnpmCliInvocation: with no pnpm but a corepack, it is `corepack pnpm <args>`", () => {
  withBin(["corepack"], (dir) => withEnvironment({ PATH: dir }, () => {
    assert.deepEqual(pnpmCliInvocation(["install"]), { command: join(dir, "corepack"), args: ["pnpm", "install"] });
  }));
});

test("pnpmCliInvocation: a pnpm that started THIS process wins over PATH, so no other pnpm is picked up", () => {
  withBin(["pnpm.cjs", "pnpm"], (dir) => withEnvironment({ PATH: dir, npm_execpath: join(dir, "pnpm.cjs") }, () => {
    assert.deepEqual(pnpmCliInvocation(["--version"]), { command: process.execPath, args: [join(dir, "pnpm.cjs"), "--version"] });
  }));
});

test("pnpmCliInvocation: an npm_execpath that is npm's is ignored, not trusted", () => {
  withBin(["npm-cli.js", "pnpm"], (dir) => withEnvironment({ PATH: dir, npm_execpath: join(dir, "npm-cli.js") }, () => {
    assert.equal(pnpmCliInvocation(["-v"]).command, join(dir, "pnpm"));
  }));
});

test("pnpmCliInvocation: a Windows `.cmd` shim is NEVER spawned -- its script runs through node (CVE-2024-27980)", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "a11y-pnpm-cmd-")));
  try {
    writeFileSync(join(dir, "pnpm.cmd"), "@echo off\r\n");
    mkdirSync(join(dir, "node_modules", "pnpm", "bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pnpm", "bin", "pnpm.cjs"), "");
    withEnvironment({ PATH: dir }, () => {
      const invocation = pnpmCliInvocation(["pack"]);
      assert.equal(invocation.command, process.execPath);
      assert.deepEqual(invocation.args, [join(dir, "node_modules", "pnpm", "bin", "pnpm.cjs"), "pack"]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pnpmCliInvocation: with nothing to run, it throws naming what was tried and the remedy", () => {
  withBin([], (dir) => withEnvironment({ PATH: dir }, () => {
    assert.throws(() => pnpmCliInvocation(["-v"]), /neither `pnpm` nor `corepack` is on PATH.*corepack enable/s);
  }));
});

// --- the rehearsal ---------------------------------------------------------------------------------------

test("the rehearsal refuses without the provenance request, and when npm does not see it", () => {
  assert.equal(refusal({ NPM_CONFIG_PROVENANCE: "true" }, "true"), null, "CONTROL: both readings agree, it runs");
  assert.match(refusal({}, "true") ?? "", /NPM_CONFIG_PROVENANCE is undefined/);
  assert.match(refusal({ NPM_CONFIG_PROVENANCE: "false" }, "false") ?? "", /not "true"/);
  assert.match(refusal({ NPM_CONFIG_PROVENANCE: "true" }, "false") ?? "", /does not reach it/,
    "the variable set but not read by npm is exactly the case this step exists for");
});

// --- package-lock.json is gone, and nothing still reads it -----------------------------------------------

/** Files that NAME the old lockfile as data: what they assert about, or plant as, a path that must not exist. */
const NAMES_IT_AS_DATA = new Set([
  "packages/lab/src/packaging/pnpm-publish-path.test.ts",
  "packages/lab/src/packaging/ci-installs-with-pnpm.test.ts",
  "packages/lab/src/repo/lockfile-in-sync.test.ts",
  "packages/lab/src/packaging/row-claim-file-overlap-rule.test.ts",
]);

test("#2301: package-lock.json is deleted, and no source under .github, scripts or packages still reads it", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ".github", "scripts", "packages"],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() }).split("\0").filter(Boolean);
  const scanned = tracked.filter((file) => /\.(mjs|cjs|js|ts|ya?ml|json)$/.test(file));
  assert.ok(scanned.length > 500, "the git listing returned almost nothing: it is broken, not the repo clean");
  // `(?<![.\w])` so npm's HIDDEN `node_modules/.package-lock.json`, which the Ansible one-time migration
  // looks for on purpose, is a different name.
  const readers = scanned.filter((file) => !NAMES_IT_AS_DATA.has(file))
    .filter((file) => /(?<![.\w])package-lock\.json/.test(stripComments(readFileSync(join(REPO, file), "utf8"))));
  assert.deepEqual(readers, [], "these still name package-lock.json in code, and nothing produces it any more");
  assert.throws(() => readFileSync(join(REPO, "package-lock.json")), /ENOENT/);
});
