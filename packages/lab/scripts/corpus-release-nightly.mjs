// @ts-check
// Fetch the lab's newest corpus snapshot and release it, on a clock -- #1042 item 3.
//
//   node packages/lab/scripts/corpus-release-nightly.mjs
//
// `a11y-corpus-snapshot.timer` (on the LAB) fires daily and produces an archive nobody publishes.
// `corpus:release` (on the CONTROL PLANE, where the GitHub token lives -- see corpus-release.mjs's own
// "why a GitHub release" note) already does the upload-and-verify. The gap this script closes is the step
// between them: bringing the archive over and giving it back the name `corpus:release` needs to derive a
// tag from.
//
// ## The name has to be RECOVERED, not assumed
//
// `lab:fetch -e artifact=corpus-archive` matches `backups/corpus-*.tar.gz` on the lab -- necessarily a
// glob, since the real name carries the snapshot's own timestamp -- and writes the result to a FIXED local
// path, `runs/fetched/candidate.corpus-archive.<ext>` (see `lab-job.yml`'s "Name it after what it actually
// is": named for the ARTIFACT, not the source, so two fetches of different things cannot collide). That is
// right for every other artifact `lab:fetch` knows, and wrong for exactly this one: `corpus-release.mjs`
// derives its release tag from the ARCHIVE'S OWN FILENAME (`tagFor`), so a flattened `candidate.*` name
// would tag every release "candidate" and make `--verify=<tag>` unable to name a snapshot at all.
//
// `lab-fetch.yml`'s own "Where it landed" debug step already prints the real source path -- "from
// backups/corpus-2026-09-21_03-00-00.tar.gz on the lab" -- because #1042's sibling incident (three round
// trips over a flattened `promoted-changeset` name) is the same defect one artifact over: a tool that
// withholds a name it already computed gets improvised around. This script reads that line back rather
// than re-deriving it, and restores the identity by copying the fetched bytes under the real basename
// before handing the path to `corpus:release`.
//
// ## Re-running this is not a second backup
//
// `corpus-release.mjs --archive=` already treats an existing tag as a re-upload (`gh release create`
// failing "already exists" falls through to `gh release upload --clobber`) and always ends by verifying
// the download. So firing this nightly against an unchanged snapshot is a no-op with a fresh verification,
// not a duplicate -- there is deliberately no separate "is this new" check here to skip.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, realpathSync, unlinkSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { npmCliInvocation } from "../../../scripts/npm-cli-executable.mjs";

const run = promisify(execFile);

// Takes no flags -- refuses anything passed rather than silently ignoring it, the same guard every other
// command line in this repo carries.
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run corpus:release-nightly" });

/**
 * The one thing worth pinning without a network or an `ansible` binary: which source name a fetch's own
 * printed output named, if any.
 *
 * @param {string} fetchOutput
 * @returns {string | null}
 */
export function sourceBasenameFromFetchOutput(fetchOutput) {
  const match = String(fetchOutput).match(/from (\S+) on the lab/);
  return match ? basename(match[1]) : null;
}

/**
 * Where `lab-fetch.yml` actually wrote the bytes, for a source of this basename -- `candidate.<artifact>`
 * plus the source's OWN last extension, because Ansible's `splitext` (like Python's) only ever strips one:
 * `corpus-2026-09-21_03-00-00.tar.gz` yields `.gz`, not `.tar.gz`. Kept as one small function so the
 * relationship to `lab-fetch.yml`'s naming task is stated once rather than assumed at each call site.
 *
 * @param {string} sourceBasename
 */
export function flattenedFetchPath(sourceBasename) {
  return resolve("runs", "fetched", `candidate.corpus-archive${extname(sourceBasename)}`);
}

