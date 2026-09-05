/**
 * THE PYTHON TESTS MUST RUN SOMEWHERE AUTOMATED, and the two requirement files must not drift.
 *
 * 195 pytest files ran nowhere until 2026-09-05. `npm test` calls `test:python`, which prints an honest
 * SKIP without `.venv/bin/pytest` and exits 0 — correct behaviour, and it meant the entire Python suite
 * existed only on a laptop that happened to have a venv. `lint.yml` had no Python at all and the lab has
 * no pytest. Found by an external architecture audit under "gates that exist and run nowhere automated".
 *
 * This repo has its own version of that lesson and it is why the audit's finding was believed immediately:
 * `packages/nvda-speech/tests/test_symbols.py` was written in pytest style, pytest was never installed,
 * and the test glob only matched TypeScript — so that file had NEVER RUN. "A test that does not run is a
 * comment with a docstring."
 *
 * ## Why a second requirements file is not a second spelling
 *
 * `requirements.txt` is the LAB's environment: torch, transformers, onnxruntime, huggingface-hub. The
 * tests need none of it, and pinning CI to that file would cost minutes and a large download per run —
 * which is how a check ends up dispatch-only, the very state being fixed. `requirements-ci.txt` answers a
 * different question: what do the TESTS import. Measured in a scratch venv rather than reasoned — pytest
 * and numpy alone pass 194 of 195, and `safetensors` takes it to 195.
 *
 * Two files stating overlapping facts is this repo's most expensive shape, so the overlap is pinned here:
 * every package named in the CI subset must be named in the full file, at the same constraint. A version
 * that drifts between the environment CI proves and the environment the lab runs makes CI's pass mean
 * nothing about the lab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The lab's environment lives with the package that needs it, NOT at the repo root — and the first
 * version of this test looked for it at the root and failed, which is the drift it exists to catch
 * happening to itself. Named once here so the path is a fact rather than a guess in two assertions.
 */
const FULL_REQUIREMENTS = "packages/scorer/requirements.txt";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../${name}`, import.meta.url)), "utf8");

/** `name>=1,<2` → `["name", ">=1,<2"]`. Comments and blanks dropped. */
function requirements(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.search(/[<>=!~]/);
    out.set((at === -1 ? line : line.slice(0, at)).trim().toLowerCase(),
      at === -1 ? "" : line.slice(at).trim());
  }
  return out;
}

test("CI runs the Python suite, with the flags a stale compile makes necessary", () => {
  const workflow = read(".github/workflows/lint.yml");
  assert.match(workflow, /setup-python/,
    "lint.yml must set up Python, or the 195 pytest files run nowhere automated");
  assert.match(workflow, /pip install -r requirements-ci\.txt/);
  assert.match(workflow, /pytest -p no:cacheprovider/,
    "`spec_from_file_location` honours __pycache__, and a stale compile has decided a mutation check "
    + "wrongly in this repo — a working guard was deleted as dead code on the strength of it");
  assert.match(workflow, /PYTHONDONTWRITEBYTECODE=1/);
});

test("the CI subset never drifts from the lab's environment", () => {
  const ci = requirements(read("requirements-ci.txt"));
  const full = requirements(read(FULL_REQUIREMENTS));
  // VACUITY GUARD: an empty parse would make every assertion below pass having compared nothing.
  assert.ok(ci.size >= 3, `expected the CI subset to name several packages, parsed ${ci.size}`);
  assert.ok(full.size >= 5, `expected the full file to name several packages, parsed ${full.size}`);

  for (const [name, constraint] of ci) {
    assert.ok(full.has(name),
      `requirements-ci.txt names "${name}" and ${FULL_REQUIREMENTS} does not. CI would then prove an `
      + "environment the lab never has, which makes its pass mean nothing about the lab.");
    assert.equal(constraint, full.get(name),
      `"${name}" is pinned "${constraint}" for CI and "${full.get(name)}" for the lab. A version that `
      + "differs between the environment CI proves and the one that ships is two spellings of one fact.");
  }
});

test("the subset is a SUBSET — it must not quietly become the whole lab environment", () => {
  const ci = requirements(read("requirements-ci.txt"));
  // The point of the file is that CI stays cheap. torch and its friends are what make the lab install
  // slow, and a check that becomes slow is a check somebody stops running — which is the failure this
  // whole change exists to fix, arriving through the fix.
  for (const heavy of ["torch", "transformers", "onnxruntime", "huggingface-hub"]) {
    assert.ok(!ci.has(heavy),
      `requirements-ci.txt names "${heavy}". The tests do not import it — measured — and adding it makes `
      + "every CI run pay for an encoder-sized download. If a test genuinely needs it, say so here.");
  }
});
