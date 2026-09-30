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
import { causeDeclarations as A11IGN_CAUSES } from "../../../../.agent-org/plugins/causes.mjs";

test("a11ign's plugin declares exactly TWO causes: `fleet-batch-due` and `lab-job-finished` (N=2, at most 2)", () => {
  assert.deepEqual(A11IGN_CAUSES.map((c: { cause: string }) => c.cause), ["fleet-batch-due", "lab-job-finished"]);
  assert.equal(A11IGN_CAUSES[0].group, "judgment-start");
  // #2729: the second is a JUDGMENT cause and NOT a start one -- it addresses the holder of a claimed row, and a drain
  // stops the org taking on work, not telling a session its job ended.
  assert.equal(A11IGN_CAUSES[1].group, "judgment");
});
