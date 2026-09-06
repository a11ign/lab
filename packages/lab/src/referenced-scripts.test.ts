/**
 * Every file this repo tells a tool to read must actually be IN the repo.
 *
 * `scripts/score-screenreader-model.py` — the default judge backend — was never committed. It lived in one
 * working tree and in two unreachable `kanban checkpoint` commits, was not gitignored, and was referenced
 * by `package.json` the whole time. So `npm run eval`, `eval:gate` and the GitHub Action's default
 * `judge-backend: local` all worked here and could not work anywhere else.
 * `scripts/check-screenreader-hardening.py` was missing the same way.
 *
 * ## Why nothing caught it
 *
 * **`npm pack` includes untracked files.** A tarball built on a machine that has the file contains it, so
 * "I installed it and it worked" is not evidence, and neither is any check that begins from this checkout.
 * Only tracked-ness answers the question, which is what this test asserts.
 *
 * It needs no worker, no venv, no network — so it runs in CI, which is the one place that sees a clean
 * checkout and would have failed immediately.
 *
 * ## The second test, and why it exists
 *
 * The same omission recurred one milestone later on a file that is not a program: `tsconfig.base.json`, which
 * carries the `composite: true` that PLAN.md M1 exists to establish, was written and never staged. Every
 * local check passed — `npm test`, `npm run typecheck`, `npm run build`, both new gates — because the file
 * was sitting in the working tree. A clean clone failed with `TS5083: Cannot read file ...tsconfig.base.json`.
 *
 * So this is not a fact about `scripts/`; it is a fact about the difference between a working tree and a
 * repository, and it has now cost this project four times (the scorer, the hardening checker, the resume
 * module, this). The second test generalises the guard to config: any `extends` target of a tracked tsconfig
 * must itself be tracked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { sandboxGitEnv } from "../../../scripts/git-env.mjs";

/**
 * Anything shaped like a program path, wherever it appears in the file.
 *
 * A package's `python` and `bin` directories are in here because M3 moved the scoring program out of
 * `scripts/` and into `@a11y-witness/scorer`. A `scripts/`-only pattern would then have stopped seeing the
 * very file this test was written for — the guard would still pass, having quietly narrowed to nothing. That
 * is the failure mode this suite keeps meeting, so the pattern follows the code.
 */
// The lookbehind is load-bearing. Without it, `scripts/foo.py` matched INSIDE
// `packages/lab/scripts/foo.py`, and this test reported 9 programs "not in the repo" that were all present
// under their real paths — a false positive, which is the kind of noise that gets a guard deleted.
const SCRIPT_PATH = /(?<![A-Za-z0-9._/-])(?:scripts|packages\/[A-Za-z0-9._-]+(?:\/(?:src|scripts|python|bin|provisioning))?)\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts|py|ps1|sh)/g;

function referencedScripts(): Map<string, string[]> {
  const sources = ["package.json", "action.yml"];
  const found = new Map<string, string[]>();
  for (const source of sources) {
    for (const match of readFileSync(source, "utf8").matchAll(SCRIPT_PATH)) {
      const list = found.get(match[0]) ?? [];
      if (!list.includes(source)) list.push(source);
      found.set(match[0], list);
    }
  }
  return found;
}

/**
 * Is there a git repository to ask?
 *
 * Without this the test reported ALL 17 referenced programs as missing when run from an exported tree with
 * no `.git` — every `git ls-files` fails, and "the command failed" is indistinguishable from "the file is
 * untracked". A guard that cries wolf outside a checkout is worse than no guard: it gets deleted. So an
 * absent repository is reported as SKIPPED, loudly, in the same spirit as `verify.corpus.test.ts` skipping
 * when the corpus is absent. CI runs `actions/checkout`, which provides `.git`, so the check still runs
 * exactly where it matters.
 */
function insideGitRepo(): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"],
      { env: sandboxGitEnv(), encoding: "utf8" }).trim() === "true";
  } catch {
    return false;
  }
}

const isTracked = (path: string): boolean => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], { env: sandboxGitEnv(), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

test("every scripts/ program referenced by package.json or action.yml is tracked in git", (t) => {
  if (!insideGitRepo()) {
    t.skip("not a git checkout, so tracked-ness cannot be determined here");
    return;
  }
  const referenced = referencedScripts();
  // Guard the guard: if the regexes stop matching, this test would pass by examining nothing — the exact
  // failure mode this project keeps meeting. The repo references well over a dozen.
  assert.ok(referenced.size >= 10, `only found ${referenced.size} referenced scripts; the scan is broken`);

  const missing = [...referenced.entries()]
    .filter(([path]) => !isTracked(path))
    .map(([path, sources]) => `${path} (referenced by ${sources.join(", ")})`);

  assert.deepEqual(missing, [],
    `${missing.length} referenced program(s) are not in the repo. Anyone who clones or installs this cannot `
    + `run them, however well they work on the machine that has them.`);
});

/** `extends` targets of every tracked tsconfig, resolved to repo-relative paths. */
function extendedConfigs(): Array<{ from: string; target: string }> {
  const configs = execFileSync("git", ["ls-files", "*tsconfig*.json"], { env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean);
  const found: Array<{ from: string; target: string }> = [];
  for (const from of configs) {
    // tsconfig permits comments, and this repo uses them heavily to record WHY a setting is load-bearing.
    const source = readFileSync(from, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const extended = (JSON.parse(source) as { extends?: string | string[] }).extends;
    if (!extended) continue;
    for (const target of Array.isArray(extended) ? extended : [extended]) {
      // Only relative paths are ours to guarantee; a bare specifier comes from node_modules.
      if (target.startsWith(".")) found.push({ from, target: relative(".", join(dirname(from), target)) });
    }
  }
  return found;
}

test("every tsconfig extends target is tracked in git", (t) => {
  if (!insideGitRepo()) {
    t.skip("not a git checkout, so tracked-ness cannot be determined here");
    return;
  }
  const extended = extendedConfigs();
  // Guard the guard, as above: if the parse silently stops finding `extends`, this passes by examining
  // nothing. `tsconfig.base.json` is extended by at least the project-reference fixtures.
  assert.ok(extended.length >= 1, "found no tsconfig extends targets at all; the scan is broken");

  const missing = extended
    .filter(({ target }) => !isTracked(target))
    .map(({ from, target }) => `${target} (extended by ${from})`);

  assert.deepEqual(missing, [],
    `${missing.length} tsconfig(s) extend a file that is not in the repo. Every local check passes — the `
    + `file is in the working tree — and a clean clone fails with TS5083.`);
});
