/**
 * #2206: A REVIEW POSTED AFTER QUEUE ENTRY -- DOES THE REVIEW REQUIREMENT EJECT, OR IS A REFUSAL DECORATIVE?
 *
 * THE DEFECT, MEASURED TWICE. #1971 (2026-09-22) and #2079 (2026-09-23) share one shape: a pull request
 * enters the merge queue on an approval, a `CHANGES_REQUESTED` arrives while it is queued, and it merges
 * anyway. #2079's is exact, every line from `issues/<n>/timeline`:
 *
 *     08:42:58Z  reviewed APPROVED          by a11ign-bot
 *     08:45:05Z  added_to_merge_queue
 *     08:46:07Z  reviewed CHANGES_REQUESTED by a11ign-bot  -- naming a concrete defect
 *     08:49:28Z  merged
 *
 * #2086 then put a `pull_request` rule on the `merge-queue-main` ruleset. #2084's done-when 5 named that as
 * GitHub's own answer -- "the merge queue re-evaluates it" -- and told the reader to verify the claim
 * against the API before building on it. Its stated purchase is a READABLE surface, never a re-evaluated
 * one, and no pull request since has exercised the window (0 of the 100 most recently merged received a
 * review after entry, 2026-09-23T18:1xZ). So the answer has to be produced, not waited for.
 *
 * WHAT THIS FILE HOLDS. The READER of that experiment: one function, `queueWindowVerdict`, that takes the
 * events the row's `issues/<n>/timeline` call returns and says which of three things happened. It is
 * written and pinned BEFORE the experiment is read for the reason `RULED_STALENESS` was: a verdict decided
 * while looking at the timeline it is about is a verdict shaped by it.
 *
 * THE ORDERING IS THE WHOLE VERDICT, AND THE SAME-SECOND PAIR IS THE TRAP. A `removed_from_merge_queue`
 * after the refusal means the rule BITES -- unless a `merged` carries the same timestamp, because a merge
 * removes the entry from the queue too and the two events land together. Counting that removal as an
 * ejection would read every ordinary merge as a refusal that worked, and the rule would appear to bite on
 * exactly the pull requests it did not stop.
 *
 * AMENDED 2026-09-24, BY THE EXPERIMENT IT WAS WRITTEN FOR. The reader above was pinned to an EXACT-SECOND
 * match, and #2289's own timeline falsified that: the queue's removal is stamped 09:35:08Z and the merge
 * 09:35:09Z, ONE SECOND APART, and the event ids say the merge was created FIRST (`merged` 31744507916 <
 * `removed_from_merge_queue` 31744508190) -- so the timestamps skew in BOTH directions and an exact match
 * read a merge that happened as `BITES`. A removal is now the merge's own exit when a `merged` lands within
 * `MERGE_EXIT_SKEW_MS` of it, either side, WITH NO RE-ENTRY BETWEEN THE TWO: an ejection followed by a fast
 * re-arm puts a removal, an `added_to_merge_queue` and a merge inside the same skew, and reading that merge
 * as the removal's own exit would call a rule that bit "does not bite". The bound is a measurement of ONE
 * (1 s), doubled; a removal farther from any merge is an ejection whatever the pull request does afterwards.
 *
 * THE POSITIVE CONTROLS ARE THE TWO FIXTURES THAT MUST DISAGREE: #2079's real shape reads DOES_NOT_BITE,
 * the ejection shape reads BITES. A reader that answers one thing to everything passes neither, and the
 * NOT_EXERCISED cases are what stop "the refusal never reached a queued state" being read as an answer --
 * the row is explicit that such a run is re-run, not interpreted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** The row's own `jq` projection: `{e: event, t: created_at // submitted_at, s: state // ""}`. */
interface QueueEvent {
  e: string;
  t: string;
  s?: string;
  /** The timeline event id. The row's projection drops it; only a fixture that quotes it as evidence carries it. */
  id?: number;
}

const VERDICT = {
  /** A refusal posted while queued removed the pull request from the queue: the rule re-evaluates. */
  BITES: "BITES",
  /** The pull request merged after a refusal posted while queued: the refusal was decorative. */
  DOES_NOT_BITE: "DOES_NOT_BITE",
  /** The refusal never met a queued pull request, or nothing has happened since. Re-run, never interpret. */
  NOT_EXERCISED: "NOT_EXERCISED",
} as const;
type VerdictCode = (typeof VERDICT)[keyof typeof VERDICT];

