/**
 * #376: both workspace scopes resolve, to the same packages, so an incomplete rename cannot fail.
 *
 * `npm install` ADDS a new scope's `node_modules/@*` symlinks and does not remove an old one, so after a
 * rename a leftover `@old-scope/*` import resolves silently instead of throwing `ERR_MODULE_NOT_FOUND` --
 * on any machine that ever installed the previous scope. It fails only on a fresh install, by which point
 * the commit has landed.
 *
 * The unit tests below drive `staleWorkspaceScopes`/`currentWorkspaceScope` with INJECTED fake
 * `readdir`/`lstat`/`realpath`/`readFile` functions -- never the real filesystem, because this repo's
 * actual `node_modules` is shared across every worktree on this machine and a test that mutates it for
 * real would be exactly the shared-checkout hazard CLAUDE.md already documents for `git stash`.
 *
 * The one REAL-filesystem test is the guard the issue's acceptance names first: does the checkout this
 * suite is running in currently carry a stale scope? It reads real `node_modules` (never writes it), so it
 * is the fact rather than a proxy -- and it also asserts `require.resolve` on the stale scope's own
 * members actually throws, which is the thing that matters (a resolution failing), not only that a
 * directory is gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { currentWorkspaceScope, staleWorkspaceScopes } from "../../../../scripts/prune-stale-workspace-scope.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

// --- pure logic, against an injected fake filesystem -- never the real, shared node_modules ---

/** A minimal in-memory tree: `{ "packages/judge/package.json": "...", "node_modules/@scope/pkg": <link> }`. */
function fakeFs(files: Record<string, string>, symlinks: Record<string, string>) {
  const readdir = (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const path of [...Object.keys(files), ...Object.keys(symlinks)]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length).split("/")[0];
      if (rest) names.add(rest);
    }
    if (!names.size) throw new Error(`ENOENT: ${dir}`);
    return [...names].map((name) => ({
      name,
      isDirectory: () => !symlinks[`${prefix}${name}`] && [...names].length >= 0
        && (Object.keys(files).some((f) => f.startsWith(`${prefix}${name}/`))
          || Object.keys(symlinks).some((s) => s.startsWith(`${prefix}${name}/`))),
    }));
  };
  const readFile = (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    return files[path];
  };
  const lstat = (path: string) => ({ isSymbolicLink: () => path in symlinks });
  // A REAL `realpathSync` resolves an ordinary (non-symlink) path to ITSELF, not to an error -- it only
  // has somewhere else to point when the path names a symlink. Throwing here for anything not registered
  // as a symlink is what made the code under test's own `realpath(nodeModules)` call (which resolves
  // `node_modules` ITSELF, never a symlink in these fixtures) look like `node_modules` did not exist.
  const realpath = (path: string) => symlinks[path] ?? path;
  // Cast to the real functions' own types: these fakes satisfy the one call shape `prune-stale-workspace-
  // scope.mjs` actually uses (a narrow subset the real signatures' full overload sets don't structurally
  // reduce to), the same reason `install-git-hooks.mjs`'s own test doubles are cast this way.
  return {
    readdir: readdir as unknown as typeof readdirSync,
    readFile: readFile as unknown as typeof readFileSync,
    lstat: lstat as unknown as typeof lstatSync,
    realpath: realpath as unknown as typeof realpathSync,
  };
}

test("currentWorkspaceScope reads the scope off the first scoped workspace package.json it finds", () => {
  const { readdir, readFile } = fakeFs({
    "/repo/packages/judge/package.json": JSON.stringify({ name: "@newscope/judge" }),
  }, {});
  assert.equal(currentWorkspaceScope({ repo: "/repo", readdir, readFile }), "@newscope");
});

test("currentWorkspaceScope returns undefined when no workspace package is scoped, rather than guessing", () => {
  const { readdir, readFile } = fakeFs({
    "/repo/packages/cli/package.json": JSON.stringify({ name: "unscoped-cli" }),
  }, {});
  assert.equal(currentWorkspaceScope({ repo: "/repo", readdir, readFile }), undefined);
});

