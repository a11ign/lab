/**
 * #3143 (ADR 0041, decision 1; #3129): a repository depends on another ONLY through a published version, so `workspace:`,
 * `link:`, `file:` and a relative import that leaves the repository are REFUSED, by a test in the CONSUMING repository. This
 * is that test, in place before the next edge is cut rather than after somebody has written `workspace:*` for it.
 *
 * WHAT CROSSES A BOUNDARY, per form:
 *   - `workspace:` (and `link:`/`file:`/`portal:`) naming a package in `DEPARTED`: the workspace would resolve it to whatever
 *     copy is still on disk, so the consumer ships against a tree the registry never saw. Refused whatever the path says.
 *   - `link:`/`file:`/`portal:` whose path resolves outside this repository's root, whatever the name.
 *   - a relative import (`./`, `../`) that resolves outside the root.
 * A `workspace:` or `link:` that stays inside the repository crosses nothing and is left to the in-repo rules (`layer-edges`).
 *
 * THE POPULATION IS A PURE FUNCTION'S, so every claim has its control in this file by name:
 *   - the complete fixture is asserted to hold the things the refusals read (a departed package consumed by range, an import
 *     that stays inside, an escaping specifier only in a comment) before it is asserted to PASS, so a pass is a scan that
 *     looked and found none;
 *   - each form is planted ALONE into that fixture and must produce exactly ONE refusal, naming the specifier and the file;
 *   - the real tree is asserted to have read manifests and sources, to name a non-empty `DEPARTED`, and to consume it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// This file's population is the whole tracked tree, declared by a call rather than inferred from its source.
declareTreeWideGuard();

// Floors for "the walk read a real tree" (this repository has 11 manifests and several thousand sources); not an exact count.
const MANIFEST_FLOOR = 5;
const SOURCE_FLOOR = 1000;

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface Departed {
  readonly name: string;
  /** The repository that now releases it: this row's evidence that it left, and `project.json`'s `dora` list must agree. */
  readonly repository: string;
  readonly reason: string;
}

/**
 * THE ONE LIST: packages that have left this repository and are depended on only through the registry. A move adds ONE entry
 * (Done-when 2 of #3143). Not listed on purpose, so nobody reads it as an omission: `@a11ign/documents` is published but its
 * move (#2705) is open, and `@a11ign/screenreader-fleet` holds only a reserved `0.0.0-reserved.0` on the registry.
 */
const DEPARTED: readonly Departed[] = [
  {
    name: "@a11ign/screenreader-worker",
    repository: "a11ign/screenreader-worker",
    reason: "move 1 of #69 (#2701): released to the registry from its own repository (0.1.0), so this repo may only name a range",
  },
];

interface Manifest {
  readonly path: string;
  readonly json: Record<string, unknown>;
}
interface Source {
  readonly path: string;
  readonly text: string;
}
interface Snapshot {
  readonly manifests: readonly Manifest[];
  readonly sources: readonly Source[];
}

const PATH_FORMS = ["link:", "file:", "portal:"] as const;
const WORKSPACE_FORM = "workspace:";
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js"]);

/** Every `name -> spec` the manifest declares, with the section it came from; nested override objects are not specifiers. */
function declaredSpecifiers(json: Record<string, unknown>): { section: string; name: string; spec: string }[] {
  const pnpmOverrides = (json.pnpm as { overrides?: unknown } | undefined)?.overrides;
  const sections: [string, unknown][] = [
    ...DEPENDENCY_SECTIONS.map((section): [string, unknown] => [section, json[section]]),
    ["pnpm.overrides", pnpmOverrides],
  ];
  return sections.flatMap(([section, map]) => Object.entries((map ?? {}) as Record<string, unknown>)
    .flatMap(([name, spec]) => (typeof spec === "string" ? [{ section, name, spec }] : [])));
}

const leavesRoot = (resolved: string) => resolved === ".." || resolved.startsWith("../") || posix.isAbsolute(resolved);

/** The refusal for one manifest specifier, or null when it crosses no boundary. */
function specifierRefusal(manifest: Manifest, entry: { section: string; name: string; spec: string }, departed: ReadonlySet<string>): string | null {
  const where = `${manifest.path}: ${entry.section} "${entry.name}": "${entry.spec}"`;
  const pathForm = PATH_FORMS.find((form) => entry.spec.startsWith(form));
  if (entry.spec.startsWith(WORKSPACE_FORM) || pathForm !== undefined) {
    if (departed.has(entry.name)) {
      return `${where} resolves a package that left this repository to whatever copy is on disk: depend on its published version range`;
    }
  }
  if (pathForm === undefined) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(manifest.path), entry.spec.slice(pathForm.length)));
  return leavesRoot(resolved) ? `${where} points outside this repository: depend on a published version, not a path` : null;
}

/** Source text with the comments that a mention of an import could hide in removed; block comments only where a line opens one. */
const withoutComments = (text: string) => text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");

const STATIC_IMPORT = /^[ \t]*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*["']([^"']+)["']/gm;
const CALL_IMPORT = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

