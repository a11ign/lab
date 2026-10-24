// a11ign/a11ign#5188: a lab pull request whose `checks (cross-repo)` leg NEWLY fails is not armed, by either arming job.
//
// The decision is shell, in `auto-arm.yml`'s workflow-level `CROSS_REPO_RED_LIB`, so this test takes that text out of the YAML (the workflow and the
// test cannot disagree about it) and runs it under real `bash` and `jq` against a fake `gh` that answers from fixtures. Nothing here reaches GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/auto-arm.yml", import.meta.url));
const text = readFileSync(WORKFLOW, "utf8");
const doc = parse(text) as { env: { CROSS_REPO_RED_LIB: string }; jobs: Record<string, { steps: { run?: string }[] }> };
const LIB = doc.env.CROSS_REPO_RED_LIB;

const LEG = "checks (cross-repo)";
const MARKER = "<!-- arm-refused: cross-repo-red -->";

/** `gh` as the library calls it: `api [--paginate] <path> [--jq <expr>] [-X POST -f body=...]`. `--jq` is applied here, the one place the real `gh` would. */
const FAKE_GH = `#!/usr/bin/env bash
for arg in "$@"; do case "$arg" in repos/*) path=$arg ;; esac; done
case "$*" in *"-X POST"*) printf '%s\\n' "$*" >>"$POSTED"; exit 0;; esac
case "$path" in
  repos/*/pulls/*) printf '%s' "$PULL_JSON" ;;
  repos/*/commits/*/check-runs*) printf '%s' "$CHECKS_JSON" ;;
  repos/*/actions/workflows/ci.yml/runs*) printf '%s' "$RUNS_JSON" ;;
  repos/*/actions/runs/*/jobs*) printf '%s' "$JOBS_JSON" ;;
  # A job log, by job id (11 is the head's leg, 12 the trunk's). The real \`gh api\` REFUSES a response carrying a terminal escape unless it is
  # given \`--allow-escape-sequences\` (measured on a log of this repository, 2026-10-12), so this does too: a call without the flag is a 403 here.
  repos/*/actions/jobs/*/logs)
    case "$*" in *--allow-escape-sequences*) ;; *) echo "the response contains terminal escape sequences; pass --allow-escape-sequences" >&2; exit 1;; esac
    case "$path" in
      */11/logs) [ -n "\${HEAD_LOG+x}" ] && { printf '%s' "$HEAD_LOG"; exit 0; } ;;
      */12/logs) [ -n "\${TRUNK_LOG+x}" ] && { printf '%s' "$TRUNK_LOG"; exit 0; } ;;
    esac
    echo "gh: HTTP 403: Must have admin rights to Repository." >&2; exit 1 ;;
  repos/*/issues/*/comments*) printf '%s' "$COMMENTS" ;;
  # The exit names a ticket and is read by its shape: a call for an issue is a regression to the old open-row read, which no row can answer now.
  repos/*/issues/*) echo "fake gh: the exit must not read an issue: $*" >&2; exit 1 ;;
  *) echo "fake gh: unexpected $*" >&2; exit 1 ;;
esac
`;

/** `headLog` and `trunkLog`: the job log of each leg; absent is a log the token cannot read (a 403). */
type World = { leg?: { status: string; conclusion: string | null }; trunk?: "success" | "failure" | "cancelled" | "none"; trunkLeg?: string;
  body?: string; comments?: string; headLog?: string; trunkLog?: string };

const ESC = String.fromCharCode(27);
/** A job log as the runner serves it: a timestamp on every line, and rstest painting the directory, the file and the `>` separately. */
function rstestLog(failing: string[]): string {
  const stamp = "2026-10-12T07:38:13.2456415Z";
  const paint = (file: string) => {
    const slash = file.lastIndexOf("/") + 1;
    return `${ESC}[90m${file.slice(0, slash)}${ESC}[39m${ESC}[36m${file.slice(slash)}${ESC}[39m`;
  };
  return [
    `${stamp} ${ESC}[90m  Test Files${ESC}[39m 221 passed`,
    ...failing.map((file) => `${stamp} ${ESC}[41m${ESC}[37m${ESC}[1m FAIL ${ESC}[22m${ESC}[39m${ESC}[49m ${paint(file)} ${ESC}[2m>${ESC}[22m the edges agree`),
    // Not a FAIL line: the per-file summary also names the file, and so does a diff of its assertion.
    ...failing.map((file) => `${stamp}  ${ESC}[1m${ESC}[31m\u2717${ESC}[39m${ESC}[22m ${paint(file)} (35)`),
  ].join("\n");
}
const EDGES = "packages/lab/src/packaging/layer-edges.test.ts";
const OTHER = "packages/lab/src/packaging/arm-pr.test.ts";

const dir = mkdtempSync(join(tmpdir(), "auto-arm-cross-repo-"));
writeFileSync(join(dir, "gh"), FAKE_GH);
chmodSync(join(dir, "gh"), 0o755);

