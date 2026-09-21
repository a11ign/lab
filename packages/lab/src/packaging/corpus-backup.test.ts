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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const BACKUP_SCRIPT = resolve(REPO, "packages/lab/scripts/corpus-backup.mjs");
const LAB_JOB_YML = resolve(REPO, "packages/control/ansible/lab-job.yml");

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
  // fails with `ERR_MODULE_NOT_FOUND` before the refusal this test wants ever runs.
  const dir = mkdtempSync(join(REPO, "packages/lab/scripts/.corpus-backup-mutation-"));
  try {
    const mutatedScript = join(dir, "corpus-backup.mjs");
    writeFileSync(mutatedScript, mutated);
    const { code, stderr } = runWithNoRemote(mutatedScript);
    assert.equal(code, 1, `expected the mutated script's refusal to still exit 1; got ${code}: ${stderr}`);
    assert.ok(!NAMES_THE_ROUTE(stderr),
      "a comment beside the refusal satisfied the guard -- the mutated script's real stderr must lack both "
      + "route names for this regression to mean anything");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
