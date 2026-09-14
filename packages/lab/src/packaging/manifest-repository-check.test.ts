/**
 * #1536: A PUBLISHED MANIFEST THAT NAMES ANOTHER REPOSITORY IS REFUSED BY US, BEFORE `changeset publish`, ON THE DRY
 * RUN TOO.
 *
 * Run 34816466408 passed every guard and every gate and was refused by npm on PUT: provenance binds a tarball to the
 * repository whose workflow built it, and all six manifests named `a11ign/a11ign` while the run came from this
 * repository (#915 5660524401). A dry run never reaches the registry, so nothing had asked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  manifestRepositoryMismatches, publishedManifests, repositorySlugOf,
} from "../../../../scripts/manifest-repository-check.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = readFileSync(resolve(REPO, ".github/workflows/release.yml"), "utf8");

// BUILT, NEVER SPELLED: a transfer rewrites repository-identity literals (#325), and this one is a record of where
// run 34816466408 came from, which must not move with it.
const INCIDENT_RUN_REPOSITORY = ["DanBeckDev", "a11y-witness"].join("/");
const OTHER = "fixture-owner/fixture-repo";

const manifest = (repository: unknown, name = "@fixture/pkg") =>
  ({ path: `packages/${name.split("/").pop()}/package.json`, name, repository });

test("#1536 repositorySlugOf: both spellings npm writes read as the same owner/name; anything else is null", () => {
  assert.equal(repositorySlugOf(`git+https://github.com/${OTHER}.git`), OTHER);
  assert.equal(repositorySlugOf(`https://github.com/${OTHER}`), OTHER);
  assert.equal(repositorySlugOf(`https://github.com/${OTHER}/`), OTHER);
  assert.equal(repositorySlugOf("https://github.com/Fixture-Owner/Fixture-Repo.git"), OTHER, "case-insensitive, as GitHub is");
  assert.equal(repositorySlugOf("github:fixture-owner/fixture-repo"), null, "a shorthand is not a URL the provenance check reads");
  assert.equal(repositorySlugOf("https://gitlab.com/fixture-owner/fixture-repo"), null);
});

test("#1536 POSITIVE CONTROL: a manifest naming another repository is refused, and the refusal names it", () => {
  const mismatches = manifestRepositoryMismatches({
    manifests: [manifest({ type: "git", url: `git+https://github.com/${OTHER}.git` })], repository: INCIDENT_RUN_REPOSITORY,
  });
  assert.deepEqual(mismatches, [{
    path: "packages/pkg/package.json", name: "@fixture/pkg",
    found: `git+https://github.com/${OTHER}.git`, expected: `https://github.com/${INCIDENT_RUN_REPOSITORY}`,
  }]);
});

test("#1536 NEGATIVE CONTROL: a manifest naming the running repository passes, in both spellings and either shape", () => {
  for (const repository of [
    { type: "git", url: `git+https://github.com/${OTHER}.git` }, { url: `https://github.com/${OTHER}` },
    `git+https://github.com/${OTHER}.git`, `https://github.com/${OTHER}`,
  ]) {
    assert.deepEqual(manifestRepositoryMismatches({ manifests: [manifest(repository)], repository: OTHER }), [],
      `refused a manifest that names the running repository: ${JSON.stringify(repository)}`);
  }
});

test("#1536: a manifest with no repository URL is refused, never passed for having nothing to compare", () => {
  for (const repository of [undefined, {}, { type: "git" }, true]) {
    const [mismatch] = manifestRepositoryMismatches({ manifests: [manifest(repository)], repository: OTHER });
    assert.equal(mismatch?.found, "(no repository.url)", `passed: ${JSON.stringify(repository)}`);
  }
});

test("#1536 THE INCIDENT, on the real manifests: from run 34816466408's repository all six are refused; from the repository they name, none is", () => {
  const manifests = publishedManifests(REPO);
  assert.deepEqual(manifests.map((m) => m.name),
    ["a11ign", "@a11ign/evidence", "@a11ign/judge", "@a11ign/nvda-worker", "@a11ign/scorer", "@a11ign/worker-fleet"],
    "the six packages Changesets publishes -- lab, control and nvda-speech are private");
  const fromIncident = manifestRepositoryMismatches({ manifests, repository: INCIDENT_RUN_REPOSITORY });
  assert.equal(fromIncident.length, manifests.length, "run 34816466408's shape: every manifest names a different repository");
  const named = new Set(manifests.map((m) => repositorySlugOf(String((m.repository as { url?: string } | undefined)?.url ?? ""))));
  assert.equal(named.size, 1, `the six manifests should name one repository between them: ${[...named].join(", ")}`);
  const [theirs] = [...named];
  assert.ok(theirs, "the manifests' repository URL could not be read");
  assert.deepEqual(manifestRepositoryMismatches({ manifests, repository: theirs }), [],
    "publishing from the repository the manifests name is not refused");
});

test("#1536 THE WORKFLOW CALLS IT: release.yml runs the check with no `if:`, so on the dry run too, before the guard and before `changeset publish`", () => {
  const step = WORKFLOW.indexOf("run: node scripts/manifest-repository-check.mjs");
  assert.notEqual(step, -1, "release.yml does not run scripts/manifest-repository-check.mjs");
  const stepStart = WORKFLOW.lastIndexOf("- name:", step);
  assert.doesNotMatch(WORKFLOW.slice(stepStart, step), /\n\s+if:/,
    "the check carries an `if:`, so some path -- the dry run -- can skip it");
  const refuse = WORKFLOW.indexOf("- name: Refuse to publish unless");
  const publish = WORKFLOW.indexOf("run: npx changeset publish");
  assert.ok(refuse !== -1 && publish !== -1, "release.yml's guard or publish step moved; re-read this test");
  assert.ok(step < refuse && step < publish,
    "the manifest check must run before the guard step and before `changeset publish`, or the registry answers first");
});
