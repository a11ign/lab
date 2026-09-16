/**
 * #1415: A `skip` TEST OPTION MUST BE ABLE TO SAY WHY.
 *
 * A string `skip` is printed after `# SKIP`; a boolean prints nothing. worker-tooling's whole-suite run at `26c1d929`
 * had four skips with no reason -- `{ skip: !existsSync(CAPTURES) }` three times in `announcement.corpus.test.ts`
 * and once in `conformance.test.ts` -- beside 22 that named their missing corpus, so a reader of the run could not
 * tell those four from a skip for any other cause.
 *
 * ## What is read
 *
 * PARSED, not grepped. An option object split across lines, a `{ skip }` shorthand and the word "skip:" inside a
 * string are three things a line regex gets wrong. Every tracked `*.test.ts` under `packages/<pkg>/src` is parsed
 * with `typescript`'s parser -- syntax only, no program and no type checker.
 *
 * THE CALLS READ are those whose callee is bound to a TEST API by an import:
 *   - `node:test`, which is what the suite imports;
 *   - `@rstest/core`, rstest's own API, which the suite is moving to (#1317) and no test file imports today;
 *   - `scripts/rstest/node-test-shim.mjs`, the adapter rstest runs `node:test` through.
 * Bound directly (`test(...)`), as a property (`test.describe(...)`, `nt.test(...)`), through a call
 * (`adapt(register)(...)`), or through a same-file `const` holding such a call (`const run = adapt(register)`).
 * A `skip` key in any other call -- `assert.deepEqual(result, { skip: true })` -- is data, not a test option.
 *
 * THE ONE FILE EXEMPTED, BY NAME: `node-test-shim-options.test.ts` hands literal `{ skip: true }` and
 * `{ skip: false }` to the shim's adapter to prove what it maps and what it refuses. Those are fixtures of the
 * shim's contract, not skips of a test, and the exemption is pinned to still have something to exempt.
 *
 * ## When a `skip` value can yield a string -- done-when 2's rule, stated
 *
 * Classified from the syntax, into three answers:
 *   - BOOLEAN-ONLY, refused: `true`, `false`, `null`, `undefined`; a negation `!x`; a comparison (`===`, `!==`,
 *     `==`, `!=`, `<`, `<=`, `>`, `>=`, `instanceof`, `in`).
 *   - CAN YIELD A STRING, accepted: a string or template literal; `a && b` when `b` can (the left side only ever
 *     supplies a falsy value, which prints no reason); `a || b` and `a ?? b` when either side can; `c ? a : b`
 *     when either branch can; a CALL or a PROPERTY READ, because what those return is not in this file -- the
 *     suite's own reason builder, `skipLine(GUARD)`, is a call. Parentheses, `as` and `!` postfix are looked through.
 *   - AN IDENTIFIER is resolved to its declaration IN THE SAME FILE and classified by its initializer. One that
 *     cannot be resolved there -- an import, a parameter, a declaration without an initializer -- is refused as
 *     UNREADABLE: done-when 2 accepts an identifier only when its definition can yield a string, and a definition
 *     this guard cannot read has not shown that. Anything else (a number, a function) is UNREADABLE too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

declareTreeWideGuard();

const ROOT = resolve(import.meta.dirname, "../../../..");
const SELF = "packages/lab/src/packaging/skip-reason-guard.test.ts";
const SHIM_FIXTURES = "packages/lab/src/packaging/node-test-shim-options.test.ts";
/** The four #1415 fixed, by file: the population control for the tree-wide read. */
const FIXED_BY_1415 = { "packages/evidence/src/announcement.corpus.test.ts": 3, "packages/evidence/src/conformance.test.ts": 1 };

type Verdict = "string" | "boolean-only" | "unreadable";
type SkipSite = { file: string; line: number; api: string | null; text: string; verdict: Verdict };
type Declarations = Map<string, ts.Expression | null>;

/** Which test API a module specifier names, or null. */
function testApiOf(specifier: string): string | null {
  if (specifier === "node:test" || specifier === "@rstest/core") return specifier;
  return specifier.endsWith("rstest/node-test-shim.mjs") ? "node-test-shim" : null;
}

