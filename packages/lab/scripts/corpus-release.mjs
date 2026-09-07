// @ts-check
// Put a corpus snapshot somewhere it survives this site, and PROVE it by downloading it back.
//
//   npm run corpus:release -- --archive=backups/corpus-2026-09-06_18-15-48.tar.gz
//   npm run corpus:release -- --archive=<path> --dry-run     # say what it would do, upload nothing
//   npm run corpus:release -- --verify=corpus-2026-09-06     # check an EXISTING release still restores
//
// ## Why a GitHub release and not `rsync`
//
// `corpus-backup.mjs` copies to `user@host:/path` or a mounted volume. Both survive losing the lab; only
// an offsite copy survives losing the site, and the owner's answer to "where" was their own private repo.
//
// ## The transport is TWO HOPS on purpose, and the reason is credentials
//
//   lab            `corpus:snapshot`  archives, and verifies its own archive against the on-disk count
//   control plane  `lab:fetch -e artifact=corpus-archive`   brings it here
//   control plane  this script        uploads, then downloads it back and counts what is inside
//
// The lab is the machine the corpus lives on. A GitHub token there is a credential sitting next to the
// thing it protects, and the whole point of an offsite backup is that losing that machine is survivable.
// So the token stays on the control plane, which already has one, and the archive travels instead.
//
// ## It verifies by DOWNLOADING, not by trusting the upload
//
// `gh release upload` exiting 0 means the API accepted the bytes. That is not the same as the asset being
// there, complete, and readable a month from now, which is the only property a backup has. So this
// downloads the asset back over the public API — the channel a restore would actually use — lists it with
// `tar -tzf`, and compares the JSON count against the number the archive was built with.
//
// This is the same argument as checking `/health.code` over HTTP rather than through the deploy channel,
// and the same one `corpus-snapshot.mjs` makes about `tar` exiting 0. A verification sharing a failure
// mode with the action verifies nothing.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolve, basename, join } from "node:path";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

const run = promisify(execFile);

/**
 * `--dry-run` is the difference between describing an upload and performing one, and an unrecognised flag
 * is otherwise IGNORED — so a typo'd `--dryrun` would upload the corpus while the operator believed it was
 * rehearsing. That asymmetry is why this guard is here rather than merely nice to have.
 */
refuseUnknownFlags(["--archive=", "--dry-run", "--verify=", "--repo="],
  { entry: import.meta.url, command: "npm run corpus:release" });

/** @param {string} name @param {string} [fallback] */
const flag = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

/** Where the backups live. A NAME from the caller, never a default that could surprise. */
export const DEFAULT_REPO = "a11ign/corpus-backups";

/**
 * The release tag for an archive, derived from its own filename rather than from the clock.
 *
 * FROM THE FILE, because the archive may have been made hours before it is uploaded — the snapshot runs on
 * the lab and the upload runs here, and a tag from `Date.now()` would name the moment of transport rather
 * than the moment of the corpus. A backup's identity is when the EVIDENCE was, not when it moved.
 *
 * @param {string} archivePath
 */
export function tagFor(archivePath) {
  const name = basename(archivePath);
  const stamp = name.match(/^corpus-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.tar\.gz$/)?.[1];
  return stamp ? `corpus-${stamp}` : null;
}

/**
 * Did the asset we downloaded hold what the archive held?
 *
 * Split out from the I/O so the comparison is testable without a network or a `gh` binary — the same
 * split `focusRevealVerdict` and `deployedToNothing` use, and for the same reason: the decision is the
 * part worth pinning.
 *
 * A LOWER count is a truncated or partial asset and is a failed backup. A HIGHER count cannot happen from
 * the same archive and means the tag names a DIFFERENT snapshot, which is worse than a shortfall because
 * it restores cleanly as the wrong corpus.
 *
 * @param {{ expected: number, found: number, tag: string }} counts
 */
export function releaseVerdict({ expected, found, tag }) {
  if (found === expected) return { ok: true, why: `${found} JSON file(s), matching the archive` };
  if (found < expected) {
    return { ok: false, why: `the asset at ${tag} holds ${found} JSON file(s) and the archive held `
      + `${expected} — ${expected - found} did not survive the round trip. A truncated asset restores as a `
      + "corpus that looks complete and is not." };
  }
  return { ok: false, why: `the asset at ${tag} holds ${found} JSON file(s) and the archive held `
    + `${expected}. MORE, not fewer — this tag names a different snapshot, which restores cleanly as the `
    + "wrong corpus and is the harder failure to notice." };
}

