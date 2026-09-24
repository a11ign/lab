// writes: runs/captures
// The line above is the acceptance job's declaration, and it is narrower than it reads: this file NAMES `RUNS_ROOT`/`DATASET_ROOT`
// only to point the real script at a throwaway temp directory, so the `captures/` it writes is that fixture's and never the corpus's.
/**
 * #1936 — `corpus-snapshot.mjs` summed tar's TIME column, so `archivedBytes` was `NaN` on every run and
 * the hollow-archive refusal it feeds could never fire.
 *
 * The lab's scheduled snapshot printed `... and NaN MB uncompressed against 159.6 MB on disk.` at
 * 2026-09-22 03:00:00Z. The printed `NaN` was the cosmetic half. The half that mattered is fourteen lines
 * above it: `if (archivedBytes < onDiskBytes)` is the ONE check that can see a truncated or mid-write
 * archive — an archive of correctly-named EMPTY files passes the file COUNT perfectly — and
 * `NaN < 159600000` is `false`, so that branch had been unreachable since the commit that wrote it.
 *
 * WHY THIS FILE IS A `.test.ts` UNDER `src/packaging/` AND NOT BESIDE THE SCRIPT. `corpus-snapshot.test.mjs`
 * lives in `packages/lab/scripts/`, and every test script in this repo — `test:ts`, `test:org`, `test:all`
 * and the rstest config's own `include` — globs `.test.ts` files under `packages/<name>/src`. That file is
 * in `scripts/` and is `.mjs`, so it misses on both counts and nothing has ever run it. Writing this row's
 * positive control there would have produced a control no gate executes, which is #1936's own subject one
 * level up: a guard that exists and cannot fire.
 * `corpus-backup.test.ts` sits in this directory for the same reason (#1042).
 *
 * THE TWO END-TO-END TESTS SPAWN THE REAL SCRIPT and read its real exit code and stderr, rather than
 * asserting on its source text. That is `corpus-backup.test.ts`'s lesson from three failed verdicts on
 * #1860: a source scan proves a claim about characters in a file, never about what the run does. Here it
 * matters more than usual, because what this row fixes is precisely a guard whose source read fine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { archiveRefusal, archiveTotals } from "../../scripts/corpus-snapshot.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const SNAPSHOT_SCRIPT = resolve(REPO, "packages/lab/scripts/corpus-snapshot.mjs");

/**
 * VERBATIM `tar -tzvf` OUTPUT, not a hand-typed approximation of it — captured from a real archive of
 * three files (`tar -czf … -C <dir> captures manifest.json`) on this repo's own host, plus the lab's own
 * `root/root` owner spelling from the 2026-09-22 03:00Z run quoted in #1936.
 *
 *   -rw-rw-r-- agent/agent    1471 2026-09-19 22:53 captures/small.json
 *    perms     owner/group    SIZE   date       time name
 *      0            1          2       3         4    5
 *
 * Six fields: tar joins owner and group and prints no link count. `ls -l`'s seven-field
 * `perms links owner group SIZE date name` — which this script's comment claimed and its code read — puts
 * the size at index 4, which here is the TIME.
 */
const REAL_LISTING = [
  "drwxrwxr-x agent/agent       0 2026-09-22 18:56 captures/",
  "-rw-rw-r-- agent/agent    1471 2026-09-19 22:53 captures/small.json",
  "-rw-rw-r-- agent/agent   25860 2026-09-19 22:53 captures/image-filename-calibration-energy-park-019.good.json",
  "-rw-r--r-- root/root     25860 2026-09-19 21:53 captures/image-filename-calibration-energy-park-019.good.json",
  "-rw-rw-r-- agent/agent       2 2026-09-22 18:56 manifest.json",
].join("\n") + "\n";

/** The sum of the SIZE column above, by hand: the directory holds no bytes and is not counted. */
const REAL_LISTING_BYTES = 1471 + 25860 + 25860 + 2;

/** @returns the refusal `archiveRefusal` produces for a listing, or `null` when it is content. */
const refusalFor = (listing: string, onDisk: number, onDiskBytes: number) =>
  archiveRefusal({ archive: "/tmp/corpus-x.tar.gz", archived: archiveTotals(listing), onDisk, onDiskBytes });

