/**
 * A `criterion:subtype` STRING IS WRITTEN IN AT LEAST SIX PLACES, AND NOTHING CHECKS THAT IT NAMES
 * SOMETHING REAL.
 *
 * `3.3.2:unnamed-form-field` was deleted on 2026-09-05 and was found still declared TWICE more, hours
 * apart, each time only because a four-hour chain failed and named a symptom rather than the cause:
 *
 *   - `ACCEPTANCE_ACCOMPANYING`'s `bare-edit` (acceptance-matrix.mjs) — 10 held-out cases labelled for a
 *     subtype no head predicts, which `eligible_records` silently drops, so they scored as false negatives.
 *   - `ACCOMPANYING_DEFECTS`'s `bare-edit` (case-matrix.mjs) — the corpus kept minting the label, the
 *     trainer kept building a head for it, and that head fired on held-out cases no longer labelled 3.3.2.
 *
 * Deleting a subtype means finding every site by memory, and memory missed one twice.
 *
 * ## What is the authority
 *
 * A `criterion:subtype` string is REAL only if some case actually produces it — `CASES` (case-matrix.mjs)
 * and `ALL_ACCEPTANCE_CASES` (acceptance-matrix.mjs), read as `testCase.criterion + ":" + testCase.subtype`,
 * which is already resolved through `defaultSubtype` at case-construction time. Everything else that writes
 * a compound string — `alsoFails`, `ACCOMPANYING_DEFECTS[...].subtypes`, `ACCEPTANCE_ACCOMPANYING[...].adds`,
 * `MODEL_EXCLUDED_SUBTYPES`, `rule-ownership.json`'s keys — is a REFERENCE into that vocabulary, never a
 * second way to mint one.
 *
 * `rule-ownership.json` was the other candidate, and it is the wrong one: its own reader states outright
 * that "a subtype the model owns is simply absent from this file" (`rule-ownership.ts`), so a subtype
 * authority built from it alone would reject every legitimate model-only reference — `1.3.1:fake-heading`,
 * `1.1.1:generic-alt`, `2.4.6:regex` and a dozen more, none of them rule-owned and all of them real. Measured
 * rather than assumed: every one of its 18 keys already names a real `CASES` subtype (`missingFromCases`
 * below would be `[]` if it were computed here), so this is a smaller vocabulary than `CASES` today, not a
 * disagreeing one — and it is checked here as a REFERENCE for exactly that reason, one direction only.
 *
 * `MODEL_EXCLUDED_SUBTYPES` is not a fourth authority either. Its members ARE `CASES` subtypes — a page
 * demonstrating `3.3.2:placeholder-only` exists and is captured — the set only says the trained model must
 * not learn from them. So it is a reference too, and validating it here is what would have caught this
 * exact history if `unnamed-form-field` had ever been excluded rather than deleted outright.
 *
 * `target.unknownSubtypes` / `input.unknownSubtypes` (`export-screenreader-dataset.mjs`,
 * `dataset-distribution.mjs`) ask the SAME question and answer it too late: they report a corpus/model
 * disagreement on a record that has already been captured and exported, hours or days after the source
 * that caused it was written. This runs on `npm test`, before a single page is generated.
 *
 * ## Which sites are actually checked, and which are not
 *
 * FIVE files are read as source text, comments stripped (`@a11y-witness/evidence/source-text` — a comment
 * naming a deleted subtype as history, which this file is full of, must not be validated as a live
 * declaration): `case-matrix.mjs`, `acceptance-matrix.mjs`, `export-screenreader-dataset.mjs`,
 * `real-page-corpus.mjs`, `generate-screenreader-acceptance.mjs`. The last two currently contribute NOTHING
 * — `real-page-corpus.mjs`'s only match is inside its own JSDoc example, and
 * `generate-screenreader-acceptance.mjs`'s is inside a comment recounting a past incident — so today they
 * validate vacuously. Both are scanned anyway: `claimExcludes` is documented to accept a subtype string
 * (`real-page-corpus.mjs`'s own JSDoc), and the day it does, this catches a bad one immediately rather than
 * waiting for a second incident to justify adding the file.
 *
 * `rule-ownership.ts`, the sixth site, is deliberately NOT read as source text. Its one string-literal
 * match is not a declaration at all: an error message illustrates the ambiguity of a bare subtype family
 * with `"4.1.2:regex", not "regex"` — and `4.1.2:regex` is not a real subtype today (`2.4.4:regex` and
 * `2.4.6:regex`, both named in the same sentence, are). That is this file's own rot, one paragraph below a
 * true account of `3.3.2:unnamed-form-field` no longer existing — an illustrative example, not a reference,
 * and scanning it as one would have produced a permanent false positive rather than catching anything.
 * Reported separately; not fixed here, since fixing prose is not this unit's job. What actually matters
 * about `rule-ownership.ts` — whether `rule-ownership.json` names real subtypes — is asked directly, of the
 * VALUE `readRuleOwnership()` returns, never of the reader's own source text.
 *
 * ## Traps this avoided
 *
 * Anti-vacuity is checked per SOURCE GROUP (the five files together, and rule-ownership separately), never
 * per file — two of the five files legitimately contribute zero today, and demanding otherwise would make
 * this fail on the current, correct tree. What must never be zero is the total: an extraction that finds
 * nothing has examined nothing, whichever file it was supposed to be reading.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "@a11y-witness/evidence/source-text";

import { CASES } from "./case-matrix.mjs";
import { ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { readRuleOwnership } from "./rule-ownership.js";

/** A `criterion:subtype` string, wherever one appears in code -- never in prose about one. */
const SUBTYPE_PATTERN = /\b\d+\.\d+\.\d+:[a-z][a-z0-9-]*\b/g;

