// no-token: gh -- spawns `scripts/verify.mjs` against a STUB tool checkout in a temp directory; the diff is empty, so no step, no `gh` and no network is reached
/**
 * #3536 (done-when 1 and 4): `pnpm run verify` TAKES ONE OF THE HOST'S SUITE SLOTS BEFORE ITS FIRST STEP, FROM THE TOOL'S ONE IMPLEMENTATION.
 *
 * The slot itself (flock, the queue, nice and ionice, the missing-tool refusal) is a11ign/agent-org's `src/suite-slots.mjs`, with its own tests
 * there. What THIS repository owes is the call: verify asks the tool's module to run it, before it classifies or runs anything, once, with the
 * module's own slot count (no `slots` or `dir` of its own), and refuses when it cannot. The module is a STUB here (a checkout in a temp directory, found
 * through `A11Y_AGENT_ORG_REPO` as verify finds the real one), so the test is hermetic and the same on a runner as on the host: the real module is
 * never loaded and no lock is taken.
 *
 * THE STUB'S TWO MODES say what the test can see. "records" logs the call and does NOT run the command: verify then exits with the stub's own code
 * and prints nothing of its own, which is what "before its first step" looks like from outside (not one line of verify's work was done outside the slot).
 * "runs" logs the call and runs the command with `STUB_SLOT` set, as the real module sets `SLOT_ENV`, so the re-run verify sees it is already inside and the
 * log holds exactly one call, and the empty diff then ends it at once with verify's own refusal (a real, fast, deterministic end).
 *
 * POSITIVE CONTROLS: the "runs" mode shows the same verify reaching its own code (the empty-diff refusal) when the slot is given, so the "records" cases
 * stopping before it is the slot's doing; `--check` and `CI` are the two ways verify takes NO slot, each shown next to the case that does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const VERIFY = join(REPO, "scripts/verify.mjs");
const SLOTTED_EXIT = 41;

// <scratch-dirs>
/**
 * THE TREES THIS FILE MAKES GO ON EVERY EXIT A PROCESS CAN CHOOSE, A KILL BY SIGTERM OR SIGINT INCLUDED (#3856, incident #3846, 1a). A `finally` does not run
 * when a signal ends the process, so a run killed mid-test left its tool checkout in `/tmp`. SIGKILL reaches no handler: what survives it is the janitor's.
 * It is made here, not taken from `scripts/verify.mjs`'s `makeScratch`, because an import of that file is a new lab-to-core edge for the layer-edges baseline.
 */
const scratch = new Set<string>();
const removeScratch = (dir: string) => { rmSync(dir, { recursive: true, force: true }); scratch.delete(dir); };
const removeAllScratch = () => scratch.forEach(removeScratch);
const makeScratch = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); scratch.add(dir); return dir; };
process.once("exit", removeAllScratch);
// `once` takes the listener off first, so the re-raise meets the default action and the process ends exactly as it would have without it.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, () => { removeAllScratch(); process.kill(process.pid, signal); });
// </scratch-dirs>

/** A stand-in for the tool's `suite-slots.mjs`: the four names verify reads, and a log of every call. */
const stubModule = (log: string) => `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
export class SuiteSlotRefusal extends Error {}
export const insideSlot = (env) => env.STUB_SLOT !== undefined;
export async function runUnderSlot(options) {
  // A verify that does not see it is already inside a slot would call this from inside itself for ever: stop it at the third call, so that bug is a failed assertion and not a hang.
  if (existsSync(${JSON.stringify(log)}) && readFileSync(${JSON.stringify(log)}, "utf8").split("\\n").filter(Boolean).length >= 3) throw new Error("stub: verify re-entered the slot from inside it");
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ keys: Object.keys(options).sort(), label: options.label, argv: options.args }) + "\\n");
  if (process.env.STUB_MODE === "refuse") throw new SuiteSlotRefusal("suite-slots: \`flock\` not found on PATH, so this suite is NOT being run");
  if (process.env.STUB_MODE === "records") return ${SLOTTED_EXIT};
  return spawnSync(options.command, options.args, { stdio: "inherit", env: { ...process.env, STUB_SLOT: "0" } }).status;
}
`;