test("#1936: the byte total is tar's SIZE column, read from real `-tzvf` output", () => {
  const archived = archiveTotals(REAL_LISTING);
  // The assertion the old code failed: field 4 of these lines is `22:53`, `Number("22:53")` is NaN, and
  // one NaN in the reduce made the whole total NaN. A mutation of `TAR_SIZE_FIELD` to any other column
  // fails here — index 4 and 3 give unreadable entries, index 1 (`agent/agent`) likewise, index 0 and 5
  // the same. This is done-when 4 of the row.
  assert.equal(archived.bytes, REAL_LISTING_BYTES,
    "the byte total must be the sum of tar's third column; a NaN or a shifted column shows up here first");
  assert.deepEqual(archived.unreadable, [],
    "every line of a real tar listing carries a readable size at index 2 — a non-empty `unreadable` here "
    + "means the parser is reading some other column");
  assert.equal(archived.jsonFiles, 4, "four non-directory entries end in .json");
});

test("#1936: a listing line with no readable size is collected, never summed as NaN or as zero", () => {
  // The shape that hid the defect for as long as it hid. `?? 0` (the old code's guard against a missing
  // field) is the same failure wearing the other hat: it would have counted an unparsable entry as zero
  // bytes and quietly shrunk the total instead of loudly failing.
  const listing = REAL_LISTING + "-rw-rw-r-- agent/agent   ??????? 2026-09-22 18:56 captures/torn.json\n";
  const archived = archiveTotals(listing);
  assert.equal(archived.bytes, REAL_LISTING_BYTES, "the readable lines still add up to a real number");
  assert.deepEqual(archived.unreadable,
    ["-rw-rw-r-- agent/agent   ??????? 2026-09-22 18:56 captures/torn.json"],
    "the unparsable line must be named, so the operator sees WHICH entry the total is missing");
});

test("#1936 POSITIVE CONTROL (unit): bytes short of the disk refuses, and the refusal says hollow", () => {
  const refusal = refusalFor(REAL_LISTING, 4, REAL_LISTING_BYTES + 1_000_000);
  assert.ok(refusal, "an archive holding fewer bytes than the disk must refuse — this is the dead guard");
  assert.match(refusal, /REFUSING: the archive holds 53193 byte\(s\) and 1053193 were on disk/);
  assert.match(refusal, /The names are right and the contents are not/,
    "the hollow-archive refusal, not the file-count one: two causes, two investigations");
});

test("#1936: an unreadable total refuses BEFORE it is compared against anything", () => {
  // Order matters and is the whole lesson: a total built over an unparsable line cannot be compared, so
  // asking that question first is what stops a parse failure from reading as a healthy archive. Here the
  // byte and count comparisons would both PASS (the readable lines are ample), and it must still refuse.
  const listing = REAL_LISTING + "-rw-rw-r-- agent/agent   ??????? 2026-09-22 18:56 captures/torn.json\n";
  const refusal = refusalFor(listing, 1, 1);
  assert.ok(refusal, "an archive whose listing does not parse must refuse even when the numbers compare fine");
  assert.match(refusal, /carry no readable byte size/);
});

test("#1936: an archive that holds the disk's bytes and names is content", () => {
  // The emptiness control for the three assertions above: with the same parser and a healthy state, the
  // refusal is null. Without this, a mutation making `archiveRefusal` always refuse would pass every test
  // in this file.
  assert.equal(refusalFor(REAL_LISTING, 4, REAL_LISTING_BYTES), null,
    "a complete archive must not refuse; the guards are for shortfalls, not for existing");
});

/**
 * A minimal corpus for the real script: a dataset root with `captures/` and a manifest, and an empty
 * `runs/` for the sibling roots (absent, which the script notes on stderr and archives the rest).
 */
function fixtureCorpus(): { dir: string; env: NodeJS.ProcessEnv; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "corpus-snapshot-1936-"));
  mkdirSync(join(dir, "dataset", "captures"), { recursive: true });
  mkdirSync(join(dir, "runs"), { recursive: true });
  writeFileSync(join(dir, "dataset", "captures", "a.json"), JSON.stringify({ bytes: "x".repeat(400) }));
  writeFileSync(join(dir, "dataset", "manifest.json"), JSON.stringify({ captures: 1 }));
  return {
    dir,
    out: join(dir, "backups"),
    env: { ...process.env, DATASET_ROOT: join(dir, "dataset"), RUNS_ROOT: join(dir, "runs") },
  };
}