/** Local names an import binds to a test API: `import { test as t }`, `import test from`, `import * as nt`. */
function testApiBindings(source: ts.SourceFile): Map<string, string> {
  const bound = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const api = testApiOf(statement.moduleSpecifier.text);
    const clause = statement.importClause;
    if (!api || !clause) continue;
    if (clause.name) bound.set(clause.name.text, api);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bound.set(named.name.text, api);
    if (named && ts.isNamedImports(named)) for (const element of named.elements) bound.set(element.name.text, api);
  }
  return bound;
}

/** Every variable declared in the file, by name, with its initializer -- the first declaration of a name wins. */
function declarationsIn(source: ts.SourceFile): Declarations {
  const found: Declarations = new Map();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && !found.has(node.name.text)) {
      found.set(node.name.text, node.initializer ?? null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The test API a callee reaches, or null when it reaches none. */
function apiOf(callee: ts.Expression, bound: Map<string, string>, declarations: Declarations, seen = new Set<string>()): string | null {
  if (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) {
    return apiOf(callee.expression, bound, declarations, seen);
  }
  if (!ts.isIdentifier(callee) || seen.has(callee.text)) return null;
  const direct = bound.get(callee.text);
  if (direct) return direct;
  const initializer = declarations.get(callee.text);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  return apiOf(initializer.expression, bound, declarations, new Set([...seen, callee.text]));
}

/** "string" when either answer can yield one; otherwise "unreadable" when either is; otherwise boolean-only. */
function either(a: Verdict, b: Verdict): Verdict {
  if (a === "string" || b === "string") return "string";
  return a === "unreadable" || b === "unreadable" ? "unreadable" : "boolean-only";
}

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
]);

function classifyBinary(expr: ts.BinaryExpression, declarations: Declarations, seen: Set<string>): Verdict {
  const operator = expr.operatorToken.kind;
  if (COMPARISONS.has(operator)) return "boolean-only";
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return classify(expr.right, declarations, seen);
  if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
    return either(classify(expr.left, declarations, seen), classify(expr.right, declarations, seen));
  }
  return "unreadable";
}

function classifyIdentifier(name: string, declarations: Declarations, seen: Set<string>): Verdict {
  if (name === "undefined") return "boolean-only";
  const initializer = declarations.get(name);
  if (!initializer || seen.has(name)) return "unreadable";
  return classify(initializer, declarations, new Set([...seen, name]));
}

/** A value whose answer needs nothing else read: a literal, a negation, a call or a property read. Null otherwise. */
function classifyLeaf(expr: ts.Expression): Verdict | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr)) return "string";
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expr.kind)) return "boolean-only";
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) return "boolean-only";
  const readsElsewhere = ts.isCallExpression(expr) || ts.isPropertyAccessExpression(expr)
    || ts.isElementAccessExpression(expr) || ts.isAwaitExpression(expr);
  return readsElsewhere ? "string" : null;
}

/** Can this `skip` value yield a string? See the header for the rule. */
function classify(expr: ts.Expression, declarations: Declarations, seen = new Set<string>()): Verdict {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) {
    return classify(expr.expression, declarations, seen);
  }
  const leaf = classifyLeaf(expr);
  if (leaf) return leaf;
  if (ts.isConditionalExpression(expr)) {
    return either(classify(expr.whenTrue, declarations, seen), classify(expr.whenFalse, declarations, seen));
  }
  if (ts.isBinaryExpression(expr)) return classifyBinary(expr, declarations, seen);
  if (ts.isIdentifier(expr)) return classifyIdentifier(expr.text, declarations, seen);
  return "unreadable";
}

