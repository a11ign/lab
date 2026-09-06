// @ts-check
/**
 * The one resolution of `runs/` and its dataset artefacts.
 *
 * Before this existed, the repo-root computation `fileURLToPath(new URL("../../../", import.meta.url))`
 * was pasted into roughly a dozen scripts, each counting ".." segments to ITS OWN depth in the tree —
 * `dispatch.mjs` needed four where every `packages/lab/scripts/*.mjs` needed three, and nothing checked
 * which was right short of manually counting slashes. `DATASET_ROOT` was resolved eleven more times,
 * nine of them anchored on `process.cwd()` rather than the repo root — which is exactly the bug class
 * this file's own CLAUDE.md names elsewhere: "a script anchored on process.cwd() reads a different
 * corpus depending on where it was invoked from". And the capture filename `${id}.${variant}.json` was
 * spelled out at each of seven call sites rather than built once.
 *
 * Every documented npm script already runs `node packages/lab/...` from the repo root (see the root
 * `package.json`), so `process.cwd() === REPO_ROOT` for every supported invocation and this file's
 * anchor change is a no-op there. It only changes behaviour for a script run directly from some other
 * directory — which is the latent bug being fixed, not a regression.
 *
 * `.gitignore` carries both `runs/` and `/runs`: the second exists because the lab mounts a real volume
 * there and a symlink is not a directory as far as a trailing slash is concerned. Every function here
 * must resolve correctly whether `runs` is an ordinary directory or that symlink — `resolve()` does not
 * care, and nothing here calls `realpath`.
 *
 * ## What is deliberately NOT here
 *
 * `@a11y-witness/lab` depends on `@a11y-witness/nvda-worker` and `@a11y-witness/worker-fleet`, so
 * neither of those packages can import this module without a dependency cycle. Three call sites keep
 * their own copy of the repo-root computation for exactly that reason:
 *
 *   - `packages/nvda-worker/src/capture-pure.corpus.test.ts`
 *   - `packages/worker-fleet/src/doctor.mjs` and `packages/worker-fleet/src/compare-workers.mjs`
 *
 * `@a11y-witness/control` is separately exempt: ADR 0012 keeps it deliberately dependency-free (enforced
 * by `control-has-no-dependencies.test.ts`), and its own `REPO` in `lab-job.mjs`/`lab-pipeline.mjs` is
 * used only as a `cwd` for spawning Ansible — it never reads or writes anything under `runs/`.
 *
 * `promote-model.mjs` and `check-shipped-provenance.mjs` are exempt too, but for a reason to keep rather
 * than a boundary to fix: each takes its OWN override (`A11Y_PROMOTE_ROOT`, `A11Y_PROVENANCE_ROOT`) that
 * repoints the entire script at a fixture tree so its refusal can be proven without copying the
 * repository. That override has to live on the constant those two files compute themselves — a shared
 * `REPO_ROOT` fixed at this module's own location could not be repointed per test.
 *
 * `packages/lab/scripts/audit-rule-coverage.ts` and `check-real-page-findings.ts` are ordinary
 * consumers: `.ts` files under `packages/lab/scripts/` already import sibling `.mjs` modules by relative
 * path (see `corpus-settled.mjs`), so importing this one costs nothing extra.
 *
 * See `dataset-paths.test.ts` for the guard: it discovers every file in the repo that builds a `runs/`
 * or `DATASET_ROOT`-shaped path and refuses one that is not either importing from here or named in that
 * test's own exemption list, with a reason.
 */
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";

/**
 * Computed from THIS file's own location, once, rather than by every caller re-deriving it from ITS
 * location. `packages/lab/src/dataset-paths.mjs` sits three directories below the repo root
 * (`packages`, `lab`, `src`), so three ".." get there regardless of whether a caller imports the
 * `src` copy directly (scripts do) or the built `dist` copy (a cross-package `@a11y-witness/lab`
 * import would) — `dist/` mirrors `src/`'s depth under the package root.
 */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * `RUNS_ROOT` (read by `explain-scorer.mjs`) and `A11Y_RUNS_ROOT` (read by `lab-inventory.mjs`) were
 * BOTH live and neither tool read the other's name, so exporting one silently did nothing for the other
 * command. Both are honoured here rather than one being silently dropped — picking a single canonical
 * name is a follow-up, not this change, because dropping a spelling someone's shell profile already
 * exports would be a second silent behaviour change bundled with the real fix.
 *
 * @returns {string}
 */
export function runsRoot() {
  const override = process.env.RUNS_ROOT ?? process.env.A11Y_RUNS_ROOT;
  return resolve(REPO_ROOT, override ?? "runs");
}

const DEFAULT_DATASET_SUBDIR = "screenreader-dataset";

/**
 * The training corpus root. `DATASET_ROOT`, when set, replaces the whole path exactly as the eleven
 * duplicate copies of this line did — only the ANCHOR moved, from `process.cwd()` to the repo root.
 *
 * `defaultSubdir` exists for the one pair that legitimately differs: `generate-screenreader-dataset.mjs`
 * wants `screenreader-dataset` and `generate-screenreader-acceptance.mjs` wants
 * `screenreader-acceptance` when `DATASET_ROOT` is unset. Every other caller wants the training default
 * and passes nothing — the held-out acceptance runs get there instead by exporting
 * `DATASET_ROOT=runs/screenreader-acceptance` themselves (see `training:export-acceptance` in
 * `package.json`), which this function honours like any other override.
 *
 * @param {string} [defaultSubdir]
 * @returns {string}
 */
