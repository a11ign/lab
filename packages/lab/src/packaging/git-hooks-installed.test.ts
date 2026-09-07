/**
 * THE HOOKS MUST BE INSTALLED BY SOMETHING, not set by hand in one person's checkout.
 *
 * `core.hooksPath` pointed at `scripts/git-hooks` in exactly one `.git/config` and nothing put it there —
 * no `prepare`, no `postinstall`, no line in CONTRIBUTING. A fresh clone had the hook FILES and none of
 * them running. Found 2026-09-05 by an external architecture audit, under its heading "gates that exist
 * and run nowhere automated".
 *
 * It matters more here than it would in most repos. The pre-push hook is where the cheap verification tier
 * lives — lint, typecheck, unit tests, `check-signals`, `rules:gate`, ~5 s — and the pre-commit hook is
 * what stops a commit in a SHARED checkout sweeping up another agent's half-finished work, after one such
 * commit took 19 files of which 16 were somebody else's. For anyone who had not configured it manually,
 * both were decorative, and this repo's own rule is that anything relying on a human to remember does not
 * happen.
 *
 * These are unit tests over an injected `run`, not a check of THIS checkout's git config: asserting the
 * local config would pass on the one machine where the defect could not be observed, which is the whole
 * shape of the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { installHooks, HOOKS_PATH } from "../../../../scripts/install-git-hooks.mjs";

const ROOT = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8"));

type Call = { args: string[] };
function recorder({ get = HOOKS_PATH, throwOnGet = false }: { get?: string; throwOnGet?: boolean } = {}) {
  const calls: Call[] = [];
  const run = (_cmd: string, args: string[]) => {
    calls.push({ args });
    if (args[0] === "config" && args[1] === "--get") {
      // git exits non-zero when the key is UNSET, which is the normal first-run case rather than a fault.
      if (throwOnGet) throw new Error("exit 1");
      return get;
    }
    return "";
  };
  return { calls, run };
}

test("`npm install` installs the hooks — the lifecycle script exists and names the installer", () => {
  // The load-bearing assertion. Everything below tests the installer's behaviour; this tests that anything
  // CALLS it, which is the half that was missing.
  assert.equal(ROOT.scripts?.prepare, "node scripts/install-git-hooks.mjs",
    "a fresh clone gets hooks only if `prepare` runs the installer — `prepare` fires on `npm install` in a "
    + "git checkout and never for a consumer installing a published package");
  assert.equal(ROOT.private, true,
    "prepare must not be able to reach a consumer's repository; the root manifest being private is why");
});

test("an unset hooksPath is CONFIGURED, and git exiting 1 on --get is not treated as a failure", () => {
  const { calls, run } = recorder({ throwOnGet: true });
  const messages: string[] = [];
  assert.equal(installHooks({ run, exists: () => true, log: (m: string) => messages.push(m) }), true);
  assert.ok(calls.some((c) => c.args.join(" ") === `config core.hooksPath ${HOOKS_PATH}`),
    "it must write the config when the key is unset");
  assert.match(messages.join("\n"), /hooks installed/);
});

test("an ALREADY-CORRECT checkout is left alone and says nothing — `npm install` must stay quiet", () => {
  const { calls, run } = recorder({ get: HOOKS_PATH });
  const messages: string[] = [];
  assert.equal(installHooks({ run, exists: () => true, log: (m: string) => messages.push(m) }), true);
  assert.equal(calls.filter((c) => c.args[1] === "core.hooksPath").length, 0,
    "no write when it is already right: an installer that rewrites config on every install is noise, and "
    + "noise in `npm install` output is how a real warning gets scrolled past");
  assert.deepEqual(messages, []);
});

test("a DIFFERENT hooksPath is replaced, and the old value is named", () => {
  const { run } = recorder({ get: ".husky" });
  const messages: string[] = [];
  installHooks({ run, exists: () => true, log: (m: string) => messages.push(m) });
  assert.match(messages.join("\n"), /was \.husky/,
    "silently overwriting somebody's configuration is how a tool loses trust; say what it changed");
});

test("NO GIT, NO .git, NO HOOKS DIRECTORY — reported, never fatal, and never silent", () => {
  // A tarball has no `.git`, CI may check out without one, git may not be on PATH. None is a reason to
  // break `npm install` — and a silent failure here is indistinguishable from a silent success, which is
  // exactly the defect this file exists to fix.
  const missing: string[] = [];
  assert.equal(installHooks({ exists: () => false, log: (m: string) => missing.push(m) }), false);
  assert.match(missing.join("\n"), /NOT installed/);

  const broken: string[] = [];
  const throwing = () => { throw new Error("git: command not found"); };
  assert.equal(installHooks({ run: throwing, exists: () => true, log: (m: string) => broken.push(m) }), false);
  assert.match(broken.join("\n"), /NOT installed/);
  assert.match(broken.join("\n"), /git config core\.hooksPath/,
    "when it cannot install them it must print the command that does, or the reader is stuck");
});

test("the path is RELATIVE, so it survives a git worktree", () => {
  // Peer agents work in `git worktree`s, where `.git` is a FILE pointing elsewhere. An absolute hooksPath
  // baked from one checkout would silently disable the hooks in every worktree — which is precisely where
  // the shared-checkout commit guard matters most.
  assert.equal(HOOKS_PATH, "scripts/git-hooks");
  assert.ok(!HOOKS_PATH.startsWith("/"), "an absolute path would not resolve inside a worktree");
});