const ENTERED = "added_to_merge_queue";
const LEFT = "removed_from_merge_queue";
const REVIEWED = "reviewed";
const MERGED = "merged";
const REFUSAL_STATE = "changes_requested";

const byTime = (a: QueueEvent, b: QueueEvent) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

function isRefusal(event: QueueEvent): boolean {
  return event.e === REVIEWED && (event.s ?? "").toLowerCase() === REFUSAL_STATE;
}

/**
 * The first refusal that arrived while the pull request WAS queued: an entry at or before it, and no
 * departure (removal or merge) between that entry and the refusal. A refusal before entry blocks entry
 * and says nothing about the window; a refusal after a departure met an unqueued pull request.
 */
function refusalWhileQueued(events: QueueEvent[]): QueueEvent | undefined {
  return events.filter(isRefusal).find((refusal) => {
    const entry = events.filter((event) => event.e === ENTERED && event.t <= refusal.t).at(-1);
    if (!entry) return false;
    const departed = events.some((event) =>
      (event.e === LEFT || event.e === MERGED) && event.t >= entry.t && event.t < refusal.t);
    return !departed;
  });
}

/**
 * Timestamps on the queue's two events skew by a second in EITHER direction (#2289: removal `:08`, merge
 * `:09`, ids the other way round), so "the same second" is not a test that holds. Two, for one measurement.
 */
const MERGE_EXIT_SKEW_MS = 2_000;

/**
 * A removal that accompanies a merge is the entry leaving the queue BECAUSE it merged, not an ejection --
 * but only when both belong to ONE entry. A re-entry stamped between them (either end included, because the
 * stamps skew) means the removal ended an entry that was ejected and the merge belongs to the next one.
 */
function isMergeExit(removal: QueueEvent, merges: QueueEvent[], reentries: QueueEvent[]): boolean {
  const removedAt = Date.parse(removal.t);
  return merges.some((merge) => {
    const mergedAt = Date.parse(merge.t);
    if (Math.abs(mergedAt - removedAt) > MERGE_EXIT_SKEW_MS) return false;
    const [from, to] = [Math.min(removedAt, mergedAt), Math.max(removedAt, mergedAt)];
    return !reentries.some((entry) => Date.parse(entry.t) >= from && Date.parse(entry.t) <= to);
  });
}

function queueWindowVerdict(unsorted: QueueEvent[]): { code: VerdictCode; why: string } {
  const events = [...unsorted].sort(byTime);
  const refusal = refusalWhileQueued(events);
  if (!refusal) {
    return { code: VERDICT.NOT_EXERCISED, why: "no CHANGES_REQUESTED arrived while the pull request was queued" };
  }
  const after = events.filter((event) => event.t >= refusal.t);
  const merges = after.filter((event) => event.e === MERGED);
  // Strictly after the refusal: the entry the refusal met is at or before it, and is not a RE-entry.
  const reentries = after.filter((event) => event.e === ENTERED && event.t > refusal.t);
  const ejection = after.find((event) => event.e === LEFT && !isMergeExit(event, merges, reentries));
  if (ejection) {
    return { code: VERDICT.BITES, why: `removed from the queue at ${ejection.t}, after the refusal at ${refusal.t}, with no merge of the same entry within ${MERGE_EXIT_SKEW_MS} ms of it` };
  }
  if (merges.length > 0) {
    return { code: VERDICT.DOES_NOT_BITE, why: `merged at ${merges[0].t}, after the refusal at ${refusal.t}` };
  }
  return { code: VERDICT.NOT_EXERCISED, why: `refused at ${refusal.t} and neither ejected nor merged yet` };
}

/** #2079's timeline, verbatim from the row (2026-09-23), less the events the projection drops. */
const PR_2079: QueueEvent[] = [
  { e: REVIEWED, t: "2026-09-23T08:42:58Z", s: "approved" },
  { e: "ready_for_review", t: "2026-09-23T08:44:51Z" },
  { e: ENTERED, t: "2026-09-23T08:45:05Z" },
  { e: REVIEWED, t: "2026-09-23T08:46:07Z", s: "changes_requested" },
  { e: MERGED, t: "2026-09-23T08:49:28Z" },
];

/** SYNTHETIC -- the shape the ruleset rule would produce if it bites. Not a measurement of anything. */
const EJECTED: QueueEvent[] = [
  { e: REVIEWED, t: "2026-01-01T10:00:00Z", s: "approved" },
  { e: ENTERED, t: "2026-01-01T10:00:05Z" },
  { e: REVIEWED, t: "2026-01-01T10:01:07Z", s: "changes_requested" },
  { e: LEFT, t: "2026-01-01T10:01:09Z" },
];

