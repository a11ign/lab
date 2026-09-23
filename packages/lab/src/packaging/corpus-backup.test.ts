/**
 * #1042 — `corpus-backup.mjs`'s refusal (and `lab-job.yml`'s `exitMeanings` for the same job) must NAME
 * the route that already works, so a reader arriving at "no A11Y_CORPUS_REMOTE set" does not conclude the
 * corpus has no backup at all.
 *
 * The row this closes: the interim `corpus:backup` (scp/mount, gated on `A11Y_CORPUS_REMOTE`, never
 * configured) is one of TWO backup mechanisms, and `corpus:release` (GitHub Releases on the private
 * `a11ign/corpus-backups`, verified by download) has been the corpus's real off-machine copy since
 * 2026-09-06 -- but neither `corpus-backup.mjs`'s own refusal text nor `lab-job.yml`'s exit-code gloss for
 * the same job ever named it, so the refusal read as "nowhere durable exists" rather than "this one
 * destination isn't configured". That read produced a chairman escalation nine days later (#1042 itself).
 *
 * #2050 adds the THIRD file with the same defect, and the one a reader is most likely to meet:
 * `corpus-snapshot.mjs`'s closing advisory, printed at the end of every snapshot including the lab's
 * unattended 03:00Z firing, named only the unconfigured scp/mount route. Same assertion, same
 * process-spawn approach, and the same warning kept intact -- at the instant it prints, the archive
 * really is on one disk, because the release nightly does not fire until 04:00Z.
 *
 * The YAML check reads `lab-job.yml`'s parsed source, which needs no destination, lab, or fleet.
 *
 * THE SCRIPT CHECK RUNS THE REAL SCRIPT AND READS ITS ACTUAL STDERR, rather than scanning
 * `corpus-backup.mjs`'s source text. Three prior rounds each scanned source instead (reviewer-2 on #1860:
 * `0ece3e54` a whole-file substring scan, passed when the route names sat in an unrelated comment;
 * `1f91f0fc` scoped to the `refuse(...)` call's span, still passed with the names moved into a comment
 * INSIDE that span; `104f0b99` scoped further to quoted string literals inside the span, still passed with
 * the names in a QUOTED comment inside the span) -- each fix narrowed the span without changing the
 * approach, and each still proved a claim about the SOURCE TEXT, never about the message a reader actually
 * sees. No comment placement, string-fragment shape, or literal-vs-comment distinction can fool a check
 * that reads what the script itself writes to stderr when run: `corpus-backup.mjs` guards its `main()`
 * behind `if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)`, so spawning it as
 * `node corpus-backup.mjs` (never merely importing it) runs the refusal for real, and `refuse()` writes to
 * stderr and exits 1 before touching the filesystem, a destination, the lab, or the fleet -- so this is as
 * cheap as the source-scan it replaces, while proving the runtime message instead of a textual proxy for
 * it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const BACKUP_SCRIPT = resolve(REPO, "packages/lab/scripts/corpus-backup.mjs");
const LAB_JOB_YML = resolve(REPO, "packages/control/ansible/lab-job.yml");
const SNAPSHOT_SCRIPT = resolve(REPO, "packages/lab/scripts/corpus-snapshot.mjs");
const DATASET_PATHS = resolve(REPO, "packages/lab/src/dataset-paths.mjs");

/** Both files must name the working route by name, not just gesture at "another way". */
const NAMES_THE_ROUTE = (text: string) =>
  text.includes("corpus:release") && text.includes("a11ign/corpus-backups");

/**
 * Runs a `corpus-backup.mjs`-shaped script with no `A11Y_CORPUS_REMOTE`, which is exactly the state that
 * hits the refusal this test targets. `A11Y_CORPUS_REMOTE` is dropped from the inherited environment
 * rather than merely left unset in this process, so the check does not depend on nothing in the ambient
 * environment setting it.
 */
function runWithNoRemote(scriptPath: string): { code: number; stderr: string } {
  const env = { ...process.env };
  delete env.A11Y_CORPUS_REMOTE;
  try {
    execFileSync(process.execPath, [scriptPath], { encoding: "utf8", env });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? -1, stderr: failure.stderr ?? "" };
  }
}

test("#1042: corpus-backup.mjs's no-A11Y_CORPUS_REMOTE refusal names corpus:release", () => {
  const { code, stderr } = runWithNoRemote(BACKUP_SCRIPT);
  assert.equal(code, 1, `expected the no-A11Y_CORPUS_REMOTE refusal to exit 1; got ${code}: ${stderr}`);
  assert.ok(NAMES_THE_ROUTE(stderr),
    "corpus-backup.mjs's refusal, on stderr, must name `corpus:release` and `a11ign/corpus-backups` as the "
    + "existing, already-working route -- otherwise a reader who hits this refusal concludes the corpus "
    + "has no backup destination at all, which is exactly what produced #1042's chairman escalation");
});

