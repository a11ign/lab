/**
 * #3211: A BODY EDIT OR A LABEL RUNS THE BODY CHECKS; THE TEST SUITE RUNS ON NEW CODE.
 *
 * The chairman's sample, 2026-10-03 (278 pull-request runs of `ci.yml` since 2026-10-01; #3212 reconciles it with a larger
 * count): 158 were on a head SHA that had ALREADY been tested, 134 of those were cancelled. One concurrency group per ref meant a label added while `ts` was
 * running cancelled `ts`, and the run that replaced it began the whole suite again. The workflow's own header said a
 * body edit "changes no files, so the heavy jobs skip"; three runs of one head (1d96ebe0b) show `ts` and `guardSweep`
 * (and `agentOrg`, since deleted) running in full each time, because `changed` diffs against the BASE, so on a body edit the diff is the
 * whole pull request.
 *
 * THE DESIGN CONSTRAINT IS WHAT MAKES THIS MORE THAN A TRIGGER EDIT. `gate` is the one required check, and a meta run
 * skips the heavy jobs, which `gate` reads as passing. Unguarded, a label would report `gate` green on a head whose
 * tests are still running (or failed), and that newer check run is the one auto-merge reads. So this file pins, over
 * the PARSED workflow and the real step text, that the two kinds of run agree: a meta run is green only if the code run
 * of the same head concluded green, and a code run is red if a body check that started after it is red.
 *
 * Every assertion reads `ci.yml`. The `if:` expressions are EVALUATED against contexts (a comment or an `echo` naming
 * a condition cannot satisfy them), and the gate's shell is RUN against a stub `gh` serving recorded listings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const EXECUTABLE = 0o755;
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (file: string): string => readFileSync(join(REPO, ".github/workflows", file), "utf8");

type Step = { name?: string; if?: string; run?: string; env?: Record<string, string | number> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps?: Step[]; uses?: string; with?: Record<string, string> };
type Workflow = {
  "run-name"?: string;
  on: { pull_request: { types: string[] }; merge_group: unknown };
  concurrency: { group: string; "cancel-in-progress": boolean | string };
  jobs: Record<string, Job>;
};

const CI = parseYaml(read("ci.yml")) as Workflow;

// The three types that change an INPUT (the body, a label) and no code; the rest of the list moves a commit.
const META_TYPES = ["edited", "labeled", "unlabeled"];
const CODE_TYPES = ["opened", "synchronize", "reopened"];

// --- an evaluator for the subset of GitHub's expression language ci.yml uses -------------------------------------

type Ctx = Record<string, unknown>;

function lookup(ctx: Ctx, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value !== null && typeof value === "object" ? (value as Ctx)[key] : undefined), ctx);
}

const FUNCTIONS = {
  contains: (haystack: unknown, needle: unknown) => (Array.isArray(haystack) || typeof haystack === "string") && haystack.includes(needle as never),
  fromJSON: (text: string): unknown => JSON.parse(text),
  format: (template: string, ...args: unknown[]) => template.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
};

/** Evaluates `${{ expr }}` (or a bare expression, as an `if:` is written) against `ctx`; refuses anything it does not model. */
function evaluate(expression: string, ctx: Ctx): unknown {
  const inner = expression.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1");
  const tokens = inner.match(/'(?:[^']|'')*'|[A-Za-z_][\w.]*|\|\||&&|==|!=|!|\(|\)|,|\s+/g) ?? [];
  assert.equal(tokens.join(""), inner, `the expression uses something this evaluator does not model: ${inner}`);
  const js = tokens.map((token, index) => {
    if (token.startsWith("'")) return JSON.stringify(token.slice(1, -1).replace(/''/g, "'"));
    if (!/^[A-Za-z_]/.test(token)) return token;
    if (["true", "false", "null"].includes(token)) return token;
    const next = tokens.slice(index + 1).find((t) => t.trim() !== "");
    if (next === "(") {
      assert.ok(Object.hasOwn(FUNCTIONS, token), `the expression calls ${token}(), which this evaluator does not model`);
      return `fn.${token}`;
    }
    return `get(${JSON.stringify(token)})`;
  }).join("");
  return new Function("fn", "get", `return (${js});`)(FUNCTIONS, (path: string) => lookup(ctx, path));
}

