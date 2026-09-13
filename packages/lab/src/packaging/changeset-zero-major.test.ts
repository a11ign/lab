/**
 * NO PENDING `major` ON A 0.x PACKAGE, AND A NEVER-PUBLISHED PACKAGE'S FIRST RELEASE IS 0.1.0 -- #1396.
 *
 * Measured 2026-09-13 in release dry run 34776105178: `changeset status` read `major` for all six public
 * packages, over manifests at 0.1.0, so `publish-for-real` would have shipped 1.0.0 -- two pending changesets
 * declared `major` (the rename, and a model promotion written by `promote:model` at `major`). The fix's own dry
 * run, 34779638909 on `26c1d929`, reached the release gate; the gate refused at that run; the versions are read
 * from the run on this commit. Version one
 * of this product is defined as an outside user saying it was worth it, not as a first upload.
 *
 * Two rules, both read from the REAL `.changeset/` and the REAL manifests:
 *
 *   1. While a public package's version is 0.x, no pending changeset may declare `major` for it. Under
 *      semver a breaking change before 1.0 is a minor; `promote-model.mjs` now writes that level itself.
 *   2. A public package at 0.0.0 has never been published, so its highest pending bump must be exactly
 *      `minor`: `patch` would publish 0.0.1, nothing pending would publish nothing, `major` 1.0.0.
 *
 * The frontmatter is read here rather than through `@changesets/parse`, which `packages/lab` does not
 * declare. The reader refuses a line it cannot parse instead of skipping it, because a skipped `major`
 * line is exactly the failure this guards. It was cross-checked against `changeset status --verbose` on
 * the #1396 tree: 7 pending, all `minor`, all six at 0.1.0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

type Bump = "major" | "minor" | "patch" | "none";
type Release = { name: string; type: Bump };
type Changeset = { file: string; releases: Release[] };

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/** The `"name": level` lines between a changeset's opening pair of `---`, refusing any line it cannot read. */
function frontmatterReleases(file: string, text: string): Release[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter block -- refusing to guess what it releases`);
  const releases: Release[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const release = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch|none)\s*$/.exec(line);
    if (!release) throw new Error(`${file}: unreadable frontmatter line ${JSON.stringify(line)} -- refusing to skip it`);
    releases.push({ name: release[1], type: release[2] as Bump });
  }
  return releases;
}

function pendingChangesets(repo: string = REPO): Changeset[] {
  const dir = join(repo, ".changeset");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => ({ file: name, releases: frontmatterReleases(name, readFileSync(join(dir, name), "utf8")) }));
}

function publicVersions(repo: string = REPO): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const dir of readdirSync(join(repo, "packages"))) {
    const manifest = join(repo, "packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version, private: isPrivate } = JSON.parse(readFileSync(manifest, "utf8"));
    if (!isPrivate) versions[name] = version;
  }
  return versions;
}

/** Every breach of the two rules, as a sentence naming the file, the package and the version. */
function zeroMajorViolations({ changesets, versions }: { changesets: Changeset[]; versions: Record<string, string> }) {
  const problems: string[] = [];
  const highest: Record<string, Bump> = {};
  for (const { file, releases } of changesets) {
    for (const { name, type } of releases) {
      if (RANK[type] > RANK[highest[name] ?? "none"]) highest[name] = type;
      const version = versions[name];
      if (type === "major" && version !== undefined && version.startsWith("0.")) {
        problems.push(`${file} declares major for ${name} at ${version} -- under 0.x a breaking change is a minor`);
      }
    }
  }
  for (const [name, version] of Object.entries(versions)) {
    if (version !== "0.0.0") continue;
    const bump = highest[name] ?? "none";
    if (bump !== "minor") {
      problems.push(`${name} is unpublished (0.0.0) and its highest pending bump is ${bump}, so its first publish `
        + "would not be 0.1.0");
    }
  }
  return problems;
}

const SIX = ["@a11ign/evidence", "@a11ign/judge", "@a11ign/nvda-worker", "@a11ign/scorer", "@a11ign/worker-fleet", "a11ign"];

test("#1396 THE LIVE TREE: no pending major on a 0.x package, and every unpublished package's first release is a minor", () => {
  const changesets = pendingChangesets();
  const versions = publicVersions();
  // THE POPULATION FIRST, so the empty list below cannot pass having read nothing: a WRITTEN list of the six
  // public packages (a seventh, or one gone private, is a decision about the first publish), and at least
  // one pending release line actually read from `.changeset/`.
  assert.deepEqual(Object.keys(versions).sort(), [...SIX].sort());
  assert.ok(changesets.flatMap((c) => c.releases).length > 0,
    "no pending release line was read -- the empty list below would be a claim about nothing");
  assert.deepEqual(zeroMajorViolations({ changesets, versions }), []);
});

test("#1396 POSITIVE CONTROL: a major planted beside a 0.x version is refused, and the same major beside 1.x is not", () => {
  const planted = [{ file: "planted.md", releases: [{ name: "@a11ign/scorer", type: "major" as const }] }];
  const refused = zeroMajorViolations({ changesets: planted, versions: { "@a11ign/scorer": "0.1.0" } });
  assert.equal(refused.length, 1);
  assert.match(refused[0], /planted\.md declares major for @a11ign\/scorer at 0\.1\.0/);
  assert.deepEqual(zeroMajorViolations({ changesets: planted, versions: { "@a11ign/scorer": "1.2.0" } }), []);
});

test("#1396 an unpublished package whose highest pending bump is patch, major or nothing does not publish as 0.1.0", () => {
  const at = (type: Bump | null) => zeroMajorViolations({
    changesets: type ? [{ file: "c.md", releases: [{ name: "a11ign", type }] }] : [],
    versions: { a11ign: "0.0.0" },
  });
  assert.deepEqual(at("minor"), [], "the control: a minor over 0.0.0 is exactly 0.1.0");
  assert.match(at("patch").join("\n"), /highest pending bump is patch/);
  assert.match(at(null).join("\n"), /highest pending bump is none/);
  assert.equal(at("major").length, 2, "a major over 0.0.0 breaks both rules, and both are named");
  const mixed = zeroMajorViolations({
    changesets: [{ file: "p.md", releases: [{ name: "a11ign", type: "patch" }] },
      { file: "m.md", releases: [{ name: "a11ign", type: "minor" }] }],
    versions: { a11ign: "0.0.0" },
  });
  assert.deepEqual(mixed, [], "the HIGHEST pending bump decides, as changesets does");
});

test("#1396 the frontmatter reader refuses a line it cannot read, and reads an empty block as no releases", () => {
  assert.deepEqual(frontmatterReleases("empty.md", "---\n---\n\nA note that releases nothing.\n"), []);
  assert.deepEqual(frontmatterReleases("two.md", '---\n"a11ign": minor\n\'@a11ign/judge\': patch\n---\nbody\n'),
    [{ name: "a11ign", type: "minor" }, { name: "@a11ign/judge", type: "patch" }]);
  assert.throws(() => frontmatterReleases("typo.md", '---\n"a11ign": majr\n---\n'), /unreadable frontmatter line/,
    "a misspelled level skipped here is a major nobody checked");
  assert.throws(() => frontmatterReleases("none.md", "no frontmatter\n"), /has no frontmatter block/);
});
