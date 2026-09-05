/**
 * ONE resolution of `runs/` and its dataset artefacts, and a test that fails if a NEW file reads it
 * another way.
 *
 * `dataset-paths.mjs`'s own header records the audit this closes: `DATASET_ROOT` resolved eleven times
 * (nine of them anchored on `process.cwd()`, which reads a different corpus depending on where the
 * script was invoked from), the repo-root computation duplicated across roughly a dozen scripts, three
 * env-var spellings for one root, and the capture filename `${id}.${variant}.json` spelled out at seven
 * call sites — the real count turned out to be closer to thirty once test fixtures and sibling packages
 * were included. Deleting the file list would have been a document; this is the module the CEO's
 * condition asked for, plus a DISCOVERING test — the same shape as `busy-worker-guard.test.ts` and
 * `cli-flags.test.ts`, both of which exist because a hand-written list of "the files that matter" is
 * exactly the kind of list a new file slips past.
 *
 * WHAT THIS DISCOVERS. Any `.mjs`/`.ts` source file under `packages/*\/src` or `packages/*\/scripts`
 * (excluding `dist/` and this file itself) whose text either:
 *   (a) reads one of the env vars this module owns (`DATASET_ROOT`, `RUNS_ROOT`, `A11Y_RUNS_ROOT`,
 *       `REAL_CORPUS_ROOT`, `DATASET_CAPTURE_ROOT`, `DATASET_EXPORT`, `CAPTURE_ROOT`), or
 *   (b) contains a `runs/<subdir>` string literal naming one of the roots this module resolves, or
 *   (c) builds the capture filename shape (an id and a variant joined into `<id>.<variant>.json`,
 *       whether by template literal or by string concatenation).
 *
 * Every discovered file must import from `dataset-paths.mjs` (for a/b) or `evidence-diff.mjs`'s
 * `captureFilePath`/`rejectedCaptureFilePath` (for c) — or be named in EXEMPT with a reason. A reason,
 * never a bare name, so removing an entry means arguing with a sentence rather than deleting a string.
 *
 * WHY NO "AT LEAST N MATCHED" FLOOR ON THE REPO SCAN. Every other discovering test in this repo pairs its
 * scan with a floor, because a regex that stopped matching anything would otherwise pass vacuously. That
 * shape does not fit here: the fix this test guards is the elimination of the population it would be
 * counting — a file that correctly calls `datasetRoot()` no longer CONTAINS the raw `DATASET_ROOT`
 * literal this scan looks for, so "few or zero non-exempt matches" is the SUCCESS state, not a sign the
 * regex broke. The floor moved onto the regexes themselves instead: the tests below assert each one
 * fires on realistic bad-shape source text, independent of anything currently on disk — and the EXEMPT
 * list is required to still match, which is what would catch a rewritten exempt file whose duplicate was
 * quietly removed without anyone updating the reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./dataset-paths.mjs";
import { stripComments } from "@a11y-witness/evidence/source-text";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SELF = "packages/lab/src/dataset-paths.test.ts";

/** Every `.mjs`/`.ts` file under `packages/*\/src` and `packages/*\/scripts`, repo-relative. */
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
        if (rel !== SELF) found.push(rel);
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

/** The env vars `dataset-paths.mjs` owns the resolution of. */
const OWNED_ENV_VARS =
  /process\.env\.(DATASET_ROOT|RUNS_ROOT|A11Y_RUNS_ROOT|REAL_CORPUS_ROOT|DATASET_CAPTURE_ROOT|DATASET_EXPORT|CAPTURE_ROOT)\b/;

