/**
 * `@a11ign/nvda-worker` BECAME `@a11ign/screenreader-worker` -- the split's move row R1 (#2885, #69, ADR 0040).
 *
 * ADR 0036 named the new name and it was never carried out on the registry. npm cannot rename a package, so
 * the release publishes the new name and the old one is deprecated by an owner. This lands BEFORE M1 (#2701),
 * so the trusted-publisher binding is made once, against the final name.
 *
 * THREE CLAIMS, each read from the real tree:
 *   1. the package's `name` is the new one (read, since #3447, from the REGISTRY copy this repository consumes: the workspace directory is gone);
 *   2. no NON-DOCUMENT file names the old one (`*.md` and `docs/` are the record, and keep it -- the deprecation
 *      note and the history live there; the pending changeset is a `.md` and is exempt by that rule);
 *   3. every workspace importer that declares the new name resolves it in `pnpm-lock.yaml` to a REGISTRY version, not a `link:`
 *      (#3447 deleted `packages/nvda-worker/`; it was a link to that directory until then).
 *
 * THE OLD NAME IS BUILT, NOT WRITTEN: this file is itself a non-document file, and a literal would make the
 * walk refuse its own source. It is also excluded by name (`SELF`), so a reader meets the decision in code.
 *
 * POSITIVE CONTROL (#2885): the same walk, pointed at a throwaway directory holding a file that names the old
 * name, REFUSES it -- and, aimed at a clean file and at a `.md`, does not. A walk that found nothing on the
 * real tree would otherwise be indistinguishable from a walk that cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { sandboxGitEnv } from "../../../guards/src/git-env.ts";
import { layerFile } from "../../../guards/src/layer-file.ts";

const REPO = resolve(import.meta.dirname, "../../../..");
const NEW_NAME = "@a11ign/screenreader-worker";
const OLD_NAME = ["@a11ign", "nvda-worker"].join("/");
const SELF = relative(REPO, import.meta.filename);
/** The name as written in source AND as escaped inside a regex literal (`@a11ign\/...`): three assertions spelled it the second way and a plain search walked past them. */
const OLD_NAME_AS_A_WHOLE_WORD = new RegExp(`${OLD_NAME.replace("/", "\\\\?/")}(?![-\\w])`);
/** The sections of a manifest that declare an edge to another package. */
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * A file that names the old package ON PURPOSE: `lay-layer.test.ts` asserts the refusal `no importer entry for @a11ign/nvda-worker`, the message
 * the layer-laying plan prints when a layer declares no `package:` and its KEY is looked up as the package name (the defect #2885's rename
 * closed). The old name there is the expected output of a fixture, not a dependency on the package. Found red at CORE_REF 8d59c95e5 (#4372);
 * the test below refuses this entry once the file stops naming it, so the exemption cannot outlive its reason.
 */
const NAMES_THE_OLD_PACKAGE_AS_A_FIXTURE = ["packages/guards/src/lay-layer.test.ts"];

const isDocument = (file: string) => file.endsWith(".md") || file.startsWith("docs/");

/** Every tracked file of the tree, as paths relative to `root`. */
function trackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean);
}

/** The non-document files under `files` that name the old package, `SELF` excluded. */
function filesNamingTheOldName(root: string, files: string[]): string[] {
  return files
    .filter((file) => !isDocument(file) && file !== SELF && !NAMES_THE_OLD_PACKAGE_AS_A_FIXTURE.includes(file))
    .filter((file) => OLD_NAME_AS_A_WHOLE_WORD.test(readFileSync(join(root, file), "utf8")));
}

type Manifest = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, string>>> & { name?: string };
const readManifest = (file: string): Manifest => JSON.parse(readFileSync(join(REPO, file), "utf8")) as Manifest;

/** The workspace's manifests: the root's and each package's, which is `pnpm-workspace.yaml`'s own `packages/*`. */
const workspaceManifests = () => trackedFiles(REPO).filter((file) => file === "package.json" || /^packages\/[^/]+\/package\.json$/.test(file));

const declaresNewName = (manifest: Manifest) => DEPENDENCY_SECTIONS.some((section) => manifest[section]?.[NEW_NAME] !== undefined);

type LockImporter = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, { version: string }>>>;

test("the package's name is the new one", () => {
  const manifest = layerFile(NEW_NAME, "package.json", { from: import.meta.dirname });
  assert.equal((JSON.parse(readFileSync(manifest, "utf8")) as Manifest).name, NEW_NAME);
});

test("no non-document file names the old package", () => {
  const files = trackedFiles(REPO);
  assert.ok(files.length > 1000, "the walk read almost nothing: it is not looking at the tree");
  assert.deepEqual(filesNamingTheOldName(REPO, files), []);
});

test("#4372: every exempted fixture still names the old package, and nothing else is exempted by this list", () => {
  assert.ok(NAMES_THE_OLD_PACKAGE_AS_A_FIXTURE.length > 0, "positive control: the list this test reads is not empty");
  for (const file of NAMES_THE_OLD_PACKAGE_AS_A_FIXTURE) {
    assert.match(readFileSync(join(REPO, file), "utf8"), OLD_NAME_AS_A_WHOLE_WORD, `${file} no longer names the old package: delete the exemption`);
  }
});

test("positive control: the walk finds the old name in a fixture and refuses it, and passes what is clean", () => {
  const root = mkdtempSync(join(tmpdir(), "rename-2885-"));
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

/** The lab is laid here untracked and is NOT an importer of this lockfile (#3505): its own repository's lockfile resolves it. Its manifest is held to the same standard below, by its range. */
const LAB_MANIFEST = "packages/lab/package.json";

test("the lab's manifest declares the new name by a registry range, never a link or a workspace reference", () => {
  const range = DEPENDENCY_SECTIONS.map((name) => readManifest(LAB_MANIFEST)[name]?.[NEW_NAME]).find((value) => value !== undefined);
  assert.match(range ?? "", /^\^?\d+\.\d+\.\d+$/, `${LAB_MANIFEST} declares ${NEW_NAME} as ${range ?? "nothing"}, not a registry range`);
});

test("every importer that declares the new name resolves it in pnpm-lock.yaml, to a registry version, never a link", () => {
  const lock = parse(readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8")) as { importers: Record<string, LockImporter> };
  const declarers = workspaceManifests().filter((file) => declaresNewName(readManifest(file)));
  // Derived a second way: the three manifests `git grep` finds naming it, so a walk that lost one is not "enough".
  assert.deepEqual(declarers, ["package.json", "packages/lab/package.json"]);
  for (const file of declarers.filter((declarer) => declarer !== LAB_MANIFEST)) {
    const importer = dirname(file);
    const section = DEPENDENCY_SECTIONS.find((name) => lock.importers[importer]?.[name]?.[NEW_NAME]);
    const resolved = section === undefined ? undefined : lock.importers[importer]?.[section]?.[NEW_NAME]?.version;
    assert.match(resolved ?? "", /^\d+\.\d+\.\d+$/,
      `${file} declares ${NEW_NAME}, and pnpm-lock.yaml resolves it to ${resolved ?? "nothing"}, not a version the registry holds`);
  }
});
