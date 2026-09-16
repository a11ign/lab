/**
 * `scripts/history-secret-scan.mjs` -- #310, preparation for #63's org transfer and the repository going
 * public. `scanBlob` is pure and driven directly; `scanHistory` (the real git-backed path) is driven
 * against a disposable, throwaway repository this test builds and deletes, never against this checkout's
 * own history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanBlob, KEY_FILENAME_RE, TEMPLATE_SUFFIX_RE, scanHistory } from "../../../../scripts/history-secret-scan.mjs";
import { nonStandardRefs } from "../../../../scripts/history-purge-rehearsal.mjs";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

test("scanBlob: an internal address is found and counted", () => {
  const findings = scanBlob("worker at REDACTED-INTERNAL-ADDRESS and also REDACTED-INTERNAL-ADDRESS", "inventory.yml");
  const internal = findings.find((f) => f.pattern === "internalAddress");
  assert.ok(internal, "must find the internalAddress pattern");
  assert.equal(internal?.count, 2, "must count BOTH occurrences, not just report presence");
});

test("scanBlob: a 10.x and a 172.16-31.x address both count as internal, a 172.32.x one does not", () => {
  assert.equal(scanBlob("REDACTED-INTERNAL-ADDRESS and REDACTED-INTERNAL-ADDRESS", "x").find((f) => f.pattern === "internalAddress")?.count, 2);
  assert.equal(scanBlob("172.32.0.1 is public-range, not RFC 1918", "x")
    .find((f) => f.pattern === "internalAddress"), undefined);
});

test("scanBlob: a PEM private key block is found", () => {
  const findings = scanBlob("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", "x");
  assert.ok(findings.some((f) => f.pattern === "privateKeyBlock"));
});

test("scanBlob: a GitHub token, an npm token, an AWS key and a Slack token are each found", () => {
  const gh = scanBlob("token: ghp_" + "a".repeat(36), "x");
  assert.ok(gh.some((f) => f.pattern === "githubToken"));
  const npm = scanBlob("token: npm_" + "b".repeat(36), "x");
  assert.ok(npm.some((f) => f.pattern === "npmToken"));
  const aws = scanBlob("AKIA" + "B".repeat(16), "x");
  assert.ok(aws.some((f) => f.pattern === "awsAccessKey"));
  const slack = scanBlob("xoxb-" + "1".repeat(20), "x");
  assert.ok(slack.some((f) => f.pattern === "slackToken"));
});

test("scanBlob: ordinary prose with none of the shapes above finds nothing", () => {
  assert.deepEqual(scanBlob("This is a normal file with no secrets or addresses in it.", "README.md"), []);
});

test("KEY_FILENAME_RE: private-key-shaped filenames match regardless of directory depth", () => {
  for (const path of ["id_rsa", "keys/id_ed25519", "a/b/c/a11y-pve", "a11y_ssh_ed25519",
    "packages/control/.npmrc", "deploy.pem", "config/.env.production"]) {
    assert.ok(KEY_FILENAME_RE.test(path), `expected ${path} to match as a key-shaped filename`);
  }
});

test("KEY_FILENAME_RE: an ordinary source file does not match", () => {
  for (const path of ["scripts/board-report.mjs", "packages/lab/src/packaging/board-style.test.ts", "README.md"]) {
    assert.ok(!KEY_FILENAME_RE.test(path), `expected ${path} NOT to match`);
  }
});

/**
 * `.env.example` was this repository's own real, historical false positive: an early, since-removed file
 * whose content was `ANTHROPIC_API_KEY=` with nothing after it -- a template, never a real credential.
 * `scanBlob` combines `KEY_FILENAME_RE` with `TEMPLATE_SUFFIX_RE` so a conventional template suffix
 * excludes it, WITHOUT weakening the filename check for the file it templates -- `.env` alone still
 * matches.
 */
