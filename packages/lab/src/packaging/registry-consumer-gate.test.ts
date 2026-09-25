/**
 * THE REGISTRY GATE REFUSES WHAT A CONSUMER COULD NOT RUN, AND PASSES WHAT THEY COULD -- #2519 (#69).
 *
 * `scripts/registry-consumer-gate.mjs` installs what the registry SERVES into an empty directory. Its decisions
 * are pure over an install tree read as data, so every refusal here has a fixture that trips it and a clean one
 * that passes, with no network. The fixtures are the REAL `a11ign@0.1.0` install (the packages the gate reads,
 * trimmed to ours), with ONE thing changed per file, and each is asserted to be refused for that reason ALONE:
 * a fixture refused for a stray second reason would let the mutant it is meant to catch hide behind it.
 *
 * THE POSITIVE CONTROL LIVES HERE, not in a comment: `clean` must PASS, and must have READ something (an always-
 * refusing gate satisfies every refusal below; a gate that read nothing passes the clean tree for free).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decide, formatDecision, loadFixtures, lookupPaths, readInstalledTree, selfCheckProblems, RULES,
} from "../../../../scripts/registry-consumer-gate.mjs";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/registry-consumer-gate.mjs", import.meta.url));

type Reading = Parameters<typeof decide>[0];
interface Fixture { description: string; requireImports?: boolean; expect: unknown; reading: Reading }

const fixtures = new Map(loadFixtures().map(({ file, fixture }) => [file.replace(/\.json$/, ""), fixture as unknown as Fixture]));
const fixture = (name: string): Fixture => {
  const found = fixtures.get(name);
  assert.ok(found, `fixture ${name}.json is missing from packages/lab/src/packaging/fixtures/registry-consumer-gate/`);
  return found;
};
const decideFixture = (name: string) => decide(fixture(name).reading, { requireImports: fixture(name).requireImports === true });

// --- the positive control ---

test("the clean tree PASSES, and it READ the install rather than passing an empty one", () => {
  const decision = decideFixture("clean");
  assert.deepEqual(decision.refused, [], "a11ign@0.1.0 as served, with its version printed and every entry point importing, must pass");
  const summary = decision.checked.join("\n");
  assert.match(summary, /6 installed package\(s\) of ours read/);
  assert.match(summary, /9 internal dependency range\(s\) read/);
  assert.match(summary, /--version printed 0\.1\.0, the installed version/);
  assert.match(summary, /import\("@a11ign\/evidence"\) succeeded/);
});

// --- the refusals the row names, one fixture each ---

const REFUSALS: Array<[fixture: string, rule: string, pkg: string, detail: RegExp]> = [
  ["workspace-protocol", "workspace-protocol", "@a11ign/judge", /dependencies\["@a11ign\/evidence"\] is "workspace:\*"/],
  ["zero-pin", "zero-pin", "@a11ign/scorer", /dependencies\["@a11ign\/evidence"\] is "0\.0\.0"/],
  ["duplicate-evidence", "duplicate-copy", "@a11ign/evidence", /2 copies installed/],
  ["unsatisfied-range", "unsatisfied-range", "@a11ign/worker-fleet", /"@a11ign\/judge"\] is "0\.2\.0" -- installed 0\.1\.0 .* does not satisfy/],
  ["version-mismatch", "version-mismatch", "a11ign", /printed 0\.0\.9, but 0\.1\.0 is what was installed/],
  ["entry-point-unresolvable", "import-failed", "@a11ign/judge", /ERR_MODULE_NOT_FOUND/],
  // The two this gate adds to the row's six, each because its own failure is otherwise a pass or a crash.
  ["cli-unrunnable", "cli-unrunnable", "a11ign", /could not determine executable to run/],
  ["nothing-installed", "nothing-installed", "a11ign", /an empty reading proves nothing/],
  ["entry-point-throws-where-it-must-work", "import-failed", "@a11ign/nvda-worker", /No available supported screen readers/],
];

for (const [name, rule, pkg, detail] of REFUSALS) {
  test(`${name}: REFUSED under "${rule}", naming ${pkg}, and for that reason alone`, () => {
    const decision = decideFixture(name);
    assert.equal(decision.refused.length, 1, `exactly one refusal expected, got ${JSON.stringify(decision.refused)}`);
    assert.equal(decision.refused[0].rule, rule);
    assert.equal(decision.refused[0].package, pkg);
    assert.match(decision.refused[0].detail, detail);
    assert.match(formatDecision(decision), new RegExp(`REFUSED:.*\\[${rule}\\] ${pkg.replace("/", "\\/")}:`));
  });
}

test("every rule the gate can refuse under has a fixture in the table above", () => {
  assert.deepEqual([...new Set(REFUSALS.map(([, rule]) => rule))].sort(), [...RULES].sort());
});

// --- UNCHECKED is named, and is not clean ---

test("the real 0.1.0 (no --version flag, nvda-worker throwing on Linux, layers off the registry) passes and NAMES what it did not check", () => {
  const decision = decideFixture("current-release");
  assert.deepEqual(decision.refused, []);
  const unchecked = decision.unchecked.map((u) => u.what);
  assert.ok(unchecked.includes("npx a11ign --version"), "no --version flag is 'could not tell', never 'matched'");
  assert.ok(unchecked.includes('import("@a11ign/nvda-worker")'));
  assert.ok(unchecked.includes("@a11ign/lab"), "@a11ign/lab is a 404 on the registry and must be named, not passed over");
  assert.match(decision.unchecked.find((u) => u.what === "@a11ign/lab")?.reason ?? "", /E404/);
  assert.ok(!decision.checked.some((line) => /--version printed/.test(line)), "an unchecked version must not also read as checked");
  assert.match(formatDecision(decision), /UNCHECKED above, which is not the same as clean/);
});

test("a layer the registry could not be asked about is UNCHECKED with that reason, not 'unpublished'", () => {
  const reading = structuredClone(fixture("clean").reading);
  reading.layers = [{ name: "@a11ign/lab", registry: { published: null, why: "ENOTFOUND registry.npmjs.org" } }];
  const [unchecked] = decide(reading).unchecked;
  assert.match(unchecked.reason, /could not be asked \(ENOTFOUND/);
  assert.doesNotMatch(unchecked.reason, /E404/);
});

// --- the gate's own fixtures are held to the same account ---

test("--self-check passes over the shipped fixtures, with no network", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--self-check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /every rule \(8\) tripped, the clean one passes/);
});

test("--self-check REFUSES a fixture set with no passing fixture, one that misses a rule, and a fixture that disagrees with itself", () => {
  const all = loadFixtures();
  assert.deepEqual(selfCheckProblems(all), [], "the shipped set must be consistent, or the three below prove nothing");

  const noPass = all.filter(({ fixture: f }) => (f.expect.refused as unknown[]).length > 0);
  assert.ok(selfCheckProblems(noPass).some((p) => /positive control is missing/.test(p)));

  const noDuplicate = all.filter(({ file }) => file !== "duplicate-evidence.json");
  assert.ok(selfCheckProblems(noDuplicate).some((p) => /no fixture trips the rule "duplicate-copy"/.test(p)));

  const lying = structuredClone(all);
  lying.find(({ file }) => file === "clean.json")!.fixture.expect.refused = [{ rule: "zero-pin", package: "a11ign" }];
  assert.ok(selfCheckProblems(lying).some((p) => /^clean\.json: expected \[zero-pin a11ign\] refused, got \[\]/.test(p)));
});

// --- the reader, and the deliberate red on a hand-broken install ---

function writePackage(root: string, path: string, manifest: object, files: Record<string, string> = {}) {
  const dir = join(root, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

const EXECUTABLE = 0o755;

/** A tiny install shaped like the real one: an entry package with a bin, one layer, one nested third-party copy. */
function syntheticInstall(): string {
  const root = mkdtempSync(join(tmpdir(), "registry-gate-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", private: true }));
  writePackage(root, "node_modules/a11ign", {
    name: "a11ign", version: "0.1.0", type: "module", exports: { ".": "./index.js" }, bin: { a11ign: "./cli.js" },
    dependencies: { "@a11ign/evidence": "0.1.0" },
  }, { "index.js": "export const ok = true;\n", "cli.js": "#!/usr/bin/env node\nconsole.log('0.1.0');\n" });
  writePackage(root, "node_modules/@a11ign/evidence", { name: "@a11ign/evidence", version: "0.1.0", type: "module", exports: { ".": "./index.js" } },
    { "index.js": "export const ok = true;\n" });
  writePackage(root, "node_modules/a11ign/node_modules/yaml", { name: "yaml", version: "2.9.1" });
  mkdirSync(join(root, "node_modules/.bin"));
  chmodSync(join(root, "node_modules/a11ign/cli.js"), EXECUTABLE);
  symlinkSync("../a11ign/cli.js", join(root, "node_modules/.bin/a11ign"));
  return root;
}

