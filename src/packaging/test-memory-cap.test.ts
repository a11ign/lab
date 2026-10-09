// no-token: gh -- nothing here calls `gh`: the cap module spawns `systemd-run` and a node fixture, and the choke-point case runs `assert-glob-not-empty.mjs`, which never reaches GitHub.
/**
 * #2507: every test run the org starts runs under a per-process memory cap, so one runaway `node` (25.7, 27.4 and 26.0 GB
 * on 2026-09-25, each ONE process) kills its own scope and not `herdr.service` with every agent in it.
 *
 * TWO ARMS OF ONE POSITIVE CONTROL, both against the real cap where a user manager answers: a fixture that allocates past
 * a 64M cap is killed AND the run says so by name, and a normal run under the same kind of cap is not reported as killed.
 * The real arms SKIP, naming the reason, on a machine with no `systemd-run` or no user manager (CI's ubuntu image is
 * one), so the same two verdicts are also pinned through a fake scope directory, which runs everywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAP_KILL_STATUS,
  DEFAULT_MEMORY_MAX,
  MEMORY_MAX_ENV,
  capLine,
  memoryMaxFrom,
  probeCap,
  runUnderCap,
  supervise,
  verdictLine,
} from "../../../guards/src/test-memory-cap.mjs";

const CAP_MODULE = fileURLToPath(new URL("../../../guards/src/test-memory-cap.mjs", import.meta.url));
const ASSERT_GLOB = fileURLToPath(new URL("../../../guards/src/assert-glob-not-empty.mjs", import.meta.url));
const PRE_PUSH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));
const REPO = path.resolve(path.dirname(CAP_MODULE), "../../..");

/** Allocates until something stops it: the shape of the three kills, at a size a 64M cap reaches in well under a second. */
const ALLOCATE_FOREVER = "const kept = []; for (;;) kept.push(Buffer.alloc(16 << 20, 1));";
const SMALL_CAP = "64M";
const ROOMY_CAP = "512M";
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const RUNNER_EXIT = 7;
const RUN_EXIT = 3;
const COMMAND_NOT_FOUND = 127;

const live = probeCap({ memoryMax: SMALL_CAP });
const noCapHere = live.capped ? false : `no cap can start on this machine: ${live.reason}`;

/** The recorded calls of an injected spawner, and what each answers. */
function fakeSpawner(answer: (command: string) => Record<string, unknown>) {
  const calls: { command: string; args: string[] }[] = [];
  const spawner = ((command: string, args: string[]) => {
    calls.push({ command, args });
    return answer(command);
  }) as unknown as Parameters<typeof runUnderCap>[0]["spawner"];
  return { calls, spawner };
}

function sink() {
  const lines: string[] = [];
  return { lines, write: (text: string) => lines.push(text) };
}

test("the cap is 4G unless the environment says otherwise, and a value systemd would not read is refused", () => {
  assert.deepEqual(memoryMaxFrom({}), { memoryMax: DEFAULT_MEMORY_MAX });
  assert.equal(DEFAULT_MEMORY_MAX, "4G");
  assert.deepEqual(memoryMaxFrom({ [MEMORY_MAX_ENV]: "64M" }), { memoryMax: "64M" });
  for (const bad of ["lots", "0", "4GB", "-1G", "4 G"]) {
    assert.match((memoryMaxFrom({ [MEMORY_MAX_ENV]: bad }) as { refusal: string }).refusal, /refusing to guess a cap/, bad);
  }
});

test("the probe tells `absent` from `no user manager` from `capped`, each as its own reason", () => {
  const absent = fakeSpawner(() => ({ error: Object.assign(new Error("spawn systemd-run ENOENT"), { code: "ENOENT" }) }));
  assert.deepEqual(probeCap({ memoryMax: "4G", spawner: absent.spawner }), { capped: false, reason: "systemd-run absent" });
  const noManager = fakeSpawner(() => ({ status: 1 }));
  assert.deepEqual(probeCap({ memoryMax: "4G", spawner: noManager.spawner }), { capped: false, reason: "no user manager answered" });
  const answering = fakeSpawner(() => ({ status: 0 }));
  assert.deepEqual(probeCap({ memoryMax: "4G", spawner: answering.spawner }), { capped: true, memoryMax: "4G" });
  assert.equal(capLine({ capped: true, memoryMax: "4G" }), "memory cap: MemoryMax=4G via systemd-run");
  assert.equal(capLine({ capped: false, reason: "systemd-run absent" }), "memory cap: none, systemd-run absent");
});

