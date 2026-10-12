/**
 * NO NON-TEST FILE OF THE LAB IMPORTS ANOTHER REPOSITORY BY A RELATIVE PATH (a11ign/a11ign#5176, epic #4425 done-when 3; ADR 0045, Decision 1, rule 2).
 *
 * Twelve scripts and sources reached the core by `../../../scripts/…` and `../../../control/src/…`: paths that resolved only while the core laid the lab under its `packages/`. Nothing lays it
 * since a11ign/a11ign#5087, so every one of them failed with `ERR_MODULE_NOT_FOUND` from the lab's own checkout. A producer that does not export what a consumer needs is asked to export it
 * (`@a11ign/toolchain/lib/…`, `@a11ign/control/…`); the consumer never reads its source.
 *
 * The rule is read as a PATH, not as a count of `../`: a specifier is a reach when it resolves OUTSIDE the lab's root from the directory of the file that holds it, so `../../x.ts` is one
 * from `scripts/` and is not one from `src/training/`. Test files are not in the population (`labSources` drops them): they still read the core where it is laid, and that is a separate row.
 *
 * COMMENTS ARE STRIPPED FIRST, because a header that explains the old reach (`scripts/cross-repo-tests.ts` quotes one) is not one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stripComments } from "@a11ign/toolchain/lib/source-text";
import { LAB_ROOT, labSources } from "../product-checks/lab-sources.ts";

/** `from "<rel>"`, `import("<rel>")`, `import "<rel>"` and `require("<rel>")`, for a specifier that starts with `./` or `../`. */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`](\.{1,2}\/[^"'`]*)["'`]/g;

/** The relative specifiers of `source` (a file at `file`, absolute) that resolve outside `root`. */
export function reachesOutside(source: string, file: string, root: string): string[] {
  const found = [...stripComments(source).matchAll(RELATIVE_SPECIFIER)].map((match) => match[1]);
  return found.filter((specifier) => {
    const away = relative(root, resolve(dirname(file), specifier));
    return away.startsWith("..") || isAbsolute(away);
  });
}

const TS_OR_MJS = /\.(ts|mjs)$/;

/**
 * The four reaches that were NOT in a11ign/a11ign#5176's Region, because its Acceptance counts three `../` and these are two from `scripts/` (which is still outside the lab). They are named here so a
 * NEW one fails, and a11ign/a11ign#5182 swaps them for `@a11ign/toolchain/lib/git-env` and deletes this list. The test compares in both directions: a fixed file left in the list fails too, so the list
 * can only shrink.
 */
const KNOWN_UNTIL_5182 = [
  "scripts/check-rehearsal-currency.ts: ../../guards/src/git-env.ts",
  "scripts/claim-excludes-recompute.ts: ../../guards/src/git-env.ts",
  "scripts/evidence-check.ts: ../../guards/src/git-env.ts",
  "scripts/promote-model.ts: ../../guards/src/git-env.ts",
];

test("a relative import that leaves the lab is seen, from scripts/ at two levels and from src/ at three (negative control)", () => {
  const root = "/lab";
  const reach = 'import { pnpmCliInvocation } from "../../../scripts/npm-cli-executable.ts";\n';
  assert.deepEqual(reachesOutside(reach, join(root, "scripts/a.ts"), root), ["../../../scripts/npm-cli-executable.ts"]);
  assert.deepEqual(reachesOutside('import x from "../../scripts/a.ts";', join(root, "scripts/a.ts"), root), ["../../scripts/a.ts"]);
  assert.deepEqual(reachesOutside(reach, join(root, "src/gates/a.ts"), root), ["../../../scripts/npm-cli-executable.ts"]);
  assert.deepEqual(reachesOutside('const m = await import("../../../control/src/fleet-wake.ts");', join(root, "src/a/b.ts"), root),
    ["../../../control/src/fleet-wake.ts"]);
});

test("an import inside the lab, a package name and a commented-out reach are not reaches (the other direction)", () => {
  const root = "/lab";
  assert.deepEqual(reachesOutside('import { datasetRoot } from "../src/dataset-paths.ts";', join(root, "scripts/a.ts"), root), []);
  assert.deepEqual(reachesOutside('import x from "../../scripts/a.ts";', join(root, "src/training/a.mjs"), root), []);
  assert.deepEqual(reachesOutside('import x from "@a11ign/toolchain/lib/npm-cli-executable";', join(root, "scripts/a.ts"), root), []);
  assert.deepEqual(reachesOutside('// import x from "../../../scripts/a.ts";\n/* from "../../../b.ts" */', join(root, "src/a/b.ts"), root), []);
});

test("no non-test file of the lab imports by a relative path that leaves it", () => {
  const files = labSources(TS_OR_MJS);
  const labRelative = files.map((file) => relative(LAB_ROOT, file));
  // The positive control: the population is the one the twelve files were found in, so an empty or a shrunken walk cannot pass this test.
  for (const known of ["scripts/tool-source.ts", "scripts/corpus-release-nightly.ts", "src/gates/dispatch.ts", "src/training/page-server.mjs"]) {
    assert.ok(labRelative.includes(known), `${known} is not in the scanned population (${files.length} files)`);
  }
  const offenders = files.flatMap((file) => reachesOutside(readFileSync(file, "utf8"), file, LAB_ROOT)
    .map((specifier) => `${relative(LAB_ROOT, file)}: ${specifier}`));
  assert.deepEqual(offenders, KNOWN_UNTIL_5182,
    "a reach not in the list is new: import the producer's published export by name (`@a11ign/toolchain/lib/…`, `@a11ign/control/…`), or ask the producer to export it. A listed one that is missing is fixed: delete its line");
});
