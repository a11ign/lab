// Put the corpus somewhere it survives this machine, and PROVE it arrived.
//
//   A11Y_CORPUS_REMOTE=user@nas:/backups/a11y  npm run corpus:backup
//   A11Y_CORPUS_REMOTE=/mnt/pve/backup/a11y    npm run corpus:backup     # a mounted volume works too
//   npm run corpus:backup -- --verify-only                              # check the last one is readable
//
// ## Why this exists beside corpus-snapshot.mjs
//
// `corpus:snapshot` writes an archive next to the corpus and then says, honestly, that syncing it
// somewhere durable "is deliberately not automated". That was the right call while the corpus lived on
// one developer's laptop and the alternative was a tool that uploaded a user's data somewhere by
// default. It stopped being the right call the moment the corpus became the fleet's shared asset:
//
//   - 2,122 captures, measured at 3 h 46 m of fleet time to regenerate across three workers
//   - and NOT reproducible, only regenerable-as-something-else: `browserVersion` is in the capture cache
//     key precisely because Edge announces differently across releases, so evidence captured under
//     Edge 151 cannot be recreated once Edge 152 ships
//
// A snapshot beside the thing it protects defends against `rm -rf runs/` and a bad recapture. It does
// not defend against losing the machine, which is the failure that actually costs you the corpus.
//
// ## It refuses to report success having done nothing
//
// The rule this repo applies everywhere else, applied here: with no destination configured this EXITS
// NON-ZERO and says so, rather than writing a local archive and printing a cheerful line. A backup tool
// that reports success while leaving one copy on one disk is worse than no backup tool, because it
// converts a known risk into an assumed safety.
//
// ## And it verifies by reading back
//
// Copying is not arriving. The archive is listed at the destination and its size compared, over the
// channel a restore would actually use — the same reason `/health.code` is checked over HTTP rather than
// through the deploy channel. An unverified backup is a belief, not a backup.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolve, basename } from "node:path";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * `--verify-only` is the difference between checking a backup and WRITING one.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--verify-only"], { command: "npm run corpus:backup" });

const run = promisify(execFile);

const REMOTE = process.env.A11Y_CORPUS_REMOTE ?? "";
const BACKUPS = resolve(process.cwd(), process.env.A11Y_BACKUP_DIR ?? "backups");
const verifyOnly = process.argv.includes("--verify-only");

/** `user@host:/path` needs scp/ssh; a plain path is a mount and needs neither. */
const isRemotePath = (target) => /^[^/]+@[^:]+:/.test(target);

function newestArchive() {
  if (!existsSync(BACKUPS)) return null;
  const archives = readdirSync(BACKUPS)
    .filter((f) => f.startsWith("corpus-") && f.endsWith(".tar.gz"))
    .map((f) => ({ name: f, path: resolve(BACKUPS, f), mtime: statSync(resolve(BACKUPS, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return archives[0] ?? null;
}

/** The size the destination reports, read back over the channel a restore would use. */
async function sizeAtDestination(archive) {
  const name = basename(archive);
  if (isRemotePath(REMOTE)) {
    const [host, path] = [REMOTE.slice(0, REMOTE.indexOf(":")), REMOTE.slice(REMOTE.indexOf(":") + 1)];
    // `wc -c` rather than `ls -l`: it reads the file, so a truncated or unreadable copy fails here
    // rather than at restore time, which is the only moment you cannot afford to find out.
    const { stdout } = await run("ssh", [host, `wc -c < '${path}/${name}'`], { timeout: 120_000 });
    return Number(stdout.trim());
  }
  const at = resolve(REMOTE, name);
  return existsSync(at) ? statSync(at).size : null;
}

async function copyToDestination(archive) {
  const name = basename(archive);
  if (isRemotePath(REMOTE)) {
    const [host, path] = [REMOTE.slice(0, REMOTE.indexOf(":")), REMOTE.slice(REMOTE.indexOf(":") + 1)];
    await run("ssh", [host, `mkdir -p '${path}'`], { timeout: 60_000 });
    await run("scp", ["-q", archive, `${host}:${path}/${name}`], { timeout: 600_000 });
    return;
  }
  await run("mkdir", ["-p", REMOTE]);
  await run("cp", [archive, resolve(REMOTE, name)], { timeout: 600_000 });
}

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Only when RUN, never on import.
 *
 * Unguarded, importing this file printed its REFUSING banner and exited the importing process — so
 * `node -e "import('./corpus-backup.mjs')"`, the only real check this repo has that an .mjs file still
 * loads, terminated with a verdict about a backup nobody had asked for. With `A11Y_CORPUS_REMOTE` set it
 * would instead have started copying the corpus.
 */
async function main() {
  if (!REMOTE) {
    refuse(
      "REFUSING: no A11Y_CORPUS_REMOTE set, so there is nowhere durable to put the corpus.\n" +
      "\n" +
      "  A11Y_CORPUS_REMOTE=user@nas:/backups/a11y   npm run corpus:backup\n" +
      "  A11Y_CORPUS_REMOTE=/mnt/pve/backup/a11y     npm run corpus:backup\n" +
      "\n" +
      "This exits non-zero rather than writing a local archive and calling it a backup. The corpus is\n" +
      "~3h46m of fleet time and cannot be recaptured identically once the browser updates — a tool that\n" +
      "reported success while leaving one copy on one disk would turn a known risk into an assumed safety.");
  }

  const archive = newestArchive();
  if (!archive) {
    refuse(`No archive in ${BACKUPS}. Run \`npm run corpus:snapshot\` first — this copies and verifies, it\n` +
      "does not create.");
  }

  process.stdout.write(`Corpus archive : ${archive.name} (${(statSync(archive.path).size / 1048576).toFixed(1)} MB)\n`);
  process.stdout.write(`Destination    : ${REMOTE}${isRemotePath(REMOTE) ? "  (ssh)" : "  (path)"}\n\n`);

  if (!verifyOnly) {
    process.stdout.write("Copying ...\n");
    try {
      await copyToDestination(archive.path);
    } catch (error) {
      refuse(`FAILED to copy: ${error.message}\n\nThe corpus still exists in exactly one place.`);
    }
  }

  // Verify by reading the destination back, never by trusting that the copy returned 0.
  let remoteSize;
  try {
    remoteSize = await sizeAtDestination(archive.path);
  } catch (error) {
    refuse(`Copied, but could NOT read it back: ${error.message}\n\n` +
      "Treat this as a failed backup. A copy you cannot read is a copy you cannot restore.");
  }

  const localSize = statSync(archive.path).size;
  if (remoteSize === null) {
    refuse("Copied, but the archive is NOT at the destination. Treat this as a failed backup.");
  }
  if (remoteSize !== localSize) {
    refuse(`Copied, but the destination has ${remoteSize} bytes and the source has ${localSize}.\n` +
      "A truncated archive restores as a corrupt corpus, which is worse than an absent one because it\n" +
      "looks like data.");
  }

  process.stdout.write(`VERIFIED: ${remoteSize} bytes readable at the destination, matching the source.\n`);
  process.stdout.write(
    "\nThis is now in two places. It is not yet in two BUILDINGS — if the destination shares a room,\n" +
    "or a power supply, with this machine, that is one fire away from being one place again.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