test("DONE-WHEN 4: with systemd-run absent the runner starts uncapped, the `none` line is printed, and the exit is the runner's own", () => {
  const { calls, spawner } = fakeSpawner((command) => command === "systemd-run"
    ? { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) }
    : { status: RUNNER_EXIT });
  const stderr = sink();
  const status = runUnderCap({ name: "rstest", command: "the-runner", args: ["run", "--include", "x"], env: {}, spawner, stderr });
  assert.equal(status, RUNNER_EXIT, "the exit code is the runner's, not the cap's and not 0");
  assert.deepEqual(stderr.lines, ["memory cap: none, systemd-run absent\n"]);
  assert.equal(calls.length, 2, "one probe and one run");
  assert.deepEqual(calls[1], { command: "the-runner", args: ["run", "--include", "x"] }, "the runner is started as itself, with no wrapper");
});

test("where a scope starts, the runner is started INSIDE it with the cap, no swap and the supervisor named", () => {
  const { calls, spawner } = fakeSpawner(() => ({ status: 0 }));
  const stderr = sink();
  const status = runUnderCap({ name: "rstest", command: "the-runner", args: ["a", "b"], env: { [MEMORY_MAX_ENV]: "2G" }, spawner, stderr });
  assert.equal(status, 0);
  assert.deepEqual(stderr.lines, ["memory cap: MemoryMax=2G via systemd-run\n"]);
  const started = calls[1];
  assert.equal(started.command, "systemd-run");
  for (const property of ["MemoryMax=2G", "MemorySwapMax=0", "OOMPolicy=continue"]) {
    assert.ok(started.args.includes(property), `${property} is on the scope`);
  }
  assert.deepEqual(started.args.slice(started.args.indexOf("--") + 1), ["the-runner", "a", "b"], "the command comes after `--`, unchanged");
  assert.ok(started.args.includes(CAP_MODULE) && started.args.includes("supervise"), "the supervisor that reads the scope runs in it");
});

test("an unreadable cap is refused with exit 2 before anything starts", () => {
  const { calls, spawner } = fakeSpawner(() => ({ status: 0 }));
  const stderr = sink();
  assert.equal(runUnderCap({ name: "x", command: "x", args: [], env: { [MEMORY_MAX_ENV]: "lots" }, spawner, stderr }), 2);
  assert.match(stderr.lines.join(""), /^REFUSING: /);
  assert.equal(calls.length, 0);
});

test("the verdict names the command, the cap and the count for a kill, and says nothing of a kill for a run that stayed under", () => {
  const killed = verdictLine({ name: "rstest", memoryMax: "4G", scope: { oomKills: 1, peakBytes: 4 * GIB }, signal: null });
  assert.match(killed, /KILLED/);
  assert.match(killed, /rstest/);
  assert.match(killed, /MemoryMax=4G/);
  assert.match(killed, /oom_kill=1/);
  assert.match(killed, /exit 137/);
  const under = verdictLine({ name: "rstest", memoryMax: "4G", scope: { oomKills: 0, peakBytes: 800 * MIB }, signal: null });
  assert.doesNotMatch(under, /KILLED/);
  assert.match(under, /stayed under MemoryMax=4G \(peak 800\.0M, oom_kill=0\)/);
});

test("a scope that cannot be read is NOT reported as zero kills, and a SIGKILL is not promoted to proof", () => {
  const line = verdictLine({ name: "rstest", memoryMax: "4G", scope: { oomKills: null, peakBytes: null, unreadable: "ENOENT" }, signal: "SIGKILL" });
  assert.doesNotMatch(line, /stayed under|oom_kill=0/);
  assert.match(line, /could not read the scope \(ENOENT\)/);
  assert.match(line, /not proof/);
});

/** A directory shaped like a scope's cgroup: what `supervise` reads, with the counts the test chooses. */
function fakeScope(oomKills: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "test-memory-cap-"));
  writeFileSync(path.join(dir, "memory.events"), `low 0\nhigh 0\nmax 22\noom 1\noom_kill ${oomKills}\noom_group_kill 0\n`);
  writeFileSync(path.join(dir, "memory.peak"), `${64 * MIB}\n`);
  return dir;
}

