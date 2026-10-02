/**
 * `@a11ign/worker-fleet` BECAME `@a11ign/screenreader-fleet` -- the split's move row R2 (#2887, #69, ADR 0040).
 *
 * ADR 0036 named the new name and it was never carried out on the registry. npm cannot rename a package, so
 * the release publishes the new name and the old one is deprecated by an owner. This lands BEFORE M2 (#2702),
 * so the trusted-publisher binding is made once, against the final name.
 *
 * THREE CLAIMS, each read from the real tree:
 *   1. the package's `name` is the new one;
 *   2. no NON-DOCUMENT file names the old one (`*.md` and `docs/` are the record, and keep it -- the deprecation
 *      note and the history live there; the pending changeset is a `.md` and is exempt by that rule);
 *   3. every workspace importer that declares the new name resolves it in `pnpm-lock.yaml` as a `link:` to the
 *      package's directory. The directory is still `packages/worker-fleet/`: M2 moves it, this row does not.
 *
 *   4. every pending changeset's frontmatter names a package that exists: `changeset version` throws on one that
 *      does not, so a rename that leaves the old name in a pending changeset breaks the RELEASE that publishes
 *      the new one (found at #2887: #2885's rename had left the same break for `nvda-worker`).
 *
 * THE OLD NAME IS BUILT, NOT WRITTEN: this file is itself a non-document file, and a literal would make the
 * walk refuse its own source. It is also excluded by name (`SELF`), so a reader meets the decision in code.
 *
 * POSITIVE CONTROL (#2887): the same walk, pointed at a throwaway directory holding a file that names the old
 * name, REFUSES it -- and, aimed at a clean file and at a `.md`, does not. A walk that found nothing on the
 * real tree would otherwise be indistinguishable from a walk that cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const PACKAGE_DIR = "packages/worker-fleet";
const NEW_NAME = "@a11ign/screenreader-fleet";
const OLD_NAME = ["@a11ign", "worker-fleet"].join("/");
const SELF = relative(REPO, import.meta.filename);
/** The name as written in source AND as escaped inside a regex literal (`@a11ign\/...`): three assertions spelled it the second way and a plain search walked past them. */
const OLD_NAME_AS_A_WHOLE_WORD = new RegExp(`${OLD_NAME.replace("/", "\\\\?/")}(?![-\\w])`);
/** The sections of a manifest that declare an edge to another package. */
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const isDocument = (file: string) => file.endsWith(".md") || file.startsWith("docs/");

/** Every tracked file of the tree, as paths relative to `root`. */
function trackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean);
}

/** The non-document files under `files` that name the old package, `SELF` excluded. */
function filesNamingTheOldName(root: string, files: string[]): string[] {
  return files
    .filter((file) => !isDocument(file) && file !== SELF)
    .filter((file) => OLD_NAME_AS_A_WHOLE_WORD.test(readFileSync(join(root, file), "utf8")));
}

type Manifest = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, string>>> & { name?: string };
const readManifest = (file: string): Manifest => JSON.parse(readFileSync(join(REPO, file), "utf8")) as Manifest;

/** The workspace's manifests: the root's and each package's, which is `pnpm-workspace.yaml`'s own `packages/*`. */
const workspaceManifests = () => trackedFiles(REPO).filter((file) => file === "package.json" || /^packages\/[^/]+\/package\.json$/.test(file));

const declaresNewName = (manifest: Manifest) => DEPENDENCY_SECTIONS.some((section) => manifest[section]?.[NEW_NAME] !== undefined);

type LockImporter = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, { version: string }>>>;

test("the package's name is the new one", () => {
  assert.equal(readManifest(`${PACKAGE_DIR}/package.json`).name, NEW_NAME);
});

test("no non-document file names the old package", () => {
  const files = trackedFiles(REPO);
  assert.ok(files.length > 1000, "the walk read almost nothing: it is not looking at the tree");
  assert.deepEqual(filesNamingTheOldName(REPO, files), []);
});

