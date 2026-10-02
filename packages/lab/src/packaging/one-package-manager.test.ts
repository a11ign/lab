/**
 * THE LOCK: A MIXED TREE CANNOT COME BACK (#2897, row 10 of 10 of "Finish the move to pnpm", #57's follow-through).
 *
 * An untracked `package-lock.json` sat in the primary checkout after the move to pnpm: someone ran `npm install` and nothing
 * said no. Three halves make the old way a refusal instead of a habit, and this file holds each to what it claims:
 *
 *   1. the root `preinstall` runs `scripts/refuse-other-installers.mjs`, which refuses any installer whose user agent is not
 *      pnpm's (an unknown one included: unknown is not pnpm), naming pnpm and the `packageManager` pin. The CHECK fetches nothing
 *      (it imports built-ins and `cli-flags.mjs` by relative path, and no network-capable built-in: read below). What npm had
 *      already fetched BEFORE it ran the check is a limit of every lifecycle script, pinned below as the positive control
 *      for the next half;
 *   2. `engines.npm` in the root manifest (a range no npm satisfies, whose text names pnpm) plus `engine-strict=true` in the root
 *      `.npmrc` (#2958): npm checks `engines` BEFORE it fetches, so with the switch on it stops with EBADENGINE having written
 *      neither `node_modules` nor a lockfile. Either alone refuses nothing (without the switch npm only warns);
 *   3. `package-lock.json` and `npm-shrinkwrap.json` are ignored, and a TRACKED one is refused, which an ignore alone does not
 *      prevent (`git add -f`, or an add made before the ignore).
 *
 * THE POSITIVE CONTROLS, so that neither half passes by examining nothing:
 *
 *   - the REAL root manifest carries the `preinstall` entry and the `engines.npm` entry, the REAL `.npmrc` carries the switch, and
 *     the fixture installs below copy THOSE rather than retyping them, so deleting one fails here and does not merely stop
 *     being exercised;
 *   - the fixture WITHOUT the switch is refused by the `preinstall` alone, AFTER npm has installed: the early refusal is shown
 *     to be the switch's doing and not the script's;
 *   - the real pnpm, started for real, runs the script and it passes (`pnpm install` and `pnpm exec`), and the real npm,
 *     started for real, is refused: the user agents are not only strings in a table;
 *   - the tracked-lockfile detector refuses a lock really `git add`-ed in a sandbox repository and passes the same tree with
 *     the lock merely untracked, so it is shown to fire and to stay quiet; the real tree is then read with the same function.
 *
 * ONE HAZARD THE ENVIRONMENT HANDS A TEST: `npm` reads `npm_config_*` from its own environment as configuration, so a child
 * `npm` started from inside a pnpm run INHERITS `npm_config_user_agent=pnpm/...`, reports itself as pnpm to the script, and
 * the lock passes where it must refuse. Every child here has that variable (and `npm_execpath`) scrubbed first, and the test
 * "an npm started from inside a pnpm run" pins that the scrub is what makes the refusal real. The same inheritance means the
 * lock is a refusal of a PERSON typing `npm install`, not of a script that spawns it from a pnpm run, and the second is
 * `no-npm-spawn.test.ts`'s population, not this one's.
 *
 * WHAT IT MUST NOT CATCH, pinned below: the registry gates and the isolation gate run `npm install a11ign` / `npm publish` on
 * purpose, in a temporary directory with no root manifest, so `preinstall` never sees them. That stays true only while their
 * directories are not under this manifest, which is read from the code that makes them and from the filesystem above the
 * temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { tempDir } from "../../../guards/src/test-tmp.mjs";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import { npmCliInvocation, pnpmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import { refusalFor } from "../../../../scripts/refuse-other-installers.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT_PATH = "scripts/refuse-other-installers.mjs";
const SCRIPT = join(REPO, SCRIPT_PATH);
const MANIFEST = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts?: Record<string, string>; engines?: Record<string, string> };
const NPMRC_PATH = ".npmrc";
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];

// ---- the user agents -----------------------------------------------------------------------------------------------------

/** What pnpm sets for the scripts it runs, as measured (`pnpm/10.34.5 npm/? node/v22.22.1 linux x64`), and Windows' spelling. */
const PNPM_AGENTS = [
  "pnpm/10.34.5 npm/? node/v22.22.1 linux x64",
  "pnpm/10.34.5 npm/? node/v22.22.1 win32 x64",
];

