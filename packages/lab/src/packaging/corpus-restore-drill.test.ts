/**
 * #2051 — a release is verified by REBUILDING a lab from it and running a real gate, not by counting a tarball.
 *
 * EVERY ARCHIVE HERE IS MADE BY THE REAL `corpus-snapshot.mjs`, run against a fixture `runs/` tree, and never
 * by hand. A hand-built archive would agree with the drill's idea of the layout by construction; the real
 * writer is the only thing that can disagree with it. The gate is the real `check-signals` over pages the real
 * generator wrote, so nothing here reads `runs/`, downloads a release or touches the fleet.
 *
 * THE FIXTURE CASES ARE REAL ONES (`structure-empty` and `missing-heading` signals), because `check-signals`
 * has a floor of `MIN_EXAMINED` cases below which it answers INCONCLUSIVE, and a green drill needs a corpus
 * that clears it. Their captures are the smallest evidence those two signals read: the bad capture lacks the
 * structure the signal names, the good one has it.
 *
 * POSITIVE CONTROLS, so no emptiness below is unowned: the truncated archive (a directory removed) must FAIL
 * by naming that directory; the hollow archive (every name and count right, every transcript empty) must
 * FAIL through the gate alone, which is what a drill that only counted files could not see. The mutation the
 * row names -- replace the gate with `true` -- is caught by the hollow-archive test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASES } from "../training/case-matrix.mjs";
import { hashPageDir } from "../training/capture-cache.mjs";
import { captureFilePath } from "../capture/evidence-diff.mjs";
import { REPO_ROOT } from "../dataset-paths.mjs";
import {
  MEMBER_LAYOUT, countJson, drillVerdict, restoreDrill, targetRefusal,
} from "./corpus-restore-drill.mjs";

const SNAPSHOT = resolve(REPO_ROOT, "packages/lab/scripts/corpus-snapshot.mjs");
const GENERATE = resolve(REPO_ROOT, "packages/lab/src/training/generate-screenreader-dataset.mjs");
const DRILL = resolve(REPO_ROOT, "packages/lab/src/packaging/corpus-restore-drill.mjs");

/** More than `MIN_EXAMINED` (25) in `check-signals.mjs`, so a healthy restore is a PASS and not INCONCLUSIVE. */
const FIXTURE_CASES = 30;

/** The environment a script sees when nothing points it at another corpus. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const name of ["RUNS_ROOT", "A11Y_RUNS_ROOT", "DATASET_ROOT", "DATASET_KIND", "DATASET_CAPTURE_ROOT",
    "A11Y_DATASET_GRADE", "A11Y_RUNS_READONLY"]) if (!(name in extra)) delete env[name];
  return env;
}

const scratchDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `restore-drill-${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

/** Pages exactly as a lab generates them, plus the manifest -- built ONCE, because the generator is real. */
const GENERATED = tmp("generated");
execFileSync(process.execPath, [GENERATE], { cwd: REPO_ROOT, env: cleanEnv({ DATASET_ROOT: GENERATED }) });

type Signal = { type: string; field?: string; text?: string };

/** The smallest good/bad structure the signal reads: the bad capture lacks what the signal names. */
function structures(signal: Signal): { good: object; bad: object } {
  const key = signal.type === "structure-empty" ? (signal.field as string) : "headings";
  const value = signal.type === "structure-empty" ? ["present"] : [signal.text as string];
  return { good: { [key]: value }, bad: { [key]: [] } };
}

const FIXTURE_IDS = CASES
  .filter((c: { badSignal: Signal }) => ["structure-empty", "missing-heading"].includes(c.badSignal.type))
  .slice(0, FIXTURE_CASES);

/**
 * A `runs/` tree with a dataset (real manifest, captures for FIXTURE_CASES cases) and the three sibling roots.
 * `hollow` empties every transcript: names, counts and bytes-of-JSON stay, and `isUsableCapture` says no.
 */
