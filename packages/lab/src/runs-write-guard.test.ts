/**
 * Every script that WRITES into `runs/` must be askable, without reading its source, whether it is safe
 * to run without touching the corpus: `A11Y_RUNS_READONLY=1 <script>` must refuse and name the path.
 *
 * MEASURED for this unit: of the files matching `dataset-paths.mjs`'s own `runs/`-resolution signature
 * (see `dataset-paths.test.ts`), 18 also call a filesystem write function. 16 of those genuinely write
 * INTO `runs/` and now call the guard; the other 2 (`collect-promotion.mjs`, which copies FROM runs/
 * into tracked `packages/scorer/models/`, and `check-real-page-findings.ts`, whose only write targets
 * tracked `packages/lab/baselines/`) are EXEMPT with a reason. Nothing distinguished the 16 real writers
 * from the read-only files by NAME —
 * `npm run corpus:grants-map` writes, `npm run lab:inventory` does not, and a peer cannot tell which
 * without opening the file. This is what `build-realism-tier.mjs` cost when it was run directly to test
 * an unrelated change: it silently wrote `runs/screenreader-dataset/with-realism.jsonl`, twice.
 *
 * `refuseIfRunsReadonly` (`dataset-paths.mjs`) is the guard; this is the DISCOVERY that keeps every
 * current and future writer calling it -- same shape as `dataset-paths.test.ts`, `cli-flags.test.ts` and
 * `busy-worker-guard.test.ts`: a hand-written list of "the writers that matter" is exactly the kind of
 * list a new writer slips past.
 *
 * WHAT THIS DISCOVERS. Any `.mjs`/`.ts` file under `packages/*\/src` or `packages/*\/scripts` that BOTH
 * matches `dataset-paths.mjs`'s own runs/-resolution signature (imports it, reads one of the env vars it
 * owns, or contains a `runs/<subdir>` literal) AND calls a write function
 * (`writeFileSync`/`appendFileSync`/`writeJsonAtomic`/`rmSync`). Every discovered file must call
 * `refuseIfRunsReadonly`, or be named in EXEMPT with a reason.
 *
 * THIS FILE READS SOURCE, NEVER THE CORPUS, which is why `corpus-readers-are-guarded.test.ts` classifies
 * it `not-a-corpus-read` instead of requiring `labCorpusReadable`. Its walk is `packages/*\/src` and
 * `packages/*\/scripts`, and every read resolves against `REPO_ROOT`; the corpus accessors that made it
 * match that scan (`datasetRoot()`, `realCorpusRoot()`, `runsRoot()`) occur only inside EXEMPT reason
 * strings and inside the synthetic source text of the MUTATION test at the foot of this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./dataset-paths.mjs";
import { stripComments } from "@a11y-witness/evidence/source-text";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SELF = "packages/lab/src/runs-write-guard.test.ts";

/** Same walk as `dataset-paths.test.ts`: every `.mjs`/`.ts` under `packages/*\/src` and `packages/*\/scripts`. */
function allSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && /\.(mjs|ts)$/.test(entry.name)) {
        const rel = relative(REPO_ROOT, path);
        if (rel !== SELF && !rel.includes(".test.")) found.push(rel);
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    walk(join(REPO_ROOT, "packages", pkg.name, "src"));
    walk(join(REPO_ROOT, "packages", pkg.name, "scripts"));
  }
  return found;
}

function readSource(file: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
}

/** Same signature `dataset-paths.test.ts` scans for: a file that resolves a runs/-family path. */
const OWNED_ENV_VARS =
  /process\.env\.(DATASET_ROOT|RUNS_ROOT|A11Y_RUNS_ROOT|REAL_CORPUS_ROOT|DATASET_CAPTURE_ROOT|DATASET_EXPORT|CAPTURE_ROOT)\b/;
