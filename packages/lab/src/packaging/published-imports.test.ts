/**
 * A PUBLISHED PACKAGE MUST NOT IMPORT A PRIVATE ONE.
 *
 * Not a style rule — a broken publish. `npm install a11y-witness` resolves dependencies from the registry,
 * and a private package is not there, so the import fails on a USER'S machine and nowhere else. It works
 * in this workspace, where every package is a symlink, right up until somebody installs it.
 *
 * ## What it is really protecting
 *
 * The product/harness boundary. `a11y-witness` (the CLI) is what ships; `lab` is the corpus generator, the
 * trainer, the Python calls and the ansible dispatch; `control` holds the fleet credentials. The CLI
 * importing any of that would drag the entire research apparatus into a published artefact.
 *
 * That boundary HELD when this was written — measured across all 6 published packages, zero violations —
 * which is exactly when it is worth pinning. A boundary that holds by luck is one nobody notices breaking:
 * `licence-boundary.test.ts` covers copyleft direction and `project-references.test.ts` covers that a
 * cross-package import is declared, but NOTHING covered this direction, and adding one import to `cli`
 * would have gone unremarked.
 *
 * ## Both spellings, because either would break a publish
 *
 * By package name (`@a11y-witness/lab`) and by relative path (`../../lab/src/...`). The second is how this
 * repo legitimately reaches across packages when `node_modules` must not be involved — `packages/control`
 * does it deliberately — so it is a real route, not a hypothetical one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));
const PACKAGES = join(REPO, "packages");

type Pkg = { dir: string; name: string; private: boolean };

function packages(): Pkg[] {
  const out: Pkg[] = [];
  for (const dir of readdirSync(PACKAGES)) {
    try {
      const p = JSON.parse(readFileSync(join(PACKAGES, dir, "package.json"), "utf8"));
      out.push({ dir, name: p.name, private: Boolean(p.private) });
    } catch { /* not a package: the directory has no manifest, which is not this test's business */ }
  }
  return out;
}

/** Source files only — a test importing a private helper is fine, it is never published. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!full.includes("node_modules") && !full.includes("/dist")) sources(full, out);
    } else if (/\.(mjs|ts)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

/** Imports, with comments removed — prose about an import is not an import. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(([, spec]) => spec);
}

test("no PUBLISHED package imports a PRIVATE one — that is a broken publish, not a style choice", () => {
  const all = packages();
  const byDir = new Map(all.map((p) => [p.dir, p]));
  const privateNames = new Set(all.filter((p) => p.private).map((p) => p.name));
  const violations: string[] = [];

  /** What this one import violates, if anything. Extracted to keep the walk within the depth gate. */
  const offence = (file: string, spec: string): string | null => {
    // By package name.
    if (privateNames.has(spec) || [...privateNames].some((n) => spec.startsWith(`${n}/`))) {
      return `${file.slice(REPO.length)} imports ${spec}`;
    }
    // By relative path across the package boundary — the route `packages/control` uses on purpose, so it
    // must be checked rather than assumed impossible.
    const across = /\.\.\/([a-z-]+)\//.exec(spec);
    const target = across && byDir.get(across[1]);
    return target?.private ? `${file.slice(REPO.length)} imports ${spec} (${target.name})` : null;
  };

  for (const pkg of all.filter((p) => !p.private)) {
    for (const file of sources(join(PACKAGES, pkg.dir))) {
      violations.push(...importsOf(file).map((spec) => offence(file, spec)).filter((v): v is string => v !== null));
    }
  }

  assert.deepEqual(violations, [],
    "a published package cannot resolve a private one from the registry: this works in the workspace, "
    + "where every package is a symlink, and fails on a user's machine");
});

test("the discovery is real, so this cannot pass having examined nothing", () => {
  // The count assertion this repo puts on every discovery walk. Both halves must be non-empty, or the
  // test above is comparing an empty list to an empty list and reporting success.
  const all = packages();
  assert.ok(all.filter((p) => !p.private).length >= 5,
    `only ${all.filter((p) => !p.private).length} published package(s) found; the walk is broken`);
  assert.ok(all.filter((p) => p.private).length >= 2,
    `only ${all.filter((p) => p.private).length} private package(s) found; nothing to violate`);
  assert.ok(sources(join(PACKAGES, "cli")).length > 0, "the CLI has sources, or nothing was scanned");
});
