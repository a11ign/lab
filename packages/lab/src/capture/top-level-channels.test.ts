/**
 * #977: `evidence:check` COMPARES THE TOP-LEVEL DOM-ONLY CHANNELS, AND EVERY FIELD THE CAPTURE DECLARES IS CLASSIFIED.
 *
 * `EVIDENCE_FIELDS` was a table of `[group, name]` pairs inside `structure`/`interaction`. `media` (1.4.2's rule)
 * and `formInputs` (1.3.5's rule and signal, #170) sit at the capture's TOP level, so the table could not name
 * them and evidence:check read SAME for any change to either -- and its exit 0 means "ship, no recapture".
 *
 * The guard that should have caught it, `evidence-fields.test.ts`, walks `structure.*`/`interaction.*` on disk:
 * it never saw the top level, and in CI (no `runs/`) it checked nothing. The class pin below reads
 * capture-core's own typedefs instead, so it runs everywhere.
 *
 * IN ITS OWN FILE, importing only `evidence-diff.mjs`: the files beside it reach `dataset-paths.mjs`, which CI's
 * acceptance job classes as needing a corpus -- the move `what-it-asked.mjs` made for #343.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compareCapture, EVIDENCE_FIELDS, NOT_COMPARED } from "./evidence-diff.mjs";

/** A capture the pipeline accepts, carrying `over`. */
const capture = (over: Record<string, unknown> = {}) => ({
  url: "https://example.test/", screenReader: "NVDA",
  transcript: ["heading, level 1, Museum 004 controls"],
  structure: { headings: ["Museum 004 controls, heading, level 1"], landmarks: [], formFields: [] },
  interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
  ...over,
});

test("#977: a capture differing ONLY in `media` is CHANGED -- 1.4.2's rule reads it, so SAME would ship stale evidence", () => {
  const audio = { tag: "audio", autoplay: true, muted: false, controls: false, loop: true };
  const base = capture({ media: [audio] });
  const changed = compareCapture(base, capture({ media: [{ ...audio, muted: true }] }));
  assert.equal(changed.verdict, "CHANGED");
  assert.deepEqual(changed.changes.map((c: { field: string }) => c.field), ["media"]);
  assert.equal(compareCapture(base, capture({ media: [audio] })).verdict, "SAME", "the control: identical media is SAME");
  assert.equal(compareCapture(base, capture({ media: [] })).verdict, "CHANGED", "the census losing an element is a change");
});

test("#977: a capture differing ONLY in `formInputs` is CHANGED -- 1.3.5's rule and signal read it (#170)", () => {
  const field = { tag: "input", type: "text", autocomplete: "given-name" };
  const base = capture({ formInputs: [field] });
  const changed = compareCapture(base, capture({ formInputs: [{ ...field, autocomplete: "fname" }] }));
  assert.equal(changed.verdict, "CHANGED", "the one attribute 1.3.5 decides on, and the count unchanged");
  assert.deepEqual(changed.changes.map((c: { field: string }) => c.field), ["formInputs"]);
  assert.equal(compareCapture(base, capture({ formInputs: [field] })).verdict, "SAME");
});

test("#977: the top-level channels in EVIDENCE_FIELDS are one-segment paths -- exactly these two today", () => {
  assert.deepEqual(EVIDENCE_FIELDS.filter((f) => f.length === 1).map((f) => f[0]).sort(), ["formInputs", "media"]);
});

/** A `@typedef {{ ... }} Name` line's field names -- the wire test's reading: one line, flat, colon-anchored. */
const CAPTURE_CORE = readFileSync(join(import.meta.dirname, "../../../nvda-worker/src/capture-core.mjs"), "utf8");
function typedefFields(name: string): string[] {
  const line = CAPTURE_CORE.split("\n").find((l) => l.includes("@typedef {{") && new RegExp(`\\}\\}\\s*${name}\\b`).test(l));
  assert.ok(line, `@typedef {{ ... }} ${name} not found on one line -- capture-core.mjs has moved`);
  const body = (line as string).match(/\{\{([^]*)\}\}/);
  assert.ok(body, `no {{ ... }} body on the ${name} typedef line`);
  return [...new Set([...(body as RegExpMatchArray)[1].matchAll(/\b([A-Za-z_$][\w$]*)\??:\s*/g)].map((m) => m[1]))].sort();
}

/** The two groups whose fields are classified one level down, and the one field compared outside the table. */
const GROUPS = new Set(["structure", "interaction"]);
const COMPARED_ELSEWHERE = new Set(["transcript"]);

test("#977 THE CLASS: every field capture-core's typedefs declare is compared, a group, the transcript, or NOT_COMPARED", () => {
  const compared = new Set(EVIDENCE_FIELDS.map((f) => f.join(".")));
  const excluded = NOT_COMPARED as Readonly<Record<string, string>>;
  const top = typedefFields("Capture");
  assert.ok(top.length >= 8 && top.includes("structure") && top.includes("interaction"),
    `the Capture typedef reads as ${top.join(", ")} -- the parser is broken, not the capture`);
  const unclassified = [
    ...top.filter((f) => !GROUPS.has(f) && !COMPARED_ELSEWHERE.has(f)),
    ...typedefFields("CapturedStructure").map((k) => `structure.${k}`),
    ...typedefFields("CapturedInteraction").map((k) => `interaction.${k}`),
  ].filter((f) => !compared.has(f) && !(f in excluded));
  assert.deepEqual(unclassified, [],
    "a capture field is neither compared nor excluded with a reason, so evidence:check reads SAME for any change to it");
  // Every exclusion carries a reason, and none outlives its field: a reason for a field the capture no longer
  // declares is a claim about nothing, and the next reader would trust it.
  const declared = new Set([...top, ...typedefFields("CapturedStructure").map((k) => `structure.${k}`),
    ...typedefFields("CapturedInteraction").map((k) => `interaction.${k}`)]);
  for (const [field, why] of Object.entries(excluded)) {
    assert.ok(why.length > 20, `${field} is excluded with no real reason`);
    assert.ok(declared.has(field), `${field} is excluded but the capture no longer declares it`);
  }
});
