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
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ADR_DIR = `${REPO}docs/adr/`;

/** The ADR files themselves — the only source of truth here; everything else is a copy of this. */
function adrFiles(): string[] {
  return readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
}

test("every ADR file appears in the index", () => {
  const files = adrFiles();
  assert.ok(files.length >= 15, `only ${files.length} ADR files found; the discovery is broken`);

  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  const missing = files.filter((f) => !index.includes(f));
  assert.deepEqual(missing, [],
    "these ADRs are not in docs/adr/README.md, so nobody will find them before re-arguing the decision");
});

test("the index lists nothing that does not exist", () => {
  // The other direction: a renamed or deleted ADR leaves a dead link, and a dead link in the one document
  // that exists to be an index is worse than a missing row.
  const index = readFileSync(`${ADR_DIR}README.md`, "utf8");
  const files = new Set(adrFiles());
  const linked = [...index.matchAll(/\((?:\.\/)?(\d{4}-[a-z0-9-]+\.md)\)/g)].map((m) => m[1]);
  assert.ok(linked.length >= 15, `only ${linked.length} ADR links parsed out of the index — the table shape changed`);
  assert.deepEqual([...new Set(linked)].filter((f) => !files.has(f)), [], "the index links an ADR that does not exist");
});

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
