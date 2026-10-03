/**
 * #3138 (ADR 0041, decision 7): `.agent-org/project.json`'s `dora` list is the ONE place the daily DORA reading (`agent-org dora`,
 * #3135) learns WHICH repositories to measure and WHERE each one's releases are read. This file is its owner and its test.
 *
 * Four claims, each with a fixture positive control beside it:
 *
 *   1. The list is exactly the repositories ADR 0041's table names (read from the ADR, not retyped here), so a repository the ADR
 *      names and the declaration lacks is refused NAMING it, and so is one the declaration adds that the ADR does not name.
 *   2. Each has a kind that agrees with the ADR's "releases by" cell: `npm` where it publishes to the registry, `tag` where it
 *      publishes a git tag and GitHub Release only (`lab` and `control`, which are `private: true`).
 *   3. An npm repository names a package, and that package is the `name` of a public manifest under one of its `releasablePaths`
 *      in THIS workspace. A package that has moved is no longer in this workspace, and its move row repoints this reading at the
 *      new repository's manifest in the same pull request that updates its entry (the row's Done-when 2).
 *   4. Every repository lists at least one `releasablePaths` prefix, which the reader requires and which an empty list would make
 *      count nothing as a releasable change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ADR_FILE = "docs/adr/0041-every-repository-releases-itself-continuously.md";
const PROJECT_FILE = ".agent-org/project.json";
const OWNER = "a11ign/";
const SEVEN = 7;

interface Declared {
  repo?: unknown;
  release?: { kind?: unknown; package?: unknown };
  releasablePaths?: unknown;
}
interface AdrRepository {
  repo: string;
  kind: "npm" | "tag";
}
interface Manifest {
  name?: string;
  private?: boolean;
}
type ReadManifest = (directory: string) => Manifest | null;

const readText = (path: string) => readFileSync(`${REPO_ROOT}${path}`, "utf8");

const workspaceManifest: ReadManifest = (directory) => {
  const file = `${directory}package.json`;
  return existsSync(`${REPO_ROOT}${file}`) ? (JSON.parse(readText(file)) as Manifest) : null;
};

/** The rows of ADR 0041's "The seven repositories" table: the repository and how its "release mechanism" cell publishes. */
function adrRepositories(adr: string): AdrRepository[] {
  const section = adr.split("## The seven repositories")[1]?.split("\n## ")[0] ?? "";
  return section.split("\n").flatMap((line) => {
    const row = /^\| `([a-z0-9-]+)` \|[^|]*\|([^|]*)\|$/.exec(line);
    if (row === null) return [];
    return [{ repo: `${OWNER}${row[1]}`, kind: /\bnpm\b/.test(row[2]) && !/no npm/.test(row[2]) ? "npm" : "tag" }];
  });
}

/** The first refusal for one declared repository, or null when it is sound. */
function entryRefusal(entry: Declared, adr: AdrRepository, manifest: ReadManifest): string | null {
  const repo = adr.repo;
  const paths = entry.releasablePaths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== "string" || path === "")) {
    return `${repo}: releasablePaths must be a non-empty list of path prefixes, so a pull request can count as a releasable change`;
  }
  const kind = entry.release?.kind;
  if (kind !== adr.kind) return `${repo}: release.kind is ${JSON.stringify(kind)} and ADR 0041 publishes it as \`${adr.kind}\``;
  if (kind === "tag") return null;
  const name = entry.release?.package;
  if (typeof name !== "string" || name === "") return `${repo}: an npm repository must name its package, and this one names none`;
  const names = (paths as string[]).flatMap((path) => {
    const found = manifest(path);
    return found === null || found.private === true || found.name === undefined ? [] : [found.name];
  });
  return names.includes(name) ? null : `${repo}: package ${JSON.stringify(name)} is not the name of a public manifest under ${paths.join(", ")} (found ${JSON.stringify(names)})`;
}

/** Every refusal for a declaration against the ADR's repositories, in a fixed order. */
function refusalsFor({ declared, adr, manifest }: { declared: unknown; adr: AdrRepository[]; manifest: ReadManifest }): string[] {
  if (!Array.isArray(declared)) return ["`dora` must be a list"];
  const entries = declared as Declared[];
  const named = entries.map((entry) => entry.repo);
  const known = new Set(adr.map((row) => row.repo));
  const missing = adr.filter((row) => !named.includes(row.repo)).map((row) => `${row.repo}: ADR 0041 names it and the declaration lacks it`);
  const unknown = named.filter((repo) => !known.has(repo as string)).map((repo) => `${String(repo)}: the declaration lists it and ADR 0041 does not name it`);
  const twice = named.filter((repo, index) => named.indexOf(repo) !== index).map((repo) => `${String(repo)}: declared twice`);
  const entryRefusals = adr.flatMap((row) => {
    const entry = entries.find((candidate) => candidate.repo === row.repo);
    const refusal = entry === undefined ? null : entryRefusal(entry, row, manifest);
    return refusal === null ? [] : [refusal];
  });
  return [...missing, ...unknown, ...twice, ...entryRefusals];
}

