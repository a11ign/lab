/**
 * #2875 (child 5d-3 of #69): EVERY MODULE THAT MEANS THE PROJECT'S ROOT TAKES `HOME_CHECKOUT`, NOT `src` UP THREE.
 *
 * #2873 made `HOME_CHECKOUT` the host file's primary checkout, but six modules still computed their own project root from
 * `import.meta.url`, so the extracted gate, run standalone with `$AGENT_ORG_HOST` set, read the home directory for lanes, owned-path
 * facts, git calls and review checkouts even once the import no longer died.
 *
 *   1. A SCAN of the non-test `packages/agent-org/src/*.mjs` finds no `import.meta.url` resolved three levels up in either of the two
 *      shapes the tree spells it, except `project-config.mjs`'s own `beside` (the named `SELF`). The scan flags a fixture string of
 *      each shape first, so an empty result is not an empty scan.
 *   2. A CHILD `node` per module, with `$AGENT_ORG_HOST` naming a fixture host whose primary checkout is a scratch directory and `src`
 *      copied to `<scratch>/tool/src`, prints the root-derived value, and it names the fixture checkout and not the directory above
 *      `tool`. With the variable unset the in-tree value is the product checkout, as before.
 *
 * NOT SCANNED, AND WHY: `new URL("../../../", import.meta.url)` with a TRAILING SLASH is a third spelling of the same thing, in
 * `board-snapshot-scope.mjs`, `host-units.mjs` and `update-primary.mjs`. They are outside #2875's Region and are filed as #2879; a scan that matched them would be a red assertion on `main`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_ENV } from "../../../agent-org/src/project-config.mjs";
import { sandboxGitEnv } from "../../../agent-org/src/lib/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const SRC = join(REPO, "packages/agent-org/src");
const CHILD_TIMEOUT_MS = 60_000;

/** The one file allowed to spell it: `resolveHomeCheckout`'s `beside`, the in-tree answer when `$AGENT_ORG_HOST` is unset. */
const SELF = { file: "project-config.mjs", reason: "it IS the one place the tool finds itself: `beside` is HOME_CHECKOUT's in-tree default" };

/** `import.meta.url` resolved three levels up: `resolve(dirname(fileURLToPath(import.meta.url)), "../../..")` or `new URL("../../..", import.meta.url)`. */
const UP_THREE_FROM_URL = /\bimport\.meta\.url\)\s*\)?,\s*"\.\.\/\.\.\/\.\."|\bnew URL\(\s*"\.\.\/\.\.\/\.\."\s*,\s*import\.meta\.url/;

function upThreeSpellings(source: string): boolean {
  return UP_THREE_FROM_URL.test(source);
}

const nonTestModules = (): string[] =>
  readdirSync(SRC).filter((name) => name.endsWith(".mjs") && !/\.test\./.test(name));

test("POSITIVE CONTROL: the scan flags a fixture string of each of the two shapes", () => {
  assert.equal(upThreeSpellings('const R = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");'), true);
  assert.equal(upThreeSpellings('const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");'), true);
  assert.equal(upThreeSpellings('const R = new URL("../../..", import.meta.url).pathname;'), true);
  assert.equal(upThreeSpellings('const R = fileURLToPath(new URL("../../..", import.meta.url));'), true);
  assert.equal(upThreeSpellings('const own = new URL("./board-report.mjs", import.meta.url);'), false, "a path inside src is the tool's own location");
  assert.equal(upThreeSpellings('const R = HOME_CHECKOUT;'), false);
});

test("the scan reads a real population, and it contains SELF (so SELF's exemption is the only thing between it and green)", () => {
  const modules = nonTestModules();
  assert.ok(modules.length > 50, `only ${modules.length} modules scanned`);
  assert.ok(modules.includes(SELF.file));
  assert.equal(upThreeSpellings(readFileSync(join(SRC, SELF.file), "utf8")), true, `SELF no longer spells it: ${SELF.reason}`);
});

test("no non-test packages/agent-org/src/*.mjs resolves import.meta.url three levels up, except SELF", () => {
  const offenders = nonTestModules()
    .filter((name) => name !== SELF.file)
    .filter((name) => upThreeSpellings(readFileSync(join(SRC, name), "utf8")));
  assert.deepEqual(offenders, [], "each should take HOME_CHECKOUT from project-config.mjs");
});

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "standalone-roots-"));
  scratchDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

const FIXTURE_LANES = { lanes: [{ lane: "fixture-lane", owner: "fixture-owner", branchPrefixes: ["fx/"], paths: ["fx/"], why: "fixture" }] };
const FIXTURE_FACTS = { owned: ["fixture-owned/"], facts: [{ id: "fixture-fact", states: ["x"] }] };
const FIXTURE_ROOT_FILE = "FIXTURE-ROOT-FILE.md";