/** A string with `${{ }}` segments inside it, as a `group:` is written. */
const interpolate = (text: string, ctx: Ctx): string => text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression, ctx)));

const EVERY_SCOPED_OUTPUT = Object.fromEntries(
  ["ts", "python", "ansible", "docs", "board", "changeset", "rulesFitness"].map((name) => [name, "true"]));

/** The contexts a run of `ci.yml` is evaluated under, for one trigger. */
function context(event: { name: "pull_request" | "merge_group"; action: string; state?: string; title?: string }): Ctx {
  return {
    github: {
      event_name: event.name,
      event: event.name === "pull_request"
        ? { action: event.action, pull_request: { state: event.state ?? "open", title: event.title ?? "a change", head: { sha: "abc123" } } }
        : { action: event.action },
      ref: event.name === "pull_request" ? "refs/pull/7/merge" : "refs/heads/gh-readonly-queue/main/pr-7",
      token: "t",
      repository: "o/r",
    },
    needs: { changed: { outputs: EVERY_SCOPED_OUTPUT, result: "success" } },
  };
}

const prEvent = (action: string, state = "open") => context({ name: "pull_request", action, state });
const queueEvent = () => context({ name: "merge_group", action: "checks_requested" });

const runsOn = (job: Job, ctx: Ctx): boolean => job.if === undefined || Boolean(evaluate(job.if, ctx));

// --- which jobs are which -----------------------------------------------------------------------------------------

/** A job READS A PULL-REQUEST INPUT when its definition names the pull request's body or number: what a body edit or a label changes. */
// #3286: `acceptance` hands no body to its called workflow any more, which reads the LIVE body by pull-request number
// in a job of its own, so a call to that workflow is the read and the event text no longer names it here.
const READS_THE_LIVE_BODY = "./.github/workflows/reusable-acceptance.yml";
const readsAPullRequestInput = (job: Job): boolean =>
  /github\.event\.pull_request\.(body|number)/.test(JSON.stringify(job)) || job.uses === READS_THE_LIVE_BODY;

/** `changed` decides what the diff touched and `gate` is the verdict; neither is a check of its own. */
const FRAME = ["changed", "gate"];

const bodyChecks = (doc: Workflow): string[] =>
  Object.entries(doc.jobs).filter(([name, job]) => !FRAME.includes(name) && readsAPullRequestInput(job)).map(([name]) => name);

const heavyJobs = (doc: Workflow): string[] =>
  Object.keys(doc.jobs).filter((name) => !FRAME.includes(name) && !bodyChecks(doc).includes(name));

/** The heavy jobs that WOULD run on `action` (outputs all true, the pull request open). */
const heavyJobsRunningOn = (doc: Workflow, action: string): string[] =>
  heavyJobs(doc).filter((name) => runsOn(doc.jobs[name], prEvent(action)));

test("the discovery finds the jobs it is about, so no assertion below examines an empty set", () => {
  assert.deepEqual([...bodyChecks(CI)].sort(), ["acceptance", "deliberateRefusals", "ownedPaths"],
    "the jobs that read the pull request's body or number changed; read why each one needs the meta events before editing this list");
  for (const named of ["ts", "guardSweep"]) {
    assert.ok(heavyJobs(CI).includes(named), `${named} is not among the heavy jobs: ${heavyJobs(CI).join(", ")}`);
  }
});

test("every type the workflow triggers on is classified as code or meta, so a new one has to be decided", () => {
  const types = CI.on.pull_request.types;
  assert.ok(types.length > 0, "ci.yml lists no pull_request types, so nothing below was examined");
  const unclassified = types.filter((type) => ![...CODE_TYPES, ...META_TYPES].includes(type));
  assert.deepEqual(unclassified, [], "a pull_request type nobody has said is a code event or a meta event");
  assert.ok(types.some((t) => META_TYPES.includes(t)) && types.some((t) => CODE_TYPES.includes(t)));
});

