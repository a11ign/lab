/**
 * THE MODEL'S INPUT ALLOWLIST IS GUARDED BY THE SAME LIST, WRITTEN TWICE, AND NOTHING COMPARED THEM.
 *
 * `FORBIDDEN_INPUT_KEYS` exists once in `export-screenreader-dataset.mjs` (a JS array) and once in
 * `screenreader_features.py` (a Python set), each guarding the same boundary independently: `modelInput()`
 * is an allowlist and this list is the leak check on it -- "a rule may use evidence the model never sees",
 * per the exporter's own comment. The only place either name was mentioned in a test was a comment in
 * `rule-evidence-reaches-the-gate.test.ts` describing the INCIDENT this boundary caused (`census` never
 * reaching exported records) -- nothing there, or anywhere, asserted the two copies still agree.
 *
 * They are equal today. That is not the same claim as "something keeps them equal" -- CLAUDE.md's own
 * running list of this exact defect (`CAPTURE_SETTINGS`, `MUST_MATCH`, container-prefix vocabulary) is one
 * silent drift after another, each found only once it had already shipped a wrong answer.
 *
 * NEITHER "delete a copy" NOR "derive one from the other" is available: this is a boundary a JS process and
 * a Python process must each enforce on their own side, at the moment they build the record that crosses
 * it, so each language needs its own literal to check against. So: pinned equal, by TEXT -- read raw
 * rather than imported, on purpose. `export-screenreader-dataset.mjs` is an executable script with
 * import-time side effects (`refuseUnknownFlags` reads `process.argv` at module scope, `ROOT` reads
 * `process.env` and `process.cwd()`), so importing it for one constant would run a script this test does
 * not intend to run -- `model-input.test.ts` hit the same shape and reads its suspects as text for the same
 * reason. `screenreader_features.py` cannot be imported into a JS test at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../../../..");
const EXPORTER = readFileSync(resolve(REPO, "packages/lab/src/training/export-screenreader-dataset.mjs"), "utf8");
const FEATURIZER = readFileSync(resolve(REPO, "packages/scorer/python/screenreader_features.py"), "utf8");

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function jsForbiddenKeys(): string[] {
  const match = /const FORBIDDEN_INPUT_KEYS = \[([^\]]*)\];/.exec(EXPORTER);
  assert.ok(match, "FORBIDDEN_INPUT_KEYS is gone from export-screenreader-dataset.mjs -- this test examines "
    + "nothing; find its new name and read from there");
  return quotedStrings(match[1]);
}

function pythonForbiddenKeys(): string[] {
  const match = /FORBIDDEN_INPUT_KEYS = \{([^}]*)\}/.exec(FEATURIZER);
  assert.ok(match, "FORBIDDEN_INPUT_KEYS is gone from screenreader_features.py -- this test examines "
    + "nothing; find its new name and read from there");
  return quotedStrings(match[1]);
}

test("the model's forbidden-input boundary names the same keys in JS and Python", () => {
  const js = jsForbiddenKeys();
  const python = pythonForbiddenKeys();
  // ANTI-VACUITY. A regex that stopped matching would return an empty list on both sides and pass having
  // examined nothing -- the exact shape this repo has shipped before.
  assert.ok(js.length >= 5, `only ${js.length} key(s) read from the JS side; the constant's shape changed`);

  const onlyJs = js.filter((key) => !python.includes(key)).sort();
  const onlyPython = python.filter((key) => !js.includes(key)).sort();
  assert.deepEqual(onlyJs, [],
    `these keys are forbidden in the JS exporter and NOT in the Python featurizer, so a record carrying `
    + `one would leak past the Python side's own leak check: ${onlyJs.join(", ")}`);
  assert.deepEqual(onlyPython, [],
    `these keys are forbidden in the Python featurizer and NOT in the JS exporter, so a record carrying `
    + `one would leak past the JS side's own leak check: ${onlyPython.join(", ")}`);
});