const adr = adrRepositories(readText(ADR_FILE));
const realDeclared = (JSON.parse(readText(PROJECT_FILE)) as { dora?: unknown }).dora;

test("control: ADR 0041's table yields exactly the seven repositories, with lab and control as tags", () => {
  assert.equal(adr.length, SEVEN, "the table parse found a different number of repositories, so every check below stands on the wrong set");
  const kinds = Object.fromEntries(adr.map((row) => [row.repo, row.kind]));
  assert.deepEqual(kinds, {
    "a11ign/a11ign": "npm",
    "a11ign/agent-org": "tag",
    "a11ign/screenreader-worker": "npm",
    "a11ign/screenreader-fleet": "npm",
    "a11ign/documents": "npm",
    "a11ign/lab": "tag",
    "a11ign/control": "tag",
  });
});

test("the declaration lists exactly the seven repositories, each sound against this workspace", () => {
  assert.ok(Array.isArray(realDeclared), `${PROJECT_FILE} has no \`dora\` list`);
  assert.equal((realDeclared as unknown[]).length, SEVEN);
  assert.deepEqual(refusalsFor({ declared: realDeclared, adr, manifest: workspaceManifest }), []);
});

/** A sound declaration over fixture manifests, which the refusals below each break by one edit. */
const SOUND: Declared[] = adr.map((row) => ({
  repo: row.repo,
  release: row.kind === "npm" ? { kind: "npm", package: `@fixture/${row.repo.slice(OWNER.length)}` } : { kind: "tag" },
  releasablePaths: [`packages/${row.repo.slice(OWNER.length)}/`],
}));
const fixtureManifest: ReadManifest = (directory) => {
  const name = directory.split("/")[1];
  return { name: `@fixture/${name}`, private: adr.find((row) => row.repo === `${OWNER}${name}`)?.kind === "tag" };
};
const refusals = (declared: unknown) => refusalsFor({ declared, adr, manifest: fixtureManifest });

test("control: the sound fixture is accepted, so each refusal below is its own edit's", () => {
  assert.equal(SOUND.length, SEVEN);
  assert.deepEqual(refusals(SOUND), []);
});

test("control: a repository the ADR names and the declaration lacks is REFUSED, naming it", () => {
  const without = SOUND.filter((entry) => entry.repo !== "a11ign/documents");
  assert.equal(without.length, SEVEN - 1);
  assert.deepEqual(refusals(without), ["a11ign/documents: ADR 0041 names it and the declaration lacks it"]);
});

test("control: a repository the declaration adds and the ADR does not name is REFUSED, naming it", () => {
  assert.deepEqual(refusals([...SOUND, { ...SOUND[0], repo: "a11ign/extra" }]), ["a11ign/extra: the declaration lists it and ADR 0041 does not name it"]);
});

test("control: an npm repository that names no package is REFUSED", () => {
  const nameless = SOUND.map((entry) => (entry.repo === "a11ign/a11ign" ? { ...entry, release: { kind: "npm" } } : entry));
  assert.match(refusals(nameless).join("\n"), /a11ign\/a11ign: an npm repository must name its package/);
  const empty = SOUND.map((entry) => (entry.repo === "a11ign/a11ign" ? { ...entry, release: { kind: "npm", package: "" } } : entry));
  assert.match(refusals(empty).join("\n"), /a11ign\/a11ign: an npm repository must name its package/);
});

test("control: a kind that disagrees with the ADR, a package no manifest carries, and no releasable path are each REFUSED", () => {
  const edit = (repo: string, change: Partial<Declared>) => SOUND.map((entry) => (entry.repo === repo ? { ...entry, ...change } : entry));
  assert.match(refusals(edit("a11ign/lab", { release: { kind: "npm", package: "@fixture/lab" } })).join("\n"), /a11ign\/lab: release\.kind is "npm" and ADR 0041 publishes it as `tag`/);
  assert.match(refusals(edit("a11ign/documents", { release: { kind: "npm", package: "@fixture/other" } })).join("\n"), /a11ign\/documents: package "@fixture\/other" is not the name of a public manifest/);
  assert.match(refusals(edit("a11ign/control", { releasablePaths: [] })).join("\n"), /a11ign\/control: releasablePaths must be a non-empty list/);
});

test("control: a declaration that is not a list, or lists a repository twice, is REFUSED", () => {
  assert.deepEqual(refusals(undefined), ["`dora` must be a list"]);
  assert.deepEqual(refusals([...SOUND, SOUND[0]]), ["a11ign/a11ign: declared twice"]);
});
