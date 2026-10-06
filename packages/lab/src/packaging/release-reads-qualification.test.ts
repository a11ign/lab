// no-token: gh -- this file only imports and calls the pure `qualificationDecision` with injected fixture
// history; `gatherHistory` (the export that actually spawns `gh` and git) is never called here.
/**
 * #3136 (child of #928): the release READS the fleet part's `qualification` commit status for its sha instead of
 * ignoring it. `qualificationDecision` is the whole of that call, and this table calls the SHIPPED function, never a
 * copy of its rules.
 *
 * THE CASE THAT MOST NEEDS A TEST is the absent status, because a default of "no news is good news" would pass every
 * other case here. It is `wait`, and `aDeciderThatProceedsOnEverything` below is REFUSED by it: that is the positive
 * control for the emptiness this table could otherwise hide (a `proceed` row exists, and so does the refusal).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  qualificationDecision, rowToFile, fleetPartReads, isFleetGated, releasedDirectories,
  FLEET_GATED_PACKAGES, RUNNER_ONLY_PACKAGES, PRIVATE_PACKAGES, WAIT_BOUND_MINUTES,
} from "../../../../scripts/release-reads-qualification.mjs";

const RELEASE = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const QUALIFIED = "9988776655443322119988776655443322119988";
const OLDER = "0123456789012345678901234567890123456789";

type State = "success" | "failure" | "pending";
type Status = { state: string; description?: string };
type Entry = { sha: string; changedPaths: string[]; statuses: Status[] };

/** Statuses are NEWEST FIRST, the order GitHub lists them in. */
const on = (sha: string, changedPaths: string[], ...states: State[]): Entry =>
  ({ sha, changedPaths, statuses: states.map((state) => ({ state })) });

/** A release of a package the fleet part gates. */
const decide = (history: Entry[], extra: { packages?: string[]; waitedMinutes?: number } = {}) =>
  qualificationDecision({ releaseSha: RELEASE, packages: extra.packages ?? ["lab"], history,
    waitedMinutes: extra.waitedMinutes ?? 5 });

// The version pull request's own diff: what EVERY release adds on top of the commit that was qualified.
const VERSION_BUMP = [".changeset/enormous-owls-sing.md", "packages/lab/package.json", "packages/lab/CHANGELOG.md",
  "packages/cli/package.json"];

test("success on the exact sha means proceed -- the positive control: a proceed row exists", () => {
  const decision = decide([on(RELEASE, [], "success")]);
  assert.equal(decision.outcome, "proceed");
  assert.match(decision.reason, new RegExp(RELEASE));
});

test("NO status at all means wait, and wait is NOT proceed -- the case a no-news-is-good-news default fails", () => {
  const decision = decide([on(RELEASE, []), on(QUALIFIED, [])]);
  assert.equal(decision.outcome, "wait");
  assert.notEqual(decision.outcome, "proceed");
  assert.match(decision.reason, /no qualification status/);
});

test("the absent case REFUSES a decider that proceeds on everything -- the positive control for the emptiness", () => {
  const aDeciderThatProceedsOnEverything = (input: { history: unknown[] }) => ({ outcome: "proceed", saw: input.history.length });
  const absent = { releaseSha: RELEASE, packages: ["lab"], history: [on(RELEASE, [])], waitedMinutes: 5 };
  assert.equal(aDeciderThatProceedsOnEverything(absent).outcome, "proceed");
  assert.notEqual(qualificationDecision(absent).outcome, aDeciderThatProceedsOnEverything(absent).outcome,
    "the shipped decider must disagree with the always-proceed fixture on an absent status");
});

test("pending means wait, with the first run named", () => {
  const decision = decide([on(RELEASE, [], "pending")]);
  assert.equal(decision.outcome, "wait");
  assert.match(decision.reason, /pending/);
  assert.match(decision.reason, /first run/);
});

test("one failure means rerun: a CANDIDATE regression, not a proven one, and nothing publishes", () => {
  const decision = decide([on(RELEASE, [], "failure")]);
  assert.equal(decision.outcome, "rerun");
  assert.match(decision.reason, /CANDIDATE regression, not yet a proven one/);
  assert.match(decision.reason, /no threshold moves and no stage is skipped/);
});

test("a failure followed by a re-run SUCCESS on the same sha means proceed (newest first)", () => {
  assert.equal(decide([on(RELEASE, [], "success", "failure")]).outcome, "proceed");
});

