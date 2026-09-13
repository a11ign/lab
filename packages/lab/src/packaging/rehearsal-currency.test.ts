/**
 * `rehearsal-currency.mjs`'s pure decision -- see that file's own header for the row (#813) and the
 * reasoning. `rehearsal-currency-gate.test.ts` proves the COMMAND; this proves the DECISION over injected
 * inputs, the two tiers `docs/proving-a-gate.md` asks for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rehearsalCurrencyProblems, rehearsalMarkerSha, publishedPackagePaths } from "./rehearsal-currency.mjs";

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

// #1265 replaced #813's marker-EQUALS-release rule, which no committed tree could satisfy, with ancestor
// plus unchanged exercised paths. The two git facts are injected, so each test below states them.
const CURRENT = { releaseMd: withMarker(), releaseSha: OTHER_SHA, isAncestor: true, changedPaths: [] };

// The positive controls for this emptiness are the next two tests: the same input with ONE fact flipped.
test("#1265's acceptance shape: a marker that is an ancestor, with nothing it exercises changed since, "
  + "is clean", () => {
  assert.deepEqual(rehearsalCurrencyProblems(CURRENT), []);
});

test("MUTATION TARGET (#1265): a marker that is NOT an ancestor of the release commit is a refusal naming "
  + "BOTH shas", () => {
  const problems = rehearsalCurrencyProblems({ ...CURRENT, isAncestor: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /NOT an ancestor/);
  assert.match(problems[0], new RegExp(SHA));
  assert.match(problems[0], new RegExp(OTHER_SHA));
});

test("an ancestor marker is still a refusal when an exercised path changed since it, naming every path",
  () => {
  const problems = rehearsalCurrencyProblems({ ...CURRENT, changedPaths: ["README.md", "action.yml"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2 path\(s\)/);
  assert.match(problems[0], /README\.md/);
  assert.match(problems[0], /action\.yml/);
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

test("FAILS CLOSED when ancestry could not be read -- and an OMITTED ancestry reads the same, so a caller "
  + "that forgets to gather it is refused rather than passed", () => {
  const withoutAncestry = { releaseMd: CURRENT.releaseMd, releaseSha: CURRENT.releaseSha, changedPaths: [] };
  for (const input of [{ ...CURRENT, isAncestor: null }, withoutAncestry]) {
    const problems = rehearsalCurrencyProblems(input);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /could not tell whether the rehearsal marker is an ancestor/);
  }
});

test("a diff that could not be taken is its OWN refusal carrying git's reason -- never stated as a changed "
  + "path", () => {
  const problems = rehearsalCurrencyProblems({ ...CURRENT, changedPaths: null, diffError: "fatal: bad object" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /the diff could not be taken: fatal: bad object/);
  assert.doesNotMatch(problems[0], /EXERCISES/, "a change the gate never observed must not be reported as one");
});

test("an OMITTED changed-path list fails closed the same way -- a caller that forgets the diff is refused",
  () => {
  const problems = rehearsalCurrencyProblems(
    { releaseMd: CURRENT.releaseMd, releaseSha: CURRENT.releaseSha, isAncestor: true });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /the diff could not be taken/);
});

test("publishedPackagePaths keeps every package not marked private, and only those", () => {
  // `private: "true"` stays IN: anything short of the boolean counts as published, because over-including
  // only makes the gate refuse more, and the other direction passes a release nobody rehearsed.
  assert.deepEqual(publishedPackagePaths([
    { dir: "cli", manifest: { name: "a11ign" } },
    { dir: "lab", manifest: { name: "@a11ign/lab", private: true } },
    { dir: "odd", manifest: { private: "true" } },
  ]), ["packages/cli/", "packages/odd/"]);
});
