/**
 * #3138 (ADR 0041, decision 7): `.agent-org/project.json`'s `dora` list is the ONE place the daily DORA reading (`agent-org dora`,
 * #3135) learns WHICH repositories to measure and WHERE each one's releases are read. This file is its owner and its test.
 *
 * Five claims, each with a fixture positive control beside it:
 *
 *   1. The list is exactly the repositories ADR 0041's table names (read from the ADR, not retyped here) plus the ones named in
 *      BEYOND_THE_ADR, so a repository either names and the declaration lacks is refused NAMING it, and so is one the declaration
 *      adds that neither names.
 *   2. Each has a kind that agrees with the ADR's "releases by" cell: `npm` where it publishes to the registry, `tag` where it
 *      publishes a git tag and GitHub Release only (`lab` and `control`, which are `private: true`).
 *   3. An npm repository names a package, and that package is the `name` of a public manifest under one of its `releasablePaths`
 *      in THIS workspace. A package that has moved is no longer in this workspace, and its move row repoints this reading at the
 *      new repository's manifest in the same pull request that updates its entry (the row's Done-when 2).
 *   4. Every repository lists at least one `releasablePaths` prefix, which the reader requires and which an empty list would make
 *      count nothing as a releasable change.
 *   5. (#3719) Every `code` repository in `project.json` has a `dora` entry or a NAMED reason it has none, read from `code` and not
 *      from a list kept here, so the next repository the org declares cannot be skipped by the reading the way `toolchain` was.
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
const TOOLCHAIN = "a11ign/toolchain";

interface Declared {
  repo?: unknown;
  release?: { kind?: unknown; package?: unknown };
  releasablePaths?: unknown;
}
interface AdrRepository {
  repo: string;
  kind: "npm" | "tag";
  /** What names the repository and its kind, quoted in a refusal so the reader knows which document to read. */
  source: string;
}
interface CodeRepository {
  key?: unknown;
  repo?: unknown;
}
interface Manifest {
  name?: string;
  private?: boolean;
}
type ReadManifest = (directory: string) => Manifest | null;

const readText = (path: string) => readFileSync(`${REPO_ROOT}${path}`, "utf8");

/**
 * A package that has MOVED (#3125: `documents`, #3447: `screenreader-worker`, #3504: `screenreader-fleet`, #3625: `toolchain`) is no longer under `packages/` here, but its own repository keeps the layout
 * `releasablePaths` names. Its manifest is read from the copy this workspace INSTALLED from the registry, which is the published one, so the
 * name is still read from a real manifest and not assumed. The key is the declared prefix, the value where that manifest now is.
 */
const MOVED_TO_THE_REGISTRY: Record<string, string> = {
  "packages/pdf/": "packages/cli/node_modules/@a11ign/documents/package.json",
  // `nvda-speech/` has no entry: it is private and not in the published package, and the check reads only public manifests.
  "packages/nvda-worker/": "packages/lab/node_modules/@a11ign/screenreader-worker/package.json",
  "packages/worker-fleet/": "packages/lab/node_modules/@a11ign/screenreader-fleet/package.json",
  "packages/toolchain/": "node_modules/@a11ign/toolchain/package.json",
};

const workspaceManifest: ReadManifest = (directory) => {
  const file = MOVED_TO_THE_REGISTRY[directory] ?? `${directory}package.json`;
  return existsSync(`${REPO_ROOT}${file}`) ? (JSON.parse(readText(file)) as Manifest) : null;
};

/**
 * Repositories ADR 0041's seven-row table predates. `toolchain` is the package ADR 0043 extracts (#3578) and publishes to npm from its
 * own repository, so it is `npm`; its manifest is the installed copy (#3625 deleted `packages/toolchain/` here), and `releasablePaths` names the directory in THAT repository.
 */
const BEYOND_THE_ADR: AdrRepository[] = [{ repo: TOOLCHAIN, kind: "npm", source: "ADR 0043" }];

/**
 * A `code` repository the daily reading deliberately does not measure, with the reason. EMPTY today: every declared repository
 * releases and is read. An entry here without a reason, or for a repository that has a `dora` entry anyway, is refused.
 */
const NO_DORA_READING: Record<string, string> = {};

