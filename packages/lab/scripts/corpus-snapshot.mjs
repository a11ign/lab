// @ts-check
// Archive the capture corpus, because it is expensive and nothing else protects it.
//
//   node scripts/corpus-snapshot.mjs [--out=dir]
//
// `runs/` is gitignored, so the 2,122 captures that `check-signals` and the corpus gate treat as ground
// truth exist in exactly one place: this disk. They are reproducible — `npm run training:capture` — but
// only at the cost of many hours of worker time, which makes them the most expensive artifact in the
// repo and the only one with no copy.
//
// This ARCHIVES; `corpus-backup.mjs` is what makes it durable. The split is deliberate: a repo that
// silently uploaded a user's data somewhere would be choosing for them, so the destination stays an
// explicit operator decision (`A11Y_CORPUS_REMOTE`) — but `corpus:backup` now REFUSES to report success
// without one, rather than leaving the gap unremarked. A snapshot on the same disk protects against
// `rm -rf runs/` and a bad recapture; it does not protect against losing the machine, which is the
// failure that actually costs you the corpus.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { datasetRoot, runsRoot } from "../src/dataset-paths.mjs";

/**
 * a mistyped `--out=` writes the snapshot somewhere you will not look for it.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--out="], { entry: import.meta.url, command: "npm run corpus:snapshot" });

const run = promisify(execFile);
const DATASET = datasetRoot();
const RUNS = runsRoot();
/** @param {string} name @param {string} fallback @returns {string} */
const flag = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const outDir = resolve(process.cwd(), flag("out", "backups"));

/** Only what cannot be regenerated cheaply: the captures and the manifest that indexes them. */
const WANTED = ["captures", "manifest.json"];

/**
 * SIBLING ROOTS THAT ARE LESS REPRODUCIBLE THAN THE DATASET, not more — which is why leaving them out was
 * backwards rather than merely incomplete.
 *
 * `WANTED` above covers `runs/screenreader-dataset`, and that corpus CAN be rebuilt: the pages are
 * generated from `case-matrix.mjs` and recaptured by the fleet. Expensive — measured 3 h 46 m for 2,122
 * captures — but a matter of time and machines. These two are not:
 *
 *   real-page-corpus       captures of OTHER PEOPLE'S WEBSITES. When w3.org edits a tutorial, the capture
 *                          of the previous version cannot be reproduced by anyone, at any cost. Measured
 *                          2026-09-06 on this disk: 26 captures, and every conformance claim about real
 *                          pages rests on them.
 *   screenreader-acceptance  the held-out set, which `DATASET_KIND=acceptance` REFUSES to cache by design
 *   board-snapshots        the tracker's state on a DATE (#566). GitHub's API answers "now" and nothing
 *                          else, so once a label moves there is no way to re-derive what was open,
 *                          claimed or on the board on a given morning -- and these files are the evidence
 *                          behind the daily board document's published numbers. Losing them does not cost
 *                          a recapture; it costs the ability to say where a figure came from.
 *                          — "those runs exist to test whether NVDA's output is still stable". 410 files.
 *                          It is the only evidence that is not the training corpus.
 *
 * Found by running the restore rather than reading the script: a snapshot of a 417 MB `runs/` extracted to
 * 4,959 of 5,445 JSON files, and the 486 missing were these. A backup nobody has extracted is not a backup,
 * and this is what that sentence was protecting against.
 */
const WANTED_SIBLINGS = ["real-page-corpus", "screenreader-acceptance", "board-snapshots"];

/**
 * Every `.json` under these roots, recursively — the number the archive has to match.
 *
 * Recursive because the corpus is not flat: `screenreader-dataset/captures/` holds the dataset captures
 * while `real-page-corpus/` and `screenreader-acceptance/` have their own layouts, and a count that only
 * saw the top level would agree with a short archive.
 *
 * @param {string} root @param {string[]} members
 */
function jsonUnder(root, members) {
  return members.reduce((total, member) => total + jsonBelow(resolve(root, member)), 0);
}

/** @param {string} root @param {string[]} members */
function bytesUnder(root, members) {
  return members.reduce((total, member) => total + bytesBelow(resolve(root, member)), 0);
}

/** One root, walked iteratively — a deep corpus must not depend on the stack depth. @param {string} start */
function jsonBelow(/** @type {string} */ start) {
  return walkBelow(start, (path) => (path.endsWith(".json") ? 1 : 0));
}

