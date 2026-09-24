// @ts-check
// REBUILD A LAB FROM A CORPUS RELEASE, and run a real gate off the result. #2051.
//
//   node packages/lab/src/packaging/corpus-restore-drill.mjs --archive=<corpus-….tar.gz> --live-runs=/opt/a11y/runs
//   node packages/lab/src/packaging/corpus-restore-drill.mjs --release=corpus-2026-09-23_03-00-00 --live-runs=<path>
//
// ## What `corpus:release --verify` proves, and what it cannot
//
// It downloads the tarball, lists it and counts the JSON: **the bytes come back**. It never writes the
// archive into a `runs/` tree and never runs anything that READS a capture, so every failure that lives
// between a valid archive and a working lab is invisible to it (#43's stated remaining gap, filed as #2051):
//
//   layout        the archive is FLAT (`captures/`, `manifest.json`, then the sibling roots) and a lab needs
//                 the first two under `runs/screenreader-dataset/` and the rest under `runs/`
//   completeness  8,433 restored against 8,679 live is expected recency drift -- but nothing checked that
//                 the 246 were ONLY recency. A snapshot that omitted a whole directory would verify green
//                 forever, so the count is taken PER MEMBER against the live tree
//   usability     whether a gate runs off the restored tree. It could not have, and that is the finding
//                 below: the archive holds no `pages/`
//
// ## Restoring is not rebuilding: `pages/` is not in the archive
//
// `corpus-snapshot.mjs` archives "only what cannot be regenerated cheaply", and pages are generated from
// `case-matrix.mjs`. But `check-signals` calls `hasUsableCaptureFiles`, which hashes `pages/<id>` and
// compares it to each capture's `provenance.pageHash` -- so a tree restored from the archive alone reads
// EVERY case as `STALE CAPTURES` and the gate answers INCONCLUSIVE. Rebuilding a lab is therefore
// restore + `training:generate` + gate, and that is the sequence this runs.
//
// The generator writes into a SECOND directory and only its `pages/` are moved across. Left to write into
// the restored dataset it would also overwrite `manifest.json` with one built from today's `CASES`, and the
// gate would then be comparing the current case set with itself instead of with the archive's manifest.
//
// ## The restore target is a scratch tree, and cannot be made anything else
//
// A drill that could damage the corpus it protects is not one anybody should run. The target is refused if
// it is, or resolves into, the live corpus -- `/srv/a11y-runs`, `/opt/a11y/runs`, this checkout's `runs/`,
// or the `--live-runs` tree being compared against -- and refused if it is not empty. `--live-runs` is only
// ever READ.
//
// ## `find -L`, always
//
// `/opt/a11y/runs` is a symlink to `/srv/a11y-runs`, and `find` does not descend a TRAILING symlink without
// `-L`: it answers `0` for the whole tree, which reads as catastrophic data loss rather than as a bad
// command. It produced a wrong number in a live fleet batch on 2026-09-23. Every count here is `find -L`.
//
// ## Who may report a gate reading a tree
//
// `packages/lab/CLAUDE.md` rules that a gate reading `runs/` gives a verdict only when it runs on a corpus
// just fetched or on the lab. This gate reads a tree this script has just restored from the release, which
// is the case that ruling names as legitimate; it never reads a working copy of `runs/`.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { REPO_ROOT, runsRoot, refuseIfRunsReadonly } from "../dataset-paths.mjs";
import { gateVerdict, renderVerdict, exitCodeFor } from "../gates/verdict.mjs";
import { DEFAULT_REPO } from "../../scripts/corpus-release.mjs";

const run = promisify(execFile);

refuseUnknownFlags(["--archive=", "--release=", "--repo=", "--live-runs=", "--scratch=", "--require-complete"],
  { entry: import.meta.url, command: "node packages/lab/src/packaging/corpus-restore-drill.mjs" });

const DATASET_DIR = "screenreader-dataset";