test("#2206 CONTROL: #2079's measured timeline reads DOES_NOT_BITE -- a merge after a queued refusal", () => {
  const verdict = queueWindowVerdict(PR_2079);
  assert.equal(verdict.code, VERDICT.DOES_NOT_BITE, verdict.why);
});

test("#2206 CONTROL: a removal after the queued refusal, with no merge, reads BITES", () => {
  const verdict = queueWindowVerdict(EJECTED);
  assert.equal(verdict.code, VERDICT.BITES, verdict.why);
});

test("#2206: the two controls disagree -- a reader answering one thing to everything fails one of them", () => {
  assert.notEqual(queueWindowVerdict(PR_2079).code, queueWindowVerdict(EJECTED).code);
});

test("#2206 THE TRAP: a removal at the SAME SECOND as the merge is the merge itself, not an ejection", () => {
  const ordinaryMerge = [...PR_2079, { e: LEFT, t: "2026-09-23T08:49:28Z" }];
  assert.equal(queueWindowVerdict(ordinaryMerge).code, VERDICT.DOES_NOT_BITE);
});

test("#2206: an ejection followed by a re-armed merge still BITES -- the removal happened", () => {
  const rearmed = [...EJECTED,
    { e: ENTERED, t: "2026-01-01T10:05:00Z" },
    { e: MERGED, t: "2026-01-01T10:12:00Z" }];
  assert.equal(queueWindowVerdict(rearmed).code, VERDICT.BITES);
});

test("#2206: a refusal BEFORE queue entry is not the window -- it is NOT_EXERCISED, to be re-run", () => {
  const refusedFirst: QueueEvent[] = [
    { e: REVIEWED, t: "2026-01-01T10:00:00Z", s: "changes_requested" },
    { e: REVIEWED, t: "2026-01-01T10:00:30Z", s: "approved" },
    { e: ENTERED, t: "2026-01-01T10:01:00Z" },
    { e: MERGED, t: "2026-01-01T10:06:00Z" },
  ];
  assert.equal(queueWindowVerdict(refusedFirst).code, VERDICT.NOT_EXERCISED);
});

test("#2206: a refusal after the pull request LEFT the queue met nothing queued -- NOT_EXERCISED", () => {
  const leftFirst: QueueEvent[] = [
    { e: ENTERED, t: "2026-01-01T10:00:00Z" },
    { e: LEFT, t: "2026-01-01T10:01:00Z" },
    { e: REVIEWED, t: "2026-01-01T10:02:00Z", s: "changes_requested" },
  ];
  assert.equal(queueWindowVerdict(leftFirst).code, VERDICT.NOT_EXERCISED);
});

test("#2206: a queued refusal with neither ejection nor merge yet is NOT_EXERCISED, not a guess", () => {
  const pending = EJECTED.filter((event) => event.e !== LEFT);
  assert.equal(queueWindowVerdict(pending).code, VERDICT.NOT_EXERCISED);
});

test("#2206: the review state is read case-insensitively -- REST and GraphQL spell it differently", () => {
  const upper = EJECTED.map((event) => (event.s ? { ...event, s: event.s.toUpperCase() } : event));
  assert.equal(queueWindowVerdict(upper).code, VERDICT.BITES);
});

test("#2206: the verdict does not depend on the order the events were listed in", () => {
  assert.equal(queueWindowVerdict([...EJECTED].reverse()).code, VERDICT.BITES);
  assert.equal(queueWindowVerdict([...PR_2079].reverse()).code, VERDICT.DOES_NOT_BITE);
});

/**
 * #2206: THE EXPERIMENT, RUN 2026-09-24 -- verbatim from `issues/2289/timeline`, the pull request that
 * carried it. Approved at 09:22:59Z, queued 09:29:53Z, a deliberate `CHANGES_REQUESTED` at 09:31:17Z (84 s
 * after entry), merged 09:35:09Z at the REFUSED head `6cdb54f4`, with ONE entry into the queue and none
 * after. Actors: the removal is `github-merge-queue[bot]`; the merge carries commit `4fc44fd1`.
 */