/** `.json` entries inside a gzipped tar, from its listing. */
export function jsonEntries(/** @type {unknown} */ listing) {
  return String(listing).split("\n").filter((line) => line.endsWith(".json")).length;
}

async function listArchive(/** @type {string} */ path) {
  const { stdout } = await run("tar", ["-tzf", path], { maxBuffer: 1 << 28 });
  return jsonEntries(stdout);
}

async function main() {
  const repo = flag("repo", DEFAULT_REPO) ?? DEFAULT_REPO;
  const verifyTag = flag("verify");
  if (verifyTag) return await verifyExisting(repo, verifyTag);

  const archive = flag("archive");
  if (!archive) {
    process.stderr.write(
      "REFUSING: --archive=<path> is required.\n"
      + "  npm run lab:job -- -e job=corpus-snapshot          # make one, on the lab\n"
      + "  npm run lab:fetch -- -e artifact=corpus-archive    # bring it here\n"
      + "  npm run corpus:release -- --archive=runs/fetched/<name>.tar.gz\n");
    process.exit(2);
  }
  const path = resolve(process.cwd(), archive);
  if (!existsSync(path)) { process.stderr.write(`REFUSING: no archive at ${path}\n`); process.exit(2); }

  const tag = tagFor(path);
  if (!tag) {
    process.stderr.write(
      `REFUSING: ${basename(path)} is not a corpus snapshot name.\n`
      + "Expected corpus-<YYYY-MM-DD_HH-MM-SS>.tar.gz, which is what `corpus:snapshot` writes. The tag is\n"
      + "derived from the filename so it names when the EVIDENCE was, not when it was uploaded.\n");
    process.exit(2);
  }

  const expected = await listArchive(path);
  const size = statSync(path).size;
  process.stdout.write(`${basename(path)} — ${expected} JSON file(s), `
    + `${(size / (1024 * 1024)).toFixed(1)} MB\n  -> ${repo} release ${tag}\n`);

  if (process.argv.includes("--dry-run")) {
    process.stdout.write("--dry-run: nothing uploaded.\n");
    process.exit(0);
  }

  await run("gh", ["release", "create", tag, path, "--repo", repo, "--notes",
    `Corpus snapshot: ${expected} JSON file(s), ${(size / (1024 * 1024)).toFixed(1)} MB.`])
    .catch(async (/** @type {any} */ e) => {
      // A tag that already exists is not a failure to report as one -- it is a re-upload of the same
      // snapshot, which is what a retried backup looks like. Anything else is rethrown untouched.
      if (!/already exists/i.test(String(e?.stderr ?? e))) throw e;
      process.stdout.write(`release ${tag} exists; uploading the asset into it\n`);
      await run("gh", ["release", "upload", tag, path, "--repo", repo, "--clobber"]);
    });

  await verifyExisting(repo, tag, expected);
}

/** @param {string} repo @param {string} tag @param {number} [expected] */
async function verifyExisting(repo, tag, expected) {
  const dir = mkdtempSync(join(tmpdir(), "corpus-verify-"));
  await run("gh", ["release", "download", tag, "--repo", repo, "--dir", dir], { maxBuffer: 1 << 26 });
  const downloaded = join(dir, `${tag.replace(/^corpus-/, "corpus-")}.tar.gz`);
  const asset = existsSync(downloaded) ? downloaded : join(dir, `${tag}.tar.gz`);
  if (!existsSync(asset)) {
    process.stderr.write(`REFUSING: release ${tag} downloaded, but no archive in it at ${dir}\n`);
    process.exit(1);
  }
  const found = await listArchive(asset);
  // With no `expected` this is a standalone verify, so the archive's own count is all there is to compare
  // against -- report it rather than inventing a threshold.
  if (expected === undefined) {
    process.stdout.write(`release ${tag} downloads and lists: ${found} JSON file(s).\n`);
    process.exit(0);
  }
  const verdict = releaseVerdict({ expected, found, tag });
  if (!verdict.ok) { process.stderr.write(`REFUSING: ${verdict.why}\n`); process.exit(1); }
  const { stdout: url } = await run("gh", ["release", "view", tag, "--repo", repo, "--json", "url",
    "--jq", ".url"]);
  process.stdout.write(`Verified by download: ${verdict.why}\n${String(url).trim()}\n`);
}

// Guarded, because `node -e "import('./this.mjs')"` is this repo's only real check that an .mjs file still
// loads -- and unguarded, that mandated check would UPLOAD THE CORPUS as a side effect.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
