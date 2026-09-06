/**
 * The `.mjs` half of this repo is not typechecked BY DEFAULT, and this is the record of how much of it is.
 *
 * Measured 2026-08-26: **26,102 lines of `.mjs` against 9,776 of `.ts`** — 73% of source lines outside
 * `tsc` entirely, and that 73% includes the capture path, where this repo has paid most for its defects.
 *
 * It is not academic. `captureFault(code, message)` was called as `captureFault(message, code)` at two
 * sites, so seven real-page failures logged a bare `wrong-page` naming neither the page shown nor the page
 * asked for, and `faultCode()` returned an Error OBJECT so nothing keyed on fault codes could classify
 * them. **TypeScript rejects that call** — the JSDoc types declare `(code: string, message: string)` and
 * `tsc` flagged it the moment a `.ts` test tried it. The types knew and could not help, because nothing
 * checks `.mjs`.
 *
 * ## Why this is opt-in per file rather than a flag
 *
 * `checkJs` on the whole tree is 1,974 errors, or 131 with `noImplicitAny` off — real work, and mostly
 * type inaccuracies rather than bugs (`log = () => {}` infers zero-arg; an optional field not marked
 * optional). A file ALLOWLIST cannot isolate it, because TypeScript follows imports and `checkJs` applies
 * program-wide.
 *
 * So: `checkJs` OFF, `@ts-check` per file. Only marked files are checked, imports come along unchecked,
 * and the list can grow one verified file at a time.
 *
 * ## ONE PROGRAM, not two — `tsconfig.mjs.json` deleted 2026-09-06
 *
 * This used to run `tsc --noEmit` twice: once against the root config, once against a second
 * `tsconfig.mjs.json` that turned `allowJs`/`checkJs` on and widened `include` to the `.mjs` trees — built
 * on the theory that turning `allowJs` on in the ROOT config would pull every `.mjs` into the MAIN program
 * through the import graph, where `@ts-check` then fails under strict, so a second, narrower program was
 * needed to keep the two apart.
 *
 * **That theory stopped being true at some point before 2026-09-06 and nobody re-checked it.** The root
 * `tsconfig.json` already has `allowJs: true` and already lists every `.mjs` tree in its own `include`
 * (see that file's own comment: *"AND THE .mjs, or `// @ts-check` is a comment"*) — so the ONE program
 * already does everything the second one was built to do, and had been doing so for a while. Measured
 * rather than assumed: `tsc --listFiles -p tsconfig.json` and `tsc --listFiles -p tsconfig.mjs.json`,
 * `comm -13`'d — **zero files unique to the second config**, out of 880. It was a complete duplicate,
 * doubling `typecheck`'s wall time (2.68 s -> 2.69 s per pass, measured) inside CI and the pre-push budget
 * for no additional coverage.
 *
 * Checked before deleting, not assumed: `TS5055` ("would overwrite input file") is a real, unrelated
 * constraint elsewhere in this repo (`worker-code-check.mjs`, `code-drift.mjs` — a PER-PACKAGE build
 * project colliding on relative imports across a package boundary, worked around with a subpath import).
 * It has nothing to do with the root-level `tsc --noEmit` typecheck pass this file is about; `git grep`
 * for `tsconfig.mjs.json` before deleting it found exactly one consumer (`package.json`'s `typecheck`
 * script) and one test (this file) — nothing else read it or depended on its separate existence.
 *
 * ## The count used to be of MARKERS, which is not the same as coverage
 *
 * Measured 2026-08-27: **21 of the 53 files this test counted as checked were outside the `tsc` program
 * entirely**, so their `// @ts-check` was a comment. The root config included only the `.ts` under each
 * package's `src` and `scripts`, so an `.mjs` reached the program solely by being imported from an
 * included `.ts` — and a script nobody imports never was. The real figure was 32 of 107.
 *
 * (That sentence originally quoted the glob itself, which ends a JSDoc block at its first `*` followed by
 * `/` and moved the syntax error nine lines away from its cause. The same shape as the backtick that once
 * terminated a template literal here. Globs go in code, not in block comments.)
 *
 * Proved rather than reasoned: planting `const X: number = "s"` in a marked file produced NO error.
 * A zero that means "examined nothing" is this repo's oldest defect, here inside the metric that reports
 * how much is examined.
 *
 * Including the `.mjs` directories fixed it and cost five errors — every one in a file whose marker had
 * been inert, and two of them real narrowing bugs where a runtime `assert` does not narrow for the
 * compiler. `every marked file is in the tsc program` below is what stops the gap reopening: a marker
 * outside the include patterns now fails rather than reassuring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

function everyMjs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) everyMjs(rel, found);
    else if (entry.name.endsWith(".mjs")) found.push(rel);
  }
  return found;
}

const MJS = everyMjs("packages");
/** A marker anywhere in the first two lines: a SHEBANG must stay line one, and `@ts-check` follows it. */
const CHECKED = MJS.filter((path) =>
  readFileSync(join(REPO, path), "utf8").split("\n", 2).some((line) => line === "// @ts-check"));

