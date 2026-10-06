/**
 * #3447 (move 1 of #69, step 5): THE DELETE'S OWN TEST. `packages/nvda-worker` and `packages/nvda-speech` left the workspace for
 * `a11ign/screenreader-worker` (ADR 0040, M1; ADR 0039 finding 1), and this repository consumes `@a11ign/screenreader-worker` from
 * the registry. Before the delete this file proved the layer could stand alone (licence division, boundary scan, leak scan: #2701,
 * recoverable from `git show d8952882f:packages/lab/src/packaging/screenreader-worker-extraction.test.ts`); those were claims about a
 * tree that is no longer here, and what is left to prove is that the delete is COMPLETE. Four claims, each with a fixture beside it:
 *
 *   1. Neither package is in the workspace: `pnpm-workspace.yaml`'s globs match no directory of either name, and no workspace manifest
 *      carries either package's name (so a copy under a different directory is caught too).
 *   2. `pnpm-lock.yaml` holds no `link:` to either, and no importer under their old paths.
 *   3. The `@a11ign/screenreader-worker` entry is a REGISTRY entry: `version: 0.1.0` under every importer that declares it, and a
 *      `packages:` entry whose `resolution` carries an `integrity`. A version with no integrity is a version nobody verified.
 *   4. No pending changeset names either package. `.changeset/README.md` is prose and may name them; an entry's frontmatter may not,
 *      because `changeset version` would then try to version a package this workspace does not have.
 *
 *   5. The one read of `nvda-speech` in `lab` (`labels.py`, in `occurrence-verdict-stability.mjs`) goes through the layer checkout: the
 *      harness names no workspace path and no `@a11ign/nvda-speech` package, and the path it builds from `layerRoot("nvda-worker")` finds the
 *      file in a checkout laid out as the layer's repository is (the two packages side by side) and is REFUSED where there is no checkout.
 *
 * THE POSITIVE CONTROL is the same function over a fixture: a lockfile with a `link:../nvda-worker` entry is REFUSED naming it, and so
 * is a workspace that still holds either directory, a registry entry with no integrity, and a changeset that names a departed package.
 * A reader that found nothing in the real tree would otherwise be indistinguishable from one that cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { layersFrom } from "@a11ign/control/layer-checkouts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CONSUMED = "@a11ign/screenreader-worker";
const CONSUMED_VERSION = "0.1.0";
/** The two directories that left, and every name either has been published or reserved under. */
const DEPARTED_DIRECTORIES = ["nvda-worker", "nvda-speech"] as const;
// BUILT, NOT WRITTEN: `package-rename-nvda-worker.test.ts` refuses any non-document file that spells the old name whole.
const DEPARTED_NAMES = [["@a11ign", "nvda-worker"].join("/"), "@a11ign/nvda-speech", "@a11ign/screenreader-speech"] as const;
/** What a pnpm integrity looks like: an algorithm, a dash and base64. Not a hash of anything: a SHAPE, so a placeholder is refused. */
const INTEGRITY_SHAPE = /^sha512-[A-Za-z0-9+/]{86}==$/;

/** Writes `files` (path -> text) under a fresh directory, runs `body` on it, and removes it however `body` ends. */
function withFixture<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "screenreader-worker-delete-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, posix.dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const read = (root: string, path: string): string => readFileSync(join(root, path), "utf8");

// ---- 1. neither package is in the workspace -----------------------------------------------------------------

/** The directories `pnpm-workspace.yaml`'s `packages:` globs match, less the ones a `!dir` entry excludes (#3760: a layer's clone is not a member).
 * Only the `dir/*` and `!dir` shapes are read, which are the only ones it holds. */
function workspaceDirectories(root: string): string[] {
  const { packages } = parse(read(root, "pnpm-workspace.yaml")) as { packages?: string[] };
  assert.ok(Array.isArray(packages) && packages.length > 0, "pnpm-workspace.yaml names no packages: the reader is looking at the wrong file");
  const excluded = packages.filter((entry) => entry.startsWith("!")).map((entry) => {
    assert.match(entry, /^![\w./-]+$/, `${entry} is an exclusion shape this reader does not expand: widen it before trusting a pass`);
    return entry.slice(1);
  });
  return packages.filter((entry) => !entry.startsWith("!")).flatMap((glob) => {
    assert.match(glob, /^[\w./-]+\/\*$/, `${glob} is a glob shape this reader does not expand: widen it before trusting a pass`);
    const parent = glob.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => posix.join(parent, entry.name));
  }).filter((directory) => !excluded.includes(directory));
}