/**
 * Where each top-level member of a snapshot lives in a `runs/` tree. The archive is flat and this is the
 * only place that says where its members go back to, so `corpus-restore-drill.test.ts` pins its keys to
 * `WANTED` and `WANTED_SIBLINGS` in `corpus-snapshot.mjs` -- a member added there and not here would be
 * archived and never restored.
 */
export const MEMBER_LAYOUT = Object.freeze({
  "captures": `${DATASET_DIR}/captures`,
  "manifest.json": `${DATASET_DIR}/manifest.json`,
  "real-page-corpus": "real-page-corpus",
  "screenreader-acceptance": "screenreader-acceptance",
  "board-snapshots": "board-snapshots",
});

/** The corpus as it is on the lab. Realpath'd below, because the second is a symlink to the first. */
const LIVE_CORPUS_ROOTS = ["/srv/a11y-runs", "/opt/a11y/runs"];

const MAX_LISTING_BYTES = 1 << 28;
const MAX_GATE_OUTPUT_BYTES = 1 << 26;
/** How much of a gate's output the report keeps when it printed no verdict line, and how many paths a refusal quotes. */
const TAIL_CHARS = 200;
const SAMPLE_PATHS = 3;
/** Column widths of the per-member table. */
const MEMBER_COLUMN = 24;
const COUNT_COLUMN = 6;
/** What `drillVerdict` asks: intact, complete against live, and a gate that runs. */
const QUESTIONS = 3;

/** @param {string} path @returns {string} the real path of the deepest ancestor that exists, with the rest re-appended */
function realpathOfNearest(path) {
  const missing = [];
  let here = resolve(path);
  while (!existsSync(here) && dirname(here) !== here) {
    missing.unshift(here.slice(dirname(here).length + 1));
    here = dirname(here);
  }
  return join(realpathSync(here), ...missing);
}

/** @param {string} inner @param {string} outer */
const isWithin = (inner, outer) => inner === outer || inner.startsWith(outer + sep);

/**
 * Why `target` may not be a restore target, or `null`. Pure over the paths it is given, so the refusal is
 * testable without a lab.
 *
 * Both spellings of every protected root are compared -- the path as written and its real path -- because
 * `/opt/a11y/runs` is a symlink: refusing only `/srv/a11y-runs` would let a restore into the symlink through.
 *
 * @param {string} target
 * @param {{ protectedRoots: string[] }} options
 */
export function targetRefusal(target, { protectedRoots }) {
  const spellings = [resolve(target), realpathOfNearest(target)];
  for (const root of protectedRoots) {
    const roots = existsSync(root) ? [resolve(root), realpathSync(root)] : [resolve(root)];
    if (roots.some((r) => spellings.some((s) => isWithin(s, r)))) {
      return `${target} is, or is inside, ${root} -- the live corpus. A drill that could write there could `
        + "damage the corpus it exists to protect.";
    }
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    return `${target} is not empty. A restore into a tree that already holds files proves nothing about `
      + "the archive: it would count what was there before.";
  }
  return null;
}

/**
 * Every `.json` under `path`, by `find -L` -- see the header. `0` for a path that does not exist, which is a
 * true answer for a member and never a failure of the count.
 *
 * @param {string} path
 */
export async function countJson(path) {
  if (!existsSync(path)) return 0;
  const { stdout } = await run("find", ["-L", path, "-type", "f", "-name", "*.json"],
    { maxBuffer: MAX_LISTING_BYTES });
  return stdout.split("\n").filter(Boolean).length;
}

/**
 * The JSON count of every member of a `runs/` tree, keyed by the archive's own member names.
 * @param {string} runs
 * @returns {Promise<Record<string, number>>}
 */
export async function countMembers(runs) {
  const entries = await Promise.all(Object.entries(MEMBER_LAYOUT)
    .map(async ([member, where]) => /** @type {const} */ ([member, await countJson(join(runs, where))])));
  return Object.fromEntries(entries);
}

const sum = (/** @type {Record<string, number>} */ counts) => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * What the archive holds, from its own listing: the JSON count, and the top-level member names.
 * A path that is absolute or climbs out is reported rather than extracted.
 *
 * @param {string} archive
 */