/**
 * The floor, which MAY ONLY RISE.
 *
 * A count nobody can fall below is the difference between a gap that closes and one that quietly widens —
 * the same shape as the CLI flag guards' `UNGUARDED` list. Raise this when you mark more files; it should
 * never need lowering, and lowering it is the review conversation.
 */
const AT_LEAST = 107;

test("the typechecked `.mjs` count never falls", () => {
  assert.ok(CHECKED.length >= AT_LEAST,
    `${CHECKED.length} of ${MJS.length} .mjs files carry \`// @ts-check\`, down from ${AT_LEAST}. `
    + `Removing the marker un-checks a file that was verified — if a file legitimately cannot be checked, `
    + `say why here rather than dropping the floor silently`);
});

test("a marker never displaces a shebang", () => {
  // Inserting `// @ts-check` at line 1 pushed `#!/usr/bin/env node` to line 2, where it is a syntax
  // error — caught by lint, not by me. An executable that no longer parses is a worse outcome than an
  // unchecked one, so the order is asserted rather than remembered.
  for (const path of CHECKED) {
    const [first, second] = readFileSync(join(REPO, path), "utf8").split("\n", 2);
    if (first.startsWith("#!")) {
      assert.equal(second, "// @ts-check", `${path}: the marker must FOLLOW the shebang, never precede it`);
    } else {
      assert.equal(first, "// @ts-check", `${path}: the marker must be the first line`);
    }
  }
});

test("a marked file is one the ONE program actually covers, and checkJs stays opt-in", () => {
  // A marker in a file the config never reads is a comment. `tsconfig.json` must include the `.mjs`
  // trees these live in, or `npm run typecheck` reports success having checked none of them. No SECOND
  // config to check any more — see this file's header for why `tsconfig.mjs.json` was deleted.
  const config = readFileSync(join(REPO, "tsconfig.json"), "utf8");
  for (const pattern of ["packages/*/src/**/*.mjs", "packages/*/scripts/**/*.mjs"]) {
    assert.ok(config.includes(pattern), `tsconfig.json must include ${pattern}`);
  }
  assert.doesNotMatch(config, /"checkJs":\s*true/,
    "checkJs must stay OFF (absent, or explicitly false): with it on, every imported .mjs is checked too "
    + "and the per-file opt-in means nothing");
  const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
  assert.doesNotMatch(scripts.typecheck, /tsconfig\.mjs\.json/,
    "a second tsconfig.mjs.json pass has come back -- confirm it is not a re-introduced duplicate of "
    + "tsconfig.json's own coverage (this file's header explains how to check) before restoring it");
  assert.match(scripts.typecheck, /tsc --noEmit/,
    "npm run typecheck must still actually run tsc, or none of this is enforced anywhere");
});

/**
 * The tsconfig `include` patterns, as regexes. Read from the file rather than restated, because a pattern
 * spelled twice is this repo's most expensive shape and this test exists to catch exactly that class.
 */
function includePatterns(): RegExp[] {
  const raw = readFileSync(join(REPO, "tsconfig.json"), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
  const include: string[] = JSON.parse(raw).include;
  return include.map((glob) => new RegExp(`^${glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*/g, "[^/]*")}$`));
}

test("every marked file is IN the tsc program, so a marker can never be a comment", () => {
  // THE DEFECT THIS FILE HAD. `// @ts-check` on a file the compiler never opens is inert, and the count
  // above read it as coverage -- 21 of 53 files, and the metric said 53. Nothing could have noticed,
  // because the symptom of an unchecked file is silence, which is also the symptom of a clean one.
  //
  // Asserted structurally against the include globs rather than by running `tsc --listFiles`: a unit test
  // that shells out to the compiler is one people stop running, and membership by glob is decidable here
  // because every source file lives under `packages/`.
  const patterns = includePatterns();
  const inert = CHECKED.filter((path) => !patterns.some((pattern) => pattern.test(path)));
  assert.deepEqual(inert, [],
    `${inert.length} file(s) carry \`// @ts-check\` and are outside every tsconfig include pattern, so `
      + "the compiler never opens them and the marker does nothing. Add the directory to `include`, or "
      + "remove the marker -- but do not leave a file claiming to be checked when it is not.");
});

test("the include patterns reach every .mjs, so marking one is always enough", () => {
  // The other half: a file can only be marked usefully if the patterns would cover it. Without this, the
  // next `.mjs` in a new directory is silently unmarkable and the failure looks like "it passes".
  const patterns = includePatterns();
  const unreachable = MJS.filter((path) => !patterns.some((pattern) => pattern.test(path)));
  assert.deepEqual(unreachable, [],
    `${unreachable.length} .mjs file(s) match no tsconfig include pattern, so adding \`// @ts-check\` to `
      + "them would do nothing. Widen `include` before marking them.");
});
