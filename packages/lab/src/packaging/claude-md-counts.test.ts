/**
 * NUMBERS CLAUDE.md STATES ABOUT ARTEFACTS, pinned the same way `asserting-subtypes.test.ts` pins the
 * rules-owned/asserting counts: extract the number CURRENTLY in the prose with an anchored regex, assert
 * the regex actually matched something (an unmatched regex is a silent pass, not a clean one), then
 * compare against a value derived live from the artefact the sentence is about.
 *
 * This is deliberately NOT a generated or marker-based doc. `commands-documented.test.ts` settled that
 * question for the adjacent problem of documenting npm scripts: CLAUDE.md's prose is hand-written
 * narrative, read "in the context of the problem it solves", and templating it would trade a document
 * worth reading for a document worth grepping. The same reasoning applies to a number in a sentence — the
 * sentence is not a caption for a table the test could regenerate, it is prose a person reads once and
 * trusts. So this test is a second copy in the sense that it duplicates the derivation, never in the
 * sense that it duplicates the wording: nothing here writes CLAUDE.md, and no fixed string is retyped
 * from it — only a number, extracted, gets compared to a number computed independently.
 *
 * ONLY the counts that are genuinely DERIVABLE from a checked-in artefact are pinned here. CLAUDE.md
 * states plenty of other numbers this file does not touch, and each was excluded for a specific reason:
 *   - measurements from real captures ("18 conformant real pages", "86 conformant real pages", corpus
 *     sizes, timing figures) depend on the gitignored `runs/` corpus and are not reproducible from what
 *     is checked in
 *   - one-off incidents told in the past tense ("a commit of mine once swept up 19 files, 16 of them...")
 *     are a record of what happened, not a claim about the repo's current shape
 *   - "Twelve EdgeUpdate policies" names a fact about Microsoft's own documented policy list, not
 *     something this repo's ansible defaults encode as a count to check against
 * A small guard that holds beats a large one that gets disabled — see the module doc on
 * `asserting-subtypes.test.ts` for the same argument made about membership rather than counts.
 *
 * TRAP CHECKED AND FOUND NOT TO APPLY: CLAUDE.md keeps superseded claims either struck through (`~~…~~`,
 * used exactly once in the whole file, nowhere near a number pinned here) or narrated in the past tense
 * ("this paragraph used to say…", "this section used to claim…") — and in every instance the superseded
 * wording differs from the current sentence rather than repeating it verbatim. So anchoring each regex to
 * the CURRENT sentence's own distinctive wording is sufficient: a struck-through or "used to say" copy of
 * an old figure is worded differently and cannot satisfy these patterns by construction. Re-check this
 * reasoning if a future edit ever reintroduces one of these exact phrasings as a superseded quote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { workerNamesFromInventory } from "@a11y-witness/worker-fleet/fleet-env";
import { WORKER_FILES } from "../../../nvda-worker/src/worker-files.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const doc = readFileSync(join(REPO, "CLAUDE.md"), "utf8");

const WORD_FOR_COUNT = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN",
  "NINETEEN", "TWENTY"];

test("CLAUDE.md's ADR count matches docs/adr/", () => {
  const stated = doc.match(/for the (\d+) decision records/);
  assert.ok(stated, "CLAUDE.md must state the ADR count as `for the N decision records`");

  // README.md is the index docs/adr/ ships alongside the records, not a decision itself.
  const files = readdirSync(join(REPO, "docs/adr")).filter((f) => f.endsWith(".md") && f !== "README.md");
  assert.ok(files.length > 10, `only found ${files.length} ADRs — docs/adr/ likely resolved to the wrong path`);

  assert.equal(Number(stated[1]), files.length, "CLAUDE.md's decision-record count is stale");
});

// Reads inventory.example.yml, deliberately -- the real inventory.yml is gitignored (real addresses,
// restored from the secrets store at bring-up) and does not exist in CI or a fresh clone. Worker NAMES
// and COUNT are not secrets, and the example is required to keep them identical to the real fleet (see
// inventory.example.yml's own header and inventory-example-parity.test.ts, which checks that structural
// equivalence directly). Do not re-point this at inventory.yml: it would pass locally and fail in CI.
test("CLAUDE.md's worker count and range match inventory.example.yml", () => {
  const stated = doc.match(/\*\* ([A-Z]+) boxes\r?\n> \(`a11y-worker-(\d+)` … `-(\d+)`/);
  assert.ok(stated, "CLAUDE.md must state the fleet as `** WORD boxes` then `(`a11y-worker-N` … `-M`` on the "
    + "following blockquote line");

  const inventoryText = readFileSync(join(REPO, "packages/control/ansible/inventory.example.yml"), "utf8");
  const names = Object.values(workerNamesFromInventory(inventoryText));
  assert.ok(names.length > 0, "inventory.example.yml parsed to zero workers — the parser or the path moved");

  const numbers = names.map((n) => Number(n.replace("a11y-worker-", ""))).sort((a, b) => a - b);
  const expectedWord = WORD_FOR_COUNT[numbers.length];
  assert.ok(expectedWord, `no word spelled out for a fleet of ${numbers.length} — extend WORD_FOR_COUNT`);

  assert.equal(stated[1], expectedWord, `CLAUDE.md says "${stated[1]} boxes" but inventory.yml has `
    + `${numbers.length} worker(s)`);
  assert.equal(Number(stated[2]), numbers[0], "CLAUDE.md's stated first worker number is stale");
  assert.equal(Number(stated[3]), numbers[numbers.length - 1], "CLAUDE.md's stated last worker number is stale");
});

test("CLAUDE.md's WORKER_FILES count matches worker-files.mjs", () => {
  const stated = doc.match(/\((\d+) now, defined once in `packages\/nvda-worker\/src\/worker-files\.mjs`/);
  assert.ok(stated, "CLAUDE.md must state the hashed-file count as `(N now, defined once in "
    + "`packages/nvda-worker/src/worker-files.mjs``");

  assert.ok(WORKER_FILES.length > 0, "WORKER_FILES resolved empty — the import path moved");

  assert.equal(Number(stated[1]), WORKER_FILES.length, "CLAUDE.md's hashed-file count is stale");
});

test("CLAUDE.md's pre-commit thresholds match scripts/git-hooks/pre-commit", () => {
  const stated = doc.match(/nobody has touched in (\d+) minutes, or more than (\d+) files at once/);
  assert.ok(stated, "CLAUDE.md must state the pre-commit guard as `nobody has touched in N minutes, or "
    + "more than M files at once`");

  const hook = readFileSync(join(REPO, "scripts/git-hooks/pre-commit"), "utf8");
  const staleMin = hook.match(/STALE_MIN="\$\{A11Y_STALE_MIN:-(\d+)\}"/);
  const maxFiles = hook.match(/MAX_FILES="\$\{A11Y_MAX_FILES:-(\d+)\}"/);
  assert.ok(staleMin, "scripts/git-hooks/pre-commit no longer declares STALE_MIN's default the expected way");
  assert.ok(maxFiles, "scripts/git-hooks/pre-commit no longer declares MAX_FILES's default the expected way");

  assert.equal(Number(stated[1]), Number(staleMin[1]), "CLAUDE.md's stale-file minute threshold is stale");
  assert.equal(Number(stated[2]), Number(maxFiles[1]), "CLAUDE.md's max-files threshold is stale");
});