// --- 1. the concurrency group is keyed by the kind of event --------------------------------------------------------

const groupFor = (doc: Workflow, ctx: Ctx): string => interpolate(doc.concurrency.group, ctx);
const sharedGroup = (doc: Workflow): boolean =>
  new Set([...CODE_TYPES, ...META_TYPES].map((action) => groupFor(doc, prEvent(action)))).size === 1;

test("1. a meta event's concurrency group differs from a code event's, for the same pull request", () => {
  const code = CODE_TYPES.map((action) => groupFor(CI, prEvent(action)));
  const meta = META_TYPES.map((action) => groupFor(CI, prEvent(action)));
  assert.equal(new Set(code).size, 1, `code events must share one group (a new push must cancel the last): ${code.join(", ")}`);
  assert.equal(new Set(meta).size, 1, `meta events must share one group (a newer label supersedes an older one): ${meta.join(", ")}`);
  assert.notEqual(code[0], meta[0], "a label shares a group with a test run, so it can cancel one");
  assert.equal(CI.concurrency["cancel-in-progress"], true,
    "cancel-in-progress is what makes a new code event cancel the old one; it is safe to leave on only because the groups no longer meet");
});

test("1. the merge queue's group is a code group: it never shares one with a meta event", () => {
  assert.equal(groupFor(CI, queueEvent()).endsWith("-code"), true, groupFor(CI, queueEvent()));
});

test("1. POSITIVE CONTROL: the detector fires on the old one-group-per-ref expression", () => {
  const before = { ...CI, concurrency: { group: "ci-${{ github.ref }}", "cancel-in-progress": true } };
  assert.equal(sharedGroup(before), true, "the old expression must read as one shared group");
  assert.equal(sharedGroup(CI), false, "the real ci.yml still has a single group for every kind of event");
});

// --- 2. the heavy jobs exclude the meta types ---------------------------------------------------------------------

test("2. no heavy job runs on a body edit, a label or an unlabel", () => {
  for (const action of META_TYPES) {
    assert.deepEqual(heavyJobsRunningOn(CI, action), [],
      `on '${action}' these jobs still run the suite: a label would cancel or rerun it. Add the meta guard to each \`if:\``);
  }
});

test("2. the heavy jobs DO run on every code event, so the guard excludes only the meta types", () => {
  for (const action of CODE_TYPES) {
    assert.deepEqual(heavyJobs(CI).filter((name) => !runsOn(CI.jobs[name], prEvent(action))), [],
      `on '${action}' a heavy job does not run although every scoped output is true`);
  }
});

test("2. POSITIVE CONTROL: a heavy job added without the guard is found, and so is one that lost it", () => {
  const added = { ...CI, jobs: { ...CI.jobs, lint: { steps: [{ run: "true" }] } as Job } };
  assert.deepEqual(heavyJobsRunningOn(added, "labeled"), ["lint"]);
  const lost = structuredClone(CI);
  lost.jobs.ts.if = "needs.changed.outputs.ts == 'true'";
  assert.deepEqual(heavyJobsRunningOn(lost, "edited"), ["ts"]);
  const lostByGuardSweep = structuredClone(CI);
  delete lostByGuardSweep.jobs.guardSweep.if;
  assert.deepEqual(heavyJobsRunningOn(lostByGuardSweep, "unlabeled"), ["guardSweep"]);
});

test("2. the body checks still run on a meta event: they are what a body edit or a label is FOR", () => {
  // `deliberateRefusals` is the one the row's first draft listed as skipped. It carries the `hold:` refusal, and a hold is
  // placed by adding a label, which is why `labeled` is a trigger at all (2026-09-09); skipping it would let a held pull
  // request through. It also compares the body's `Closes` with what GitHub will close, which only a body edit can fix.
  for (const action of META_TYPES) {
    for (const name of bodyChecks(CI)) {
      assert.equal(runsOn(CI.jobs[name], prEvent(action)), true, `${name} does not run on '${action}'`);
    }
    assert.equal(runsOn(CI.jobs.changed, prEvent(action)), true, "`changed` is the frame the body checks `need`");
  }
});

