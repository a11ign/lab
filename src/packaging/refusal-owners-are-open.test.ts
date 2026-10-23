/**
 * A RELEASE GATE'S REFUSAL NAMES AN OPEN OWNING ROW (a11ign/a11ign#5351, following the core's #5333). A `REFUSED ... #<n>` string that points at a closed
 * issue fails here, naming the script and the number.
 *
 * Acceptance: `node --test src/packaging/refusal-owners-are-open.test.ts`.
 *
 * TWO HALVES. The fixture half drives the reader over the 2026-10-13 `gate:core-held` string (`a11ign/a11ign#5179`, closed on 2026-10-12 after fixing a
 * DIFFERENT gate) with the owner closed, open and unreadable, so each verdict is a reading of a reader that CAN give the other. The live half reads the real
 * tree and asks GitHub, behind `A11Y_CHECK_REFUSAL_OWNERS=1` (the instrument is `gh api repos/<repo>/issues/<n>`; `ci.yml`'s `refusalOwners` job sets it and
 * its `GH_TOKEN`), and prints every owner it found. Without the flag it is SKIPPED with its reason, and `ci.yml` asserts the LIVE PASS line, so a skip that
 * fires always cannot pass for the check.
 *
 * POSITIVE CONTROLS, named where the emptiness assertions are: "the real tree names no closed owner" is only a reading if the reader finds an owner in it,
 * which `the real tree's gate:core-held is found, with a qualified owner` pins; and every `failures` assertion has its passing twin beside it on the same
 * fixture.
 */
// no-token: gh -- the fixture half spawns nothing: `readIssueState` takes a runner here, and the one read of GitHub is the opt-in LIVE test below
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describe, failures, findings, ownersOf, readIssueState, refusalsInPackageJson, refusalsInTree,
  type IssueRef, type StateRead,
} from "@a11ign/toolchain/refusal-owners-are-open";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FLAG = "A11Y_CHECK_REFUSAL_OWNERS";
const CORE = "a11ign/a11ign";
/** The row the string named until 2026-10-13 (closed 2026-10-12), the change it cites, and the one name that is open and must not be rescued by a citation. */
const OLD_OWNER = 5179;
const CITED_CHANGE = 5087;
const SURVIVOR = 90;
const SHARED_OWNER = 7;

/** `gate:core-held` as it read on 2026-10-13 (`git show cfbc75b8:package.json`), as the shell command it parses to: a QUALIFIED owner. */
const CORE_HELD_2026_10_13 =
  'node -e "console.error(\\"REFUSED: \\" + process.argv.slice(1).join(\\", \\") + \\" are held by a11ign/a11ign (the core) and this repository cannot run them: '
  + "this chain does not claim they passed. Run them from the core checkout; "
  + 'whether a release may proceed without them is a11ign/a11ign#5179.\\"); process.exit(1)"';

const packageJson = (command: string) => JSON.stringify({ scripts: { "gate:core-held": command, build: "tsc" } });
const stateOf = (states: Record<string, StateRead["code"]>) => ({ repo, number }: IssueRef): StateRead => {
  const key = `${repo ?? ""}#${number}`;
  return { code: states[key] ?? "CANNOT_TELL", why: `fixture says ${key} is ${states[key] ?? "unknown"}` };
};
const read = (command: string, states: Record<string, StateRead["code"]>) =>
  findings(refusalsInPackageJson("package.json", packageJson(command)), stateOf(states));
const core = (number: number) => `${CORE}#${number}`;

test("a REFUSED line whose owner is CLOSED fails, naming the script and the number (the 2026-10-13 string)", () => {
  const bad = failures(read(CORE_HELD_2026_10_13, { [core(OLD_OWNER)]: "CLOSED" }));
  assert.equal(bad.length, 1);
  assert.equal(describe(bad[0]),
    'package.json script "gate:core-held": REFUSED names a11ign/a11ign#5179 as its owner, and a11ign/a11ign#5179 is CLOSED');
});

test("the same fixture with the owner OPEN passes (the control for the test above)", () => {
  const all = read(CORE_HELD_2026_10_13, { [core(OLD_OWNER)]: "OPEN" });
  assert.deepEqual(failures(all), []);
  assert.deepEqual(all.map((finding) => [finding.repo, finding.number, finding.code]), [[CORE, OLD_OWNER, "OPEN"]]);
});