/**
 * #2210 — A `tar` ON THE PATH THAT DROPS A FILE INTO THE CORPUS AROUND THE REAL ARCHIVE WRITE.
 *
 * The race is a file arriving DURING the run, and a run is a few seconds, so it cannot be provoked by
 * waiting; it has to be placed. The script calls `tar` through the process's PATH, so a shim ahead of the
 * real one can do exactly that, at exactly the instant that matters, and still run the real `tar` so the
 * archive, its listing and every number the guard compares are genuine. Only the `-czf` call is touched:
 * the `-tzvf` read-back passes straight through.
 *
 *   `after`   the file lands once the archive is WRITTEN. The archive cannot hold it. This is the case the
 *             old ordering (walk the disk after writing) got wrong: the walk sees the file, the archive
 *             does not, the byte total is short, and a healthy archive is refused.
 *   `before`  the file lands just before the archive is written. The archive holds it, and a disk reading
 *             taken earlier does not: the archive reads LARGER than the disk, which must never refuse.
 */
function tarThatAlsoWritesAFile(
  fixture: { dir: string; env: NodeJS.ProcessEnv },
  { when, bytes }: { when: "before" | "after"; bytes: number },
): string {
  const realTar = execFileSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).trim();
  const late = join(fixture.dir, "dataset", "captures", `arrived-${when}.json`);
  const shimDir = join(fixture.dir, "shim");
  mkdirSync(shimDir);
  const drop = `head -c ${bytes} /dev/zero | tr '\\0' 'x' > '${late}'`;
  writeFileSync(join(shimDir, "tar"), [
    "#!/bin/sh",
    `if [ "$1" = "-czf" ]; then`,
    when === "before" ? `  ${drop}` : "",
    `  '${realTar}' "$@"; status=$?`,
    when === "after" ? `  ${drop}` : "",
    "  exit $status",
    "fi",
    `exec '${realTar}' "$@"`,
  ].join("\n") + "\n", { mode: 0o755 });
  fixture.env.PATH = `${shimDir}:${process.env.PATH}`;
  return late;
}