test("2. a closed pull request still runs nothing on a meta event (#690)", () => {
  for (const action of META_TYPES) {
    const running = Object.entries(CI.jobs).filter(([name, job]) => name !== "gate" && runsOn(job, prEvent(action, "closed"))).map(([name]) => name);
    assert.deepEqual(running, [], `a ${action} on a merged pull request runs ${running.join(", ")}`);
  }
});

// --- 4. the merge queue still runs everything it ran ---------------------------------------------------------------

test("4. merge_group runs every heavy job, and skips only the jobs that read a pull request", () => {
  assert.deepEqual(heavyJobs(CI).filter((name) => !runsOn(CI.jobs[name], queueEvent())), [],
    "the queue is where a combined tree is tested; a heavy job that skips there weakens it");
  const skippedInTheQueue = Object.keys(CI.jobs).filter((name) => name !== "gate" && !runsOn(CI.jobs[name], queueEvent()));
  assert.deepEqual(skippedInTheQueue.sort(), [...bodyChecks(CI)].sort(),
    "a queue entry has no pull request body, number or base to read: those jobs, and only those, are exempt there (#1109)");
});

// --- 3. gate cannot be green from skipped jobs unless the other kind of run agrees --------------------------------

const GATE = CI.jobs.gate;
const gateLoop = GATE.steps!.find((step) => step.name === "Every job that ran, ran clean")!;
const agreement = GATE.steps!.find((step) => /^The other kind of run on this head agrees/.test(step.name ?? ""))!;

test("3. the gate has the agreement step, after the loop, on pull requests only, with `actions: read` and nothing more", () => {
  assert.ok(agreement?.run, "gate lost the step that makes a meta run wait for the code run");
  assert.ok(GATE.steps!.indexOf(agreement) > GATE.steps!.indexOf(gateLoop));
  assert.equal(agreement.if, "github.event_name == 'pull_request'", "a queue entry has no other kind of run to agree with");
  assert.deepEqual(GATE.permissions, { actions: "read" }, "the lookup needs actions: read and the job needs nothing else");
});

// Fixtures: the listing `GET /actions/workflows/ci.yml/runs?head_sha=…` and a run's jobs, as the API shapes them.
const MARKER = (action: string) => ` [meta event, ${action}]`;
interface RunFixture { id: number; display_title: string; status: string; conclusion: string | null; created_at: string }
const run = (id: number, over: Partial<RunFixture> = {}): RunFixture =>
  ({ id, display_title: "a change", status: "completed", conclusion: "success", created_at: `2026-10-03T10:00:${String(id % SECONDS_IN_A_MINUTE).padStart(2, "0")}Z`, ...over });
const codeRun = (id: number, over: Partial<RunFixture> = {}) => run(id, over);
const metaRun = (id: number, over: Partial<RunFixture> = {}) => run(id, { display_title: `a change${MARKER("labeled")}`, ...over });
const listing = (...runs: RunFixture[]) => JSON.stringify({ workflow_runs: runs });
const job = (name: string, status = "completed", conclusion: string | null = "success") => ({ name, status, conclusion });
const jobs = (...list: ReturnType<typeof job>[]) => JSON.stringify({ jobs: list });

const SELF = 900;
const CODE_RUN = 100;
const OTHER_META_RUN = 101;
const NEWER_CODE_RUN = 110;
const META_RUN = 120;
const NEWER_META_RUN = 121;
const SECONDS_IN_A_MINUTE = 60;

