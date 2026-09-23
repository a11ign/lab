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

/**
 * THE TWO THAT PREDATE THIS GUARD, NAMED RATHER THAN EXCLUDED BY A PATTERN.
 *
 * Both are original acceptance cases on `main`, not part of the 146 this guard was written for. They are
 * listed instead of fixed because fixing one means REDEFINING a case that the lab's stored captures were
 * taken under, which is exactly what `capture-screenreader-dataset.mjs`'s manifest guard refuses and what
 * #2094 is about: the repair costs a recapture and belongs to a row that budgets for one.
 *
 * The list is exact in both directions — an entry that stops colliding fails this test too — so it cannot
 * quietly outlive the problem it records.
 */
const KNOWN_PRE_EXISTING = [
  "acceptance-placeholder-postcode:task",
  "acceptance-status-progress-application:control",
  "acceptance-status-progress-application:task",
] as const;

const fingerprint = (offender: Offender) => `${offender.id}:${offender.field}`;

/** How many colliding training ids to name per offender; one control is shared with six of them. */
const TRAINING_IDS_SHOWN = 3;

test("no held-out case reuses a training case's task or control", () => {
  const offenders = sharedExercises({
    training: CASES as readonly Case[],
    heldOut: ALL_ACCEPTANCE_CASES as readonly Case[],
  });

  const unexpected = offenders.filter((o) => !(KNOWN_PRE_EXISTING as readonly string[]).includes(fingerprint(o)));
  assert.deepEqual(unexpected.map(fingerprint), [],
    "These held-out cases reuse a training case's task or control verbatim:\n  "
    + unexpected.map((o) => `${o.id} — ${o.field} "${o.value}" is also ${o.trainingIds.slice(0, TRAINING_IDS_SHOWN).join(", ")}`)
      .join("\n  ")
    + "\n\nA held-out set that repeats the training set measures memorisation and reports it as"
    + "\ngeneralisation, which is the one thing the acceptance number exists not to do. Give the case"
    + "\nits own vocabulary; do not add it to KNOWN_PRE_EXISTING, which is a record of debt that costs a"
    + "\nrecapture to clear, not a way to admit new cases.");
});

test("the recorded pre-existing overlaps still exist, so the list cannot outlive them", () => {
  assert.ok(KNOWN_PRE_EXISTING.length > 0,
    "KNOWN_PRE_EXISTING is empty, so this test examines nothing. If the debt really is cleared, delete"
    + " this test with it rather than leaving an assertion that can no longer fail.");

  const found = new Set(sharedExercises({
    training: CASES as readonly Case[],
    heldOut: ALL_ACCEPTANCE_CASES as readonly Case[],
  }).map(fingerprint));

  const stale = KNOWN_PRE_EXISTING.filter((entry) => !found.has(entry));
  assert.deepEqual(stale, [],
    `KNOWN_PRE_EXISTING names overlaps that no longer exist: ${stale.join(", ")}.`
    + " Delete them — a debt list that is not exact stops being evidence of anything.");
});

/*
 * THE POSITIVE CONTROLS. The assertions above are `deepEqual(…, [])` over a population derived from a
 * CALL, which passes just as readily when the detector is broken as when the corpus is clean. These two
 * are where this file proves it can fail, and they run against fixtures so they stay true whatever the
 * corpus becomes.
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