/** The rows of ADR 0041's "The seven repositories" table: the repository and how its "release mechanism" cell publishes. */
function adrRepositories(adr: string): AdrRepository[] {
  const section = adr.split("## The seven repositories")[1]?.split("\n## ")[0] ?? "";
  return section.split("\n").flatMap((line) => {
    const row = /^\| `([a-z0-9-]+)` \|[^|]*\|([^|]*)\|$/.exec(line);
    if (row === null) return [];
    return [{ repo: `${OWNER}${row[1]}`, kind: /\bnpm\b/.test(row[2]) && !/no npm/.test(row[2]) ? "npm" : "tag", source: "ADR 0041" }];
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
  if (kind !== adr.kind) return `${repo}: release.kind is ${JSON.stringify(kind)} and ${adr.source} publishes it as \`${adr.kind}\``;
  if (kind === "tag") return null;
  const name = entry.release?.package;
  if (typeof name !== "string" || name === "") return `${repo}: an npm repository must name its package, and this one names none`;
  const names = (paths as string[]).flatMap((path) => {
    const found = manifest(path);
    return found === null || found.private === true || found.name === undefined ? [] : [found.name];
  });
  return names.includes(name) ? null : `${repo}: package ${JSON.stringify(name)} is not the name of a public manifest under ${paths.join(", ")} (found ${JSON.stringify(names)})`;
}

/** Every refusal for a declaration against the expected repositories (the ADR's plus BEYOND_THE_ADR), in a fixed order. */
function refusalsFor({ declared, expected, manifest }: { declared: unknown; expected: AdrRepository[]; manifest: ReadManifest }): string[] {
  if (!Array.isArray(declared)) return ["`dora` must be a list"];
  const entries = declared as Declared[];
  const named = entries.map((entry) => entry.repo);
  const known = new Set(expected.map((row) => row.repo));
  const missing = expected.filter((row) => !named.includes(row.repo)).map((row) => `${row.repo}: ${row.source} names it and the declaration lacks it`);
  const unknown = named.filter((repo) => !known.has(repo as string)).map((repo) => `${String(repo)}: the declaration lists it and ADR 0041 does not name it`);
  const twice = named.filter((repo, index) => named.indexOf(repo) !== index).map((repo) => `${String(repo)}: declared twice`);
  const entryRefusals = expected.flatMap((row) => {
    const entry = entries.find((candidate) => candidate.repo === row.repo);
    const refusal = entry === undefined ? null : entryRefusal(entry, row, manifest);
    return refusal === null ? [] : [refusal];
  });
  return [...missing, ...unknown, ...twice, ...entryRefusals];
}

/** The `code` repositories with no `dora` entry and no named reason, plus any exemption that is itself unsound, in `code` order. */
function unreadRepositories({ code, dora, exempt }: { code: unknown; dora: unknown; exempt: Record<string, string> }): string[] {
  if (!Array.isArray(code)) return ["`code` must be a list"];
  const codeRepos = (code as CodeRepository[]).map((entry) => String(entry.repo));
  const read = new Set(Array.isArray(dora) ? (dora as Declared[]).map((entry) => entry.repo) : []);
  const unread = codeRepos.filter((repo) => !read.has(repo) && !(repo in exempt));
  const lacking = unread.map((repo) => `${repo}: declared in \`code\` and the \`dora\` list lacks it, so its deployment frequency and lead time are never read`);
  const unsound = Object.entries(exempt).flatMap(([repo, reason]) => {
    if (reason.trim() === "") return [`${repo}: exempt from the DORA reading with no reason named`];
    if (!codeRepos.includes(repo)) return [`${repo}: exempt from the DORA reading and not a \`code\` repository, so the exemption excuses nothing`];
    return read.has(repo) ? [`${repo}: exempt from the DORA reading and has a \`dora\` entry, so the exemption is stale`] : [];
  });
  return [...lacking, ...unsound];
}

const adr = adrRepositories(readText(ADR_FILE));
const expected = [...adr, ...BEYOND_THE_ADR];
const EXPECTED_COUNT = SEVEN + BEYOND_THE_ADR.length;
const project = JSON.parse(readText(PROJECT_FILE)) as { dora?: unknown; code?: unknown };
const realDeclared = project.dora;

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

test("the declaration lists the seven repositories and toolchain, each sound against this workspace", () => {
  assert.ok(Array.isArray(realDeclared), `${PROJECT_FILE} has no \`dora\` list`);
  assert.equal((realDeclared as unknown[]).length, EXPECTED_COUNT);
  assert.deepEqual(refusalsFor({ declared: realDeclared, expected, manifest: workspaceManifest }), []);
});

/** A sound declaration over fixture manifests, which the refusals below each break by one edit. */
const SOUND: Declared[] = expected.map((row) => ({
  repo: row.repo,
  release: row.kind === "npm" ? { kind: "npm", package: `@fixture/${row.repo.slice(OWNER.length)}` } : { kind: "tag" },
  releasablePaths: [`packages/${row.repo.slice(OWNER.length)}/`],
}));
const fixtureManifest: ReadManifest = (directory) => {
  const name = directory.split("/")[1];
  return { name: `@fixture/${name}`, private: expected.find((row) => row.repo === `${OWNER}${name}`)?.kind === "tag" };
};
const refusals = (declared: unknown) => refusalsFor({ declared, expected, manifest: fixtureManifest });

test("control: the sound fixture is accepted, so each refusal below is its own edit's", () => {
  assert.equal(SOUND.length, EXPECTED_COUNT);
  assert.deepEqual(refusals(SOUND), []);
});

test("control: a repository the ADR names and the declaration lacks is REFUSED, naming it", () => {
  const without = SOUND.filter((entry) => entry.repo !== "a11ign/documents");
  assert.equal(without.length, EXPECTED_COUNT - 1);
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

const realCode = project.code;
const FIXTURE_CODE: CodeRepository[] = [{ key: "", repo: "a11ign/one" }, { key: "two", repo: "a11ign/two" }];
const FIXTURE_DORA: Declared[] = [{ repo: "a11ign/one" }, { repo: "a11ign/two" }];

test("control: the real `code` population is not empty and includes toolchain, so the emptiness assertion below reads something", () => {
  assert.ok(Array.isArray(realCode));
  const repos = (realCode as CodeRepository[]).map((entry) => entry.repo);
  assert.ok(repos.length > SEVEN, `\`code\` lists ${repos.length} repositories`);
  assert.ok(repos.includes(TOOLCHAIN));
});

test("every `code` repository has a `dora` entry or a named reason it has none (#3719)", () => {
  assert.deepEqual(unreadRepositories({ code: realCode, dora: realDeclared, exempt: NO_DORA_READING }), []);
});

test("control: a `code` repository missing from `dora` is REFUSED, naming it, and a named reason excuses it", () => {
  const missing = unreadRepositories({ code: FIXTURE_CODE, dora: FIXTURE_DORA.slice(0, 1), exempt: {} });
  assert.deepEqual(missing, ["a11ign/two: declared in `code` and the `dora` list lacks it, so its deployment frequency and lead time are never read"]);
  assert.deepEqual(unreadRepositories({ code: FIXTURE_CODE, dora: FIXTURE_DORA, exempt: {} }), []);
  assert.deepEqual(unreadRepositories({ code: FIXTURE_CODE, dora: FIXTURE_DORA.slice(0, 1), exempt: { "a11ign/two": "it never releases" } }), []);
});

test("control: an exemption with no reason, for a non-`code` repository, or for one that has a `dora` entry is REFUSED", () => {
  const dora = FIXTURE_DORA.slice(0, 1);
  assert.match(unreadRepositories({ code: FIXTURE_CODE, dora, exempt: { "a11ign/two": " " } }).join("\n"), /a11ign\/two: exempt from the DORA reading with no reason named/);
  assert.match(unreadRepositories({ code: FIXTURE_CODE, dora, exempt: { "a11ign/two": "why", "a11ign/gone": "why" } }).join("\n"), /a11ign\/gone: .*not a `code` repository/);
  assert.match(unreadRepositories({ code: FIXTURE_CODE, dora, exempt: { "a11ign/one": "why" } }).join("\n"), /a11ign\/one: .*has a `dora` entry, so the exemption is stale/);
  assert.deepEqual(unreadRepositories({ code: undefined, dora, exempt: {} }), ["`code` must be a list"]);
});
