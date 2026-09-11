/**
 * Every ADR is indexed, and the counts quoted in prose match how many there are.
 *
 * A fact stated in three places with nothing comparing them: the files on disk, the index table in
 * `docs/adr/README.md`, and a count written out in English in BOTH `docs/README.md` and `CLAUDE.md`. Adding
 * ADR 0016 found all three already disagreeing — the prose said 15 while 15 files existed and a 16th was
 * being added, so the number was right by accident and about to be wrong.
 *
 * This is the repo's own recurring shape, and its own remedy: when a copy cannot be deleted, pin the copies
 * equal with a test. An unindexed ADR is worse than a stale number — the index is how anyone finds these,
 * so a decision missing from it is a decision nobody will read before re-litigating it.
 */
/**
 * #954: THE CROSS-REFERENCE HALF OF THIS FILE IS OFF THE PULL-REQUEST PATH. `adr-index`'s rule now runs
 * once a night, in `scripts/doc-cross-reference-report.mjs`, which imports the same module this file
 * does -- so nothing about the rule changed, only when it runs and what a disagreement costs. See #905
 * for the argument and #954 for the retirement, which waited until the first nightly report had posted.
 *
 * WHAT STAYS HERE is what that report does not assert: the ADR counts written out in English in two documents (#907's half of this file).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// #905: the index rule lives in the doc cross-reference check the nightly report also runs -- one copy.
import { adrFiles as adrFilesIn } from "../../../../scripts/doc-checks/adr-index.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** The ADR files themselves — the only source of truth here; everything else is a copy of this. */
const adrFiles = (): string[] => adrFilesIn(REPO);

test("the counts quoted in prose match how many ADRs there are", () => {
  // Written out in English in two documents, neither of which is generated. Both said 15 while 16 existed.
  const n = adrFiles().length;
  for (const [path, pattern] of [
    ["docs/README.md", /(\d+) architecture decision records/],
    ["CLAUDE.md", /for the (\d+) decision records/],
  ] as const) {
    const found = readFileSync(`${REPO}${path}`, "utf8").match(pattern);
    assert.ok(found, `${path} no longer states an ADR count in the expected wording — this guard went blind`);
    assert.equal(Number(found[1]), n, `${path} says ${found[1]} ADRs; there are ${n}`);
  }
});