/** Every way an install can be started by something that is not pnpm, and the ways that merely MENTION it. */
const REFUSED_AGENTS: ReadonlyArray<[label: string, agent: string | undefined]> = [
  ["npm", "npm/10.9.2 node/v22.22.1 linux x64 workspaces/false"],
  ["yarn", "yarn/1.22.22 npm/? node/v22.22.1 linux x64"],
  ["bun", "bun/1.1.0 npm/? node/v22.22.1 linux x64"],
  ["an empty agent", ""],
  ["a blank agent", "   "],
  ["a MISSING agent (unknown is not pnpm)", undefined],
  ["npm, with pnpm later in the string", "npm/10.9.2 node/v22.22.1 linux x64 pnpm/10.34.5"],
  ["a name that only ends in pnpm", "not-pnpm/10.34.5 node/v22.22.1"],
  ["the bare word, with no version", "pnpm"],
];

/** The environment a child sees: ours, minus everything npm and pnpm put there, plus the agent under test (absent when `undefined`). */
function envWith(agent: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^npm_/i.test(name)) delete env[name];
  if (agent !== undefined) env.npm_config_user_agent = agent;
  return env;
}

function runScript(agent: string | undefined): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: envWith(agent) });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

test("every refused user agent is REFUSED with a message that names pnpm and the packageManager pin", () => {
  for (const [label, agent] of REFUSED_AGENTS) {
    const message = refusalFor(agent);
    assert.notEqual(message, null, `${label} was let through`);
    assert.match(message ?? "", /pnpm install/, `${label}: the refusal does not name the fix`);
    assert.match(message ?? "", /`packageManager`/, `${label}: the refusal does not name the packageManager pin`);
  }
});

test("a pnpm user agent PASSES, in the Linux and the Windows spelling", () => {
  for (const agent of PNPM_AGENTS) assert.equal(refusalFor(agent), null, agent);
});

test("the script as a PROGRAM exits non-zero for each refused agent and zero for pnpm's, with the message on stderr", () => {
  for (const [label, agent] of REFUSED_AGENTS) {
    const run = runScript(agent);
    assert.equal(run.status, 1, `${label}: exit status`);
    assert.equal(run.stderr.trim(), refusalFor(agent), `${label}: the program printed something other than the refusal`);
    assert.equal(run.stdout, "", `${label}: a refusal writes nothing to stdout`);
  }
  for (const agent of PNPM_AGENTS) {
    const run = runScript(agent);
    assert.deepEqual({ status: run.status, stderr: run.stderr }, { status: 0, stderr: "" }, agent);
  }
});

// ---- it fetches nothing ----------------------------------------------------------------------------------------------------