/**
 * Every subtype some case actually produces. DERIVED, never listed -- a hand-written list here would be a
 * SEVENTH place to keep in step with the six this file already names.
 */
const REAL_SUBTYPES = new Set<string>(
  [...CASES, ...ALL_ACCEPTANCE_CASES].map(
    (testCase: Record<string, unknown>) => `${testCase.criterion}:${testCase.subtype}`,
  ),
);

test("some case defines a real subtype vocabulary, or this suite proves nothing", () => {
  assert.ok(REAL_SUBTYPES.size >= 15,
    `found ${REAL_SUBTYPES.size} real subtype(s) across CASES and ALL_ACCEPTANCE_CASES; the scan is `
    + "broken, not the corpus thin");
});

/**
 * Comments stripped, so a subtype named as HISTORY (this file is full of `3.3.2:unnamed-form-field` --
 * see the header) is never mistaken for a live reference. See `@a11y-witness/evidence/source-text`.
 */
const read = (path: string) => stripComments(readFileSync(resolve(process.cwd(), path), "utf8"));

/**
 * The five files a `criterion:subtype` reference can be written into, as REPO-ROOT-RELATIVE paths so this
 * runs the same under `npm test` from anywhere the root resolves. `rule-ownership.ts` is not here -- see
 * the header for why source-scanning it would be wrong rather than merely redundant.
 */
const REFERENCE_SITES = [
  "packages/lab/src/training/case-matrix.mjs",
  "packages/lab/src/training/acceptance-matrix.mjs",
  "packages/lab/src/training/export-screenreader-dataset.mjs",
  "packages/lab/src/training/real-page-corpus.mjs",
  "packages/lab/src/training/generate-screenreader-acceptance.mjs",
];

test("every criterion:subtype string in these files names a subtype some case actually defines", () => {
  const unresolved: string[] = [];
  let matched = 0;
  for (const path of REFERENCE_SITES) {
    const references = new Set(read(path).match(SUBTYPE_PATTERN) ?? []);
    matched += references.size;
    for (const reference of references) {
      if (!REAL_SUBTYPES.has(reference)) unresolved.push(`${path}: "${reference}"`);
    }
  }
  // ANTI-VACUITY across the GROUP, not per file: `real-page-corpus.mjs` and
  // `generate-screenreader-acceptance.mjs` correctly contribute zero today (see the header), so demanding
  // a nonzero count from each would fail the current, correct tree. The total is what must not collapse --
  // it did, to zero, the moment `stripComments` or the pattern above stops seeing real code.
  assert.ok(matched >= 10,
    `found ${matched} criterion:subtype reference(s) across ${REFERENCE_SITES.length} file(s); the scan `
    + "is broken, not the files clean");
  assert.deepEqual(unresolved, [],
    "these name a subtype no case defines -- either the subtype was renamed/deleted and this reference "
    + `was missed, or it was never real: ${unresolved.join(", ")}`);
});

test("rule-ownership.json names only subtypes some case actually defines", () => {
  // Read as a VALUE, never scraped from `rule-ownership.ts`'s source -- the reader's own module has no
  // real declarations to find (see the header), and `readRuleOwnership()` is the one place this question
  // can be asked of the JSON file directly, with its own shape validation already applied.
  //
  // `modelHead: false` ENTRIES ARE EXEMPT, and this is the fourth site to need that exemption — after
  // `assert_declaration_matches_data`, `subtypes_by_criterion_for` and `ownershipFailures`. The field
  // asserts exactly the state this test otherwise forbids: a rule decides this criterion, and the corpus
  // cannot yet show it. `1.4.2:autoplay-uncontrollable` has no case at all; `2.4.7:focus-removed-on-receipt`
  // has nine, whose PRIMARY criterion is 2.1.1. Both are declared rather than excepted so that
  // `rules:coverage` can say "never fired anywhere, the claim rests on nothing" — findable, which a
  // silent omission is not. The exemption is safe precisely because `why` is REQUIRED alongside the
  // field: an entry cannot take it without saying what it means.
  const ownership = readRuleOwnership();
  const owned = [...ownership.keys()].filter((key) => ownership.get(key)?.modelHead !== false);
  assert.ok(ownership.size >= 10,
    `found ${ownership.size} rule-ownership.json key(s); the scan is broken, not the declaration thin`);
  const unresolved = owned.filter((key) => !REAL_SUBTYPES.has(key));
  assert.deepEqual(unresolved, [],
    "rule-ownership.json decides these and no case defines them any more -- a rule mapping surviving its "
    + `subtype's last case, orphaning its "reportsAs": ${unresolved.join(", ")}`);
});