/** Runs `script` with the library loaded and the world's answers in the environment; returns stdout and the comments the script posted. */
function drive(world: World, script: string): { out: string; posted: string; status: number | null } {
  const posted = join(dir, `posted-${Math.random().toString(36).slice(2)}`);
  writeFileSync(posted, "");
  const checks = world.leg === undefined ? [] : [{ name: LEG, status: world.leg.status, conclusion: world.leg.conclusion, id: 11 }];
  const runs = world.trunk === undefined || world.trunk === "none" ? [] : [{ id: 900, conclusion: world.trunk }];
  const jobs = world.trunkLeg === undefined ? [] : [{ name: LEG, status: "completed", conclusion: world.trunkLeg, id: 12 }];
  const run = spawnSync("bash", ["-c", `eval "$CROSS_REPO_RED_LIB"; ${script}`], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`, GH_REPO: "a11ign/lab", CROSS_REPO_RED_LIB: LIB, CROSS_REPO_DEADLINE: "0", POSTED: posted,
      PULL_JSON: JSON.stringify({ head: { sha: "abc123def456" }, body: world.body ?? "" }),
      CHECKS_JSON: JSON.stringify({ total_count: checks.length, check_runs: checks }),
      RUNS_JSON: JSON.stringify({ workflow_runs: runs }),
      JOBS_JSON: JSON.stringify({ total_count: jobs.length, jobs }),
      COMMENTS: world.comments ?? "",
      ...(world.headLog === undefined ? {} : { HEAD_LOG: world.headLog }),
      ...(world.trunkLog === undefined ? {} : { TRUNK_LOG: world.trunkLog }),
    },
  });
  return { out: run.stdout.trim(), posted: readFileSync(posted, "utf8"), status: run.status };
}

const verdict = (world: World) => drive(world, "cross_repo_verdict 5").out.split("|")[0];

const RED_HEAD = { leg: { status: "completed", conclusion: "failure" } } as const;

test("a red head leg against a GREEN newest trunk run is red, and no log is read to say so", () => {
  assert.equal(verdict({ ...RED_HEAD, trunk: "success", trunkLeg: "success" }), "red");
});

test("a red head leg against a red trunk leg is judged FILE BY FILE (a11ign/a11ign#5192): the file main already fails is clear, a second is red", () => {
  const trunk = { trunk: "failure", trunkLeg: "failure", trunkLog: rstestLog([EDGES]) } as const;
  assert.equal(verdict({ ...RED_HEAD, ...trunk, headLog: rstestLog([EDGES]) }), "clear", "lab#92's own case: the same file, so main's red");
  const second = drive({ ...RED_HEAD, ...trunk, headLog: rstestLog([EDGES, OTHER]) }, "cross_repo_verdict 5").out;
  assert.match(second, /^red\|/, "a second red file on a red main is the pull request's own");
  assert.ok(second.includes(OTHER), "the refusal names the file that is new");
  assert.ok(!second.includes(EDGES), "and not the one main already fails");
  assert.equal(verdict({ ...RED_HEAD, ...trunk, headLog: rstestLog([OTHER]) }), "red", "a different file entirely is new, not inherited");
  assert.equal(verdict({ ...RED_HEAD, ...trunk, headLog: rstestLog([OTHER, EDGES].reverse()) }), "red", "order of the lines does not matter");
});

test("a red trunk leg whose logs cannot be told is `cannot`, never an inherited red: an unreadable log and a log naming no file", () => {
  const both = { ...RED_HEAD, trunk: "failure", trunkLeg: "failure" } as const;
  const none = drive({ ...both, headLog: rstestLog([EDGES]), trunkLog: rstestLog([EDGES]) }, "cross_repo_verdict 5").out;
  assert.equal(none, "clear|-", "control: with both logs readable the same world is clear, so the refusals below are the logs' doing");
  assert.match(drive({ ...both, trunkLog: rstestLog([EDGES]) }, "cross_repo_verdict 5").out, /^cannot\|.*job 11 could not be read/, "the head's log is a 403");
  assert.match(drive({ ...both, headLog: rstestLog([EDGES]) }, "cross_repo_verdict 5").out, /^cannot\|.*job 12 could not be read/, "the trunk's log is a 403");
  assert.match(drive({ ...both, headLog: "build failed before any test ran", trunkLog: rstestLog([EDGES]) }, "cross_repo_verdict 5").out,
    /^cannot\|.*job 11 names no failing test file/, "a leg red for a reason that is not a test names no file, so nothing is inherited");
  assert.match(drive({ ...both, headLog: rstestLog([EDGES]), trunkLog: "" }, "cross_repo_verdict 5").out, /^cannot\|.*job 12 names no failing test file/);
});

test("a file new on a red main is exempt only through a declared ticket, as a red on a green main is", () => {
  const world = { ...RED_HEAD, trunk: "failure", trunkLeg: "failure", trunkLog: rstestLog([EDGES]), headLog: rstestLog([EDGES, OTHER]) } as const;
  assert.equal(verdict({ ...world, body: "Cross-repo-red: A11-123" }), "clear");
  assert.equal(verdict({ ...world, body: "Cross-repo-red: a11ign/a11ign#5188" }), "red");
});

test("a leg that is green, skipped or cancelled on the head is clear: only `failure` is a red", () => {
  for (const conclusion of ["success", "skipped", "cancelled"]) {
    assert.equal(verdict({ leg: { status: "completed", conclusion }, trunk: "success", trunkLeg: "success" }), "clear", conclusion);
  }
});

test("a leg that has not concluded, or is not there yet, is PENDING and never clear: lab#92 was armed at `opened`, before its leg existed", () => {
  assert.equal(verdict({ leg: { status: "in_progress", conclusion: null }, trunk: "success", trunkLeg: "success" }), "pending");
  assert.equal(verdict({ trunk: "success", trunkLeg: "success" }), "pending");
});

test("a trunk that cannot be compared with is `cannot`, which is a refusal and never clear", () => {
  assert.equal(verdict({ ...RED_HEAD, trunk: "none" }), "cannot");
  assert.equal(verdict({ ...RED_HEAD, trunk: "cancelled" }), "cannot", "a cancelled run says nothing, so there is no run to compare with");
  assert.equal(verdict({ ...RED_HEAD, trunk: "success" }), "cannot", "the run has no cross-repo job");
  assert.equal(verdict({ ...RED_HEAD, trunk: "success", trunkLeg: "cancelled" }), "cannot", "a cancelled trunk leg says nothing to compare with");
});

test("a `Cross-repo-red:` line names the exit only when it names a ticket key, read by shape (A11-127)", () => {
  const base = { ...RED_HEAD, trunk: "success", trunkLeg: "success" } as const;
  assert.equal(verdict({ ...base, body: "Cross-repo-red: A11-1" }), "clear");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: NBF-123\r\n" }), "clear", "a CRLF body reads the same");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: #5" }), "red", "a GitHub row is no exit: rows live in Linear and the copies are closed");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: a11ign/a11ign#5188" }), "red");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: soon" }), "red", "a malformed declaration is not one");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: A11-1 and more" }), "red", "the whole line is the key");
  assert.equal(verdict({ ...base, body: "Cross-repo-red: a11-1" }), "red", "a key is upper case");
  assert.equal(verdict({ ...base, body: "no declaration here" }), "red");
  assert.match(drive({ ...base, body: "no declaration here" }, "cross_repo_verdict 5").out, /carries no `Cross-repo-red:` line/);
  assert.match(drive({ ...base, body: "Cross-repo-red: #5" }, "cross_repo_verdict 5").out, /names no ticket; `#5` is not a ticket key/);
});

