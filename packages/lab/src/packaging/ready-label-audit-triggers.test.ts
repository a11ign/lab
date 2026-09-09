/**
 * THE AUDIT'S CADENCE CLAIM WAS FALSE FOR AS LONG AS IT EXISTED, and nothing could see it (#536).
 *
 * `ready-label-audit.yml`'s header said *"Runs hourly rather than daily"* and argued, correctly, that a
 * daily cadence would let a bad dispatch stand for most of a working session. The cron asked for 27 runs
 * in 27 hours. Measured 2026-09-08 it delivered SEVEN — 13:30, 18:43, 22:01, 00:25, 05:58, 11:20, 16:38 —
 * never at :17, with three gaps over five hours. GitHub delays and drops scheduled runs on a busy repo,
 * so the workflow was running at roughly the cadence its own header rejects.
 *
 * A stated cadence nobody measured is a claim, not a schedule. These pin the replacement: the audit is
 * woken by the EVENTS that change its answer, the cron survives only as the backstop for when nothing
 * happens at all, and every run says what woke it.
 *
 * Deliberately assertions about the WORKFLOW FILE rather than about a helper, because there is no helper
 * — the trigger list is the mechanism. It parses rather than greps: it
 * uses the `yaml` parser the sibling workflow tests already use, so a re-indent or a reordering
 * cannot pass by looking right.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/ready-label-audit.yml");
const raw = readFileSync(workflowPath, "utf8");
const doc = parseYaml(raw) as Record<string, unknown>;
const triggers = doc.on as Record<string, unknown>;

test("#536: the audit is woken by the four issue events that can change its answer", () => {
  assert.deepEqual((triggers.issues as { types: string[] }).types,
    ["labeled", "unlabeled", "closed", "reopened"]);
});

test("#579: and NEVER by `pull_request` -- an audit of the tracker is not a check on a pull request", () => {
  // THIS ASSERTION IS THE INVERSE OF WHAT IT REPLACED, and the inversion is the point rather than a
  // relaxation. #536 gave this workflow `pull_request: [closed]` for a real reason: a merge is how a row
  // becomes debris. But a workflow triggered by `pull_request` attaches its check-run to that PR's head
  // commit, so the verdict appears on the PR page as a check named `audit` -- reporting live tracker
  // state that the PR's diff did not touch and cannot affect. Measured 2026-09-08: it failed on the
  // board-membership call (the bot PAT cannot read Projects v2, #546) and sat RED on the last seven
  // merged PRs for ninety minutes, which is what the chairman was looking at. `audit` is not in the
  // required `gate` context, so it blocked nothing -- a permanently red mark that blocks nothing is
  // precisely the red people stop reading.
  //
  // MUTATION TARGET: restore `pull_request: {types: [closed]}` to the workflow and this test must fail.
  // Re-adding it is the only way this defect comes back, so the guard is pointed at exactly that.
  assert.equal(triggers.pull_request, undefined,
    "the merge case is covered by `issues: [closed]` (close-rows closes the row the PR declares); "
    + "work that ships WITHOUT closing its row is covered by the cron, at the cron's cadence");
  assert.match(raw, /THERE WAS A FOURTH, `pull_request: \[closed\]`, AND #579 REMOVED IT/,
    "and the file says why, so the next author does not restore it from the header's own history");
  assert.match(raw, /WHAT IS ACTUALLY LOST/,
    "the loss is stated rather than waved away -- #443's shape genuinely loses event-time cadence");
});

test("#536: and NOT on push to main -- the allowlist rule is argued with, not around", () => {
  // `push-trigger-allowlist.test.ts` holds the chairman's rule: only a watchdog, a trunk gate or a
  // trunk-followup may trigger on a push to main. This audit is none of the three, and that alone
  // settles it. The comment here USED to add a second reason -- that the `pull_request` closed event
  // already carried the merge -- and #579 deleted that event, so the second reason is gone with it.
  // Rewritten rather than left standing, because a reason whose premise has been removed underneath it
  // reads exactly like a live one.
  assert.equal(triggers.push, undefined,
    "the allowlist rule excludes this workflow on its own terms, with or without another event");
  assert.match(raw, /NO `push: branches: \[main\]`, AND NOT BECAUSE IT WOULD NOT WORK/,
    "and the file says why, so the next author does not re-add it and re-break the allowlist test");
});

test("#536: the cron SURVIVES as the backstop -- it is the only thing that fires when nothing happens", () => {
  assert.deepEqual(triggers.schedule, [{ cron: "17 * * * *" }],
    "removing the schedule would leave a quiet repo entirely unaudited");
  assert.ok("workflow_dispatch" in triggers, "and a human must still be able to ask");
});

test("#536: every run says which event woke it -- quiet-because-nothing-changed and " +
  "quiet-because-nothing-fired must not read the same", () => {
  assert.match(raw, /github\.event_name/,
    "the run must name its own trigger; several triggers make silence ambiguous otherwise");
  assert.match(raw, /::notice::ready-label-audit woken by/);
});

test("#536: one verdict at a time, newest wins -- several triggers make pile-ups likelier", () => {
  // #851 SPLIT THE GROUP AND MADE THE CANCEL CONDITIONAL, so both values are now expressions rather than
  // literals. The claim this test was written to pin is unchanged and is asserted below on the events
  // branch: one verdict at a time, newest wins, a cancelled run loses nothing. What changed is that the
  // SCHEDULED run is exempt -- it is the run a day with no label activity depends on, and sharing a
  // group with a burst of label events made the hourly audit whatever survived the burst.
  const concurrency = doc.concurrency as { group: string; "cancel-in-progress": string };
  assert.match(concurrency.group, /^ready-label-audit-/,
    "the group still names this workflow -- it is branched, not renamed");
  assert.match(concurrency.group, /'events'/, "and the event-driven runs still share one queue");
  assert.match(String(concurrency["cancel-in-progress"]), /event_name != 'schedule'/,
    "this audit reads live state and accumulates nothing, so a cancelled EVENT run loses nothing -- but "
    + "a cancelled scheduled run loses the only pass that was going to happen");
});

test("#536 MUTATION TARGET: the refuted claim survives ONLY as a quoted retraction", () => {
  // Not `!raw.includes(...)`: the correction QUOTES the old sentence deliberately, so that nobody
  // restores it from memory -- this repo's own habit of keeping a refuted claim struck through rather
  // than deleted, because a rule whose premise has moved reads exactly like a rule that still applies.
  // What must not exist is an occurrence standing on its own as a live claim.
  const claim = "Runs hourly rather than daily";
  const occurrences = raw.split(claim).length - 1;
  assert.ok(occurrences > 0, "the retraction must still quote what it retracts");
  const quoted = raw.split(`USED TO SAY "${claim}", AND THAT WAS NEVER TRUE`).length - 1;
  assert.equal(occurrences, quoted,
    "every occurrence must sit inside the retraction; a bare one is the claim back again");
  assert.match(raw, /it delivered SEVEN/,
    "and the retraction states the MEASUREMENT, not just that the claim was wrong");
});

test("the checks that #532 fixed are still wired -- this change must not undo them", () => {
  assert.match(raw, /A11IGN_BOT_TOKEN/, "the board check needs the PAT (#532)");
  assert.match(raw, /fetch-depth: 0/, "branchAges reads refs/remotes/origin (#532)");
  assert.match(raw, /pull-requests: read/, "fetchClaimActivity runs `gh pr list` (#532)");
});

// --- #851: CONCURRENCY WAS ALREADY HERE AND DID NOTHING ---
//
// `cancel-in-progress` cancels a run that is IN PROGRESS when a new one starts. This job takes a minute
// or two, so it only collapses events arriving closer together than that. Measured 2026-09-09: 80 runs
// in one hour, 79 on `issues` events, each running to completion because a session's label writes land
// seconds apart while the runs between them finish. The group was never what was missing.

test("#851 an event-driven run is DEBOUNCED before it costs anything -- the parked run is what makes "
  + "cancel-in-progress collapse a burst rather than arrive after the cost is paid", () => {
  const jobs = doc.jobs as { audit: { steps: Record<string, unknown>[] } };
  const steps = jobs.audit.steps;
  const first = steps[0];
  assert.match(String(first.run ?? ""), /^sleep \d+$/,
    "the debounce must be the FIRST step: everything after it is a checkout, an `npm ci` and an audit "
    + "that reads the tracker, and a run cancelled while parked has spent none of it");
  assert.match(String(first.if ?? ""), /event_name == 'issues'/,
    "and only for label events -- delaying the schedule would delay the run that exists for the day "
    + "nobody touches a label");
  assert.ok(Number(/^sleep (\d+)$/.exec(String(first.run))?.[1] ?? 0) >= 60,
    "a debounce shorter than a session's own label-writing rhythm collapses nothing");
});

test("#851 the SCHEDULED run has its own concurrency group and is never cancelled -- sharing one with a "
  + "burst of label events makes the hourly audit whatever survives the burst, which is nothing", () => {
  const { group, "cancel-in-progress": cancel } = doc.concurrency as Record<string, unknown>;
  assert.match(String(group), /event_name == 'schedule'/,
    "the group must BRANCH on the event, or the schedule shares a queue with the events that cancel it");
  assert.match(String(cancel), /event_name != 'schedule'/,
    "and the schedule must not be cancellable, whatever else is");
});
