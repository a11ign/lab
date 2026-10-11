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
 * `packages/lab/` path. What did NOT move is the scan that finds a restatement anywhere in a tree: its detector
 * is a helper inside the core's test file and is not exported by a package, so copying it here would be a second
 * spelling of it. It waits on the producer exporting it; the core's two tests keep walking until then.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_ROOT } from "./lab-sources.ts";

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
