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
import { readdirSync, readFileSync } from "node:fs";
import {
  qualificationDecision, fleetPartReads, isFleetGated, releasedDirectories,
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
  for (const path of ["packages/lab/src/stability.mjs", "packages/worker-fleet/src/cli-flags.mjs",
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
  const directories = readdirSync("packages", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((name) => !["node_modules"].includes(name));
  assert.ok(directories.length >= 10, "the discovery found the packages (positive control for the emptiness)");
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
    .map((d) => d.name).filter((dir) => manifest(dir).private !== true);
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

test("release.yml READS the verdict before it publishes, and only a rehearsal may continue past a stop", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const read = workflow.indexOf("name: Read the fleet part's verdict for this sha");
  const publish = workflow.indexOf("- name: Publish\n");
  assert.ok(read !== -1, "the step that reads the verdict is in release.yml");
  assert.ok(publish !== -1, "the Publish step is where this test looks for it (positive control for the order check)");
  assert.ok(read < publish, "the verdict is read BEFORE Publish");
  const step = workflow.slice(read, publish).split("\n      - ")[0];
  assert.match(step, /node scripts\/release-reads-qualification\.mjs --sha=\$\{\{ github\.sha \}\}/);
  assert.match(step, /continue-on-error: \$\{\{ needs\.plan\.outputs\.mode == 'rehearsal' \}\}/,
    "a stop is survivable only in a rehearsal, which publishes nothing");
  assert.doesNotMatch(step, /continue-on-error: true/);
  assert.match(workflow, /permissions:[\s\S]*?statuses: read/);
});