test("a failure followed by a re-run still PENDING means wait, and says it is the re-run", () => {
  const decision = decide([on(RELEASE, [], "pending", "failure")]);
  assert.equal(decision.outcome, "wait");
  assert.match(decision.reason, /re-run after a failure/);
});

test("two failures mean regression: a real one, and a row is filed", () => {
  const decision = decide([on(RELEASE, [], "failure", "failure")]);
  assert.equal(decision.outcome, "regression");
  assert.match(decision.reason, /FAILED twice/);
  assert.match(decision.reason, /`regression` label/);
});

test("a pending re-run between two failures does not hide the first: still regression", () => {
  assert.equal(decide([on(RELEASE, [], "failure", "pending", "failure")]).outcome, "regression");
});

test("only failures SINCE the last success count: failure, success, failure is one failure -- rerun", () => {
  assert.equal(decide([on(RELEASE, [], "failure", "success", "failure")]).outcome, "rerun");
});

test("a package no fleet stage gates means proceed on the runner part alone, and the reason says so", () => {
  const decision = decide([on(RELEASE, [])], { packages: ["scorer", "cli"] });
  assert.equal(decision.outcome, "proceed");
  assert.match(decision.reason, /no fleet stage gates scorer, cli/);
  assert.match(decision.reason, /runner part alone/);
});

test("ONE gated package among ungated ones keeps the whole release behind the fleet part", () => {
  assert.equal(decide([on(RELEASE, [])], { packages: ["cli", "lab"] }).outcome, "wait");
});

test("toolchain is runner-only: a release of it proceeds on the runner part alone, and lab still waits (the control)", () => {
  const bare = [on(RELEASE, [])];
  assert.equal(decide(bare, { packages: ["toolchain"] }).outcome, "proceed");
  assert.match(decide(bare, { packages: ["toolchain"] }).reason, /runner part alone/);
  assert.equal(decide(bare, { packages: ["lab"] }).outcome, "wait");
  assert.deepEqual(
    [FLEET_GATED_PACKAGES, RUNNER_ONLY_PACKAGES, PRIVATE_PACKAGES].map((list) => list.includes("toolchain")),
    [false, true, false],
  );
});

test("a package named in neither table is GATED, never released past the fleet part by omission", () => {
  assert.equal(isFleetGated("a-package-nobody-classified"), true);
  assert.equal(decide([on(RELEASE, [])], { packages: ["a-package-nobody-classified"] }).outcome, "wait");
});

test("success on an EARLIER commit carries when only the version bump changed since -- every release's own diff", () => {
  const decision = decide([on(RELEASE, []), on(QUALIFIED, VERSION_BUMP, "success")]);
  assert.equal(decision.outcome, "proceed");
  assert.match(decision.reason, new RegExp(QUALIFIED));
  assert.match(decision.reason, /changed no path the fleet part reads/);
});

test("success on an earlier commit does NOT carry once a path the fleet part reads changed since", () => {
  for (const path of ["packages/lab/src/stability.mjs", "packages/evidence/src/index.ts",
    "pnpm-lock.yaml", "scripts/anything.mjs", "a-path-nobody-thought-of"]) {
    const decision = decide([on(RELEASE, []), on(QUALIFIED, [...VERSION_BUMP, path], "success")]);
    assert.equal(decision.outcome, "wait", `${path} is read by the fleet part`);
  }
});

test("a FAILURE on an earlier commit with nothing read changed since still applies: it is the same code", () => {
  assert.equal(decide([on(RELEASE, []), on(QUALIFIED, VERSION_BUMP, "failure")]).outcome, "rerun");
});

test("a failure is NEVER softened by an older success: the nearest commit carrying a status decides", () => {
  const decision = decide([on(RELEASE, []), on(QUALIFIED, VERSION_BUMP, "failure"), on(OLDER, VERSION_BUMP, "success")]);
  assert.equal(decision.outcome, "rerun");
});

test("a changed read path ends the search: an older success past it is out of reach", () => {
  const decision = decide([on(RELEASE, []), on(QUALIFIED, ["packages/lab/src/a.mjs"]), on(OLDER, ["packages/lab/src/a.mjs"], "success")]);
  assert.equal(decision.outcome, "wait");
});

test("a wait past the measured bound is overdue and says to raise a row, not skip; inside it is not overdue", () => {
  const late = decide([on(RELEASE, [])], { waitedMinutes: WAIT_BOUND_MINUTES + 1 });
  assert.equal(late.outcome, "wait");
  assert.equal(late.overdue, true);
  assert.match(late.reason, /raise a row, do not skip/);
  assert.equal(decide([on(RELEASE, [])], { waitedMinutes: WAIT_BOUND_MINUTES }).overdue, false);
});

