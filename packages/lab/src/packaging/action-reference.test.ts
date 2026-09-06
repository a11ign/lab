/**
 * Every documented `uses:` line must name a repository that exists and a ref that resolves.
 *
 * This is the first line a stranger copies, and it was wrong for as long as it has existed:
 * `docs/github-action.md` and `examples/workflow.yml` both said
 * `uses: a11y-witness/a11y-witness@v1` — the wrong owner AND a tag that has never been cut, so a consumer
 * got `Unable to resolve action` before anything ran. `README.md` said `DanBeckDev/a11y-witness@main`, so
 * the three documents disagreed with each other and two of them with reality.
 *
 * `action-smoke.yml` could not catch it. It runs `uses: ./`, which is the right thing for testing the
 * action's STEPS and structurally incapable of testing the reference a consumer writes — the same
 * "verification shares a failure mode with the action" shape recorded throughout this repo.
 *
 * Offline and cheap: it checks the owner/repo against this repository's own name and that the ref is one
 * that actually exists here. It cannot prove GitHub will resolve it, but it catches every fault that has
 * actually occurred.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const DOCS = ["README.md", "docs/github-action.md", "examples/workflow.yml"];
/** This repository, from git rather than from a constant that would be the fourth place to disagree. */
const OWNER_REPO = (() => {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"],
      { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" }).trim();
    return /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
  } catch {
    return null; // no git remote (a packed tarball); the tests below skip honestly rather than fail
  }
})();

const usesLines = (): { file: string; owner: string; ref: string }[] => {
  const found = [];
  for (const file of DOCS) {
    const path = resolve(REPO, file);
    if (!existsSync(path)) continue;
    for (const m of readFileSync(path, "utf8").matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)/g)) {
      if (!/a11y-witness/i.test(m[1])) continue; // third-party actions are not ours to validate
      found.push({ file, owner: m[1], ref: m[2] });
    }
  }
  return found;
};

test("the docs cite this action at all, or this suite is vacuous", () => {
  assert.ok(usesLines().length >= 3, "expected a `uses:` line in each of the three consumer-facing docs");
});

test("every documented `uses:` names THIS repository", () => {
  if (!OWNER_REPO) return;
  const wrong = usesLines().filter((u) => u.owner.toLowerCase() !== OWNER_REPO.toLowerCase())
    .map((u) => `${u.file}: ${u.owner} (this repo is ${OWNER_REPO})`);
  assert.deepEqual(wrong, [],
    "a consumer copying this line gets `Unable to resolve action` before anything runs");
});

test("every documented ref exists — a tag nobody cut resolves for nobody", () => {
  if (!OWNER_REPO) return;
  const refs = new Set<string>();
  try {
    for (const t of execFileSync("git", ["tag"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" }).split("\n")) {
      if (t.trim()) refs.add(t.trim());
    }
    for (const b of execFileSync("git", ["branch", "-r", "--format=%(refname:short)"],
      { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" }).split("\n")) {
      const name = b.trim().replace(/^origin\//, "");
      if (name && name !== "HEAD") refs.add(name);
    }
  } catch {
    return; // no git metadata; see OWNER_REPO
  }
  const missing = usesLines().filter((u) => !refs.has(u.ref))
    .map((u) => `${u.file}: @${u.ref} does not exist (have: ${[...refs].sort().join(", ")})`);
  assert.deepEqual(missing, [],
    "cut the tag in the same change that documents it, or document a ref that resolves today");
});
