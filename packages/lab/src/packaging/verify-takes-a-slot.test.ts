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
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const VERIFY = join(REPO, "scripts/verify.mjs");
const SLOTTED_EXIT = 41;

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
  const root = mkdtempSync(join(tmpdir(), "verify-takes-a-slot-"));
  const log = join(root, "calls.log");
  mkdirSync(join(root, "tool", ".git"), { recursive: true });
  mkdirSync(join(root, "tool", "src"), { recursive: true });
  if (withModule) writeFileSync(join(root, "tool", "src", "suite-slots.mjs"), stubModule(log));
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { tool: join(root, "tool"), calls, done: () => rmSync(root, { recursive: true, force: true }) };
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