test("an overdue wait is still a wait: lateness never turns into proceed", () => {
  assert.equal(decide([on(RELEASE, [])], { waitedMinutes: 100000 }).outcome, "wait");
});

test("CANNOT_TELL is refused, never read as absence or a pass", () => {
  assert.throws(() => decide([on(RELEASE, [])], { packages: [] }), /CANNOT_TELL/);
  assert.throws(() => decide([]), /CANNOT_TELL/);
  assert.throws(() => decide([on(QUALIFIED, [], "success")]), /CANNOT_TELL/);
  assert.throws(() => qualificationDecision({ releaseSha: RELEASE, packages: ["lab"], waitedMinutes: 5,
    history: [{ sha: RELEASE, changedPaths: [], statuses: [{ state: "great" }] }] }), /CANNOT_TELL/);
});

test("GitHub's own `error` state reads as a failure, never as a pass", () => {
  const decision = qualificationDecision({ releaseSha: RELEASE, packages: ["lab"], waitedMinutes: 5,
    history: [{ sha: RELEASE, changedPaths: [], statuses: [{ state: "error" }] }] });
  assert.equal(decision.outcome, "rerun");
});

test("the description the lab posted is carried into the reason", () => {
  const decision = qualificationDecision({ releaseSha: RELEASE, packages: ["lab"], waitedMinutes: 5,
    history: [{ sha: RELEASE, changedPaths: [], statuses: [{ state: "success", description: "gate:stability 9 of 9, run 42" }] }] });
  assert.match(decision.reason, /gate:stability 9 of 9, run 42/);
});

test("only `proceed` publishes: no other outcome is spelled proceed", () => {
  const outcomes = new Set([
    decide([on(RELEASE, [], "success")]).outcome, decide([on(RELEASE, [])]).outcome,
    decide([on(RELEASE, [], "failure")]).outcome, decide([on(RELEASE, [], "failure", "failure")]).outcome,
  ]);
  assert.deepEqual([...outcomes].sort(), ["proceed", "regression", "rerun", "wait"]);
});

