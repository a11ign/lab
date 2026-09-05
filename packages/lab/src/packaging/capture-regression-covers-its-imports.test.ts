/**
 * THE CAPTURE REGRESSION MUST FIRE ON EVERY FILE ITS HARNESS DEPENDS ON.
 *
 * `capture-regression.yml` is the only automated check that drives real NVDA, and it is path-filtered.
 * A filter narrower than the harness's own dependencies is a check that silently stops running for the
 * change that needed it — and this workflow has already done that once, which its own comment records: an
 * M8 rewrite pointed `src/capture/**` at `packages/lab/src/capture/**`, "a directory holding two lab files
 * and no capture code at all", so it "would then have fired on lab edits and NEVER on a worker change".
 *
 * MEASURED 2026-09-05, and it had happened again by a different route. `capture-check.mjs` reaches six
 * files and THREE were outside every pattern:
 *
 *   packages/lab/src/capture/capture-client.mjs    how the harness talks to a worker at all
 *   packages/worker-fleet/src/worker-http.mjs      the HTTP client every capture goes through
 *   packages/worker-fleet/src/host-address.mjs
 *
 * So a change to the code that DISPATCHES a capture never triggered the job that tests capturing. Not
 * hypothetical: `capture-client.mjs` was changed that same day — deadline clipping and lost-acknowledgement
 * recovery, both squarely on the capture path — and the filter would not have fired on any of it. The
 * `pull_request` trigger was worse still: it did not list the harness itself.
 *
 * ## Why derive rather than list
 *
 * A hand-written path list is a second spelling of the import graph, and the graph moves. This walks the
 * real imports from the real entry point, so the next `import` cannot slip through the same way — the
 * same shape as `code-version.test.ts`'s transitive walk over the worker's hashed files, aimed at CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ENTRY = "packages/lab/src/harnesses/capture-check.mjs";

/**
 * A `@a11y-witness/<pkg>[/<subpath>]` specifier resolves through `node_modules` to that package's
 * `dist`, built from the SAME source this walk must reach — so it is followed back to its SOURCE file via
 * the package's own `exports` map, the identical translation
 * `worker-fleet-does-not-read-control.test.ts`'s `publishedEntryPoints()` already does in the other
 * direction (source -> dist). Without this, repointing an import from a relative path to its package's
 * declared export — exactly the §3.3 fix this repo's own architecture audit asked for — would silently
 * blind this walker, which is the "a remedy in one place breaks a check relying on the old shape"
 * shape this repo's CLAUDE.md names as its most expensive recurring defect.
 */
function internalSourceFile(specifier: string): string | undefined {
  const match = /^@a11y-witness\/([^/]+)(\/.*)?$/.exec(specifier);
  if (!match) return undefined;
  const [, pkgName, subpath] = match;
  const pkgDir = resolve(ROOT, "packages", pkgName);
  const pkgJsonFile = resolve(pkgDir, "package.json");
  if (!existsSync(pkgJsonFile)) return undefined;
  const pkgJson = JSON.parse(readFileSync(pkgJsonFile, "utf8"));
  const exportEntry = pkgJson.exports?.[subpath ? `.${subpath}` : "."];
  const distTarget: string | undefined = exportEntry?.default;
  if (!distTarget) return undefined;
  const name = distTarget.replace(/^\.\/dist\//, "");
  const sourceName = name.endsWith(".js") ? name.replace(/\.js$/, ".ts") : name; // .mjs is copied verbatim
  const source = resolve(pkgDir, "src", sourceName);
  return existsSync(source) ? source : undefined;
}

/** Every local file the harness reaches, transitively — both by relative import and by package name into
 *  a sibling `@a11y-witness/*` workspace. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const found of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      let target = resolve(dirname(file), found[1]);
      if (!existsSync(target) && existsSync(`${target}.mjs`)) target = `${target}.mjs`;
      walk(target);
    }
    for (const found of source.matchAll(/from\s+"(@a11y-witness\/[^"]+)"/g)) {
      const target = internalSourceFile(found[1]);
      if (target) walk(target);
    }
  };
  walk(resolve(ROOT, entry));
  return [...seen].map((p) => relative(ROOT, p));
}

/** Does any glob in `paths` match this file? Only the two forms this workflow uses — `dir/**` and an
 *  exact path — because reimplementing GitHub's matcher would be a second spelling of GitHub's rules. */
const matched = (paths: string[], file: string) => paths.some((pattern) => {
  if (pattern.startsWith("!")) return false;
  const glob = pattern.replace(/^"|"$/g, "");
  return glob.endsWith("/**") ? file.startsWith(glob.slice(0, -2)) : file === glob;
});

function triggerPaths(section: "push" | "pull_request"): string[] {
  const yml = readFileSync(resolve(ROOT, ".github/workflows/capture-regression.yml"), "utf8");
  // ANCHORED ON THE INDENT, and the first version was not — which its own mutation check caught.
  //
  // The triggers sit under `on:` at two spaces, so a terminator of `\n(jobs|pull_request):` never matched
  // `\n  pull_request:`. The push block therefore ran to the END OF FILE and swallowed the pull_request
  // paths, so removing a path from `push` alone still passed: a test examining MORE than it claims, which
  // is the same defect class as one examining nothing. Terminated on the next key at the SAME indent.
  const header = new RegExp(`^(\\s*)${section}:\\s*$`, "m").exec(yml);
  assert.ok(header, `the workflow has no ${section} trigger at its own line; this parser has drifted`);
  const rest = yml.slice(header!.index + header![0].length);
  const sibling = new RegExp(`^\\s{0,${header![1].length}}\\S`, "m").exec(rest);
  const block = sibling ? rest.slice(0, sibling.index) : rest;
  return [...block.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
}

test("both triggers fire on every file the harness imports", () => {
  const closure = importClosure(ENTRY);
  // VACUITY GUARD: a walk that resolved nothing would make every assertion below pass having compared
  // one file to itself, which is the exact failure this workflow's own history records.
  assert.ok(closure.length >= 4,
    `the import walk found ${closure.length} file(s) from ${ENTRY}; it has stopped resolving imports`);
  assert.ok(closure.includes(ENTRY), "the walk must include its own entry point");

  for (const section of ["push", "pull_request"] as const) {
    const paths = triggerPaths(section);
    assert.ok(paths.length >= 5, `${section} declares ${paths.length} path(s); the parser has drifted`);
    for (const file of closure) {
      assert.ok(matched(paths, file),
        `capture-regression.yml's ${section} trigger does not fire on ${file}, which `
        + `${ENTRY} imports. A change there would not run the only automated check that drives real NVDA.`);
    }
  }
});