test("the reader finds scoped, hoisted and NESTED packages, with the path that tells them apart", () => {
  const root = syntheticInstall();
  try {
    const found = readInstalledTree(root).map((pkg) => `${pkg.path} ${pkg.name}@${pkg.version} entry=${pkg.entry}`).sort();
    assert.deepEqual(found, [
      "node_modules/@a11ign/evidence @a11ign/evidence@0.1.0 entry=true",
      "node_modules/a11ign a11ign@0.1.0 entry=true",
      "node_modules/a11ign/node_modules/yaml yaml@2.9.1 entry=false",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lookupPaths walks up the way Node does: nested first, then each enclosing node_modules", () => {
  assert.deepEqual(lookupPaths("node_modules/@a11ign/judge", "@a11ign/evidence"),
    ["node_modules/@a11ign/judge/node_modules/@a11ign/evidence", "node_modules/@a11ign/evidence"]);
  assert.deepEqual(lookupPaths("node_modules/a/node_modules/b", "c"),
    ["node_modules/a/node_modules/b/node_modules/c", "node_modules/a/node_modules/c", "node_modules/c"]);
});

const onWindows = process.platform === "win32";
// A named skip: npx resolves `.bin/a11ign` through a `.cmd` shim on Windows, which this fixture does not write. The
// same probe runs for real on the windows-2022 job of registry-consumer-gate.yml, against the real install.
const posixOnly = { skip: onWindows ? "the hand-built install has a POSIX .bin symlink; the Windows job exercises npx against the real install" : false };

function gate(root: string) {
  return spawnSync(process.execPath, [SCRIPT, `--existing=${root}`, "--offline"], { encoding: "utf8" });
}

test("an intact install passes end to end through the script (the positive control for the red below)", posixOnly, () => {
  const root = syntheticInstall();
  try {
    const run = gate(root);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /--version printed 0\.1\.0, the installed version/);
    assert.match(run.stdout, /import\("a11ign"\) succeeded/);
    assert.match(run.stdout, /nothing refused/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE DELIBERATE RED: a workspace: pin written into an installed package.json exits non-zero and names it", posixOnly, () => {
  const root = syntheticInstall();
  try {
    writePackage(root, "node_modules/a11ign", {
      name: "a11ign", version: "0.1.0", type: "module", exports: { ".": "./index.js" }, bin: { a11ign: "./cli.js" },
      dependencies: { "@a11ign/evidence": "workspace:*" },
    });
    const run = gate(root);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /REFUSED:\s+\[workspace-protocol\] a11ign: node_modules\/a11ign: dependencies\["@a11ign\/evidence"\] is "workspace:\*"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an entry point deleted from an installed package is REFUSED at import, through the script", posixOnly, () => {
  const root = syntheticInstall();
  try {
    rmSync(join(root, "node_modules/@a11ign/evidence/index.js"));
    const run = gate(root);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /REFUSED:\s+\[import-failed\] @a11ign\/evidence: .*ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a directory with no install is exit 2 -- could not read, never a pass", () => {
  const root = mkdtempSync(join(tmpdir(), "registry-gate-empty-"));
  try {
    const run = spawnSync(process.execPath, [SCRIPT, `--existing=${root}`, "--offline"], { encoding: "utf8" });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout + run.stderr, /nothing-installed|could not read an install/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown flag is refused rather than ignored (cli-flags guard)", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--sepc=0.1.0"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--spec/);
});
