// A worktree whose `node_modules` is a symlink to the primary checkout's resolves every
// `@a11y-witness/*` import to the PRIMARY's `packages/*/dist`, not the worktree's own — so building in
// your own worktree changes nothing a cross-package tool reads there. Measured 2026-09-06: a generator
// read the primary's two-hour-stale `dist` and a worker was nearly dispatched at a defect that did not
// exist. CLAUDE.md's stale-`dist` warning never said WHOSE, and `docs/roles/worker-loop-orchestrator.md`
// never said the fleet-driving primary checkout should hold nothing checked out at all -- two rules,
// two files, and a check that fails if either goes missing, per the issue's own acceptance.
//
// DISCOVERED as substring presence in each file's real text, never restated as a hand-copied string --
// the same shape as every other doc-truth test in this repo, so a future rewording that keeps the FACT
// but drops the specific sentence does not silently pass a check reading old prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLAUDE_MD = "CLAUDE.md";
const ORCHESTRATOR_ROLE = "docs/roles/worker-loop-orchestrator.md";

const read = (relPath: string) => readFileSync(resolve(process.cwd(), relPath), "utf8");

test("CLAUDE.md's stale-dist warning says WHOSE dist, not just that dist is stale", () => {
  const source = read(CLAUDE_MD);
  // The vacuity guard for THIS test: the pre-existing warning must still be present at all, so a
  // discovery reading an empty or unrelated file cannot pass by finding neither string.
  assert.match(source, /resolve to `dist`/,
    `${CLAUDE_MD} no longer carries the base stale-dist warning at all -- either the guard is reading `
    + "the wrong file, or the warning was removed rather than extended");
  assert.match(source, /verify WHOSE|to WHICH checkout|whose `dist`/i,
    `${CLAUDE_MD} still does not say WHOSE dist a cross-package import resolves to -- a worktree sharing `
    + "the primary's node_modules silently reads the primary's build, and this is the gap that cost real "
    + "time on 2026-09-06");
});

test("the fleet-driving primary checkout rule says nothing is checked out in it, not only that nobody merges there", () => {
  const source = read(ORCHESTRATOR_ROLE);
  assert.match(source, /nobody MERGES|no other agent merges/i,
    `${ORCHESTRATOR_ROLE} no longer carries the base merge-only-in-the-primary rule -- vacuity check: `
    + "this guard must find SOMETHING before it can find the extension");
  assert.match(source, /nothing is ever checked out or edited in it|feature work is worktrees only/i,
    `${ORCHESTRATOR_ROLE} does not yet say the primary checkout holds nothing checked out at all -- the `
    + "narrower merge-only rule missed the passive case: a worktree sharing node_modules with a primary "
    + "sitting on a feature branch resolves every cross-package import to THAT branch's dist");
});

/**
 * MUTATION HALF, against synthetic files under `os.tmpdir()` -- proves both assertions actually
 * discriminate the extended wording from the base wording, rather than matching everything.
 */
test("MUTATION: the base-only wording is caught as incomplete, and the extended wording passes", () => {
  const baseOnlyClaude = "Cross-package imports resolve to `dist`, so run the full suite.";
  const extendedClaude = "Cross-package imports resolve to `dist` -- verify WHOSE, by resolving the exact specifier.";
  assert.doesNotMatch(baseOnlyClaude, /verify WHOSE|to WHICH checkout|whose `dist`/i,
    "the base-only CLAUDE.md wording was incorrectly read as already carrying the WHOSE clarification");
  assert.match(extendedClaude, /verify WHOSE|to WHICH checkout|whose `dist`/i,
    "the extended CLAUDE.md wording was not recognised by its own asserted pattern");

  const baseOnlyRole = "Nobody merges in the primary checkout, because expectedWorkerCode hashes the working tree.";
  const extendedRole = "Nothing is ever checked out or edited in it either -- feature work is worktrees only.";
  assert.doesNotMatch(baseOnlyRole, /nothing is ever checked out or edited in it|feature work is worktrees only/i,
    "the base-only role wording was incorrectly read as already carrying the checked-out-nothing extension");
  assert.match(extendedRole, /nothing is ever checked out or edited in it|feature work is worktrees only/i,
    "the extended role wording was not recognised by its own asserted pattern");
});