/**
 * BYTES, not just names — added 2026-09-06 because the count cannot see the failure that matters most.
 *
 * A file count answers "are all the names there". An archive holding 7,694 correctly-named EMPTY files
 * passes it perfectly, and that is the shape a truncated or mid-write archive actually takes. `ceo` asked
 * the question the count could not: *"if they do not match, the archive holds the right names with the
 * wrong contents."*
 *
 * Measured on the first real backup: 108.1 MB uncompressed from 8.5 MB compressed, 12.7x, zero empty
 * files. JSON compresses about that well, so the ratio is not itself evidence — the byte TOTAL is.
 * @param {string} start
 */
function bytesBelow(start) {
  return walkBelow(start, (path, stat) => stat.size);
}

/**
 * One iterative walk, two questions. Iterative rather than recursive because a deep corpus must not
 * depend on the stack, and shared because two walks that could disagree about which files they visit
 * would make the count and the byte total answer about different populations — this file's own subject.
 *
 * @param {string} start @param {(path: string, stat: import("node:fs").Stats) => number} score
 */
function walkBelow(start, score) {
  if (!existsSync(start)) return 0;
  let total = 0;
  const stack = [start];
  while (stack.length) {
    const here = stack.pop();
    if (!here) continue;
    const stat = statSync(here);
    if (stat.isDirectory()) stack.push(...readdirSync(here).map((e) => resolve(here, e)));
    else total += score(here, stat);
  }
  return total;
}

/**
 * Which of `names` exist under `root`, and which do not -- shared by `WANTED` (against `DATASET`) and
 * `WANTED_SIBLINGS` (against `RUNS`), so a missing member is reported the same way in both.
 * @param {string} root @param {string[]} names
 */
export function presentMissing(root, names) {
  const present = names.filter((name) => existsSync(resolve(root, name)));
  const missing = names.filter((name) => !present.includes(name));
  return { present, missing };
}

function describe() {
  const { present, missing } = presentMissing(DATASET, WANTED);
  const captures = existsSync(resolve(DATASET, "captures"))
    ? readdirSync(resolve(DATASET, "captures")).filter((f) => f.endsWith(".json")).length
    : 0;
  return { present, missing, captures };
}

/**
 * GNU TAR'S `-tzvf` LAYOUT, WHICH IS NOT `ls -l`'S. Real output from the lab's 2026-09-22 03:00Z snapshot:
 *
 *     -rw-r--r-- root/root     25860 2026-09-19 21:53 captures/image-filename-...-019.good.json
 *      perms     owner/group    SIZE   date       time  name
 *        0            1          2       3         4     5
 *
 * tar joins owner and group into ONE field and prints no link count, so there are six fields, not seven.
 * This file's comment used to claim `perms links owner group SIZE date name` and read field 4 -- the
 * TIME. `Number("21:53")` is `NaN`, one `NaN` poisons a reduce, and `NaN < onDiskBytes` is `false`, so
 * the hollow-archive refusal was unreachable from the commit that wrote it until #1936.
 */
const TAR_SIZE_FIELD = 2;

/** How many unparsable listing lines the refusal quotes: enough to recognise the shape, not a second listing. */
const SAMPLE_UNREADABLE = 3;

/** @param {string} line one `-tzvf` entry @returns {number} its size in bytes, `NaN` if that field is not one */
function entryBytes(line) {
  return Number(line.trim().split(/\s+/)[TAR_SIZE_FIELD]);
}

/**
 * What the archive says it holds, read back out of `tar -tzvf` -- the count and the byte total together,
 * from ONE parse of ONE listing, so the two numbers can never describe different sets of entries.
 *
 * `unreadable` exists because of how #1936 hid: an unparsable size became `NaN`, `NaN` propagated through
 * the sum, and every comparison against the sum was then `false` -- a guard that is off and silent. A size
 * that does not parse is now COLLECTED and refused by name rather than summed, so the total is either a
 * number the guards can compare or a refusal the operator can read. (The old `?? 0` had the same shape
 * the other way: a missing field would have counted as zero bytes and quietly shrunk the total.)
 *
 * Directories are dropped, as they always were: `tar` prints them with a size of 0 and they hold no bytes.
 *
 * @param {string} listing `tar -tzvf` stdout
 */
export function archiveTotals(listing) {
  const rows = String(listing).split("\n").filter((line) => line && !line.startsWith("d"));
  const sized = rows.map((line) => ({ line, bytes: entryBytes(line) }));
  return {
    jsonFiles: rows.filter((line) => line.endsWith(".json")).length,
    bytes: sized.filter((e) => Number.isFinite(e.bytes)).reduce((n, e) => n + e.bytes, 0),
    unreadable: sized.filter((e) => !Number.isFinite(e.bytes)).map((e) => e.line),
  };
}