/** The value of a `skip` key on an object literal, or null. */
function skipValueOf(property: ts.ObjectLiteralElementLike): ts.Expression | null {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text === "skip" ? property.name : null;
  if (!ts.isPropertyAssignment(property)) return null;
  const key = property.name;
  const named = (ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === "skip";
  return named ? property.initializer : null;
}

/** Every `skip` key on an object literal passed to a call, with the test API the call reaches and its verdict. */
function skipSitesIn(file: string, text: string): SkipSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bound = testApiBindings(source);
  const declarations = declarationsIn(source);
  const sites: SkipSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const api = apiOf(node.expression, bound, declarations);
      for (const property of node.arguments.filter(ts.isObjectLiteralExpression).flatMap((o) => [...o.properties])) {
        const value = skipValueOf(property);
        if (!value) continue;
        const line = source.getLineAndCharacterOfPosition(property.getStart()).line + 1;
        sites.push({ file, line, api, text: property.getText(), verdict: classify(value, declarations) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** 1-based numbers of the lines of `source` a planted case marks, so no expectation is a hand-typed line number. */
const markedLines = (source: string, marker: string) =>
  source.split("\n").flatMap((text, index) => (text.endsWith(marker) ? [index + 1] : []));

const refusedIn = (sites: SkipSite[]) => sites.filter((site) => site.api !== null && site.verdict !== "string");
/** What the guard reports: every refusal outside the one file exempted by name. */
const offendersIn = (sites: SkipSite[]) => refusedIn(sites).filter((site) => site.file !== SHIM_FIXTURES);
const show = (site: SkipSite) => `${site.file}:${site.line} [${site.api}] ${site.text} -- ${site.verdict}`;

/**
 * THE PLANTED POSITIVE CONTROL (done-when 3), in the API the four fixed skips use: `test(name, { skip }, fn)` from
 * `node:test`. Source text in a string, so the tree-wide read of this very file sees a string and never a call.
 */
const PLANTED_BOOLEAN = [
  'import { test } from "node:test";',
  'import { existsSync } from "node:fs";',
  'import { IMPORTED } from "./elsewhere.js";',
  'const P = "/nowhere";',
  "const NEGATED = !existsSync(P);",
  "const skip = !existsSync(P);",
  'test("the #1415 shape", { skip: !existsSync(P) }, () => {}); // REFUSED',
  'test("a literal", { skip: true }, () => {}); // REFUSED',
  'test("a comparison", { skip: P.length === 0 }, () => {}); // REFUSED',
  'test("an identifier holding a negation", { skip: NEGATED }, () => {}); // REFUSED',
  'test("an identifier this file cannot read", { skip: IMPORTED }, () => {}); // REFUSED',
  'test("shorthand", { skip }, () => {}); // REFUSED',
  'test("split across lines", {',
  "  timeout: 5,",
  "  skip: false, // REFUSED",
  "}, () => {});",
].join("\n");

/** Seven boolean-only cases, each marked on the line its `skip` sits. */
const PLANTED_BOOLEAN_CASES = 7;

/** The accepted shapes: the four as fixed, and the three the tree already used before #1415. */
const PLANTED_REASONED = [
  'import { test } from "node:test";',
  'import { existsSync } from "node:fs";',
  'const P = "/nowhere";',
  "const NO_CAPTURES = existsSync(P) ? false : `no captures at ${P}`;",
  'const SKIP = !GUARD.read && skipLine(GUARD);',
  'const ANDED = P.length === 0 && "no runs/ here";',
  'const skip = P.length === 0 ? "no corpus on disk" : false;',
  'test("the fix", { skip: NO_CAPTURES }, () => {});',
  'test("a reason builder", { skip: SKIP }, () => {});',
  'test("a reason behind &&", { skip: ANDED }, () => {});',
  'test("or undefined", { skip: skip || undefined }, () => {});',
  'test("inline", { skip: existsSync(P) ? false : `no captures at ${P}` }, () => {});',
].join("\n");

test("#1415 CONTROL: every planted boolean-only skip is REFUSED, and every planted reasoned one is accepted", () => {
  const refused = refusedIn(skipSitesIn("planted-boolean.test.ts", PLANTED_BOOLEAN));
  const planted = markedLines(PLANTED_BOOLEAN, "// REFUSED");
  assert.equal(planted.length, PLANTED_BOOLEAN_CASES, "the markers themselves were found");
  assert.deepEqual(refused.map((site) => site.line), planted, refused.map(show).join("\n"));
  assert.deepEqual(refused.map((site) => site.verdict),
    ["boolean-only", "boolean-only", "boolean-only", "boolean-only", "unreadable", "boolean-only", "boolean-only"]);
  // The exemption is BY FILE: the same source is reported under any other name, and under the shim fixtures' not.
  assert.deepEqual(offendersIn(refused).map(show), refused.map(show));
  assert.deepEqual(offendersIn(skipSitesIn(SHIM_FIXTURES, PLANTED_BOOLEAN)).map(show), []);
  const reasoned = skipSitesIn("planted-reasoned.test.ts", PLANTED_REASONED);
  assert.equal(reasoned.length, PLANTED_REASONED.split("\n").filter((text) => text.startsWith("test(")).length,
    "the positive control on the accepted half: every planted reasoned site was read");
  assert.deepEqual(refusedIn(reasoned).map(show), []);
});

test("#1415 CONTROL: a skip through rstest's API or the node:test shim is read too", () => {
  const rstest = skipSitesIn("planted-rstest.test.ts",
    'import { test, describe } from "@rstest/core";\ntest("r", { skip: true }, () => {});\ndescribe.skip("d", { skip: !ok }, () => {});');
  assert.deepEqual(refusedIn(rstest).map((site) => site.api), ["@rstest/core", "@rstest/core"]);
  const shimSource = [
    'import { adapt, describeOn } from "../../../../scripts/rstest/node-test-shim.mjs";',
    "const run = adapt(register);",
    'adapt(register)("a", { skip: true }, body); // REFUSED',
    'run("b", { skip: false }, body); // REFUSED',
    'assert.deepEqual(result, { skip: true });',
  ].join("\n");
  const shim = skipSitesIn("planted-shim.test.ts", shimSource);
  assert.deepEqual(shim.map((site) => site.api), ["node-test-shim", "node-test-shim", null],
    "the adapter is followed through a call and through a const; an assertion's object is not a test option");
  assert.deepEqual(refusedIn(shim).map((site) => site.line), markedLines(shimSource, "// REFUSED"),
    "and a boolean in an assertion's object is not refused");
});

test("#1415: no `skip` test option in packages/*/src can only be a boolean", () => {
  const roots = readdirSync(resolve(ROOT, "packages"))
    .map((name) => `packages/${name}/src`).filter((root) => existsSync(resolve(ROOT, root)));
  const files = walkTree({ kind: "ts", roots, selfPath: SELF }).map((f) => f.path).filter((p) => p.endsWith(".test.ts"));
  const sites = files.flatMap((file) => skipSitesIn(file, readFileSync(resolve(ROOT, file), "utf8")));
  const examined = sites.filter((site) => site.api !== null);
  // THE POPULATION CONTROL: the four sites #1415 fixed are among those read, as node:test options, and accepted.
  const fixed = examined.filter((site) => site.file in FIXED_BY_1415);
  const expected = Object.values(FIXED_BY_1415).reduce((sum, n) => sum + n, 0);
  assert.ok(examined.length > 0 && fixed.length === expected, `read ${examined.length} test-option skips, ${fixed.length} of the ${expected}`);
  assert.deepEqual(fixed.map((site) => `${site.api} ${site.verdict}`), Array(expected).fill("node:test string"));
  // THE EXEMPTION STILL EXEMPTS SOMETHING, or it would be a name nobody needs.
  const exempted = refusedIn(sites).filter((site) => site.file === SHIM_FIXTURES);
  assert.ok(exempted.length > 0, `${SHIM_FIXTURES} no longer passes a boolean skip to the shim -- drop the exemption`);
  const offenders = offendersIn(sites);
  assert.deepEqual(offenders.map(show), [],
    "give each skip a string naming what is missing, e.g. `existsSync(P) ? false : `no captures at ${P}``. This "
    + "list being empty is a reading, not a guard that matched nothing: the planted positive control is "
    + "PLANTED_BOOLEAN in this file, refused in the test '#1415 CONTROL: every planted boolean-only skip is REFUSED'");
});