/** Every module specifier a source imports, static or dynamic, and every `require`. */
function importsOf(code: string): string[] {
  const statics = [...code.matchAll(/^\s*import\b(?:[^"'`;]*?\sfrom\s*)?["'`]([^"'`]+)["'`]/gm)].map((match) => match[1]);
  const dynamics = [...code.matchAll(/\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
  return [...statics, ...dynamics];
}

/** Built-ins that can reach a network or start another program: this script has no use for any of them. */
const REACHING_OUT = /^node:(https?|http2|net|dns|tls|dgram|child_process|worker_threads|cluster|inspector|vm)(\/|$)/;

/** What a specifier may be in a file that runs before `node_modules` exists: a `node:` built-in, or the one relative file named. */
function outsideTheAllowance(specifier: string, relativeAllowed: readonly string[]): boolean {
  if (specifier.startsWith("node:")) return REACHING_OUT.test(specifier);
  return !relativeAllowed.includes(specifier);
}

const CLI_FLAGS = "../packages/worker-fleet/src/cli-flags.mjs";

test("the script fetches nothing: its imports are built-ins and cli-flags.mjs by relative path, and nothing calls fetch", () => {
  const code = stripComments(readFileSync(SCRIPT, "utf8"));
  assert.deepEqual(importsOf(code).filter((specifier) => outsideTheAllowance(specifier, [CLI_FLAGS])), []);
  assert.doesNotMatch(code, /\bfetch\b|\bprocess\.binding\b/);
  assert.ok(importsOf(code).includes(CLI_FLAGS), "the script no longer imports cli-flags.mjs: update this test and the header, which say it does");
  // The file it reaches runs before node_modules exists too, so it is held to the same allowance (built-ins only, none reaching out).
  const reached = stripComments(readFileSync(join(REPO, "packages/worker-fleet/src/cli-flags.mjs"), "utf8"));
  assert.deepEqual(importsOf(reached).filter((specifier) => outsideTheAllowance(specifier, [])), []);
});

test("the control for the line above: the same reading REFUSES a package, a network built-in, a dynamic import, a require and fetch", () => {
  const fixture = [
    'import { x } from "left-pad";',
    'import https from "node:https";',
    'import { spawn } from "node:child_process";',
    'import { y } from "../other.mjs";',
    'const m = await import("zod");',
    'const r = require("node:net");',
    'import { realpathSync } from "node:fs";',
    'import { refuseUnknownFlags } from "../packages/worker-fleet/src/cli-flags.mjs";',
  ].join("\n");
  assert.deepEqual(importsOf(fixture).filter((specifier) => outsideTheAllowance(specifier, [CLI_FLAGS])),
    ["left-pad", "node:https", "node:child_process", "../other.mjs", "zod", "node:net"]);
  assert.match('fetch("https://registry.npmjs.org/only-allow")', /\bfetch\b/);
});

test("a checkout reached through a SYMLINK still runs the check: the entry guard resolves the real path and does not switch itself off", () => {
  const dir = tempDir("one-package-manager-link-");
  const link = join(dir, "checkout");
  symlinkSync(REPO, link);
  const run = spawnSync(process.execPath, [join(link, SCRIPT_PATH)], { encoding: "utf8", env: envWith("npm/10.9.2 node/v22.22.1 linux x64") });
  assert.equal(run.status, 1, `through a symlink the check did not run: ${run.stdout}${run.stderr}`);
  assert.equal(run.stderr.trim(), refusalFor("npm/10.9.2 node/v22.22.1 linux x64"));
});

// ---- the manifest carries it, and the next session cannot take it out silently ---------------------------------------------

test("the REAL root manifest carries a preinstall that runs the script, and the script exists", () => {
  assert.equal(MANIFEST.scripts?.preinstall, `node ${SCRIPT_PATH}`);
  assert.ok(existsSync(SCRIPT), `${SCRIPT_PATH} is named by preinstall and is not on disk`);
});

// ---- the real installers, started for real --------------------------------------------------------------------------------

/** Which of the repository's refusals a fixture carries: both of them, or the `preinstall` alone (no `engines.npm`, no `.npmrc`). */
type Lock = "whole" | "preinstall-only";

/**
 * A directory holding a manifest with the REAL `preinstall` entry (and, for the whole lock, the REAL `engines` and `.npmrc`), a copy
 * of the real script where that entry says and what it imports, and ONE `file:` dependency so an installer has something to
 * install without any network: an install target.
 */
function installFixture(lock: Lock = "whole"): string {
  const dir = tempDir("one-package-manager-");
  const manifest = { name: "fixture", version: "0.0.0", private: true, scripts: { preinstall: MANIFEST.scripts?.preinstall },
    ...(lock === "whole" ? { engines: MANIFEST.engines } : {}), dependencies: { left: "file:./left" } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  if (lock === "whole") copyFileSync(join(REPO, NPMRC_PATH), join(dir, NPMRC_PATH));
  mkdirSync(join(dir, "left"));
  writeFileSync(join(dir, "left", "package.json"), JSON.stringify({ name: "left", version: "1.0.0" }));
  // The script's one relative import comes along, at the path it names, and `node_modules` is NOT: a fresh checkout has none.
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "packages", "worker-fleet", "src"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, SCRIPT_PATH));
  copyFileSync(join(REPO, "packages/worker-fleet/src/cli-flags.mjs"), join(dir, "packages/worker-fleet/src/cli-flags.mjs"));
  return dir;
}

function install(tool: { command: string; args: string[] }, dir: string, env: NodeJS.ProcessEnv) {
  return spawnSync(tool.command, tool.args, { cwd: dir, encoding: "utf8", env, timeout: 120_000 });
}

const NPM_INSTALL = ["install", "--offline", "--no-audit", "--no-fund"];

test("the REAL root manifest carries engines.npm, and the REAL .npmrc turns engine-strict on", () => {
  assert.equal(typeof MANIFEST.engines?.npm, "string", "package.json has no engines.npm: npm has nothing to refuse on");
  assert.match(MANIFEST.engines?.npm ?? "", /pnpm/, "engines.npm is the message npm prints, and it must name pnpm");
  assert.ok(existsSync(join(REPO, NPMRC_PATH)), `${NPMRC_PATH} is not on disk`);
  const switches = readFileSync(join(REPO, NPMRC_PATH), "utf8").split("\n").map((line) => line.trim()).filter((line) => /^[^#;]/.test(line));
  assert.ok(switches.includes("engine-strict=true"), `${NPMRC_PATH} does not set engine-strict=true: without it npm only warns about engines.npm`);
});

test("`npm install` is REFUSED EARLY: EBADENGINE naming pnpm, and no node_modules, no package-lock.json, no pnpm-lock.yaml", () => {
  const dir = installFixture();
  const run = install(npmCliInvocation("npm", NPM_INSTALL), dir, envWith(undefined));
  assert.notEqual(run.status, 0, `npm install succeeded: ${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /EBADENGINE/);
  assert.match(run.stderr, /pnpm/);
  for (const written of ["node_modules", "package-lock.json", "pnpm-lock.yaml"]) assert.equal(existsSync(join(dir, written)), false, `npm wrote ${written} before refusing`);
});

test("positive control: without engine-strict the preinstall alone refuses naming pnpm, but only AFTER npm has installed (the limit of a lifecycle script)", () => {
  // npm 9.2.0 on the real manifest, 2026-10-02: 226 top-level node_modules entries (350 MB) and a 362-entry lockfile, then the
  // preinstall failed the command. A `file:` dependency shows the same ORDER with no network. If this stops holding, the preinstall
  // has become an early refusal by itself, and the `.npmrc` and `engines.npm` are no longer what this file says they are for.
  const dir = installFixture("preinstall-only");
  const run = install(npmCliInvocation("npm", NPM_INSTALL), dir, envWith(undefined));
  assert.notEqual(run.status, 0, `npm install succeeded: ${run.stdout}${run.stderr}`);
  assert.doesNotMatch(run.stderr, /EBADENGINE/);
  assert.match(run.stderr, /installs with pnpm only/);
  assert.match(run.stderr, /`packageManager`/);
  assert.equal(existsSync(join(dir, "node_modules", "left")), true, "npm refused BEFORE installing without engine-strict: the limit is gone");
  assert.equal(existsSync(join(dir, "package-lock.json")), true, "npm wrote no lockfile before refusing: the limit is gone");
  assert.equal(existsSync(join(dir, "pnpm-lock.yaml")), false);
});

test("`pnpm install` SUCCEEDS under the whole lock (engine-strict and engines.npm included) and the preinstall passes under it", () => {
  const dir = installFixture();
  const run = install(pnpmCliInvocation(["install", "--offline"]), dir, envWith(undefined));
  assert.equal(run.status, 0, `pnpm install failed: ${run.stdout}${run.stderr}`);
  assert.doesNotMatch(run.stderr, /installs with pnpm only/);
  assert.equal(existsSync(join(dir, "node_modules", "left")), true, "pnpm passed the preinstall and then installed nothing");
});

test("the real pnpm sets the agent the script accepts: `pnpm exec node <script>` passes with nothing set by this test", () => {
  const dir = installFixture();
  const run = install(pnpmCliInvocation(["exec", "node", join(dir, SCRIPT_PATH)]), dir, envWith(undefined));
  assert.deepEqual({ status: run.status, stderr: run.stderr }, { status: 0, stderr: "" });
});

test("an npm started from inside a pnpm run INHERITS pnpm's agent and is let through: the scrub above is what makes the refusal real", () => {
  const dir = installFixture("preinstall-only");
  const inherited = { ...envWith(undefined), npm_config_user_agent: PNPM_AGENTS[0] };
  const run = install(npmCliInvocation("npm", ["install", "--offline", "--no-audit", "--no-fund", "--no-package-lock"]), dir, inherited);
  assert.equal(run.status, 0, "npm no longer inherits the agent, so this limit is gone: delete this test and the paragraph naming it");
});

test("the engines refusal does not read the agent at all: the same inherited-agent npm is refused under the whole lock", () => {
  const dir = installFixture();
  const inherited = { ...envWith(undefined), npm_config_user_agent: PNPM_AGENTS[0] };
  const run = install(npmCliInvocation("npm", NPM_INSTALL), dir, inherited);
  assert.notEqual(run.status, 0, `an npm inheriting pnpm's agent got through the engines refusal: ${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /EBADENGINE/);
  assert.equal(existsSync(join(dir, "node_modules")), false);
});

// ---- a tracked lockfile is refused ----------------------------------------------------------------------------------------

const LOCKFILE_PATH = /(^|\/)(package-lock|npm-shrinkwrap)\.json$/;

/** The tracked lockfiles among `git ls-files` output, in any directory: a nested package's lock is the same defect. */
function trackedLockfiles(lsFiles: string): string[] {
  return lsFiles.split("\n").filter((path) => LOCKFILE_PATH.test(path));
}

/** Everything `git ls-files` lists in `root`, one path per line. */
function trackedFiles(root: string): string {
  const run = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8", env: sandboxGitEnv() });
  assert.equal(run.status, 0, `git ls-files failed in ${root}: ${run.stderr}`);
  return run.stdout;
}

const trackedIn = (root: string): string[] => trackedLockfiles(trackedFiles(root));

test("a fixture tree with a TRACKED package-lock.json is REFUSED, and so is a shrinkwrap and a nested package's lock", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "package-lock.json"), "{}");
    writeFileSync(join(sandbox.dir, "npm-shrinkwrap.json"), "{}");
    sandbox.run(["add", "-f", "--", "package-lock.json", "npm-shrinkwrap.json"]);
    assert.deepEqual(trackedIn(sandbox.dir), ["npm-shrinkwrap.json", "package-lock.json"]);
  });
  assert.deepEqual(trackedLockfiles("packages/lab/package-lock.json\npnpm-lock.yaml\n"), ["packages/lab/package-lock.json"]);
});

