/**
 * #2613, child 1b of #69: `packages/guards/src/layer-file.mjs`, "where is this file of package X", asked by a test that reads a
 * layer package by NAME instead of by `../../nvda-worker/src/`.
 *
 * TWO FIXTURE TREES, one per way the package can be there: `linked` holds it as a WORKSPACE LINK (`node_modules/@a11ign/pkg`
 * is a symlink to `packages/pkg`, which is this monorepo), `installed` holds it as a COPY (a real directory, which is an
 * install from the registry). The resolver must give the same answer in both, and it is asked from a `packages/lab/src` dir
 * inside each so the walk upward is the one a real test takes.
 *
 * THE POSITIVE CONTROLS ARE HERE, by name: every fixture tree is asserted to CONTAIN the file before the resolver is asked
 * (a resolver that answers `undefined` for everything would otherwise pass "it refuses the unpublished file"), and the
 * refusals are each asserted next to a resolution in the SAME tree that succeeds, so "refused" is never "refused because the
 * tree is empty". The not-installed tree holds the layer's files at the MONOREPO path on purpose: that is the fallback a
 * lazy resolver would find, and the test is that it does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "../../../guards/src/test-tmp.mjs";
import { installedPackageDir, isPublished, layerFile } from "../../../guards/src/layer-file.mjs";

const NAME = "@a11ign/fixture-layer";
const REAL_LAYER = "@a11ign/nvda-worker";
const MANIFEST = {
  name: NAME,
  version: "0.0.0",
  files: ["src", "!src/**/*.test.ts", "README.md", "LICENSE"],
};
const PACKAGE_FILES: Record<string, string> = {
  "package.json": JSON.stringify(MANIFEST),
  "src/capture-core.mjs": "export const CAPTURE_CORE = 1;\n",
  "src/deep/nested.mjs": "export const NESTED = 1;\n",
  "src/capture-core.test.ts": "// a test the tarball does not carry\n",
  "scripts/dev-only.mjs": "// outside `files`\n",
};

function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** The consumer's directory inside the tree: where a lab test sits, so the lookup walks up from a realistic place. */
const CONSUMER = "packages/lab/src";

function linkedTree(): { root: string; from: string; packageDir: string } {
  const root = tempDir("layer-file-linked-");
  write(root, Object.fromEntries(Object.entries(PACKAGE_FILES).map(([rel, text]) => [`packages/fixture-layer/${rel}`, text])));
  mkdirSync(join(root, "node_modules/@a11ign"), { recursive: true });
  symlinkSync(join(root, "packages/fixture-layer"), join(root, "node_modules/@a11ign/fixture-layer"), "dir");
  mkdirSync(join(root, CONSUMER), { recursive: true });
  return { root, from: join(root, CONSUMER), packageDir: join(root, "packages/fixture-layer") };
}

function installedTree(): { root: string; from: string; packageDir: string } {
  const root = tempDir("layer-file-installed-");
  const packageDir = join(root, "node_modules/@a11ign/fixture-layer");
  write(packageDir, PACKAGE_FILES);
  mkdirSync(join(root, CONSUMER), { recursive: true });
  return { root, from: join(root, CONSUMER), packageDir };
}

test("it returns the same file whether the package is a workspace link or an installed copy", () => {
  const trees = { linked: linkedTree(), installed: installedTree() };
  const answers: Record<string, string> = {};
  for (const [kind, tree] of Object.entries(trees)) {
    // POSITIVE CONTROL: the file is in the tree before the resolver is asked.
    const expected = join(tree.packageDir, "src/capture-core.mjs");
    assert.ok(existsSync(expected), `${kind} fixture lost its capture-core.mjs`);
    const found = layerFile(NAME, "src/capture-core.mjs", { from: tree.from });
    assert.equal(realpathSync(found), realpathSync(expected), `${kind}: resolved somewhere other than the package`);
    answers[kind] = found;
  }
  assert.equal(
    relative(realpathSync(trees.linked.packageDir), answers.linked),
    relative(realpathSync(trees.installed.packageDir), answers.installed),
    "the file is at a different place INSIDE the package depending on how the package got there",
  );
  assert.equal(readFileSync(answers.linked, "utf8"), readFileSync(answers.installed, "utf8"));
  assert.notEqual(answers.linked, answers.installed, "two fixture trees answered with one path: they are not two trees");
});

