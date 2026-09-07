/**
 * A FILE THAT HOLDS BOTH THE TRUTH AND A STALE COPY OF IT (#120).
 *
 * `real-page-corpus.test.ts` imported `SCORED_CRITERIA` from `coverage.ts` in one test and, two tests
 * away in the SAME FILE, held its own hand-written `Set(["1.1.1", …])` — stale at eight against
 * seventeen. That was fixed as the instance (#33). This is the class.
 *
 * It is the most literal form of this repository's own "a fact stated twice" defect: the canonical list
 * and its stale copy sitting in one file, visible to anyone who reads both and invisible to every single
 * test, because each test is individually correct about the list it was handed.
 *
 * WHY A COUNT CANNOT BE THE RULE, checked before this was written:
 *
 *     $ grep -oE '"[0-9]\.[0-9]\.[0-9]+"' packages/judge/src/act-rules.ts | sort -u | wc -l
 *     16
 *
 * `act-rules.ts` is the canonical source ACT declarations are read from, and sixteen literals there is
 * correct. So the population is not "files with many criterion strings"; it is files that hold a
 * criterion list ALONGSIDE the canonical one, and every member is CLASSIFIED rather than counted.
 *
 * WHAT COUNTS AS HOLDING ONE. Two shapes, and the second is the dangerous one:
 *
 *   1. a RUN of three or more criterion literals separated only by commas — an array or `Set` literal;
 *   2. a LOCAL DECLARATION REUSING A CANONICAL NAME — `const SCORED_CRITERIA = [...]` in a file that does
 *      not import it. This is worse than (1) and was found by this guard on its first run (#136): the
 *      name is identical, so a reader has no signal at all that they are looking at a copy, and no import
 *      exists to compare it against.
 *
 * DELIBERATELY OUT OF SCOPE: a criterion-KEYED table (`{ "1.1.1": ["graphic"], … }`). Those are
 * declaration tables mapping a criterion to a value, not duplicated lists, and the keys are not
 * comma-adjacent so the run pattern does not reach them. Named here rather than filtered silently,
 * because "nothing needs this" and "somebody forgot" must stay different states.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The names a canonical criterion list is known by. */
const CANONICAL = ["SCORED_CRITERIA", "RULE_CRITERIA", "assessedCriteria"] as const;

const DEFINES = new RegExp(String.raw`export\s+(?:const|function)\s+(?:${CANONICAL.join("|")})\b`);
const IMPORTS = new RegExp(String.raw`import[^;]*\b(?:${CANONICAL.join("|")})\b[^;]*from`, "s");
/** A LOCAL binding reusing a canonical name — the shape with no import to compare against. */
const REDECLARES = new RegExp(String.raw`(?<!export\s)(?:const|let|var)\s+(?:${CANONICAL.join("|")})\s*=`);
/** Three or more criterion literals separated only by commas: an array or `Set` literal. */
const RUN = /"[0-9]\.[0-9]+\.[0-9]+"(?:\s*,\s*"[0-9]\.[0-9]+\.[0-9]+"){2,}/;

/**
 * EVERY CANDIDATE IS CLASSIFIED, and a new one fails this suite until somebody decides which it is.
 *
 * Three classes, and the third is not an exemption — it is a debt with a number on it. An entry that
 * merely said "known" would be cover; one that names an issue is a thing somebody can close.
 */
const CLASSIFIED: Record<string, { why: string; issue?: number }> = {
  "packages/judge/src/coverage.ts": {
    why: "THE CANONICAL SOURCE. It defines all three lists, so the literals here ARE the truth rather "
      + "than a copy of it. Classified rather than excluded by filename, because a magic-path check "
      + "would also silently exempt whatever the file is renamed to.",
  },
  "packages/judge/src/outcomes.ts": {
    why: "INDEPENDENTLY JUSTIFIED. `NOT_SWEEP_DERIVED` is a five-member SUBSET asserting a different "
      + "property -- criteria whose evidence is a probe's own output rather than a quick-nav sweep, so "
      + "no sweep can truncate them -- not a copy of any canonical list. Each member carries a dated "
      + "comment saying why it joined, and the file's own parity test catches a criterion missing from "
      + "both tables. Widening it to a canonical list would be wrong, not tidier.",
  },
  "packages/lab/src/packaging/criterion-list-duplication.test.ts": {
    why: "THIS FILE. Its criterion literals are FIXTURES -- the positive controls below, which pin the "
      + "detector against sources built here so a green run cannot mean the patterns stopped matching. "
      + "It caught itself the moment it was committed, because the population is TRACKED files and an "
      + "uncommitted file is invisible to `git ls-files`: the guard was green in the working tree and "
      + "red the first time it could see itself. Declared rather than skipped by filename, on the rule "
      + "that a guard exempting its own file is how a guard stops applying to anyone.",
  },
  "packages/lab/scripts/calibrate-abstention.mjs": {
    why: "A CONFIRMED STALE COPY, found by this guard on its first run and NOT yet fixed. It declares a "
      + "local `SCORED_CRITERIA` of 8 under a comment reading `Read from the report, never hardcoded`; "
      + "the canonical list is 19 and this one is a strict subset of it, still carrying 3.3.2 and "
      + "lacking 1.4.13/2.4.7 -- the v19 change of 2026-09-06. Its only consumer is `testedCells()`, the "
      + "abstention calibration's DENOMINATOR. Left in place deliberately: the fix is two lines, but "
      + "confirming what it does to that measurement needs a lab run, and an unverified change to this "
      + "project's most important number is worse than a tracked one.",
    issue: 136,
  },
};

