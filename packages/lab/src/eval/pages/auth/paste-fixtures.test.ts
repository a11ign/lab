/**
 * WCAG 3.3.8 Accessible Authentication (Minimum): a login page that blocks paste and one that allows it are a
 * corpus pair, recorded BEFORE any rule exists (a11ign/a11ign#4247, child of #4084 outcome 2).
 *
 * The citation is the Understanding page's own body text, not F109 (whose title is "preventing password or
 * code re-entry in the same format"): "users are prevented from copy and paste operations (as they may rely
 * on standalone/external third party password managers), then the page would fail this criterion unless an
 * alternative is provided" (https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum).
 *
 * ## What the checker says about each page TODAY (the falsifier the rule row must turn)
 *
 * Both pages: 3.3.8 `untested` -- "No assessor in this tool covers this criterion. It is unchecked, not
 * clean." -- because `criterion-coverage.ts` declares 3.3.8 `out-of-scope`, and nothing in `packages/judge`,
 * `packages/cli` or `packages/scorer` reads an `onpaste` handler (the only mention is that note).
 *
 * Measured 2026-10-08 at a11ign/a11ign `ad0732bf2` with `criterionOutcomes` (`packages/judge/src/outcomes.ts`)
 * and an empty rule layer. The CLI itself needs a worker for an HTML page, which the engineer brief bans, and
 * the axe layer could not run on that host (headless Chromium missing `libatk-1.0.so.0`). The reading is
 * therefore a function of the criterion's status alone, identical for both pages -- which is the point: the
 * rule row's Acceptance is "bad: referred; good: no finding", and today the two cannot differ.
 *
 * ## The pair differs in ONE thing
 *
 * `onpaste="return false"` on the password input. The comparison deletes that anchor from the bad page and
 * demands byte equality; it does not normalise anything else, so a second difference (a decoy, a reworded
 * label) fails it instead of being quietly ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const good = readFileSync(join(HERE, "paste-allowed-good.html"), "utf8");
const bad = readFileSync(join(HERE, "paste-blocked-bad.html"), "utf8");

const ONPASTE_ATTRIBUTE = /\sonpaste="([^"]*)"/g;

/** The page with every `onpaste` attribute deleted, and how many there were. */
function withoutOnpaste(html: string): { html: string; removed: string[] } {
  const removed = [...html.matchAll(ONPASTE_ATTRIBUTE)].map((m) => m[1]!);
  return { html: html.replace(ONPASTE_ATTRIBUTE, ""), removed };
}

const passwordInput = (html: string): string | undefined => html.match(/<input\b[^>]*type="password"[^>]*>/)?.[0];

test("the pair differs in the onpaste attribute and in nothing else", () => {
  const stripped = withoutOnpaste(bad);
  assert.equal(stripped.removed.length, 1, "the bad page carries exactly one onpaste attribute to delete");
  assert.equal(stripped.html, good);
});

test("control: a second difference is NOT absorbed by the comparison", () => {
  const decoy = withoutOnpaste(bad.replace("Username", "User name"));
  assert.equal(decoy.removed.length, 1);
  assert.notEqual(decoy.html, good, "a reworded label must fail the byte comparison, or the pair proves nothing");
});

test("the bad page's handler really cancels the paste", () => {
  const [handler] = withoutOnpaste(bad).removed;
  assert.match(handler!, /\breturn\s+false\b|\bpreventDefault\s*\(/);
  assert.match(passwordInput(bad)!, /\sonpaste="/, "the handler sits on the password field, not elsewhere");
});

test("the good page has no paste handler anywhere", () => {
  assert.doesNotMatch(good, /onpaste/i);
  assert.doesNotMatch(good, /addEventListener\(\s*["']paste/i);
  assert.doesNotMatch(good, /<script\b/i);
});

test("both pages have a password input and a username input with autocomplete values set", () => {
  for (const html of [good, bad]) {
    assert.match(passwordInput(html) ?? "", /autocomplete="current-password"/);
    assert.match(html, /<input\b[^>]*type="text"[^>]*autocomplete="username"/);
  }
});