test("a nested published file and the manifest resolve; `package.json` is published without being listed", () => {
  const { from, packageDir } = installedTree();
  assert.ok(existsSync(join(packageDir, "src/deep/nested.mjs")));
  assert.equal(layerFile(NAME, "src/deep/nested.mjs", { from }), join(realpathSync(packageDir), "src/deep/nested.mjs"));
  assert.equal(JSON.parse(readFileSync(layerFile(NAME, "package.json", { from }), "utf8")).name, NAME);
  assert.equal(MANIFEST.files.includes("package.json"), false, "the manifest is now listed: this no longer tests that it need not be");
});

test("it REFUSES a package that is not installed, naming it, and does not fall back to the monorepo path", () => {
  // The layer's files exist at the path a fallback would try. Everything but `node_modules` is in place.
  const root = tempDir("layer-file-absent-");
  write(root, Object.fromEntries(Object.entries(PACKAGE_FILES).map(([rel, text]) => [`packages/fixture-layer/${rel}`, text])));
  mkdirSync(join(root, CONSUMER), { recursive: true });
  assert.ok(existsSync(join(root, "packages/fixture-layer/src/capture-core.mjs")), "the confound is gone: a fallback would find nothing either");
  assert.equal(installedPackageDir(NAME, join(root, CONSUMER)), undefined);
  assert.throws(() => layerFile(NAME, "src/capture-core.mjs", { from: join(root, CONSUMER) }),
    (e: Error) => e.message.includes(`${NAME} is not installed`) && e.message.includes("fall back"));
  // The same call succeeds once the package IS installed, so the refusal above was about the package.
  const { from } = installedTree();
  assert.doesNotThrow(() => layerFile(NAME, "src/capture-core.mjs", { from }));
});

test("it REFUSES a file that is not in the package's published `files`, though the file is there", () => {
  for (const [kind, tree] of Object.entries({ linked: linkedTree(), installed: installedTree() })) {
    for (const unpublished of ["src/capture-core.test.ts", "scripts/dev-only.mjs"]) {
      // POSITIVE CONTROL: the file exists, so "refused" cannot be "refused because absent".
      assert.ok(existsSync(join(tree.packageDir, unpublished)), `${kind}: ${unpublished} is not in the fixture`);
      assert.throws(() => layerFile(NAME, unpublished, { from: tree.from }),
        (e: Error) => e.message.includes(`${unpublished} is not in ${NAME}'s published files`), `${kind}: ${unpublished}`);
    }
    assert.doesNotThrow(() => layerFile(NAME, "src/capture-core.mjs", { from: tree.from }), `${kind}: the published file must still resolve`);
  }
});

test("it refuses a published file the package does not hold, and a path that leaves the package", () => {
  const { from, packageDir } = installedTree();
  assert.equal(existsSync(join(packageDir, "src/gone.mjs")), false);
  assert.throws(() => layerFile(NAME, "src/gone.mjs", { from }), /publishes src\/gone\.mjs but holds no such file/);
  assert.throws(() => layerFile(NAME, "../elsewhere/x.mjs", { from }), /not a path inside/);
  assert.throws(() => layerFile(NAME, "/etc/hostname", { from }), /not a path inside/);
});

test("isPublished reads `files` as npm does: entries include, `!entries` exclude, a list-less manifest publishes everything", () => {
  const files = { files: ["src", "!src/**/*.test.ts", "README.md"] };
  assert.equal(isPublished(files, "src/a.mjs"), true);
  assert.equal(isPublished(files, "src/deep/b.mjs"), true);
  assert.equal(isPublished(files, "src/a.test.ts"), false, "the exclusion no longer excludes");
  assert.equal(isPublished(files, "src/deep/b.test.ts"), false, "the exclusion no longer reaches a nested test");
  assert.equal(isPublished(files, "srcx/a.mjs"), false, "`src` matched a sibling directory that only starts with it");
  assert.equal(isPublished(files, "scripts/x.mjs"), false);
  assert.equal(isPublished(files, "LICENSE"), true, "npm packs LICENSE whatever `files` says");
  assert.equal(isPublished({}, "anything/at/all.mjs"), true);
});

test("the REAL tree: the layer resolves by name from here, to a file that is there and is the layer's own", () => {
  const found = layerFile(REAL_LAYER, "src/capture-core.mjs", { from: dirname(fileURLToPath(import.meta.url)) });
  assert.ok(existsSync(found), `${found} is not a file`);
  // The layer's directory name, not a path into it: this test names the package, which is the point of it.
  assert.match(realpathSync(found), /nvda-worker[\\/]src[\\/]capture-core\.mjs$/);
  assert.match(readFileSync(found, "utf8"), /export /, "resolved a file with no exports: not the layer's capture-core");
});
