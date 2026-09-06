/**
 * THIS REPOSITORY'S OWN NAME IS WRITTEN OUT BY HAND IN ~30 PLACES ACROSS ~25 FILES — issue #92, #63's third
 * silent breakage. GitHub redirects the old URL after an org move, so every one of these keeps WORKING
 * while pointing at a name we no longer own, and the gap is found weeks later by someone wondering why a
 * link is dead or a deploy pulled nothing.
 *
 * `scripts/repo-identity.mjs` is the one declared value now. `board-data.mjs` and `row-claim.mjs` import it
 * at runtime and are no longer literals — this file is about the ones that CANNOT import anything:
 * `package.json` `repository` fields, workflow strings, Ansible defaults, and prose. Each is asserted
 * against `REPO`/`REPO_URL`/`REPO_GIT_URL` here, so a rename is one edit to `repo-identity.mjs` plus a
 * single failing test listing every site that still disagrees — never a silent partial rename found later.
 *
 * WHY A FLAT LIST RATHER THAN A REPO-WIDE REGEX SWEEP. A sweep would need to tell a genuine reference to
 * THIS repository apart from an unrelated `owner/repo`-shaped string (a different project entirely, an
 * example in prose) — the same false-positive risk this project's own leak sweeps have hit repeatedly. A
 * named list is exactly what `backlog-file-facts.test.ts` and `documented-criteria.test.ts` already do for
 * the identical reason: each site is a deliberate claim about ONE place, not a pattern guessed to cover all
 * of them, so a new reference someone adds is invisible here until it is added to this list on purpose —
 * the same trade this repo makes everywhere it already prefers a named check over a blanket one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO, REPO_URL, REPO_GIT_URL } from "../../../../scripts/repo-identity.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/**
 * Every literal site the 2026-09-06 audit found, one entry per DISTINCT textual form in that file — some
 * files carry the repo's name in more than one shape (README.md has both a badge URL and an Action
 * `uses:` line) and each shape gets its own entry rather than one loosely-matching pattern per file.
 */
const SITES: Array<{ file: string; expect: string }> = [
  { file: "README.md", expect: `${REPO_URL}/actions/workflows/lint.yml/badge.svg` },
  { file: "README.md", expect: `${REPO_URL}/actions/workflows/capture-regression.yml/badge.svg` },
  { file: "README.md", expect: `uses: ${REPO}@main` },
  { file: "SECURITY.md", expect: `${REPO_URL}/security/advisories/new` },
  { file: "docs/control-plane-proxmox.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-control-plane.sh" },
  { file: "docs/backlog-ready.md", expect: `${REPO_URL}/issues` },
  { file: "docs/try-it.md", expect: `uses: ${REPO}@main` },
  { file: "docs/getting-started.md", expect: `git clone ${REPO_GIT_URL}` },
  { file: "docs/getting-started.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-windows-worker.ps1" },
  { file: "docs/github-action.md", expect: `uses: ${REPO}@main` },
  { file: "docs/github-action.md", expect: `uses: ${REPO}@<sha>` },
  { file: "docs/backlog.md", expect: `${REPO_URL}/issues` },
  { file: "docs/nvda-worker-runbook.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-windows-worker.ps1" },
  { file: "docs/board/README.md", expect: `--repo ${REPO}` },
  { file: "docs/board/reported.json", expect: `on ${REPO}` },
  { file: "docs/roles/memory/github-is-the-tracker.md", expect: `GitHub Issues on ${REPO}` },
  { file: "docs/roles/README.md", expect: `\`${REPO}\`` },
  { file: "docs/roles/memory/org-shape-second-orchestrator.md", expect: `a Project on ${REPO}` },
  { file: "examples/workflow.yml", expect: `uses: ${REPO}@main` },
  { file: "packages/nvda-worker/package.json", expect: REPO_GIT_URL },
  { file: "packages/nvda-worker/src/README.md", expect: `git clone ${REPO_GIT_URL}` },
  { file: "packages/worker-fleet/package.json", expect: REPO_GIT_URL },
  { file: "packages/evidence/README.md", expect: `(${REPO_URL})` },
  { file: "packages/evidence/package.json", expect: REPO_GIT_URL },
  { file: "packages/cli/package.json", expect: REPO_GIT_URL },
  { file: "packages/cli/README.md", expect: `uses: ${REPO}@main` },
  { file: "packages/scorer/package.json", expect: REPO_GIT_URL },
  { file: "packages/judge/package.json", expect: REPO_GIT_URL },
  { file: "packages/control/ansible/roles/worker/defaults/main.yml",
    expect: `worker_repo_url: ${REPO_GIT_URL}` },
  { file: "packages/control/ansible/collections/ansible_collections/a11y/worker/galaxy.yml",
    expect: `repository: ${REPO_URL}` },
  { file: ".github/ISSUE_TEMPLATE/config.yml", expect: `${REPO_URL}/security/advisories/new` },
  { file: ".github/ISSUE_TEMPLATE/config.yml", expect: `${REPO_URL}/blob/main/README.md#licence` },
];

test("every literal site still names this repository, agreeing with repo-identity.mjs", () => {
  const bad: string[] = [];
  const cache = new Map<string, string>();
  for (const { file, expect } of SITES) {
    let text = cache.get(file);
    if (text === undefined) {
      text = readFileSync(path.join(ROOT, file), "utf8");
      cache.set(file, text);
    }
    if (!text.includes(expect)) bad.push(`${file}: does not contain "${expect}"`);
  }
  assert.deepEqual(bad, [],
    `these sites disagree with repo-identity.mjs's REPO ("${REPO}") -- either they were not updated when `
    + "the name last changed, or this list itself has drifted from what the files actually say:\n"
    + bad.join("\n"));
});

test("the vacuity guard: this list is not empty and each file it names exists", () => {
  assert.ok(SITES.length >= 30, `only ${SITES.length} sites declared -- the 2026-09-06 audit found ~30; `
    + "a shrunk list examining less than the audit found would pass by looking at fewer things, not by "
    + "the repository needing fewer references fixed");
  const files = [...new Set(SITES.map((s) => s.file))];
  for (const file of files) {
    assert.doesNotThrow(() => readFileSync(path.join(ROOT, file), "utf8"),
      `${file} is named in SITES but does not exist -- a renamed or deleted file leaves a stale entry `
      + "that can never fail honestly");
  }
});

test("board-data.mjs and row-claim.mjs DERIVE the name rather than restating it as a literal", () => {
  // The two runtime consumers this repo already had. Checked by IMPORT rather than by literal, because
  // that is the whole point of the split: these two no longer carry a copy for repo-identity-drift to
  // catch, and a test asserting a literal here would be re-introducing the duplicate this row removes.
  for (const file of ["scripts/board-data.mjs", "scripts/row-claim.mjs"]) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, /from ["']\.\/repo-identity\.mjs["']/,
      `${file} must import REPO from repo-identity.mjs rather than declaring its own copy`);
    assert.ok(!new RegExp(`["']${REPO.replace(/[/.]/g, "\\$&")}["']`).test(text),
      `${file} still declares the repository name as its own string literal`);
  }
});
