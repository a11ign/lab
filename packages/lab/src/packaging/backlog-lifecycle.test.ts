/**
 * `docs/backlog.md`'s OWN STATED LIFECYCLE MUST MATCH WHAT IT ACTUALLY DOES.
 *
 * Until 2026-09-06 the page's "How an item leaves this page" section said "Delete the row" while 51 closed
 * rows sat here, struck through and kept — not a stray one or two, the entire population of closed rows.
 * That mismatch was not cosmetic: a reader cannot tell a live row from a closed one at a glance when the
 * page's own rule says the closed ones should not be there, and it was the mechanism behind five stale
 * dispatches in one day (three of `dispatcher`'s, two of `orchestrator`'s).
 *
 * THE DECISION, argued rather than assumed: keep closed rows, struck through, with their disposition
 * stated inline — matching what `orchestrator` had already decided for the architecture-audit section
 * specifically ("the bullets record what was FOUND, the status box records what happened to each, and
 * striking them destroys the first record to fix the second") and what `known-gaps.md`/`not-working.md`/
 * the FROZEN `architecture-audit.md` already do for the identical reason. It costs page length; that cost
 * is accepted because the tracker moved to GitHub Issues, so this page's remaining job is to be a truthful
 * RECORD of what was found and how it was resolved, not a lean queue.
 *
 * THIS TEST HOLDS BOTH HALVES TO EACH OTHER, so they cannot drift apart silently a second time:
 *
 *   1. Every struck-through row states a real disposition on the SAME line — not merely present, but
 *      naming what happened to it. A row struck with no stated outcome would be exactly the shape this
 *      page's own header already condemns ("closed is spelled fourteen ways" is fine; closed and UNSTATED
 *      is not).
 *   2. The page's own "How an item leaves this page" text says to KEEP a closed row, never to delete one
 *      as the default — so a future edit reverting the words without touching the 50+ rows recreates the
 *      exact contradiction this test exists to catch.
 *
 * The disposition vocabulary below was extracted empirically, not guessed: every one of the 51 struck rows
 * on the day this was written carries at least one of these words on its own line, checked before writing
 * the assertion rather than assumed from a handful of examples.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKLOG_PATH = `${REPO}docs/backlog.md`;
const BACKLOG = readFileSync(BACKLOG_PATH, "utf8");

/** Every line carrying at least one `~~struck~~` span, in document order. */
function struckLines(text: string): string[] {
  return text.split("\n").filter((line) => line.includes("~~"));
}

const STRUCK = struckLines(BACKLOG);

test("VACUITY GUARD -- at least 40 struck-through rows exist to check", () => {
  // 51 measured 2026-09-06. A floor, not an exact pin, because this page grows as more findings close --
  // pinning the count exactly would make an ordinary new closure a spurious failure here. Below 40 means
  // the split-and-filter broke (0 would mean it examined nothing), not that rows were tidied away by hand.
  assert.ok(STRUCK.length >= 40,
    `found ${STRUCK.length} struck-through line(s), expected at least 40 -- either rows were deleted by `
    + "hand (contradicting the rule this test enforces) or the discovery broke and is examining nothing");
});

/**
 * Words this page already uses, on the SAME line as a strike, to say what happened to a closed row.
 * Extracted from all 51 real rows before writing this assertion, not from a handful of examples --
 * "BUILT" and "BLOCKED" earn their place here because a naive CLOSED/FIXED/REFUTED/DONE/DECIDED list
 * missed one real row apiece on the first pass.
 */
const DISPOSITION_MARKER = /\b(CLOSED|FIXED|REFUTED|DONE|DECIDED|COMPLETE|ALREADY EXISTS|BLOCKED|CORRECTED|MEASURED|BUILT)\b/i;

test("every struck-through row states its own disposition on the same line", () => {
  const undispositioned = STRUCK.filter((line) => !DISPOSITION_MARKER.test(line));
  assert.deepEqual(undispositioned.map((l) => l.slice(0, 120)), [],
    "the line(s) above strike through a finding with no disposition word on the same line -- a closed row "
    + "must say WHAT happened to it (CLOSED, FIXED, REFUTED, DECIDED, or similar), or a reader cannot tell "
    + "a resolved row from one someone struck through by accident");
});

/** The lifecycle section's own text -- refuses rather than silently examining "" if the heading moves. */
function lifecycleSection(text: string): string {
  const start = text.indexOf("## How an item leaves this page");
  assert.ok(start !== -1, "\"## How an item leaves this page\" heading not found in docs/backlog.md -- "
    + "has this section been renamed, moved, or removed? If removed deliberately, delete this test too.");
  return text.slice(start);
}

const LIFECYCLE = lifecycleSection(BACKLOG);

test("the page's stated rule says KEEP a closed row, matching what it actually does", () => {
  assert.match(LIFECYCLE, /\bKEEP\b/i,
    "\"How an item leaves this page\" no longer tells a reader to keep a closed, struck-through row -- if "
    + "the policy changed back to delete-on-close, this test and the 50+ kept rows above disagree with it "
    + "and one of them is now wrong");
});

test("the page's stated rule does not instruct blanket deletion of a closed row", () => {
  // The OLD, contradicted rule started the section with exactly this imperative. A future edit that
  // reintroduces it while the struck rows remain recreates the mismatch this whole file exists to prevent.
  assert.doesNotMatch(LIFECYCLE, /^Delete the row/m,
    "\"How an item leaves this page\" opens by instructing deletion of a closed row again -- either the "
    + "51+ struck-through rows on this page must actually be deleted to match it (a real, disruptive "
    + "change -- coordinate before making it), or this reverted edit is the mistake, not the rows");
});