function manifestName(root: string, directory: string): string | null {
  try {
    return (JSON.parse(read(root, join(directory, "package.json"))) as { name?: string }).name ?? null;
  } catch (cause) {
    // A workspace directory with no manifest (a build output, a cache) is not a member; any other failure is a real defect.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`cannot read ${directory}/package.json`, { cause });
  }
}

/** Every way the workspace still holds a departed package, as a sentence naming it. */
function workspaceRefusals(root: string): string[] {
  const directories = workspaceDirectories(root);
  const byDirectory = directories.filter((directory) => DEPARTED_DIRECTORIES.some((name) => posix.basename(directory) === name))
    .map((directory) => `${directory} is still a workspace directory`);
  const byName = directories.flatMap((directory) => {
    const name = manifestName(root, directory);
    const departed = name !== null && (name === CONSUMED || (DEPARTED_NAMES as readonly string[]).includes(name));
    return departed ? [`${directory} still carries the name ${name}`] : [];
  });
  return [...byDirectory, ...byName];
}

test("neither package is in the workspace, by directory or by name", () => {
  assert.ok(workspaceDirectories(REPO_ROOT).length >= 5, "the workspace expanded to almost nothing: the reader is not looking at the tree");
  assert.deepEqual(workspaceRefusals(REPO_ROOT), []);
});

test("POSITIVE CONTROL: a workspace holding either directory, or either name under another directory, is refused naming it", () => {
  const files = {
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "packages/nvda-worker/package.json": `{ "name": "${CONSUMED}" }`,
    "packages/renamed/package.json": '{ "name": "@a11ign/nvda-speech" }',
    "packages/fine/package.json": '{ "name": "@a11ign/evidence" }',
  };
  withFixture(files, (root) => {
    assert.deepEqual(workspaceRefusals(root), [
      "packages/nvda-worker is still a workspace directory",
      `packages/nvda-worker still carries the name ${CONSUMED}`,
      "packages/renamed still carries the name @a11ign/nvda-speech",
    ]);
  });
  withFixture({ ...files, "packages/nvda-worker/package.json": "{}", "packages/renamed/package.json": "{}" }, (root) => {
    assert.deepEqual(workspaceRefusals(root), ["packages/nvda-worker is still a workspace directory"], "the directory alone is enough");
  });
  // The other direction (#3760): the layer's clone sits at that path and `!packages/nvda-worker` keeps it out, so it is not a member.
  withFixture({ ...files, "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n  - "!packages/nvda-worker"\n' }, (root) => {
    assert.deepEqual(workspaceRefusals(root), ["packages/renamed still carries the name @a11ign/nvda-speech"], "an excluded directory is not a member");
  });
});

// ---- 2. no link: to either, and 3. the consumed entry is a registry entry -----------------------------------

/** Lines of `lockfile` that point a dependency at a departed directory with `link:`, or keep an importer under its old path. */
function linkRefusals(lockfile: string): string[] {
  const departed = DEPARTED_DIRECTORIES.join("|");
  const links = lockfile.split("\n").filter((line) => new RegExp(`link:[^\\s'"]*(?:${departed})\\b`).test(line)).map((line) => `a link to a departed package: ${line.trim()}`);
  const importers = Object.keys((parse(lockfile) as { importers?: Record<string, unknown> }).importers ?? {})
    .filter((importer) => DEPARTED_DIRECTORIES.some((name) => importer.endsWith(`/${name}`))).map((importer) => `an importer under a departed path: ${importer}`);
  return [...links, ...importers];
}

type Lockfile = {
  importers?: Record<string, Record<string, Record<string, { specifier: string; version: string }> | undefined>>;
  packages?: Record<string, { resolution?: { integrity?: string } } | undefined>;
};
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];

/** What is wrong with how `lockfile` holds the consumed package: nothing found, a wrong version, or a version with no integrity. */
function registryEntryRefusals(lockfile: string): string[] {
  const parsed = parse(lockfile) as Lockfile;
  const declared = Object.entries(parsed.importers ?? {}).flatMap(([importer, sections]) => DEPENDENCY_SECTIONS.flatMap((section) => {
    const entry = sections[section]?.[CONSUMED];
    return entry === undefined ? [] : [{ importer, version: entry.version }];
  }));
  if (declared.length === 0) return [`no importer declares ${CONSUMED}`];
  const wrongVersion = declared.filter(({ version }) => version !== CONSUMED_VERSION)
    .map(({ importer, version }) => `${importer} resolves ${CONSUMED} to ${version}, not the registry's ${CONSUMED_VERSION}`);
  const integrity = parsed.packages?.[`${CONSUMED}@${CONSUMED_VERSION}`]?.resolution?.integrity;
  const unverified = integrity !== undefined && INTEGRITY_SHAPE.test(integrity) ? [] : [`${CONSUMED}@${CONSUMED_VERSION} has no sha512 integrity in packages:`];
  return [...wrongVersion, ...unverified];
}

