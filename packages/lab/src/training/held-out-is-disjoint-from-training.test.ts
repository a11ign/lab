/**
 * A HELD-OUT CASE THAT REUSES A TRAINING TASK MEASURES MEMORISATION AND REPORTS IT AS GENERALISATION.
 *
 * `acceptance-covers-the-corpus.test.ts` states the requirement in prose — *"the held-out cases must be
 * DIFFERENT content from the corpus or they measure memorisation and report it as generalisation"* — and
 * then checks only that each gated criterion has ENOUGH held-out positives. Nothing compared the content
 * of the two sets, so "different content" was a claim in a commit message rather than a property.
 *
 * **Measured cost, 2026-09-23 (#2100, review of #2108).** 146 held-out pairs were proposed whose PR text
 * asserted the vocabulary was "chosen to be distinct from the training corpus". `reviewer-2` read them by
 * hand and found `acceptance-b3-status-plot` carrying the same task, the same control and the same
 * expected announcement as the training case `filter-status-silent-allotment` — identical but for the
 * page title. The audit that verdict asked for found **two more the human pass had not reached**:
 * `acceptance-b3-status-progress-plot` (task and control shared with `status-progress-checkout`) and
 * `acceptance-b3-status-waiting-plot` (control shared with six training cases). All three are fixed in
 * that PR; this file is why a fourth cannot arrive unseen.
 *
 * **Compared case-insensitively, and that is load-bearing rather than tidiness.** `status-progress-checkout`
 * spells its task *"continue to payment and notice…"* and the held-out case spelled it *"Continue to
 * payment and notice…"*. A case-sensitive comparison — the obvious one to write — misses that pair
 * entirely, which is one of the three.
 *
 * **This does not make the set held-out; it makes one way of failing visible.** Two cases can describe the
 * same learned interaction in different words, and no string comparison reaches that. The human read
 * stays the review's job. What this removes is the failure where nobody had to look at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CASES } from "./case-matrix.mjs";
import { ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";

type Case = { id?: string; task?: string; badSignal?: { control?: string } };

/** The two fields a held-out case and a training case can share that make them the same exercise. */
const COMPARED_FIELDS = ["task", "control"] as const;
type Field = (typeof COMPARED_FIELDS)[number];

type Offender = { id: string; field: Field; value: string; trainingIds: string[] };

/**
 * Case-folded, whitespace-collapsed, trailing-punctuation-stripped. See the header: the corpus spells the
 * same sentence with different capitalisation in at least one place, so an exact comparison under-reports.
 */
const normalise = (value: string): string =>
  value.trim().toLowerCase().replace(/[.\s]+/g, " ").trim();

const fieldValue = (testCase: Case, field: Field): string | undefined =>
  field === "task" ? testCase.task : testCase.badSignal?.control;

/** field → normalised value → the training case ids that use it. */
function indexTraining(training: readonly Case[]): Map<Field, Map<string, string[]>> {
  const index = new Map<Field, Map<string, string[]>>(
    COMPARED_FIELDS.map((field) => [field, new Map<string, string[]>()]));
  for (const testCase of training) {
    for (const field of COMPARED_FIELDS) {
      const value = fieldValue(testCase, field);
      if (!value || !testCase.id) continue;
      const byValue = index.get(field)!;
      const key = normalise(value);
      byValue.set(key, [...(byValue.get(key) ?? []), testCase.id]);
    }
  }
  return index;
}

/** Every held-out case that reuses a training case's task or control, verbatim up to `normalise`. */
export function sharedExercises({ training, heldOut }: {
  training: readonly Case[];
  heldOut: readonly Case[];
}): Offender[] {
  const index = indexTraining(training);
  const offenders: Offender[] = [];
  for (const testCase of heldOut) {
    for (const field of COMPARED_FIELDS) {
      const value = fieldValue(testCase, field);
      if (!value || !testCase.id) continue;
      const trainingIds = index.get(field)!.get(normalise(value));
      if (trainingIds) offenders.push({ id: testCase.id, field, value, trainingIds });
    }
  }
  return offenders;
}