test("every package directory is classified exactly once, so adding one fails HERE and not at a release", () => {
  // A PACKAGE is a directory with a manifest: `packages/worker-fleet/` is a layer checkout where `pnpm run build` laid it (#3504), with no manifest, untracked.
  const directories = readdirSync("packages", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((name) => !["node_modules"].includes(name) && existsSync(`packages/${name}/package.json`));
  assert.ok(directories.length >= 8, "the discovery found the packages (positive control for the emptiness; ten until #3447 took nvda-speech out, with nvda-worker the eleventh, and nine until #3504 took worker-fleet)");
  const classified = [...FLEET_GATED_PACKAGES, ...RUNNER_ONLY_PACKAGES, ...PRIVATE_PACKAGES];
  assert.deepEqual([...classified].sort(), [...directories].sort());
  assert.equal(new Set(classified).size, classified.length, "no package is in two tables");
});

test("PRIVATE_PACKAGES are private manifests, and every PUBLISHED package is in a fleet table, never only by default", () => {
  const manifest = (dir: string) => JSON.parse(readFileSync(`packages/${dir}/package.json`, "utf8"));
  for (const dir of PRIVATE_PACKAGES) assert.equal(manifest(dir).private, true, `${dir} is listed private but publishes`);
  // lab, control and guards are private here too (#3126: their own repositories release them), so a private manifest
  // may sit in a fleet table; what may NOT happen is a published one being only in PRIVATE_PACKAGES.
  const published = readdirSync("packages", { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => d.name).filter((dir) => existsSync(`packages/${dir}/package.json`)).filter((dir) => manifest(dir).private !== true);
  assert.ok(published.length >= 4, "the discovery found published packages (positive control for the emptiness)");
  for (const dir of published) {
    assert.ok([...FLEET_GATED_PACKAGES, ...RUNNER_ONLY_PACKAGES].includes(dir), `${dir} is published and in no fleet table`);
  }
});

test("fleetPartReads exempts the version bump and prose, and nothing a stage could read", () => {
  for (const path of VERSION_BUMP) assert.equal(fleetPartReads(path), false, path);
  for (const path of ["docs/x.md", ".github/workflows/release.yml", "README.md"]) assert.equal(fleetPartReads(path), false, path);
  for (const path of ["packages/lab/src/x.ts", "packages/lab/package.json.bak", "pnpm-lock.yaml", "package.json"]) {
    assert.equal(fleetPartReads(path), true, path);
  }
});

test("the plan's readings name the release's directories: the ones ahead on a publish, every one on a rehearsal", () => {
  const directoryOf = (name: string) => name.replace(/^@a11ign\//, "");
  const readings = JSON.stringify([
    { name: "@a11ign/lab", state: "ahead" }, { name: "@a11ign/scorer", state: "level" }]);
  assert.deepEqual(releasedDirectories(readings, directoryOf), ["lab"]);
  const none = JSON.stringify([{ name: "@a11ign/lab", state: "level" }, { name: "@a11ign/scorer", state: "level" }]);
  assert.deepEqual(releasedDirectories(none, directoryOf), ["lab", "scorer"]);
  assert.throws(() => releasedDirectories("", directoryOf), /CANNOT_TELL/);
  assert.throws(() => releasedDirectories("[]", directoryOf), /CANNOT_TELL/);
});

test("release.yml READS the verdict in the `guards` job the call needs, and only a rehearsal may continue past a stop", () => {
  const { guards, release } = jobs();
  const steps = guards.steps!;
  const readAt = steps.findIndex((step) => step.name === "Read the fleet part's verdict for this sha");
  assert.notEqual(readAt, -1, "the step that reads the verdict is in release.yml's guards job");
  const step = steps[readAt] as Step & { id?: string; "continue-on-error"?: string };
  assert.equal(step.id, "qualification", "the filing job reads its outputs by this id");
  assert.match(step.run ?? "", /node scripts\/release-reads-qualification\.mjs --sha=\$\{\{ github\.sha \}\}/);
  assert.equal(step["continue-on-error"], "${{ github.event_name == 'workflow_dispatch' }}",
    "a stop is survivable only in a rehearsal (a dispatch), which publishes nothing");
  assert.ok([release.needs].flat().includes("guards"),
    "#3717: the verdict is read BEFORE the publish because the call `needs` the job that reads it");
  assert.equal(guards.permissions?.statuses, "read", "the verdict is read from commit statuses");
});

// ---- #3291: the release files a row when the wait is overdue or a regression is confirmed ----------------------------

const labelsOf = (row: { labels: string[] } | null) => row?.labels ?? [];

test("an OVERDUE wait names a row: the sha in the title, its own label, the bound and the writer in the body", () => {
  const decision = decide([on(RELEASE, [])], { waitedMinutes: WAIT_BOUND_MINUTES + 1 });
  const row = rowToFile(decision, RELEASE)!;
  assert.ok(row, "an overdue wait files a row");
  assert.match(row.title, new RegExp(RELEASE));
  assert.ok(labelsOf(row).includes("qualification-overdue"));
  assert.match(row.body, new RegExp(RELEASE));
  assert.match(row.body, new RegExp(`${WAIT_BOUND_MINUTES} minute bound`));
  assert.match(row.body, /#3289/);
  assert.match(row.body, /Nothing is skipped/);
});

test("a REGRESSION names a row with the `regression` label and the sha in the title", () => {
  const row = rowToFile(decide([on(RELEASE, [], "failure", "failure")]), RELEASE)!;
  assert.ok(row, "a regression files a row");
  assert.match(row.title, new RegExp(RELEASE));
  assert.ok(labelsOf(row).includes("regression"));
  assert.match(row.body, /FAILED twice/);
});

test("the two rows have different titles, so one sha's overdue wait never hides its later regression", () => {
  const overdue = rowToFile(decide([on(RELEASE, [])], { waitedMinutes: 1000 }), RELEASE)!;
  const regression = rowToFile(decide([on(RELEASE, [], "failure", "failure")]), RELEASE)!;
  assert.notEqual(overdue.title, regression.title);
});

test("no row for proceed, rerun, or a wait still inside its bound; the run URL goes in the body when there is one", () => {
  assert.equal(rowToFile(decide([on(RELEASE, [], "success")]), RELEASE), null);
  assert.equal(rowToFile(decide([on(RELEASE, [], "failure")]), RELEASE), null);
  assert.equal(rowToFile(decide([on(RELEASE, [])], { waitedMinutes: WAIT_BOUND_MINUTES }), RELEASE), null);
  const row = rowToFile(decide([on(RELEASE, [], "failure", "failure")]), RELEASE, "https://github.com/o/r/actions/runs/7")!;
  assert.match(row.body, /actions\/runs\/7/);
});

test("the overdue case REFUSES a fixture that never files -- the positive control for the emptiness above", () => {
  const aFilerThatNeverFiles = () => null;
  const overdue = decide([on(RELEASE, [])], { waitedMinutes: WAIT_BOUND_MINUTES + 1 });
  assert.equal(aFilerThatNeverFiles(), null);
  assert.notEqual(rowToFile(overdue, RELEASE), aFilerThatNeverFiles(), "the shipped filer must disagree with one that never files");
});

const EXECUTABLE = 0o755;
interface Step { name?: string; run?: string; env?: Record<string, string> }
interface Job { needs?: string | string[]; if?: string; permissions?: Record<string, string>; outputs?: Record<string, string>; steps?: Step[] }
const jobs = () => (parseYaml(readFileSync(".github/workflows/release.yml", "utf8")) as { jobs: Record<string, Job> }).jobs;

test("the filing job holds `issues: write` and `contents: read` and nothing else, and the publishing job holds only what the called workflow needs", () => {
  const { "qualification-row": filing, release, guards } = jobs();
  assert.deepEqual(filing.permissions, { contents: "read", issues: "write" });
  assert.deepEqual(release.permissions, { contents: "write", checks: "read", "id-token": "write" },
    "#3717: the call's permissions are exactly what the reusable workflow's jobs may use, and no more");
  assert.deepEqual(guards.permissions, { contents: "read", statuses: "read" }, "the guards job reads, and writes nothing");
  assert.ok(!filing.steps!.some((step) => step.run === undefined), "every step of the filing job runs a command: no `uses:` action meets the issue token");
  assert.deepEqual([filing.needs].flat().sort(), ["guards"]);
  assert.match(filing.if!, /failure\(\)/);
  assert.match(filing.if!, /github\.event_name == 'push'/, "a rehearsal files nothing");
});

test("the guards job hands the row on: each `row-*` output reads the verdict step", () => {
  const { guards } = jobs();
  for (const name of ["row-title", "row-labels", "row-body"]) {
    assert.equal(guards.outputs?.[name], `\${{ steps.qualification.outputs.${name} }}`);
  }
});

/** Runs the filing job's OWN shell with a fake `gh` that records every call and answers the two lookups. */
function runFilingStep(existing: { rows: number; labelsPresent: string[] }, row: { title: string; labels: string[]; body: string }) {
  const dir = mkdtempSync(join(tmpdir(), "filing-"));
  try {
    mkdirSync(join(dir, "bin"));
    const record = join(dir, "calls.txt");
    writeFileSync(join(dir, "bin/gh"), `#!/bin/bash
printf '%s\\n' "$*" >> "$RECORD"
case "$1 $2" in
  "issue list") echo "$FAKE_ROWS" ;;
  "label list") if printf '%s\\n' "$FAKE_LABELS" | grep -qxF "$LABEL"; then echo 1; else echo 0; fi ;;
esac
`);
    chmodSync(join(dir, "bin/gh"), EXECUTABLE);
    const step = jobs()["qualification-row"].steps!.find((candidate) => /gh issue create/.test(candidate.run ?? ""))!;
    const result = spawnSync("bash", ["-c", step.run!], { encoding: "utf8", env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`, RECORD: record, FAKE_ROWS: String(existing.rows),
      FAKE_LABELS: existing.labelsPresent.join("\n"), ROW_TITLE: row.title, ROW_LABELS: row.labels.join(","), ROW_BODY: row.body } });
    assert.equal(result.status, 0, result.stderr);
    let calls: string[] = [];
    try { calls = readFileSync(record, "utf8").trim().split("\n"); } catch { /* the fake was never called */ }
    return calls;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ROW = { title: `release ${RELEASE}: qualification wait overdue`, labels: ["qualification-overdue", "answer:orchestrator"], body: "the body" };

test("the filing step files ONE row, creating only the label that is missing", () => {
  const calls = runFilingStep({ rows: 0, labelsPresent: ["answer:orchestrator"] }, ROW);
  const creates = calls.filter((call) => call.startsWith("issue create"));
  assert.equal(creates.length, 1);
  assert.match(creates[0], new RegExp(`--title ${ROW.title}`));
  assert.match(creates[0], /--label qualification-overdue --label answer:orchestrator/);
  assert.deepEqual(calls.filter((call) => call.startsWith("label create")), ["label create qualification-overdue"]);
});

test("a re-run for the same sha finds the existing row and files none", () => {
  const calls = runFilingStep({ rows: 1, labelsPresent: [] }, ROW);
  assert.ok(calls.some((call) => call.startsWith("issue list")), "the step asked (positive control: the lookup ran)");
  assert.deepEqual(calls.filter((call) => /^(issue|label) create/.test(call)), []);
});
