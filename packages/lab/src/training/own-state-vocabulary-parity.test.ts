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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripComments } from "@a11ign/evidence/source-text";

import * as capturePure from "@a11ign/nvda-worker/capture-pure";
import { CONTROL_OWN_STATE } from "@a11ign/nvda-worker/capture-pure";
import { LINK_OWN_STATE, TOGGLE_OWN_STATE } from "./signal-predicates.mjs";
// #1625: the evidence parser by RELATIVE source path, the shape `cross-boundary-predicate-parity.test.ts` uses for the
// judge -- `parseAnnouncement` is not exported from `@a11ign/evidence`'s root, and a worktree resolves that package to
// the primary checkout's dist, which would not carry a new export (#1498's TS2305).
import { parseAnnouncement } from "../../../evidence/src/announcement.js";

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
    ...aWords.filter((word) => !bWords.includes(word)).map((word) => `"${word}" is accepted only by ${aName}, not by ${bName}`),
    ...bWords.filter((word) => !aWords.includes(word)).map((word) => `"${word}" is accepted only by ${bName}, not by ${aName}`),
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
    ['"focused" is accepted only by capture-pure CONTROL_OWN_STATE, not by signal-predicates TOGGLE_OWN_STATE',
      '"not focused" is accepted only by capture-pure CONTROL_OWN_STATE, not by signal-predicates TOGGLE_OWN_STATE']);
  assert.deepEqual(driftBetween({ ...SIDES, "signal-predicates TOGGLE_OWN_STATE": planted(TOGGLE_OWN_STATE, "open") }),
    ['"not open" is accepted only by signal-predicates TOGGLE_OWN_STATE, not by capture-pure CONTROL_OWN_STATE',
      '"open" is accepted only by signal-predicates TOGGLE_OWN_STATE, not by capture-pure CONTROL_OWN_STATE']);
  const withoutNot = new RegExp(TOGGLE_OWN_STATE.source.replace("(?:not\\s+)?", ""), TOGGLE_OWN_STATE.flags);
  assert.ok(driftBetween({ ...SIDES, "signal-predicates TOGGLE_OWN_STATE": withoutNot })
    .every((line) => line.startsWith('"not ') && line.endsWith("only by capture-pure CONTROL_OWN_STATE, not by signal-predicates TOGGLE_OWN_STATE")),
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

/**
 * #1625: THE EVIDENCE PARSER HOLDS THE THIRD COPY, as one entry of `STATE_PATTERNS` in `@a11ign/evidence`'s
 * announcement.ts: `/^(?:not )?(?:checked|pressed|selected|expanded|collapsed)$/i`. It is what every consumer reads a
 * control's state words through, and its own comment records a MISSING word (`focused`) making it yield no states at all.
 *
 * READ AS SOURCE TEXT, NOT ONLY THROUGH THE PARSER, because the parser accepts the UNION of `STATE_PATTERNS`: measured
 * through `parseAnnouncement`, `focused`, `visited`, `blank` and `level 2` come back as states beside the five. So a word
 * ADDED to this one entry is invisible to a behaviour-only read, which could only test words it already knew. The text
 * read is #1575's shape (`FOCUS_STEP` read from left-site.ts) and #1583's (`new Set([...])` literals); the parser is kept
 * as the control that the entry is still wired into `isState`. No export, so the published surface does not change.
 */
const ANNOUNCEMENT = resolve(import.meta.dirname, "../../../evidence/src/announcement.ts");
const EVIDENCE_SIDE = "evidence announcement.ts STATE_PATTERNS";

/** Every regex literal of the own-state shape (an optional "not " prefix, then an alternation) in `STATE_PATTERNS`. */
function ownStateEntriesIn(source: string): RegExp[] {
  const text = stripComments(source);
  const start = text.indexOf("const STATE_PATTERNS");
  assert.notEqual(start, -1, "announcement.ts no longer declares STATE_PATTERNS -- this pin has nothing to read");
  const array = text.slice(start, text.indexOf("]);", start));
  return [...array.matchAll(/\/\^\(\?:not(?:\\s\+?| )\)\?\(\?:[^()\n]*\)\$\/([a-z]*)/g)]
    .map((match) => new RegExp(match[0].slice(1, match[0].lastIndexOf("/")), match[1]));
}

const evidenceEntry = (): RegExp => {
  const entries = ownStateEntriesIn(readFileSync(ANNOUNCEMENT, "utf8"));
  assert.equal(entries.length, 1, `STATE_PATTERNS must hold exactly one own-state entry, found ${entries.length}`);
  return entries[0];
};

test("#1625: the evidence parser's own-state entry accepts the SAME set as capture's -- and so as the lab's", () => {
  const evidence = evidenceEntry();
  // THE POSITIVE CONTROL: the entry read is a real pattern naming the five state words, with its "not " form.
  assert.deepEqual(namedWords(evidence).sort(), ["checked", "collapsed", "expanded", "pressed", "selected"]);
  assert.ok(evidence.test("not selected") && evidence.test("Collapsed"), "the \"not \" form and case are accepted");
  // Capture and the lab are pinned equal above, so evidence equal to capture makes all three one set.
  assert.deepEqual(driftBetween({ [EVIDENCE_SIDE]: evidence, "capture-pure CONTROL_OWN_STATE": CONTROL_OWN_STATE }), [],
    "the evidence parser's copy of the own-state vocabulary drifted from capture's");
});

test("#1625: every word the evidence entry names parses AS A STATE through parseAnnouncement -- the entry is wired in", () => {
  const words = namedWords(evidenceEntry());
  for (const channel of ["sweep", "transcript"] as const) {
    for (const form of words.flatMap((word) => [word, `not ${word}`])) {
      const raw = channel === "sweep" ? `Probe control, button, ${form}` : `button, ${form}, Probe control`;
      const states = parseAnnouncement(raw, channel).objects.flatMap((object) => object.states);
      assert.ok(states.includes(form), `${channel}: "${form}" did not parse as a state (${JSON.stringify(states)})`);
    }
  }
  // THE CONTROL: the probe discriminates. A word no STATE_PATTERNS entry names is not a state, bare or "not ".
  const open = parseAnnouncement("Probe control, button, open", "sweep");
  assert.deepEqual(open.objects.flatMap((object) => object.states), [], "\"open\" must not parse as a state");
});

test("#1625 CONTROL: a word added to or removed from a copy of the evidence entry alone goes red, naming the word and evidence", () => {
  const source = readFileSync(ANNOUNCEMENT, "utf8");
  const entry = "checked|pressed|selected|expanded|collapsed";
  assert.equal(source.split(entry).length - 1, 1, "the entry's alternation appears once in announcement.ts");
  const driftWith = (edited: string) => driftBetween({
    [EVIDENCE_SIDE]: ownStateEntriesIn(source.replace(entry, edited))[0], "capture-pure CONTROL_OWN_STATE": CONTROL_OWN_STATE,
  });
  assert.deepEqual(driftWith(`${entry}|open`), [
    `"not open" is accepted only by ${EVIDENCE_SIDE}, not by capture-pure CONTROL_OWN_STATE`,
    `"open" is accepted only by ${EVIDENCE_SIDE}, not by capture-pure CONTROL_OWN_STATE`,
  ]);
  assert.deepEqual(driftWith("checked|pressed|expanded|collapsed"), [
    `"not selected" is accepted only by capture-pure CONTROL_OWN_STATE, not by ${EVIDENCE_SIDE}`,
    `"selected" is accepted only by capture-pure CONTROL_OWN_STATE, not by ${EVIDENCE_SIDE}`,
  ]);
});

test("#1625 CONTROL: the text read finds exactly the own-state shape -- not a sibling entry, and not a second copy", () => {
  const planted = (entries: string) => `const STATE_PATTERNS: readonly RegExp[] = Object.freeze([\n${entries}\n]);`;
  const own = "/^(?:not )?(?:checked|pressed)$/i,";
  assert.equal(ownStateEntriesIn(planted("/^level \\d+$/i, /^focused$/i,")).length, 0, "sibling entries are not the own-state entry");
  assert.equal(ownStateEntriesIn(planted(own)).length, 1);
  assert.equal(ownStateEntriesIn(planted(`${own}\n/^(?:not\\s+)?(?:open|closed)$/i,`)).length, 2, "a second copy is counted, so evidenceEntry refuses it");
  assert.equal(ownStateEntriesIn(planted(`// ${own}`)).length, 0, "an entry that is only in a comment is not read");
});
