/**
 * #2623 part 5: the a11ign-plugin-specific half of `project-roles.test.ts`'s cause-classification claim.
 * `causeDeclarations` from `.agent-org/plugins/causes.mjs` is a11ign's OWN project cause, not tool code, so
 * this assertion has no reason to travel with `agent-org` when it leaves for its own repository -- unlike
 * the rest of `project-roles.test.ts`, which pins the tool's generic cause machinery (`cause-shape.mjs`,
 * `cause-declaration.mjs`) and does travel. Split rather than deleted, so the plugin's own shape stays
 * pinned somewhere.
 *
 * Deliberately spells the group as the literal `"judgment-start"` rather than importing
 * `GROUPS.JUDGMENT_START` off the tool's own cause-shape module: importing it would make
 * `travellingLabTestFiles()` classify this file as travelling by its import-based heuristic, reintroducing
 * the exact outward edge this split exists to remove.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { declareCause, GROUPS } = await toolModule("src/cause-shape.mjs");
import { causeDeclarations as A11IGN_CAUSES } from "../../../../.agent-org/plugins/causes.mjs";
import { toolModule } from "../../../../scripts/agent-org-newest-tag.mjs";

test("a11ign's plugin declares exactly TWO causes: `fleet-batch-due` and `lab-job-finished` (N=2, at most 2)", () => {
  assert.deepEqual(A11IGN_CAUSES.map((c: { cause: string }) => c.cause), ["fleet-batch-due", "lab-job-finished"]);
  assert.equal(A11IGN_CAUSES[0].group, "judgment-start");
  // #2729: the second is a JUDGMENT cause and NOT a start one -- it addresses the holder of a claimed row, and a drain
  // stops the org taking on work, not telling a session its job ended.
  assert.equal(A11IGN_CAUSES[1].group, "judgment");
});

// #2975: the plugin is plain data with NO import (the host's gate loads it from a tree that has run no `pnpm install`), so nothing at
// load time runs `declareCause`'s refusals. This is where they run: each entry must be exactly what the real `declareCause` returns for
// its own fields, and its group must be one of the tool's `GROUPS` -- a typo in a literal fails here, not by dropping a cause silently.
test("every plugin entry is exactly what the tool's own `declareCause` returns for it", () => {
  assert.ok(A11IGN_CAUSES.length > 0, "the control: there are entries to check");
  for (const entry of A11IGN_CAUSES) {
    assert.ok(Object.values(GROUPS).includes(entry.group), `${entry.cause}: ${entry.group} is not one of the tool's groups`);
    assert.deepEqual(entry, declareCause(entry.cause, entry.group, entry.profile));
  }
});
