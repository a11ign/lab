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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADR_DIR = fileURLToPath(new URL("../../../../docs/adr/", import.meta.url));

/** The status word, from whichever of the three formats this ADR happens to use. */
function statusInFile(source: string): string | null {
  const patterns = [
    /^- Status:\s*(.+)$/m,
    /^\*\*Status:?\*\*:?\s*(.+)$/m,
    /^##+\s*Status\s*\n+\s*([^\n.]+)/m,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(source);
    if (found) return found[1].trim();
  }
  return null;
}

/** The first word of a status phrase — "accepted 2026-08-24" and "accepted; judge half proven" agree. */
const word = (status: string) =>
  status.replace(/\*/g, "").split(/[;,.]/)[0].trim().split(/\s+/)[0].toLowerCase();

function indexStatuses(): Map<string, string> {
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  const out = new Map<string, string>();
  for (const row of index.matchAll(/\|\s*\[(\d{4})\]\([^)]+\)\s*\|[^|]*\|\s*([^|]+?)\s*\|/g)) {
    out.set(row[1], row[2].trim());
  }
  return out;
}

const adrFiles = () => readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();

test("every ADR states a status somewhere, in one of the three formats the directory uses", () => {
  const files = adrFiles();
  // VACUITY GUARD: a discovery that finds nothing passes for the wrong reason, which is the defect class
  // this whole file belongs to.
  assert.ok(files.length >= 20, `expected the ADR set, found ${files.length}`);
  for (const file of files) {
    assert.ok(statusInFile(readFileSync(ADR_DIR + file, "utf8")),
      `${file} states no status in any recognised format. An ADR without one cannot be checked against `
      + "the index, which is how seven of them came to contradict it.");
  }
});

test("each ADR's own status agrees with the index — the fact is stated twice and must not drift", () => {
  const fromIndex = indexStatuses();
  assert.ok(fromIndex.size >= 20, `parsed ${fromIndex.size} rows from the index; the regex has drifted`);

  for (const file of adrFiles()) {
    const num = file.slice(0, 4);
    const own = statusInFile(readFileSync(ADR_DIR + file, "utf8"));
    const indexed = fromIndex.get(num);
    assert.ok(indexed, `ADR ${num} exists and the index does not list it`);
    assert.equal(word(own!), word(indexed!),
      `ADR ${num} says "${own}" and docs/adr/README.md says "${indexed}". The index is the authority — it `
      + "carries the qualification the header cannot — so the file is the copy to correct.");
  }
});

test("the index lists no ADR that does not exist, which is the other direction", () => {
  // A row for a deleted ADR is a phantom: it makes the index's count look right while pointing at nothing,
  // and `adr-index.test.ts` pins the COUNT, so a phantom plus a deletion would cancel out.
  const present = new Set(adrFiles().map((f) => f.slice(0, 4)));
  for (const num of indexStatuses().keys()) {
    assert.ok(present.has(num), `the index lists ADR ${num}, which is not in docs/adr/`);
  }
});
