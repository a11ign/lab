/**
 * "Stale" means two different things and they print identically.
 *
 * On the lab, a stale count is hours of fleet time. On a developer's machine it usually means `runs/` — which
 * is gitignored, so only ever as fresh as its last sync — is behind the case definitions.
 *
 * Measured 2026-08-23 at the same commit: `242 uncaptured, 860 stale` locally, `0 and 0` on the lab. The
 * corpus was complete. Acting on the local number meant planning a 2–3 hour recapture of finished work, and
 * pushing with the pre-push verification overridden because it "failed".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { unsyncedCorpusHint } from "./check-signals.mjs";

const counts = (uncaptured: number, stale: number) =>
  ({ "NO CAPTURES": uncaptured, "STALE CAPTURES": stale });

test("a complete corpus says so plainly, with no hedging", () => {
  const out = unsyncedCorpusHint(counts(0, 0));
  assert.match(out, /Every case has evidence/);
  assert.doesNotMatch(out, /out of date/, "a clean result must not raise a doubt that does not apply");
});

test("an incomplete one names BOTH readings, and does not choose between them", () => {
  // Nothing on this machine can see the lab, so the hint must not assert which case applies. Guessing
  // wrongly in either direction is worse than the ambiguity: "your copy is stale" would excuse a real
  // recapture, and "recapture needed" is what cost the afternoon.
  const out = unsyncedCorpusHint(counts(242, 860));
  assert.match(out, /1102 case\(s\)/, "the number is the point — a word cannot tell you 2 from 200");
  assert.match(out, /genuinely needs capturing/);
  assert.match(out, /out of date/);
  assert.match(out, /lab:job -- -e job=check-signals/, "it must name the command that settles it");
});

test("either count alone is enough to raise it", () => {
  // They are separate verdicts and either one on its own means the same thing here: this machine cannot
  // answer the question it was asked.
  assert.match(unsyncedCorpusHint(counts(5, 0)), /5 case\(s\)/);
  assert.match(unsyncedCorpusHint(counts(0, 5)), /5 case\(s\)/);
});
