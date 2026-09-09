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

/**
 * #715: A GUARD WHOSE POPULATION IS THE TREE MUST ASSERT ABOUT THE SEARCH, NOT ONLY THE RESULT. #687
 * fixed the mis-parse (`ScriptKind.JS` on a `.ts` file misreads a generic like `new Set<string>()`, and
 * the parser recovers by extending the enclosing node to END OF FILE, swallowing every function after
 * it) -- but a fix with no assertion behind it can regress silently, the exact shape this row exists to
 * close.
 *
 * THE EXACT SIGNAL, MEASURED: a function's own `.end` genuinely equalling the SourceFile's `.end`
 * (`node.end === src.getEnd()`, i.e. the literal end of the file's text) is the mis-parse signature --
 * the recovered node consumes every remaining token, including the file's own trailing newline. A
 * legitimate LAST function, even nested as a call's final argument (`test("x", () => { ... })`, the
 * overwhelming shape in this tree), never reaches that far: its own closing `}` is still followed by at
 * least the wrapping call's `)`/`;`/trailing newline. Measured directly: the first draft of this test
 * compared against the file's own last TOP-LEVEL STATEMENT with 2 characters of slack, and every one of
 * ~400 real `test(...)`/`describe(...)`-terminated files in this tree false-positived, because the
 * function argument's own end sits a few characters short of the wrapping statement's end BY DESIGN, not
 * by defect -- exact equality to the file's own true end has no such false-positive population.
 */
test("#715: no measured function node reaches END OF FILE unless it is genuinely the file's own last "
  + "construct -- the mis-parse signature #687 fixed, asserted directly so it can never silently return", () => {
  const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "scripts"))];
  const suspicious: string[] = [];
  for (const file of files) {
    const kind = extname(file) === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const text = readFileSync(file, "utf8");
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
    const fileEnd = src.getEnd();
    const visit = (node: ts.Node): void => {
      const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
      if (isFunction && node.end === fileEnd) {
        suspicious.push(`${relative(root, file)}: a function's own end (${node.end}) exactly equals the `
          + `file's own end (${fileEnd}) -- a correctly-parsed function, even the file's true last `
          + "construct, does not consume its own trailing newline; this is the mis-parse signature");
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  assert.deepEqual(suspicious, [],
    "the mis-parse signature was found in at least one file -- a function was measured as running to end "
    + "of file without genuinely being the file's own last construct, meaning everything after it in that "
    + "file went unmeasured");
});

test("#715 MUTATION TARGET: forcing ScriptKind.JS reproduces the mis-parse signature on a real .ts file "
  + "using a generic -- proves the assertion above actually bites, not merely that it reads plausibly", () => {
  // A real file in this tree that genuinely uses a generic early, with real code after it -- if this ever
  // stops existing (the file is deleted or rewritten with no generics), pick a different real file rather
  // than relaxing this to a synthetic fixture; the whole point is proving the assertion against the tree.
  const target = join(root, "packages/lab/src/packaging/function-size.test.ts");
  const text = readFileSync(target, "utf8");
  assert.match(text, /new Set<string>\(\)|Set<string>/, "this file's own generic usage is the fixture -- "
    + "if it no longer contains one, point this test at a different real file, never a synthetic string");
  const brokenSrc = ts.createSourceFile(target, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const realEnd = text.replace(/\s+$/, "").length;
  let sawEofReachingFunction = false;
  const visit = (node: ts.Node): void => {
    const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFunction && node.end >= realEnd - 2) sawEofReachingFunction = true;
    ts.forEachChild(node, visit);
  };
  visit(brokenSrc);
  assert.ok(sawEofReachingFunction,
    "parsing this file with the WRONG ScriptKind must reproduce a function node reaching end of file -- "
    + "if it does not, this file no longer demonstrates the defect #687 fixed");
});

test("the budget is close to what the code actually does", () => {
  // A limit far above the real maximum is not a limit — it stops being a decision and becomes decoration, and
  // nobody notices the drift back toward 154. If the true ceiling drops well below this, tighten it.
  const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "scripts"))];
  const longest = files.flatMap((file) => {
    // #715: this walk is a second copy of oversizedIn's own parse and had NOT picked up #687's fix --
    // the identical mis-parse risk, unfixed one call site over. Grep for the shape, not just the field.
    const kind = extname(file) === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, kind);
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
