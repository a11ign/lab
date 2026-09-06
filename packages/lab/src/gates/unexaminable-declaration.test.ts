/**
 * A DECLARED-UNEXAMINABLE PAGE LEAVES THE DENOMINATOR. This file is what stops that becoming a way to
 * launder a failure into a pass.
 *
 * `83 of 85` is INCONCLUSIVE for ever if two of the 85 can never be examined, which tells a reader nothing
 * and blocks everything downstream on a number that cannot move. `83 of 83, with 2 declared` is a
 * conclusive statement about what was examined PLUS an honest statement about what was not — the same
 * distinction `rule-ownership.json` draws with `decidedBy: "unavailable"`, for the same reason: "nobody"
 * and "somebody forgot" must never be the same state.
 *
 * Every suppression list this project has considered fails the same way — it accumulates entries nobody
 * re-reads, and the thing it suppresses stops being visible. Four properties are what make this one
 * different, and each is asserted below:
 *
 *   1. every entry states a REASON, or it is a suppression rather than a declaration
 *   2. every entry states what REMOVES it, or it is permanent wearing temporary's clothes
 *   3. the gate PRINTS every entry on every run, so it cannot sit here unread
 *   4. an UNDECLARED unusable page still reduces coverage — the declaration removes a page from the
 *      denominator, never a finding, and never applies to a page nobody wrote a reason for
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DECLARATION = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../baselines/real-page-unexaminable.json", import.meta.url)), "utf8")) as {
    why?: string; pages?: Record<string, { reason?: string; removedWhen?: string; declaredAt?: string }> };

const GATE = readFileSync(
  fileURLToPath(new URL("../../scripts/check-real-page-findings.ts", import.meta.url)), "utf8");

test("every declared page states a REASON and what REMOVES it", () => {
  const pages = Object.entries(DECLARATION.pages ?? {});
  // Vacuity guard: an empty declaration would pass this loop having checked nothing. Empty is a legitimate
  // state — it is the state we want — so it is asserted as a distinct outcome rather than allowed to
  // masquerade as a clean run of the loop below.
  if (pages.length === 0) {
    assert.ok(true, "no page is declared unexaminable, which is the state to aim for");
    return;
  }
  for (const [url, entry] of pages) {
    assert.equal(typeof entry?.reason, "string",
      `${url} is excluded from the denominator with no reason — that is a suppression, not a declaration`);
    assert.ok((entry.reason ?? "").length > 40,
      `${url}'s reason is too short to be one. It must say what the tool could not do and why, in enough `
      + "words that somebody who did not write it can check whether it is still true.");
    assert.equal(typeof entry?.removedWhen, "string",
      `${url} states no condition that removes it, so it is a PERMANENT exclusion wearing a temporary `
      + "one's clothes — the failure mode of every suppression list this project has considered");
    assert.equal(typeof entry?.declaredAt, "string", `${url} does not say WHEN it was declared`);
  }
});

test("the gate PRINTS every declaration, so an exclusion cannot sit unread", () => {
  assert.match(GATE, /DECLARED unexaminable, and therefore not in the/,
    "the gate must announce the exclusions it applied");
  assert.match(GATE, /why: \$\{entry\.reason\}/,
    "printing the URL alone reproduces the count-with-no-identity defect — the reason must print too");
  assert.match(GATE, /removed when: \$\{entry\.removedWhen\}/,
    "and the exit condition, or a reader cannot tell a scheduled exclusion from an abandoned one");
});

test("a declaration for a page that IS examinable says so, rather than quietly shrinking the denominator", () => {
  // The anti-stale half. Once the `sameDocument` fix lands these two become examinable, and a declaration
  // nobody removes would silently keep taking them out of the denominator for ever — the exact way a
  // temporary exclusion becomes a permanent one without anybody deciding to make it one.
  assert.match(GATE, /declared, but examinable in THIS run — remove it/,
    "a declaration that no longer applies must be reported, not silently honoured");
});

test("only pages actually unusable in THIS run leave the denominator", () => {
  // Property 4, and the one that stops this laundering anything: `declaredHere` is the INTERSECTION of the
  // declared set with the pages this run found unusable. A declared page that was examined stays in the
  // denominator and is reported above; an unusable page that is NOT declared comes off `examined` alone
  // and therefore still shows as a shortfall.
  assert.match(GATE, /\.filter\(\(url\) => declared\.has\(url\)\)/,
    "the exclusion must be the intersection with what was actually unusable, never the declared list "
    + "applied wholesale");
  assert.match(GATE, /of: pages - declaredHere\.length/,
    "the denominator must be reduced by the pages excluded HERE, not by the size of the declaration file");
});

test("a missing declaration file makes the gate STRICTER, never more permissive", () => {
  assert.match(GATE, /if \(!existsSync\(path\)\) return out;/,
    "an absent or unreadable declaration must yield an EMPTY set, so every unusable page counts as a "
    + "shortfall — a gate that gets weaker when a file goes missing is one a deleted file can silence");
});
