/**
 * `VOCABULARY_FEATURES` names the features a hand-written wordlist decides. It is a fact written in two
 * languages — the list lives in a `.mjs` audit, the wordlists in `screenreader_features.py` — and this
 * repo's most expensive recurring shape is exactly that, with nothing comparing the copies.
 *
 * Deriving it from the Python is not possible without running it (the audit is plain node, and making it
 * depend on a build is how a stale `dist` shipped once). So the copies are pinned equal instead, which is
 * the third of this repo's three remedies and the one reserved for a duplication that is forced.
 *
 * Why the list matters: a feature decided by a WORD can be true on a conforming page, because English gives
 * words more than one sense. "Details" naming a GOV.UK component conforms; the scorer accused 11 of those
 * pages of 2.4.4 anyway. A feature that is not word-decided — an unnamed form field — cannot appear on a
 * conforming page, and putting it on the same work list is asking for work nobody can do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { VOCABULARY_FEATURES } from "../scripts/audit-corpus-starvation.mjs";

const FEATURES_PY = fileURLToPath(
  new URL("../../scorer/python/screenreader_features.py", import.meta.url));

/** Wordlists over PAGE CONTENT. `UNNAMED_GRAPHIC` is deliberately absent — see the assertion below. */
const CONTENT_WORDLISTS = ["VAGUE_LINKS", "GENERIC_GRAPHICS", "GENERIC_HEADINGS", "FILENAME_GRAPHIC"];

/** Every `values["x"] = ...` assignment whose body mentions `wordlist`. */
function featuresDecidedBy(source: string, wordlist: string): string[] {
  const found: string[] = [];
  const assignment = /values\["([a-z0-9_]+)"\]\s*=\s*([\s\S]{0,240}?)(?=\n {4}values\["|\n {4}return|\n\n)/g;
  for (const [, name, body] of source.matchAll(assignment)) {
    if (body.includes(wordlist)) found.push(name);
  }
  return found;
}

test("every feature a content wordlist decides is declared as vocabulary-decided", () => {
  const source = readFileSync(FEATURES_PY, "utf8");
  const decided = new Set<string>();
  for (const wordlist of CONTENT_WORDLISTS) {
    const features = featuresDecidedBy(source, wordlist);
    assert.ok(features.length > 0,
      `found no feature computed from ${wordlist} — this guard is examining an empty set, which is how a `
      + "scrape-based test passes while asserting nothing");
    for (const feature of features) decided.add(feature);
  }
  for (const feature of decided) {
    assert.ok(VOCABULARY_FEATURES.has(feature),
      `${feature} is decided by a hand-written wordlist but is not in VOCABULARY_FEATURES, so `
      + "corpus:starvation will file it under \"the feature IS the failure\" and nobody will fix it");
  }
});

test("a screen-reader phrase is NOT a content wordlist", () => {
  // `UNNAMED_GRAPHIC` matches "unlabeled graphic" — NVDA's own words, not the page's. It cannot acquire a
  // second sense from the page's prose, so it is a correct monopoly and does not belong on the work list.
  // Keeping the distinction sharp is the whole value of the split.
  const source = readFileSync(FEATURES_PY, "utf8");
  assert.ok(source.includes("UNNAMED_GRAPHIC"), "the constant vanished; this test is asserting nothing");
  assert.ok(!VOCABULARY_FEATURES.has("unnamed_graphic_present"),
    "unnamed_graphic_present is decided by NVDA's own phrasing, not by page wording, so no conformant page "
    + "can carry it and it must not be filed as fixable");
});

test("the declared set is not empty, and every entry is a plausible feature name", () => {
  assert.ok(VOCABULARY_FEATURES.size > 0);
  for (const name of VOCABULARY_FEATURES) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is not a feature name`);
  }
});
