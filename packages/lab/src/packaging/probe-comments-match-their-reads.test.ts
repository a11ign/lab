/**
 * A PROBE'S COMMENT SAYS WHAT IT READS, AND NOTHING CHECKED IT — #842.
 *
 * `probeDisclosure`'s comment said *"We **RE-READ the control** rather than listening for a spontaneous
 * announcement… Re-reading **asks the accessibility tree** instead."* The code did neither: it calls
 * `reportCurrentFocus`, so `after` is whatever holds focus after activation. The two coincide whenever
 * activation leaves focus where it was — true on 2,000+ corpus captures, false on a nav menu that moved
 * focus into what it revealed, where the judge asserted 4.1.2 across two different controls.
 *
 * **The comment is why the defect was invisible.** `addSilentStateChanges` reads the `control`/`after`
 * pair as a before-and-after of ONE control, which is exactly what the comment promised it could. A
 * correct reading of a wrong comment.
 *
 * ## A COUNT IS THE SEARCH SPACE, NOT THE FINDING
 *
 * `bounded-window-reads.test.ts` states this and it applies here too, so the row's own population figure
 * is restated rather than repeated. **The row said "13 claims across 15 probe functions."** Measured
 * here:
 *
 *     probe functions                                                  15
 *     lines anywhere in the file matching the phrase list              28
 *     probe functions whose OWN comment makes a READS claim             2
 *
 * The 13 was a count of matching LINES in a phrase sweep — the search space. Most of those lines are in
 * helper docs, file headers and inline notes, and describe the mechanism rather than assert what a probe
 * reads. Two probes make the claim in their own comment, which is what this guard is about. **That is
 * not a smaller problem than the row described**: one of the two was wrong, it survived 2,000+ captures,
 * and nothing in the tree could see it.
 *
 * ## CLASSIFY, NEVER PASS/FAIL ON A REGEX
 *
 * Three states, because "makes no claim" and "makes a claim that holds" are different facts and only the
 * third is a defect:
 *
 *   `no-claim`      the comment does not say what this probe reads -- nothing to check
 *   `consistent`    it names a source, and the probe calls something that reads that source
 *   `contradicted`  it names a source nothing in the probe (or what it delegates to) reads -- THE DEFECT
 *
 * ## THE FLOOR ASSERTS ABOUT THE SEARCH
 *
 * Every other assertion here is satisfied by finding FEWER probes, so the discovery is pinned by NAME
 * against a written list. A renamed or deleted probe fails loudly rather than shrinking the population
 * this guard believes in.
 *
 * ## DELEGATION IS FOLLOWED ONE LEVEL
 *
 * `probeToggle` and `probeTaskButton` are one-line dispatches to `activateAndCaptureDelta`, so a
 * body-only scan reports them as reading nothing and would call any claim they make contradicted. A
 * scanner that cannot tell "reads nothing" from "reads through a helper" produces a false accusation,
 * which is the failure mode this repository's most expensive rule is about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROBES = resolve(import.meta.dirname, "../../../nvda-worker/src/capture-probes.mjs");
const LINES = readFileSync(PROBES, "utf8").split("\n");

/**
 * THE FLOOR. Every probe function in `capture-probes.mjs`, by name, written out rather than counted.
 * A count would be satisfied by fifteen of anything; these are the fifteen.
 */
const EVERY_PROBE = [
  "probeTableCells", "probeFocusOrderWithEventLog", "probeFocusOrder", "probeElementsListCounts",
  "probeDisclosure", "probeConfiguredForm", "probeFocusContext", "probeTypedFeedback",
  "probeArrowNavigation", "probeDialogEscape", "probeFocusReveal", "probeRouteChange",
  "probeFormSubmit", "probeTaskButton", "probeToggle",
] as const;

/**
 * WHAT A COMMENT CAN CLAIM TO READ, and the calls that would actually produce it.
 *
 * Derived from the calls these probes make, not from what a reader might imagine: every entry's
 * `satisfiedBy` was read off the file. `reReadTheControl` is deliberately empty — **nothing in this file
 * re-reads a named element**; doing so needs a CDP read of that element, which is an evidence change and
 * its own row. An empty list is the honest entry, and it is what makes the claim contradicted rather
 * than unverifiable.
 */
const SOURCES = {
  reReadTheControl: {
    claim: /re-?reads? the control|re-?reading (?:the control|asks)/i,
    satisfiedBy: [] as string[],
    describe: "a re-read of the control that was activated",
  },
  accessibilityTree: {
    claim: /asks? the accessibility tree|reads? the accessibility tree/i,
    satisfiedBy: ["structuralCensus", "domCensus", "evaluateOnPageTarget"],
    describe: "the accessibility tree",
  },
  elementsList: {
    claim: /reads? the Elements List/i,
    satisfiedBy: ["elementsListOpen", "elementsListSeed", "elementsList", "openElementsList"],
    describe: "NVDA's Elements List dialog",
  },
  focusedControl: {
    claim: /reads? the focused control|asks? what has focus/i,
    satisfiedBy: ["reportFocusedControl", "reportFocusedControlWithRetry", "reportCurrentFocus"],
    describe: "whatever currently holds focus",
  },
  speechLog: {
    claim: /reads? the speech log|reads? what was announced/i,
    satisfiedBy: ["spokenPhraseLog", "lastSpokenPhrase", "itemTextLog"],
    describe: "the speech log",
  },
} as const;