/**
 * Whether the archive holds what the disk holds -- the refusal to print, or `null`.
 *
 * Three questions in the order they have to be asked, each with its OWN message so two causes never share
 * one investigation:
 *
 *   UNREADABLE first, because a total that could not be built cannot be compared. This is #1936's own
 *     shape, and asking it first is what stops a parse failure from reading as a healthy archive again.
 *   BYTES before NAMES, because a shortfall in bytes is the failure a count CANNOT see: an archive of
 *     correctly-named EMPTY files passes the count perfectly, and that is the shape a truncated or
 *     mid-write archive actually takes.
 *
 * @param {{ archive: string, archived: ReturnType<typeof archiveTotals>, onDisk: number, onDiskBytes: number }} state
 * @returns {string | null}
 */
export function archiveRefusal({ archive, archived, onDisk, onDiskBytes }) {
  if (archived.unreadable.length) {
    return `REFUSING: ${archived.unreadable.length} line(s) of the archive's own listing carry no readable `
      + `byte size, so the ${archived.bytes} byte(s) counted from the rest are not the archive's total.\n`
      + `  ${archive}\n`
      + `  the first ${Math.min(archived.unreadable.length, SAMPLE_UNREADABLE)} of them:\n  `
      + `${archived.unreadable.slice(0, SAMPLE_UNREADABLE).join("\n  ")}\n`
      + "The size is tar's THIRD column (index 2). A total with an unreadable entry in it compares FALSE\n"
      + "against everything, which is a byte check that is off rather than one that passed (#1936).\n";
  }
  if (archived.bytes < onDiskBytes) {
    return `REFUSING: the archive holds ${archived.bytes} byte(s) and ${onDiskBytes} were on disk — `
      + `${onDiskBytes - archived.bytes} did not make it in, across ${archived.jsonFiles} file(s) that ARE named.\n`
      + `  ${archive}\n`
      + "The names are right and the contents are not, which a file count cannot see. A restore from this\n"
      + "would produce a corpus of the correct shape and the wrong evidence. LEFT IN PLACE to inspect.\n";
  }
  if (archived.jsonFiles < onDisk) {
    return `REFUSING: the archive holds ${archived.jsonFiles} JSON file(s) and ${onDisk} were on disk — `
      + `${onDisk - archived.jsonFiles} did not make it in.\n`
      + `  ${archive}\n`
      + "A short archive restores as a corpus that looks complete and is not, which is worse than an\n"
      + "absent one because nothing downstream can tell. The archive is LEFT IN PLACE so it can be\n"
      + "inspected; delete it once you know why it is short.\n";
  }
  return null;
}

/**
 * The ONE call site that writes the missing-member note, shared by `WANTED` and `WANTED_SIBLINGS` -- #1798:
 * before this, `WANTED_SIBLINGS.filter(...)` dropped an absent sibling with no note at all, unlike `WANTED`,
 * so a lab-dispatched run reported success while protecting zero of `runs/board-snapshots`, silently.
 * A no-op when nothing is missing.
 * @param {string[]} missing
 */
export function noteMissing(missing) {
  if (missing.length) process.stderr.write(`note: ${missing.join(", ")} absent, archiving the rest\n`);
}

