/**
 * #2181: a worktree whose `@a11ign/*` resolve somewhere else measures THAT checkout, and one command says so.
 *
 * Measured 2026-09-23: 42 of 56 worktrees on the agent host read the PRIMARY's `packages/`, so
 * `npm run test:all` gave 7,253 passed at a head CI was failing. **The symlink is deliberate; what was
 * missing was any line saying the tree under test is not the tree under test.**
 *
 * CONSTRUCTED TREES, real symlinks: the classifier's whole content is what `realpath` returns, so a
 * fake filesystem would test the string handling and leave the resolution untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESOLUTION, worktreeResolution, resolutionLine, classifyResolvedPath,
} from "../../../agent-org/src/worktree-resolution.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGE = "agent-org";

/** A scratch directory holding the trees a test builds, removed afterwards. */
function withScratch(body: (base: string) => void) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "resolution-")));
  try { body(base); } finally { rmSync(base, { recursive: true, force: true }); }
}

/** A checkout with its own `packages/agent-org`. */
function checkout(base: string, name: string) {
  const root = join(base, name);
  mkdirSync(join(root, "packages", PACKAGE), { recursive: true });
  return root;
}

/** Make `tree/node_modules/@a11ign/agent-org` a symlink to `target`. */
function linkScope(tree: string, target: string) {
  mkdirSync(join(tree, "node_modules", "@a11ign"), { recursive: true });
  symlinkSync(target, join(tree, "node_modules", "@a11ign", PACKAGE));
}

test("#2181 OWN PACKAGES: a tree linked to its own packages/ reads SAFE, and says a run measures this branch", () => {
  withScratch((base) => {
    const tree = checkout(base, "wt-own");
    linkScope(tree, join(tree, "packages", PACKAGE));
    const result = worktreeResolution(tree);
    assert.equal(result.kind, RESOLUTION.OWN_PACKAGES);
    assert.match(resolutionLine(tree, result), /measures this branch/);
  });
});

test("#2181 OTHER CHECKOUT: a tree linked to another checkout's packages/ names that checkout", () => {
  withScratch((base) => {
    const primary = checkout(base, "primary");
    const tree = checkout(base, "wt-outside");
    linkScope(tree, join(primary, "packages", PACKAGE));
    const result = worktreeResolution(tree);
    assert.equal(result.kind, RESOLUTION.OTHER_CHECKOUT);
    assert.deepEqual(result.checkouts, [primary]);
    const said = resolutionLine(tree, result);
    assert.ok(said.includes(primary), "the line must NAME the checkout being read -- that ends the investigation");
    assert.match(said, /measures that checkout and not this branch/);
  });
});

test("#2181 STALE COPY: a copy under the tree's own node_modules/ is NOT safe -- the wt-1315 shape", () => {
  withScratch((base) => {
    const tree = checkout(base, "wt-copy");
    const copy = join(tree, "node_modules", "@a11ign", PACKAGE);
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, "index.mjs"), "// frozen at install time\n");
    const result = worktreeResolution(tree);
    assert.equal(result.kind, RESOLUTION.STALE_COPY);
    assert.notEqual(result.kind, RESOLUTION.OWN_PACKAGES,
      "INSIDE the worktree is not the worktree's source: a containment-only classifier calls this SAFE, and "
      + "the population the row was written for is then smaller than it looks");
    assert.match(resolutionLine(tree, result), /COPY under this tree's own node_modules/);
  });
});

test("#2181: node_modules is asked BEFORE containment -- the order is the content of classifyResolvedPath", () => {
  // Both paths are under the worktree; only the `node_modules` question tells them apart.
  assert.equal(classifyResolvedPath("/w", "/w/node_modules/@a11ign/x").kind, RESOLUTION.STALE_COPY);
  assert.equal(classifyResolvedPath("/w", "/w/packages/x").kind, RESOLUTION.OWN_PACKAGES);
  // A sibling that shares the prefix is not inside it. The decoy sits AT the segment boundary, because a
  // bare startsWith is only fooled by `/w/packages-old`, not by a different worktree's longer name.
  assert.equal(classifyResolvedPath("/w", "/w/packages-old/x").kind, RESOLUTION.OTHER_CHECKOUT);
  assert.equal(classifyResolvedPath("/w", "/w/node_modules-old/x").kind, RESOLUTION.OTHER_CHECKOUT);
});

test("#2181: the MOST SEVERE kind wins, and a tree with no links is NOT called safe", () => {
  withScratch((base) => {
    const primary = checkout(base, "primary");
    const tree = checkout(base, "wt-mixed");
    linkScope(tree, join(tree, "packages", PACKAGE));
    symlinkSync(join(primary, "packages", PACKAGE), join(tree, "node_modules", "@a11ign", "other"));
    assert.equal(worktreeResolution(tree).kind, RESOLUTION.OTHER_CHECKOUT,
      "one lying package answers 'may I trust a suite run here'");

    const bare = checkout(base, "wt-bare");
    const nothing = worktreeResolution(bare);
    assert.equal(nothing.kind, RESOLUTION.NOTHING_LINKED);
    assert.match(resolutionLine(bare, nothing), /Not "safe"/);
  });
});

test("#2181: a DANGLING link is reported as nothing-linked rather than throwing", () => {
  withScratch((base) => {
    const tree = checkout(base, "wt-dangling");
    linkScope(tree, join(base, "deleted", PACKAGE));
    assert.equal(worktreeResolution(tree).kind, RESOLUTION.NOTHING_LINKED);
  });
});

test("#2181 THE CALLER: `worktree:whose` prints the resolution line for the tree it is asked about", () => {
  // The classifier was the first thing this repo ships with no caller three times over, so the claim
  // under test is that a session RUNNING the command it already runs is told.
  withScratch((base) => {
    const primary = checkout(base, "primary");
    const tree = checkout(base, "wt-cli");
    linkScope(tree, join(primary, "packages", PACKAGE));
    const ran = spawnSync(process.execPath, [join(REPO, "packages/agent-org/src/worktree-owner.mjs"), tree],
      { encoding: "utf8", env: { ...process.env, A11Y_SESSION: "worker-capture" } });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /UNSTAMPED/, "control: the ownership answer is still there");
    assert.ok(ran.stdout.includes(primary), "the resolution line must name the checkout being read");
    assert.match(ran.stdout, /resolve OUTSIDE this worktree/);
  });
});
