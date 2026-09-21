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

// SCOPED TO THE `refuse()` CALL'S OWN MESSAGE, never the whole file -- a whole-file scan (the shape this
// used to be) passes when the route names land in a COMMENT nobody reads at the refusal site, which is
// not the same claim as "the text a reader actually sees names the route". Caught in review (reviewer-2
// on #1860): removing both names from the message and leaving them only in a comment still passed a
// whole-file version of this assertion, all 3 tests green.
const REMOTE_REFUSAL = /refuse\(\s*"REFUSING: no A11Y_CORPUS_REMOTE set[\s\S]*?\);/;

// A double-quoted string literal, escapes included -- deliberately NOT "anything between refuse('s
// parens". A `// comment` or a block comment sitting between the `+`-concatenated fragments is source
// text in that span too, but it can never be INSIDE a quoted literal, so pulling only the literals out
// (and JSON.parse-ing each, since a JS double-quoted literal's escapes are a JSON string's escapes here)
// reconstructs exactly the string `refuse()` will be called with at runtime -- what a reader actually
// sees -- rather than the wider textual span reviewer-2's second verdict caught (#1860, `1f91f0fc`):
// route names left only in a same-span comment, none in the message, still matched.
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;

/** The runtime message a `refuse(...)` call span evaluates to, ignoring any comments inside it. */
const evaluatedMessage = (callSpan: string) =>
  (callSpan.match(STRING_LITERAL) ?? []).map((literal) => JSON.parse(literal) as string).join("");

test("#1042: corpus-backup.mjs's no-A11Y_CORPUS_REMOTE refusal names corpus:release", () => {
  const source = readFileSync(BACKUP_SCRIPT, "utf8");
  const refusal = REMOTE_REFUSAL.exec(source);
  assert.ok(refusal,
    "the refusal text this test targets has moved or been reworded -- update the assertion below to match");
  assert.ok(NAMES_THE_ROUTE(evaluatedMessage(refusal[0])),
    "corpus-backup.mjs's refusal MESSAGE (not merely its file, and not a comment beside it) must name "
    + "`corpus:release` and `a11ign/corpus-backups` as the existing, already-working route -- otherwise a "
    + "reader who hits this refusal concludes the corpus has no backup destination at all, which is "
    + "exactly what produced #1042's chairman escalation");
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

test("#1042 REGRESSION (reviewer-2 on #1860, verdict at `1f91f0fc`): a comment inside refuse() naming "
  + "the route, with no route name in the message itself, must NOT pass", () => {
  // This is the exact shape reviewer-2's mutation produced: both route tokens removed from the
  // concatenated string fragments and placed only in a `//` comment between them, still inside the
  // `refuse(...)` call span the old (span-scoped, not literal-scoped) assertion matched.
  const callSpan = 'refuse(\n'
    + '  "REFUSING: no A11Y_CORPUS_REMOTE set, nowhere durable to put the corpus.\\n" +\n'
    + '  // see corpus:release / a11ign/corpus-backups for the working route\n'
    + '  "\\n");';
  assert.ok(!NAMES_THE_ROUTE(evaluatedMessage(callSpan)),
    "a comment between the concatenated string fragments satisfied the guard -- evaluatedMessage() must "
    + "only ever see what is inside the quoted literals, never a same-span comment");
});
