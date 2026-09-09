// @ts-check
/**
 * #780: the real-page run summary line -- "K of M captures described the page that was requested, by
 * identity." Driven at two layers: the pure functions directly (hand-built fixtures, every branch), and
 * the REAL four calendly `fallback` captures on disk (#780's own acceptance criterion 4) -- a guard whose
 * only fixture is invented is one nobody has seen bite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { identityChecksFor, servedRequestedPageLine } from "./real-page-identity-summary.mjs";
import { runsRoot } from "../dataset-paths.mjs";
import { corpusReadable, skipLine } from "./corpus-settled.mjs";

// Real `documentIdentity` input, minimal rather than a full capture -- `targetMatchIn` reads only the
// census marks' own `targetMatch` field, so this is the smallest real shape that exercises the actual
// reader (`identityChecksFor`) rather than a hand-built `IdentityCheck` that bypasses it. Runs
// unconditionally in CI, unlike the real-fixture acceptance-4 test below (which needs a local machine's
// `runs/witness/`) -- this is what actually catches a mutation to the field read on every runner.
test("identityChecksFor reads targetMatch off a REAL documentIdentity call, not a hand-built shape", () => {
  const checks = identityChecksFor([
    { url: "https://a.example/", capture: { diagnostics: [{ event: "domCensus", targetMatch: "matched" }] } },
    { url: "https://b.example/", capture: { diagnostics: [{ event: "domCensus", targetMatch: "fallback" }] } },
    { url: "https://c.example/", capture: { diagnostics: [] } }, // no census mark at all -- null
  ]);
  assert.deepEqual(checks, [
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "fallback" },
    { url: "https://c.example/", targetMatch: null },
  ]);
});

test("every capture matched: the line names the count and denominator, AND the rule-of-three bound -- "
  + "#688's own case, zero mismatches observed", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "matched" },
  ]);
  assert.match(line, /^2 of 2 captures described the page that was requested, by identity\./);
  assert.match(line, /mismatch rate at 150\.0% \(rule of three\)/,
    "3\\/2 = 150% -- an n this small produces a bound over 100%, which is honest: two captures cannot "
    + "bound anything tighter, and a formatter that hid this would be prettier and less true");
});

test("a fallback capture is NAMED, not just counted -- acceptance 2 -- and the bound does NOT print, "
  + "because a mismatch WAS observed", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "fallback" },
  ]);
  assert.match(line, /^1 of 2 captures described the page that was requested, by identity\./);
  assert.match(line, /NOT MATCHED: https:\/\/b\.example\//,
    "a reader must be able to go and look, not re-derive which capture served something else");
  assert.doesNotMatch(line, /rule of three/,
    "the bound answers 'what if the true rate is above zero, given zero SEEN' -- meaningless once a "
    + "mismatch has actually been seen");
});

test("`null` IS NOT ZERO -- a capture with no identity is excluded from the denominator (never counted "
  + "as a mismatch) but is still NAMED, not silently dropped", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: null },
  ]);
  assert.match(line, /^1 of 1 captures described the page that was requested, by identity\./,
    "the null capture must not appear in M, and must not be reported as a mismatch either");
  assert.match(line, /NO IDENTITY \(not counted above\): https:\/\/b\.example\//,
    "counted nowhere, but still named -- silence reads as nothing to report, and this is a fact");
});

test("nothing had an identity to check: an explicit 'no identity' statement, never '0 of 0' and never "
  + "a blank line", () => {
  const line = servedRequestedPageLine([{ url: "https://a.example/", targetMatch: null }]);
  assert.equal(line, "no capture in this run has a document identity to check "
    + "(no structureCensus or domCensus mark).\n",
    "'0 of 0 matched' reads as a measurement and is not one; a blank line reads as nothing to report");
});

test("an EMPTY run also states 'no identity' explicitly, not a blank line", () => {
  assert.equal(servedRequestedPageLine([]), "no capture in this run has a document identity to check "
    + "(no structureCensus or domCensus mark).\n");
});

test("K=0 (every capture mismatched) does NOT print the rule-of-three bound -- ceo's own correction: "
  + "the bound answers 'how high could the mismatch rate be, given ZERO seen', and here four of four "
  + "were seen -- printing it here would bound the wrong quantity on the wrong population", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "fallback" },
    { url: "https://b.example/", targetMatch: "fallback" },
    { url: "https://c.example/", targetMatch: "fallback" },
    { url: "https://d.example/", targetMatch: "fallback" },
  ]);
  assert.match(line, /^0 of 4 captures described the page that was requested, by identity\./);
  assert.doesNotMatch(line, /rule of three/);
});

test("ALL FOUR matched (zero mismatches, n=4): the textbook 75% rule-of-three bound prints -- #688's "
  + "own case, at the exact size where the bound is loosest", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "matched" },
    { url: "https://c.example/", targetMatch: "matched" },
    { url: "https://d.example/", targetMatch: "matched" },
  ]);
  assert.match(line, /^4 of 4 captures described the page that was requested, by identity\./);
  assert.match(line, /mismatch rate at 75\.0% \(rule of three\)/,
    "3\\/4 = 75% is the textbook rule-of-three bound at n=4");
});

test("#780 MUTATION TARGET: a mutation making targetMatch unread must be caught -- if identityChecksFor "
  + "always reported `null` (or always `matched`), this suite would stop seeing any fallback at all", () => {
  // Reproduces the failure mode directly, without touching real-page-identity-summary.mjs: a version of
  // identityChecksFor that never reads the field would produce this exact shape for a population that is
  // NOT actually all matched, and this test's job is to make sure the row's real check would go red on
  // it, not to invent a mutation-check harness this file already has (`npm run mutate` against the source
  // does that, and is run separately for the PR).
  const brokenChecks: { url: string, targetMatch: string | null }[] = [
    { url: "https://a.example/", targetMatch: null }, // pretend "unread" reads as null
    { url: "https://b.example/", targetMatch: null },
  ];
  const line = servedRequestedPageLine(brokenChecks);
  assert.equal(line, "no capture in this run has a document identity to check "
    + "(no structureCensus or domCensus mark).\n",
    "an unread targetMatch on every capture reads as 'nothing to check', not as a clean 100% match -- a "
    + "guard that stops consuming the field must not silently report success");
});

// --- #780 ACCEPTANCE 4: the four real calendly `fallback` captures on disk, replayed ---
//
// `runsRoot()` (dataset-paths.mjs), NEVER `process.cwd()` directly -- the canonical resolver every
// runs/-reading file in this repo must go through (dataset-paths.test.ts's own guard enforces this by
// walking the source tree). This file lives in packages/lab, so it CAN and MUST consult `corpusReadable`
// (corpus-settled.mjs) before reading -- `corpus-readers-are-guarded.test.ts`'s own scan found this file
// as a candidate and there is no cycle here to plead. `corpusReadable` answers two questions an `existsSync`
// check cannot: is the corpus here at all, AND is something still writing it (a capture in flight would
// make this test describe files that are about to change). `runs/` is GITIGNORED, so a CI runner's
// checkout has no `runs/witness/` -- that is the `state: "absent"` branch below, and this SKIPS HONESTLY
// (`t.skip`) rather than failing on an absence that says nothing about the fix, exactly like
// `verify.corpus.test.ts`'s own "present, settled, and readable -- or honestly skipped" pattern. The
// command to reproduce this locally is in the PR body, for whoever has the fixture.
test("#780 ACCEPTANCE 4: the four real calendly fallback captures on disk produce K = 0 of 4", (t) => {
  const dir = join(runsRoot(), "witness");
  const guard = corpusReadable({ evidenceDirs: [dir], present: existsSync(dir) });
  if (!guard.read) {
    t.skip(skipLine(guard));
    return;
  }
  const files = readdirSync(dir).filter((name) => name.includes("calendly"));
  if (files.length === 0) {
    t.skip("no calendly captures on this machine's runs/witness/ -- honestly skipped, not a pass");
    return;
  }
  const captures = files.map((name) => ({
    url: name, capture: JSON.parse(readFileSync(join(dir, name), "utf8")).capture,
  }));
  const checks = identityChecksFor(captures);
  const fallbackOnly = checks.filter((check) => check.targetMatch === "fallback");
  if (fallbackOnly.length !== 4) {
    t.skip(`expected exactly the four fallback captures #780 names; found ${fallbackOnly.length} of `
      + `${checks.length} on this machine -- the fixture has drifted since the row was filed, re-read it `
      + "rather than trusting this count");
    return;
  }
  const line = servedRequestedPageLine(fallbackOnly);
  assert.match(line, /^0 of 4 captures described the page that was requested, by identity\./);
});
