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
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
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
 *                          — "those runs exist to test whether NVDA's output is still stable". 410 files.
 *                          It is the only evidence that is not the training corpus.
 *
 * Found by running the restore rather than reading the script: a snapshot of a 417 MB `runs/` extracted to
 * 4,959 of 5,445 JSON files, and the 486 missing were these. A backup nobody has extracted is not a backup,
 * and this is what that sentence was protecting against.
 */
const WANTED_SIBLINGS = ["real-page-corpus", "screenreader-acceptance"];

function describe() {
  const present = WANTED.filter((name) => existsSync(resolve(DATASET, name)));
  const missing = WANTED.filter((name) => !present.includes(name));
  const captures = existsSync(resolve(DATASET, "captures"))
    ? readdirSync(resolve(DATASET, "captures")).filter((f) => f.endsWith(".json")).length
    : 0;
  return { present, missing, captures };
}

async function main() {
  const { present, missing, captures } = describe();
  if (!present.length) {
    process.stderr.write(`nothing to snapshot: no captures or manifest under ${DATASET}\n`);
    process.exit(2);
  }
  if (missing.length) process.stderr.write(`note: ${missing.join(", ")} absent, archiving the rest\n`);

  // Timestamp comes from the clock at run time, and is the only thing distinguishing two snapshots, so it
  // carries seconds: two archives in one minute is a normal thing to want when a recapture is in doubt.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  mkdirSync(outDir, { recursive: true });
  const archive = resolve(outDir, `corpus-${stamp}.tar.gz`);

  const siblings = WANTED_SIBLINGS.filter((name) => existsSync(resolve(RUNS, name)));
  process.stdout.write(`Archiving ${captures} capture(s) from ${DATASET}`
    + (siblings.length ? `, plus ${siblings.join(" and ")}\n` : "\n"));
  // Two -C flags: the dataset's members are relative to DATASET, the siblings to RUNS. tar applies each
  // -C to the paths that FOLLOW it, so this stays one archive with a flat, restorable layout rather than
  // two archives somebody has to remember to take together.
  await run("tar", ["-czf", archive, "-C", DATASET, ...present,
    ...(siblings.length ? ["-C", RUNS, ...siblings] : [])], { maxBuffer: 1 << 26 });
  const size = statSync(archive).size;
  process.stdout.write(`Wrote ${archive} (${(size / (1024 * 1024)).toFixed(1)} MB)\n`);
  process.stdout.write(
    "This is on the SAME DISK as the corpus, so it is not yet a backup — it defends against\n" +
    "`rm -rf runs/` and a bad recapture, not against losing the machine.\n\n" +
    "  A11Y_CORPUS_REMOTE=<user@host:/path or /mnt/...>  npm run corpus:backup\n\n" +
    "which copies it somewhere durable and VERIFIES it arrived by reading it back.\n");
}

// Guarded, because CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check that an .mjs file
// still loads — lint and tsc cannot see a ReferenceError at import — and unguarded that mandated check
// TARS UP THE WHOLE CORPUS as a side effect. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
