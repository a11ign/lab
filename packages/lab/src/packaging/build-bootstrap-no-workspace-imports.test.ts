/**
 * A SCRIPT THE BUILD ITSELF DEPENDS ON MAY NOT IMPORT A WORKSPACE PACKAGE SPECIFIER.
 *
 * Measured, not theoretical: `scripts/build-packages.mjs` gained `import { refuseUnknownFlags } from
 * "@a11y-witness/worker-fleet/cli-flags"` (#164), which resolves to `packages/worker-fleet/dist/
 * cli-flags.mjs` — a file that exists only AFTER `build-packages.mjs` has already run successfully.
 * Circular: the build script cannot start because it needs the output of the build it is about to run.
 * `npm ci --ignore-scripts` (CI's own install) then `node scripts/build-packages.mjs` on a genuinely
 * fresh checkout threw `ERR_MODULE_NOT_FOUND` — every `ci.yml` run failed from the moment #164 merged.
 *
 * WHY IT WENT UNNOTICED LOCALLY: every worktree in this session's own shared-checkout convention chains
 * `node_modules` symlinks back to whichever worktree happened to build first, so the bare specifier
 * silently resolved to a DIFFERENT worktree's stale, already-built `dist/` and "worked" — the same
 * worktree/`node_modules` trap CLAUDE.md already documents for the primary checkout, reached here one
 * symlink hop further along a chain.
 *
 * `scripts/ci-changed.mjs`'s own header already states the rule this file pins: "every other root
 * script uses the package specifier, and every other root script runs AFTER `npm run build`. This one
 * gates whether ANYTHING else builds at all, so it cannot depend on a build having already happened."
 * `build-packages.mjs` is now in the identical position and is fixed the same way — a RELATIVE import
 * straight from `packages/worker-fleet/src/cli-flags.mjs`.
 *
 * THE SET IS DISCOVERED WHERE IT CAN BE, DECLARED WHERE IT CANNOT. Every file `build-packages.mjs`
 * itself imports (transitively, following relative specifiers only) is walked automatically — a new
 * helper it starts importing tomorrow is covered without anyone updating a list. `ci-changed.mjs` is
 * NOT reachable via that walk (it is a separate entry point CI invokes directly, never imported by
 * `build-packages.mjs`) but carries the identical constraint by its own stated reason, so it is named
 * explicitly rather than silently exempted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stripComments } from "@a11y-witness/evidence/source-text";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ENTRY = "scripts/build-packages.mjs";
const ALSO_CONSTRAINED = [
  "scripts/ci-changed.mjs",
  // The `prepare` script -- runs on every plain `npm install` in a fresh checkout, before any package's
  // `dist/` exists. Not reachable via build-packages.mjs's own import graph; carries the identical
  // constraint by npm lifecycle timing rather than by being imported from the same entry point.
  "scripts/install-git-hooks.mjs",
];

const IMPORT_RE = /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
// AN IMPORT SPECIFIER, not any string mentioning the scope. `isolation-gate.mjs` legitimately checks
// `dependency.startsWith("@a11y-witness/")` against a package.json's own declared dependencies -- real
// code, not an import -- and a bare substring match flagged it as an offender having examined nothing
// about what it actually does.
const WORKSPACE_SPECIFIER_RE = /\bfrom\s+["']@a11y-witness\//;

/** Every file reachable from `entry` via RELATIVE (`./`, `../`) import specifiers, `entry` included. */
function relativeImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (rel === undefined || seen.has(rel)) continue;
    seen.add(rel);
    const abs = join(REPO, rel);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue; // not a local file (e.g. a bare node: specifier resolved wrongly) -- nothing to walk
    }
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const resolved = resolve(dirname(abs), specifier);
      stack.push(resolved.slice(REPO.length).replace(/\\/g, "/").replace(/^\//, ""));
    }
  }
  return seen;
}

test("the build-bootstrap closure is real -- more than just the entry file itself", () => {
  const closure = relativeImportClosure(ENTRY);
  assert.ok(closure.size > 1,
    `relativeImportClosure(${ENTRY}) found only itself -- the import walk examined nothing`);
  assert.ok(closure.has("scripts/isolation-gate.mjs"),
    "expected the walk to reach isolation-gate.mjs, a known relative import of build-packages.mjs");
});

test("no script the build depends on imports a workspace package specifier", () => {
  const files = new Set([...relativeImportClosure(ENTRY), ...ALSO_CONSTRAINED]);
  const offenders: string[] = [];
  for (const rel of files) {
    // COMMENTS STRIPPED FIRST -- this file's own header prose quotes the banned specifier as the example
    // of what NOT to write, and a raw-source check would flag its own explanation as the defect.
    const source = stripComments(readFileSync(join(REPO, rel), "utf8"));
    if (WORKSPACE_SPECIFIER_RE.test(source)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    "these run before (or as) the build, so a `@a11y-witness/*` import resolves to a `dist/` that does "
    + "not exist yet on a fresh checkout -- use a relative import instead, the same fix ci-changed.mjs "
    + "and isolation-gate.mjs already use");
});

test("MUTATION: reintroducing the workspace specifier is caught", () => {
  // Proves the regex actually fires on the real, historical shape of the defect rather than a contrived
  // string -- the literal line #164 added.
  const reintroduced = 'import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";';
  assert.ok(WORKSPACE_SPECIFIER_RE.test(reintroduced));
});
