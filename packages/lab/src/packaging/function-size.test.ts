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
import { join, relative } from "node:path";
import ts from "typescript";

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

function oversizedIn(file: string): Oversized[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
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