test("the same lock merely UNTRACKED is not refused, and pnpm-lock.yaml and look-alike names are never", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "package-lock.json"), "{}");
    writeFileSync(join(sandbox.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(join(sandbox.dir, "my-package-lock.json"), "{}");
    sandbox.run(["add", "--", "pnpm-lock.yaml", "my-package-lock.json"]);
    assert.deepEqual(trackedIn(sandbox.dir), []);
  });
});

test("the REAL tree tracks neither (and the detector has just been shown to read a tree)", () => {
  const files = trackedFiles(REPO).split("\n").filter(Boolean);
  // The emptiness below is controlled twice over: this floor says the listing was read, and the fixture tests above plant a lock and find it.
  assert.ok(files.length > 1000, "git ls-files listed almost nothing: the listing is broken, and the tree is not thereby clean");
  assert.deepEqual(trackedLockfiles(files.join("\n")), []);
});

// ---- both are ignored ------------------------------------------------------------------------------------------------------

/** Whether git, reading the REAL `.gitignore` from a sandbox repository, ignores `path` as a file and as a symlink's target alike. */
function ignoredByRealGitignore(path: string): boolean {
  return withGitSandbox((sandbox) => {
    copyFileSync(join(REPO, ".gitignore"), join(sandbox.dir, ".gitignore"));
    const run = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: sandbox.dir, env: sandboxGitEnv() });
    assert.ok(run.status === 0 || run.status === 1, `git check-ignore failed (${run.status}): ${run.stderr}`);
    return run.status === 0;
  });
}