test("an owner that could not be read is CANNOT_TELL and fails, never open", () => {
  const bad = failures(read(CORE_HELD_2026_10_13, {}));
  assert.deepEqual(bad.map((finding) => [finding.number, finding.code]), [[OLD_OWNER, "CANNOT_TELL"]]);
  assert.match(describe(bad[0]), /a11ign\/a11ign#5179 is CANNOT_TELL \(fixture says a11ign\/a11ign#5179 is unknown\)/);
});

test("a qualified owner is asked of ITS repository, and a bare one of the repository the reader was given", () => {
  const asked: string[][] = [];
  const run = (args: string[]) => { asked.push(args); return "open"; };
  readIssueState("a11ign/lab", run)({ repo: CORE, number: OLD_OWNER });
  readIssueState("a11ign/lab", run)({ repo: null, number: OLD_OWNER });
  assert.deepEqual(asked, [
    ["api", "repos/a11ign/a11ign/issues/5179", "--jq", ".state"],
    ["api", "repos/a11ign/lab/issues/5179", "--jq", ".state"],
  ]);
});

test("a (#n) citation is not an owner: an open citation cannot rescue a closed owner", () => {
  assert.deepEqual(ownersOf("held since cut 9 (#5087), and (#1, a11ign/a11ign#2) too. The open row is a11ign/a11ign#4425."), [{ repo: CORE, number: 4425 }]);
  const text = CORE_HELD_2026_10_13.replace("Run them", `held since cut 9 (#${CITED_CHANGE}). Run them`);
  const closedOwnerOpenCitation = failures(read(text, { [`#${CITED_CHANGE}`]: "OPEN", [core(OLD_OWNER)]: "CLOSED" }));
  assert.deepEqual(closedOwnerOpenCitation.map((finding) => finding.number), [OLD_OWNER]);
});

test("an owner reworded into parentheses is a REFUSED string with no owner, which fails", () => {
  const reworded = CORE_HELD_2026_10_13.replace("is a11ign/a11ign#5179.", "is (a11ign/a11ign#5179).");
  const bad = failures(read(reworded, { [core(OLD_OWNER)]: "OPEN" }));
  assert.deepEqual(bad.map((finding) => [finding.number, finding.code]), [[null, "NAMES_NO_OWNER"]]);
  assert.match(describe(bad[0]), /package\.json script "gate:core-held": the refusal names no row as its owner/);
});

test("`$#`, a word-tail, a hyphenated tag and an HTML entity are not issue numbers", () => {
  assert.deepEqual(ownersOf("[ $# -eq 1 ] abc#34 tag-#56 &#78; #90 and #90"), [{ repo: null, number: SURVIVOR }]);
});

test("a path#n is read as a qualified reference and is CANNOT_TELL, loudly, never a silent pass", () => {
  assert.deepEqual(ownersOf("see docs/x.md#12"), [{ repo: "docs/x.md", number: 12 }]);
  assert.equal(readIssueState("o/r", () => { throw new Error("gh: HTTP 404"); })({ repo: "docs/x.md", number: 12 }).code, "CANNOT_TELL");
});

test("a script without REFUSED is not a refusal, and one with it is found with its text after the marker", () => {
  const found = refusalsInPackageJson("package.json", packageJson(CORE_HELD_2026_10_13));
  assert.deepEqual(found.map((refusal) => refusal.where), ['script "gate:core-held"']);
  assert.ok(found[0].text.startsWith(': \\" + process.argv'), "the text is what follows the marker, not the command's head");
});

test("an owner two refusals name is asked about once", () => {
  const asked: number[] = [];
  const twice = JSON.stringify({ scripts: { a: `echo "REFUSED: owner #${SHARED_OWNER}"`, b: `echo "REFUSED: owner #${SHARED_OWNER}"` } });
  findings(refusalsInPackageJson("package.json", twice), ({ number }) => { asked.push(number); return { code: "OPEN", why: "" }; });
  assert.deepEqual(asked, [SHARED_OWNER]);
});

test("the live reader maps what GitHub answers: open, closed, anything else and a failed call", () => {
  const answering = (stdout: string) => readIssueState("o/r", () => stdout)({ repo: null, number: OLD_OWNER });
  assert.equal(answering("open\n").code, "OPEN");
  assert.equal(answering("closed\n").code, "CLOSED");
  // Neither word: an unexpected body is not a reading in either direction.
  assert.equal(answering("transferred").code, "CANNOT_TELL");
  assert.equal(answering("").code, "CANNOT_TELL");
  const failing = readIssueState("o/r", () => { throw new Error("gh: HTTP 404\nsecond line"); })({ repo: null, number: OLD_OWNER });
  assert.equal(failing.code, "CANNOT_TELL");
  assert.match(failing.why, /o\/r#5179 could not be read: Error: gh: HTTP 404$/, "the reason is the first line of the failure, with the repository and number");
});

test("the tree reader finds a REFUSED string in a tree that has one (the positive control for the real tree being empty since gate:core-held was retired, A11-127)", () => {
  const root = mkdtempSync(join(tmpdir(), "refusal-owners-tree-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, "package.json"), packageJson(CORE_HELD_2026_10_13));
  writeFileSync(join(root, ".github/workflows/release.yml"), "name: release\n");
  const found = refusalsInTree(root);
  assert.deepEqual(found.map((refusal) => refusal.where), ['script "gate:core-held"']);
  assert.deepEqual(ownersOf(found[0].text), [{ repo: CORE, number: OLD_OWNER }]);
});

const CI_STEP_NAME = "Every owner a refusal names is an open issue";
/** `rwxr-xr-x`: the stub `node` has to be executable. */
const EXECUTABLE = 0o755;

/** The `run:` block of `ci.yml`'s refusalOwners step, dedented: the text GitHub hands to `bash -e`, which has no `pipefail`. */
function refusalOwnersStep(): string {
  const lines = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8").split("\n");
  const named = lines.findIndex((line) => line.includes(`name: ${CI_STEP_NAME}`));
  const runAt = lines.findIndex((line, index) => index > named && /^\s*run: \|\s*$/.test(line));
  assert.ok(named >= 0 && runAt > named, `ci.yml has a step named "${CI_STEP_NAME}" with a literal run block`);
  const indent = lines[runAt].search(/\S/) + 2;
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

/** Runs that step under `bash -e`, with a `node` that prints `output` and exits `code`; the step's own exit status is what a required job reports. */
function runStepWithNode(step: string, node: { code: number; output: string }): number | null {
  const dir = mkdtempSync(join(tmpdir(), "refusal-owners-step-"));
  writeFileSync(join(dir, "node"), `#!/bin/sh\ncat <<'EOF'\n${node.output}\nEOF\nexit ${node.code}\n`);
  chmodSync(join(dir, "node"), EXECUTABLE);
  writeFileSync(join(dir, "step.sh"), step);
  const ran = spawnSync("bash", ["-e", join(dir, "step.sh")], {
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir }, encoding: "utf8",
  });
  return ran.status;
}

test("ci.yml's refusalOwners step exits red when the test fails, even though a LIVE PASS line was printed", () => {
  const step = refusalOwnersStep();
  assert.match(step, /node --test src\/packaging\/refusal-owners-are-open\.test\.ts/, "the extracted block is the one that runs this test");
  const live = "  LIVE PASS: 0 owner(s) named by a REFUSED string in this tree, none closed or unreadable";
  // A fixture assertion fails (exit 1) while the opt-in live test prints its line. Under `| tee` this exited 0 (the core's reviewer-5352).
  assert.notEqual(runStepWithNode(step, { code: 1, output: `not ok 3 - fixture\n${live}` }), 0);
  // The passing twin on the same wrapper, and the way a green exit still must not pass: no line (a skipped live test).
  assert.equal(runStepWithNode(step, { code: 0, output: `ok 1\n${live}` }), 0);
  assert.notEqual(runStepWithNode(step, { code: 0, output: "ok 1\n# skipped 1" }), 0);
});

test("the job BLOCKS: `gate` needs refusalOwners and fails unless it succeeded (it is not advisory)", () => {
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const gate = ci.slice(ci.search(/^ {2}gate:$/m));
  assert.match(gate, /^ {4}needs: \[[^\]]*\brefusalOwners\b[^\]]*\]$/m, "gate lists refusalOwners in its needs");
  assert.match(gate, /"\$\{\{ needs\.refusalOwners\.result \}\}" != "success"/, "gate fails on any result but success, a skip included");
});

test("LIVE: every owner a refusal names in this tree is an OPEN issue", {
  skip: process.env[FLAG] === "1" ? false
    : `opt-in: \`${FLAG}=1 node --test src/packaging/refusal-owners-are-open.test.ts\` asks GitHub; the reader above ran on fixtures and read no live issue`,
}, () => {
  const all = findings(refusalsInTree(REPO_ROOT), readIssueState("a11ign/lab"));
  assert.deepEqual(failures(all).map(describe), []);
  // Always printed, even when the tree has no refusal (gate:core-held was retired, A11-127): the CI step greps for it so a SKIPPED live test cannot stand in for one that read.
  console.log(`  LIVE PASS: ${all.length} owner(s) named by a REFUSED string in this tree, none closed or unreadable`);
  for (const finding of all) console.log(`  LIVE PASS: ${finding.refusal.file} ${finding.refusal.where} names ${finding.repo ?? ""}#${finding.number}: ${finding.why}`);
});
