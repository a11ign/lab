/**
 * #1995: nothing refused a COMMITTED symlink whose target is a path on one machine.
 *
 * `.gitignore` governs what is UNTRACKED, so it cannot help with a symlink it has no reason to name, and
 * `git add -f` beats it outright (#1983). The #1973 incident committed exactly this object: a consumer
 * cloning the repository gets a dangling link into somebody else's home directory. The census that
 * prompted this row found five self-referential ones in the primary checkout (`packages/lab/lab ->
 * /home/agent/repos/a11y-witness/packages/lab`) — untracked, so out of this guard's population, but the
 * shape a stray `ln -s <abs> <rel>` run from the wrong directory makes.
 *
 * The question "does this repository track a symlink that points outside itself" is answerable from the
 * INDEX alone: `git ls-files -s` reports mode `120000` and the blob IS the target string. No host state,
 * so it runs the same in CI as here.
 *
 * ## Where the positive control lives
 *
 * Over the real index the population is EMPTY today (measured 2026-09-24: `git ls-files -s | awk
 * '$1=="120000"'` returns 0 rows), so `assert.deepEqual(offenders, [])` there passes whatever the
 * function does. The controls are the sandbox tests below, which drive the SAME function over a
 * repository with an offender committed into it, and a green control beside them so the refusal is not
 * a guard that refuses every symlink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { sandboxGitEnv, withGitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const SYMLINK_MODE = "120000";

interface TrackedSymlink {
  path: string;
  target: string;
}

interface Offender extends TrackedSymlink {
  reason: "absolute" | "escapes-repo";
}

type Git = (args: string[]) => string;

/** Every mode-120000 entry of the index with its target, which is the blob's whole content. */
function trackedSymlinks(git: Git): TrackedSymlink[] {
  // `-z`: a path with a space or a newline in it must not re-split, and a quoted path is not the path.
  const entries = git(["ls-files", "-s", "-z"]).split("\0").filter(Boolean);
  return entries.flatMap((entry) => {
    const [meta, path] = entry.split("\t");
    const [mode, sha] = meta.split(" ");
    return mode === SYMLINK_MODE ? [{ path, target: git(["cat-file", "blob", sha]) }] : [];
  });
}

/** POSIX `/x`, a Windows drive `C:\x` or `C:/x`, and a UNC `\\host\x` are all one machine's spelling. */
function isAbsoluteTarget(target: string): boolean {
  return target.startsWith("/") || target.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(target);
}

/** A relative target resolves against the LINK's directory, so `../x` is fine deep in the tree and not at the root. */
function escapesRepo({ path, target }: TrackedSymlink): boolean {
  const resolved = posix.normalize(posix.join(posix.dirname(path), target));
  return resolved === ".." || resolved.startsWith("../");
}

function offendersIn(git: Git): Offender[] {
  return trackedSymlinks(git).flatMap((link): Offender[] => {
    if (isAbsoluteTarget(link.target)) return [{ ...link, reason: "absolute" }];
    return escapesRepo(link) ? [{ ...link, reason: "escapes-repo" }] : [];
  });
}

const sandboxGit = (sandbox: GitSandbox): Git => (args) => sandbox.run(args);

/** The real repository, with GIT_* scrubbed so a hook's exported GIT_DIR cannot point this anywhere else. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const realGit: Git = (args) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv() });

/** Commits `path -> target` into the sandbox, creating the link's directory first. */
function commitSymlink(sandbox: GitSandbox, path: string, target: string, addArgs: string[] = []): void {
  mkdirSync(join(sandbox.dir, posix.dirname(path)), { recursive: true });
  symlinkSync(target, join(sandbox.dir, path));
  sandbox.run(["add", ...addArgs, path]);
  sandbox.commit("link");
}

test("the repository tracks no symlink that is absolute or leaves the repository", () => {
  const offenders = offendersIn(realGit);
  assert.deepEqual(
    offenders,
    [],
    "a tracked symlink must point somewhere every clone has: " +
      offenders.map((o) => `${o.path} -> ${o.target} (${o.reason})`).join(", "),
  );
});

test("CONTROL: a committed symlink to an absolute path is reported, with its target", () => {
  const offenders = withGitSandbox((sandbox) => {
    commitSymlink(sandbox, "packages/lab/lab", "/home/agent/repos/a11y-witness/packages/lab");
    return offendersIn(sandboxGit(sandbox));
  });
  assert.deepEqual(offenders, [
    { path: "packages/lab/lab", target: "/home/agent/repos/a11y-witness/packages/lab", reason: "absolute" },
  ]);
});

test("CONTROL: `git add -f` past a .gitignore that names the link does not hide it", () => {
  // #1983's own boundary: the ignore file stops `git add -A`, and `-f` beats it. The index is the truth.
  const offenders = withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, ".gitignore"), "ignored-link\n");
    commitSymlink(sandbox, "ignored-link", "/etc/hosts", ["-f"]);
    return offendersIn(sandboxGit(sandbox));
  });
  assert.deepEqual(offenders.map((o) => o.path), ["ignored-link"]);
});

test("CONTROL: a relative symlink that climbs out of the repository is reported", () => {
  const offenders = withGitSandbox((sandbox) => {
    commitSymlink(sandbox, "docs/out", "../../elsewhere");
    commitSymlink(sandbox, "top", "..");
    return offendersIn(sandboxGit(sandbox));
  });
  assert.deepEqual(offenders.map((o) => [o.path, o.reason]), [
    ["docs/out", "escapes-repo"],
    ["top", "escapes-repo"],
  ]);
});

test("CONTROL: Windows drive and UNC spellings are absolute too", () => {
  assert.equal(isAbsoluteTarget("C:\\Users\\dan\\repo"), true);
  assert.equal(isAbsoluteTarget("d:/repo"), true);
  assert.equal(isAbsoluteTarget("\\\\host\\share"), true);
});

test("GREEN: relative symlinks that stay inside the repository are not reported", () => {
  // Without this every assertion above is satisfied by a guard that refuses every symlink, which is the
  // failure mode that gets a guard deleted rather than fixed. `../shared` is one level down from the
  // root, so it resolves INSIDE; the same spelling at the root would escape, and the case above says so.
  const offenders = withGitSandbox((sandbox) => {
    commitSymlink(sandbox, "docs/shared-link", "../shared");
    commitSymlink(sandbox, "docs/sibling", "shared-link");
    commitSymlink(sandbox, "link-at-root", "docs");
    return offendersIn(sandboxGit(sandbox));
  });
  assert.deepEqual(offenders, []);
});

test("GREEN: a repository with no symlink reports none, and a regular file is not read as one", () => {
  const offenders = withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "plain.txt"), "/an/absolute/path/in/a/regular/file\n");
    sandbox.run(["add", "plain.txt"]);
    sandbox.commit("plain");
    return offendersIn(sandboxGit(sandbox));
  });
  assert.deepEqual(offenders, []);
});