/** A tool checkout with the stub (or without a `suite-slots.mjs` at all), and the log its calls go to. */
function toolCheckout(withModule: boolean) {
  const root = makeScratch("verify-takes-a-slot-");
  const log = join(root, "calls.log");
  mkdirSync(join(root, "tool", ".git"), { recursive: true });
  mkdirSync(join(root, "tool", "src"), { recursive: true });
  if (withModule) writeFileSync(join(root, "tool", "src", "suite-slots.mjs"), stubModule(log));
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { tool: join(root, "tool"), calls, done: () => removeScratch(root) };
}

function verify(args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, [VERIFY, ...args], { cwd: REPO, encoding: "utf8", env: { ...process.env, CI: undefined, STUB_SLOT: undefined, ...env } });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test("verify takes the slot BEFORE any of its work: it hands itself to the module and, when the module does not run it, prints nothing of its own", () => {
  const { tool, calls, done } = toolCheckout(true);
  try {
    const run = verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "records" });
    assert.equal(run.status, SLOTTED_EXIT, "verify's exit is the slot's: its work happens inside the command the module runs, or not at all");
    assert.doesNotMatch(run.out, /verify:/, `not one line of verify's own work happened outside the slot: ${run.out}`);
    assert.equal(calls().length, 1, "one slot, taken once");
  } finally {
    done();
  }
});

test("CONTROL: the same verify, given the slot, runs itself inside it and reaches its own first refusal (so the case above stopped at the slot, not at something else)", () => {
  const { tool, calls, done } = toolCheckout(true);
  try {
    const run = verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "runs" });
    assert.equal(run.status, 2);
    assert.match(run.out, /returned nothing/);
    const [call, ...rest] = calls();
    assert.deepEqual(rest, [], "the re-run verify is INSIDE the slot and does not queue behind itself");
    assert.equal(call.argv.at(-1), "--base=HEAD", "it re-runs ITSELF with its own arguments");
    assert.match(call.argv.join(" "), /scripts\/verify\.mjs/);
    assert.match(call.label, /pnpm run verify/);
  } finally {
    done();
  }
});

test("one implementation and ONE slot count: verify names a command, its arguments and a label to the module and nothing else (no `slots`, `dir` or `env` of its own)", () => {
  const { tool, calls, done } = toolCheckout(true);
  try {
    verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "runs" });
    assert.deepEqual(calls()[0].keys, ["args", "command", "label"]);
  } finally {
    done();
  }
});

test("a slot refusal (a missing flock, ionice or nice) is verify's refusal, with the module's words and no run", () => {
  const { tool, done } = toolCheckout(true);
  try {
    const run = verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "refuse" });
    assert.equal(run.status, 2);
    assert.match(run.out, /`flock` not found on PATH/);
    assert.doesNotMatch(run.out, /returned nothing/, "verify did not go on to run without the limit");
  } finally {
    done();
  }
});

test("a tool checkout WITHOUT `suite-slots.mjs` is a refusal that names the file: never a silent run without the limit", () => {
  const { tool, calls, done } = toolCheckout(false);
  try {
    const run = verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool });
    assert.equal(run.status, 2);
    assert.match(run.out, /suite-slots\.mjs is missing, so verify is NOT run/);
    assert.deepEqual(calls(), []);
  } finally {
    done();
  }
});

