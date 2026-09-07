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
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const HISTORY_DOC = "docs/schema-migration-history.md";

/** Every file matching `filter` under `dir`, recursively. Copied from `env-doc-coverage.test.ts`'s
 *  `walk` rather than imported, so the two tests independently agreeing is a fact about the source. */
function walk(dir: string, filter: (name: string) => boolean): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, filter);
    return filter(entry.name) ? [full] : [];
  });
}

const SELF = fileURLToPath(import.meta.url);

/** `.py` alongside `.mjs`/`.ts`/`.js`, because the citation this issue was filed over lives in Python --
 *  `env-doc-coverage.test.ts`'s own `walk` use only reads JS-family files and would not have seen it.
 *
 *  EXCLUDES THIS FILE ITSELF. Both patterns below are regex literals whose SOURCE TEXT contains the exact
 *  shape they are looking for -- a scanner necessarily writes down what it scans for -- so without this
 *  exclusion the file would always report itself as an offender/citation, which is noise no real defect
 *  could ever be told apart from. */
const SOURCE_FILES = [
  ...walk(join(REPO, "packages"), (n) => /\.(mjs|ts|js|py)$/.test(n)),
  ...walk(join(REPO, "scripts"), (n) => /\.(mjs|ts|js|py)$/.test(n)),
].filter((file) => file !== SELF);

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

// Matches the phrasing this row's fix writes at the one real citation
// (`packages/scorer/python/screenreader_features.py`): the doc's path, a possessive, a quoted section
// name, then the word "section". Written apart here so this file's OWN comment does not match its own
// pattern. Quoted so the discovery reads the section name off the citation itself rather than a second,
// hand-kept list of what should be cited.
const HISTORY_CITATION = /docs\/schema-migration-history\.md`?['’]s\s+"([^"]+)"\s+section/g;

test("every cited schema-migration-history.md section actually exists there, and at least one citation exists", () => {
  const historyText = readFileSync(join(REPO, HISTORY_DOC), "utf8");
  const sectionHeadings = new Set(
    [...historyText.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]),
  );
  // Citations name a SECTION, and a heading also carries "(opened ..., closed by ...)" after it -- so a
  // citation of "v18 -> v19" must match a heading that STARTS with that text, not equals it exactly.
  const headingStartsWith = (cited: string) =>
    [...sectionHeadings].some((heading) => heading === cited || heading.startsWith(`${cited} `));

  const citations: { file: string; section: string }[] = [];
  for (const file of SOURCE_FILES) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(HISTORY_CITATION)) {
      citations.push({ file: file.slice(REPO.length), section: match[1] });
    }
  }

  assert.ok(citations.length >= 1,
    `found 0 citation(s) of ${HISTORY_DOC} in source -- either the discovery regex is broken, or the one `
    + "citation this row's fix wrote (packages/scorer/python/screenreader_features.py) was removed");

  const dangling = citations.filter(({ section }) => !headingStartsWith(section));
  assert.deepEqual(dangling, [],
    `these citation(s) name a ${HISTORY_DOC} section that does not exist there -- either the doc's `
    + "heading moved/was deleted, or the citation is stale:\n"
    + dangling.map(({ file, section }) => `  ${file}: "${section}"`).join("\n"));
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
