/**
 * EVERY DECLARED EXPORT MUST POINT INSIDE WHAT THE TARBALL ACTUALLY SHIPS.
 *
 * `"exports"` and `"files"` are two lists that have to agree and nothing compared them. An export naming a
 * path outside the `files` allowlist resolves perfectly in this workspace — where every package is a
 * symlink to its own source tree — and fails on a consumer's machine with `ERR_MODULE_NOT_FOUND`. That is
 * the same "works here, breaks there" class `published-imports.test.ts` covers for private dependencies,
 * pointed at the package's own file list instead.
 *
 * ## The defect that prompted it, found by an outside architecture audit and confirmed here
 *
 * `@a11y-witness/worker-fleet` mapped `./cli-flags` to `./src/cli-flags.mjs` while its `files` shipped
 * `dist`, `src/local-worker` and `src/provisioning` — no top-level `src/*.mjs`. `npm pack --dry-run`
 * produced 133 files including `dist/cli-flags.mjs` and not the exported path. **It is the most-imported
 * subpath in the repo: 42 sites**, every one of them in the private `lab`, which is why nothing noticed.
 *
 * ## Why the gate that exists for this could not see it
 *
 * `scripts/isolation-gate.mjs` opens by naming this exact failure — *"`exports` subpaths that do not
 * resolve the paths the README tells people to import"* — and it answers it by installing the tarball and
 * running the package's own SMOKE TEST. A smoke test only exercises the subpaths it happens to import, and
 * `cli/isolation-smoke.mjs` never imports `./cli-flags`. So the gate was green over an unresolvable export
 * for as long as the export existed: a check that passes having examined nothing, one layer out from where
 * the repo had been looking.
 *
 * This test is the complement, not a replacement. The gate proves a real install WORKS; this proves every
 * declared entry point COULD, without needing anyone to remember to import it in a smoke test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));

interface Manifest {
  name?: string; private?: boolean;
  files?: string[];
  exports?: Record<string, unknown> | string;
}

function publicPackages(): { dir: string; manifest: Manifest }[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PACKAGES, e.name, "package.json")))
    .map((e) => ({
      dir: join(PACKAGES, e.name),
      manifest: JSON.parse(readFileSync(join(PACKAGES, e.name, "package.json"), "utf8")) as Manifest,
    }))
    // A private package is never installed from a registry, so "would this resolve from a tarball" has no
    // meaning for it — the same exemption `isolation-gate.mjs` makes, for the same stated reason.
    .filter(({ manifest }) => !manifest.private);
}

/** Every path an `exports` map can name, flattened out of its conditions. */
function exportTargets(exports: Manifest["exports"]): { subpath: string; target: string }[] {
  if (!exports) return [];
  if (typeof exports === "string") return [{ subpath: ".", target: exports }];
  const out: { subpath: string; target: string }[] = [];
  for (const [subpath, value] of Object.entries(exports)) {
    if (typeof value === "string") { out.push({ subpath, target: value }); continue; }
    // Conditions ("types", "default", "import", …). Every branch is a path a consumer can land on, so
    // checking only `default` would let a `types` entry point at a file the tarball drops — which is the
    // same defect wearing a different key.
    for (const condition of Object.values(value as Record<string, unknown>)) {
      if (typeof condition === "string") out.push({ subpath, target: condition });
    }
  }
  return out;
}

/**
 * Does `files` ship this path? `files` entries are directories or paths, matched by prefix — the same way
 * npm treats them. Deliberately NOT a glob engine: this repo's `files` lists are plain paths, and
 * reimplementing npm's matching would be a second spelling of npm's own rules that could drift from it.
 */
function shipped(files: string[] | undefined, target: string): boolean {
  // No `files` at all means npm ships everything not otherwise ignored, so nothing to check.
  if (!files?.length) return true;
  const path = target.replace(/^\.\//, "");
  // npm ALWAYS includes these regardless of `files`, so an export naming one is shipped even though the
  // list does not mention it. `a11y-witness` exports `./package.json`, which is legitimate and common —
  // treating it as a defect would be this check crying wolf on its first run, which is how a new gate
  // gets switched off. Only these five, matched exactly: npm's own always-included set.
  if (["package.json", "README.md", "LICENSE", "LICENCE", "CHANGELOG.md"].includes(path)) return true;
  return files.some((entry) => {
    const allowed = entry.replace(/^\.\//, "").replace(/\/$/, "");
    return path === allowed || path.startsWith(`${allowed}/`);
  });
}

test("every declared export points at a path the package's own `files` list ships", () => {
  const packages = publicPackages();
  // VACUITY GUARD. A discovery test that finds nothing passes for the wrong reason, and this repo has
  // shipped one before: a regex scrape that matched no signal types asserted over an empty set and passed.
  assert.ok(packages.length >= 4, `expected to discover the public packages, found ${packages.length}`);

  let checked = 0;
  for (const { dir, manifest } of packages) {
    for (const { subpath, target } of exportTargets(manifest.exports)) {
      checked += 1;
      assert.ok(shipped(manifest.files, target),
        `${manifest.name} exports "${subpath}" as ${target}, which its \`files\` list does not ship `
        + `(${JSON.stringify(manifest.files)}). It resolves in this workspace by symlink and fails from a `
        + "tarball with ERR_MODULE_NOT_FOUND. Point it at a shipped path, or add the path to `files`.");
      // AND THE FILE MUST EXIST after a build. `files` shipping `dist` says nothing about whether the
      // build writes this particular file — an export naming a module the build never emits is the same
      // failure with an extra step, and `npm pack` would ship the directory and not the file.
      const built = existsSync(join(dir, target));
      assert.ok(built,
        `${manifest.name} exports "${subpath}" as ${target}, which does not exist. Run \`npm run build\` `
        + "first; if it is still missing, the build does not emit it and no consumer can import it.");
    }
  }
  assert.ok(checked >= 6, `expected to check several export subpaths, checked ${checked}`);
});

test("the most-imported subpath in the repo is one a consumer could actually import", () => {
  // Named specifically, because the general check above is only as good as its discovery and this is the
  // entry point 42 sites depend on. A regression here breaks every one of them from a tarball at once.
  const manifest = JSON.parse(
    readFileSync(join(PACKAGES, "worker-fleet", "package.json"), "utf8")) as Manifest;
  const target = exportTargets(manifest.exports).find((e) => e.subpath === "./cli-flags")?.target;
  assert.ok(target, "@a11y-witness/worker-fleet must still export ./cli-flags");
  assert.ok(shipped(manifest.files, target!), `./cli-flags points at ${target}, which is not shipped`);
  assert.match(target!, /^\.\/dist\//,
    "every other subpath in this package resolves through `dist`; an export reaching into `src` is the "
    + "one that was unresolvable from a tarball for as long as it existed");
});