export async function inspectArchive(archive) {
  const { stdout } = await run("tar", ["-tzf", archive], { maxBuffer: MAX_LISTING_BYTES });
  const entries = stdout.split("\n").filter(Boolean);
  const unsafe = entries.filter((e) => e.startsWith("/") || e.split("/").includes(".."));
  const members = [...new Set(entries.map((e) => e.replace(/^\.\//, "").split("/")[0]))];
  return { jsonFiles: entries.filter((e) => e.endsWith(".json")).length, members, unsafe };
}

/**
 * Restore `archive` under `<scratch>/runs`, each member back where a lab keeps it.
 * @param {{ archive: string, scratch: string, members: string[] }} request
 */
async function extract({ archive, scratch, members }) {
  const byBase = new Map();
  for (const member of members) {
    const base = join(scratch, "runs", dirname(MEMBER_LAYOUT[/** @type {keyof typeof MEMBER_LAYOUT} */ (member)]));
    byBase.set(base, [...(byBase.get(base) ?? []), member]);
  }
  for (const [base, names] of byBase) {
    mkdirSync(base, { recursive: true });
    await run("tar", ["-xzf", archive, "--no-same-owner", "-C", base, ...names], { maxBuffer: MAX_LISTING_BYTES });
  }
}

/**
 * Rebuild `pages/` the way a lab does (`training:generate`), into a SECOND directory, then move only the
 * pages across -- see the header for why the generator must not write over the restored manifest.
 *
 * @param {{ scratch: string, env: NodeJS.ProcessEnv }} request
 */
async function regeneratePages({ scratch, env }) {
  const generated = join(scratch, "generated");
  await run(process.execPath, [join(REPO_ROOT, "packages/lab/src/training/generate-screenreader-dataset.mjs")],
    { cwd: REPO_ROOT, env: { ...env, DATASET_ROOT: generated }, maxBuffer: MAX_GATE_OUTPUT_BYTES });
  renameSync(join(generated, "pages"), join(scratch, "runs", DATASET_DIR, "pages"));
  rmSync(generated, { recursive: true, force: true });
}

/**
 * The environment a gate reads its corpus from: every variable that can point it elsewhere is set or
 * removed, so a shell that exports `DATASET_ROOT` or `DATASET_KIND=acceptance` cannot send the gate to
 * some other tree and have the drill report on that one.
 *
 * @param {string} scratch
 * @returns {NodeJS.ProcessEnv}
 */
function scratchEnv(scratch) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, RUNS_ROOT: join(scratch, "runs"), DATASET_ROOT: join(scratch, "runs", DATASET_DIR) };
  for (const name of ["A11Y_RUNS_ROOT", "DATASET_KIND", "DATASET_CAPTURE_ROOT", "DATASET_EXPORT",
    "A11Y_DATASET_GRADE", "A11Y_RUNS_READONLY"]) delete env[name];
  return env;
}

/**
 * The REAL gate: `check-signals`, which reads every capture and its page. Its exit code is the answer, and
 * `2` (INCONCLUSIVE) is not a pass -- it is what a restore missing its pages produces.
 *
 * @param {{ env: NodeJS.ProcessEnv, requireComplete: boolean }} request
 * @returns {Promise<{ status: number, summary: string }>}
 */
async function runGate({ env, requireComplete }) {
  const args = [join(REPO_ROOT, "packages/lab/src/training/check-signals.mjs"),
    ...(requireComplete ? ["--require-complete"] : [])];
  /** @type {{ status: number, output: string }} */
  const done = await run(process.execPath, args, { cwd: REPO_ROOT, env, maxBuffer: MAX_GATE_OUTPUT_BYTES })
    .then(({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }))
    .catch((/** @type {any} */ e) => ({ status: typeof e.code === "number" ? e.code : 1,
      output: String(e.stdout ?? "") + String(e.stderr ?? "") }));
  // The verdict line, not the last line: on a non-zero exit the gate prints a hint AFTER it.
  const verdict = done.output.split("\n").find((l) => /^(PASS|FAIL|INCONCLUSIVE)\b/.test(l));
  return { status: done.status, summary: verdict ?? `(no verdict line; output ended: ${done.output.trim().slice(-TAIL_CHARS)})` };
}

/**
 * Restored against live, member by member, with the difference stated.
 * @param {{ restored: Record<string, number>, live: Record<string, number> }} counts
 */
function compareToLive({ restored, live }) {
  const total = sum(restored);
  const liveTotal = sum(live);
  /** @type {string[]} */ const failures = [];
  const lines = [`restored ${total} JSON file(s); the live corpus holds ${liveTotal}; `
    + `difference ${liveTotal - total} (${liveTotal >= total ? "live has more" : "the RESTORE has more"})`];
  for (const member of Object.keys(MEMBER_LAYOUT)) {
    lines.push(`  ${member.padEnd(MEMBER_COLUMN)} restored ${String(restored[member] ?? 0).padStart(COUNT_COLUMN)}`
      + `  live ${String(live[member] ?? 0).padStart(COUNT_COLUMN)}`);
    if ((restored[member] ?? 0) === 0 && (live[member] ?? 0) > 0) {
      failures.push(`${member} is ABSENT from the restore and the live corpus holds ${live[member]} file(s) for it `
        + "-- a member the snapshot omitted, which recency drift cannot explain");
    }
  }
  return { lines, failures };
}

/**
 * Whether the restore produced a lab -- a PURE function of what was measured, so the decision is the part
 * pinned, apart from tar and a gate (the split `releaseVerdict` makes).
 *
 * THREE QUESTIONS, and `gateVerdict` derives the verdict from how many were ANSWERED: the archive came back
 * out intact, it is complete against the live corpus, and a real gate runs off it. With no live tree the
 * second cannot be asked, so the drill is INCONCLUSIVE -- never a pass -- rather than a report of what it
 * restored, which is the defect it exists to close. A gate that answered anything but 0 is a FAILURE, not
 * a shrug: the restore was made and the gate could not use it.
 *
 * A member wholly ABSENT from the restore while the live tree holds files for it is the failure a total
 * cannot see. A restore that holds MORE than the live tree is reported, not failed: files pruned since the
 * snapshot were real when it was taken. What this cannot decide is a member restored PARTLY -- that was
 * checked against the disk at snapshot time by `corpus-snapshot.mjs`; here it is shown, per member.
 *
 * @param {{ listed: number, restored: Record<string, number>, live: Record<string, number> | null,
 *           gate: { status: number, summary: string } | null }} measured
 */
export function drillVerdict({ listed, restored, live, gate }) {
  const total = sum(restored);
  /** @type {string[]} */ const failures = [];
  /** @type {string[]} */ const lines = [];
  if (total !== listed) {
    failures.push(`the archive lists ${listed} JSON file(s) and ${total} came back out of it -- extraction lost or `
      + "invented files");
  }
  if (total === 0) failures.push("nothing was restored");
  const against = live ? compareToLive({ restored, live }) : {
    lines: [`restored ${total} JSON file(s); NO LIVE COUNT was given (--live-runs), so the difference from the live `
      + "corpus is not stated and completeness was not checked"],
    failures: [],
  };
  lines.push(...against.lines);
  failures.push(...against.failures);
  if (gate) {
    lines.push(`gate check-signals exit ${gate.status}: ${gate.summary}`);
    if (gate.status !== 0) failures.push(`the gate answered ${gate.status}, not 0 -- the restored tree is not a lab that works`);
  }
  const verdict = gateVerdict({ examined: 1 + (live ? 1 : 0) + (gate ? 1 : 0), of: QUESTIONS, failures: failures.length,
    source: "the restore, the live corpus and check-signals" });
  return { verdict, ok: verdict.verdict === "PASS", failures, lines };
}

/**
 * @param {string} scratch
 * @param {string[]} protectedRoots
 */
function refuseTarget(scratch, protectedRoots) {
  const why = targetRefusal(scratch, { protectedRoots });
  if (why) throw Object.assign(new Error(why), { usage: true });
}

/**
 * The drill: restore, rebuild pages, count, run the gate, decide.
 *
 * @param {{ archive: string, scratch: string, liveRuns?: string, requireComplete?: boolean }} request
 */
export async function restoreDrill({ archive, scratch, liveRuns, requireComplete = false }) {
  refuseTarget(scratch, [...LIVE_CORPUS_ROOTS, runsRoot(), ...(liveRuns ? [liveRuns] : [])]);
  const inspected = await inspectArchive(archive);
  if (inspected.unsafe.length) {
    throw Object.assign(new Error(`the archive holds path(s) that leave the restore tree: ${inspected.unsafe.slice(0, SAMPLE_PATHS).join(", ")}`),
      { usage: true });
  }
  const unknown = inspected.members.filter((m) => !(m in MEMBER_LAYOUT));
  if (unknown.length) {
    throw Object.assign(new Error(`the archive holds member(s) this drill does not know where to put: ${unknown.join(", ")}. `
      + "Add them to MEMBER_LAYOUT -- a member archived and never restored is the defect."), { usage: true });
  }
  mkdirSync(scratch, { recursive: true });
  await extract({ archive, scratch, members: inspected.members });
  const restored = await countMembers(join(scratch, "runs"));
  const live = liveRuns ? await countMembers(liveRuns) : null;
  const env = scratchEnv(scratch);
  await regeneratePages({ scratch, env });
  const gate = await runGate({ env, requireComplete });
  return { ...drillVerdict({ listed: inspected.jsonFiles, restored, live, gate }), scratch };
}

/** @param {string} name */
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

/** @param {string} repo @param {string} tag @param {string} into */
async function downloadRelease(repo, tag, into) {
  await run("gh", ["release", "download", tag, "--repo", repo, "--dir", into], { maxBuffer: MAX_GATE_OUTPUT_BYTES });
  const asset = readdirSync(into).find((f) => f.endsWith(".tar.gz"));
  if (!asset) throw Object.assign(new Error(`release ${tag} downloaded, but holds no .tar.gz`), { usage: true });
  return join(into, asset);
}

async function main() {
  const made = flag("scratch") ? null : mkdtempSync(join(tmpdir(), "corpus-restore-drill-"));
  const scratch = flag("scratch") ?? join(/** @type {string} */ (made), "restore");
  refuseIfRunsReadonly(scratch);
  try {
    const archive = flag("archive") ?? await downloadFrom(flag("release"), flag("repo") ?? DEFAULT_REPO, made);
    const result = await restoreDrill({ archive: resolve(archive), scratch,
      liveRuns: flag("live-runs") ? resolve(/** @type {string} */ (flag("live-runs"))) : undefined,
      requireComplete: process.argv.includes("--require-complete") });
    process.stdout.write(result.lines.join("\n") + "\n");
    if (!result.ok) {
      process.stderr.write(`DRILL ${renderVerdict(result.verdict)}\n${result.failures.map((f) => `  ${f}\n`).join("")}`
        + `LEFT IN PLACE to inspect: ${result.scratch}\n`);
      process.exit(exitCodeFor(result.verdict));
    }
    process.stdout.write("DRILL PASSED: the release restores into a tree a real gate runs off.\n");
    if (made) rmSync(made, { recursive: true, force: true });
  } catch (/** @type {any} */ error) {
    process.stderr.write(`REFUSING: ${error.message}\n`);
    process.exit(error.usage ? 2 : 1);
  }
}

/** @param {string | undefined} tag @param {string} repo @param {string | null} made */
async function downloadFrom(tag, repo, made) {
  if (!tag) throw Object.assign(new Error("--archive=<path> or --release=<tag> is required"), { usage: true });
  const into = join(made ?? tmpdir(), "download");
  mkdirSync(into, { recursive: true });
  return await downloadRelease(repo, tag, into);
}

// Guarded, because `node -e "import('./this.mjs')"` is this repo's only real check that an .mjs file still
// loads, and unguarded that check would download a release and restore it.
if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) {
  await main();
}