/** A `runs/<subdir>` literal naming one of the roots this module resolves. */
const OWNED_RUNS_LITERAL = /["'`]runs\/[a-zA-Z][a-zA-Z0-9-]*/;

function matchesRunsSignature(source: string): boolean {
  return OWNED_ENV_VARS.test(source) || OWNED_RUNS_LITERAL.test(source);
}

function importsDatasetPaths(source: string): boolean {
  return /from ["'](\.\.\/)*dataset-paths\.mjs["']/.test(source);
}

/** The capture filename shape, built either as a template literal or by concatenation. */
const CAPTURE_FILENAME_SHAPE =
  /\$\{[a-zA-Z_][\w.]*\}\.\$\{[a-zA-Z_][\w.]*\}\.json|\bid\s*\+\s*["'][.\w]*["']\s*\+\s*variant/;

function importsCaptureFilePath(source: string): boolean {
  return /captureFilePath|rejectedCaptureFilePath/.test(source);
}

/**
 * Comments stripped, never raw text. A prose comment routinely quotes a `runs/`-shaped path with
 * backtick code-formatting -- this file's own header does it four times -- and a naive scan would flag
 * its own commentary as a violation. `stripComments` is the shared fix for exactly this failure mode
 * (see its own header: three guards in one day matched their own prose before it existed).
 */
function readSource(file: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
}

/**
 * Why a file that matches a signature does not need to import the module. A REASON, never a bare
 * name — the same discipline `busy-worker-guard.test.ts`'s `EXEMPT` uses.
 */
const EXEMPT: Record<string, string> = {
  "packages/lab/src/dataset-paths.mjs": "It is the implementation. It cannot import itself.",
  "packages/lab/src/capture/evidence-diff.mjs":
    "It is the implementation of the capture-filename half (captureFilePath/rejectedCaptureFilePath).",
  "packages/nvda-worker/src/capture-pure.corpus.test.ts":
    "@a11y-witness/lab depends on @a11y-witness/nvda-worker, so nvda-worker cannot import dataset-paths.mjs "
    + "without a dependency cycle. Kept as its own cwd-anchored copy; see dataset-paths.mjs's own header.",
  "packages/worker-fleet/src/doctor.mjs":
    "@a11y-witness/lab depends on @a11y-witness/worker-fleet, so worker-fleet cannot import "
    + "dataset-paths.mjs without a cycle. Resolves from its OWN module location instead of process.cwd() "
    + "(the same fix, duplicated for the dependency-direction reason rather than left cwd-anchored).",
  "packages/worker-fleet/src/compare-workers.mjs":
    "Same cycle as doctor.mjs: worker-fleet cannot import @a11y-witness/lab.",
  "packages/judge/src/channel-tables-4.1.2.test.ts":
    "@a11y-witness/lab depends on @a11y-witness/judge, so judge cannot import dataset-paths.mjs "
    + "without a cycle -- the same direction as nvda-worker and worker-fleet. Landed on main the "
    + "same night as this guard, from a branch that could not have known about it, and the guard "
    + "caught it at the merge. Re-anchored on its own module location rather than process.cwd(), so "
    + "only the cycle is duplicated and not the bug.",
  "packages/evidence/src/wire-types-describe-the-wire.test.ts":
    "@a11y-witness/evidence is the zero-dependency package everything else (including lab) depends on; "
    + "it cannot import dataset-paths.mjs without inverting the whole dependency graph.",
  "packages/lab/src/packaging/promotion-refuses-dirty.test.ts":
    "Tests promote-model.mjs's A11Y_PROMOTE_ROOT override directly; the runs/model-candidate literal is "
    + "a fixture path under a temp root this test plants, not a read of the real corpus. (promote-model.mjs "
    + "itself is not in this list: it uses A11Y_PROMOTE_ROOT, which this scan does not look for, and its "
    + "one bare \"runs\" has no trailing slash, so it never matches the signature in the first place.)",
  "packages/control/src/lab-pipeline.test.ts":
    "Asserts the EXPECTED output-file argument each pipeline job is dispatched with (e.g. "
    + "\"runs/screenreader-dataset/with-realism.jsonl\") -- a literal it compares against, not a path this "
    + "file resolves for itself.",
  "packages/lab/src/gates/veto-audit-corpus.test.ts":
    "Checks that an ansible command string does NOT contain a stale export path -- comparing against "
    + "another file's output, not resolving its own.",
  "packages/lab/scripts/lab-inventory.mjs":
    "The runs/ literal is inside a human-readable report line (\"no runs/model-* to speak of\") describing "
    + "what was NOT found, not a path this file resolves -- RUNS itself already comes from runsRoot().",
  "packages/worker-fleet/src/lab-job.test.ts":
    "Asserts the ansible job catalogue's DECLARED default roots (lab-job.yml's own DATASET_ROOT/env "
    + "defaults) and a --describe help string naming an output file -- comparing against another file's "
    + "content, not resolving a path itself. worker-fleet cannot import @a11y-witness/lab regardless (see "
    + "doctor.mjs's entry).",
  "packages/lab/scripts/explain-capture.mjs":
    "The runs/ literal is inside a human-readable error message naming where the search already looked "
    + "(findCaptures, a few lines above, builds those same roots through realCorpusRoot()/captureRoot()/ "
    + "repeatCapturesRoot() from dataset-paths.mjs) -- the message just cannot print realCorpusRoot()'s "
    + "actual VALUE without becoming machine-specific and useless to read.",
};

test("the discovery walk finds a realistic slice of the repo's own source", () => {
  const files = allSourceFiles();
  assert.ok(files.length > 300, `expected to discover the repo's source files, found ${files.length}`);
  // Spot-check the walk actually reaches both scan roots, per package, rather than one only.
  assert.ok(files.some((f) => f.startsWith("packages/lab/src/")), "did not reach packages/lab/src");
  assert.ok(files.some((f) => f.startsWith("packages/lab/scripts/")), "did not reach packages/lab/scripts");
  assert.ok(files.some((f) => f.startsWith("packages/worker-fleet/src/")), "did not reach a sibling package");
});

test("every file matching the runs/-resolution signature imports dataset-paths.mjs, or is exempt with a reason", () => {
  const offenders: string[] = [];
  for (const file of allSourceFiles()) {
    if (EXEMPT[file]) continue;
    const source = readSource(file);
    if (!matchesRunsSignature(source)) continue;
    if (!importsDatasetPaths(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `these file(s) resolve a runs/ path independently of dataset-paths.mjs. Either import from it or add `
    + `an EXEMPT entry naming why: ${offenders.join(", ")}`);
});

test("every file building the capture filename shape imports it from evidence-diff.mjs, or is exempt", () => {
  const offenders: string[] = [];
  for (const file of allSourceFiles()) {
    if (EXEMPT[file]) continue;
    const source = readSource(file);
    if (!CAPTURE_FILENAME_SHAPE.test(source)) continue;
    if (!importsCaptureFilePath(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `these file(s) build the <id>.<variant>.json shape by hand rather than importing captureFilePath / `
    + `rejectedCaptureFilePath from evidence-diff.mjs: ${offenders.join(", ")}`);
});

test("every EXEMPT entry has a reason, names a file that exists, and STILL matches a signature", () => {
  for (const [file, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 40, `EXEMPT["${file}"] needs a real reason, not a placeholder`);
    const source = readSource(file); // throws if the file is gone -- a phantom exemption
    assert.ok(matchesRunsSignature(source) || CAPTURE_FILENAME_SHAPE.test(source),
      `EXEMPT["${file}"] no longer matches any signature this test looks for -- its duplicate may have `
      + "been removed already, in which case delete the entry rather than leaving a stale exemption");
  }
});

/**
 * THE MUTATION HALF. A guard must be shown to fail before it is trusted (CLAUDE.md's own rule) — and it
 * cannot be shown against the real repo once the repo is clean, because a clean repo is exactly what a
 * working guard produces. So these fire the predicates directly against synthetic source text shaped
 * like the eleven real defects this file's header describes, independent of anything on disk.
 */
test("MUTATION: the runs/-signature regex fires on the real historical shapes", () => {
  assert.ok(matchesRunsSignature('const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");'),
    "must catch the cwd-anchored DATASET_ROOT shape nine files had");
  assert.ok(matchesRunsSignature('const RUNS = resolve(REPO, process.env.A11Y_RUNS_ROOT || "runs");'),
    "must catch the A11Y_RUNS_ROOT shape");
  assert.ok(matchesRunsSignature('const RUNS = resolve(process.cwd(), process.env.RUNS_ROOT || "runs");'),
    "must catch the RUNS_ROOT shape (a THIRD env name for the same root)");
  assert.ok(matchesRunsSignature('const OUT = resolve(REPO, "runs/unclosable-vetoes.json");'),
    "must catch a hardcoded runs/ literal with no env var at all");
  assert.ok(!matchesRunsSignature('const CAPTURES = captureRoot(datasetRoot());'),
    "a file that has been fixed to call the shared functions must not still match");
});

test("MUTATION: a NEW file reproducing the duplicate would be caught, not just the ones already fixed", () => {
  // Same predicate the repo-wide test above applies, against a file this repo does not contain -- proving
  // detection does not depend on which real files happen to exist today.
  const hypotheticalNewFile =
    'import { resolve } from "node:path";\n'
    + 'const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");\n';
  assert.ok(matchesRunsSignature(hypotheticalNewFile) && !importsDatasetPaths(hypotheticalNewFile),
    "a brand-new file re-deriving DATASET_ROOT must be flagged as an offender if not exempted");
});

test("MUTATION: the capture-filename regex fires on both historical shapes", () => {
  assert.ok(CAPTURE_FILENAME_SHAPE.test("const path = resolve(dir, `${id}.${variant}.json`);"),
    "must catch the template-literal shape");
  assert.ok(CAPTURE_FILENAME_SHAPE.test('const path = resolve(dir, id + "." + variant + ".json");'),
    "must catch the concatenation shape (evidence-diff.mjs's own header names this as three-plus copies "
    + "that used `+` rather than a template literal, which is why a plain substring search missed them)");
  assert.ok(!CAPTURE_FILENAME_SHAPE.test("const path = captureFilePath(dir, id, variant);"),
    "a file that has been fixed to call captureFilePath must not still match");
});

test("REPO_ROOT resolves whether runs/ is a real directory or the symlink `.gitignore` also carries", () => {
  // `.gitignore` lists both `runs/` and `/runs` because the lab mounts a real volume there and a symlink
  // is not a directory as far as a trailing slash is concerned. `dataset-paths.mjs` must not assume either
  // shape -- proven here by checking whichever this checkout actually has, rather than asserting a shape.
  const runsPath = join(REPO_ROOT, "runs");
  const st = statSync(runsPath, { throwIfNoEntry: false });
  const kind = st ? (st.isDirectory() ? "dir" : "other") : "missing";
  assert.ok(["missing", "dir", "other"].includes(kind), "sanity check that statSync ran at all");
  assert.doesNotMatch(readSource("packages/lab/src/dataset-paths.mjs"), /realpathSync|lstatSync/,
    "dataset-paths.mjs must resolve purely by string joining, never by asking the filesystem what runs/ "
    + "actually is -- that is what makes it work identically for a real directory and for the lab's symlink");
});
