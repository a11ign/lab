/**
 * THE LAB'S JUDGE-FILE READER DERIVES ITS CAPTURE TYPES FROM THE WIRE TYPE, never restates them.
 *
 * `CaptureInteraction` and `CaptureStructure` are the wire types of `@a11ign/evidence`. Five and eleven
 * declarations once spelled their fields inline and disagreed with the wire (core #1603 and its structure
 * sibling), so each consumer names the type it derives from, and the core's tests pinned that by reading each
 * consumer's source.
 *
 * Moved from the core's `interaction-declarations.test.ts` and `structure-declarations.test.ts` (ADR 0045 cut 1):
 * the entry for this repository's one consumer, `src/harnesses/judge-file.ts`, read through the core's
 * `packages/lab/` path. The scan that finds a restatement anywhere in a tree is this repository's too, now that
 * `@a11ign/evidence` exports its detector (`restatesWireType`, ADR 0045 rule 2): it walks this repository's own
 * `src` and `scripts` and calls the published function, never a copy of it. The core keeps the walk over its own tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { restatesWireType } from "@a11ign/evidence";
import { LAB_ROOT, labSources } from "./lab-sources.ts";

const JUDGE_FILE = "src/harnesses/judge-file.ts";

const DERIVED = [
  ['Pick<CaptureInteraction, "controls" | "stateChanges">', "interaction change lists (#1603)"],
  ["Pick<CaptureStructure", "structure sweeps"],
] as const;

test("judge-file.ts derives its interaction and structure types from the wire type", () => {
  const text = readFileSync(join(LAB_ROOT, JUDGE_FILE), "utf8");
  assert.ok(text.length > 0, `${JUDGE_FILE} was read as empty, so this test would examine nothing`);
  for (const [needle, what] of DERIVED) {
    assert.ok(text.includes(needle), `${JUDGE_FILE} must derive its ${what} from the wire type (${needle})`);
  }
});

test("judge-file.ts takes the wire types from the published package, not from a path into another repository", () => {
  const text = readFileSync(join(LAB_ROOT, JUDGE_FILE), "utf8");
  assert.match(text, /import type \{[^}]*\bCaptureInteraction\b[^}]*\} from "@a11ign\/evidence";/);
  assert.match(text, /import type \{[^}]*\bCaptureStructure\b[^}]*\} from "@a11ign\/evidence";/);
});

test("no lab source restates a capture wire type, and the scan examines the lab's own tree", () => {
  const population = labSources(/\.ts$/);
  // The positive control, on the population itself: an empty walk would make the scan below pass having examined
  // nothing, and the judge file the entries above pin must be among the files it reaches.
  assert.ok(population.length > 0, "the scan found no lab sources, so an empty result would prove nothing");
  assert.ok(population.includes(join(LAB_ROOT, JUDGE_FILE)),
    `${JUDGE_FILE} is not in the scanned population (${population.length} files), so an empty result would prove nothing`);
  const restatements = population.flatMap((file) =>
    restatesWireType(readFileSync(file, "utf8")).map((found) => `${relative(LAB_ROOT, file)}: ${found}`));
  assert.deepEqual(restatements, [], "a lab source spells a capture wire type inline: derive it from @a11ign/evidence instead");
});