test("positive control: the walk finds the old name in a fixture and refuses it, and passes what is clean", () => {
  const root = mkdtempSync(join(tmpdir(), "rename-2887-"));
  try {
    const write = (file: string, text: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    write("packages/x/package.json", `{ "dependencies": { "${OLD_NAME}": "0.0.0" } }\n`);
    write("packages/x/src/deep.mjs", `import "${OLD_NAME}/code-version";\n`);
    write("packages/x/src/clean.mjs", `import "${NEW_NAME}";\n`);
    write("packages/x/src/lookalike.mjs", `// ${OLD_NAME}-extra is another name\n`);
    write("packages/x/src/escaped.test.ts", `assert.match(source, /${OLD_NAME.replace("/", "\\/")}/);\n`);
    write("docs/history.md", `The package was ${OLD_NAME}.\n`);
    write("CHANGELOG.md", `Renamed from ${OLD_NAME}.\n`);
    const refused = filesNamingTheOldName(root, [
      "packages/x/package.json", "packages/x/src/deep.mjs", "packages/x/src/clean.mjs",
      "packages/x/src/lookalike.mjs", "packages/x/src/escaped.test.ts", "docs/history.md", "CHANGELOG.md",
    ]);
    assert.deepEqual(refused, ["packages/x/package.json", "packages/x/src/deep.mjs", "packages/x/src/escaped.test.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every importer that declares the new name resolves it in pnpm-lock.yaml, as a link to the package", () => {
  const lock = parse(readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8")) as { importers: Record<string, LockImporter> };
  const declarers = workspaceManifests().filter((file) => declaresNewName(readManifest(file)));
  // Derived a second way: the three manifests `git grep` finds naming it, so a walk that lost one is not "enough".
  assert.deepEqual(declarers, ["package.json", "packages/cli/package.json", "packages/lab/package.json"]);
  for (const file of declarers) {
    const importer = dirname(file);
    const section = DEPENDENCY_SECTIONS.find((name) => lock.importers[importer]?.[name]?.[NEW_NAME]);
    const resolved = section === undefined ? undefined : lock.importers[importer]?.[section]?.[NEW_NAME]?.version;
    const wanted = `link:${relative(importer, PACKAGE_DIR) || "."}`;
    assert.equal(resolved, wanted, `${file} declares ${NEW_NAME}, and pnpm-lock.yaml resolves it to ${resolved ?? "nothing"}`);
  }
});

/** The package names a changeset's frontmatter releases: the quoted keys between the opening pair of `---`. */
function namesInFrontmatter(text: string): string[] {
  const block = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^\s*["']?([^"':\s]+)["']?\s*:/gm)].map((match) => match[1]);
}

/** The pending changesets whose frontmatter names something not in `known`. */
function changesetsNamingAnUnknownPackage(dir: string, known: Set<string>): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .filter((file) => namesInFrontmatter(readFileSync(join(dir, file), "utf8")).some((name) => !known.has(name)));
}

test("every pending changeset names a package that exists, so `changeset version` can run", () => {
  const known = new Set(workspaceManifests().map((file) => readManifest(file).name).filter((name): name is string => name !== undefined));
  assert.ok(known.has(NEW_NAME), "the workspace does not know the new name: the set of known packages was not read");
  assert.deepEqual(changesetsNamingAnUnknownPackage(join(REPO, ".changeset"), known), []);
});

test("positive control: a changeset naming the old name is refused, and one naming the new name is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "changeset-2887-"));
  try {
    writeFileSync(join(dir, "stale.md"), `---\n"${OLD_NAME}": patch\n---\n\nbody\n`);
    writeFileSync(join(dir, "current.md"), `---\n"${NEW_NAME}": patch\n---\n\nmentions ${OLD_NAME} in its body\n`);
    writeFileSync(join(dir, "README.md"), `${OLD_NAME}\n`);
    assert.deepEqual(changesetsNamingAnUnknownPackage(dir, new Set([NEW_NAME])), ["stale.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