/*
 * THE ALLOWLIST IS GONE, AND WHAT IT RECORDED IS WHY IT MUST NOT COME BACK CASUALLY (#2114).
 *
 * This file shipped with `KNOWN_PRE_EXISTING`, three fingerprints naming the two ORIGINAL acceptance cases
 * that repeated a training exercise — `acceptance-placeholder-postcode` (its task, shared with
 * `form-unlabelled-library`) and `acceptance-status-progress-application` (its task AND its control, shared
 * with `status-progress-signup` and its four multi-defect variants). They were listed rather than fixed
 * because fixing one REDEFINES a case whose captures were already taken, which costs a recapture.
 *
 * #2114 paid that recapture. Both cases now carry their own vocabulary — a meter serial and an
 * eligibility step — so every entry went stale at once. Emptying the list would have left THREE assertions
 * that can no longer fail: the staleness check below it, `illegitimateExceptions` over an empty list, and
 * the two-originals-are-legitimate test. This file's own message said to delete rather than leave one of
 * those, so the list, the legitimacy rule that policed it (`legitimateExceptions` /
 * `illegitimateExceptions`, the growth-batch prefix refusal, the provenance refusal) and the four tests
 * that exercised them are deleted together. The assertion below now
 * filters NOTHING.
 *
 * **That is stronger than an empty allowlist, and the reason is `reviewer-2`'s mutation on #2108.** Their
 * bypass was: put a held-out case back to a training task (1 red), then add its two fingerprints to the list
 * (0 red) — the guard switched off, one line per case, by the population it was written for. The
 * legitimacy rule made that bypass refuse. Deleting the mechanism means there is no line to add at all.
 *
 * SO: A NEW COLLISION IS FIXED BY GIVING THE CASE ITS OWN VOCABULARY, NEVER BY RESTORING THIS LIST. Before
 * a case's first capture that is free; after one it costs a recapture, which is a row with a fleet budget
 * and not a line in a file. If a future debt genuinely has to be recorded, that row argues for a mechanism
 * from scratch — re-adding an allowlist here re-creates the bypass.
 */

const fingerprint = (offender: Offender) => `${offender.id}:${offender.field}`;

/** How many colliding training ids to name per offender; one control is shared with six of them. */
const TRAINING_IDS_SHOWN = 3;

test("no held-out case reuses a training case's task or control", () => {
  const offenders = sharedExercises({
    training: CASES as readonly Case[],
    heldOut: ALL_ACCEPTANCE_CASES as readonly Case[],
  });

  assert.deepEqual(offenders.map(fingerprint), [],
    "These held-out cases reuse a training case's task or control verbatim:\n  "
    + offenders.map((o) => `${o.id} — ${o.field} "${o.value}" is also ${o.trainingIds.slice(0, TRAINING_IDS_SHOWN).join(", ")}`)
      .join("\n  ")
    + "\n\nA held-out set that repeats the training set measures memorisation and reports it as"
    + "\ngeneralisation, which is the one thing the acceptance number exists not to do. Give the case its"
    + "\nown vocabulary — free before its first capture, a recapture after one. There is no allowlist to"
    + "\nadd it to, and restoring one is not the fix; see the note above this test.");
});

/*
 * THE POSITIVE CONTROLS. The assertion above is `deepEqual(…, [])` over a population derived from a CALL,
 * which passes just as readily when the detector is broken as when the corpus is clean — and since #2114
 * cleared the last recorded offender it is the ONLY assertion in this file over the real corpus, so these
 * two fixtures are the whole of what proves it can fail. They run against fixtures on purpose, so they stay
 * true whatever the corpus becomes.
 */
test("a held-out case sharing a training task is named, and its clean sibling is not", () => {
  const training = [{ id: "train-allotment", task: "Show available plots and notice the result count." }];
  const heldOut = [
    { id: "held-copy", task: "show available plots and notice the result count" },
    { id: "held-clean", task: "Show vacant plots and notice the result count." },
  ];

  const offenders = sharedExercises({ training, heldOut });

  assert.deepEqual(offenders.map(fingerprint), ["held-copy:task"]);
  assert.deepEqual(offenders[0]?.trainingIds, ["train-allotment"]);
});

test("a held-out case sharing only a training control is named", () => {
  const training = [{ id: "train-checkout", task: "Some other task.", badSignal: { control: "Continue to payment" } }];
  const heldOut = [{ id: "held-plot", task: "A task nothing shares.", badSignal: { control: "Continue to payment" } }];

  const offenders = sharedExercises({ training, heldOut });

  assert.deepEqual(offenders.map(fingerprint), ["held-plot:control"]);
});
