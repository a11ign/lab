/**
 * A closed schema migration must not delete its own reasoning -- #340.
 *
 * `packages/scorer/models/schema-migration.json` is the live TOGGLE: `scripts/check-schema-migration.mjs`
 * reads its PRESENCE as "a migration is open", and closing one means deleting the file in the same commit
 * that promotes the new weights. So a source comment that cites a SPECIFIC KEY inside that file -- naming a
 * field it carried, one migration's worth of reasoning, the exact real shape this row was filed over -- is
 * citing a record that is guaranteed to be gone by the time anyone follows it, and reads identically to a
 * record that never existed. That sent `orchestrator` to a file with nothing in it while re-checking issue
 * #35, and the wrong answer was relayed twice before being corrected.
 *
 * `docs/schema-migration-history.md` is the permanent home instead, one `##` section per closed migration,
 * modelled on `docs/capture-protocol-version-history.md` for the identical reason: never edited or removed,
 * only appended to. This test enforces BOTH halves discovered here, not listed by hand, so a THIRD closed
 * migration that repeats either shape fails on its own rather than needing someone to remember this file.
 */
/**
 * #954: THE CROSS-REFERENCE HALF OF THIS FILE IS OFF THE PULL-REQUEST PATH. `schema-migration-citations`'s rule now runs
 * once a night, in `scripts/doc-cross-reference-report.mjs`, which imports the same module this file
 * does -- so nothing about the rule changed, only when it runs and what a disagreement costs. See #905
 * for the argument and #954 for the retirement, which waited until the first nightly report had posted.
 *
 * WHAT STAYS HERE is what that report does not assert: the rule that no comment cites a specific key (#908's), and the history document's own existence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// #905: the source population and the history-citation rule live in the doc cross-reference check the nightly
// report also runs. The specific-key rule below is #908's and stays here.
import {
  HISTORY_DOC, sourceFiles,
} from "../../../../scripts/doc-checks/schema-migration-citations.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

const SELF = fileURLToPath(import.meta.url);

/** `.py` alongside `.mjs`/`.ts`/`.js`, because the citation this issue was filed over lives in Python.
 *  EXCLUDES THIS FILE ITSELF: the regex literal below writes down the shape it scans for, so without this
 *  exclusion the file would always report itself as an offender. */
const SOURCE_FILES = sourceFiles(REPO, [SELF]);

test("vacuity guard: the source scan finds a non-trivial population", () => {
  assert.ok(SOURCE_FILES.length > 100,
    `only found ${SOURCE_FILES.length} source file(s) -- the walk is probably broken, not the tree shrinking`);
});

test("no source comment cites a SPECIFIC KEY inside schema-migration.json as a permanent record", () => {
  // The exact shape of the bug: `schema-migration.json`'s `<some key>` -- naming a field inside a file this
  // project deletes by design the moment it stops being true. A reference to the FILE ITSELF (as the live
  // toggle `check-schema-migration.mjs` reads) is fine and expected; a reference to one of its FIELDS as
  // "the record" is the thing that cannot survive the close it is describing.
  // The realistic shape closes the markdown span right after `.json` before the possessive -- `schema-
  // migration.json\`'s \`key\`` -- so the backtick there is OPTIONAL in the regex, not absent: a version
  // requiring no backtick there would never match real prose and would pass having examined nothing.
  const CITES_A_SPECIFIC_FIELD = /schema-migration\.json`?['’]s\s+`[^`]+`/;
  const offenders = SOURCE_FILES
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => CITES_A_SPECIFIC_FIELD.test(source))
    .map(({ file }) => file.slice(REPO.length));
  assert.deepEqual(offenders, [],
    `these file(s) cite a specific field inside schema-migration.json, which is deleted the moment the `
    + `migration it describes closes -- point at ${HISTORY_DOC}'s permanent section instead:\n`
    + offenders.map((f) => `  ${f}`).join("\n"));
});

test("the history doc itself exists and is non-trivial", () => {
  const path = join(REPO, HISTORY_DOC);
  assert.ok(existsSync(path), `${HISTORY_DOC} must exist -- it is where a closed migration's reasoning lives`);
  const text = readFileSync(path, "utf8");
  const headings = [...text.matchAll(/^##\s+/gm)];
  assert.ok(headings.length >= 3,
    `only found ${headings.length} section(s) in ${HISTORY_DOC} -- three migrations have closed on this `
    + "repo's own history (v16->v17, v17->v18, v18->v19); fewer than that means an entry went missing");
});