test("supervise: a scope the kernel killed in reports the kill and exits 137 whatever the runner's own status was", async () => {
  const directory = fakeScope(1);
  const stderr = sink();
  try {
    const status = await supervise({ name: "alloc-fixture", memoryMax: SMALL_CAP, command: process.execPath,
      args: ["-e", "process.exit(1)"], directory, stderr });
    assert.equal(status, CAP_KILL_STATUS, "a worker killed under the runner leaves the runner exiting 1; the cap's own exit is what is reported");
    assert.match(stderr.lines.join(""), /KILLED -- alloc-fixture hit MemoryMax=64M \(oom_kill=1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supervise: a run that stayed under keeps its own exit status and is not reported as killed", async () => {
  const directory = fakeScope(0);
  const stderr = sink();
  try {
    const status = await supervise({ name: "rstest", memoryMax: ROOMY_CAP, command: process.execPath, args: ["-e", `process.exit(${RUN_EXIT})`],
      directory, stderr });
    assert.equal(status, RUN_EXIT);
    assert.doesNotMatch(stderr.lines.join(""), /KILLED/);
    assert.match(stderr.lines.join(""), /stayed under MemoryMax=512M/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supervise: a command that cannot start is named and exits 127, the shell's `command not found`", async () => {
  const directory = fakeScope(0);
  const stderr = sink();
  try {
    const status = await supervise({ name: "nothing", memoryMax: ROOMY_CAP, command: "/nonexistent/a11y-runner", args: [], directory, stderr });
    assert.equal(status, COMMAND_NOT_FOUND);
    assert.match(stderr.lines.join(""), /could not start nothing/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The real cap, through the CLI a test run reaches it by, so what is read is what `npm test` would print. */
function underRealCap(cap: string, script: string) {
  return spawnSync(process.execPath, [CAP_MODULE, "run", "alloc-fixture", "--", process.execPath, "-e", script],
    { encoding: "utf8", env: { ...process.env, [MEMORY_MAX_ENV]: cap } });
}

test("DONE-WHEN 3, arm one: a process that allocates past the cap is killed and the run reports it by name", { skip: noCapHere }, () => {
  const result = underRealCap(SMALL_CAP, ALLOCATE_FOREVER);
  assert.equal(result.status, CAP_KILL_STATUS, result.stderr);
  assert.match(result.stderr, /memory cap: MemoryMax=64M via systemd-run/);
  assert.match(result.stderr, /KILLED -- alloc-fixture hit MemoryMax=64M \(oom_kill=[1-9]/, "the command's name, the cap's value, the kill");
});

test("DONE-WHEN 3, arm two: a normal run under a cap is not reported as killed and exits 0", { skip: noCapHere }, () => {
  const result = underRealCap(ROOMY_CAP, "console.log('fine')");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fine/);
  assert.doesNotMatch(result.stderr, /KILLED/);
  assert.match(result.stderr, /stayed under MemoryMax=512M \(peak \S+, oom_kill=0\)/);
});

test("the choke point: `assert-glob-not-empty.mjs --run` prints which cap path it took, and still forwards the runner's exit", () => {
  const ran = spawnSync(process.execPath, [ASSERT_GLOB, "packages/lab/src/packaging/commands-documented.test.ts", "--min=1", "--run"],
    { encoding: "utf8", cwd: REPO, env: { ...process.env, [MEMORY_MAX_ENV]: ROOMY_CAP } });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stderr, /^memory cap: (MemoryMax=512M via systemd-run|none, .+)$/m, "a capped run and an uncapped one each say which it was");
  const refused = spawnSync(process.execPath, [ASSERT_GLOB, "packages/lab/src/packaging/commands-documented.test.ts", "--min=1", "--run"],
    { encoding: "utf8", cwd: REPO, env: { ...process.env, [MEMORY_MAX_ENV]: "lots" } });
  assert.equal(refused.status, 2, "an unreadable cap stops the run before any runner starts");
});

test("the pre-push hook starts its test runner through the cap module, and the scan that says so finds the line it looks for", () => {
  const runners = readFileSync(PRE_PUSH, "utf8").split("\n").filter((line) => !line.trimStart().startsWith("#") && /\btsx --test\b/.test(line));
  assert.ok(runners.length >= 1, "POSITIVE CONTROL: the hook does start a runner, so an empty list here would be the scan finding nothing");
  const bare = runners.filter((line) => !line.includes("test-memory-cap.mjs"));
  assert.deepEqual(bare, [], "a runner started without the cap");
});