/** A scratch project: a declaration, the two owner-maintained files, and a git history holding one root file. */
function fixtureProject(): string {
  const checkout = join(scratch(), "fixture-project");
  mkdirSync(join(checkout, ".agent-org"), { recursive: true });
  mkdirSync(join(checkout, "docs"), { recursive: true });
  cpSync(join(REPO, ".agent-org/project.json"), join(checkout, ".agent-org/project.json"));
  // `cause-declaration.mjs` requires the plugin the declaration names at import. a11ign's imports the product's `src` by relative
  // path, which a second project does not have, so the fixture project brings a plugin of its own, declaring no causes.
  cpSync(join(REPO, ".agent-org/roles"), join(checkout, ".agent-org/roles"), { recursive: true }); // `project-roles.mjs` refuses a project without its role briefs
  mkdirSync(join(checkout, ".agent-org/plugins"), { recursive: true });
  writeFileSync(join(checkout, ".agent-org/plugins/causes.mjs"), "export const causeDeclarations = [];\n");
  writeFileSync(join(checkout, "docs/lane-ownership.json"), JSON.stringify(FIXTURE_LANES));
  writeFileSync(join(checkout, "docs/owned-path-facts.json"), JSON.stringify(FIXTURE_FACTS));
  writeFileSync(join(checkout, FIXTURE_ROOT_FILE), "x\n");
  const git = (...args: string[]) => {
    const run = spawnSync("git", ["-C", checkout, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8", env: sandboxGitEnv() });
    assert.equal(run.status, 0, run.stderr);
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return checkout;
}

/** `src` copied as the standalone repository lays it out, tests left behind: `<scratch>/tool/src`. */
function standaloneTree(): { src: string; aboveTool: string } {
  const aboveTool = scratch();
  const src = join(aboveTool, "tool", "src");
  cpSync(SRC, src, { recursive: true, filter: (from) => !/\.test\.[mc]?[jt]s$/.test(from) });
  return { src, aboveTool };
}

/** a11ign's own host file with its primary replaced: `wake` and `work-gate` read the whole file at import (`home`, `binDir`, `gh`), not only the primary. */
function writeHost(checkout: string): string {
  const path = join(scratch(), "host.json");
  const host = JSON.parse(readFileSync(join(REPO, ".agent-org/host.json"), "utf8"));
  writeFileSync(path, JSON.stringify({ ...host, primary: "acme", projects: [{ id: "acme", checkout }] }));
  return path;
}

/** One module's root-derived value, as the child prints it. `answer` runs in the child with the module imported as `m`. */
type Module = { name: string; file: string; answer: string; expectedInFixture: (checkout: string) => unknown; expectedInTree: unknown };

const MODULES: Module[] = [
  { name: "board-data ROOT", file: "board-data.mjs", answer: "m.ROOT",
    expectedInFixture: (checkout) => checkout, expectedInTree: REPO },
  { name: "lane-ownership loadLanes()", file: "lane-ownership.mjs", answer: "m.loadLanes()?.lanes.map((l) => l.lane)",
    expectedInFixture: () => ["fixture-lane"], expectedInTree: JSON.parse(readFileSync(join(REPO, "docs/lane-ownership.json"), "utf8")).lanes.map((l: { lane: string }) => l.lane) },
  { name: "owned-path-signoff loadFacts()", file: "owned-path-signoff.mjs", answer: "m.loadFacts()?.owned",
    expectedInFixture: () => FIXTURE_FACTS.owned, expectedInTree: JSON.parse(readFileSync(join(REPO, "docs/owned-path-facts.json"), "utf8")).owned },
  { name: "region-paths rootFilesOnMain()", file: "region-paths.mjs", answer: `m.rootFilesOnMain().files.has(${JSON.stringify(FIXTURE_ROOT_FILE)})`,
    expectedInFixture: () => true, expectedInTree: false },
  { name: "wake REPO_ROOT", file: "wake.mjs", answer: "m.REPO_ROOT",
    expectedInFixture: (checkout) => checkout, expectedInTree: REPO },
  { name: "work-gate REPO_CHECKOUT", file: "work-gate.mjs", answer: "m.REPO_CHECKOUT",
    expectedInFixture: (checkout) => checkout, expectedInTree: REPO },
];

/** Import `<src>/<file>` in a child and print `answer` as JSON. `host` undefined removes `$AGENT_ORG_HOST` whatever this process holds. */
function readIn(src: string, module: Module, host: string | undefined): unknown {
  const env = { ...process.env };
  delete env[HOST_ENV];
  if (host !== undefined) env[HOST_ENV] = host;
  const program = `const m = await import(${JSON.stringify(join(src, module.file))}); console.log(JSON.stringify(${module.answer}));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], { env, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
  assert.equal(child.status, 0, `${module.name}: the child failed:\n${child.stderr}`);
  return JSON.parse(child.stdout.trim().split("\n").at(-1) as string);
}

for (const module of MODULES) {
  test(`${module.name}: with $AGENT_ORG_HOST set, the fixture checkout and not the directory above tool/`, () => {
    const checkout = fixtureProject();
    const { src, aboveTool } = standaloneTree();
    const got = readIn(src, module, writeHost(checkout));
    assert.deepEqual(got, module.expectedInFixture(checkout));
    assert.notDeepEqual(got, aboveTool, "that is the up-three answer");
  });

  test(`${module.name}: with the variable unset the in-tree value is unchanged`, () => {
    assert.deepEqual(readIn(SRC, module, undefined), module.expectedInTree);
  });
}