/** Runs a gate step's real shell with `gh` replaced by a stub that serves `calls` in order (the last one repeats). */
function runStep(step: Step, action: string, answers: { runs: string[]; jobs?: string[] }, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "a11y-gate-step-"));
  try {
    for (const kind of ["runs", "jobs"] as const) {
      (answers[kind] ?? []).forEach((body, index) => writeFileSync(join(dir, `${kind}.${index + 1}.json`), body));
    }
    writeFileSync(join(dir, "gh"), [
      "#!/usr/bin/env bash",
      'echo "$*" >> "$STUB_DIR/urls"',
      'case "$*" in *"/jobs"*) kind=jobs;; *) kind=runs;; esac',
      'count=$(cat "$STUB_DIR/$kind.count" 2>/dev/null || echo 0); count=$((count + 1)); echo "$count" > "$STUB_DIR/$kind.count"',
      'file="$STUB_DIR/$kind.$count.json"',
      '[ -f "$file" ] || file=$(ls "$STUB_DIR/$kind".*.json | sort -V | tail -1)',
      'cat "$file"',
    ].join("\n"));
    chmodSync(join(dir, "gh"), EXECUTABLE);
    const ctx = context({ name: "pull_request", action });
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.env ?? {})) {
      env[key] = String(typeof value === "string" && value.includes("${{") ? evaluate(value, ctx) : value);
    }
    const result = spawnSync("bash", ["-c", step.run!], {
      encoding: "utf8",
      env: { PATH: `${dir}:${process.env.PATH ?? ""}`, STUB_DIR: dir, GITHUB_RUN_ID: String(SELF), ...env, ATTEMPTS: "3", POLL_SECONDS: "0", ...extraEnv },
    });
    return { status: result.status, out: result.stdout + result.stderr, urls: readFileSync(join(dir, "urls"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const meta = (answers: { runs: string[]; jobs?: string[] }, extraEnv?: Record<string, string>) => runStep(agreement, "labeled", answers, extraEnv);
const code = (answers: { runs: string[]; jobs?: string[] }, extraEnv?: Record<string, string>) => runStep(agreement, "synchronize", answers, extraEnv);

test("3. THE ROW'S PROPERTY: a meta run with every heavy job skipped is green only when the code run concluded green", () => {
  const mine = metaRun(SELF, { status: "in_progress", conclusion: null });
  const green = meta({ runs: [listing(codeRun(CODE_RUN), mine)] });
  assert.equal(green.status, 0, green.out);
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const outcome = meta({ runs: [listing(codeRun(CODE_RUN, { conclusion }), mine)] });
    assert.notEqual(outcome.status, 0, `a code run that ${conclusion} must not let a label report green`);
    assert.match(outcome.out, new RegExp(conclusion));
  }
});

test("3. a code run still going is WAITED FOR: not green, not red, and green once it concludes", () => {
  const mine = metaRun(SELF, { status: "in_progress", conclusion: null });
  const going = codeRun(CODE_RUN, { status: "in_progress", conclusion: null });
  const stillGoing = meta({ runs: [listing(going, mine)] });
  assert.notEqual(stillGoing.status, 0, "no conclusion by the deadline is not green");
  assert.match(stillGoing.out, /no conclusion \('pending'\)/, "the refusal must say it never saw a conclusion, not that the code run failed");
  const becomesGreen = meta({ runs: [listing(going, mine), listing(codeRun(CODE_RUN), mine)] });
  assert.equal(becomesGreen.status, 0, becomesGreen.out);
  const becomesRed = meta({ runs: [listing(going, mine), listing(codeRun(CODE_RUN, { conclusion: "failure" }), mine)] });
  assert.notEqual(becomesRed.status, 0);
  assert.match(becomesRed.out, /'failure'/);
});

test("3. no code run on the head at all is not green either", () => {
  const nothing = meta({ runs: [listing(metaRun(SELF, { status: "in_progress", conclusion: null }))] });
  assert.notEqual(nothing.status, 0);
});

test("3. ANOTHER META RUN'S GREEN IS NOT A CODE VERDICT: the hole this step exists to close", () => {
  // The latest `gate` on the head being a meta run's is exactly the case: its own green says only that the body checks
  // passed. Counting it would let a label's green stand in for tests that never finished.
  const other = metaRun(OTHER_META_RUN, { conclusion: "success" });
  const outcome = meta({ runs: [listing(other, metaRun(SELF, { status: "in_progress", conclusion: null }))] });
  assert.notEqual(outcome.status, 0, "a completed, green META run was read as the code run's conclusion");
});

test("3. the code run is the newest code run: an older failure is superseded by a newer green, not the reverse", () => {
  const mine = metaRun(SELF, { status: "in_progress", conclusion: null });
  const newerGreen = meta({ runs: [listing(codeRun(CODE_RUN, { conclusion: "failure" }), codeRun(NEWER_CODE_RUN, { created_at: "2026-10-03T10:09:00Z" }), mine)] });
  assert.equal(newerGreen.status, 0, newerGreen.out);
  const newerRed = meta({ runs: [listing(codeRun(CODE_RUN), codeRun(NEWER_CODE_RUN, { created_at: "2026-10-03T10:09:00Z", conclusion: "failure" }), mine)] });
  assert.notEqual(newerRed.status, 0);
});

test("3. a title that spoofs the meta marker hides a code run, which waits and fails: the safe direction", () => {
  const spoofed = codeRun(CODE_RUN, { display_title: `a title${MARKER("edited")}` });
  const outcome = meta({ runs: [listing(spoofed, metaRun(SELF, { status: "in_progress", conclusion: null }))] });
  assert.notEqual(outcome.status, 0, "a spoofed code run was not hidden, or a hidden one made the gate green");
});

test("3. the lookup asks for THIS head's runs of ci.yml on pull_request events", () => {
  const outcome = meta({ runs: [listing(codeRun(CODE_RUN), metaRun(SELF))] });
  assert.match(outcome.urls, /workflows\/ci\.yml\/runs\?head_sha=abc123&event=pull_request/);
});

test("3. a code run reads the body checks of a meta run that started after it, through its JOBS and not its gate", () => {
  const mine = codeRun(SELF, { status: "in_progress", conclusion: null, created_at: "2026-10-03T10:05:00Z" });
  const later = metaRun(META_RUN, { created_at: "2026-10-03T10:06:00Z", status: "in_progress", conclusion: null });
  const bodyChecksGreen = jobs(job("changed"), job("deliberateRefusals"), job("acceptance"), job("ownedPaths"), job("ts", "completed", "skipped"),
    // The meta run's own gate is waiting for THIS run: reading it would be a deadlock.
    job("gate", "in_progress", null));
  const agreed = code({ runs: [listing(mine, later)], jobs: [bodyChecksGreen] });
  assert.equal(agreed.status, 0, agreed.out);

  const hold = jobs(job("changed"), job("deliberateRefusals", "completed", "failure"), job("acceptance"), job("gate", "in_progress", null));
  const refused = code({ runs: [listing(mine, later)], jobs: [hold] });
  assert.notEqual(refused.status, 0, "a hold placed during the code run was overruled by the code run's later green");
  assert.match(refused.out, /'failure'/);
});

test("3. a code run waits while the meta run's body checks are unfinished, then follows them", () => {
  const mine = codeRun(SELF, { status: "in_progress", conclusion: null, created_at: "2026-10-03T10:05:00Z" });
  const later = metaRun(META_RUN, { created_at: "2026-10-03T10:06:00Z", status: "in_progress", conclusion: null });
  const unfinished = jobs(job("changed"), job("acceptance", "in_progress", null), job("gate", "queued", null));
  const finished = jobs(job("changed"), job("acceptance"), job("gate", "queued", null));
  assert.equal(code({ runs: [listing(mine, later)], jobs: [unfinished, finished] }).status, 0);
  assert.notEqual(code({ runs: [listing(mine, later)], jobs: [unfinished] }).status, 0, "unfinished at the deadline is not green");
  assert.equal(code({ runs: [listing(mine, later)], jobs: [jobs()] }).status, 1, "a meta run with no jobs yet is pending, not green");
});

test("3. a code run ignores meta runs from before it started: its own body checks are newer than they are", () => {
  const mine = codeRun(SELF, { status: "in_progress", conclusion: null, created_at: "2026-10-03T10:05:00Z" });
  const earlier = metaRun(META_RUN, { created_at: "2026-10-03T10:04:00Z", conclusion: "failure" });
  const outcome = code({ runs: [listing(mine, earlier)], jobs: [jobs(job("deliberateRefusals", "completed", "failure"))] });
  assert.equal(outcome.status, 0, outcome.out);
  assert.doesNotMatch(outcome.urls, /\/jobs/, "an older meta run must not be read at all");
});

test("3. a code run reads the NEWEST meta run's body checks, so a fixed body is not held to an older defect", () => {
  const mine = codeRun(SELF, { status: "in_progress", conclusion: null, created_at: "2026-10-03T10:05:00Z" });
  const older = metaRun(META_RUN, { created_at: "2026-10-03T10:06:00Z" });
  const newer = metaRun(NEWER_META_RUN, { created_at: "2026-10-03T10:07:00Z" });
  const outcome = code({ runs: [listing(mine, older, newer)], jobs: [jobs(job("acceptance"))] });
  assert.equal(outcome.status, 0, outcome.out);
  assert.match(outcome.urls, new RegExp(`runs/${NEWER_META_RUN}/jobs`));
});

// --- the gate, as the job composes its steps ----------------------------------------------------------------------

/** What the `gate` JOB reports: the loop first (placeholders replaced by `results`), then the agreement step if it applies. */
function gateJob(action: string, results: Record<string, string>, answers: { runs: string[]; jobs?: string[] }): "green" | "red" {
  const script = gateLoop.run!.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_, name) => results[name] ?? "skipped");
  if (spawnSync("bash", ["-c", script]).status !== 0) return "red";
  const applies = Boolean(evaluate(agreement.if!, context({ name: "pull_request", action })));
  return !applies || runStep(agreement, action, answers).status === 0 ? "green" : "red";
}