test("package-lock.json and npm-shrinkwrap.json are ignored, at the root and in a package", () => {
  for (const name of LOCKFILES) {
    assert.equal(ignoredByRealGitignore(name), true, `${name} is not ignored`);
    assert.equal(ignoredByRealGitignore(`packages/lab/${name}`), true, `packages/lab/${name} is not ignored`);
  }
});

test("positive control: pnpm-lock.yaml is NOT ignored, so the ignore reads the real file and is not a blanket", () => {
  assert.equal(ignoredByRealGitignore("pnpm-lock.yaml"), false);
  assert.equal(ignoredByRealGitignore("package.json"), false);
});

// ---- what the lock must NOT catch ------------------------------------------------------------------------------------------

/** Every `package.json` in `dir` and in each directory above it: the manifests a `preinstall` could be read from. */
function manifestsAtOrAbove(dir: string): string[] {
  const found: string[] = [];
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "package.json"))) found.push(join(at, "package.json"));
    if (dirname(at) === at) return found;
  }
}

test("the registry gates and the isolation gate work in a temporary directory that no manifest sits at or above", () => {
  for (const path of ["scripts/registry-consumer-gate.mjs", "packages/guards/src/isolation-gate.mjs"]) {
    assert.match(readFileSync(join(REPO, path), "utf8"), /mkdtempSync\(\s*join\(\s*tmpdir\(\)/, `${path} no longer makes its directory under os.tmpdir()`);
  }
  assert.ok(relative(REPO, tmpdir()).startsWith(".."), `os.tmpdir() (${tmpdir()}) is inside the repository, so the gates' directories would be under the root manifest`);
  assert.deepEqual(manifestsAtOrAbove(tmpdir()), [], "a package.json above os.tmpdir() would be a root manifest for every gate directory");
});

test("the control for the line above: a directory under a manifest, and a directory inside this repository, are both found to have one", () => {
  const dir = tempDir("one-package-manager-above-");
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "consumer"));
  assert.deepEqual(manifestsAtOrAbove(join(dir, "consumer")), [join(dir, "package.json")]);
  assert.ok(manifestsAtOrAbove(join(REPO, "packages", "lab")).includes(join(REPO, "package.json")));
});

