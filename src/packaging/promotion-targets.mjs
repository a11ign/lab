// @ts-check

/**
 * Is a previous promotion still sitting uncommitted where this one is about to write?
 *
 * `lab-job.yml` says "it stops at an uncommitted working tree, exactly as `promote-model.mjs` does", and
 * CLAUDE.md's command table says `promote:model` "stops at an uncommitted tree". Measured 2026-08-27:
 * `promote-model.mjs` does not import `node:child_process` at all, so it could never have looked at git.
 * A fact asserted in two places and true in neither — this repo's most-named defect, about a guard.
 *
 * ## What it cost, today
 *
 * The lab checkout was dirty with a promotion nobody had committed: the weights, both reports and a
 * changeset. `run-job.yml` correctly declines to pull into a dirty checkout, so EVERY later job ran at
 * the pre-promotion commit or refused outright — and the promotion that produced it had already
 * overwritten an earlier one's release note, because the changeset filename was derived from a count of
 * the directory. Both of those are fixed; this is the third, which is that nothing stopped the second
 * promotion starting on top of the first.
 *
 * ## Why the TARGETS and not the whole tree
 *
 * A tree-wide refusal reads well and is wrong here. This repo is a SHARED checkout — its own guidance
 * opens with "more than one agent works in this repo, on the same branch, at the same time" — so a
 * blanket refusal blocks a promotion because somebody else is editing something unrelated, and a guard
 * that fires on innocent states is one people learn to bypass. What must never be overwritten is an
 * uncommitted PREVIOUS promotion, and those are exactly the paths this one writes.
 *
 * PURE, so it can be proven without a git repository in a temp directory. `git status --porcelain` in,
 * the offending paths out.
 */

/**
 * @param {string} porcelain  `git status --porcelain -- <targets>` output
 * @returns {string[]} the paths already modified, in the order git reported them
 */
export function dirtyTargets(porcelain) {
  return String(porcelain)
    .split("\n")
    .filter((line) => line.trim() !== "")
    // `XY <path>`, and for a rename `XY <old> -> <new>`. The status is TWO FIXED COLUMNS and either may
    // be a space, so the path starts at column 3 and the line is sliced there — NOT split on the first
    // space, which yields "M path" for the unstaged ` M` that a stale promotion actually leaves.
    //
    // The raw line is sliced deliberately. Trimming first collapses ` M` and `M ` into the same string
    // and makes both parses agree, so a wrong one cannot be told from a right one — which is exactly
    // what happened: an earlier version trimmed first, and a mutation to the split survived because the
    // trim had already done the work the comment credited to the slice.
    .map((line) => line.slice(2).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ")[1] : path))
    .map((path) => path.replace(/^"|"$/g, ""));
}

/**
 * The refusal, as a sentence, or null when there is nothing to refuse.
 *
 * @param {string[]} dirty
 * @returns {string | null}
 */
export function promotionBlockedBy(dirty) {
  if (dirty.length === 0) return null;
  return "REFUSING to promote: a previous promotion is still uncommitted where this one would write:\n"
    + dirty.map((path) => `  ${path}`).join("\n")
    + "\n\nPromoting on top of it would overwrite weights and a release note that exist nowhere else —"
    + "\n`runs/` is gitignored and the lab is the only machine that holds them. Commit or fetch them"
    + "\nfirst (`npm run lab:fetch -- -e artifact=promoted-weights`), then promote."
    + "\n\nThis is also what leaves the lab checkout dirty, which makes every later job refuse to pull.";
}