/** Every module specifier a source file asks for, in any of the four syntaxes. */
function specifiersOf(text: string): string[] {
  const code = withoutComments(text);
  return [STATIC_IMPORT, SIDE_EFFECT_IMPORT, CALL_IMPORT].flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]));
}

function importRefusals(source: Source): string[] {
  return specifiersOf(source.text)
    .filter((spec) => spec.startsWith("./") || spec.startsWith("../"))
    .filter((spec) => leavesRoot(posix.normalize(posix.join(posix.dirname(source.path), spec))))
    .map((spec) => `${source.path}: import "${spec}" resolves outside this repository: depend on a published version, not a path`);
}

/** Every refusal for a repository's manifests and sources, in file order. Pure: nothing here reads the disk or the network. */
function refusalsFor(snapshot: Snapshot, departed: ReadonlySet<string>): string[] {
  const fromManifests = snapshot.manifests.flatMap((manifest) => declaredSpecifiers(manifest.json)
    .flatMap((entry) => specifierRefusal(manifest, entry, departed) ?? []));
  return [...fromManifests, ...snapshot.sources.flatMap(importRefusals)];
}

// ---- the real tree -------------------------------------------------------------------------------------------------

// A named exclusion, in code, with its reason (engineer brief: a guard that discovers itself is excluded by a constant).
const SELF = "packages/lab/src/packaging/cross-repository-dependency-refused.test.ts";
// Fixtures are repositories of their own, and several are PLANTED with a reach out of them on purpose (layer-edges').
const FIXTURE_DIRECTORY = "/fixtures/";

function realTree(): Snapshot {
  const tracked = walkTree({ kind: "all", roots: [] }).map((file) => file.path)
    .filter((path) => path !== SELF && !path.includes(FIXTURE_DIRECTORY));
  const read = (path: string) => readFileSync(`${REPO_ROOT}${path}`, "utf8");
  return {
    manifests: tracked.filter((path) => posix.basename(path) === "package.json")
      .map((path) => ({ path, json: JSON.parse(read(path)) as Record<string, unknown> })),
    sources: tracked.filter((path) => SOURCE_EXTENSIONS.has(extname(path))).map((path) => ({ path, text: read(path) })),
  };
}

const departedNames = new Set(DEPARTED.map((entry) => entry.name));

test("the real tree crosses no repository boundary through a manifest or an import", () => {
  const tree = realTree();
  // Positive controls for the emptiness below: the walk read manifests and sources, not an empty or wrong tree.
  assert.ok(tree.manifests.length >= MANIFEST_FLOOR, `read ${tree.manifests.length} manifests: the walk is broken, and an empty walk passes`);
  assert.ok(tree.sources.length > SOURCE_FLOOR, `read ${tree.sources.length} sources: the walk is broken, and an empty walk passes`);
  assert.deepEqual(refusalsFor(tree, departedNames), []);
});

test("control: DEPARTED is not empty, each entry says why, and each repository releases it per project.json's dora list", () => {
  assert.ok(DEPARTED.length > 0, "no package has left: the refusal of a departed package's workspace: form reads nothing");
  const dora = (JSON.parse(readFileSync(`${REPO_ROOT}.agent-org/project.json`, "utf8")) as {
    dora: { repo: string; release: { kind: string; package?: string } }[];
  }).dora;
  for (const entry of DEPARTED) {
    assert.notEqual(entry.reason.trim(), "", `${entry.name} has no reason beside it`);
    const declared = dora.find((row) => row.repo === entry.repository);
    assert.equal(declared?.release.package, entry.name, `${entry.name} is not the package project.json says ${entry.repository} releases`);
  }
});

test("control: the real tree CONSUMES a departed package, and only by a registry range", () => {
  const consumers = realTree().manifests.flatMap((manifest) => declaredSpecifiers(manifest.json)
    .filter((entry) => departedNames.has(entry.name)).map((entry) => ({ path: manifest.path, ...entry })));
  assert.ok(consumers.length > 0, "nothing in this tree depends on a departed package: the population the refusal protects is empty");
  for (const consumer of consumers) {
    assert.match(consumer.spec, /^[\^~]?\d+\.\d+\.\d+/, `${consumer.path} names ${consumer.name} by "${consumer.spec}", not a version range`);
  }
});

// ---- the fixtures --------------------------------------------------------------------------------------------------

const WORKER = DEPARTED[0].name;
const CONSUMER = "packages/app/package.json";
const SOURCE = "packages/app/src/main.mjs";

/** A complete repository: a consumer of a departed package BY RANGE, an inside `link:`, an inside `../` import, a confound. */
function completeFixture(): Snapshot {
  return {
    manifests: [
      { path: CONSUMER, json: { name: "app", dependencies: { [WORKER]: "0.1.0", sibling: "workspace:*" }, devDependencies: { tool: "link:../tool" } } },
      { path: "packages/tool/package.json", json: { name: "tool" } },
    ],
    sources: [{
      path: SOURCE,
      text: [
        // The confounds: an escaping import in a line comment (the unanchored dynamic form) and in a block comment (the anchored
        // static form) is a MENTION, so the fixture passes only because the comments are stripped, never because they are absent.
        "// const m = await import(\"../../../../elsewhere/y.mjs\");",
        "/*",
        "import { x } from \"../../../../elsewhere/x.mjs\";",
        "*/",
        "import { helper } from \"../../tool/src/helper.mjs\";",
        `import { WORKER } from "${WORKER}";`,
        "export const ok = helper(WORKER);",
      ].join("\n"),
    }],
  };
}

