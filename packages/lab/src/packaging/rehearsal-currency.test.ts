/**
 * `rehearsal-currency.mjs`'s pure decision -- see that file's own header for the row (#813) and the
 * reasoning. `rehearsal-currency-gate.test.ts` proves the COMMAND; this proves the DECISION over injected
 * inputs, the two tiers `docs/proving-a-gate.md` asks for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rehearsalCurrencyProblems, rehearsalMarkerSha } from "./rehearsal-currency.mjs";

const SHA = "8849f92df9903660315d0cdc9037e7e04276eece";
const OTHER_SHA = "f47339e2c1d4a5b6e7f8091a2b3c4d5e6f7a8b9c";

const withMarker = (extra = "") =>
  `Some prose.\n\n<!-- REHEARSAL:COMMIT ${SHA} -->\n\nMore prose.${extra}`;

test("rehearsalMarkerSha reads the exact sha the marker names", () => {
  assert.equal(rehearsalMarkerSha(withMarker()), SHA);
});

test("rehearsalMarkerSha returns null when the marker is absent -- never a guess", () => {
  assert.equal(rehearsalMarkerSha("RELEASE.md with no marker at all"), null);
  assert.equal(rehearsalMarkerSha(null), null);
});

test("#813's own acceptance shape: a matching commit is clean", () => {
  assert.deepEqual(rehearsalCurrencyProblems({ releaseMd: withMarker(), releaseSha: SHA }), []);
});

test("MUTATION TARGET (#813's own mutation): a release commit that is not the marked one is a refusal "
  + "naming BOTH shas", () => {
  const problems = rehearsalCurrencyProblems({ releaseMd: withMarker(), releaseSha: OTHER_SHA });
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(SHA));
  assert.match(problems[0], new RegExp(OTHER_SHA));
});

test("no marker at all is a stronger refusal than a stale one, named as such", () => {
  const problems = rehearsalCurrencyProblems({ releaseMd: "no marker here", releaseSha: SHA });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no rehearsal is on record/);
});

test("an absent RELEASE.md reads the same as no marker -- never a crash on a missing file", () => {
  const problems = rehearsalCurrencyProblems({ releaseMd: null, releaseSha: SHA });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no rehearsal is on record/);
});

test("FAILS CLOSED on an unresolved release commit -- 'could not ask' must never read as 'must be "
  + "current'", () => {
  const problems = rehearsalCurrencyProblems({ releaseMd: withMarker(), releaseSha: null });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /could not resolve/);
});

test("a short sha in either position still compares equal to the full one", () => {
  assert.deepEqual(
    rehearsalCurrencyProblems({ releaseMd: withMarker(), releaseSha: SHA.slice(0, 8) }), []);
});
