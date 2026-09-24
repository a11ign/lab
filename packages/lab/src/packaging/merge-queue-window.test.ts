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
 * THE POSITIVE CONTROLS ARE THE TWO FIXTURES THAT MUST DISAGREE: #2079's real shape reads DOES_NOT_BITE,
 * the ejection shape reads BITES. A reader that answers one thing to everything passes neither, and the
 * NOT_EXERCISED cases are what stop "the refusal never reached a queued state" being read as an answer --
 * the row is explicit that such a run is re-run, not interpreted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** The row's own `jq` projection: `{e: event, t: created_at // submitted_at, s: state // ""}`. */
interface QueueEvent {
  e: string;
  t: string;
  s?: string;
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

function queueWindowVerdict(unsorted: QueueEvent[]): { code: VerdictCode; why: string } {
  const events = [...unsorted].sort(byTime);
  const refusal = refusalWhileQueued(events);
  if (!refusal) {
    return { code: VERDICT.NOT_EXERCISED, why: "no CHANGES_REQUESTED arrived while the pull request was queued" };
  }
  const after = events.filter((event) => event.t >= refusal.t);
  const mergedAt = new Set(after.filter((event) => event.e === MERGED).map((event) => event.t));
  const ejection = after.find((event) => event.e === LEFT && !mergedAt.has(event.t));
  if (ejection) {
    return { code: VERDICT.BITES, why: `removed from the queue at ${ejection.t}, after the refusal at ${refusal.t}, with no merge at that second` };
  }
  if (mergedAt.size > 0) {
    return { code: VERDICT.DOES_NOT_BITE, why: `merged at ${[...mergedAt][0]}, after the refusal at ${refusal.t}` };
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
