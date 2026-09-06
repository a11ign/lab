import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* THE MUTATION CHECKER'S OWN EXIT-CODE CONTRACT, exercised end to end.
 *
 * Its exit codes are what a caller branches on, and three of the four are refusals -- the paths that only
 * run when something has gone wrong, which is exactly the class this repo has repeatedly shipped broken.
 * So each is driven with a real file, a real mutation and a real test rather than asserted from reading.
 *
 * The fixture is deliberately trivial: a file holding a number, and a "test" that greps for it. Using a
 * real source file and a real test suite would make this slow and would couple it to whatever that suite
 * happens to assert today.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(REPO, "scripts/mutation-check.mjs");

/** Run the checker and return its exit code and output, never throwing on a non-zero exit. */
function check(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe", cwd: REPO });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function fixture(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "mutcheck-")), "subject.txt");
  writeFileSync(file, "the answer is 42\n");
  return file;
}

test("exit 0 when the guard bites: clean passes, mutated fails, restored passes", () => {
  const file = fixture();
  const { code, out } = check([`--file=${file}`,
    `--mutate=sed -i '' 's/42/99/' ${file}`, `--test=grep -q 'is 42' ${file}`]);
  assert.equal(code, 0, out);
  assert.match(out, /THE GUARD BITES/);
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n",
    "the file must be byte-identical afterwards");
});

test("exit 1 when the guard does NOT bite, and it says to suspect the guard first", () => {
  const file = fixture();
  // The mutation changes a part the test does not look at.
  const { code, out } = check([`--file=${file}`,
    `--mutate=sed -i '' 's/answer/question/' ${file}`, `--test=grep -q 'is 42' ${file}`]);
  assert.equal(code, 1, out);
  assert.match(out, /THE GUARD DID NOT BITE/);
  assert.match(out, /SUSPECT THE GUARD BEFORE THE CODE/);
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n");
});

test("exit 2 when the mutation changes nothing, because a no-op pass reads as a dead guard", () => {
  const file = fixture();
  const { code, out } = check([`--file=${file}`, "--mutate=true", `--test=grep -q 'is 42' ${file}`]);
  assert.equal(code, 2, out);
  assert.match(out, /changed nothing/);
  assert.match(out, /quoting/, "the usual cause is a shell-mangled replacement, so it should say so");
});

test("exit 2 when the test is already failing, and nothing is touched", () => {
  const file = fixture();
  const { code, out } = check([`--file=${file}`, `--mutate=sed -i '' 's/42/99/' ${file}`,
    "--test=false"]);
  assert.equal(code, 2, out);
  assert.match(out, /ALREADY FAILING/);
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n",
    "a refusal before mutating must leave the file alone");
});

test("it refuses a missing argument rather than doing half the sequence", () => {
  const { code, out } = check(["--file=/tmp/nope"]);
  assert.equal(code, 2, out);
  assert.match(out, /--mutate/);
});
