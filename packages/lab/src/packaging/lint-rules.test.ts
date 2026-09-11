/**
 * The code-shape rules that live in `eslint.config.js`, each proved in BOTH directions (#908).
 *
 * A lint rule that matches nothing is silent by design, and a silent rule looks exactly like a clean tree. So
 * every rule converted from a tree-sweeping test gets a fixture here that must be reported and one that must
 * not, linted through the repo's OWN config rather than a copy of it. Deleting a rule's entry from
 * `eslint.config.js`, or weakening its options, turns a test here red. That property is what makes a green
 * `npm run lint` mean the rule looked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const eslint = new ESLint({ cwd: root });

/** The lines at which `ruleId` reports on `code`, linted as though it lived at `path` in this repo. */
async function reportedLines(ruleId: string, code: string, path: string): Promise<number[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, path) });
  assert.equal(result.messages.some((m) => /ignored/i.test(m.message)), false, `${path} is ignored by the config`);
  return result.messages.filter((m) => m.ruleId === ruleId).map((m) => m.line);
}

// --- `local/max-physical-lines-per-function`, formerly `function-size.test.ts` ---------------------------------

const PHYSICAL = "local/max-physical-lines-per-function";
const CODE_ONLY = "max-lines-per-function";

/**
 * A function `lines` physical lines long whose body is a third code, a third comments and a third blank, so
 * its CODE lines stay well under the 70-line budget. This is the case the physical budget exists for: a
 * well-explained function `max-lines-per-function` cannot see, because it skips comments and blank lines.
 * Skipping EITHER here drops about thirty lines, so both options are pinned by the one fixture.
 */
function commentDense(lines: number, { iife = false } = {}): string {
  const filler = [(i: number) => `  total += ${i};`, (i: number) => `  // why step ${i} is needed`, () => ""];
  const body = Array.from({ length: lines - 2 }, (_, i) => filler[i % filler.length](i));
  const [open, close] = iife ? ["(() => {", "})();"] : ["function commentDense() {", "}"];
  return ["let total = 0;", open, ...body, close, "export { total };", ""].join("\n");
}

test("a comment-dense function over 90 physical lines is reported, which the 70-line code budget cannot see", async () => {
  const code = commentDense(91);
  assert.deepEqual(await reportedLines(PHYSICAL, code, "packages/lab/src/packaging/fixture.ts"), [2]);
  assert.deepEqual(await reportedLines(CODE_ONLY, code, "packages/lab/src/packaging/fixture.ts"), [],
    "the fixture must stay under the code-line budget, or it no longer isolates the physical one");
});

test("a function of exactly 90 physical lines is not reported", async () => {
  assert.deepEqual(await reportedLines(PHYSICAL, commentDense(90), "packages/lab/src/packaging/fixture.ts"), []);
});

test("the physical budget covers the worker's plain .mjs as well as .ts", async () => {
  assert.deepEqual(await reportedLines(PHYSICAL, commentDense(91), "packages/nvda-worker/src/fixture.mjs"), [2]);
  assert.deepEqual(await reportedLines(PHYSICAL, commentDense(90), "packages/nvda-worker/src/fixture.mjs"), []);
});

test("an IIFE is measured too, as function-size.test.ts measured every function node", async () => {
  assert.deepEqual(
    await reportedLines(PHYSICAL, commentDense(91, { iife: true }), "packages/lab/src/packaging/fixture.ts"), [2]);
});
