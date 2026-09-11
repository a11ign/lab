/**
 * #639: a derived artefact -- generated, or carrying a sha/count baked in at generation time -- is
 * correct the moment it is produced and wrong from the next commit onward, unless something recomputes
 * it from source. CLAUDE.md's own rule, stated once and paid for four times before anyone swept for the
 * rest of the population: "a number the tree computes does not live in prose."
 *
 * DISCOVERED, not recalled -- the same rule `cli-flags.test.ts` and `busy-worker-guard.test.ts` already
 * apply to their own populations: a hand-typed list is exactly the "fact stated twice" shape this repo
 * keeps paying for. `discoverGenerators()` below walks the tree for `generate-*.{mjs,ts}` scripts; a
 * `.mjs`-only glob would have MISSED `packages/lab/scripts/generate-coverage-doc.ts` -- found only by
 * widening the pattern before trusting a "complete" list, dispatcher's own caution from #634's 3-of-4.
 * `CLASSIFICATION` is the one part that must be hand-authored, because deciding WHY a drift is harmless
 * is a judgment call no glob can make -- but every discovered generator must appear in it, and every
 * classified path must still be a real generator, or this fails.
 *
 * THE REST OF #639'S REGION, AND WHY IT IS NOT ENUMERATED HERE:
 *
 * - `.github/workflows/*.yml` sha pins to THIRD-PARTY actions (`actions/checkout@<sha>` and similar) are
 *   NOT this class -- they pin an external dependency's version for supply-chain reasons and do not drift
 *   with this repo's own commits, so there is no "window between producing and committing" for them to be
 *   false in. `consumer-gate.yml` is the one workflow that is itself generated from this repo's own state
 *   (its own file header says so), which is why it is the one entry below carrying a `.yml` output.
 *
 * - Prose counts in `packages/*\/src/**` comments were swept separately (grep for `\b[0-9]+ (rules|heads|
 *   captures|records|...)\b` across every non-test source file, 32 matches): every one is a HISTORICAL
 *   MEASUREMENT told in the past tense ("measured on 675 captures", "18 recorded the state change and 1
 *   did not") describing a specific incident, never a claim about the repo's CURRENT shape. That is
 *   exactly `claude-md-counts.test.ts`'s own documented exclusion for the identical reason -- a corpus
 *   measurement is not reproducible from what is checked in, and a past-tense incident is a record of
 *   what happened, not a live fact to keep in sync. Nothing in that population needs a pinning test.
 *
 * - CLAUDE.md's own current-state counts are already pinned by `claude-md-counts.test.ts` (ADR count,
 *   fleet size, `WORKER_FILES` count, pre-commit thresholds) and `asserting-subtypes.test.ts` (the
 *   rules-owned/asserting subtype counts and membership). README.md's criterion count is pinned by
 *   `user-facing-docs-file-facts.test.ts`. All three were re-run here and pass against the current tree.
 *
 * - `docs/backlog.md`'s pinned `wc -l` line counts (six of them, `backlog-file-facts.test.ts`) are the
 *   SAME class as this row and are already filed as their own row, #703, owned separately (`ceo`'s
 *   ruling, owner `worker-config`) precisely because the fix there is not "add a pin" but "derive the
 *   number instead of typing it" -- a different remedy from anything else in this sweep, and one already
 *   has a name. Referenced rather than duplicated.
 *
 * - `docs/known-gaps.md`'s own table-of-contents index is pinned by `known-gaps-index.test.ts`, mutation-
 *   checked there (a tampered index line is asserted to fail). Confirmed still green.
 *
 * THE CHICKEN-AND-EGG CASE, NAMED RATHER THAN FIXED (the issue's own explicit ask): `consumer-gate.yml`
 * embeds a literal sha resolved at generation time (`git rev-parse HEAD`). Regenerating it and committing
 * the result MOVES the commit that sha must reference, so no committed tree can ever satisfy `--check`
 * against itself -- #558 is open on exactly this, and is a structurally different problem from "nobody
 * pinned it": there is no ordinary pinning test that could hold here without changing the mechanism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "runs", "__pycache__", ".venv"]);

/** Every `generate-*.mjs` or `generate-*.ts` file under `root`, repo-relative. Widened past `.mjs` only
 * after that narrower glob silently missed a real `.ts` generator -- see this file's own header. */
function discoverGenerators(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/^generate-.*\.(mjs|ts)$/.test(entry.name)) out.push(full.slice(REPO.length + 1));
    }
  };
  walk(root);
  return out;
}

