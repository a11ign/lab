/**
 * #1213: A SOURCE-READING GUARD THAT DOES NOT STRIP COMMENTS CAN BE SATISFIED BY PROSE.
 *
 * Four instances in one night, in four files, to two sessions:
 *
 *   org-watch.test.ts (#1072)            review -- passed only because the author's own comment spelled
 *                                        the value without its `EXIT.` prefix
 *   capture-url-lifetime.test.ts (#1200) went RED against correct code, matching a comment at its own
 *                                        new call site
 *   tab-probe-start-position.test.ts     review -- a comment naming the call left the suite 7/0 GREEN
 *     (#1205)                            with the reset gone
 *   fleet-playbook.test.ts (#1204)       the author stripped while building, having seen the other three
 *
 * **Three of the four were written AFTER the first was fixed, by people who knew about it.** That is why
 * this is a derived guard and not four edits.
 *
 * ## THE LIVE COUNT ON MAIN IS ZERO, AND THAT IS THE MEASUREMENT RATHER THAN A HOPE
 *
 * Measured at `fbb08de3`: 52 source-bound variables in unstripped test files, 87 assertions bound to
 * one of them, and **3 satisfied only by prose -- all three deliberate.** Every real instance was caught
 * as it happened. So this guard exists to catch the NEXT one, not to clean up a backlog.
 *
 * ## AND THE OBVIOUS FIX IS WRONG: A BLANKET STRIP WOULD BREAK ALL THREE
 *
 * Some guards read prose ON PURPOSE, and the strongest case is not an exception at all -- **in a `.mjs`
 * file a JSDoc type IS a comment**, so a guard asserting a type contract has no code form to match.
 * `EXEMPT` below carries that reason per file. An exemption saying only "this one does not strip" is the
 * defect wearing a table.
 *
 * ## WHAT IS DERIVED AND WHAT IS TYPED
 *
 * The population is derived at run time from `git ls-files`, because a typed list is exactly how the
 * first three came to be written after the first was fixed. Only the EXEMPTIONS are typed, and each is
 * pinned: an exemption naming a file that no longer reads source, or that no longer has a prose-only
 * match, fails -- so the table cannot rot into a list of names nobody has checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../../");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A file strips if it uses the shared helper or performs the block-and-line strip itself. */
const strips = (source: string): boolean =>
  /stripComments/.test(source) || source.includes("/\\/\\*[\\s\\S]*?\\*\\//g");

/**
 * Guards that read prose DELIBERATELY, each with the reason a comment is the right subject.
 *
 * The reason must say why the claim has no code form. "It does not strip" is not a reason.
 */
const EXEMPT: Record<string, string> = {
  "packages/nvda-worker/src/census-read-moment.test.ts":
    "asserts a JSDoc @typedef -- `sinceStart: () => number }} CaptureDiagnostics`. In a `.mjs` file the "
    + "TYPE IS A COMMENT, so there is no code form of this claim to match. Stripping would delete the "
    + "contract it exists to hold.",
  "packages/nvda-worker/src/disclosure-after-is-focus.test.ts":
    "slices from `// Activate a disclosure` as an ANCHOR -- the comment marks the region, and stripping "
    + "removes the landmark rather than the subject.",
  "packages/lab/src/training/case-matrix.test.ts":
    "#1209: asserts that a specific PARAGRAPH still exists in case-matrix.mjs, because this file points "
    + "readers at it. The target is prose by design, and a pointer whose target is unpinned reads as "
    + "working -- which is the defect #1209 was filed for.",
};