test("3. THE GATE: every heavy job skipped on a label is red without a green code run, green with one", () => {
  const skippedHeavy = Object.fromEntries(heavyJobs(CI).map((name) => [name, "skipped"]));
  const results = { changed: "success", ...skippedHeavy, deliberateRefusals: "success", acceptance: "success", ownedPaths: "success" };
  const mine = metaRun(SELF, { status: "in_progress", conclusion: null });
  assert.equal(gateJob("labeled", results, { runs: [listing(mine)] }), "red", "the label's gate is green on skipped jobs alone");
  assert.equal(gateJob("labeled", results, { runs: [listing(codeRun(CODE_RUN, { status: "in_progress", conclusion: null }), mine)] }), "red");
  assert.equal(gateJob("labeled", results, { runs: [listing(codeRun(CODE_RUN), mine)] }), "green");
});

test("3. a code event's gate is unchanged when no body or label run followed it", () => {
  const results = Object.fromEntries(Object.keys(CI.jobs).filter((name) => name !== "gate").map((name) => [name, "success"]));
  const mine = codeRun(SELF, { status: "in_progress", conclusion: null });
  assert.equal(gateJob("synchronize", results, { runs: [listing(mine)] }), "green");
  assert.equal(gateJob("synchronize", { ...results, ts: "failure" }, { runs: [listing(mine)] }), "red");
});