const planted = (replacement: Partial<Record<"dependencies" | "devDependencies", Record<string, string>>>): Snapshot => {
  const fixture = completeFixture();
  const consumer = fixture.manifests.find((manifest) => manifest.path === CONSUMER) as Manifest;
  return { ...fixture, manifests: [{ ...consumer, json: { ...consumer.json, ...replacement } }, ...fixture.manifests.filter((manifest) => manifest !== consumer)] };
};

const withSource = (text: string): Snapshot => ({ ...completeFixture(), sources: [{ path: SOURCE, text }] });

test("control: the complete fixture holds what the refusals read, and PASSES", () => {
  const fixture = completeFixture();
  assert.ok(declaredSpecifiers(fixture.manifests[0].json).some((entry) => entry.name === WORKER && entry.spec === "0.1.0"), "no departed consumer by range");
  assert.ok(specifiersOf(fixture.sources[0].text).includes("../../tool/src/helper.mjs"), "no inside relative import was read");
  for (const mentioned of ["../../../../elsewhere/x.mjs", "../../../../elsewhere/y.mjs"]) {
    assert.ok(fixture.sources[0].text.includes(mentioned), `the confound ${mentioned} is not in the fixture`);
    assert.ok(!specifiersOf(fixture.sources[0].text).includes(mentioned), `a commented import ${mentioned} was read as an import`);
  }
  assert.deepEqual(refusalsFor(fixture, departedNames), []);
});

const PLANTS: readonly { form: string; specifier: string; file: string; snapshot: Snapshot }[] = [
  { form: "workspace:", specifier: "workspace:*", file: CONSUMER, snapshot: planted({ dependencies: { [WORKER]: "workspace:*" } }) },
  { form: "link:", specifier: "link:../screenreader-worker", file: CONSUMER, snapshot: planted({ dependencies: { [WORKER]: "link:../screenreader-worker" } }) },
  { form: "file:", specifier: "file:../../screenreader-worker", file: CONSUMER, snapshot: planted({ devDependencies: { [WORKER]: "file:../../screenreader-worker" } }) },
  { form: "link: to an unlisted package, out of the root", specifier: "link:../../../other-repo", file: CONSUMER, snapshot: planted({ dependencies: { other: "link:../../../other-repo" } }) },
  { form: "a relative import out of the root", specifier: "../../../../other-repo/src/x.mjs", file: SOURCE, snapshot: withSource("import { x } from \"../../../../other-repo/src/x.mjs\";\n") },
];

for (const plant of PLANTS) {
  test(`planted ${plant.form}: refused once, naming the specifier and the file`, () => {
    const refusals = refusalsFor(plant.snapshot, departedNames);
    assert.equal(refusals.length, 1, `expected exactly the planted refusal, got ${JSON.stringify(refusals)}`);
    assert.ok(refusals[0].includes(`"${plant.specifier}"`), `the refusal does not name ${plant.specifier}: ${refusals[0]}`);
    assert.ok(refusals[0].startsWith(`${plant.file}:`), `the refusal does not name ${plant.file}: ${refusals[0]}`);
  });
}

test("planted: each import syntax that reaches out of the root is refused, a side-effect one and a dynamic one included", () => {
  const out = "../../../../other-repo/x.mjs";
  for (const text of [`import "${out}";`, `const m = await import("${out}");`, `const m = require("${out}");`, `export * from "${out}";`,
    `import {\n  a,\n  b,\n} from "${out}";`]) {
    assert.equal(refusalsFor(withSource(text), departedNames).length, 1, `not refused: ${text}`);
  }
});

test("boundary: a path form to a package that stays inside, a workspace: of an inside package, and a ../ that stays inside are NOT refused", () => {
  assert.deepEqual(refusalsFor(planted({ dependencies: { inside: "file:./vendor/inside", sibling: "workspace:^" } }), departedNames), []);
  assert.deepEqual(refusalsFor(withSource("import x from \"../../tool/src/x.mjs\";\n"), departedNames), []);
  // `packages/app/src/main.mjs` + `../../..` is exactly the root, and one more `..` is out of it.
  assert.equal(refusalsFor(withSource("import x from \"../../../root-file.mjs\";\n"), departedNames).length, 0);
  assert.equal(refusalsFor(withSource("import x from \"../../../../root-file.mjs\";\n"), departedNames).length, 1);
});

test("a move adds ONE line: with the list empty a departed package's workspace: is no longer read, so the list is what refuses it", () => {
  const plantedWorkspace = planted({ dependencies: { [WORKER]: "workspace:*" } });
  assert.equal(refusalsFor(plantedWorkspace, departedNames).length, 1);
  assert.equal(refusalsFor(plantedWorkspace, new Set()).length, 0);
  assert.equal(dirname(CONSUMER), "packages/app");
});