/**
 * Every tracked source file, discovered — never a hand-written list, which is the defect one level up.
 *
 * `sandboxGitEnv` is not decoration. The pre-push hook runs the suite with `GIT_DIR` exported, so a `git
 * ls-files` with an inherited environment lists ANOTHER repository's files and this guard would then
 * report confidently on a population it never looked at — a reader examining less than it believes,
 * which is the failure `git-spawn-classification.test.ts` exists to prevent and which caught this file
 * on its way in.
 */
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "packages"],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() })
    .split("\n")
    .filter((f) => /\.(ts|mjs)$/.test(f) && !f.includes("/dist/"));
}

/** @returns the files holding a criterion list beside, or instead of, the canonical one. */
export function candidates(read: (file: string) => string, files: string[]): string[] {
  return files.filter((file) => {
    const src = read(file);
    if (!(DEFINES.test(src) || IMPORTS.test(src) || REDECLARES.test(src))) return false;
    return RUN.test(src) || REDECLARES.test(src);
  });
}

const read = (file: string) => readFileSync(path.join(REPO, file), "utf8");

test("every file holding a criterion list beside the canonical one is CLASSIFIED", () => {
  const found = candidates(read, sourceFiles());
  const unclassified = found.filter((f) => !(f in CLASSIFIED));
  assert.deepEqual(unclassified, [],
    "each of these imports, defines or re-declares a canonical criterion list AND holds its own list of "
    + "criterion numbers. Read it, then add it to CLASSIFIED with one of three reasons: it is the "
    + "canonical source; it is an independently justified list asserting a different property (say "
    + "which); or it is a stale duplicate -- in which case fix it, or record it with the issue tracking "
    + "the fix. Do not add an entry that only says 'known'.");
});

test("no classification outlives the file or the shape it describes", () => {
  // An EXEMPT table that is never pruned becomes a list of files nobody has looked at in a year, and the
  // guard quietly shrinks to whatever is left. The same rule this repo applies to a stale comment.
  const found = new Set(candidates(read, sourceFiles()));
  const stale = Object.keys(CLASSIFIED).filter((f) => !found.has(f));
  assert.deepEqual(stale, [],
    "these are classified and are no longer candidates -- the duplication is gone, or the file is. "
    + "Delete the entry: a classification for a shape that no longer exists is a claim nobody can check.");
});

test("a tracked stale duplicate names the issue that will close it", () => {
  // The difference between a debt and an excuse is whether anyone can find it again.
  for (const [file, entry] of Object.entries(CLASSIFIED)) {
    if (!/STALE COPY/i.test(entry.why)) continue;
    assert.equal(typeof entry.issue, "number",
      `${file} is classified as a stale copy and must name the issue tracking its fix`);
  }
});

/**
 * AND THE PROOF, because a discovery test that finds nothing passes exactly like one that works.
 *
 * The population is real and small, so this suite would go green if the patterns silently stopped
 * matching -- which is the `sweepLog` guard's failure, and the signal-type scrape's, both of which
 * asserted over an empty set and passed. These drive the detector against sources built here, so its
 * behaviour is pinned independently of what the repository happens to contain today.
 */
test("the detector catches #33's shape: a canonical import beside a hand-written Set", () => {
  const stale = `
    import { SCORED_CRITERIA } from "@a11y-witness/judge/coverage";
    const SCORED = new Set(["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"]);
  `;
  assert.deepEqual(candidates(() => stale, ["fake.ts"]), ["fake.ts"],
    "this is #33 exactly -- the import and the stale copy two lines apart");
});

test("the detector catches a LOCAL re-declaration of a canonical name, with no import at all", () => {
  // #136's shape, and the one a reader cannot see: same name, different content, nothing to compare to.
  const shadow = `const SCORED_CRITERIA = ["1.1.1", "1.3.1", "2.4.4"];`;
  assert.deepEqual(candidates(() => shadow, ["fake.mjs"]), ["fake.mjs"]);
});

test("the detector does NOT fire on a criterion-keyed table, or on a file with no canonical list", () => {
  // Both directions, because a guard that fires on everything is removed within a week.
  const keyed = `
    import { SCORED_CRITERIA } from "@a11y-witness/judge/coverage";
    const SWEEPS: Record<string, string[]> = { "1.1.1": ["graphic"], "2.4.4": ["link"], "1.3.1": ["h"] };
  `;
  assert.deepEqual(candidates(() => keyed, ["keyed.ts"]), [],
    "a criterion-to-value map is a declaration table, not a duplicated list");

  const unrelated = `const CRITERIA = ["1.1.1", "1.3.1", "2.4.4"];`;
  assert.deepEqual(candidates(() => unrelated, ["unrelated.ts"]), [],
    "a list in a file that neither imports, defines nor shadows a canonical one is out of scope -- it "
    + "has no truth beside it to be a stale copy OF");
});

test("the population is not empty, so a green run means the detector ran", () => {
  assert.ok(candidates(read, sourceFiles()).length >= 3,
    "at least the canonical source, the justified subset and the tracked stale copy must be found; "
    + "fewer means the patterns have stopped matching real files and this suite is passing vacuously");
});