// --- the marker the lookup depends on -----------------------------------------------------------------------------

test("the run-name marks every meta run and no code run; the lookup's pattern is the same one", () => {
  const pattern = /test\("([^"]+)"\)/.exec(agreement.run!)?.[1];
  assert.ok(pattern, "could not find the marker pattern in the agreement step");
  const marker = new RegExp(JSON.parse(`"${pattern}"`));
  assert.ok(CI["run-name"], "ci.yml has no run-name, so nothing tells a meta run from a code run");
  for (const action of META_TYPES) {
    const runName: string = String(evaluate(CI["run-name"]!, context({ name: "pull_request", action, title: "Fix the body" })));
    assert.match(runName, marker, `the run-name for '${action}' is '${runName}', which the lookup would not recognise as a meta run`);
    assert.ok(runName.startsWith("Fix the body"), "the pull request's title must stay readable in the run list");
  }
  for (const action of CODE_TYPES) {
    const runName: string = String(evaluate(CI["run-name"]!, context({ name: "pull_request", action, title: "Fix the body" })));
    assert.doesNotMatch(runName, marker, `the run-name for '${action}' marks a code run as meta`);
    assert.equal(runName, "", "an empty run-name falls back to GitHub's default (the pull request title); anything else renames code runs");
  }
  assert.doesNotMatch(String(evaluate(CI["run-name"]!, queueEvent())), marker);
});