/** Every contiguous comment line above a declaration: `//` lines and `/** … *\/` blocks alike. */
function commentAbove(declarationLine: number): string {
  const out: string[] = [];
  for (let j = declarationLine - 1; j >= 0; j--) {
    const s = LINES[j].trim();
    if (s === "") break;
    if (!(s.startsWith("//") || s.startsWith("*") || s.startsWith("/**") || s.endsWith("*/"))) break;
    out.push(LINES[j]);
  }
  return out.reverse().join("\n");
}

/** A top-level function's body: to the first line that closes it at column 0. */
function bodyAt(declarationLine: number): string {
  const out: string[] = [];
  for (const line of LINES.slice(declarationLine)) {
    out.push(line);
    if (line.startsWith("}") && out.length > 1) break;
  }
  return out.join("\n");
}

function declarationOf(name: string): number {
  const at = LINES.findIndex((l) => new RegExp(`^(?:export )?async function ${name}\\b`).test(l));
  assert.notEqual(at, -1, `${name} is not declared in capture-probes.mjs — this guard's floor is stale, `
    + "which is a fact about the guard and must not read as the probe being fine");
  return at;
}

/** The body, plus the body of the single helper it dispatches to when that is all it does. */
function readsOf(name: string): { calls: string; delegatesTo: string | null } {
  const body = bodyAt(declarationOf(name));
  const dispatch = /\breturn (\w+)\(/.exec(body.split("\n").slice(1, -1).filter((l) => l.trim()).join("\n"));
  const isOneLiner = body.split("\n").filter((l) => l.trim() && !l.startsWith("}")).length <= 2;
  if (dispatch && isOneLiner) {
    const helper = LINES.findIndex((l) => new RegExp(`^(?:export )?(?:async )?function ${dispatch[1]}\\b`).test(l));
    if (helper !== -1) return { calls: body + "\n" + bodyAt(helper), delegatesTo: dispatch[1] };
  }
  return { calls: body, delegatesTo: null };
}

type Verdict = { probe: string, state: "no-claim" | "consistent" | "contradicted", source?: string };

function classify(name: string): Verdict {
  const comment = commentAbove(declarationOf(name));
  const { calls } = readsOf(name);
  for (const [source, rule] of Object.entries(SOURCES)) {
    if (!rule.claim.test(comment)) continue;
    const satisfied = rule.satisfiedBy.some((call) => new RegExp(`\\b${call}\\b`).test(calls));
    return { probe: name, state: satisfied ? "consistent" : "contradicted", source };
  }
  return { probe: name, state: "no-claim" };
}

test("THE FLOOR: all 15 probe functions are found, by name", () => {
  // Every other assertion in this file is satisfied by finding fewer, so this one is about the SEARCH.
  const declared = LINES.filter((l) => /^(?:export )?async function probe\w+/.test(l))
    .map((l) => /function (probe\w+)/.exec(l)![1]);
  assert.deepEqual(declared.sort(), [...EVERY_PROBE].sort(),
    "the probe functions in capture-probes.mjs are not the ones this guard names — a probe was added, "
    + "renamed or removed, and the list above must be updated deliberately rather than by a count");
});

test("no probe's comment claims a read its code does not make", () => {
  const verdicts = EVERY_PROBE.map(classify);
  const contradicted = verdicts.filter((v) => v.state === "contradicted");
  assert.deepEqual(contradicted, [],
    "a probe's comment names a source nothing it calls reads. That is the #812 shape: the judge reads "
    + "the evidence as the comment describes it, so a wrong comment is a wrong finding rather than a "
    + "stale note. Correct the comment, or make the code do what it says.");
});

test("the classification is reported, so `no-claim` and `consistent` stay different facts", () => {
  const verdicts = EVERY_PROBE.map(classify);
  const claiming = verdicts.filter((v) => v.state !== "no-claim");
  // Two, and NAMED — because a guard whose population can silently drop to zero passes forever.
  // `probeElementsListCounts` says it reads the Elements List and drives that dialog; `probeDisclosure`'s
  // comment survives as the CORRECTION (#812) and no longer claims a re-read.
  assert.deepEqual(claiming.map((v) => `${v.probe}:${v.state}`).sort(),
    ["probeElementsListCounts:consistent"],
    "the set of probes making a READS claim has changed. That is not a failure — it is the thing this "
    + "guard exists to notice. Read the new claim against the code and update this list deliberately.");
});

test("MUTATION TARGET: the guard can express the fault it exists to catch", () => {
  // A canary that cannot reproduce the fault proves nothing. `probeDisclosure`'s comment BEFORE #812
  // corrected it, run through the same classifier: it must come back `contradicted`.
  const wasWrong = "// We RE-READ the control rather than listening for a spontaneous announcement.\n"
    + "// Re-reading asks the accessibility tree instead: has the control's state actually changed?";
  const { calls } = readsOf("probeDisclosure");
  const source = Object.entries(SOURCES).find(([, rule]) => rule.claim.test(wasWrong));
  assert.ok(source, "the classifier no longer recognises the exact comment that caused #812");
  assert.equal(source![1].satisfiedBy.some((call) => new RegExp(`\\b${call}\\b`).test(calls)), false,
    "probeDisclosure would satisfy the re-read claim, so the guard could not have caught #812 and is "
    + "testing nothing");
});