test("#1042: lab-job.yml's corpus-backup job names corpus:release in its exit-1 gloss", () => {
  const jobs = parseYaml(readFileSync(LAB_JOB_YML, "utf8"))[1].vars.lab_jobs;
  assert.ok(jobs["corpus-backup"], "the corpus-backup job entry moved or was renamed in lab-job.yml");
  const exit1 = jobs["corpus-backup"].exitMeanings["1"];
  assert.ok(NAMES_THE_ROUTE(exit1),
    "lab-job.yml's corpus-backup exitMeanings['1'] must name `corpus:release` and `a11ign/corpus-backups` "
    + "as the other, working route -- the same reason as the script's own refusal above");
});

test("#2061: lab-job.yml's corpus-backup-verify job names corpus:release in its exit-1 gloss too", () => {
  // The SAME defect one catalogue entry over, and it cost eleven days of a red `lab:status` line. #1042
  // fixed `corpus-backup`'s gloss and the script's own refusal; `corpus-backup-verify` runs that same
  // script (`corpus:backup -- --verify-only`), hits that same refusal, and its gloss named no route -- so
  // a reader who dispatched it against an unconfigured destination (twice: 2026-09-10 and 2026-09-12)
  // was left reading "the last backup is not readable" about a corpus that has a working, verified
  // off-machine copy. Held by the same assertion rather than a new one precisely because it is the same
  // claim: the message a reader lands on must name the route that works.
  const jobs = parseYaml(readFileSync(LAB_JOB_YML, "utf8"))[1].vars.lab_jobs;
  assert.ok(jobs["corpus-backup-verify"],
    "the corpus-backup-verify job entry moved or was renamed in lab-job.yml");
  const exit1 = jobs["corpus-backup-verify"].exitMeanings["1"];
  assert.ok(NAMES_THE_ROUTE(exit1),
    "lab-job.yml's corpus-backup-verify exitMeanings['1'] must name `corpus:release` and "
    + "`a11ign/corpus-backups` as the other, working route -- its 'no destination is configured' half is "
    + "reached by exactly the refusal #1042 was filed about, so leaving it unnamed here reproduces #1042 "
    + "one entry over");
});

test("#1042 POSITIVE CONTROL: an unrelated exit-code gloss does NOT name corpus:release", () => {
  // Without this, a check that matched on ANY occurrence of the string anywhere in the file -- rather
  // than in the specific message a reader actually sees -- would pass even if the naming landed in a
  // comment nobody reads at the refusal site. corpus-snapshot's own exitMeanings is a real neighbour in
  // the same catalogue entry that has no reason to mention the backup route at all.
  const jobs = parseYaml(readFileSync(LAB_JOB_YML, "utf8"))[1].vars.lab_jobs;
  const snapshotExit2 = jobs["corpus-snapshot"].exitMeanings["2"];
  assert.ok(!NAMES_THE_ROUTE(snapshotExit2),
    "corpus-snapshot's own exit-2 gloss unexpectedly names corpus:release -- the positive control no "
    + "longer distinguishes 'the targeted message' from 'anything in the file'");
});