async function main() {
  const { present, missing, captures } = describe();
  if (!present.length) {
    process.stderr.write(`nothing to snapshot: no captures or manifest under ${DATASET}\n`);
    process.exit(2);
  }
  noteMissing(missing);

  // Timestamp comes from the clock at run time, and is the only thing distinguishing two snapshots, so it
  // carries seconds: two archives in one minute is a normal thing to want when a recapture is in doubt.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  mkdirSync(outDir, { recursive: true });
  const archive = resolve(outDir, `corpus-${stamp}.tar.gz`);

  const { present: siblings, missing: missingSiblings } = presentMissing(RUNS, WANTED_SIBLINGS);
  noteMissing(missingSiblings);
  process.stdout.write(`Archiving ${captures} capture(s) from ${DATASET}`
    + (siblings.length ? `, plus ${siblings.join(" and ")}\n` : "\n"));
  // Two -C flags: the dataset's members are relative to DATASET, the siblings to RUNS. tar applies each
  // -C to the paths that FOLLOW it, so this stays one archive with a flat, restorable layout rather than
  // two archives somebody has to remember to take together.
  await run("tar", ["-czf", archive, "-C", DATASET, ...present,
    ...(siblings.length ? ["-C", RUNS, ...siblings] : [])], { maxBuffer: 1 << 26 });
  const size = statSync(archive).size;

  // READ THE ARCHIVE BACK, because `tar` exiting 0 is not the archive holding the corpus.
  //
  // This file's own header records the incident: a snapshot of a 417 MB `runs/` extracted to 4,959 of
  // 5,445 JSON files, and *"found by running the restore rather than reading the script"*. `tar` had
  // succeeded. The 486 missing were two sibling roots nobody had listed, and the fix was to list them --
  // which repairs THAT omission and leaves the class wide open: any future member absent from `WANTED`,
  // any path `tar` skips with a warning, produces a short archive and a cheerful line.
  //
  // Counting on disk and counting in the archive is the same argument as verifying a deploy through
  // `/health.code` over HTTP rather than through the channel that did the deploying: a check sharing a
  // failure mode with the action verifies nothing. `tar -tzf` reads the file that was written.
  // `.stdout`, never `String(result)`. `promisify(execFile)` resolves an OBJECT, so stringifying it gives
  // "[object Object]" — zero lines ending `.json`, a count of 0, and a refusal on every healthy archive.
  // That is `normalise = String(entry)` from `evidence-diff.mjs`, which made every object compare equal
  // and reported SAME for a changed validation message. Caught here by reading `promisify`'s contract
  // rather than by running it, which is the only reason it is not in the commit.
  const { stdout: listed } = await run("tar", ["-tzvf", archive], { maxBuffer: 1 << 28 });
  const archived = archiveTotals(listed);
  const onDisk = jsonUnder(DATASET, present) + siblings.reduce((n, name) => n + jsonUnder(RUNS, [name]), 0);
  const onDiskBytes = bytesUnder(DATASET, present)
    + siblings.reduce((n, name) => n + bytesUnder(RUNS, [name]), 0);
  const refusal = archiveRefusal({ archive, archived, onDisk, onDiskBytes });
  if (refusal) {
    process.stderr.write(refusal);
    process.exit(2);
  }
  process.stdout.write(`Wrote ${archive} (${(size / (1024 * 1024)).toFixed(1)} MB)\n`);
  process.stdout.write(`Read back ${archived.jsonFiles} JSON file(s), matching the ${onDisk} on disk, `
    + `and ${(archived.bytes / (1024 * 1024)).toFixed(1)} MB uncompressed against `
    + `${(onDiskBytes / (1024 * 1024)).toFixed(1)} MB on disk.\n`);
  // THE WARNING STAYS AND THE REMEDY CHANGES -- #2050. "not yet a backup" is ACCURATE at the instant
  // this prints: on the lab the archive is written at 03:00Z and nothing has copied it anywhere until
  // the release nightly fires at 04:00Z. What was wrong is that the only route this message NAMED was
  // `corpus:backup`'s scp/mount one, which has never been configured on any machine -- so a reader
  // landing here concluded the corpus has no durable destination at all and escalated. That is #1042's
  // own incident, and this file is the third message with its defect and the one a reader is most
  // likely to meet, since the lab prints it unattended every night. A fix that instead claimed the
  // snapshot was already safe would be a false statement in a verification message, which is worse
  // than the silence: hence both halves below.
  process.stdout.write(
    "This is on the SAME DISK as the corpus, so it is not yet a backup — it defends against\n" +
    "`rm -rf runs/` and a bad recapture, not against losing the machine.\n\n" +
    "IT DOES NOT STAY THAT WAY ON THE LAB, and this is not the route to reach for first.\n" +
    "`a11ign-corpus-release-nightly.timer` fires at 04:00 UTC — an hour after the lab's own\n" +
    "03:00 UTC snapshot — fetches the newest archive from `backups/` and hands it to\n" +
    "`corpus:release`, which publishes it to GitHub Releases on `a11ign/corpus-backups`\n" +
    "(private) and verifies it by downloading the release back. That has been the corpus's\n" +
    "real off-machine copy since 2026-09-06 (#1042). Read the line above as \"no second copy\n" +
    "YET\", not as \"the corpus has nowhere durable to go\".\n\n" +
    "To publish THIS archive now rather than wait for the nightly — or to publish one taken\n" +
    "anywhere other than the lab, which the nightly does not see:\n\n" +
    `  npm run corpus:release -- --archive=${archive}\n\n` +
    "A separate, interim route copies it to an scp/mount destination you supply instead. It\n" +
    "needs one configured, and `corpus:release` above does not:\n\n" +
    "  A11Y_CORPUS_REMOTE=<user@host:/path or /mnt/...>  npm run corpus:backup\n");
}

// Guarded, because CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check that an .mjs file
// still loads — lint and tsc cannot see a ReferenceError at import — and unguarded that mandated check
// TARS UP THE WHOLE CORPUS as a side effect. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
