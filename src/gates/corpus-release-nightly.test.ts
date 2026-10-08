/**
 * THE NAME A NIGHTLY RELEASE HAS TO RECOVER, testable without `ansible` or a real fetch.
 *
 * `lab:fetch -e artifact=corpus-archive` flattens every corpus snapshot to the same local path
 * (`runs/fetched/candidate.corpus-archive.<ext>`), because that is the right behaviour for every OTHER
 * artifact it knows. `corpus-release-nightly.mjs` reads the fetch's own "from ... on the lab" line back to
 * recover the real `corpus-<timestamp>.tar.gz` name before handing anything to `corpus-release.mjs`, whose
 * `tagFor` depends on that exact filename. Both halves of that recovery are split out from the I/O for the
 * same reason `corpus-release.mjs`'s own `releaseVerdict`/`tagFor` are: the decision is the part worth
 * pinning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT } from "../dataset-paths.mjs";
import {
  sourceBasenameFromFetchOutput,
  flattenedFetchPath,
  missingFleetEnvRefusal,
  fetchFailureRefusal,
} from "../../scripts/corpus-release-nightly.mjs";

test("recovers the real snapshot name from lab-fetch.yml's own debug line", () => {
  const output = [
    "TASK [Where it landed] *********************************************************",
    "ok: [a11y-lab] => ",
    "    msg:",
    "    - runs/fetched/candidate.corpus-archive.gz",
    "    - from backups/corpus-2026-09-21_03-00-00.tar.gz on the lab",
    "",
    "PLAY RECAP **********************************************************************",
  ].join("\n");
  assert.equal(sourceBasenameFromFetchOutput(output), "corpus-2026-09-21_03-00-00.tar.gz");
});

test("a source path is reduced to its basename, not left as a lab-relative path", () => {
  // The debug line names a path RELATIVE TO THE LAB'S OWN REPO (`backups/corpus-...`); only the
  // basename means anything once the bytes are on the control plane.
  const output = "from backups/corpus-2026-01-02_03-04-05.tar.gz on the lab";
  assert.equal(sourceBasenameFromFetchOutput(output), "corpus-2026-01-02_03-04-05.tar.gz");
});

test("no matching line means no name -- the caller refuses rather than guessing one", () => {
  const output = "PLAY RECAP\na11y-lab : ok=9 changed=0 unreachable=0 failed=0\n";
  assert.equal(sourceBasenameFromFetchOutput(output), null);
});

test("the flattened path is named for the ARTIFACT, with the source's own last extension", () => {
  // `lab-job.yml`'s own naming task: `candidate.<artifact>` plus whatever `splitext` leaves of the
  // source name -- which, like Python's, strips only the LAST dot, so a `.tar.gz` source yields `.gz`.
  assert.match(
    flattenedFetchPath("corpus-2026-09-21_03-00-00.tar.gz").replaceAll("\\", "/"),
    /runs\/fetched\/candidate\.corpus-archive\.gz$/,
  );
});

test("an unusual source extension is carried through rather than hardcoded to .gz", () => {
  assert.match(
    flattenedFetchPath("corpus-2026-09-21_03-00-00.tar.bz2").replaceAll("\\", "/"),
    /runs\/fetched\/candidate\.corpus-archive\.bz2$/,
  );
});

/**
 * `flattenedFetchPath()` is a SECOND STATEMENT of `lab-fetch.yml`'s own "Name it after what it actually
 * is" naming task -- `{{ out | default('candidate') }}.{{ artifact }}{{ (lab_fetch_src | splitext)[1] |
 * default('.json', true) }}` -- read as a filesystem path instead of as a Jinja template. Nothing
 * compared the two before this: `lab-fetch-paths.test.ts` classifies `corpus-archive` as UNREACHED, but
 * that test is about the SOURCE side (where `corpus-snapshot.mjs` writes on the lab), not this
 * DESTINATION-naming formula -- a playbook edit to `lab_fetch_dest` could silently break the nightly
 * release while every existing test here stayed green (reviewer-2's #1869 finding).
 *
 * This cannot re-run the Jinja template without Ansible, so — the same shape `lab-fetch-paths.test.ts`'s
 * own `UNREACHED` table already uses for what it cannot fully verify — it pins the template's TEXT: the
 * `candidate` default this function assumes, and the `splitext`-based extension logic (Python's
 * `splitext`, and this file's own `flattenedFetchPath` via `node:path`'s `extname`, both strip only the
 * LAST dot) still appear together in the one task that writes `lab_fetch_dest`. A rename of either would
 * fail this named line rather than pass silently.
 */