/**
 * The refusal for a firing with no `A11Y_PVE_KEY`, or null when it is set. #1911: the unit failed every
 * firing because this variable (and `A11Y_CONTROL_HOST_FILE`) were exported only by `~/.zshenv`, which a
 * systemd unit never reads -- and Ansible's own complaint went to stdout, so the journal never said so.
 * Checked HERE rather than left to Ansible so the refusal names the file the unit does read.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function missingFleetEnvRefusal(env) {
  if (env.A11Y_PVE_KEY) return null;
  return "REFUSING: A11Y_PVE_KEY is not set, so lab:fetch cannot reach the lab -- nothing to release.\n"
    + "Under systemd it comes from ~/.config/a11ign/fleet.env (the unit's EnvironmentFile=), never from "
    + "~/.zshenv: a unit reads no shell startup file. Put A11Y_PVE_KEY and A11Y_CONTROL_HOST_FILE there.\n";
}

// Enough of Ansible's stdout to include the failing task's own `fatal:` message and the PLAY RECAP.
const FETCH_STDOUT_TAIL_LINES = 40;

/**
 * The refusal for a failed fetch. Ansible writes the failing task's message to STDOUT; stderr carries only
 * its warnings (an inventory warning, on the 2026-09-22 firing), so a refusal printing stderr alone showed
 * the harmless line and hid the cause (#1911).
 *
 * @param {any} error what `execFile` rejected with
 * @returns {string}
 */
export function fetchFailureRefusal(error) {
  const stdoutTail = String(error?.stdout ?? "").trimEnd().split("\n").slice(-FETCH_STDOUT_TAIL_LINES).join("\n");
  const stderr = String(error?.stderr ?? "").trimEnd() || String(error?.message ?? error);
  return "REFUSING: lab:fetch -e artifact=corpus-archive failed -- nothing to release.\n"
    + (stdoutTail ? `--- stdout (last ${FETCH_STDOUT_TAIL_LINES} lines) ---\n${stdoutTail}\n` : "")
    + `--- stderr ---\n${stderr}\n`;
}

async function fetchLatestArchive() {
  return await run("ansible-playbook",
    ["packages/control/ansible/lab-fetch.yml", "-e", "artifact=corpus-archive"],
    { env: { ...process.env, ANSIBLE_CONFIG: resolve("packages/control/ansible/ansible.cfg") },
      maxBuffer: 1 << 24 });
}

async function main() {
  const refusal = missingFleetEnvRefusal(process.env);
  if (refusal) {
    process.stderr.write(refusal);
    process.exit(2);
  }
  const fetched = await fetchLatestArchive().catch((/** @type {any} */ e) => {
    process.stderr.write(fetchFailureRefusal(e));
    process.exit(2);
  });
  const sourceBasename = sourceBasenameFromFetchOutput(fetched.stdout);
  if (!sourceBasename) {
    process.stderr.write("REFUSING: lab:fetch's own output did not name where the archive came from, so "
      + "the flattened candidate.corpus-archive copy cannot be given back its real snapshot name.\n");
    process.exit(2);
  }

  const flattened = resolve(process.cwd(), flattenedFetchPath(sourceBasename));
  if (!existsSync(flattened)) {
    process.stderr.write(`REFUSING: lab:fetch named ${sourceBasename} but ${flattened} does not exist.\n`);
    process.exit(2);
  }
  const named = resolve(process.cwd(), "runs", "fetched", sourceBasename);
  copyFileSync(flattened, named);
  process.stdout.write(`Restored snapshot identity: ${sourceBasename}\n`);

  // Inherits stdio so `corpus:release`'s own report -- the count, the size, the verify -- lands in this
  // job's own journal rather than being summarised a second time and possibly disagreeing with it.
  const npm = npmCliInvocation("npm", ["run", "corpus:release", "--", `--archive=${named}`]);
  const child = await run(npm.command, npm.args, { maxBuffer: 1 << 24 })
    .then((r) => ({ ...r, code: 0 }))
    .catch((/** @type {any} */ e) => ({ stdout: e?.stdout ?? "", stderr: e?.stderr ?? String(e), code: e?.code ?? 1 }));
  process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);

  // ONLY ON SUCCESS. Unlike the fixed `candidate.corpus-archive.gz` name lab:fetch overwrites every run,
  // `named` carries the snapshot's own timestamp and a new one lands beside it daily -- left in place
  // this control checkout accumulates one corpus archive a day forever. A FAILED release keeps its
  // archive, the same reason corpus-snapshot.mjs leaves a short archive in place: something to inspect.
  if (child.code === 0) unlinkSync(named);
  process.exit(child.code);
}

// Guarded for the same reason corpus-release.mjs guards its own main(): unguarded, `node -e
// "import('./this.mjs')"` -- this repo's only real "does the file still load" check -- would fetch from
// the lab and attempt a release as a side effect. Realpath'd (#1086) so the guard still fires through a
// symlink, such as an npm-installed `.bin` shim.
if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) {
  await main();
}
