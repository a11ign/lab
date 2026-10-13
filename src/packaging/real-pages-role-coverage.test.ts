/**
 * The real-pages pipeline captures every role the corpus scores.
 *
 * Moved from control's `src/lab-pipeline.test.ts` (control#87, a11ign#5372): the corpus is a LAB fact and
 * the pipeline it is captured by is control's, so the check that joins them belongs where the corpus lives.
 *
 * POSITIVE CONTROL: `scored` must not be empty, or the loop below proves nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIPELINES } from "@a11ign/control/lab-pipeline";
import { REAL_PAGES } from "../training/real-page-corpus.mjs";

type StageEntry = string | { job: string; vars?: Record<string, string> };

test("the real-pages pipeline captures every role the corpus scores", () => {
  const scored = [...new Set(REAL_PAGES.map((page) => page.role))].filter((role) => role !== "fixture");
  assert.ok(scored.length > 0, "positive control: the corpus scores at least one non-fixture role");
  const captured = (PIPELINES["real-pages"].jobs as StageEntry[])
    .filter((entry): entry is { job: string; vars?: Record<string, string> } =>
      typeof entry !== "string" && entry.job === "capture-real-pages")
    .map((entry) => entry.vars?.role)
    .filter((role): role is string => typeof role === "string");
  for (const role of scored) {
    assert.ok(captured.includes(role),
      `pipeline 'real-pages' never captures role='${role}', so it would score and rewrite the baseline `
      + `against whatever stale captures that role has on disk. Captured: ${captured.join(", ") || "(none — "
      + "the stage names no role, so it takes capture-real-pages' default of training)"}`);
  }
});