function fixtureRuns(options: { hollow?: boolean } = {}): string {
  const runs = join(tmp("runs"), "runs");
  const dataset = join(runs, "screenreader-dataset");
  mkdirSync(join(dataset, "captures"), { recursive: true });
  cpSync(join(GENERATED, "manifest.json"), join(dataset, "manifest.json"));
  for (const { id, badSignal } of FIXTURE_IDS as { id: string; badSignal: Signal }[]) {
    const pageHash = hashPageDir(join(GENERATED, "pages", id));
    const { good, bad } = structures(badSignal);
    for (const [variant, structure] of [["good", good], ["bad", bad]] as const) {
      writeFileSync(captureFilePath(join(dataset, "captures"), id, variant), JSON.stringify({
        screenReader: "NVDA", transcript: options.hollow ? [] : [`${variant} reading`], structure,
        provenance: { pageHash },
      }));
    }
  }
  for (const sibling of ["real-page-corpus", "screenreader-acceptance", "board-snapshots"]) {
    mkdirSync(join(runs, sibling), { recursive: true });
    writeFileSync(join(runs, sibling, "one.json"), "{}");
    writeFileSync(join(runs, sibling, "two.json"), "{}");
  }
  return runs;
}

/** An archive of `runs`, made by the real `corpus-snapshot.mjs`. */
function snapshotOf(runs: string): string {
  const out = tmp("archive");
  execFileSync(process.execPath, [SNAPSHOT, `--out=${out}`], { cwd: REPO_ROOT, env: cleanEnv({ RUNS_ROOT: runs }) });
  return join(out, readdirSync(out).find((f) => f.endsWith(".tar.gz")) as string);
}

/** The live lab, later than the snapshot: the same corpus plus files written since. */
function liveAfterSnapshot(runs: string): string {
  const live = tmp("live");
  cpSync(runs, join(live, "runs"), { recursive: true });
  writeFileSync(join(live, "runs", "board-snapshots", "later.json"), "{}");
  writeFileSync(join(live, "runs", "real-page-corpus", "later.json"), "{}");
  return join(live, "runs");
}

test.after(() => { for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true }); });

test("a release restores into a tree a real gate runs off, and the report states restored, live and the difference", async () => {
  const runs = fixtureRuns();
  const live = liveAfterSnapshot(runs);
  const result = await restoreDrill({ archive: snapshotOf(runs), scratch: join(tmp("target"), "restore"), liveRuns: live });
  assert.deepEqual(result.failures, [], result.lines.join("\n"));
  assert.equal(result.ok, true);
  const report = result.lines.join("\n");
  assert.match(report, /restored 67 JSON file\(s\); the live corpus holds 69; difference 2 \(live has more\)/,
    "60 captures + the manifest + six sibling files restored = 67; live holds two more, and the report says so");
  assert.match(report, new RegExp(`gate check-signals exit 0: .*PASS — all ${FIXTURE_CASES} case\\(s\\)`),
    "the verdict of the gate is in the report, not just its exit code");
});

test("the restored tree reads as every case STALE without the regenerated pages -- why this is a rebuild, not a restore", () => {
  // The finding that shaped the drill, held as a control: extracted alone, the archive gives a gate that
  // cannot examine a single case. If this ever stops being true the regeneration step is dead weight.
  const runs = fixtureRuns();
  const dataset = join(tmp("bare"), "runs", "screenreader-dataset");
  mkdirSync(dataset, { recursive: true });
  execFileSync("tar", ["-xzf", snapshotOf(runs), "-C", dataset, "captures", "manifest.json"]);
  const ran = spawnSync(process.execPath, [resolve(REPO_ROOT, "packages/lab/src/training/check-signals.mjs")],
    { cwd: REPO_ROOT, encoding: "utf8", env: cleanEnv({ DATASET_ROOT: dataset }) });
  assert.equal(ran.status, 2, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /INCONCLUSIVE/);
  assert.match(ran.stdout, new RegExp(`${CASES.length} stale|${FIXTURE_CASES} stale`));
});

