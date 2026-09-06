/**
 * Every reader that scans `runs/real-page-corpus/` must say how old what it read is, or be exempt with
 * a reason.
 *
 * `real-page-freshness.mjs`'s own header records why this matters: `capture-real-pages` DEFAULTS to
 * `--role=training`, well under half the declared corpus, so the ordinary way to refresh it refreshes a
 * minority of the pages -- and a reader that treats every file it finds as equally current is comparing a
 * MIXED population without knowing it. `check-real-page-findings.ts` measured the cost directly (a
 * confident wrong conclusion from reading an older capture as if it were current); this unit found the
 * same exposure, unaddressed, in `lab-inventory.mjs`, `calibrate-abstention.mjs` and
 * `build-realism-tier.mjs`.
 *
 * DISCOVERED, not hand-listed, for the reason this repo's other population guards exist
 * (`dataset-paths.test.ts`, `env-doc-coverage.test.ts`, `commands-documented.test.ts`): a hand-written
 * list of "the files that matter" is exactly the kind of list a new file slips past. The signature is a
 * file that both resolves `realCorpusRoot()` and calls `readdirSync` -- resolving the path alone (like
 * `audit-corpus-urls.mjs`, which only imports the DECLARED page list to make live HTTP requests and never
 * reads a captured file) is not enough to be in scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SELF = "packages/lab/src/training/real-page-corpus-freshness.test.ts";

function walk(dir: string, filter: (name: string) => boolean): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, filter);
    const rel = relative(REPO_ROOT, full);
    return filter(entry.name) && rel !== SELF ? [rel] : [];
  });
}

/**
 * Every PRODUCTION `.mjs`/`.ts` source file under `packages/lab` -- test files excluded, because a test
 * legitimately mentions `realCorpusRoot`/`readdirSync` as the SUBJECT of an assertion (its own file-
 * walking setup, a quoted code sample in a mutation check) without itself being a consumer whose
 * judgement stale evidence could poison.
 */
function labSourceFiles(): string[] {
  return walk(join(REPO_ROOT, "packages/lab"), (name) => /\.(mjs|ts)$/.test(name) && !name.includes(".test."));
}

function readSource(file: string): string {
  return readFileSync(join(REPO_ROOT, file), "utf8");
}

/** A file is IN SCOPE when it both resolves the real-page corpus root and reads a directory -- resolving
 *  the path alone is not a read (see `audit-corpus-urls.mjs`, exempt below for exactly that reason). */
function scansRealPageCorpus(source: string): boolean {
  return /\brealCorpusRoot\b/.test(source) && /\breaddirSync\b/.test(source);
}

function importsFreshnessHelper(source: string): boolean {
  return /from ["'][^"']*real-page-freshness\.mjs["']/.test(source);
}

/**
 * Why a reader in scope does not report age. A REASON, never a bare name -- the same discipline every
 * other EXEMPT table in this repo uses (`busy-worker-guard.test.ts`, `dataset-paths.test.ts`).
 */
const EXEMPT: Record<string, string> = {
  "packages/lab/src/training/capture-real-pages.mjs":
    "The WRITER, not a downstream consumer. Its readdirSync call is --resume bookkeeping (which pages "
    + "already have a capture, so as not to redo them) -- it is not making a judgement that stale evidence "
    + "could poison; it is the tool that FIXES staleness by capturing.",
  "packages/lab/scripts/audit-rule-coverage.ts":
    "Answers a cumulative question -- has this rule EVER fired on a real page -- for which an old finding "
    + "is still valid evidence; age-mixing across roles does not invalidate a positive the way it does for "
    + "check-real-page-findings.ts's baseline diff or calibrate-abstention.mjs's threshold. Already guards "
    + "the risk that actually applies to it: minutesSinceLastWrite refuses to measure a corpus still being "
    + "written (corpus-settled.mjs), which is a different failure from the one this file is about.",
  "packages/lab/scripts/explain-capture.mjs":
    "A single-capture, human-driven diagnostic (`npm run capture:explain -- <id>`) -- a person reading one "
    + "capture's own outcome, not a corpus-wide judgement a mixed population could poison. It does not "
    + "compute anything ACROSS captures the way the other readers do.",
  "packages/lab/src/training/corpus-settled.mjs":
    "It reads the directory to answer whether the corpus is SETTLED, never to compute a finding from what "
    + "is in it: `captureCount` counts .json files to tell an empty runs/ from a real corpus, and "
    + "`minutesSinceLastWrite` takes the newest mtime. Neither opens a capture or compares one to another, "
    + "so there is no population to mix ages across -- and this file is the thing that REFUSES a corpus "
    + "being written underneath a reader, which is the neighbouring failure rather than this one. It was "
    + "discovered here the moment it started scanning the real-page root, which is this guard working.",
};

test("the discovery walk finds a realistic slice of packages/lab's own source", () => {
  const files = labSourceFiles();
  assert.ok(files.length > 50, `expected to discover packages/lab's source files, found ${files.length}`);
});

test("every reader that scans runs/real-page-corpus/ reports capture age, or is exempt with a reason", () => {
  const files = labSourceFiles();
  const inScope = files.filter((file) => scansRealPageCorpus(readSource(file)));
  // A signature this specific finding NOTHING would mean the walk broke, not that the repo is clean --
  // six files matched it by hand during this unit's own survey.
  assert.ok(inScope.length >= 5,
    `expected to find the known population of real-page-corpus readers, found ${inScope.length}: ${inScope.join(", ")}`);

  const offenders = inScope
    .filter((file) => !EXEMPT[file])
    .filter((file) => !importsFreshnessHelper(readSource(file)))
    .map((file) => `  ${file}`);

  assert.deepEqual(offenders, [],
    "these file(s) read runs/real-page-corpus/ and never report how old what they read is. Either import "
    + "captureAgeLines from real-page-freshness.mjs, or add an EXEMPT entry naming why age-mixing does "
    + `not apply to what this file computes:\n${offenders.join("\n")}`);
});

test("every EXEMPT entry has a reason and names a file that is still in scope", () => {
  const files = labSourceFiles();
  const inScopeSet = new Set(files.filter((file) => scansRealPageCorpus(readSource(file))));
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 40, `EXEMPT["${file}"] needs a real reason, not a placeholder`);
    assert.ok(inScopeSet.has(file),
      `EXEMPT["${file}"] no longer matches the real-page-corpus-reader signature -- it either stopped `
      + "reading the corpus (delete the entry) or the discovery regex needs to be re-checked");
  }
});