const PR_2289: QueueEvent[] = [
  { e: "auto_merge_enabled", t: "2026-09-24T09:05:45Z" },
  { e: REVIEWED, t: "2026-09-24T09:22:59Z", s: "approved" },
  { e: ENTERED, t: "2026-09-24T09:29:53Z" },
  { e: REVIEWED, t: "2026-09-24T09:31:17Z", s: "changes_requested" },
  { e: LEFT, t: "2026-09-24T09:35:08Z", id: 31744508190 },
  { e: MERGED, t: "2026-09-24T09:35:09Z", id: 31744507916 },
  { e: "closed", t: "2026-09-24T09:35:09Z" },
];

test("#2206 MEASURED: #2289 -- a merge one second after its own removal reads DOES_NOT_BITE, not BITES", () => {
  // The control that failed the exact-second reader: it saw a removal with no merge at THAT second.
  const verdict = queueWindowVerdict(PR_2289);
  assert.equal(verdict.code, VERDICT.DOES_NOT_BITE, verdict.why);
});

test("#2206 MEASURED: #2289's own event ids put the merge FIRST while its timestamps put it second -- the skew is real", () => {
  const removal = PR_2289.find((event) => event.e === LEFT);
  const merge = PR_2289.find((event) => event.e === MERGED);
  assert.ok(removal?.id !== undefined && merge?.id !== undefined, "the fixture must carry the ids it cites");
  assert.ok(merge.id < removal.id, "ids: the merge was created first");
  assert.ok(Date.parse(merge.t) > Date.parse(removal.t), "timestamps: the merge is stamped after the removal");
});

test("#2206: the skew runs BOTH ways -- a merge stamped a second BEFORE its removal is still the merge", () => {
  const mergeFirst = [...PR_2289.filter((event) => event.e !== MERGED && event.e !== "closed"),
    { e: MERGED, t: "2026-09-24T09:35:07Z" }];
  assert.equal(queueWindowVerdict(mergeFirst).code, VERDICT.DOES_NOT_BITE);
});

test("#2206: a removal FARTHER than the skew from any merge is an ejection, whatever happens after", () => {
  const lateMerge = [...EJECTED, { e: MERGED, t: "2026-01-01T10:01:19Z" }];
  assert.equal(queueWindowVerdict(lateMerge).code, VERDICT.BITES,
    "ten seconds is not the queue merging the entry; the removal already happened");
});

test("#2206: an ejection then a FAST re-arm reads BITES -- a re-entry between removal and merge splits the entries", () => {
  // The boundary the merge-skew reader got wrong: removal, re-entry and merge all inside two seconds.
  const rearmedFast = [...EJECTED,
    { e: ENTERED, t: "2026-01-01T10:01:10Z" },
    { e: MERGED, t: "2026-01-01T10:01:10Z" }];
  assert.equal(queueWindowVerdict(rearmedFast).code, VERDICT.BITES);
});

test("#2206: a re-entry stamped the SAME second as the removal, merge a second later, still BITES", () => {
  const sameSecond = [...EJECTED,
    { e: ENTERED, t: "2026-01-01T10:01:09Z" },
    { e: MERGED, t: "2026-01-01T10:01:10Z" }];
  assert.equal(queueWindowVerdict(sameSecond).code, VERDICT.BITES);
});

test("#2206: the entry the refusal MET is not a re-entry, even when it shares a second with the removal", () => {
  // Boundary of the re-entry window: entry, refusal and removal all stamped :05, merge :06. The ORIGINAL
  // entry sits inside [removal, merge] to the second, and counting it would read a plain merge as an ejection.
  const burst: QueueEvent[] = [
    { e: ENTERED, t: "2026-01-01T10:00:05Z" },
    { e: REVIEWED, t: "2026-01-01T10:00:05Z", s: "changes_requested" },
    { e: LEFT, t: "2026-01-01T10:00:05Z" },
    { e: MERGED, t: "2026-01-01T10:00:06Z" },
  ];
  assert.equal(queueWindowVerdict(burst).code, VERDICT.DOES_NOT_BITE);
});

test("#2206: the fast re-arm control is the SAME shape as #2289 plus a re-entry -- delete it and it reads DOES_NOT_BITE", () => {
  // Positive control for the two above: a reader that ignored re-entries would fail them, and this proves
  // the only difference between BITES and DOES_NOT_BITE here is that one event.
  const rearmedFast = [...EJECTED,
    { e: ENTERED, t: "2026-01-01T10:01:10Z" },
    { e: MERGED, t: "2026-01-01T10:01:10Z" }];
  const withoutReentry = rearmedFast.filter((event) => event.t !== "2026-01-01T10:01:10Z" || event.e !== ENTERED);
  assert.equal(queueWindowVerdict(withoutReentry).code, VERDICT.DOES_NOT_BITE);
  assert.equal(queueWindowVerdict(rearmedFast).code, VERDICT.BITES);
});

