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
import { readFileSync } from "node:fs";
import { derivedLocalRule, pinnedWithin } from "../../../../scripts/uncontrolled-emptiness.mjs";
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

/**
 * THE BUDGET MUST STAY CLOSE TO WHAT THE CODE ACTUALLY DOES — `function-size.test.ts`'s fourth test, kept at
 * worker-capture's review of #988 and rewritten as a lint-output check.
 *
 * A limit far above the real maximum stops being a decision and becomes decoration, and nobody notices the
 * drift back toward the 154-line function this budget was set against. Nothing else here asserts that,
 * because it is a property of the TREE rather than of the rule: it changes on its own, as functions are
 * extracted, with no edit to `eslint.config.js` to review.
 *
 * The budget is read from the config rather than restated, so there is one copy of the number.
 */
test("the budget is close to what the code actually does", async () => {
  const configured = await eslint.calculateConfigForFile(join(root, "packages/lab/src/packaging/fixture.ts"));
  const [, options] = (configured.rules as Record<string, [string, { max: number }]>)[PHYSICAL];
  const floor = options.max - 30;
  const probe = new ESLint({ cwd: root,
    overrideConfig: { rules: { [PHYSICAL]: ["error", { ...options, max: floor }] } } });
  const reports = (await probe.lintFiles(["packages", "scripts"]))
    .flatMap((r) => r.messages).filter((m) => m.ruleId === PHYSICAL);
  assert.ok(reports.length > 0,
    `no function in the tree exceeds ${floor} lines, against a budget of ${options.max}. That gap means the `
    + `budget is not doing any work — lower it to just above the longest function.`);
});

// --- `local/bounded-window-reads`, formerly bounded-window-reads.test.ts's per-node half (#1144) -------
//
// The guard it replaces asked whether the LINE mentioned a window-naming predicate. That passed a raw
// read whenever its line mentioned a wrapper for any reason -- which is the guard's OWN recorded
// adjacency defect one granularity down: its header says the first version asked whether the FILE
// mentioned one, `npm run mutate` reported THE GUARD DID NOT BITE, and per-line fixed the file case and
// kept the shape. An AST rule asks whether THIS read is wrapped, which is the property itself.

const WINDOW = "local/bounded-window-reads";
const FIXTURE = "scripts/fixture.mjs";

test("#1144: a raw statusCheckRollup read is reported, at its line", async () => {
  assert.deepEqual(
    await reportedLines(WINDOW, 'export const a = (pr) => pr.statusCheckRollup.filter((r) => r.ok);', FIXTURE),
    [1]);
});

test("#1144: a read wrapped in a narrowing predicate is NOT reported", async () => {
  // The non-emptiness half of the pair: without it, a rule that reported everything would pass the test
  // above and this file would be asserting that ESLint runs at all.
  assert.deepEqual(
    await reportedLines(WINDOW, 'export const a = (pr) => newestPerName(pr.statusCheckRollup).filter((r) => r.ok);', FIXTURE),
    []);
});

test("#1144 THE REASON TO CONVERT: a raw read on a line that also mentions a wrapper IS reported", async () => {
  // The line-regex predicate passed this: `NAMES_ITS_WINDOW` matched anywhere on the line, so an
  // unrelated call to a wrapper exempted a raw read beside it. Latent rather than live -- all 21 rollup
  // reads in the tree passed the old predicate correctly -- and it is the whole argument for the AST rule.
  assert.deepEqual(
    await reportedLines(WINDOW,
      'export const a = (pr, o) => [pr.statusCheckRollup, newestPerName(o)];', FIXTURE),
    [1], "the read is raw; the wrapper on the same line is a NEIGHBOUR of it, not applied to it");
});

test("#1144: a read split across LINES is reported, which a line regex cannot see", async () => {
  assert.deepEqual(
    await reportedLines(WINDOW, 'export const a = (pr) => pr\n  .statusCheckRollup\n  .filter((r) => r.ok);', FIXTURE),
    [1], "reported at the line the member expression STARTS on, not where `.statusCheckRollup` sits -- "
      + "I expected 2 and the rule is right: the node begins at `pr`. The point is that it is reported "
      + "at all, since no single line here carries both the read and a wrapper for a regex to compare");
});

/**
 * #1155: THE DERIVED-LOCAL EMPTINESS RULE — `ceo`'s ruling on #1123's evidence, which was that the 226
 * uncontrolled assertions are not one population and only this shape is decidable today.
 *
 * `assert.deepEqual(offenders, [])` where `const offenders = files.filter(...)` passes when `files` is
 * EMPTY. The control belongs on the population, not the filtered subject.
 *
 * **THE POPULATION IS RE-DERIVED, not taken from #1123's count** — the row's clause 2, and it earned its
 * place. Measured over the full 535-file population: **97 assertions carry the shape, 32 are genuinely
 * unpinned in their own test.** The rule's hits are a STRICT SUBSET of the shape population (zero
 * rule-only), and the 65 it passes are passed correctly — sampled, they carry
 * `assert.ok(source.length >= N, …)` in the same test.
 *
 * That gap is a finding about #1123's instrument rather than about this rule: its pin pattern requires
 * `.length` followed by `,` or `)`, so it reads `assert.ok(offered.length >= 5)` as NOT a pin — when
 * `>= 5` is a stronger pin than `> 0`. **A count measured with a narrow pin detector overstates how much
 * is uncontrolled**, which matters because that count was the argument for a ratchet.
 */
const RULE = "local/uncontrolled-emptiness";
const inTest = (body: string) =>
  `import assert from "node:assert/strict";\nimport test from "node:test";\ntest("t", () => {\n${body}\n});\n`;