const REAL_INTEGRITY = `sha512-${"A".repeat(86)}==`;
/** A minimal lockfile: `importer` declares the package at `version`, with `integrity` (or none) in `packages:`. */
function lockfileWith({ version, integrity, extra = "" }: { version: string; integrity?: string; extra?: string }): string {
  const resolution = integrity === undefined ? "" : `    resolution: {integrity: ${integrity}}\n`;
  return `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      '${CONSUMED}':\n        specifier: ^0.1.0\n        version: ${version}\n${extra}\n`
    + `packages:\n\n  '${CONSUMED}@${CONSUMED_VERSION}':\n${resolution}    engines: {node: '>=20'}\n`;
}

test("pnpm-lock.yaml holds no link: to either package and no importer under either old path", () => {
  assert.deepEqual(linkRefusals(read(REPO_ROOT, "pnpm-lock.yaml")), []);
});

test("pnpm-lock.yaml holds @a11ign/screenreader-worker at version 0.1.0 with an integrity, under every importer that declares it", () => {
  const lockfile = read(REPO_ROOT, "pnpm-lock.yaml");
  assert.deepEqual(registryEntryRefusals(lockfile), []);
  // Derived a second way: the manifests that declare it are the importers the lockfile must resolve, so a lockfile that lost one is not "enough".
  const importers = Object.entries((parse(lockfile) as Lockfile).importers ?? {}).filter(([, sections]) => DEPENDENCY_SECTIONS.some((s) => sections[s]?.[CONSUMED] !== undefined)).map(([name]) => name).sort();
  assert.deepEqual(importers, [".", "packages/lab"]);
});

test("POSITIVE CONTROL: a lockfile with a link:../nvda-worker entry is REFUSED, naming it", () => {
  const linked = lockfileWith({ version: "link:../nvda-worker", integrity: REAL_INTEGRITY });
  assert.deepEqual(linkRefusals(linked), ["a link to a departed package: version: link:../nvda-worker"]);
  assert.deepEqual(registryEntryRefusals(linked), [`. resolves ${CONSUMED} to link:../nvda-worker, not the registry's ${CONSUMED_VERSION}`]);
  const importer = lockfileWith({ version: CONSUMED_VERSION, integrity: REAL_INTEGRITY, extra: "\n  packages/nvda-speech:\n    dependencies: {}\n" });
  assert.deepEqual(linkRefusals(importer), ["an importer under a departed path: packages/nvda-speech"]);
});

test("POSITIVE CONTROL: a clean registry entry passes, and a missing, malformed or absent one does not", () => {
  const clean = lockfileWith({ version: CONSUMED_VERSION, integrity: REAL_INTEGRITY });
  assert.deepEqual([...linkRefusals(clean), ...registryEntryRefusals(clean)], []);
  assert.deepEqual(registryEntryRefusals(lockfileWith({ version: CONSUMED_VERSION })), [`${CONSUMED}@${CONSUMED_VERSION} has no sha512 integrity in packages:`]);
  assert.deepEqual(registryEntryRefusals(lockfileWith({ version: CONSUMED_VERSION, integrity: "sha512-placeholder" })), [`${CONSUMED}@${CONSUMED_VERSION} has no sha512 integrity in packages:`]);
  assert.deepEqual(registryEntryRefusals("lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n"), [`no importer declares ${CONSUMED}`]);
});

// ---- 4. no changeset names either package ------------------------------------------------------------------

/** A changeset entry's frontmatter is the block between its first two `---` lines; the names it versions are that block's keys. */
function namedInFrontmatter(text: string): string[] {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^\s*["']?([^"':\s]+)["']?\s*:/gm)].map((match) => match[1]);
}