export function datasetRoot(defaultSubdir = DEFAULT_DATASET_SUBDIR) {
  const override = process.env.DATASET_ROOT;
  return override ? resolve(REPO_ROOT, override) : resolve(runsRoot(), defaultSubdir);
}

/**
 * The captures subdirectory under a dataset root. `DATASET_CAPTURE_ROOT` was the identical line in
 * three files (`check-signals.mjs`, `capture-screenreader-dataset.mjs`, `export-screenreader-dataset.mjs`).
 *
 * A fourth spelling, `CAPTURE_ROOT`, existed in two more (`audit-size-sensitivity.mjs`,
 * `audit-rule-coverage.ts`) as a second env-var name for the same concept, always pointed at
 * `runs/screenreader-dataset/captures` — the "three env names for one root" defect at a smaller scale.
 * Both of those now call `captureRoot(datasetRoot())`, which drops `CAPTURE_ROOT` recognition in favour
 * of composing with `DATASET_ROOT`/`DATASET_CAPTURE_ROOT` like every other caller. Nothing in the repo
 * documents `CAPTURE_ROOT` as a supported override (only these two files ever read it), so this is a
 * consolidation rather than a removal of a real feature.
 *
 * @param {string} root
 * @returns {string}
 */
export function captureRoot(root) {
  return resolve(root, process.env.DATASET_CAPTURE_ROOT || "captures");
}

/**
 * The exported training records file. `DATASET_EXPORT`, when set, replaces the whole path — the same
 * override two scripts (`audit-corpus-starvation.mjs`, `check-dataset-distribution.mjs`) already
 * supported, spelled out identically both times. `build-realism-tier.mjs` hardcoded the same default
 * path without reading the override at all; it now goes through this function so an operator who points
 * `DATASET_EXPORT` elsewhere gets a consistent answer from every reader rather than three of four.
 *
 * @returns {string}
 */
export function datasetExportPath() {
  const override = process.env.DATASET_EXPORT;
  return override ? resolve(REPO_ROOT, override) : resolve(datasetRoot(), "screenreader-evidence.jsonl");
}

/**
 * The real-page corpus root. `REAL_CORPUS_ROOT` was the identical line in four files
 * (`calibrate-abstention.mjs`, `build-realism-tier.mjs`, `audit-rule-coverage.ts`,
 * `check-real-page-findings.ts`) — the one env name here was never the problem; only the repo-root
 * anchor underneath it was duplicated.
 *
 * @returns {string}
 */
export function realCorpusRoot() {
  return resolve(REPO_ROOT, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
}

/**
 * Where `repeat-capture.mjs` writes by default, and one of the three roots `explain-capture.mjs` and
 * its test search — all three spelled `runs/repeat-captures` independently.
 *
 * @returns {string}
 */
export function repeatCapturesRoot() {
  return resolve(runsRoot(), "repeat-captures");
}

/**
 * `A11Y_RUNS_READONLY=1 <writer>` is how a peer finds out whether a script writes into `runs/` without
 * reading its source: a genuine writer refuses and NAMES the exact path it would have written, a
 * read-only audit is unaffected, and with the flag unset every writer works exactly as before.
 *
 * Added after `build-realism-tier.mjs` was run directly to test an unrelated change and wrote
 * `runs/screenreader-dataset/with-realism.jsonl` twice -- disclosed, and low-risk, because `runs/` in a
 * worktree is a local copy rather than the authoritative corpus (see this repo's own memory of that
 * correction). But nothing in a script's NAME says whether it writes, so a peer reading `npm run
 * corpus:grants-map` cannot tell it from `npm run lab:inventory` without opening the file. This makes the
 * distinction something you can ASK the script rather than something you have to read the source for.
 *
 * PURE at the core (`runsWriteRefusal`), for the reason `migrationVerdict` and `captureAgeLines` are pure
 * elsewhere in this package: `refuseIfRunsReadonly`'s `process.exit` would kill the test runner if called
 * directly from a unit test, so the decision and the exit are split the way this repo already splits them.
 *
 * Scoped to `runsRoot()` and everything under it, not to "any write anywhere" -- a script that writes into
 * `packages/scorer/models/` (a deliberate promotion) or `packages/lab/baselines/` (a deliberate,
 * already-reviewed baseline update) is answering a different question, and `test_no_writes_into_source_tree.py`
 * already refuses THAT unconditionally rather than behind a flag. This guard is opt-in because writing into
 * `runs/` is normally correct; the flag exists to ask "would this have touched it" without letting it.
 *
 * @param {string} targetPath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ path: string } | null}
 */
export function runsWriteRefusal(targetPath, env = process.env) {
  if (env.A11Y_RUNS_READONLY !== "1") return null;
  const resolved = resolve(targetPath);
  const root = resolve(runsRoot());
  if (resolved !== root && !resolved.startsWith(`${root}/`)) return null;
  return { path: relative(REPO_ROOT, resolved) };
}

/**
 * Call this immediately before a write into `runs/` -- at the top of `main()`, once, naming the OUTPUT
 * PATH or ROOT that write is under (not the exact file for a multi-file writer; the root is still a
 * concrete, honest answer to "would this have touched runs/").
 *
 * @param {string} targetPath
 */
export function refuseIfRunsReadonly(targetPath) {
  const refusal = runsWriteRefusal(targetPath);
  if (!refusal) return;
  console.error(`REFUSING to write ${refusal.path} — A11Y_RUNS_READONLY=1 is set.`);
  console.error("  Unset A11Y_RUNS_READONLY to run this for real.");
  process.exit(3);
}