interface GeneratorEntry {
  /** What the generator writes to a committed or gitignored path. */
  produces: string;
  /** `pinnedBy` a test recomputing it from source; `chickenEgg` cannot be pinned in a committed tree
   *  (#558's own shape); `notCommitted` the output is gitignored, so no committed tree is ever false. */
  status: "pinnedBy" | "chickenEgg" | "notCommitted";
  /** The pinning test's path (for `pinnedBy`), or the written reason (for the other two statuses). */
  detail: string;
}

const CLASSIFICATION: Record<string, GeneratorEntry> = {
  "scripts/generate-commands-doc.mjs": {
    produces: "docs/commands.md",
    status: "pinnedBy",
    detail: "packages/lab/src/packaging/commands-documented.test.ts",
  },
  "scripts/generate-consumer-gate.mjs": {
    produces: ".github/workflows/consumer-gate.yml",
    status: "chickenEgg",
    detail: "#558 -- embeds a literal sha resolved at generation time (git rev-parse HEAD); committing a "
      + "regeneration moves the commit that sha must match, so no committed tree can satisfy --check "
      + "against itself. Tracked as its own row, not folded in here.",
  },
  "packages/lab/scripts/generate-coverage-doc.ts": {
    produces: "docs/coverage.md",
    status: "notCommitted",
    detail: "#158 -- gitignored deliberately; generated-paths.test.ts asserts it stays untracked and the "
      + "nightly report's doc-references check reads it as a citation (#954), so no committed tree is "
      + "ever false about it.",
  },
  "packages/lab/src/training/generate-screenreader-dataset.mjs": {
    produces: "runs/screenreader-dataset/** (gitignored)",
    status: "notCommitted",
    detail: "writes only under runs/, gitignored in full -- no committed artefact to go stale.",
  },
  "packages/lab/src/training/generate-screenreader-acceptance.mjs": {
    produces: "runs/screenreader-acceptance/** (gitignored)",
    status: "notCommitted",
    detail: "writes only under runs/, gitignored in full -- no committed artefact to go stale.",
  },
};

test("every generate-*.{mjs,ts} script in the tree is discovered and classified -- #639", () => {
  const discovered = [...discoverGenerators(join(REPO, "scripts")), ...discoverGenerators(join(REPO, "packages"))]
    .sort();
  // A FLOOR ON THE DISCOVERY ITSELF, not just on the classification -- #634's own lesson (a narrowed
  // predicate silently examining 3 of 4 reports as cleanly as one examining all 4). If this walk ever
  // resolves to the wrong root, "zero generators found" would otherwise pass this test vacuously.
  assert.ok(discovered.length >= 5, `only found ${discovered.length} generator(s) (expected at least the `
    + `5 known today) -- the walk likely resolved to the wrong path, which would report a clean sweep of `
    + "nothing rather than failing loudly");
  for (const path of discovered) {
    assert.ok(CLASSIFICATION[path], `${path} is a NEW generator with no classification in this file's `
      + "CLASSIFICATION table -- add an entry naming what it produces and how this repo stays honest "
      + "about it (pinnedBy / chickenEgg / notCommitted)");
  }
  // AND THE REVERSE: a classified path that is no longer a real generator is a stale entry that would
  // hide a genuine removal behind a passing test -- the same "fact stated twice, and the copies drifted"
  // shape this repo's own defect catalogue is built from.
  for (const path of Object.keys(CLASSIFICATION)) {
    assert.ok(discovered.includes(path), `${path} is classified here but discoverGenerators() no longer `
      + "finds it -- remove the stale entry, or the discovery walk itself broke");
  }
});

test("every 'pinnedBy' classification names a test file that actually exists", () => {
  for (const [generator, entry] of Object.entries(CLASSIFICATION)) {
    if (entry.status !== "pinnedBy") continue;
    assert.ok(existsSync(join(REPO, entry.detail)),
      `${generator}'s pinning test "${entry.detail}" does not exist -- the reference has gone stale`);
  }
});

test("every classification names a real reason, never an empty one", () => {
  // "I checked" is refused by construction elsewhere in this repo (owned-path-signoff.mjs's own rule);
  // the identical principle applies to a classification with no stated reason.
  for (const [generator, entry] of Object.entries(CLASSIFICATION)) {
    assert.ok(entry.detail.trim().length > 10, `${generator}'s classification has no real reason recorded`);
    assert.ok(entry.produces.trim().length > 0, `${generator} does not say what it produces`);
  }
});