const OWNED_RUNS_LITERAL = /["'`]runs\/[a-zA-Z][a-zA-Z0-9-]*/;
const IMPORTS_DATASET_PATHS = /from ["'][^"']*dataset-paths\.mjs["']/;

function resolvesRunsPath(source: string): boolean {
  return IMPORTS_DATASET_PATHS.test(source) || OWNED_ENV_VARS.test(source) || OWNED_RUNS_LITERAL.test(source);
}

/** A write call. `rmSync` is included -- deleting a real file under runs/ is a write for this guard's
 *  purposes, and retrain-pipeline.mjs's transcript is removed before being appended to. `copyFileSync`
 *  is included so a script that copies FROM runs/ (collect-promotion.mjs, into packages/scorer/models/)
 *  is caught by the scan and has to argue its exemption rather than never being asked. */
const WRITE_CALL = /\b(writeFileSync|appendFileSync|writeJsonAtomic|rmSync|copyFileSync)\s*\(/;

function callsRefusalGuard(source: string): boolean {
  return /\brefuseIfRunsReadonly\s*\(/.test(source);
}

/**
 * Why a file that resolves a runs/ path and writes does not call the guard. A REASON, never a bare name.
 */
const EXEMPT: Record<string, string> = {
  "packages/lab/src/dataset-paths.mjs":
    "It is the implementation of refuseIfRunsReadonly itself -- the guard cannot call itself, and its own "
    + "writeJsonAtomic-shaped text is inside a doc comment describing OTHER files, not a write this file "
    + "performs.",
  "packages/lab/scripts/collect-promotion.mjs":
    "Copies files INTO packages/scorer/models/ (tracked source, the promotion path) and reads runs/ "
    + "artefacts as its SOURCE for those copies -- it never writes into runs/ itself. "
    + "test_no_writes_into_source_tree.py already guards the tracked-source half of this script's write; "
    + "this guard is scoped to runs/ specifically, a different destination.",
  "packages/lab/scripts/corpus-snapshot.mjs":
    "Reads runs/ (datasetRoot()) to build a backup archive but writes the .tar.gz to `backups/` under the "
    + "invoker's CWD by default (or wherever --out= points), never into runs/ itself -- it is a snapshot "
    + "tool precisely because its output is NOT the corpus.",
  "packages/lab/scripts/check-real-page-findings.ts":
    "Its only write (writeFileSync(BASELINE, ...)) targets packages/lab/baselines/real-page-findings.json "
    + "-- tracked source, a deliberate checked-in baseline update, not a runs/ write. It does resolve "
    + "runs/ paths (realCorpusRoot(), datasetRoot()) to READ the corpus it is scoring.",
};

test("the discovery walk finds a realistic slice of the repo's own source", () => {
  const files = allSourceFiles();
  // Lower than dataset-paths.test.ts's own floor (>300): that walk counts .test.ts files too, and this
  // one excludes them deliberately -- a test file legitimately mentions a write-call shape or a runs/
  // literal as the SUBJECT of an assertion without itself being a writer.
  assert.ok(files.length > 150, `expected to discover the repo's non-test source files, found ${files.length}`);
});

test("every file that resolves a runs/ path AND writes calls refuseIfRunsReadonly, or is exempt with a reason", () => {
  const files = allSourceFiles();
  const writers = files.filter((file) => {
    const source = readSource(file);
    return resolvesRunsPath(source) && WRITE_CALL.test(source);
  });
  // A signature this specific finding NOTHING would mean the scan broke, not that every writer vanished --
  // 18 files matched it during this unit's own survey (16 genuine writers plus the 2 EXEMPT below).
  assert.ok(writers.length >= 15,
    `expected to find the known population of runs/ writers, found ${writers.length}: ${writers.join(", ")}`);

  const offenders = writers
    .filter((file) => !EXEMPT[file])
    .filter((file) => !callsRefusalGuard(readSource(file)))
    .map((file) => `  ${file}`);

  assert.deepEqual(offenders, [],
    "these file(s) resolve a runs/ path and write, but never call refuseIfRunsReadonly. Either call it "
    + `before the write, or add an EXEMPT entry naming why:\n${offenders.join("\n")}`);
});

test("every EXEMPT entry has a reason, names a file that exists, and still resolves a runs/ path", () => {
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 40, `EXEMPT["${file}"] needs a real reason, not a placeholder`);
    const source = readSource(file); // throws if the file is gone -- a phantom exemption
    assert.ok(resolvesRunsPath(source),
      `EXEMPT["${file}"] no longer resolves a runs/ path -- delete the entry if it stopped, or re-check `
      + "the discovery regex if it should still match");
  }
});

/**
 * THE MUTATION HALF. Fired against synthetic source text, independent of anything on disk, because a
 * clean repo is exactly what a working guard produces and cannot itself demonstrate the guard works.
 */
test("MUTATION: the write-call regex fires on every real write shape this guard covers", () => {
  assert.ok(WRITE_CALL.test('writeFileSync(OUT, JSON.stringify(map));'), "must catch writeFileSync");
  assert.ok(WRITE_CALL.test('appendFileSync(transcript, line);'), "must catch appendFileSync");
  assert.ok(WRITE_CALL.test('writeJsonAtomic(path, value);'), "must catch writeJsonAtomic");
  assert.ok(WRITE_CALL.test('rmSync(RETRAIN_TRANSCRIPT, { force: true });'), "must catch rmSync");
  assert.ok(!WRITE_CALL.test('readFileSync(OUT, "utf8");'), "must not fire on a read");
});

test("MUTATION: a NEW writer reproducing the gap would be caught, not just the ones already fixed", () => {
  const hypotheticalNewWriter =
    'import { writeFileSync } from "node:fs";\n'
    + 'import { runsRoot } from "../src/dataset-paths.mjs";\n'
    + 'function main() {\n'
    + '  writeFileSync(resolve(runsRoot(), "new-report.json"), "{}");\n'
    + '}\n';
  assert.ok(resolvesRunsPath(hypotheticalNewWriter) && WRITE_CALL.test(hypotheticalNewWriter)
    && !callsRefusalGuard(hypotheticalNewWriter),
    "a brand-new writer that never calls refuseIfRunsReadonly must be flagged as an offender if not exempted");
});