test("#1155: an emptiness assertion on a locally derived collection with no pin on its source is REPORTED", async () => {
  const lines = await reportedLines(RULE,
    inTest("  const files = walk();\n  const bad = files.filter((f) => f.x);\n  assert.deepEqual(bad, []);"),
    "packages/lab/src/packaging/zz-fixture-uncontrolled.test.ts");
  assert.equal(lines.length, 1, `expected one report, got ${lines.length}`);
});

test("#1155: the SAME assertion with its source pinned in the same test is NOT reported", async () => {
  // The control. Without it the test above is satisfied by a rule that reports EVERY emptiness assertion
  // -- the "a guard that only ever says no" shape `sound` exists to rule out for the isolation gate.
  const lines = await reportedLines(RULE,
    inTest("  const files = walk();\n  assert.ok(files.length >= 3, \"the walk is broken\");\n"
      + "  const bad = files.filter((f) => f.x);\n  assert.deepEqual(bad, []);"),
    "packages/lab/src/packaging/zz-fixture-controlled.test.ts");
  assert.deepEqual(lines, []);
});

test("#1155: a pin in a DIFFERENT test does not control this one", async () => {
  // Two tests run independently and either could be the one that stops examining anything. Searching the
  // whole file would let one pin excuse every assertion in it -- a control on the wrong object reading as
  // a control, which is #1123's own instance 2.
  const lines = await reportedLines(RULE,
    `import assert from "node:assert/strict";\nimport test from "node:test";\n`
    + `test("a", () => {\n  const files = walk();\n  assert.ok(files.length >= 3);\n});\n`
    + `test("b", () => {\n  const files = walk();\n  const bad = files.filter((f) => f.x);\n`
    + `  assert.deepEqual(bad, []);\n});\n`,
    "packages/lab/src/packaging/zz-fixture-other-test.test.ts");
  assert.equal(lines.length, 1);
});

test("#1155: a collection derived from a CALL is out of scope, and deliberately", async () => {
  // ceo's ruling: the rule can see the shape and cannot see the population. A report here has no action
  // attached except restructuring the test, and a rule whose remedy is "write it differently" is a style
  // rule wearing a correctness rule's name.
  const lines = await reportedLines(RULE,
    inTest("  const bad = walk().filter((f) => f.x);\n  assert.deepEqual(bad, []);"),
    "packages/lab/src/packaging/zz-fixture-from-call.test.ts");
  assert.deepEqual(lines, []);
});

test("#1155: an exemption carries ONE OF TWO reasons, and the config says which for each", () => {
  // ceo's ruling: "controlled by a guard this rule cannot see" and "the vacuity is the point" are
  // different claims, and one option carrying both makes the list unreadable -- the failure an exemption
  // list exists to prevent. A third kind of reason is a ROW, not a third entry.
  const config = readFileSync(join(root, "eslint.config.js"), "utf8");
  assert.match(config, /"packages\/lab\/src\/packaging\/git-population-vacuity\.test\.ts": "demonstration"/);
  assert.match(config, /"packages\/lab\/src\/capture\/verify\.corpus\.test\.ts": "guarded-by labCorpusReadable"/,
    "the guarded-by reason must NAME the symbol -- `a guard exists` is the claim, and an unnamed one "
    + "cannot be checked against the file");
});

test("#1155: an exemption whose reason is neither shape is itself an ERROR", async () => {
  // Without this the list rots quietly: an entry reading "because it was failing" would silence a file
  // and nobody could tell an argued case from a suppressed one.
  const { ESLint } = await import("eslint");
  const strict = new ESLint({ cwd: root, overrideConfig: [{
    files: ["**/*.ts"],
    plugins: { probe: { rules: { "uncontrolled-emptiness": derivedLocalRule } } },
    rules: { "probe/uncontrolled-emptiness": ["error", { exempt: { "zz-fixture-bad-reason.test.ts": "it was noisy" } }] },
  }] });
  const [result] = await strict.lintText("export const x = 1;\n",
    { filePath: join(root, "zz-fixture-bad-reason.test.ts") });
  const hits = result.messages.filter((m) => m.ruleId === "probe/uncontrolled-emptiness");
  assert.equal(hits.length, 1, JSON.stringify(result.messages.map((m) => m.message)));
  assert.match(hits[0].message, /neither `demonstration` nor `guarded-by <symbol>`/);
});

test("#1155: a CONJUNCTION pins both its operands -- the shape that cost a redundant pin in #1160", () => {
  // `assert.ok(pr.length > 0 && nightly.length > 0, ...)` controls BOTH. The first detector required the
  // name to open the `assert.ok(` call, so it read a conjunct as no pin, reported an already-pinned site,
  // and the generated fix stacked a second pin on a working control.
  //
  // It is the same defect I had just corrected in #1123's own instrument -- that one required `.length`
  // to be followed by `,` or `)`, so `assert.ok(x.length >= 5)` read as no pin and the uncontrolled count
  // came out at twice its true size. A pin detector that recognises one SPELLING reports every other as
  // absent; mine recognised one POSITION.
  assert.equal(pinnedWithin('assert.ok(pr.length > 0 && nightly.length > 0, "both");', "nightly"), true);
  assert.equal(pinnedWithin('assert.ok(pr.length > 0 && nightly.length > 0, "both");', "pr"), true);
  assert.equal(pinnedWithin('assert.ok(other.length > 0);\nassert.deepEqual(x, []);', "nightly"), false,
    "and it must not run past the end of one call into the next");
});