test("POSITIVE CONTROL: an archive with one directory removed FAILS, naming the directory", async () => {
  const runs = fixtureRuns();
  const live = liveAfterSnapshot(runs);
  const truncated = tmp("truncated");
  cpSync(runs, join(truncated, "runs"), { recursive: true });
  rmSync(join(truncated, "runs", "board-snapshots"), { recursive: true });
  const result = await restoreDrill({ archive: snapshotOf(join(truncated, "runs")), scratch: join(tmp("target"), "restore"), liveRuns: live });
  assert.equal(result.ok, false, "a snapshot that omitted a whole directory must not verify green");
  assert.match(result.failures.join("\n"), /board-snapshots is ABSENT from the restore and the live corpus holds 3 file\(s\)/);
});

test("POSITIVE CONTROL: an archive with the right names and counts and no readable evidence FAILS THROUGH THE GATE", async () => {
  // The row's mutation -- replace the gate run with `true` -- turns this red: every count below still agrees.
  const hollow = fixtureRuns({ hollow: true });
  const live = liveAfterSnapshot(hollow);
  const result = await restoreDrill({ archive: snapshotOf(hollow), scratch: join(tmp("target"), "restore"), liveRuns: live });
  assert.equal(result.ok, false, "a corpus of correctly named empty captures is not a working lab");
  const report = result.lines.join("\n");
  assert.match(report, /restored 67 JSON file\(s\)/, "the counts were right, which is why counting cannot catch this");
  assert.match(result.failures.join("\n"), /the gate answered 2, not 0/);
  assert.match(result.failures.join("\n") + report, /INCONCLUSIVE/);
});

test("`find -L`: a live corpus reached through a trailing symlink is counted, not read as zero", async () => {
  const real = tmp("real");
  mkdirSync(join(real, "board-snapshots"), { recursive: true });
  writeFileSync(join(real, "board-snapshots", "a.json"), "{}");
  writeFileSync(join(real, "board-snapshots", "b.json"), "{}");
  const link = join(tmp("link"), "runs");
  symlinkSync(real, link);
  // The fixture reproduces the trap: without -L, find does not descend the symlink it is handed.
  const plain = execFileSync("find", [link, "-name", "*.json"], { encoding: "utf8" });
  assert.equal(plain.trim(), "", "the trap is real here: plain find answers nothing for the symlinked tree");
  assert.equal(await countJson(link), 2, "the drill's count descends it");
});

test("the restore target can never be the live corpus, its symlink, this checkout's runs/ or the tree compared against", async () => {
  const real = tmp("srv");
  const link = join(tmp("opt"), "runs");
  symlinkSync(real, link);
  const protectedRoots = [real, link];
  assert.match(targetRefusal(real, { protectedRoots }) ?? "", /the live corpus/);
  assert.match(targetRefusal(join(real, "inside", "deeper"), { protectedRoots }) ?? "", /the live corpus/);
  assert.match(targetRefusal(link, { protectedRoots: [real] }) ?? "", /the live corpus/,
    "the symlink resolves into the real root: refusing only the real path would let it through");
  assert.equal(targetRefusal(join(tmp("elsewhere"), "restore"), { protectedRoots }), null, "control: a scratch dir is accepted");
  const occupied = tmp("occupied");
  writeFileSync(join(occupied, "x"), "");
  assert.match(targetRefusal(occupied, { protectedRoots }) ?? "", /not empty/);

  const runs = fixtureRuns();
  const archive = snapshotOf(runs);
  const live = liveAfterSnapshot(runs);
  await assert.rejects(restoreDrill({ archive, scratch: join(live, "restore"), liveRuns: live }), /the live corpus/);
});