// ---- a nested package is its own npm project (#2962) ----------------------------------------------------------------------

/**
 * npm takes the NEAREST `package.json` as the project, so `cd packages/lab && npm install` never reads the root's `preinstall`,
 * `engines` or `.npmrc`: the root's lock does not reach it, and the package carries the early half of its own. `packages/lab`
 * is the one PRIVATE package with dependencies. THE LIMIT, named and not fixed: the published packages with dependencies (`cli`,
 * `judge`, `nvda-worker`, `pdf`, `scorer`, `worker-fleet`) cannot take `engines.npm`, since it would refuse their consumers'
 * `npm install` too, so an `npm install` inside one of them is still not refused.
 */
const LAB_DIR = join(REPO, "packages", "lab");
const LAB_MANIFEST = JSON.parse(readFileSync(join(LAB_DIR, "package.json"), "utf8")) as { engines?: Record<string, string> };

/** Whether `.npmrc` text sets `engine-strict=true` on a line of its own, comments ignored. */
const setsEngineStrict = (npmrc: string): boolean => npmrc.split("\n").map((line) => line.trim()).includes("engine-strict=true");

/**
 * A copy of the REAL `packages/lab` manifest (its dependencies replaced by one `file:` dependency, so there is something to install
 * without a network) and, unless `withNpmrc` is false, the REAL `.npmrc` beside it. Nothing sits above it: the lab's own files are
 * all that npm may read, which is the situation the nearest-manifest rule creates.
 */
