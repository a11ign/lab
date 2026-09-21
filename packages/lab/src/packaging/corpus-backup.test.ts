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
 * Both checks read the SOURCE TEXT rather than running the script or dispatching the job -- neither needs
 * a destination, a lab, or the fleet to prove the wording is present.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const BACKUP_SCRIPT = resolve(REPO, "packages/lab/scripts/corpus-backup.mjs");
const LAB_JOB_YML = resolve(REPO, "packages/control/ansible/lab-job.yml");

/** Both files must name the working route by name, not just gesture at "another way". */
const NAMES_THE_ROUTE = (text: string) =>
  text.includes("corpus:release") && text.includes("a11ign/corpus-backups");

test("#1042: corpus-backup.mjs's no-A11Y_CORPUS_REMOTE refusal names corpus:release", () => {
  const source = readFileSync(BACKUP_SCRIPT, "utf8");
  assert.ok(source.includes("REFUSING: no A11Y_CORPUS_REMOTE set"),
    "the refusal text this test targets has moved or been reworded -- update the assertion below to match");
  assert.ok(NAMES_THE_ROUTE(source),
    "corpus-backup.mjs's refusal must name `corpus:release` and `a11ign/corpus-backups` as the existing, "
    + "already-working route -- otherwise a reader who hits this refusal concludes the corpus has no "
    + "backup destination at all, which is exactly what produced #1042's chairman escalation");
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
