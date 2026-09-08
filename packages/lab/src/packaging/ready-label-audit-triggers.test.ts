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

test("#536: the audit is woken by the five events that can change its answer", () => {
  assert.deepEqual((triggers.issues as { types: string[] }).types,
    ["labeled", "unlabeled", "closed", "reopened"]);
  assert.deepEqual((triggers.pull_request as { types: string[] }).types, ["closed"]);
});

test("#536: and NOT on push to main -- the allowlist rule is argued with, not around", () => {
  // `push-trigger-allowlist.test.ts` holds the chairman's rule: only a watchdog, a trunk gate or a
  // trunk-followup may trigger on a push to main. This audit is none of the three. `close-rows.yml`
  // already answered the identical question the same way -- the `pull_request` closed event carries the
  // merge, scoped to one PR, needing no allowlist entry. Adding a fourth category to reach a trigger
  // another event already covers would be arguing past a guard rather than with it.
  assert.equal(triggers.push, undefined,
    "a merge arrives as a merged PR, and a merged PR is a closed one");
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
    "the run must name its own trigger; five triggers make silence ambiguous otherwise");
  assert.match(raw, /::notice::ready-label-audit woken by/);
});

test("#536: one verdict at a time, newest wins -- five triggers make pile-ups likelier", () => {
  const concurrency = doc.concurrency as { group: string; "cancel-in-progress": boolean };
  assert.equal(concurrency.group, "ready-label-audit");
  assert.equal(concurrency["cancel-in-progress"], true,
    "this audit reads live state and accumulates nothing, so a cancelled run loses nothing");
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
