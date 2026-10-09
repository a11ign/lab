import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tempDir } from "../../../guards/src/test-tmp.mjs";

/* THE MUTATION CHECKER'S OWN EXIT-CODE CONTRACT, exercised end to end.
 *
 * Its exit codes are what a caller branches on, and three of the four are refusals -- the paths that only
 * run when something has gone wrong, which is exactly the class this repo has repeatedly shipped broken.
 * So each is driven with a real file, a real mutation and a real test rather than asserted from reading.
 *
 * The fixture is deliberately trivial: a file holding a number, and a "test" that greps for it. Using a
 * real source file and a real test suite would make this slow and would couple it to whatever that suite
 * happens to assert today.
 *
 * `perl -pi -e`, not `sed -i ''` -- this file used the latter until it was the first thing in this repo
 * to actually run `packages/lab/src/packaging/*.test.ts` on Linux CI (the `ts`/`docs` jobs split out of
 * one earlier-failing job that had never reached this far). BSD sed's `-i` needs an explicit backup-
 * suffix argument (`''` for none); GNU sed's does not, so it read the empty string as the sed SCRIPT and
 * the real script as a FILENAME -- `sed: can't read s/42/99/: No such file or directory`. perl's `-i` has
 * no such split between platforms.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(REPO, "packages/guards/src/mutation-check.mjs");

/**
 * #2457: every run made here is handed a `TMPDIR` the helper removes with the file, instead of the shared `/tmp`.
 * #2520: the checker now removes its own `mutate-*` copy once the restore is proven, so the runs that ASSERT that
 * (`ownTmp` below) each get a `TMPDIR` of their own and list it afterwards.
 */
const CHECKER_ENV: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tempDir("mutcheck-checker-tmp-") };

/** A `TMPDIR` private to one run, so what is in it afterwards is that run's and nobody else's. */
function ownTmp(): { tmp: string; env: NodeJS.ProcessEnv; left: () => string[] } {
  const tmp = tempDir("mutcheck-own-tmp-");
  return { tmp, env: { ...process.env, TMPDIR: tmp }, left: () => readdirSync(tmp) };
}

/** Run the checker and return its exit code and output, never throwing on a non-zero exit. */
function check(args: string[], env: NodeJS.ProcessEnv = CHECKER_ENV): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe", cwd: REPO, env });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function fixture(): string {
  const file = path.join(tempDir("mutcheck-"), "subject.txt");
  writeFileSync(file, "the answer is 42\n");
  return file;
}

test("exit 0 when the guard bites: clean passes, mutated fails, restored passes", () => {
  const file = fixture();
  const { code, out } = check([`--file=${file}`,
    `--mutate=perl -pi -e 's/42/99/' ${file}`, `--test=grep -q 'is 42' ${file}`]);
  assert.equal(code, 0, out);
  assert.match(out, /THE GUARD BITES/);
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n",
    "the file must be byte-identical afterwards");
});

