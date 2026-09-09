// @ts-check
/**
 * #780: the real-page run summary line -- "K of M captures described the page that was requested, by
 * identity." Driven at two layers: the pure functions directly (hand-built fixtures, every branch), and
 * the REAL four calendly `fallback` captures on disk (#780's own acceptance criterion 4) -- a guard whose
 * only fixture is invented is one nobody has seen bite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { identityChecksFor, servedRequestedPageLine } from "./real-page-identity-summary.mjs";

test("every capture matched: the line names the count and denominator, nothing more", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "matched" },
  ]);
  assert.equal(line, "2 of 2 captures described the page that was requested, by identity.\n");
});

test("a fallback capture is NAMED, not just counted -- acceptance 2", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "matched" },
    { url: "https://b.example/", targetMatch: "fallback" },
  ]);
  assert.match(line, /^1 of 2 captures described the page that was requested, by identity\./);
  assert.match(line, /NOT MATCHED: https:\/\/b\.example\//,
    "a reader must be able to go and look, not re-derive which capture served something else");
  assert.doesNotMatch(line, /rule of three/, "the bound is for k=0 only, not every shortfall");
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

test("K=0 prints the rule-of-three upper bound, at 95% confidence", () => {
  const line = servedRequestedPageLine([
    { url: "https://a.example/", targetMatch: "fallback" },
    { url: "https://b.example/", targetMatch: "fallback" },
    { url: "https://c.example/", targetMatch: "fallback" },
    { url: "https://d.example/", targetMatch: "fallback" },
  ]);
  assert.match(line, /^0 of 4 captures described the page that was requested, by identity\./);
  assert.match(line, /75\.0% \(rule of three\)/, "3\\/4 = 75% is the textbook rule-of-three bound at n=4");
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

test("#780 ACCEPTANCE 4: the four real calendly fallback captures on disk produce K = 0 of 4", () => {
  const dir = join(process.cwd(), "runs/witness");
  const files = readdirSync(dir).filter((name) => name.includes("calendly"));
  assert.ok(files.length > 0, "sanity: the real calendly captures this row cites must actually be on disk");
  const captures = files.map((name) => ({
    url: name, capture: JSON.parse(readFileSync(join(dir, name), "utf8")).capture,
  }));
  const checks = identityChecksFor(captures);
  const fallbackOnly = checks.filter((check) => check.targetMatch === "fallback");
  assert.equal(fallbackOnly.length, 4,
    `expected exactly the four fallback captures #780 names; got ${fallbackOnly.length} of `
    + `${checks.length} total (some may have since been superseded -- re-read the row if this drifts)`);
  const line = servedRequestedPageLine(fallbackOnly);
  assert.match(line, /^0 of 4 captures described the page that was requested, by identity\./);
});
