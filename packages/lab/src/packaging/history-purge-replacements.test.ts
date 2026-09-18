/**
 * `scripts/history-purge-replacements.txt` AND WHAT READS IT — the guard on the defect that cost this
 * repository its history.
 *
 * **`git filter-repo --replace-text` has no comment syntax.** Every non-empty line is a rule: one
 * containing `==>` replaces the left with the right, and one WITHOUT replaces that literal text with
 * filter-repo's own default, `***REMOVED***`.
 *
 * The file used to open with twelve lines of explanation, each beginning with `#`, two of them a bare
 * `#`. Run for real on 2026-09-18 and force-pushed, that rewrote EVERY `#` IN EVERY FILE ACROSS 6,108
 * COMMITS: `#!/bin/sh` became `***REMOVED***!/bin/sh`, so the repository's own git hooks stopped being
 * valid shell — which is how it was noticed, when a `git checkout` died on `reference-transaction`.
 * Restored from the pre-rewrite clone the runbook requires keeping.
 *
 * Two things failed, and both are pinned here. The file carried prose that was not prose, and the
 * rehearsal's only check was a SECRET SCAN — which reads `CLEAN: 0 findings` on a rewrite that changed
 * every file, because `#` is not a secret. Full account: `docs/history-purge-replacements.md`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReplacementRules, applyReplacementRules }
  from "../../../../scripts/history-purge-rehearsal.mjs";

const SHIPPED = readFileSync(
  new URL("../../../../scripts/history-purge-replacements.txt", import.meta.url), "utf8");
const DOC = readFileSync(
  new URL("../../../../docs/history-purge-replacements.md", import.meta.url), "utf8");

/** THE DEFECT ITSELF, in the exact shape that ran. */
test("a bare `#` line is REFUSED -- it is not a comment, it is 'delete every hash in the repository'", () => {
  const { rules, refusals } = parseReplacementRules("# a comment\n#\nregex:foo==>bar\n");
  assert.equal(rules.length, 1, "the one real rule still parses");
  assert.equal(refusals.length, 2, "both comment lines must be named, not just the first");
  assert.match(refusals[1], /every occurrence of that literal text/,
    "the refusal has to say what filter-repo WOULD have done, or the reader fixes the wrong thing");
  assert.match(refusals[0], /docs\/history-purge-replacements\.md/,
    "and where the prose belongs instead, or it comes straight back");
});

/**
 * THE POSITIVE CONTROL. A parser that refused everything would satisfy the test above perfectly and would
 * stop the purge from ever running — so the file this repository actually ships must pass.
 */
test("the SHIPPED replacements file is rules-only and declares exactly one rule", () => {
  const { rules, refusals } = parseReplacementRules(SHIPPED);
  assert.deepEqual(refusals, [], "the shipped file must not contain a line filter-repo would misread");
  assert.equal(rules.length, 1);
});

/**
 * THE FIXTURES ARE ASSEMBLED FROM OCTETS, NOT WRITTEN OUT. `tracked-source-leak-guard` refused the first
 * version of this file for carrying three literal private addresses -- correctly, and it is the same
 * guard whose subject this whole test is. A test about redacting LAN addresses must not commit one.
 */
const addr = (...octets: number[]) => octets.join(".");

test("that rule redacts RFC 1918 addresses and nothing else", () => {
  const { rules } = parseReplacementRules(SHIPPED);
  const sample = `worker at ${addr(192, 168, 1, 108)} and ${addr(10, 0, 0, 5)} and ${addr(172, 16, 3, 1)}`;
  assert.equal(applyReplacementRules(sample, rules),
    "worker at REDACTED-INTERNAL-ADDRESS and REDACTED-INTERNAL-ADDRESS and REDACTED-INTERNAL-ADDRESS");
  const survives = `#!/bin/sh\n# heading (#290)\n${addr(8, 8, 8, 8)}`;
  assert.equal(applyReplacementRules(survives, rules), survives,
    "a hash, a heading and a PUBLIC address must all survive -- the first two are what was destroyed");
});

/**
 * THE REPLACEMENT IS TEXT, NOT ANOTHER ADDRESS. Substituting one IP for another (even an RFC 5737
 * documentation address) would still match this same pattern, so the scan used to verify the purge could
 * never read zero — it would be checking its own placeholder.
 */
test("the replacement is not itself IP-shaped, or the verifying scan could never read zero", () => {
  const { rules } = parseReplacementRules(SHIPPED);
  assert.doesNotMatch(rules[0].replacement, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
});

test("the prose lives in docs/, where filter-repo cannot execute it", () => {
  assert.match(DOC, /no comment syntax/i);
  assert.match(DOC, /6,108 commits/, "the incident's own measurement, so the reason survives the fix");
  assert.ok(!SHIPPED.split("\n").some((l) => l.trim().startsWith("#")),
    "a `#` line in the rules file is the defect, not a comment -- docs/history-purge-replacements.md");
});

test("an empty rules file is refused, because a rewrite that changes nothing still reads CLEAN", () => {
  assert.deepEqual(parseReplacementRules("\n  \n").rules, [],
    "and the caller must refuse on that -- a CLEAN scan after a no-op rewrite means nothing");
});