test("exit 1 when the guard does NOT bite, and it says to suspect the guard first", () => {
  const file = fixture();
  // The mutation changes a part the test does not look at.
  const { code, out } = check([`--file=${file}`,
    `--mutate=perl -pi -e 's/answer/question/' ${file}`, `--test=grep -q 'is 42' ${file}`]);
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
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`,
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

/* PER-MUTANT MODE (#2448): a caller trying many mutants of one file pays for the clean run and the restored
 * run once per mutant. The mode drops both, so what it must still do is pinned as hard as what it stops
 * doing: the byte check after EVERY mutant, the exit codes, the sentences, and the default's three runs.
 */
const PER_MUTANT = ["--per-mutant", "--baseline-passed"];

/** A fixture whose test appends a line to a counter file every time it runs, so runs are COUNTED, not inferred. */
function counted(): { file: string; test: string; runs: () => number } {
  const file = fixture();
  const counter = `${file}.runs`;
  return {
    file,
    // `echo` first, then the grep: the command's exit status is the grep's, and the counter grows either way.
    test: `--test=echo x >> ${counter}; grep -q 'is 42' ${file}`,
    runs: () => (existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0),
  };
}

/** A mutation that also corrupts the copy-aside, so the restore lands bytes that are not the original's.
 * `TMPDIR` is private to the run, which makes the glob match this run's stash and nothing else's. */
function corruptsItsOwnStash(file: string): { mutate: string; env: NodeJS.ProcessEnv } {
  const tmp = tempDir("mutcheck-tmp-");
  return {
    mutate: `--mutate=perl -pi -e 's/42/99/' ${file} ${tmp}/mutate-*/subject.txt`,
    env: { ...process.env, TMPDIR: tmp },
  };
}

test("the DEFAULT still runs the test three times: clean, mutated, restored", () => {
  const { file, test: testArg, runs } = counted();
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, testArg]);
  assert.equal(code, 0, out);
  assert.equal(runs(), 3, "the default is the contract every existing caller relies on");
  assert.match(out, /test PASSES again/);
});

test("per-mutant mode runs the test ONCE, and keeps the sentence, the exit code and the file's bytes", () => {
  const { file, test: testArg, runs } = counted();
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, testArg,
    ...PER_MUTANT]);
  assert.equal(code, 0, out);
  assert.equal(runs(), 1, "only the mutated run");
  assert.match(out, /THE GUARD BITES\./);
  assert.match(out, /byte-identical/);
  assert.match(out, /--prove-restored/, "it must say where the restored proof went");
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n");
});

test("per-mutant mode keeps exit 1 and exit 2 for a guard that does not bite and a mutation that lands nowhere", () => {
  const notBiting = counted();
  const one = check([`--file=${notBiting.file}`, `--mutate=perl -pi -e 's/answer/question/' ${notBiting.file}`,
    notBiting.test, ...PER_MUTANT]);
  assert.equal(one.code, 1, one.out);
  assert.match(one.out, /THE GUARD DID NOT BITE/);
  assert.equal(notBiting.runs(), 1);

  const noOp = counted();
  const two = check([`--file=${noOp.file}`, "--mutate=true", noOp.test, ...PER_MUTANT]);
  assert.equal(two.code, 2, two.out);
  assert.match(two.out, /changed nothing/);
  assert.equal(noOp.runs(), 0, "a no-op mutation is refused before the test is consulted at all");
});

test("per-mutant mode is REFUSED without the baseline statement, and names the flag and why", () => {
  const { file, test: testArg, runs } = counted();
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, testArg,
    "--per-mutant"]);
  assert.equal(code, 2, out);
  assert.match(out, /--baseline-passed/);
  assert.match(out, /ALREADY FAILING/, "the reason is the check it stops making");
  assert.equal(runs(), 0, "a refusal happens before anything runs");
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n");
});

test("the baseline statement alone is refused: a flag that changes nothing reads as if it did", () => {
  const { file, test: testArg, runs } = counted();
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, testArg,
    "--baseline-passed"]);
  assert.equal(code, 2, out);
  assert.match(out, /--per-mutant/);
  assert.equal(runs(), 0);
});

test("a restore that is not byte-identical exits 3 in per-mutant mode, as it does by default", () => {
  // The default is the positive control: it proves this mutation really does defeat the restore, so the
  // per-mutant exit 3 below is not the harness failing to reach the branch.
  const control = counted();
  const c = corruptsItsOwnStash(control.file);
  const byDefault = check([`--file=${control.file}`, c.mutate, control.test], c.env);
  assert.equal(byDefault.code, 3, byDefault.out);

  const batch = counted();
  const b = corruptsItsOwnStash(batch.file);
  const { code, out } = check([`--file=${batch.file}`, b.mutate, batch.test, ...PER_MUTANT], b.env);
  assert.equal(code, 3, out);
  assert.match(out, /THE RESTORE FAILED/);
  assert.match(out, /NOT\s+been deleted/, "the copy is left in place for a human");
  assert.equal(batch.runs(), 1, "it stopped at the byte check and did not go on to run the test");
});

test("--prove-restored runs the test once on the file as the batch left it: exit 0 green, exit 3 red", () => {
  const green = counted();
  const ok = check([`--file=${green.file}`, green.test, "--prove-restored"]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /after the batch/);
  assert.equal(green.runs(), 1);

  // A batch whose mutation command left something behind: the bytes are the original's, the test is red.
  const red = counted();
  const bad = check([`--file=${red.file}`, `--test=grep -q 'is 43' ${red.file}`, "--prove-restored"]);
  assert.equal(bad.code, 3, bad.out);
  assert.match(bad.out, /THE TEST FAILS/);
});

test("--prove-restored refuses to be combined with a mutation, and the batch flags", () => {
  const { file, test: testArg, runs } = counted();
  for (const extra of [[`--mutate=perl -pi -e 's/42/99/' ${file}`], ["--per-mutant"], ["--baseline-passed"]]) {
    const { code, out } = check([`--file=${file}`, testArg, "--prove-restored", ...extra]);
    assert.equal(code, 2, out);
  }
  assert.equal(runs(), 0);
  assert.equal(readFileSync(file, "utf8"), "the answer is 42\n");
});

/* THE COPY-ASIDE DIRECTORY (#2520): removed once the restore is proven, kept when it is not. Each pair below is
 * a control for the other: a removal that ignored the restore result would pass the first and fail the second,
 * and a removal that never happened would fail the first.
 */
test("a proven restore leaves nothing in TMPDIR, on every exit that restores: 0, 1 and 2", () => {
  const cases: Array<[number, (file: string) => string[]]> = [
    [0, (file) => [`--mutate=perl -pi -e 's/42/99/' ${file}`, `--test=grep -q 'is 42' ${file}`]],
    [1, (file) => [`--mutate=perl -pi -e 's/answer/question/' ${file}`, `--test=grep -q 'is 42' ${file}`]],
    [2, (file) => ["--mutate=true", `--test=grep -q 'is 42' ${file}`]],
  ];
  for (const [expected, argsFor] of cases) {
    const file = fixture();
    const { env, left } = ownTmp();
    const { code, out } = check([`--file=${file}`, ...argsFor(file)], env);
    assert.equal(code, expected, out);
    assert.deepEqual(left(), [], `exit ${expected} must not leave its copy-aside directory behind`);
  }
});

test("a run refused before it copies anything makes no directory to begin with", () => {
  const file = fixture();
  const { env, left } = ownTmp();
  const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, "--test=false"], env);
  assert.equal(code, 2, out);
  assert.deepEqual(left(), []);
});

test("a FAILED restore keeps the copy, and the report names its path", () => {
  const file = fixture();
  const c = corruptsItsOwnStash(file);
  const { code, out } = check([`--file=${file}`, c.mutate, `--test=grep -q 'is 42' ${file}`], c.env);
  assert.equal(code, 3, out);
  const tmp = c.env.TMPDIR as string;
  const kept = readdirSync(tmp);
  assert.equal(kept.length, 1, "the one directory holding the only copy of the original");
  assert.match(kept[0], /^mutate-/);
  const stash = path.join(tmp, kept[0], "subject.txt");
  assert.ok(out.includes(stash), `the report must name ${stash}\n${out}`);
  assert.equal(readFileSync(stash, "utf8"), "the answer is 99\n",
    "the copy is left exactly as the mutation left it, for a human to inspect");
});

test("a byte-identical restore whose test then FAILS keeps the copy too", () => {
  // The bytes are back, but the mutation command touched something outside --file: the row's own rule is
  // that the copy stays until the restore is proven, and the test still failing is not proof.
  const file = fixture();
  const other = `${file}.other`;
  writeFileSync(other, "ok\n");
  const { env, tmp, left } = ownTmp();
  const { code, out } = check([`--file=${file}`,
    `--mutate=perl -pi -e 's/42/99/' ${file}; rm ${other}`,
    `--test=grep -q 'is 42' ${file}; test -e ${other}`], env);
  assert.equal(code, 3, out);
  assert.equal(left().length, 1);
  assert.ok(out.includes(path.join(tmp, left()[0])), out);
});

test("per-mutant mode removes its copy after the byte check, one directory per invocation and none left", () => {
  const { file, test: testArg } = counted();
  const { env, left } = ownTmp();
  for (let mutant = 0; mutant < 2; mutant += 1) {
    const { code, out } = check([`--file=${file}`, `--mutate=perl -pi -e 's/42/99/' ${file}`, testArg,
      ...PER_MUTANT], env);
    assert.equal(code, 0, out);
    assert.deepEqual(left(), [], `after mutant ${mutant}`);
  }
});