test("#1042 REGRESSION (reviewer-2 on #1860, three verdicts: `0ece3e54`, `1f91f0fc`, `104f0b99`): moving "
  + "the route names out of the refusal MESSAGE and into a comment beside it must NOT pass", () => {
  // This is the shape all three prior source-scanning assertions missed, in one or another form: both
  // route tokens removed from the message string literals and placed only in a comment sitting inside the
  // `refuse(...)` call. Run for real (a mutated COPY of the actual script, never `git checkout --` on the
  // real one), it proves what no source-text scan can: the runtime message genuinely lacks both names, so
  // the process-spawn check above correctly fails it, where the old whole-file/span/literal scans each
  // passed some version of exactly this.
  const source = readFileSync(BACKUP_SCRIPT, "utf8");
  const original = '"THIS IS NOT THE ONLY BACKUP ROUTE. `npm run corpus:release -- --archive=<path>` already publishes\\n" +\n'
    + '      "the corpus to GitHub Releases on `a11ign/corpus-backups` (private) and verifies it by downloading\\n" +';
  assert.ok(source.includes(original),
    "the refusal text this regression targets has moved or been reworded -- update `original` to match");
  const mutated = source.replace(original,
    '"THIS IS NOT THE ONLY BACKUP ROUTE. Another route already publishes and verifies the corpus.\\n" +\n'
    + '      // see corpus:release / a11ign/corpus-backups for the working route\n'
    + '      "" +');

  // Written BESIDE the real script, not under `os.tmpdir()`: `corpus-backup.mjs` imports
  // `@a11ign/worker-fleet/cli-flags` by bare specifier, and Node resolves that by walking up from the
  // running file to find `node_modules` -- a copy outside this repo's tree has nothing to walk up to and
  // fails with `ERR_MODULE_NOT_FOUND` before the refusal this test wants ever runs. At the package ROOT,
  // not in `scripts/`: `runs-write-guard.test.ts` and `dataset-paths.test.ts` walk `packages/*/{src,scripts}`
  // concurrently and read every file they list, so a copy deleted between their listing and their read
  // failed them with ENOENT (#1919, #944's shape). The script's other paths resolve from `process.cwd()`,
  // so nothing else depends on where the copy sits.
  const dir = mkdtempSync(join(REPO, "packages/lab/.corpus-backup-mutation-"));
  try {
    const mutatedScript = join(dir, "corpus-backup.mjs");
    writeFileSync(mutatedScript, mutated);
    const { code, stderr } = runWithNoRemote(mutatedScript);
    assert.equal(code, 1, `expected the mutated script's refusal to still exit 1; got ${code}: ${stderr}`);
    // Exit 1 alone is also what an unresolvable import gives, so a copy that moved somewhere Node cannot
    // find `node_modules` from would pass the line above without ever reaching the refusal (#1919).
    assert.match(stderr, /REFUSING: no A11Y_CORPUS_REMOTE set/,
      `the mutated copy exited 1 without reaching its refusal: ${stderr}`);
    assert.ok(!NAMES_THE_ROUTE(stderr),
      "a comment beside the refusal satisfied the guard -- the mutated script's real stderr must lack both "
      + "route names for this regression to mean anything");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Builds a one-file corpus in a temp tree and runs the REAL `corpus-snapshot.mjs` against it, returning
 * what a reader actually sees. `RUNS_ROOT`/`DATASET_ROOT` are what `dataset-paths.mjs` reads, and `--out`
 * keeps the archive out of the repo's own `backups/`, so this touches no corpus, lab or fleet and costs
 * about a second — the same price as the source scan it replaces.
 *
 * The corpus tree goes under `os.tmpdir()`, unlike the mutated SCRIPT copy above: only a script has to sit
 * inside the repo to resolve `@a11ign/worker-fleet` by walking up to `node_modules`. Data read through an
 * env var has nowhere to walk.
 */
function runSnapshot(scriptPath: string, { withCaptures }: { withCaptures: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "corpus-snapshot-advisory-"));
  // NEITHER NAME IS `runs/` OR `screenreader-dataset`, deliberately. Both roots reach the script only
  // through `RUNS_ROOT`/`DATASET_ROOT`, which `dataset-paths.mjs` honours as absolute overrides, so the
  // realistic spellings bought this file nothing -- and spelling them made `dataset-paths.test.ts` read
  // it as a file resolving the repo's own corpus root independently, which it is not. Kept neutral rather
  // than added to that guard's EXEMPT list: an exemption is for a literal a file cannot avoid, and this
  // one it can.
  const dataset = join(dir, "corpus/dataset");
  try {
    // `describe()` asks whether each WANTED member EXISTS, not whether it holds anything -- so an empty
    // `captures/` is a present member and snapshots happily. The no-captures tree therefore has to omit
    // the directory outright to reach the nothing-to-snapshot branch, which is what caught this: the
    // control exited 0 on a corpus it was meant to find empty.
    mkdirSync(dataset, { recursive: true });
    if (withCaptures) {
      mkdirSync(join(dataset, "captures"), { recursive: true });
      writeFileSync(join(dataset, "captures/one.json"), '{"id":"one"}');
      writeFileSync(join(dataset, "manifest.json"), "{}");
    }
    const env = { ...process.env, RUNS_ROOT: join(dir, "corpus"), DATASET_ROOT: dataset };
    const args = [scriptPath, `--out=${join(dir, "out")}`];
    try {
      const stdout = execFileSync(process.execPath, args, { encoding: "utf8", env, stdio: "pipe" });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#2050: corpus-snapshot.mjs's closing advisory names corpus:release, on real stdout", () => {
  // THE SAME DEFECT AS #1042'S TWO MESSAGES, IN THE FILE A READER IS MOST LIKELY TO MEET IT IN: this
  // advisory is printed at the end of EVERY snapshot, including the lab's unattended 03:00Z firing, and
  // the only route it named was `corpus:backup`'s scp/mount one, which has never been configured on any
  // machine. #1042's two messages appeared only when somebody ran a command; this one arrives nightly.
  const { code, stdout } = runSnapshot(SNAPSHOT_SCRIPT, { withCaptures: true });
  assert.equal(code, 0, `expected a healthy snapshot to exit 0; got ${code}`);
  assert.match(stdout, /not yet a backup/,
    `the snapshot ran without reaching its closing advisory: ${stdout}`);
  assert.ok(NAMES_THE_ROUTE(stdout),
    "corpus-snapshot.mjs's closing advisory, on stdout, must name `corpus:release` and "
    + "`a11ign/corpus-backups` as the route that already works -- otherwise the one message the lab "
    + "prints every night sends its reader to the unconfigured destination and nowhere else, which is "
    + "the reading that produced #1042's chairman escalation");
  assert.match(stdout, /SAME DISK as the corpus, so it is not yet a backup/,
    "the accurate warning must SURVIVE the fix: at the instant this prints, the archive really is on one "
    + "disk -- the release nightly does not fire until an hour later. A message that claimed the snapshot "
    + "was already safe would be a false statement in a verification message, which is worse than the "
    + "silence #2050 was filed about");
});

test("#2050 POSITIVE CONTROL: corpus-snapshot.mjs's nothing-to-snapshot refusal does NOT name "
  + "corpus:release", () => {
  // Without this, an assertion that matched anywhere in anything the process printed -- rather than in
  // the advisory a reader lands on -- would pass on a script that named the route in some unrelated line.
  // This is the same script and the same run shape, one branch over: an empty dataset exits 2 before any
  // archive exists, where naming a backup route would be noise.
  const { code, stdout, stderr } = runSnapshot(SNAPSHOT_SCRIPT, { withCaptures: false });
  assert.equal(code, 2, `expected the empty-corpus refusal to exit 2; got ${code}: ${stderr}`);
  assert.match(stderr, /nothing to snapshot/, `not the refusal this control targets: ${stderr}`);
  assert.ok(!NAMES_THE_ROUTE(stdout + stderr),
    "corpus-snapshot.mjs's nothing-to-snapshot refusal unexpectedly names corpus:release -- the positive "
    + "control no longer distinguishes 'the closing advisory' from 'anything this script prints'");
});

test("#2050 REGRESSION: moving the route names out of the advisory and into a comment beside it must "
  + "NOT pass", () => {
  // The shape three rounds of source-scanning missed on `corpus-backup.mjs` (see the regression above),
  // asserted here for the new case rather than assumed to be inherited: both route tokens removed from
  // the strings `process.stdout.write` is given and left only in a comment sitting beside the call. Run
  // for real, the advisory a reader sees genuinely lacks both names and the check above fails it.
  const source = readFileSync(SNAPSHOT_SCRIPT, "utf8");
  const original = '"`corpus:release`, which publishes it to GitHub Releases on `a11ign/corpus-backups`\\n" +';
  assert.ok(source.includes(original),
    "the advisory text this regression targets has moved or been reworded -- update `original` to match");
  const mutated = source
    .replace(original, '// `corpus:release` publishes to `a11ign/corpus-backups` -- the working route\n    "a job on the control plane, which publishes it somewhere durable\\n" +')
    .replace("`  npm run corpus:release -- --archive=${archive}\\n\\n`", '"  (ask the control plane to publish it)\\n\\n" +')
    // The copy sits at a different depth from the real script, so its ONE relative import is rewritten to
    // an absolute path. Everything else it needs -- `@a11ign/worker-fleet` -- resolves by walking up to
    // this repo's `node_modules`, which is why the copy stays inside the repo at all.
    .replace('"../src/dataset-paths.mjs"', JSON.stringify(pathToFileURL(DATASET_PATHS).href));

  // Beside the real script but NOT under `packages/lab/scripts/`: `runs-write-guard.test.ts` and
  // `dataset-paths.test.ts` walk `packages/*/{src,scripts}` concurrently and read every file they list,
  // so a copy deleted between their listing and their read fails them with ENOENT (#1919).
  const dir = mkdtempSync(join(REPO, "packages/lab/.corpus-snapshot-mutation-"));
  try {
    const mutatedScript = join(dir, "corpus-snapshot.mjs");
    writeFileSync(mutatedScript, mutated);
    const { code, stdout, stderr } = runSnapshot(mutatedScript, { withCaptures: true });
    assert.equal(code, 0, `expected the mutated script to still exit 0; got ${code}: ${stderr}`);
    // Exit 0 alone cannot distinguish "ran and printed a route-free advisory" from a script that never
    // got that far, so the advisory's surviving half is what proves the mutation reached the real call.
    assert.match(stdout, /not yet a backup/,
      `the mutated copy exited 0 without reaching its advisory: ${stdout}${stderr}`);
    assert.ok(!NAMES_THE_ROUTE(stdout),
      "a comment beside the advisory satisfied the guard -- the mutated script's real stdout must lack "
      + "both route names for this regression to mean anything");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
