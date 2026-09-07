/**
 * Is "the fleet-driving checkout" identified by something only THAT machine has?
 *
 * ## The incident, #198
 *
 * `pre-commit` and `post-checkout` guard the primary checkout: nothing may be committed there and it may
 * only sit detached at `origin/main`. Both identified it by `[ -d "$TOPLEVEL/.git" ]`.
 *
 * **A real `.git` directory is true of every ordinary clone.** That predicate is correct for the question
 * `prune-worktrees.mjs`'s `isPrimaryWorktree` asks — within one repository, primary worktree or linked
 * one? — and it does not answer *which machine is this*. `core.hooksPath` is committed, so `post-checkout`
 * travelled to the lab with a `git pull`, and `run-job.yml` then does the one thing it forbids:
 * `git checkout --detach <sha>` at the ref you asked for, which is how EVERY lab job runs at a branch.
 *
 * Every `lab:job -e ref=<branch>` failed. `-e ref=main` still worked, so it presented as "branches are
 * broken" rather than as a hook. Third population-boundary defect in two days (#164, #174) and the inverse
 * of both: not a guard reaching too few paths, but one reaching too many MACHINES.
 *
 * ## What this pins
 *
 * That the identification is an explicit LOCAL-CONFIG mark, and that neither hook has drifted back to
 * inferring it from the tree. `git config --local` lives in `.git/config`, which is not cloned and not
 * pulled — that is the entire property being relied on, and it is why a file in the tree cannot be the
 * mark however untracked it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOKS = `${REPO}scripts/git-hooks/`;
const GUARDED_HOOKS = ["pre-commit", "post-checkout"];

test("both primary-guarding hooks ask the shared check, and neither infers it from the tree", () => {
  // BOTH, not one. The remedy reaching one of several paths is this repo's most expensive recurring
  // shape, and here the two hooks disagreeing about which machine they are on would be silent.
  for (const hook of GUARDED_HOOKS) {
    const src = readFileSync(`${HOOKS}${hook}`, "utf8");
    assert.match(src, /is_primary_checkout/,
      `${hook} must ask lib/is-primary-checkout.sh rather than deciding for itself`);
    // The exact predicate that caused #198. Matched as CODE — a comment explaining the defect is expected
    // and must not fail this, which is why the test strips comment lines first.
    const code = src.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /-d\s+"?\$\{?\(?[^)]*toplevel[^)]*\)?\}?[^"]*\/\.git"?/i,
      `${hook} identifies the primary by \`.git\` being a directory — true of EVERY clone, which is #198. `
      + "The lab is an ordinary clone and `run-job.yml` detaches at an arbitrary ref by design.");
  }
});

test("the shared check reads LOCAL git config, which a clone or a pull cannot carry", () => {
  const lib = `${HOOKS}lib/is-primary-checkout.sh`;
  assert.ok(existsSync(lib), "lib/is-primary-checkout.sh is the one place this question is answered");
  const src = readFileSync(lib, "utf8");
  assert.match(src, /git config --local --get a11y\.primaryCheckout/,
    "the mark must be LOCAL config: `.git/config` is not cloned and not pulled, which is the whole "
    + "property. A tracked or untracked FILE would travel, and travelling is what caused #198.");
  // Absent config must read as "not the primary", never as an error that takes the hook down with it.
  assert.match(src, /\|\|\s*true/,
    "a missing key exits 1 from `git config --get`; under `set -e` that would abort the hook. The guard "
    + "must be inert on an unmarked checkout, not fatal.");
});

test("the mark is settable by a documented command, so an unmarked primary is fixable not mysterious", () => {
  // An opt-in guard that nobody can find the switch for is an off guard. `doctor` reports the gap and this
  // is what closes it; both are named in the hook's own refusal text.
  const scripts = JSON.parse(readFileSync(`${REPO}package.json`, "utf8")).scripts;
  assert.equal(scripts["primary:mark"], "node scripts/mark-primary-checkout.mjs");
  assert.ok(existsSync(`${REPO}scripts/mark-primary-checkout.mjs`));
});
