/**
 * `rehearsal-currency.mjs`'s pure reading -- see that file's own header for the row (#813), what #3184 changed (a gate became a
 * reading) and why. `rehearsal-currency-gate.test.ts` proves the COMMAND; this proves the READING over injected inputs, the two
 * tiers `docs/proving-a-gate.md` asks for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rehearsalReading, rehearsalMarkerSha, publishedPackagePaths, ageInDays } from "./rehearsal-currency.mjs";

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

// #1265 replaced #813's marker-EQUALS-release rule, which no committed tree could satisfy, with ancestor plus unchanged
// exercised paths. The two git facts are injected, so each test below states them.
const CURRENT = { releaseMd: withMarker(), releaseSha: OTHER_SHA, isAncestor: true, changedPaths: [] as string[] };

// The positive control for the "readable" assertions below is that `readable` is ALSO false in the unreadable tests: the same
// function answers both, so a reading that always said true would fail them.
test("a marker that is an ancestor with nothing exercised changed since reads as ZERO paths, and is readable", () => {
  const reading = rehearsalReading({ ...CURRENT, ageDays: 3 });
  assert.equal(reading.readable, true);
  assert.match(reading.lines[0], /EXERCISES 0 path\(s\)/);
  assert.match(reading.lines[0], /3 day\(s\) old/);
});

test("#3184: 190 exercised paths behind is a READING, readable and naming the count -- never a refusal", () => {
  const changedPaths = Array.from({ length: 190 }, (_, i) => `packages/cli/src/file-${i}.ts`);
  const reading = rehearsalReading({ ...CURRENT, changedPaths, ageDays: 13 });
  assert.equal(reading.readable, true, "a stale marker no longer gates anything, so staleness is not unreadable");
  assert.match(reading.lines[0], /EXERCISES 190 path\(s\)/);
  assert.match(reading.lines[0], /13 day\(s\) old/);
  assert.equal(reading.lines.length, 191, "the first line states the count and every path follows it");
  assert.ok(reading.lines.includes("  packages/cli/src/file-189.ts"));
});

test("a marker that is NOT an ancestor is a readable reading naming BOTH shas, and says so differently", () => {
  const reading = rehearsalReading({ ...CURRENT, isAncestor: false });
  assert.equal(reading.readable, true);
  assert.equal(reading.lines.length, 1);
  assert.match(reading.lines[0], /NOT an ancestor/);
  assert.match(reading.lines[0], new RegExp(SHA));
  assert.match(reading.lines[0], new RegExp(OTHER_SHA));
});

test("an unknown age reads as unknown, never as zero days", () => {
  assert.match(rehearsalReading({ ...CURRENT, ageDays: null }).lines[0], /of unknown age/);
  assert.equal(ageInDays("not a date", Date.now()), null);
  assert.equal(ageInDays(undefined, Date.now()), null);
});

test("ageInDays counts whole days from the committer date, and is never negative", () => {
  const day = 86_400_000;
  const committed = "2026-09-20T12:00:00Z";
  const then = Date.parse(committed);
  assert.equal(ageInDays(committed, then + 13 * day + day / 2), 13);
  assert.equal(ageInDays(committed, then - day), 0, "a clock behind the commit is 0 days, not -1");
});

test("no marker at all is UNREADABLE and says there is no rehearsal on record", () => {
  const reading = rehearsalReading({ releaseMd: "no marker here", releaseSha: SHA });
  assert.equal(reading.readable, false);
  assert.match(reading.lines[0], /no hand rehearsal on record/);
});

test("an absent RELEASE.md reads the same as no marker -- never a crash on a missing file", () => {
  const reading = rehearsalReading({ releaseMd: null, releaseSha: SHA });
  assert.equal(reading.readable, false);
  assert.match(reading.lines[0], /no hand rehearsal on record/);
});

test("an unresolved release commit is UNREADABLE -- 'could not ask' must never read as a clean reading", () => {
  const reading = rehearsalReading({ releaseMd: withMarker(), releaseSha: null });
  assert.equal(reading.readable, false);
  assert.match(reading.lines[0], /could not resolve/);
});

test("unreadable ancestry is UNREADABLE -- and an OMITTED ancestry reads the same, so a caller that forgets to gather it "
  + "gets no reading rather than a clean one", () => {
  const withoutAncestry = { releaseMd: CURRENT.releaseMd, releaseSha: CURRENT.releaseSha, changedPaths: [] };
  for (const input of [{ ...CURRENT, isAncestor: null }, withoutAncestry]) {
    const reading = rehearsalReading(input);
    assert.equal(reading.readable, false);
    assert.match(reading.lines[0], /could not tell whether the rehearsal marker .* is an ancestor/);
  }
});

test("a diff that could not be taken is its OWN unreadable state carrying git's reason -- never stated as a changed path", () => {
  const reading = rehearsalReading({ ...CURRENT, changedPaths: null, diffError: "fatal: bad object" });
  assert.equal(reading.readable, false);
  assert.match(reading.lines[0], /the diff could not be taken: fatal: bad object/);
  assert.doesNotMatch(reading.lines[0], /EXERCISES/, "a change nobody observed must not be reported as one");
});

test("an OMITTED changed-path list is unreadable the same way -- a caller that forgets the diff gets no reading", () => {
  const reading = rehearsalReading({ releaseMd: CURRENT.releaseMd, releaseSha: CURRENT.releaseSha, isAncestor: true });
  assert.equal(reading.readable, false);
  assert.match(reading.lines[0], /the diff could not be taken/);
});

test("publishedPackagePaths keeps every package not marked private, and only those", () => {
  // `private: "true"` stays IN: anything short of the boolean counts as published, because over-including only widens the
  // reading, and the other direction would hide a package a consumer can install.
  assert.deepEqual(publishedPackagePaths([
    { dir: "cli", manifest: { name: "a11ign" } },
    { dir: "lab", manifest: { name: "@a11ign/lab", private: true } },
    { dir: "odd", manifest: { private: "true" } },
  ]), ["packages/cli/", "packages/odd/"]);
});