/** Test files that bind a variable to the TEXT of a source file, with that variable's target. */
function sourceBoundVariables(): { file: string; variable: string; target: string; source: string }[] {
  const files = execFileSync("git", ["ls-files", "*.test.ts"],
    { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" }).trim().split("\n");
  const found: { file: string; variable: string; target: string; source: string }[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(REPO, file), "utf8");
    if (strips(source)) continue;
    for (const m of source.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*readFileSync\(([^;]*?)\)/g)) {
      const literal = /["`']([^"`']*\.(?:mjs|ts))["`']/.exec(m[2]);
      if (!literal) continue;
      const target = resolve(dirname(resolve(REPO, file)), literal[1].replace(/^\.\//, ""));
      if (existsSync(target)) found.push({ file, variable: m[1], target, source });
    }
  }
  return found;
}

/** Patterns asserted or sliced against `variable` specifically -- never merely present in the file. */
function patternsBoundTo(source: string, variable: string): string[] {
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...[...source.matchAll(new RegExp(`assert\\.\\w+\\(\\s*${variable}\\s*,\\s*\\/([^/\\n]+)\\/`, "g"))]
      .map((m) => m[1]),
    ...[...source.matchAll(
      new RegExp(`${variable}\\.(?:includes|indexOf|search)\\(\\s*["\`']([^"\`'\\n]{6,})["\`']`, "g"))]
      .map((m) => escaped(m[1])),
  ];
}

/** Every file with at least one pattern that matches the raw source and NOT the stripped source. */
function proseSatisfiable(): Map<string, string[]> {
  const live = new Map<string, string[]>();
  for (const { file, variable, target, source } of sourceBoundVariables()) {
    const raw = readFileSync(target, "utf8");
    const stripped = stripComments(raw);
    for (const pattern of patternsBoundTo(source, variable)) {
      let re: RegExp;
      try { re = new RegExp(pattern); } catch { continue; }
      if (re.test(raw) && !re.test(stripped)) {
        live.set(file, [...(live.get(file) ?? []), pattern]);
      }
    }
  }
  return live;
}

test("#1213: the population is real -- this cannot pass having examined nothing", () => {
  // The walk, the binding and the pattern extraction are three places this can silently find nothing,
  // and all three would leave the assertion below green over an empty set.
  const bound = sourceBoundVariables();
  assert.ok(bound.length > 20,
    `only ${bound.length} source-bound variable(s) found in unstripped test files; the derivation is `
    + "broken and every check here would pass having examined none of them");
  const patterns = bound.flatMap((b) => patternsBoundTo(b.source, b.variable));
  assert.ok(patterns.length > 40,
    `only ${patterns.length} assertion(s) are bound to one of those variables; the extraction is broken`);
});

test("#1213: every prose-satisfiable guard either strips, or is EXEMPT with a reason", () => {
  const live = proseSatisfiable();
  const unaccounted = [...live.keys()].filter((f) => !(f in EXEMPT)).sort();
  assert.deepEqual(unaccounted, [],
    `${unaccounted.length} guard(s) assert a pattern that matches the source's COMMENTS and not its `
    + "code, so the claim is currently held by prose. Strip the source before asserting "
    + "(`stripComments` from `@a11ign/evidence/source-text`), or add an EXEMPT entry saying why the "
    + `claim has NO CODE FORM -- "it does not strip" is not a reason:\n  `
    + unaccounted.map((f) => `${f}\n      ${(live.get(f) ?? []).join("\n      ")}`).join("\n  "));
});

test("#1213: every EXEMPT entry still names a live prose-satisfiable guard, so the table cannot rot", () => {
  const live = proseSatisfiable();
  const phantom = Object.keys(EXEMPT).filter((f) => !live.has(f)).sort();
  assert.deepEqual(phantom, [],
    `${phantom.length} exemption(s) name a file that no longer reads prose -- either it now strips, or `
    + "its assertion changed. An exemption whose subject is gone is debris, and it makes this table look "
    + `like it covers more than it does:\n  ${phantom.join("\n  ")}`);
});

test("#1213: the exemptions say why the claim has no CODE form, not that the file lacks a strip", () => {
  // The reason is the whole value of the table. A file-by-file list with no reasons is the defect
  // wearing a table, and it is what makes the next reader add a fourth name instead of asking.
  // NO LENGTH FLOOR HERE, deliberately -- #1067's guard flagged one I had written and it was right to.
  // A character count is a PROXY for "carries a reason" and a long restatement of the symptom passes it,
  // which is the only failure this test exists to catch. The check below is the real one.
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(!/does not strip|no strip|unstripped/i.test(reason),
      `${file}'s exemption restates the symptom instead of giving the reason: ${reason}`);
  }
});
