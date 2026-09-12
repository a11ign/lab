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
 * #517), to `trunk-revert.mjs` (#582) and to `queue-table.mjs` — **four fixes, four call sites, and the
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { newestPerName, newestConclusionOf } from "../../../../scripts/newest-check-run.mjs";
import { declareTreeWideGuard, walkTree } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * Reading the field OFF an object (`pr.statusCheckRollup`) — never the `--json` field list, which is a
 * REQUEST rather than a read and appears as a bare name inside a comma-separated string.
 *
 * The first version of this carried a lookbehind meant to exclude the field list and excluded the reads
 * instead: `(?<!["'\w])\.statusCheckRollup` rejects `pr.statusCheckRollup`, because the character before
 * the dot is a word character. It found 3 FILES where there were 4 (5 read LINES where there were 6),
 * and the floor below is what caught it — a discovery that silently shrinks reports cleanly about a
 * population it never examined. The two numbers this sentence used to carry, 4 in one paragraph and 6
 * in another, were a file count and a line count stated as though they were the same quantity.
 */
const READS_THE_ROLLUP = /\.statusCheckRollup\b/;

/** The predicates that NAME the window they ask about. A read passing through one of these is safe. */
// #1126 adds `newestRun`/`newestRunCompletedAt`: `newestConclusion` was refactored to call `newestRun`,
// so that the conclusion and its TIMESTAMP come from the same run rather than from two scans that could
// disagree. Both narrow to one run per name by the identical rule, so both belong here -- but a NAME on
// this list is a claim about behaviour, and this file already proves that claim for `newestConclusionOf`
// rather than asserting it. **The matching proof for these two is in `update-branch-decision.test.ts`**
// ("the readers added to NAMES_ITS_WINDOW actually narrow"), not here, and deliberately: importing
// `update-branch-sweep.mjs` into THIS file gives it a `token` requirement through the closure -- measured,
// `deriveClosureRequirements` -> token via update-branch-sweep.mjs -> gh -- which would disqualify it from
// the job that runs acceptance commands. That is #1116's trap, and its remedy is placement: the assertion
// lives in the file that already imports the module and already carries the requirement. Without a proof
// SOMEWHERE, extending a regex is how a non-narrowing reader gets admitted by being called the right thing.
const NAMES_ITS_WINDOW = /newestPerName|newestConclusion(Of)?|newestRun(CompletedAt)?|headQuietSeconds/;

/**
 * Files that read the rollup without a window-naming predicate, each with the reason it is harmless.
 * Classified rather than fixed, so "nothing needs this" and "somebody forgot" stay different states.
 */
const WIDER_WINDOW_IS_HARMLESS: Record<string, string> = {
  // EMPTY BY MEASUREMENT, NOT BY OVERSIGHT -- do not delete this as dead.
  // EMPTY TODAY, and that is a measurement rather than an omission: all four readers now narrow the
  // rollup. It exists so the next reader that genuinely does not need the current answer is CLASSIFIED
  // rather than made to adopt a predicate it has no use for -- "nothing needs this" and "somebody
  // forgot" must not be the same state.
};

function trackedCode(): string[] {
  return walkTree({ kind: "both", roots: ["scripts", "packages", ".github"] }).map((f) => f.path)
    .filter((f) => !f.includes("/dist/") && !f.endsWith(".test.ts"));
}

/**
 * Every file whose CODE reads the rollup off an object, and every such LINE.
 *
 * PER LINE, not per file. The first version asked whether the FILE mentioned a window-naming predicate,
 * and `npm run mutate` reported THE GUARD DID NOT BITE when the call was removed from `merge-queue.mjs`:
 * the `import { newestPerName }` line still matched, so the predicate was satisfied by a NEIGHBOUR of
 * the thing it was meant to check. That is the third instance of this shape in one session — a check
 * observing something ADJACENT to the property, where the adjacency holds while the property fails.
 */