test("scanBlob: a conventional template suffix (.example, .sample, .template, .dist) is never a keyFilename finding", () => {
  for (const path of [".env.example", "id_rsa.sample", "a11y-pve.template", ".npmrc.dist"]) {
    assert.ok(TEMPLATE_SUFFIX_RE.test(path), `expected ${path} to be recognised as a template suffix`);
    assert.deepEqual(scanBlob("ANTHROPIC_API_KEY=", path).filter((f) => f.pattern === "keyFilename"), []);
  }
});

test("scanBlob: the file the template is FOR still matches -- the suffix exclusion is not a blanket one", () => {
  assert.ok(scanBlob("", ".env").some((f) => f.pattern === "keyFilename"));
  assert.ok(scanBlob("", "id_rsa").some((f) => f.pattern === "keyFilename"));
});

/**
 * THE CLAIM THIS ROW EXISTS TO PROVE: a file fixed in a later commit still has its OLD content in every
 * commit before the fix, so a scan of the current tree alone understates history. Built as a real,
 * disposable repository -- two commits, a secret in the first, removed in the second -- so this is
 * verified against real git plumbing rather than assumed from the design.
 */
function disposableRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "history-scan-fixture-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(dir, "inventory.yml"), "worker: REDACTED-INTERNAL-ADDRESS\n");
  git("add", "inventory.yml");
  git("commit", "-q", "-m", "add worker inventory with a real address");
  writeFileSync(join(dir, "inventory.yml"), "worker: ${WORKER_HOST}\n");
  git("add", "inventory.yml");
  git("commit", "-q", "-m", "parameterise the worker address -- fixed on the current tree");
  return dir;
}

test("scanHistory: finds a secret that exists ONLY in a past commit, absent from HEAD", async () => {
  const dir = disposableRepo();
  try {
    const headContent = execFileSync("git", ["show", "HEAD:inventory.yml"],
      { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
    assert.doesNotMatch(headContent, /192\.168/,
      "the fixture's own premise: HEAD must NOT carry the address, or this test proves nothing");

    const findings = await scanHistory(dir);
    const internal = findings.find((f) => f.pattern === "internalAddress" && f.path === "inventory.yml");
    assert.ok(internal, "the address from the FIRST commit must still be found in history, even though "
      + "the current tree (HEAD) no longer carries it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanHistory: a clean fixture with no secrets ever committed reports zero", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "history-scan-clean-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  try {
    git("init", "--quiet", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(dir, "README.md"), "Nothing sensitive here.\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "clean");
    const findings = await scanHistory(dir);
    assert.deepEqual(findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * #310, THE ROOT CAUSE FOUND WHILE VERIFYING THE REWRITE: `git filter-repo` (both `--replace-text` and a
 * custom `--blob-callback`, both tried against the real history) left 246 of 2,268 matches untouched,
 * reproducibly, unchanged by a second pass -- because one ref, `refs/codex/turn-diffs/checkpoints/...`,
 * points directly at a TREE rather than a commit, and filter-repo skips it outright ("Unexpected object
 * of type tree, skipping"). `nonStandardRefs` is the fix: delete every ref outside
 * `refs/heads`/`refs/remotes`/`refs/tags` before rewriting, which closed the gap to zero when verified
 * against this repository's own history.
 */
test("nonStandardRefs: finds a ref pointing at a bare tree, which a normal commit-walk cannot see", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nonstandard-ref-fixture-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  try {
    git("init", "--quiet", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(dir, "file.txt"), "content\n");
    git("add", "file.txt");
    git("commit", "-q", "-m", "base");
    // A ref pointing directly at a TREE, not a commit -- the exact shape that defeated the real rewrite.
    const treeSha = git("rev-parse", "HEAD^{tree}").trim();
    git("update-ref", "refs/codex/turn-diffs/checkpoints/example", treeSha);

    const refs = nonStandardRefs(dir);
    assert.deepEqual(refs, ["refs/codex/turn-diffs/checkpoints/example"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nonStandardRefs: an ordinary repository with only heads/remotes/tags reports none", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "standard-refs-fixture-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  try {
    git("init", "--quiet", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(dir, "file.txt"), "content\n");
    git("add", "file.txt");
    git("commit", "-q", "-m", "base");
    git("tag", "v1");
    assert.deepEqual(nonStandardRefs(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