test("the destination formula this script assumes still matches lab-fetch.yml's own naming task", () => {
  const playbook = readFileSync(resolve(REPO_ROOT, "packages/control/ansible/lab-fetch.yml"), "utf8");
  const task = playbook.match(
    /Name it after what it actually is[\s\S]*?lab_fetch_dest:[\s\S]*?\n\n/,
  )?.[0];
  assert.ok(task, "lab-fetch.yml no longer has a \"Name it after what it actually is\" task -- "
    + "flattenedFetchPath() assumes its exact naming formula and must be re-checked against whatever "
    + "replaced it");
  assert.match(task, /out \| default\('candidate'\)/,
    "the playbook no longer defaults the destination's own name to 'candidate' -- flattenedFetchPath() "
    + "hardcodes that default and must change with it");
  assert.match(task, /\}\}\.\{\{\s*artifact/,
    "the playbook no longer writes '<out>.<artifact>' -- flattenedFetchPath() assumes that exact shape");
  assert.match(task, /\|\s*splitext/,
    "the playbook no longer derives the destination's extension with splitext (strips only the LAST "
    + "dot, like node:path's extname) -- flattenedFetchPath() assumes the two agree");
});

/**
 * #1911: THE UNIT FAILED EVERY FIRING, AND ITS JOURNAL NEVER SAID WHY. `A11Y_PVE_KEY` was exported only by
 * `~/.zshenv`, which a systemd unit never reads, and Ansible's "A11Y_PVE_KEY is not set" went to stdout
 * while the refusal printed stderr alone -- a harmless inventory warning. Both halves are pinned here.
 */
test("#1911: the real script exits 2 naming fleet.env when A11Y_PVE_KEY is absent, before any fetch", () => {
  // Run from an empty directory, so a mutant that skipped the check and reached ansible-playbook could
  // not find the playbook and touch nothing -- and would still fail the stderr assertion below.
  const cwd = mkdtempSync(join(tmpdir(), "corpus-nightly-"));
  try {
    const env = { ...process.env };
    delete env.A11Y_PVE_KEY;
    const result = spawnSync(process.execPath,
      [resolve(REPO_ROOT, "packages/lab/scripts/corpus-release-nightly.mjs")], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 2, `expected the refusal's exit 2; stderr was:\n${result.stderr}`);
    assert.match(result.stderr, /A11Y_PVE_KEY is not set/);
    assert.match(result.stderr, /~\/\.config\/a11ign\/fleet\.env/, "it names the file the unit reads");
    assert.match(result.stderr, /never from the shell's \.zshenv/, "and says why the shell's copy does not count");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("#1911: an EMPTY A11Y_PVE_KEY refuses too; a set one does not -- the positive control", () => {
  assert.match(missingFleetEnvRefusal({ A11Y_PVE_KEY: "" }) ?? "", /fleet\.env/,
    "`A11Y_PVE_KEY=` in fleet.env is as unusable as no line at all");
  assert.equal(missingFleetEnvRefusal({ A11Y_PVE_KEY: "/home/agent/.ssh/pve" }), null);
});

test("#1911: the fetch-failure refusal carries what the failing command wrote ONLY to stdout", async () => {
  // A REAL execFile rejection, not a hand-built object: the refusal reads the fields execFile actually
  // attaches, so a stub with the wrong shape cannot pass here and fail on the host. The shape of the
  // 2026-09-22T09:26:49Z firing: the cause on stdout, a harmless warning on stderr, exit 2.
  const failing = [
    'process.stdout.write("fatal: [a11y-lab]: FAILED! => A11Y_PVE_KEY is not set, and it has no default\\n");',
    'process.stderr.write("[WARNING]: Invalid characters were found in group names\\n");',
    "process.exit(2);",
  ].join("");
  const error = await promisify(execFile)(process.execPath, ["-e", failing]).then(
    () => assert.fail("the stand-in command was meant to fail"), (e: unknown) => e);
  const refusal = fetchFailureRefusal(error);
  assert.match(refusal, /REFUSING: lab:fetch -e artifact=corpus-archive failed/);
  assert.match(refusal, /A11Y_PVE_KEY is not set, and it has no default/,
    "the stdout-only cause reaches the journal -- the half the old refusal dropped");
  assert.match(refusal, /Invalid characters were found in group names/, "stderr is still printed beside it");
});

test("#1911: a long Ansible stdout is cut to its tail, where the failing task and the recap are", () => {
  const stdout = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const refusal = fetchFailureRefusal({ stdout, stderr: "" });
  assert.match(refusal, /line 499/);
  assert.doesNotMatch(refusal, /line 0\n/);
});
