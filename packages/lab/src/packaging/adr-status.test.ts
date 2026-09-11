/**
 * EACH ADR'S OWN STATUS MUST AGREE WITH THE INDEX THAT SUMMARISES IT.
 *
 * Seven said `Status: Proposed` in the file while `docs/adr/README.md` called them accepted — ADRs 0001
 * and 0003–0008, which between them are the package split, the workspace build, the release mechanism and
 * the licence split. All four are not merely accepted, they are the shape of the repository. Found
 * 2026-09-05 by an external architecture audit; `adr-index.test.ts` pins presence and COUNT, never status.
 *
 * ## Why it drifted, and it is not carelessness
 *
 * There are THREE formats in the directory, so no single grep sees them all:
 *
 *   `- Status: X`       ADRs 0001-0008
 *   `**Status:** X`     ADRs 0009-0011, 0015-0024
 *   `## Status\n\nX.`   ADRs 0012-0014
 *
 * A fact stated twice, in two files, in three shapes, with nothing comparing them. This test reads all
 * three rather than mandating one: forcing a format would be a large diff over the actual defect, and the
 * shape a document uses is not the fact worth pinning — the STATUS is.
 *
 * ## The index is the authority
 *
 * It carries the qualification the file cannot: "accepted; judge half substantially proven", "proposed,
 * not implemented — the wake gate passed; the power draw is unmeasured". Those are the honest states, and
 * an ADR whose own header contradicts them is the copy that is wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
// #905: the rule lives in the doc cross-reference check the nightly report also runs -- one copy.
import { adrFiles } from "../../../../scripts/doc-checks/adr-index.mjs";
import {
  adrsMissingFromIndex, adrsWithNoStatus, indexStatuses, phantomIndexRows, statusDisagreements,
} from "../../../../scripts/doc-checks/adr-status.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

test("every ADR states a status somewhere, in one of the three formats the directory uses", () => {
  const files = adrFiles(REPO);
  // VACUITY GUARD: a discovery that finds nothing passes for the wrong reason, which is the defect class
  // this whole file belongs to.
  assert.ok(files.length >= 20, `expected the ADR set, found ${files.length}`);
  assert.deepEqual(adrsWithNoStatus(REPO), [],
    "these ADRs state no status in any recognised format. An ADR without one cannot be checked against "
    + "the index, which is how seven of them came to contradict it.");
});

test("each ADR's own status agrees with the index — the fact is stated twice and must not drift", () => {
  const fromIndex = indexStatuses(REPO);
  assert.ok(fromIndex.size >= 20, `parsed ${fromIndex.size} rows from the index; the regex has drifted`);
  assert.deepEqual(adrsMissingFromIndex(REPO), [], "these ADRs exist and the index does not list them");
  assert.deepEqual(statusDisagreements(REPO), [],
    "each ADR's own status must match docs/adr/README.md's. The index is the authority — it carries the "
    + "qualification the header cannot — so the file is the copy to correct.");
});

test("the index lists no ADR that does not exist, which is the other direction", () => {
  // A row for a deleted ADR is a phantom: it makes the index's count look right while pointing at nothing,
  // and `adr-index.test.ts` pins the COUNT, so a phantom plus a deletion would cancel out.
  assert.deepEqual(phantomIndexRows(REPO), [], "the index lists ADR(s) not in docs/adr/");
});
