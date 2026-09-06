// A ROW WITH NO REGION OR NO ACCEPTANCE COMMAND IS NOT A READY ROW, WHATEVER ELSE IT SAYS.
//
// That rule has not changed; where it is ENFORCED has. It used to be checked against
// `docs/backlog-ready.md`, the markdown pull queue. The tracker moved to GitHub Issues on 2026-09-06 and
// that page is now a signpost, so this file was rewritten rather than deleted: deleting a test along with
// the page it guarded silently drops the property the test was protecting, which is the shape this repo
// keeps paying for.
//
// The property now lives in `.github/ISSUE_TEMPLATE/backlog-row.yml`, which makes the three fields
// REQUIRED rather than requested: the acceptance as a COMMAND so "done" is something the row's own text
// proves rather than something a reviewer judges, the REGION so two sessions do not collide on one file
// (this repo's own near-miss in `capture-probes.mjs` would have manufactured a false WCAG finding), and
// the OPEN-CHECK so nobody is dispatched at work that is already done.
//
// A GAP THIS TEST CANNOT CLOSE, STATED RATHER THAN LEFT IMPLICIT. GitHub enforces a required field in its
// issue FORM, not on the API -- and every issue on this tracker so far was filed through the API, which
// bypasses the form entirely. So the template's `required: true` binds a human filing by hand and binds
// nothing else. Whether the filed issues actually carry those fields is currently maintained by the
// person filing them, and is not machine-checked here: a test that reached the network to find out would
// be a unit test that fails when GitHub is slow, which is a worse trade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const template = () => readFileSync(path.join(REPO, ".github/ISSUE_TEMPLATE/backlog-row.yml"), "utf8");

test("the issue template REQUIRES an acceptance command, a region, and an open-check", () => {
  const text = template();
  // Each field id, and the `required: true` that must follow it before the next field begins.
  for (const [id, why] of [
    ["acceptance", "'done' must be something the row's own text proves, not something a reviewer judges"],
    ["region", "two sessions colliding on one file is how a false finding gets manufactured"],
    ["open-check", "three units were dispatched at closed rows the day before this was required"],
  ] as [string, string][]) {
    const at = text.indexOf(`id: ${id}`);
    assert.ok(at !== -1, `the template has no \`${id}\` field — ${why}`);
    const next = text.indexOf("  - type:", at);
    const block = text.slice(at, next === -1 ? undefined : next);
    assert.match(block, /required: true/,
      `\`${id}\` is in the template but not required — ${why}`);
  }
});

test("the open-check field states the verification basis, which is not HEAD alone", () => {
  // Measured 2026-09-06: three of six seeded rows were already addressed by unmerged branches and every
  // one looked open at HEAD. The basis is origin/main PLUS every unmerged local agent branch.
  const text = template();
  assert.match(text, /origin\/main.*unmerged|unmerged.*origin\/main/s,
    "the open-check guidance must say the basis is origin/main plus unmerged local branches");
  assert.match(text, /region DIFF|region diff/i,
    "claim is derived from the region diff, never from a branch name — only 1 of 6 rows landed under its "
    + "suggested name");
  assert.match(text, /origin\/agent\/\*/,
    "the guidance must warn that origin/agent/* is always empty here, so a check written against it "
    + "answers 'clear' forever");
});

test("the retired queue page is a signpost, not a deletion and not stale content", () => {
  const page = path.join(REPO, "docs/backlog-ready.md");
  assert.ok(existsSync(page),
    "the page was deleted outright; a reader following an old link to a missing file learns nothing");
  const text = readFileSync(page, "utf8");
  assert.match(text, /moved to GitHub/i, "it must say where the queue went");
  assert.doesNotMatch(text, /^### \d+\. /m,
    "it still lists rows. A dead copy that answers questions is worse than two that visibly disagree — "
    + "this page reported the Ready queue as empty when it had eleven rows");
});