function runSnapshot(fixture: { dir: string; env: NodeJS.ProcessEnv; out: string }) {
  try {
    const stdout = execFileSync(process.execPath, [SNAPSHOT_SCRIPT, `--out=${fixture.out}`],
      { encoding: "utf8", env: fixture.env, cwd: fixture.dir });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

test("#1936 REGRESSION: a real run reports a NUMBER of MB read back, not NaN", () => {
  // The visible symptom, end to end. `NaN MB uncompressed` is what the lab printed at 03:00Z, and it is
  // what this assertion fails on: `(NaN / (1024*1024)).toFixed(1)` is the string "NaN".
  const fixture = fixtureCorpus();
  try {
    const { code, stdout, stderr } = runSnapshot(fixture);
    assert.equal(code, 0, `a healthy corpus must snapshot cleanly; got ${code}: ${stderr}`);
    assert.doesNotMatch(stdout, /NaN/, `the read-back line reported NaN: ${stdout}`);
    assert.match(stdout, /Read back 2 JSON file\(s\), matching the 2 on disk, and 0\.0 MB uncompressed/,
      `expected a numeric MB figure read back from the archive: ${stdout}`);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("#1936 POSITIVE CONTROL (end to end): an archive short of the disk's BYTES exits 2", () => {
  // THE ASSERTION THIS ROW EXISTS FOR. Fixing the column without this leaves the guard as untested as it
  // was dead — and a guard nobody has seen fire is the thing #1936 is about.
  //
  // The shortfall is real, not simulated: `big.json` is a SYMLINK to a 5,000-byte file outside the
  // archived root. `bytesUnder` stats through the link and counts 5,000 on disk; `tar` stores the link
  // itself, which the listing reports as 0 bytes. The NAMES all arrive — the listing line ends `.json`,
  // so the file count matches exactly — which is what makes this the count-blind failure the byte guard
  // was written for, reproduced without having to truncate an archive mid-write.
  const fixture = fixtureCorpus();
  try {
    mkdirSync(join(fixture.dir, "outside"));
    const target = join(fixture.dir, "outside", "big.json");
    writeFileSync(target, JSON.stringify({ bytes: "x".repeat(4980) }));
    symlinkSync(target, join(fixture.dir, "dataset", "captures", "big.json"));

    const { code, stdout, stderr } = runSnapshot(fixture);
    assert.equal(code, 2, `expected the hollow-archive refusal to exit 2; got ${code}: ${stderr}${stdout}`);
    assert.match(stderr, /REFUSING: the archive holds \d+ byte\(s\) and \d+ were on disk/,
      `expected the BYTE refusal, not another failure: ${stderr}`);
    assert.match(stderr, /The names are right and the contents are not/);
    assert.doesNotMatch(stderr, /JSON file\(s\) and \d+ were on disk/,
      "the file-count refusal must NOT be what fired: every name arrived, and a count that can see this "
      + "shortfall would make the byte guard redundant rather than proven");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("#2210: a file that arrives AFTER the archive is written does not refuse a healthy archive", () => {
  // THE ORDERING, DRIVEN. The disk readings the guard compares against must be taken BEFORE the archive
  // is written, so anything arriving during the run can only make the archive read larger than the
  // reading, never smaller. Under the old order the walk came after `tar`, so the late file was on disk,
  // absent from the archive, and `archived.bytes < onDiskBytes` refused a healthy archive with a message
  // ("N did not make it in") that was false: the file was never meant to be in it.
  const fixture = fixtureCorpus();
  try {
    const late = tarThatAlsoWritesAFile(fixture, { when: "after", bytes: 700 });
    const { code, stdout, stderr } = runSnapshot(fixture);
    assert.ok(existsSync(late), "the shim must have placed the late file, or this test proves nothing");
    assert.equal(code, 0, `a file arriving mid-run must not refuse a healthy archive; got ${code}: ${stderr}`);
    assert.doesNotMatch(stderr, /REFUSING/);
    assert.match(stdout, /Read back 2 JSON file\(s\), matching the 2 on disk/,
      `the late file is not in the archive and was not in the reading: ${stdout}`);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("#2210: a file that arrives BEFORE the archive is written, and so is in it, does not refuse", () => {
  // The other direction of the same argument, and the one that is true under EITHER order: the archive
  // then holds more than the disk reading did. Kept so a future "fix" that makes the guard an EQUALITY
  // (archive bytes must equal the reading) fails here rather than on the lab at 03:00Z.
  const fixture = fixtureCorpus();
  try {
    const late = tarThatAlsoWritesAFile(fixture, { when: "before", bytes: 700 });
    const { code, stdout, stderr } = runSnapshot(fixture);
    assert.ok(existsSync(late), "the shim must have placed the late file, or this test proves nothing");
    assert.equal(code, 0, `an archive larger than the disk reading is healthy; got ${code}: ${stderr}`);
    assert.doesNotMatch(stderr, /REFUSING/);
    assert.match(stdout, /Read back 3 JSON file\(s\), matching the 2 on disk/,
      `the archive holds the late file and the reading did not: ${stdout}`);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("#2210 POSITIVE CONTROL: moving the reading earlier did not remove the refusal — a short archive still exits 2", () => {
  // Item 3 of the row, re-asserted rather than assumed. Reordering removes a false refusal, and "removes
  // a false refusal by removing the refusal" is the failure that would look identical in a green run.
  // The shortfall is the symlink from #1936's control, which is on disk BEFORE the reading, so it is in
  // the reading and not in the archive under the new order too. The shim is on the path AND drops a late
  // file, so this also proves the harness above does not itself mask the guard.
  const fixture = fixtureCorpus();
  try {
    mkdirSync(join(fixture.dir, "outside"));
    const target = join(fixture.dir, "outside", "big.json");
    writeFileSync(target, JSON.stringify({ bytes: "x".repeat(4980) }));
    symlinkSync(target, join(fixture.dir, "dataset", "captures", "big.json"));
    tarThatAlsoWritesAFile(fixture, { when: "after", bytes: 700 });

    const { code, stdout, stderr } = runSnapshot(fixture);
    assert.equal(code, 2, `a genuinely short archive must still exit 2; got ${code}: ${stderr}${stdout}`);
    assert.match(stderr, /REFUSING: the archive holds \d+ byte\(s\) and \d+ were on disk/);
    assert.match(stderr, /The names are right and the contents are not/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
