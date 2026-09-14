/**
 * #1611: A CONTROL'S OWN-STATE VOCABULARY IS ONE FACT, WRITTEN IN TWO PACKAGES, AND THIS PINS THEM EQUAL.
 *
 * Capture decides what the PAGE said after an activation by setting aside the words NVDA speaks about the control
 * itself ("checked", "expanded"): `CONTROL_OWN_STATE` in `@a11ign/nvda-worker`'s capture-pure module
 * (`onlyControlState`, and #1467's `pageSpeechAfter`). The lab reads a toggle's page response by stripping the same
 * words: `TOGGLE_OWN_STATE` in `signal-predicates.mjs` (`pageResponseTo`). A word added to one and not the other makes
 * capture wait for, or keep, a word the lab then strips, or the reverse, and nothing said so. The capture-side comment
 * claimed a `toggle-state-parity.test.ts` pinned them; it never existed (reviewer's note on #1605).
 *
 * THE SETS ARE COMPARED BY WHAT EACH REGEX ACCEPTS, not by their source text: every word either alternation names is
 * run through BOTH patterns, bare and with the optional "not " prefix, so a word written differently (case, spacing)
 * or a prefix one side drops is a difference too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as capturePure from "@a11ign/nvda-worker/capture-pure";
import { CONTROL_OWN_STATE } from "@a11ign/nvda-worker/capture-pure";
import { LINK_OWN_STATE, TOGGLE_OWN_STATE } from "./signal-predicates.mjs";

/** Every word a vocabulary regex names in its alternation groups, lowercased. */
function namedWords(pattern: RegExp): string[] {
  return [...pattern.source.matchAll(/\(\?:([^()]*\|[^()]*)\)/g)]
    .flatMap((group) => group[1].split("|"))
    .map((word) => word.replace(/\\s\+?/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

/** What `pattern` accepts out of `candidates`, as a sorted list. */
const acceptedOf = (pattern: RegExp, candidates: readonly string[]) =>
  candidates.filter((word) => pattern.test(word)).sort();

/**
 * The words only one side accepts, named by side, over every word either side names -- bare and "not "-prefixed.
 * Empty means the two vocabularies accept the same set.
 */
function driftBetween(sides: Readonly<Record<string, RegExp>>): string[] {
  const words = [...new Set(Object.values(sides).flatMap(namedWords))];
  const candidates = [...new Set(words.flatMap((word) => [word, `not ${word}`]))];
  const accepted = Object.fromEntries(Object.entries(sides).map(([side, pattern]) => [side, acceptedOf(pattern, candidates)]));
  const [[aName, aWords], [bName, bWords]] = Object.entries(accepted);
  return [
    ...aWords.filter((word) => !bWords.includes(word)).map((word) => `"${word}" is accepted only by ${aName}`),
    ...bWords.filter((word) => !aWords.includes(word)).map((word) => `"${word}" is accepted only by ${bName}`),
  ].sort();
}

const SIDES = { "capture-pure CONTROL_OWN_STATE": CONTROL_OWN_STATE, "signal-predicates TOGGLE_OWN_STATE": TOGGLE_OWN_STATE };

test("#1611: capture's own-state vocabulary and the lab's toggle vocabulary accept EQUAL sets of words", () => {
  // THE POSITIVE CONTROL: both are real patterns naming the five state words, so an empty drift is not two empty sets.
  for (const [side, pattern] of Object.entries(SIDES)) {
    assert.ok(pattern instanceof RegExp, `${side} is not a RegExp`);
    assert.deepEqual(namedWords(pattern).filter((word) => word !== "not").sort(),
      ["checked", "collapsed", "expanded", "pressed", "selected"], `${side} no longer names the five state words`);
    assert.ok(pattern.test("not checked") && pattern.test("Expanded"), `${side}: the "not " form and case are accepted`);
  }
  assert.deepEqual(driftBetween(SIDES), [], "the two copies of one vocabulary drifted");
});

test("#1611 CONTROL: a word planted on either side goes red, naming the word and the side", () => {
  const planted = (source: RegExp, word: string) => new RegExp(source.source.replace("collapsed)", `collapsed|${word})`), source.flags);
  assert.deepEqual(driftBetween({ ...SIDES, "capture-pure CONTROL_OWN_STATE": planted(CONTROL_OWN_STATE, "focused") }),
    ['"focused" is accepted only by capture-pure CONTROL_OWN_STATE', '"not focused" is accepted only by capture-pure CONTROL_OWN_STATE']);
  assert.deepEqual(driftBetween({ ...SIDES, "signal-predicates TOGGLE_OWN_STATE": planted(TOGGLE_OWN_STATE, "open") }),
    ['"not open" is accepted only by signal-predicates TOGGLE_OWN_STATE', '"open" is accepted only by signal-predicates TOGGLE_OWN_STATE']);
  const withoutNot = new RegExp(TOGGLE_OWN_STATE.source.replace("(?:not\\s+)?", ""), TOGGLE_OWN_STATE.flags);
  assert.ok(driftBetween({ ...SIDES, "signal-predicates TOGGLE_OWN_STATE": withoutNot })
    .every((line) => line.startsWith('"not ') && line.endsWith("only by capture-pure CONTROL_OWN_STATE")),
  "a side that drops the optional \"not \" prefix is named too");
});

test("#1611: the link vocabulary has NO capture counterpart -- capture records a route's announcement raw", () => {
  // Classified, not pinned (done-when 3). Capture's route probe keeps what NVDA said after pressing a link, and only
  // the lab strips a link's own state (`linkStatusIsSilent`). If capture ever gains a link vocabulary, this reads it.
  const captureVocabularies = Object.keys(capturePure).filter((name) => /OWN_STATE$/.test(name));
  assert.deepEqual(captureVocabularies, ["CONTROL_OWN_STATE"], "the control: the namespace read finds capture's one vocabulary");
  assert.ok(LINK_OWN_STATE.test("visited") && LINK_OWN_STATE.test("same page"), "the lab's link vocabulary is what it says");
  const overlap = namedWords(LINK_OWN_STATE).filter((word) => CONTROL_OWN_STATE.test(word) || CONTROL_OWN_STATE.test(`not ${word}`));
  assert.deepEqual(overlap, [], "and it shares no word with the control vocabulary, so it is not a hidden third copy of it");
});