function rollupReadLines(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const file of trackedCode()) {
    for (const line of stripComments(read(file)).split("\n")) {
      if (READS_THE_ROLLUP.test(line)) found.push([file, line.trim()]);
    }
  }
  return found;
}

/** Every file whose CODE reads the rollup off an object. */
function rollupReaders(): string[] {
  return [...new Set(rollupReadLines().map(([file]) => file))];
}

/**
 * The readers this discovery MUST still find, BY NAME, each with the reason it reads the rollup.
 *
 * A BARE COUNT DRIFTS DOWN WITHOUT LEAVING A RECORD. The floor was `readers.length >= 4`, and it did
 * its job once already -- it is what caught the lookbehind that silently found 3. But there are two
 * ways to reach 3, the predicate breaking and a reader legitimately going away, and they produce the
 * SAME failure with the SAME repair to hand: lower the number. Doing that for the second reason is
 * correct; doing it for the first recreates the defect this file exists to catch. A number cannot tell
 * the two apart, so the number is not the floor.
 *
 * A NAME can. A predicate that shrinks loses every entry at once and the failure says which are gone;
 * a reader that genuinely stops reading the rollup is one deleted line, and deleting it forces the
 * question the count never asked -- what answers this now?
 */
const EXPECTED_READERS: Record<string, string> = {
  "scripts/merge-queue.mjs":
    "checksBlocking -- THE site #634 found. If it is not in the population, the guard cannot have caught it",
  "scripts/queue-stalled.mjs":
    "head quiet time and the gate's conclusion, both narrowed per name",
  "scripts/update-branch-sweep.mjs":
    "the same two reads on the sweep's side -- #500 and #517 fixed this file twice",
  // DEPARTED 2026-09-09 (dispatcher/table-reports-rate-limit): `scripts/queue-table.mjs` read the
  // rollup through `newestPerName` and now does not read it at all. Its checks moved from
  // `gh pr view --json statusCheckRollup` (GraphQL) to `gh api .../check-runs` (REST), because GraphQL
  // hit 5000/5000 account-wide at 14:41Z and a table that cannot be read during an outage reports
  // nothing. The read was never wrong; the field is simply no longer where the table gets its answer,
  // and `isRed`/`NOT_RED` (#784) plus check-runs' own newest-per-name now carry that discipline.
  // FOUR reader files before, THREE after. Recorded here rather than by decrementing a number,
  // because "a reader left" and "the search broke" must not look the same.
};

test("the discovery finds the readers it should -- a check that passes having examined nothing is the "
  + "defect one layer up from the one this sweeps", () => {
  const readers = rollupReaders();
  const missing = Object.keys(EXPECTED_READERS).filter((file) => !readers.includes(file));
  assert.deepEqual(missing, [],
    "the discovery lost known reader(s). Either READS_THE_ROLLUP has silently shrunk -- which is what "
    + "it did once already, finding 3 files where there were 4 -- or these files genuinely stopped "
    + "reading the rollup, in which case delete the entry from EXPECTED_READERS and say in its place "
    + `what answers the question now. Found: ${readers.join(", ") || "(nothing)"}`);
});

test("every read of the rollup passes through a predicate that NAMES ITS WINDOW, or is classified -- "
  + "the rollup unions superseded runs, so a raw filter answers about every attempt ever made", () => {
  const unclassified = rollupReadLines()
    .filter(([file, line]) => !(file in WIDER_WINDOW_IS_HARMLESS) && !NAMES_ITS_WINDOW.test(line))
    .map(([file, line]) => `${file}: ${line}`);
  assert.deepEqual(unclassified, [],
    "these read `statusCheckRollup` without narrowing it to the newest run per NAME. A superseded FAILED "
    + "run survives on the head for ever, so a raw filter reports a green PR as failing -- which is what "
    + "`merge-queue.mjs` did until #634. Use `newestPerName` from `scripts/newest-check-run.mjs`, or add "
    + "an entry to WIDER_WINDOW_IS_HARMLESS saying why the wider window cannot mislead here.");
});

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