test("a refusal is posted ONCE, leaves the pull request unarmed (exit 1) and says what to add", () => {
  const base = { ...RED_HEAD, trunk: "success", trunkLeg: "success" } as const;
  const first = drive(base, 'cross_repo_gate 5; echo "rc=$?"');
  assert.match(first.out, /rc=1$/);
  assert.ok(first.posted.includes(MARKER), "the refusal is posted under its marker");
  assert.match(first.posted, /Cross-repo-red: <ticket>/);
  const again = drive({ ...base, comments: `earlier\n${MARKER}\nbody` }, 'cross_repo_gate 5; echo "rc=$?"');
  assert.match(again.out, /rc=1$/);
  assert.equal(again.posted, "", "a refusal already on the pull request is not said again");
});

test("the gate returns 0 for a clear pull request and 1, unposted, for one still pending at the deadline", () => {
  const clear = drive({ leg: { status: "completed", conclusion: "success" } }, 'cross_repo_gate 5; echo "rc=$?"');
  assert.match(clear.out, /rc=0$/);
  const pending = drive({ leg: { status: "queued", conclusion: null } }, 'sleep() { :; }; cross_repo_gate 5; echo "rc=$?"');
  assert.match(pending.out, /has not concluded[\s\S]*rc=1$/);
  assert.equal(pending.posted, "");
});

test("both arming jobs load the library and ask the gate BEFORE they arm; `arm-approved` asks before it marks a draft ready too", () => {
  const runsOf = (job: string) => (doc.jobs[job]?.steps ?? []).map((step) => step.run ?? "").join("\n");
  const sweep = runsOf("arm");
  const approved = runsOf("arm-approved");
  assert.ok(sweep !== "" && approved !== "", "both jobs are found, or the ordering pins below read an empty string");
  for (const [name, run] of [["arm", sweep], ["arm-approved", approved]] as const) {
    assert.match(run, /eval "\$CROSS_REPO_RED_LIB"/, `${name} loads the library`);
    assert.ok(run.includes("CROSS_REPO_DEADLINE="), `${name} sets the deadline the gate waits to`);
  }
  assert.ok(sweep.indexOf("cross_repo_gate") > 0 && sweep.indexOf("cross_repo_gate") < sweep.indexOf("gh pr merge --auto"), "arm asks before it arms");
  assert.ok(approved.indexOf("cross_repo_gate") > 0 && approved.indexOf("cross_repo_gate") < approved.indexOf("gh pr ready"), "arm-approved asks before it readies");
  assert.ok(approved.indexOf("cross_repo_gate") < approved.indexOf("gh pr merge --auto"), "and before it arms");
  assert.match(text, /types: \[[^\]]*\bedited\b[^\]]*\]/, "a body edit asks again, or the declaration is not an exit");
});