/** Every pending entry under `.changeset/` whose frontmatter names a departed package (or the one now consumed from the registry). */
function changesetRefusals(root: string): string[] {
  const refused = new Set<string>([CONSUMED, ...DEPARTED_NAMES]);
  return readdirSync(join(root, ".changeset")).filter((file) => file.endsWith(".md") && file !== "README.md")
    .flatMap((file) => namedInFrontmatter(read(root, `.changeset/${file}`)).filter((name) => refused.has(name)).map((name) => `.changeset/${file} names ${name}`));
}

test("no pending changeset names either package, or the one consumed from the registry", () => {
  assert.deepEqual(changesetRefusals(REPO_ROOT), []);
});

test("POSITIVE CONTROL: an entry whose frontmatter names a departed package is refused, and prose that merely mentions one is not", () => {
  const files = {
    ".changeset/README.md": `# Changesets\n\n| \`${CONSUMED}\` | prose may name it |\n`,
    ".changeset/bad-entry.md": `---\n"${CONSUMED}": minor\n"@a11ign/evidence": patch\n---\n\nA retrain.\n`,
    ".changeset/speech.md": '---\n"@a11ign/nvda-speech": patch\n---\n\nx\n',
    ".changeset/prose.md": `---\n"@a11ign/evidence": patch\n---\n\nThis mentions ${CONSUMED} in its body only.\n`,
    ".changeset/config.json": "{}",
  };
  withFixture(files, (root) => {
    assert.deepEqual(changesetRefusals(root).sort(), [`.changeset/bad-entry.md names ${CONSUMED}`, ".changeset/speech.md names @a11ign/nvda-speech"]);
  });
  assert.deepEqual(namedInFrontmatter("no frontmatter at all"), [], "an entry with no frontmatter names nothing, rather than throwing");
});

// ---- 5. the nvda-speech read in lab resolves through the layer checkout ----------------------------------------

const HARNESS = "packages/lab/src/harnesses/occurrence-verdict-stability.mjs";
/** The manifest of the real layer, over a root of the caller's choosing: the resolver is the production one, the checkout is a fixture. */
const layerCheckoutAt = (root: string) => layersFrom({
  manifest: JSON.parse(read(REPO_ROOT, "packages/control/layers.json")) as Parameters<typeof layersFrom>[0]["manifest"], root,
});

test("the harness reads nvda-speech through the layer checkout, never the workspace and never a package name", () => {
  const source = read(REPO_ROOT, HARNESS).split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
  assert.match(source, /layerRoot\("nvda-worker"\)/, "the read is not resolved from the declared layer");
  assert.doesNotMatch(source, /@a11ign\/nvda-speech|packages\/nvda-speech|createRequire/, "the harness still names the workspace package or resolves it as a module");
});

/** The segments the harness joins to the layer's root, read from ITS source: a typed copy here is the bug this test exists to catch (#3748). */
const harnessLabelsPath = (): string[] => {
  const declared = /^const LABELS_PATH = (\[.*\]);$/m.exec(read(REPO_ROOT, HARNESS));
  assert.ok(declared, "the harness no longer declares LABELS_PATH as one array literal");
  return JSON.parse(declared[1]) as string[];
};

test("the path the harness builds finds labels.py INSIDE a checkout laid out as the layer's repository is, and is refused where there is none", () => {
  // The layer repository holds the worker's `src/` at its root and the speech package at `packages/nvda-speech`, so a clone at
  // `packages/nvda-worker` has labels.py at `packages/nvda-worker/packages/nvda-speech/nvda_speech/labels.py`, not BESIDE the clone.
  const inClone = "packages/nvda-worker/packages/nvda-speech/nvda_speech/labels.py";
  withFixture({ [inClone]: "NAMES = {'edit': 1}\n", "packages/nvda-worker/package.json": "{}" }, (root) => {
    const found = join(layerCheckoutAt(root).layerRoot("nvda-worker"), ...harnessLabelsPath());
    assert.equal(readFileSync(found, "utf8"), "NAMES = {'edit': 1}\n");
  });
  const beside = { "packages/nvda-speech/nvda_speech/labels.py": "NAMES = {}\n", "packages/nvda-worker/package.json": "{}" };
  withFixture(beside, (root) => {
    const found = join(layerCheckoutAt(root).layerRoot("nvda-worker"), ...harnessLabelsPath());
    assert.equal(existsSync(found), false, "a labels.py BESIDE the clone is not where the layer repository puts it");
  });
  withFixture({ "unrelated.txt": "x" }, (root) => {
    assert.throws(() => layerCheckoutAt(root).layerRoot("nvda-worker"), /layer "nvda-worker" is declared at packages\/nvda-worker, and .* does not exist/);
  });
});
