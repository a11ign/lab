/**
 * The `.mjs` half of this repo is not typechecked, and this is the record of how much of it is.
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
 * optional). Two things were tried and do not work: a file ALLOWLIST cannot isolate, because TypeScript
 * follows imports and `checkJs` applies program-wide; and turning `allowJs` on in the ROOT config pulls
 * every `.mjs` into the main program through the import graph, where `@ts-check` then fails under strict.
 *
 * So: `checkJs` OFF, `@ts-check` per file, a second `tsc` pass. Only marked files are checked, imports
 * come along unchecked, and the list can grow one verified file at a time.
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
const AT_LEAST = 16;

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

test("a marked file is one the second pass actually covers", () => {
  // A marker in a file the config never reads is a comment. `tsconfig.mjs.json` must include the trees
  // these live in, or `npm run typecheck` reports success having checked none of them.
  const config = readFileSync(join(REPO, "tsconfig.mjs.json"), "utf8");
  for (const pattern of ["packages/*/src/**/*.mjs", "packages/*/scripts/**/*.mjs"]) {
    assert.ok(config.includes(pattern), `tsconfig.mjs.json must include ${pattern}`);
  }
  assert.match(config, /"checkJs":\s*false/,
    "checkJs must stay OFF: with it on, every imported .mjs is checked too and the opt-in means nothing");
  const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
  assert.match(scripts.typecheck, /tsconfig\.mjs\.json/,
    "npm run typecheck must run the second pass, or none of this is enforced anywhere");
});