function labFixture(withNpmrc: boolean): string {
  const dir = tempDir("one-package-manager-lab-");
  const manifest = JSON.parse(readFileSync(join(LAB_DIR, "package.json"), "utf8"));
  delete manifest.devDependencies;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ ...manifest, dependencies: { left: "file:./left" } }));
  if (withNpmrc) copyFileSync(join(LAB_DIR, ".npmrc"), join(dir, ".npmrc"));
  mkdirSync(join(dir, "left"));
  writeFileSync(join(dir, "left", "package.json"), JSON.stringify({ name: "left", version: "1.0.0" }));
  return dir;
}

test("the REAL packages/lab manifest carries engines.npm naming pnpm, and its REAL .npmrc turns engine-strict on", () => {
  assert.equal(typeof LAB_MANIFEST.engines?.npm, "string", "packages/lab/package.json has no engines.npm: npm has nothing to refuse on");
  assert.match(LAB_MANIFEST.engines?.npm ?? "", /pnpm/, "engines.npm is the message npm prints, and it must name pnpm");
  assert.equal(setsEngineStrict(readFileSync(join(LAB_DIR, ".npmrc"), "utf8")), true, "packages/lab/.npmrc does not set engine-strict=true: npm only warns");
});

test("the control for the line above: the reading sees a switch that is set and one that is only commented out or set false", () => {
  assert.equal(setsEngineStrict("# why\nengine-strict=true\n"), true);
  assert.equal(setsEngineStrict("# engine-strict=true\n"), false);
  assert.equal(setsEngineStrict("engine-strict=false\n"), false);
});

test("`npm install` inside a copy of packages/lab is REFUSED EARLY: EBADENGINE, no node_modules and no lockfile", () => {
  const dir = labFixture(true);
  const run = install(npmCliInvocation("npm", NPM_INSTALL), dir, envWith(undefined));
  assert.notEqual(run.status, 0, `npm install succeeded inside the lab copy: ${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /EBADENGINE/);
  assert.match(run.stderr, /pnpm/);
  for (const written of ["node_modules", "package-lock.json", "pnpm-lock.yaml"]) assert.equal(existsSync(join(dir, written)), false, `npm wrote ${written} before refusing`);
});

test("positive control: the same copy WITHOUT engine-strict installs, so the refusal above is the switch's doing", () => {
  const dir = labFixture(false);
  const run = install(npmCliInvocation("npm", NPM_INSTALL), dir, envWith(undefined));
  assert.equal(run.status, 0, `npm install failed without the switch, so the copy is not an install target: ${run.stdout}${run.stderr}`);
  assert.equal(existsSync(join(dir, "node_modules", "left")), true);
});

test("`pnpm install` in the same copy SUCCEEDS: engines.npm and engine-strict refuse npm and not pnpm", () => {
  const dir = labFixture(true);
  const run = install(pnpmCliInvocation(["install", "--offline"]), dir, envWith(undefined));
  assert.equal(run.status, 0, `pnpm install failed in the lab copy: ${run.stdout}${run.stderr}`);
  assert.equal(existsSync(join(dir, "node_modules", "left")), true, "pnpm exited 0 and installed nothing");
});
