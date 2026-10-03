/**
 * A SOURCE THAT ANSWERS TRUTHFULLY ABOUT A WINDOW NOBODY CHOSE — #634, swept.
 *
 * GitHub's `statusCheckRollup` UNIONS superseded check-runs and `mergeStateStatus` reads `BLOCKED`
 * identically for a failing required check and for a stale base. Both are TRUE fields answering a
 * NEIGHBOURING question, and the answer reads exactly like an answer about the window you meant.
 *
 * **The predicate that decides membership**: a read belongs to this class when *the thing it returns and
 * the thing you need can diverge without the read changing.* That is sharper than "bounded window" and
 * it is what separates the sites that matter from the ones that merely mention the field.
 *
 * ## A COUNT IS THE SEARCH SPACE, NOT THE FINDING
 *
 * The row opened with 70 sites; walking the tree found **85 occurrences across 26 files**. Separating
 * the four contexts a scanner meets brings that to **28 reads in code across 10 files** — the rest is
 * prose describing the defect (9), tests asserting about it (16), one recorded fixture that contains the
 * field because it is a real API response (9), and comment-only mentions (0 in code).
 *
 * Of those 28, most are already correct: a `--json` field list is a REQUEST rather than a read, and the
 * files that consume the value mostly do so through `newestPerName`. **The finding was one site**, and
 * it was the one that decides whether a PR may merge.
 *
 * ## A FLOOR ASSERTS ABOUT THE SEARCH; EVERY OTHER ASSERTION IS ABOUT THE RESULT
 *
 * The finding inside the finding, and it generalises past this row.
 *
 * `READS_THE_ROLLUP` first carried a lookbehind meant to exclude the `--json` field list —
 * `(?<!["'\w])\.statusCheckRollup` — which **excludes the reads instead**, because the character before
 * the dot in `pr.statusCheckRollup` is a word character. It found **3** readers where there are **4**.
 *
 * **There is no signal for that.** A sweep whose predicate silently shrinks reports cleanly, and 3-of-4
 * and 4-of-4 are the same output: an empty list of unclassified sites. Every assertion below except the
 * floor is about the RESULT — *are the sites this found classified?* — and each one is satisfied by
 * finding fewer sites. Only the floor asks about the SEARCH: *did this examine a population at all?*
 *
 * That is why a floor is not a nicety on a discovery guard. It is the only assertion in the file whose
 * failure mode is the guard's own blindness rather than the tree's state — the same reason
 * `git-spawn-classification.test.ts` keeps `spawningGit.length >= 18` beside its classification, and the
 * reason `evidence:check` reporting `2 compared: 2 same` on a 48-case sample was a false clean.
 *
 * ## The finding: the FIFTH call site of a fix applied four times
 *
 * `merge-queue.mjs`'s `checksBlocking` filtered the RAW rollup:
 *
 *     const checks = pr.statusCheckRollup ?? [];
 *     const bad = checks.filter((c) => c.conclusion && !["SUCCESS","NEUTRAL","SKIPPED"].includes(...));
 *     if (bad.length > 0) return `checks failing: ...`;
 *
 * A superseded FAILED run survives on the head for ever, so this reported `checks failing` for a PR whose
 * current runs were all green. `newestPerName` had been added to `update-branch-sweep.mjs` twice (#500,
 * #517), to the since-retired revert script (#582) and to `queue-table.mjs` — **four fixes, four call sites, and the
 * fifth never had it.** That is this repository's most expensive recurring shape, and it is why the
 * remedy here is one shared definition plus this guard rather than a fifth copy.
 *
 * ## What this guard does NOT claim
 *
 * It classifies `statusCheckRollup` reads. `mergeStateStatus` is in the same class and is deliberately
 * NOT enforced here: its 59 occurrences are dominated by a recorded fixture and by display code that
 * reports the field as itself, and a guard demanding a predicate for `status: pr.mergeStateStatus` in a
 * table would refuse the one honest use — reporting a field as what it is. Naming that boundary is worth
 * more than a rule that fires on it, and `queue-table.mjs`'s own heading already carries the discipline
 * where it matters: *"behind is COUNTED, never read off mergeStateStatus"*.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newestPerName, newestConclusionOf } from "agent-org/src/newest-check-run.mjs";

// #1144: `NAMES_ITS_WINDOW` and `WIDER_WINDOW_IS_HARMLESS` moved WITH the per-node check --
// the wrapper names are the rule's `NARROWS_THE_WINDOW` set and the exemption is its
// `wideWindowIsHarmless` option, which is #908 clause 3: the table is asserted where the rule
// reads it, as the rule's own fixture, rather than in a test the rule never consults.
//
// #1152 extended the regex here with `newestRun`/`newestRunCompletedAt` while this PR was open, which
// is the two halves of one fact moving apart in two branches -- the merge conflict you are reading the
// resolution of. Both names are in the rule's set instead, and the discipline #1152 stated with them
// travels too: a name on that list is a CLAIM ABOUT BEHAVIOUR, so the rule's doc comment records where
// each one is proved. These two are proved in `update-branch-decision.test.ts` rather than here,
// because importing `update-branch-sweep.mjs` into this file would give it a `token` requirement
// through its closure (measured: `deriveClosureRequirements` -> token via update-branch-sweep.mjs -> gh)
// and disqualify it from the job that runs acceptance commands. That is #1116's trap.
//
// The exemption table went the same way: "files that read the rollup without a window-naming predicate,
// each with the reason it is harmless" is now the rule's `wideWindowIsHarmless` option, and it is empty.

// THE DISCOVERY HALF LEFT WITH ITS POPULATION (#2976). This file walked the tracked tree for code reading `.statusCheckRollup` and
// held a by-name list of the readers it must still find (`merge-queue.mjs`, `queue-stalled.mjs`, `update-branch-sweep.mjs`). All
// three lived in `packages/agent-org/`, which now lives in `a11ign/agent-org`, so with no named reader the list could only pass
// having examined nothing. The newest-per-name helpers below are the tool's, and are still driven here from fixtures.

// #1144: THE PER-NODE HALF IS NOW AN ESLINT RULE -- `local/bounded-window-reads` in `eslint.config.js`.
// It asks whether THIS read is wrapped by walking the AST upward, rather than whether its LINE mentions a
// wrapper; the line version passed a raw read whenever its line mentioned one for any reason, which is
// this guard's own recorded adjacency defect one granularity down. The rule reports AT THE LINE on every
// pull request, and `lint-rules.test.ts` drives both directions through the repo's own config.
//
// WHAT STAYS HERE IS THE RUN-PROPERTY HALF: a rule sees one file and cannot say "the discovery found
// nothing". That is why this file is in `packages/*/nightly/` (#1135/#1136) and off the PR path.

test("NEWEST PER NAME, not first -- the rollup is a union in insertion order, so `find` returns the "
  + "OLDEST. This is the property four separate fixes were about", () => {
  const rollup = [
    { name: "gate", conclusion: "FAILURE", completedAt: "2026-09-09T08:00:00Z" },
    { name: "gate", conclusion: "SUCCESS", completedAt: "2026-09-09T09:00:00Z" },
  ];
  assert.equal(newestConclusionOf(rollup, "gate"), "SUCCESS");
  assert.equal(newestConclusionOf([...rollup].reverse(), "gate"), "SUCCESS",
    "order-independent, because insertion order is not chronology");
  assert.equal(newestPerName(rollup).length, 1, "one answer per name, not one per attempt");
});

test("NO RUN OF A NAME MEANS PENDING, NEVER FAILURE -- `gh pr checks` reports `fail` for a name the "
  + "current run has not reached, and that was one of the two OPPOSITE wrong verdicts on #619", () => {
  assert.equal(newestConclusionOf([{ name: "gate", conclusion: "SUCCESS" }], "ts"), null,
    "a name with no run must answer null, so the caller decides -- collapsing `has not answered` into "
    + "`answered badly` is how a pending check reads as a failing one");
  assert.equal(
    newestConclusionOf([{ name: "ci", completedAt: "0001-01-01T00:00:00Z", startedAt: "2026-09-09T09:30:00Z" }], "ci"),
    null, "a run in flight reports the ZERO DATE rather than null, and has no conclusion yet");
});

test("THE SHA IS NOT A RUN IDENTIFIER -- `pull_request: edited` re-runs CI without moving the commit, so "
  + "a superseded failed run sits beside a live successful one at ONE head. A predicate keyed on the sha "
  + "assumes one run per sha and there is no such guarantee", () => {
  const oneHeadTwoRuns = [
    { name: "ci", conclusion: "FAILURE", completedAt: "2026-09-09T09:00:00Z" },
    { name: "ci", conclusion: "SUCCESS", completedAt: "2026-09-09T09:20:00Z" },
  ];
  assert.equal(newestConclusionOf(oneHeadTwoRuns, "ci"), "SUCCESS",
    "asking `did every run at this sha succeed` answers FAILURE here and is the wrong question");
});


// --- #1623: newest per name is the newest WORKFLOW RUN when both entries name one ---

/**
 * #1617's two `gate` entries at head `84f684dd`, as `statusCheckRollup` returned them (GraphQL, read 2026-09-14 by
 * worker-tooling), in GitHub's order and with the fields `gh pr list --json statusCheckRollup` carries. The CANCELLED
 * run is the NEWER workflow run (34858134371) and "completed" at 14:49:32Z, before it started and before the older
 * run's gate (34858130620) succeeded at 14:51:42Z.
 */
const PR_1617_GATES = [
  { __typename: "CheckRun", name: "gate", status: "COMPLETED", conclusion: "CANCELLED", startedAt: "2026-09-14T14:49:33Z",
    completedAt: "2026-09-14T14:49:32Z", workflowName: "ci",
    detailsUrl: "https://github.com/DanBeckDev/a11y-witness/actions/runs/34858134371/job/104022946741" },
  { __typename: "CheckRun", name: "gate", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-09-14T14:51:37Z",
    completedAt: "2026-09-14T14:51:42Z", workflowName: "ci",
    detailsUrl: "https://github.com/DanBeckDev/a11y-witness/actions/runs/34858130620/job/104023707501" },
];
/**
 * #1605's pair at its merged head `8c1ebc44` (REST check-runs, read 2026-09-14), in the rollup's field shape: the
 * cancelled gate in the OLDER run 34855015256, the success in the LATER run 34855153052. Not blocked; merged.
 */
const PR_1605_GATES = [
  { __typename: "CheckRun", name: "gate", status: "COMPLETED", conclusion: "CANCELLED", startedAt: "2026-09-14T14:22:34Z",
    completedAt: "2026-09-14T14:22:33Z", workflowName: "ci",
    detailsUrl: "https://github.com/DanBeckDev/a11y-witness/actions/runs/34855015256/job/104012833979" },
  { __typename: "CheckRun", name: "gate", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-09-14T14:26:18Z",
    completedAt: "2026-09-14T14:26:21Z", workflowName: "ci",
    detailsUrl: "https://github.com/DanBeckDev/a11y-witness/actions/runs/34855153052/job/104014192412" },
];
/** The same entries with no run id -- what completion-time ordering alone sees. */
const withoutRunIds = (runs: { detailsUrl?: string }[]) => runs.map(({ detailsUrl, ...rest }) => {
  void detailsUrl; // dropped on purpose: what completion-time ordering alone sees
  return rest;
});

test("#1623: NEWEST PER NAME orders by workflow run -- #1617's gate reads CANCELLED, #1605's SUCCESS, and entries "
  + "without run ids read by time as before", () => {
  assert.equal(newestConclusionOf(PR_1617_GATES, "gate"), "CANCELLED");
  assert.equal(newestConclusionOf([...PR_1617_GATES].reverse(), "gate"), "CANCELLED");
  assert.equal(newestConclusionOf(PR_1605_GATES, "gate"), "SUCCESS");
  assert.equal(newestConclusionOf(withoutRunIds(PR_1617_GATES), "gate"), "SUCCESS");
});