test("the two ways verify takes NO slot: `--check` (it runs nothing) and a runner (`CI` set: not this host, and the tool is not even loaded)", () => {
  const { tool, calls, done } = toolCheckout(true);
  try {
    const check = verify(["--check", "--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "records" });
    assert.notEqual(check.status, SLOTTED_EXIT);
    const runner = verify(["--base=HEAD"], { A11Y_AGENT_ORG_REPO: tool, STUB_MODE: "records", CI: "true" });
    assert.equal(runner.status, 2);
    assert.match(runner.out, /returned nothing/, "on a runner verify does its own work");
    assert.deepEqual(calls(), [], "neither took a slot");
  } finally {
    done();
  }
});

// #3856: THE TREE THIS FILE MAKES IS REMOVED ON A SIGNAL TOO. The child runs the helper's OWN TEXT, cut out of this file between its two markers, so what is
// killed is the code that ships and not a copy of it. POSITIVE CONTROLS: the same child run to completion leaves nothing, the kill is only sent once the test
// has READ the tree standing, and the child must have ended BY the signal (the re-raise), so a handler that swallowed it and exited cleanly is not green.
const SELF = join(REPO, "packages/lab/src/packaging/verify-takes-a-slot.test.ts");
const SCRATCH_BLOCK = /^\/\/ <scratch-dirs>\n([\s\S]*?)^\/\/ <\/scratch-dirs>$/m;
const TREE_PREFIX = "verify-takes-a-slot-";
const READY_WAIT_MS = 15_000;
const POLL_MS = 50;

function helperChild(): { dir: string; tmp: string; ready: string; program: string } {
  const block = SCRATCH_BLOCK.exec(readFileSync(SELF, "utf8"))?.[1];
  assert.ok(block, "this file has no <scratch-dirs> block, so there is no helper to kill");
  const dir = makeScratch("verify-takes-a-slot-signal-");
  const [tmp, ready, program] = [join(dir, "tmp"), join(dir, "ready"), join(dir, "child.mts")];
  mkdirSync(tmp);
  writeFileSync(program, `import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
${block}
makeScratch("verify-takes-a-slot-");
writeFileSync(${JSON.stringify(ready)}, "1");
if (process.env.TEST_RUNS_TO_COMPLETION !== "1") await new Promise(() => setInterval(() => {}, 1000));
`);
  return { dir, tmp, ready, program };
}

async function runHelperChild(kill: NodeJS.Signals | null) {
  const { dir, tmp, ready, program } = helperChild();
  const env = { ...process.env, TMPDIR: tmp, TEST_RUNS_TO_COMPLETION: kill === null ? "1" : "0" };
  const child = spawn(process.execPath, ["--import", "tsx", program], { cwd: REPO, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => child.on("close", (code, signal) => done({ code, signal })));
  let before: string[] = [];
  if (kill !== null) {
    for (let waited = 0; !existsSync(ready); waited += POLL_MS) {
      assert.ok(waited < READY_WAIT_MS, `the child never made its tree in ${READY_WAIT_MS} ms\n${stderr}`);
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    before = readdirSync(tmp);
    child.kill(kill);
    // A handler that swallows the signal would leave the child waiting for ever: bound it, so that is a failed assertion and not a hang.
    setTimeout(() => child.kill("SIGKILL"), READY_WAIT_MS).unref();
  }
  // `tsx` keeps its own `tsx-<uid>` directory in the TMPDIR it is given: not a tree of the helper's.
  return { ...(await ended), stderr, before, left: readdirSync(tmp).filter((name) => name.startsWith(TREE_PREFIX)), dir };
}

for (const signal of [null, "SIGTERM", "SIGINT", "SIGHUP"] as const) {
  test(`the scratch helper: ${signal ? `a ${signal} in the middle of a test` : "a run to completion (the positive control)"} leaves no verify-takes-a-slot-* tree`, async () => {
    const run = await runHelperChild(signal);
    try {
      if (signal) {
        assert.ok(run.before.some((name) => name.startsWith("verify-takes-a-slot-")), `the tree did not stand before the kill: ${run.before.join(", ")}\n${run.stderr}`);
        assert.equal(run.signal, signal, `the child must still END by ${signal} once it has cleaned up: code ${run.code}\n${run.stderr}`);
      } else {
        assert.equal(run.code, 0, run.stderr);
      }
      assert.deepEqual(run.left, [], `${signal ?? "a clean exit"} left a tree behind\n${run.stderr}`);
    } finally {
      removeScratch(run.dir);
    }
  });
}

test("the one bare directory-maker in this file is the scratch helper's own, so no tree is made outside the cleanup", () => {
  const source = readFileSync(SELF, "utf8");
  const block = SCRATCH_BLOCK.exec(source);
  assert.ok(block, "this file has no <scratch-dirs> block");
  const sites = [...source.matchAll(/\bmkdtempSync\(/g)].map((match) => match.index ?? -1);
  assert.equal(sites.length, 1, `the helper's own call is the positive control and must be the only one: ${sites.join(", ")}`);
  assert.ok(sites[0] > block.index && sites[0] < block.index + block[0].length, "the one call is outside the <scratch-dirs> block");
});