/**
 * THE OBSERVED BEHAVIOUR, RECORDED AS A DECISION-SHAPED CONSTANT (the `RULED_STALENESS` pattern of #2084):
 * ONE EDIT in a named place, with its date and evidence, and the live read below goes red when the
 * configuration it was measured against has moved -- rather than a bare assertion that reads as "this is
 * how the queue must behave".
 *
 * WHAT IS RECORDED: a `CHANGES_REQUESTED` posted AFTER queue entry does NOT stop the merge, with the
 * `pull_request` rule on the `merge-queue-main` ruleset in place. Three measurements agree: #1971
 * (2026-09-22) and #2079 (2026-09-23), both under the classic rule alone, and #2289 (2026-09-24), the
 * first under the ruleset's `pull_request` rule. So #2086's rule bought a READABLE surface, as its header
 * said, and NOT a re-evaluated one. `min_entries_to_merge_wait_minutes: 5` sizes the window: #2289 sat
 * 5 m 16 s in the queue and the refusal arrived 84 s in.
 *
 * WHAT IS NOT: whether ANY ruleset setting would make the queue re-evaluate (`require_last_push_approval`
 * is `false` and was never varied). One configuration was measured, and only that one is claimed.
 */
const OBSERVED_QUEUE_WINDOW = {
  verdict: VERDICT.DOES_NOT_BITE as VerdictCode,
  measuredOn: "2026-09-24",
  evidence: PR_2289,
  ruleset: { id: 23681721, updatedAt: "2026-09-23T09:03:01.101Z" },
} as const;

test("#2206 RECORDED: the constant is what its own evidence reads as, so it cannot drift from the timeline", () => {
  const verdict = queueWindowVerdict([...OBSERVED_QUEUE_WINDOW.evidence]);
  assert.equal(verdict.code, OBSERVED_QUEUE_WINDOW.verdict, verdict.why);
  assert.notEqual(OBSERVED_QUEUE_WINDOW.verdict, VERDICT.NOT_EXERCISED,
    "a recorded observation must be an ANSWER; a run that answers nothing is re-run, never recorded");
});

test("#2206 LIVE: the ruleset is unchanged since the experiment measured it", () => {
  // OPT-IN under `A11Y_CHECK_MAIN_RULESET`, the switch `branch-protection.test.ts` already owns: the same
  // endpoint and the same permission requirement (none).
  if (process.env.A11Y_CHECK_MAIN_RULESET !== "1") {
    console.log("  NOT RUN: `A11Y_CHECK_MAIN_RULESET=1` asks GitHub whether ruleset "
      + `${OBSERVED_QUEUE_WINDOW.ruleset.id} has changed since the queue-window experiment. Nothing here read it.`);
    return;
  }
  let updatedAt: string;
  try {
    updatedAt = execFileSync("gh", ["api", `repos/a11ign/a11ign/rulesets/${OBSERVED_QUEUE_WINDOW.ruleset.id}`,
      "--jq", ".updated_at"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    // Never an empty catch and never a pass: a check that could not ask reports that it could not ask.
    console.log(`  SKIPPED: the ruleset could not be asked (${(error as Error).message.split("\n")[0]}). NOT a pass.`);
    return;
  }
  assert.equal(Date.parse(updatedAt), Date.parse(OBSERVED_QUEUE_WINDOW.ruleset.updatedAt),
    `ruleset ${OBSERVED_QUEUE_WINDOW.ruleset.id} was updated at ${updatedAt}, not ${OBSERVED_QUEUE_WINDOW.ruleset.updatedAt}: `
    + `the ${OBSERVED_QUEUE_WINDOW.measuredOn} measurement (${OBSERVED_QUEUE_WINDOW.verdict}) was taken against the old `
    + "configuration. Re-run the #2206 experiment, then edit OBSERVED_QUEUE_WINDOW in ONE place.");
  console.log(`  LIVE PASS: ruleset unchanged since ${OBSERVED_QUEUE_WINDOW.ruleset.updatedAt}; a queued refusal ${OBSERVED_QUEUE_WINDOW.verdict}`);
});
