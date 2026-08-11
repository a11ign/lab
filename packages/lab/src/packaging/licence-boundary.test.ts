/**
 * A permissively-licensed package may not import a copyleft one.
 *
 * `packages/evidence` is Apache-2.0 on purpose: ADR 0006 keeps the engine AGPL and the contracts
 * permissive so third parties can write capture backends without inheriting a copyleft obligation.
 * That split is described as effectively irreversible.
 *
 * `packages/nvda-speech` is derived from NVDA (GPL-2.0-or-later) and is therefore GPL. If a GPL-derived
 * import ever reaches the Apache-2.0 package, the licence is broken — not the architecture, the licence
 * — and it would break silently, because nothing about an `import` statement announces its provenance.
 *
 * This is the same reasoning as `spawned-paths.test.ts` and `doc-references.test.ts`: a claim that lives
 * only in prose rots. ADR 0006 states the boundary; this enforces it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const packagesDir = fileURLToPath(new URL("../../../../packages/", import.meta.url));

/** SPDX identifiers that carry a copyleft obligation an Apache-2.0 package cannot absorb. */
const COPYLEFT = /^(A?GPL|GPL)-/i;

/** Licences that must not import copyleft code. */
const PERMISSIVE = /^(Apache-2\.0|MIT|BSD|ISC)/i;

/** Below this, the scan has broken rather than the repo having shrunk. */
const MIN_PACKAGES = 5;

interface Pkg { dir: string; name: string; license: string; published: boolean }

function packages(): Pkg[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifest = join(packagesDir, entry.name, "package.json");
      if (!existsSync(manifest)) return [];
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as
        { name?: string; license?: string; private?: boolean };
      return [{
        dir: entry.name,
        name: parsed.name ?? entry.name,
        license: parsed.license ?? "UNSTATED",
        published: parsed.private !== true,
      }];
    });
}

/** Does this source actually import the package, as opposed to merely naming it? */
function importsPackage(source: string, name: string): boolean {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    // ESM `from "pkg"` / `import "pkg"`, dynamic `import("pkg")`, CJS `require("pkg")`, and a Python
    // `import pkg` / `from pkg import ...` for the .py sources.
    `(?:from|import)\\s*\\(?\\s*["'\`]${quoted}(?:/[^"'\`]*)?["'\`]`
    + `|require\\s*\\(\\s*["'\`]${quoted}(?:/[^"'\`]*)?["'\`]`
    + `|^\\s*(?:from|import)\\s+${quoted.replace(/-/g, "_")}\\b`,
    "m",
  ).test(source);
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["dist", "node_modules", "__pycache__", "reference"].includes(entry.name) ? [] : sourceFiles(full);
    }
    return /\.(ts|mts|mjs|js|py)$/.test(entry.name) ? [full] : [];
  });
}

test("every package declares a licence", () => {
  // An unstated licence cannot be checked, so it must not be possible to add one quietly.
  const unstated = packages().filter((p) => p.license === "UNSTATED").map((p) => p.dir);
  assert.deepEqual(unstated, [], `packages with no "license" field: ${unstated.join(", ")}`);
});

test("no permissively-licensed package imports a copyleft one", () => {
  const all = packages();
  const copyleft = all.filter((p) => COPYLEFT.test(p.license));
  const permissive = all.filter((p) => PERMISSIVE.test(p.license));

  // Guard the guard. If the manifests stop being readable this test would pass having compared nothing,
  // which is this repo's most-repeated failure mode.
  assert.ok(all.length > MIN_PACKAGES, `only found ${all.length} packages; the scan is broken`);
  assert.ok(copyleft.length > 0, "no copyleft package found — has nvda-speech been renamed or relicensed?");
  assert.ok(permissive.length > 0, "no permissive package found — has evidence been relicensed?");

  // An IMPORT, not a mention. A substring search over whole files flagged
  // `"dct:title": "a11y-witness"` in `earl.ts` — the tool naming ITSELF in its own EARL output — as a
  // licence violation. A check that cannot tell an import from a string literal reports a compliance
  // failure for a product name, which is the "check that cannot discriminate" pattern this repo keeps
  // paying for.
  const violations = permissive.flatMap((consumer) =>
    sourceFiles(join(packagesDir, consumer.dir)).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return copyleft
        .filter((dependency) => importsPackage(source, dependency.name))
        .map((dependency) =>
          `${relative(packagesDir, file)} (${consumer.license}) imports ${dependency.name} (${dependency.license})`);
    }));

  assert.deepEqual(violations, [],
    "a permissively-licensed package references copyleft code. ADR 0006 keeps the contracts package "
    + "permissive so third parties can write capture backends; a GPL-derived import removes that "
    + `freedom for every consumer:\n  ${violations.join("\n  ")}`);
});

test("every PUBLISHED copyleft package ships its licence text", () => {
  // Scoped to published packages, because the obligation attaches to DISTRIBUTION. `packages/lab` is
  // AGPL and has no LICENSE file — which this test found, and which is fine precisely because it is
  // `private: true` and never leaves the repo. Asserting on it anyway would have been a false positive
  // that got the whole guard deleted.
  //
  // `nvda-speech` is private too, and ships the text regardless: it is derived from someone else's
  // GPL work, so the notice is about honouring their licence rather than satisfying ours.
  for (const pkg of packages().filter((p) => COPYLEFT.test(p.license) && p.published)) {
    const licence = join(packagesDir, pkg.dir, "LICENSE");
    assert.ok(existsSync(licence), `${pkg.dir} is ${pkg.license} but has no LICENSE file`);
    assert.ok(statSync(licence).size > 10_000, `${pkg.dir}/LICENSE looks truncated, not the full text`);
  }
});
