/**
 * A gate that can never pass is one people stop dispatching.
 *
 * `gate:probe-order` counted every PAGE-MOVED page as unexamined, which is right: we know why its evidence
 * differs and still not whether ORDER also mattered, so calling it a pass would be the defect the gate
 * exists to prevent. But `nls.uk/join/` moves EVERY run — its search panel opens when a control is
 * activated, `focusOrder` 10 → 150 — so coverage was permanently short, the verdict permanently
 * INCONCLUSIVE, and the job permanently exit 2. Its first real dispatch answered its question (focus-first
 * is evidence-neutral on all three corpus pages) and still reported failure.
 *
 * A page may now DECLARE it. These assert the declaration is checked in BOTH directions, because a
 * one-way exemption is how a work list comes to lie — the unclosable veto map and `NOT_FOR_CASES` each
 * caught a stale entry on their first run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyMovers } from "../../scripts/gate-probe-order.mjs";

const DECLARED = { url: "https://moves.test/", movesUnderItsOwnProbes: "its search panel opens" };
const PLAIN = { path: "steady-page/good" };

test("an UNDECLARED page that moves still reduces coverage — the rule this was built for", () => {
  const seen = classifyMovers([{ page: "steady-page/good", verdict: "PAGE-MOVED" }], [DECLARED, PLAIN]);
  assert.equal(seen.undeclared.length, 1, "it must still count against coverage");
  assert.equal(seen.expected.length, 0);
});

test("a DECLARED page that moves is out of scope, not unanswered", () => {
  const seen = classifyMovers([{ page: "https://moves.test/", verdict: "PAGE-MOVED" }], [DECLARED, PLAIN]);
  assert.equal(seen.expected.length, 1);
  assert.equal(seen.undeclared.length, 0, "it must not reduce coverage, or the gate can never pass");
});

test("a DECLARED page that does NOT move is reported STALE", () => {
  // The half that stops a declaration becoming a permanent excuse. If the page stops moving, the reason
  // for the exemption has gone and it should be earning its keep again.
  const seen = classifyMovers([{ page: "https://moves.test/", verdict: "SAME" }], [DECLARED, PLAIN]);
  assert.equal(seen.stale.length, 1);
  assert.equal(seen.expected.length, 0);
});

test("the three outcomes are DISTINCT, so no page lands in two of them", () => {
  const seen = classifyMovers([
    { page: "https://moves.test/", verdict: "PAGE-MOVED" },
    { page: "steady-page/good", verdict: "PAGE-MOVED" },
    { page: "other/good", verdict: "SAME" },
  ], [DECLARED, PLAIN, { path: "other/good" }]);
  assert.deepEqual(seen.expected.map((r) => r.page), ["https://moves.test/"]);
  assert.deepEqual(seen.undeclared.map((r) => r.page), ["steady-page/good"]);
  assert.deepEqual(seen.stale, [], "a page that never declared cannot have a stale declaration");
});

test("with no declarations at all, behaviour is exactly what it was", () => {
  // Anti-regression: the escape hatch must not change the default. An undeclared corpus behaves as before.
  const seen = classifyMovers([{ page: "a", verdict: "PAGE-MOVED" }, { page: "b", verdict: "SAME" }],
    [{ path: "a" }, { path: "b" }]);
  assert.equal(seen.undeclared.length, 1);
  assert.equal(seen.expected.length, 0);
  assert.equal(seen.stale.length, 0);
});
