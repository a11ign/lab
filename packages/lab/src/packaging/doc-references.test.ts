/**
 * Every path the top-level docs point at must exist.
 *
 * The package split moved `worker-ctl.sh` into `packages/worker-fleet/src/local-worker/` and left three
 * README links behind at `scripts/local-worker/`. Nothing noticed, because a wrong path in Markdown is not a
 * broken build — it is a reader following an instruction that silently cannot work, in the file a newcomer
 * reads first.
 *
 * This is the same reasoning as `spawned-paths.test.ts` applied to prose: a path in a string is a claim, and
 * an unverified claim about the filesystem rots the moment a file moves. Checking it by hand found it once;
 * this is so nobody has to remember to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// GIT_* SCRUBBED, because `cwd` is not isolation for a spawned git. A leaked `GIT_DIR` -- which a hook or
// a wrapping test can set -- redirects `check-ignore` onto another repository entirely, and it would
// answer confidently about the wrong tree. `git-spawn-classification.test.ts` refuses this file until it
// goes through the canonical helper, and it refused this very commit.
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
// #905: the citation rules live in the doc cross-reference check the nightly report also runs -- one copy.
// Generating the untracked page first is this TEST's precondition (#393), not the report's, so it stays here.
import {
  DOCS, GENERATED_CITATIONS, brokenCitations, untrackedCitations,
} from "../../../../scripts/doc-checks/doc-references.mjs";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * A CITED PATH THAT IS GENERATED MUST BE GENERATED BEFORE IT IS CHECKED — #393, and the defect is a
 * precondition nothing owned.
 *
 * `docs/coverage.md` is generated and deliberately untracked (#158), and `README.md` cites it in backticks
 * on purpose. CI keeps that citation honest by running `npm run docs:coverage` in the `docs` job before the
 * doc guards — with a comment saying exactly that. **The pre-push hook does not**, so the identical test
 * asked the identical question with the file absent and reported a real citation as a dead end, on branches
 * that had touched neither file.
 *
 * And it was worse than a plain asymmetry: `coverage-doc.test.ts` regenerates the page INTO `docs/` as a
 * side effect, so whether this test passed depended on test ORDER, and on whether an earlier run had left
 * a copy on disk. Measured 2026-09-07: this file passed on a clean `origin/main` checkout here and failed
 * the instant the generated page was moved aside — a green result produced by residue, which is this
 * repository's most-recorded failure shape.
 *
 * So the precondition is established HERE, by the test that needs it, rather than by CI remembering, by a
 * sibling test running first, or by the last person's leftovers. Only when the page is absent, so the
 * common case costs nothing.
 */
/**
 * BUILD OUTPUT, NAMED IN PROSE RATHER THAN OFFERED AS SOMEWHERE TO GO — the third population, found by the
 * test below on its first run.
 *
 * `CLAUDE.md` cites `packages/judge/dist/rules.js` in its fact-stated-twice table: *"which rules ship |
 * `rules.ts` source and `packages/judge/dist/rules.js` | `rules:gate` scored a rule the compiled bundle did
 * not contain"*. That is a story about drift between a source file and its build, and the artefact is the
 * subject of the sentence, not an instruction. Nobody is being sent to open it.
 *
 * It exists only after `npm run build`, so on a fresh clone it carries the identical latent failure #393
 * was raised for — and the remedy that works for `docs/coverage.md` does not transfer: generating it means
 * a full workspace build inside a documentation guard, which is exactly the ceremony this repo records as
 * the reason `capture:check` was mandatory and never ran once.
 *
 * CLASSIFIED, NOT EXCLUDED. "Nothing needs this" and "somebody forgot" must stay different states — the
 * `tabTops`/`INTERACTION_CHANNELS` lesson — so a build artefact is declared here with its reason rather
 * than quietly dropped by a looser regex.
 */
function ensureGeneratedPagesExist(): void {
  for (const { path, generator } of GENERATED_CITATIONS) {
    if (existsSync(join(repo, path))) continue;
    const npx = npmCliInvocation("npx", generator);
    execFileSync(npx.command, npx.args, { cwd: repo, stdio: "pipe" });
  }
}

test("every path cited by the top-level docs exists", () => {
  ensureGeneratedPagesExist();
  for (const doc of DOCS) {
    assert.ok(existsSync(join(repo, doc)), `${doc} is itself missing — this test's own subject`);
  }
  const { broken, checked } = brokenCitations(repo);

  // Guard the guard. If the regex stops matching, this test passes having examined nothing — the exact
  // failure mode that let 604 silent probe crashes and a green corpus coexist for a whole dataset.
  assert.ok(checked > 30, `the scan only resolved ${checked} references; it is broken, not clean`);

  assert.deepEqual(broken, [],
    `${broken.length} doc reference(s) point at nothing — a reader following these gets a dead end:\n  `
    + broken.join("\n  "));
});

/**
 * THE NEXT GENERATED CITATION, CAUGHT BEFORE IT COSTS ANOTHER EVENING — derived, never a literal pin.
 *
 * `docs/coverage.md` is the only one today. A second generated-and-untracked page cited in the top-level
 * docs would pass here on any machine that happened to have it on disk and fail on every fresh checkout,
 * which is precisely how #393 presented: intermittently, and always as somebody else's branch being broken.
 * So rather than trusting the next author to remember, this asks git.
 */
test("every cited path that git does not track is one this test knows how to generate", () => {
  const { untracked, scanned } = untrackedCitations(repo);
  // Guard the guard, the same way the test above does: a regex that stopped matching would report a clean
  // set having examined nothing, and this file's whole subject is checks that pass without looking.
  assert.ok(scanned > 30, `the scan only resolved ${scanned} references; it is broken, not clean`);
  assert.deepEqual(untracked, [],
    `${untracked.length} cited path(s) exist here but are gitignored, so a fresh checkout does not have `
    + "them and this file's other test would call them dead ends. Add each to GENERATED_CITATIONS with the "
    + "command that produces it — that is what makes the citation honest everywhere, rather than only "
    + "where somebody already ran the generator.");
});
