/**
 * No function may grow to a page and a half, comments included.
 *
 * ESLint already enforces `max-lines-per-function: 70` — but with `skipComments: true`, which is the right
 * setting for this codebase (its comments carry NVDA quirks and WCAG rationale that must not be squeezed out to
 * satisfy a line budget). The gap is that a comment-dense function can be **154 physical lines** and still pass:
 * `navigateByStructure` was, and reading it meant scrolling past four unrelated phases to find the one you
 * wanted.
 *
 * So this measures what a reader actually scrolls. It is not a duplicate of the ESLint rule — it is the other
 * half of it, and it deliberately allows a function to be long *because* it is well explained, while still
 * refusing one that has quietly become four functions in a trench coat.
 *
 * The limit is set just above the honest maximum rather than at a round number, so the next function that
 * crosses it is a deliberate decision rather than a slow drift. `runCapturePhases` is the current ceiling at 80
 * and is exactly the shape the book asks for — one phase call per line, each at one level of abstraction —
 * which is the case this limit must not punish.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { declareTreeWideGuard } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704/#795: this file's own population is the whole tracked tree, not one file -- joins the other
// 21 tree-wide guards here, since it is the guard #715 started from. Its own walk stays `readdirSync`
// rather than `walkTree` deliberately: it measures the WORKING TREE (untracked files included, so a
// function that grows past budget is caught before `git add` too), not `git ls-files`'s tracked-only
// population -- a genuinely different source, not a re-derivation of the one `walkTree` consolidates.
declareTreeWideGuard();

/** Above this, a function is no longer readable in one screenful even generously scrolled. */
const MAX_PHYSICAL_LINES = 90;

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["dist", "node_modules", "__pycache__", "isolation-fixtures", "tsconfig-fixtures"].includes(entry.name)
        ? [] : sourceFiles(full);
    }
    return /\.(ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

interface Oversized { name: string; lines: number; file: string }

/**
 * THE SCRIPT KIND FOLLOWS THE EXTENSION, and passing `ts.ScriptKind.JS` for everything was not a
 * harmless simplification — it silently corrupted this guard's own measurement.
 *
 * Parsed as JS, `new Set<string>()` is `new Set < string > ()`: a comparison, not a generic call. The
 * parser recovers by mis-balancing the braces that follow, and the enclosing function's node then runs to
 * END OF FILE. Measured 2026-09-09 on `evidence-diff.test.ts`, where one test was reported as 152 lines
 * and its real length is 47.
 *
 * The false POSITIVE is the loud half and it is what found this. **The false NEGATIVE is the half with
 * teeth**: every function AFTER the mis-parse is swallowed into that one node and never measured on its
 * own, so a genuinely oversized function later in any `.ts` file using a generic was invisible here. That
 * is this guard failing in exactly the direction it exists to prevent.
 *
 * Measured across all 764 files this guard walks, before changing anything:
 *
 *     ScriptKind.JS : 1 over 90  -> the phantom
 *     by extension  : 0 over 90
 *
 * **Nothing is being hidden today — but nothing was being checked in those files either, and those are
 * not the same claim.** Read without that sentence, `0 over 90` says "no problem" and this correction
 * looks like tidying.
 */
function oversizedIn(file: string): Oversized[] {
  const kind = extname(file) === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, kind);
  const found: Oversized[] = [];
  const visit = (node: ts.Node): void => {
    const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFunction) {
      const start = src.getLineAndCharacterOfPosition(node.getStart(src)).line;
      const end = src.getLineAndCharacterOfPosition(node.end).line;
      const lines = end - start + 1;
      if (lines > MAX_PHYSICAL_LINES) {
        const named = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name;
        found.push({ name: named ? node.name!.getText(src) : "(anonymous)", lines, file: relative(root, file) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

test("no function exceeds the physical-line budget, comments included", () => {
  const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "scripts"))];
  // Guard the guard: a walk that stopped finding files would pass having measured nothing, which is the
  // failure this repo keeps meeting.
  assert.ok(files.length > 60, `the walk only found ${files.length} source files; it is broken`);

  const oversized = files.flatMap(oversizedIn);
  assert.deepEqual(oversized.map((o) => `${o.file}:${o.name} (${o.lines} lines)`), [],
    `function(s) over ${MAX_PHYSICAL_LINES} physical lines. Extract the phases — and note that ESLint will NOT `
    + `catch this, because \`skipComments: true\` means a comment-dense function can be twice this long and `
    + `still pass its 70-line budget.`);
});

test("the budget is close to what the code actually does", () => {
  // A limit far above the real maximum is not a limit — it stops being a decision and becomes decoration, and
  // nobody notices the drift back toward 154. If the true ceiling drops well below this, tighten it.
  const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "scripts"))];
  const longest = files.flatMap((file) => {
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    const lengths: number[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
        lengths.push(src.getLineAndCharacterOfPosition(node.end).line - src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    return lengths;
  }).reduce((a, b) => Math.max(a, b), 0);

  assert.ok(longest > MAX_PHYSICAL_LINES - 30,
    `the longest function is ${longest} lines against a budget of ${MAX_PHYSICAL_LINES}. That gap means the `
    + `budget is not doing any work — lower it to just above ${longest}.`);
});
