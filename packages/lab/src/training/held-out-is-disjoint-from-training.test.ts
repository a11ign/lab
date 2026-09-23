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

/**
 * AN ALLOWLIST THE GUARD'S OWN SUBJECT CAN JOIN IS NOT A GUARD — `reviewer-2` on #2108, 2026-09-23.
 *
 * The first version of this file checked `KNOWN_PRE_EXISTING` only for *current collision* and
 * *staleness*, and the reviewer's mutation went straight through it: put `b3-status-plot` back to the
 * training task (1 red), then add its two fingerprints to the list (0 red). **The guard written to stop a
 * held-out case repeating a training exercise could be switched off, one line per case, by the very
 * population it was written for.**
 *
 * So an exception now has to be LEGITIMATE, and legitimacy is a property of the case rather than a line in
 * a list:
 *
 *   1. **It must predate the held-out growth batches.** Every batch prefixes the ids it adds —
 *      `b2-` (2026-08-23) and `b3-` (#2100) — so a case from one is refused by shape. A new collision is
 *      fixed by giving the case its own vocabulary, which costs nothing before its first capture; the
 *      whole reason the two below are DEBT is that theirs has already been taken.
 *   2. **It must be one of the two originals this list records**, so an exception cannot be minted for a
 *      case added under a new naming convention either.
 *
 * AND THE FILTER BELOW USES `legitimateExceptions`, NOT `KNOWN_PRE_EXISTING`. That placement is the point:
 * an illegitimate entry fails the legitimacy test AND still does not suppress its offender, so the
 * reviewer's mutation stays red in the main assertion even if this meta-test is deleted with it. An
 * allowlist can always be edited — what is gone is the one-line bypass.
 */
const PRE_EXISTING_CASE_IDS = [
  "acceptance-placeholder-postcode",
  "acceptance-status-progress-application",
] as const;

/** Held-out growth batches prefix every id they add: `b2-`, `b3-`, and whatever the next one is called. */
const GROWTH_BATCH_ID = /^acceptance-b\d+-/;

const caseIdOf = (entry: string) => entry.slice(0, entry.lastIndexOf(":"));

/** Why an exception may not be taken at its word; empty when it may. */
function exceptionRefusal(entry: string): string | null {
  const id = caseIdOf(entry);
  if (GROWTH_BATCH_ID.test(id)) {
    return `${id} was added by a held-out growth batch, so it has no capture to protect.`
      + " Give the case its own vocabulary instead — that is free before its first capture.";
  }
  if (!(PRE_EXISTING_CASE_IDS as readonly string[]).includes(id)) {
    return `${id} is not one of the pre-existing acceptance cases this list records`
      + ` (${PRE_EXISTING_CASE_IDS.join(", ")}), so nothing establishes that excepting it costs a recapture.`;
  }
  return null;
}

/** @returns the entries that may suppress an offender, which is never all of them by construction. */
export function legitimateExceptions(entries: readonly string[]): string[] {
  return entries.filter((entry) => exceptionRefusal(entry) === null);
}

/** @returns `{entry, reason}` for every exception that may NOT suppress an offender. */
export function illegitimateExceptions(entries: readonly string[]): { entry: string; reason: string }[] {
  return entries.flatMap((entry) => {
    const reason = exceptionRefusal(entry);
    return reason === null ? [] : [{ entry, reason }];
  });
}

const fingerprint = (offender: Offender) => `${offender.id}:${offender.field}`;

/** How many colliding training ids to name per offender; one control is shared with six of them. */
const TRAINING_IDS_SHOWN = 3;

test("no held-out case reuses a training case's task or control", () => {
  const offenders = sharedExercises({
    training: CASES as readonly Case[],
    heldOut: ALL_ACCEPTANCE_CASES as readonly Case[],
  });

  const excepted = legitimateExceptions(KNOWN_PRE_EXISTING);
  const unexpected = offenders.filter((o) => !excepted.includes(fingerprint(o)));
  assert.deepEqual(unexpected.map(fingerprint), [],
    "These held-out cases reuse a training case's task or control verbatim:\n  "
    + unexpected.map((o) => `${o.id} — ${o.field} "${o.value}" is also ${o.trainingIds.slice(0, TRAINING_IDS_SHOWN).join(", ")}`)
      .join("\n  ")
    + "\n\nA held-out set that repeats the training set measures memorisation and reports it as"
    + "\ngeneralisation, which is the one thing the acceptance number exists not to do. Give the case"
    + "\nits own vocabulary; do not add it to KNOWN_PRE_EXISTING, which is a record of debt that costs a"
    + "\nrecapture to clear, not a way to admit new cases — and which will not suppress a growth-batch"
    + "\ncase anyway, because this assertion filters by legitimateExceptions and not by the raw list.");
});

test("every recorded exception is legitimate — the list cannot admit the cases this guard is for", () => {
  const refused = illegitimateExceptions(KNOWN_PRE_EXISTING);

  assert.deepEqual(refused, [],
    "KNOWN_PRE_EXISTING records exceptions that nothing entitles it to:\n  "
    + refused.map((r) => `${r.entry} — ${r.reason}`).join("\n  "));
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

/*
 * THE BYPASS CONTROL. `illegitimateExceptions(KNOWN_PRE_EXISTING)` is another `deepEqual(…, [])` over a
 * population derived from a call, so here is where it is shown to fail: the first of these is
 * `reviewer-2`'s own mutation on #2108, entry for entry.
 */
test("the reviewer's bypass is refused: a growth-batch case cannot be excepted", () => {
  const bypass = ["acceptance-b3-status-plot:task", "acceptance-b3-status-plot:control"];

  const refused = illegitimateExceptions([...KNOWN_PRE_EXISTING, ...bypass]);

  assert.deepEqual(refused.map((r) => r.entry), bypass);
  assert.match(refused[0]!.reason, /added by a held-out growth batch/);
  // And the entry does not suppress anything either, which is the half that survives deleting a test.
  assert.deepEqual(legitimateExceptions([...KNOWN_PRE_EXISTING, ...bypass]), [...KNOWN_PRE_EXISTING]);
});

test("a b2 case is refused on the same rule, so the prefix is not a b3 special case", () => {
  assert.deepEqual(illegitimateExceptions(["acceptance-b2-error-plot:task"]).map((r) => r.entry),
    ["acceptance-b2-error-plot:task"]);
});

test("an unprefixed case the list does not record is refused too — the provenance half", () => {
  const refused = illegitimateExceptions(["acceptance-something-new:control"]);

  assert.deepEqual(refused.map((r) => r.entry), ["acceptance-something-new:control"]);
  assert.match(refused[0]!.reason, /not one of the pre-existing acceptance cases/);
});

test("the two originals are legitimate, so the rule refuses by provenance rather than refusing everything", () => {
  assert.deepEqual(illegitimateExceptions(KNOWN_PRE_EXISTING), []);
  assert.deepEqual(legitimateExceptions(KNOWN_PRE_EXISTING), [...KNOWN_PRE_EXISTING]);
});