test("the CLI exits 2 when the target is refused or nothing was compared against, and 1 when the drill fails", () => {
  const runs = fixtureRuns();
  const archive = snapshotOf(runs);
  const live = liveAfterSnapshot(runs);
  const refused = spawnSync(process.execPath, [DRILL, `--archive=${archive}`, `--live-runs=${live}`,
    `--scratch=${join(live, "restore")}`], { cwd: REPO_ROOT, encoding: "utf8", env: cleanEnv() });
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /REFUSING: .*the live corpus/);
  assert.equal(readdirSync(live).includes("restore"), false, "a refused target was not created");

  const noLive = spawnSync(process.execPath, [DRILL, `--archive=${archive}`], { cwd: REPO_ROOT, encoding: "utf8", env: cleanEnv() });
  assert.equal(noLive.status, 2, noLive.stderr);
  assert.match(noLive.stdout, /NO LIVE COUNT was given/);
  assert.match(noLive.stderr, /INCONCLUSIVE/, "with nothing to compare against the drill is not a pass, and says it could not tell");

  const hollow = fixtureRuns({ hollow: true });
  const failed = spawnSync(process.execPath, [DRILL, `--archive=${snapshotOf(hollow)}`, `--live-runs=${liveAfterSnapshot(hollow)}`],
    { cwd: REPO_ROOT, encoding: "utf8", env: cleanEnv() });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /DRILL FAIL/);

  const passed = spawnSync(process.execPath, [DRILL, `--archive=${archive}`, `--live-runs=${live}`],
    { cwd: REPO_ROOT, encoding: "utf8", env: cleanEnv() });
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /DRILL PASSED/);
});

test("an archive holding a member the drill has no place for is refused, not half restored", async () => {
  const runs = fixtureRuns();
  mkdirSync(join(runs, "newly-archived"), { recursive: true });
  writeFileSync(join(runs, "newly-archived", "x.json"), "{}");
  const out = tmp("odd");
  execFileSync("tar", ["-czf", join(out, "corpus-2026-01-01_00-00-00.tar.gz"), "-C", join(runs, "screenreader-dataset"),
    "captures", "manifest.json", "-C", runs, "newly-archived"]);
  await assert.rejects(restoreDrill({ archive: join(out, "corpus-2026-01-01_00-00-00.tar.gz"),
    scratch: join(tmp("target"), "restore"), liveRuns: runs }), /does not know where to put: newly-archived/);
});

test("MEMBER_LAYOUT names exactly the members corpus-snapshot.mjs archives", () => {
  const source = readFileSync(SNAPSHOT, "utf8");
  const listOf = (name: string) => {
    const literal = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1];
    assert.ok(literal, `${name} is no longer a literal array in corpus-snapshot.mjs; this pin must follow it`);
    return [...literal.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  const archived = [...listOf("WANTED"), ...listOf("WANTED_SIBLINGS")];
  assert.ok(archived.includes("captures"), "control: the scan found the members it is pinning");
  assert.deepEqual(Object.keys(MEMBER_LAYOUT).sort(), archived.sort());
});

test("drillVerdict: no live count is INCONCLUSIVE, and a restore holding MORE than live is reported, not failed", () => {
  const restored = { "captures": 5, "manifest.json": 1, "real-page-corpus": 1, "screenreader-acceptance": 1, "board-snapshots": 1 };
  const gate = { status: 0, summary: "PASS" };
  const noLive = drillVerdict({ listed: 9, restored, live: null, gate });
  assert.equal(noLive.ok, false);
  assert.equal(noLive.verdict.verdict, "INCONCLUSIVE", "asked 2 of 3 questions: could not tell, which is not a pass");
  assert.deepEqual(noLive.failures, []);
  assert.equal(drillVerdict({ listed: 9, restored, live: restored, gate }).verdict.verdict, "PASS", "control: 3 of 3, clean");
  const fewerLive = drillVerdict({ listed: 9, restored, live: { ...restored, captures: 4 }, gate });
  assert.equal(fewerLive.ok, true);
  assert.match(fewerLive.lines[0], /the RESTORE has more/);
  assert.equal(drillVerdict({ listed: 10, restored, live: restored, gate }).ok, false, "control: a listing/extraction mismatch fails");
});