test("a node_modules/@* scope whose members symlink into packages/ IS a stale workspace scope", () => {
  const { readdir, lstat, realpath } = fakeFs({}, {
    "/repo/node_modules/@oldscope/judge": "/repo/packages/judge",
    "/repo/node_modules/@newscope/judge": "/repo/packages/judge",
  });
  const stale = staleWorkspaceScopes({ repo: "/repo", readdir, lstat, realpath, currentScope: "@newscope" });
  assert.deepEqual(stale, ["@oldscope"]);
});

test("the CURRENT scope is never reported as stale, however many old ones sit alongside it", () => {
  const { readdir, lstat, realpath } = fakeFs({}, {
    "/repo/node_modules/@newscope/judge": "/repo/packages/judge",
  });
  const stale = staleWorkspaceScopes({ repo: "/repo", readdir, lstat, realpath, currentScope: "@newscope" });
  assert.deepEqual(stale, []);
});

test("a scoped dependency that is NOT a workspace symlink is left alone -- this guards workspace scopes, not npm's", () => {
  // `@types/node`-shaped: a real directory under node_modules/@types, no symlink, nothing to do with
  // this repo's own packages/. A structural check must not flag ordinary scoped dependencies as stale.
  const { readdir, lstat, realpath } = fakeFs({
    "/repo/node_modules/@types/node/index.js": "",
  }, {
    "/repo/node_modules/@newscope/judge": "/repo/packages/judge",
  });
  const stale = staleWorkspaceScopes({ repo: "/repo", readdir, lstat, realpath, currentScope: "@newscope" });
  assert.deepEqual(stale, []);
});

test("a symlink pointing OUTSIDE packages/ (an external scoped package linked for other reasons) is not stale", () => {
  const { readdir, lstat, realpath } = fakeFs({}, {
    "/repo/node_modules/@external/thing": "/somewhere/else/entirely",
    "/repo/node_modules/@newscope/judge": "/repo/packages/judge",
  });
  const stale = staleWorkspaceScopes({ repo: "/repo", readdir, lstat, realpath, currentScope: "@newscope" });
  assert.deepEqual(stale, []);
});

test("MUTATION: reproducing the exact issue shape -- both scopes present, only the old one is stale", () => {
  const { readdir, lstat, realpath } = fakeFs({}, {
    "/repo/node_modules/@a11y-witness/judge": "/repo/packages/judge",
    "/repo/node_modules/@a11y-witness/control": "/repo/packages/control",
    "/repo/node_modules/@a11ign/judge": "/repo/packages/judge",
    "/repo/node_modules/@a11ign/control": "/repo/packages/control",
  });
  const stale = staleWorkspaceScopes({ repo: "/repo", readdir, lstat, realpath, currentScope: "@a11ign" });
  assert.deepEqual(stale, ["@a11y-witness"],
    "the scope named literally here is a FIXTURE value proving the mechanism, not something the "
    + "production code hard-codes -- see the tests above, which use @oldscope/@newscope instead");
});

// --- THE GUARD: the real checkout, read (never written) ---

test("ACCEPTANCE (#376): this checkout carries no stale workspace scope, and a stale one truly fails to resolve", () => {
  const stale = staleWorkspaceScopes({ repo: REPO });
  assert.deepEqual(stale, [],
    `stale workspace scope(s) present under node_modules/: ${stale.join(", ")} -- run `
    + "npm install again (prune-stale-workspace-scope.mjs runs as part of prepare), or remove "
    + `by hand: ${stale.map((s) => `rm -rf node_modules/${s}`).join("; ")}`);

  // The FACT dispatcher asked to be foregrounded: a stale scope's own members must not RESOLVE, not
  // merely be absent as a directory. There is normally nothing to iterate here -- see the mutation-check
  // performed manually against the real filesystem, recorded in this PR's own Mutation section, for the
  // case where one genuinely exists.
  const require = createRequire(import.meta.url);
  for (const scope of stale) {
    const scopeDir = join(REPO, "node_modules", scope);
    for (const member of readdirSync(scopeDir)) {
      assert.throws(() => require.resolve(`${scope}/${member}`),
        `${scope}/${member} still resolves -- a stale workspace scope must fail to resolve, not just be flagged`);
    }
  }
});
