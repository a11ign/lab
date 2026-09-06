/**
 * EVERY CHECK THAT READS THE CORPUS MUST SAY WHETHER IT ASKED WHETHER THE CORPUS WAS MOVING.
 *
 * `evidence-fields.test.ts` passed a full `npm test` and failed 20 minutes later on byte-identical code,
 * because a capture was rewriting the files it reads. An hour earlier the same shape was seen, recorded as
 * "transient", and not looked into. `corpusReadable` (`corpus-settled.mjs`) is the guard; this is what
 * stops it reaching one of the readers and stopping there — *"a fix reaching one of six is the defect I
 * have committed three times this week."*
 *
 * ## Discovery, then CLASSIFICATION — and the second half is the point
 *
 * A static scan cannot tell "reads the corpus" from "mentions a corpus path and separately reads source".
 * `lab-pipeline.test.ts` compares against the literal string `"runs/screenreader-dataset/with-realism.jsonl"`
 * as an expected argument; `veto-audit-corpus.test.ts` asserts an ansible command does NOT contain a stale
 * export path. Both match any scan looking for a corpus path beside a file read, and neither reads a
 * capture. This repo settled that shape once already, about a different scan: *"Static derivation of a
 * CLI's flags CANNOT be trusted here, and that is why the list is pinned rather than derived."*
 *
 * So the scan finds CANDIDATES and every candidate must be classified into exactly one of three, each
 * with a reason and never a bare name:
 *
 *   - **guarded** — it calls `corpusReadable`.
 *   - **unguarded-by-cycle** — it is outside `packages/lab` and CANNOT call it. `packages/lab` depends on
 *     evidence, judge, scorer, worker-fleet, nvda-worker and control, so every one of these would be a
 *     dependency cycle. Not a missing `exports` field — a direction problem, which no export list fixes.
 *   - **not-a-corpus-read** — the scan matched a literal or a prose path, not a read of the corpus.
 *
 * An unclassified candidate FAILS BY NAME, which is what keeps "nobody guards this" and "somebody forgot"
 * from being the same state.
 *
 * ## Why the cycle entries CITE rather than re-argue
 *
 * `dataset-paths.test.ts` already maintains an EXEMPT list for the SAME dependency cycles, answering a
 * DIFFERENT question — why a file need not import `dataset-paths.mjs`. Merging the two was considered and
 * rejected: its vacuity guard re-checks *dataset-paths* signatures, so half of these entries would have it
 * verifying a signature unrelated to why they are exempt. Two lists answering the same question is the
 * fact-stated-twice shape; two lists answering different questions is correct separation. Moving
 * `corpusState` into `evidence` to dissolve the cycles was also rejected — it is about the `runs/`
 * directory layout, which `dataset-paths.mjs` owns in lab, and putting corpus-directory knowledge into the
 * package that defines what a capture IS inverts the layering for one guard's benefit.
 *
 * ## This test HAS a floor, and the file it borrows its EXEMPT discipline from deliberately does not
 *
 * `dataset-paths.test.ts` has no "at least N matched" assertion because the fix it guards ELIMINATES the
 * population it would count. This is the opposite case: guarding a reader does not stop it being a reader,
 * so the candidate set does not shrink, and a scan that silently matched nothing would pass having examined
 * nothing. The reasoning does not transfer, so the floor is here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { stripComments } from "@a11y-witness/evidence/source-text";

import { REPO_ROOT } from "../dataset-paths.mjs";

/** A path into a real corpus directory, or one of the accessors that resolves one. */
const CORPUS_PATH = /runs\/(screenreader-dataset|real-page-corpus|acceptance)/;
const CORPUS_ACCESSOR = /\b(runsRoot|datasetRoot|captureRoot|realCorpusRoot|repeatCapturesRoot)\s*\(/;
const READS_FILES = /\b(readdirSync|readFileSync|existsSync|globSync)\s*\(/;

/**
 * Calls the guard — either the general form or the lab-standard roots wrapper.
 *
 * The CALL, never the bare name: this file's own prose names both a dozen times. And BOTH spellings,
 * because the first version of this matched only `corpusReadable(` and so reported five files as
 * unguarded minutes after they were wired -- `labCorpusReadable` contains a capital C and never matched.
 * A marker that silently fails to recognise the remedy is the vacuity failure pointed the other way.
 */
const CONSULTS_GUARD = /\b(lab)?[cC]orpusReadable\s*\(/;

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "runs", ".venv", "coverage"]);

/**
 * This file, excluded from its own walk — the same device `real-page-corpus-freshness.test.ts` uses, for
 * the same reason and with the same care.
 *
 * It names corpus paths and reads files, so it discovers ITSELF; and the honest classification would have
 * to be "reads source, not captures", which is true and is also a file writing its own exemption into the
 * list it maintains. Excluding it from the walk keeps that decision visible HERE, in code, rather than as
 * one more entry a reader has to notice is self-referential. The distinction matters because the two look
 * identical in a diff and only one of them can be argued with.
 */
const SELF = "packages/lab/src/gates/corpus-readers-are-guarded.test.ts";

/**
 * Outside `packages/lab`, so it cannot import `corpusState` without a dependency cycle. The reason names
 * the cycle for each, because "nobody guards this" and "somebody forgot" must never be the same state.
 */
const UNGUARDED_BY_CYCLE: Record<string, string> = {
  "packages/evidence/src/announcement.corpus.test.ts":
    "@a11y-witness/evidence is the zero-dependency package lab itself depends on; importing corpus-settled.mjs "
    + "would invert the whole dependency graph. Same direction as its dataset-paths EXEMPT entry.",
  "packages/evidence/src/wire-types-describe-the-wire.test.ts":
    "Same cycle as its sibling in evidence, and already EXEMPT in dataset-paths.test.ts for that reason.",
  "packages/judge/src/channel-tables-4.1.2.test.ts":
    "@a11y-witness/lab depends on @a11y-witness/judge, so judge cannot import corpus-settled.mjs without a "
    + "cycle -- the same direction its own dataset-paths EXEMPT entry already records.",
  "packages/nvda-worker/src/capture-pure.corpus.test.ts":
    "@a11y-witness/lab depends on @a11y-witness/nvda-worker; same cycle, same direction as its existing "
    + "dataset-paths EXEMPT entry.",
  "packages/cli/src/cli.test.ts":
    "Reads the corpus through an accessor and skips honestly when it is absent, but sits outside lab, so it "
    + "cannot consult the guard. Found by THIS scan rather than by any hand-written list, which is the "
    + "argument for discovering the population instead of naming it.",
};

/**
 * The scan matched a corpus path beside a file read, and the file does not read the corpus. A REASON,
 * never a bare name — the discipline `dataset-paths.test.ts`'s EXEMPT and `busy-worker-guard.test.ts`'s
 * both use.
 */
const NOT_A_CORPUS_READ: Record<string, string> = {
  "packages/lab/src/dataset-paths.test.ts":
    "It is the test for the path accessors themselves. It plants temp roots and asserts what the accessors "
    + "resolve; it never reads a capture.",
  "packages/lab/src/gates/veto-audit-corpus.test.ts":
    "Asserts an ansible command string does NOT contain a stale export path -- a comparison against a "
    + "literal, which is what its own dataset-paths EXEMPT entry says too.",
  "packages/control/src/lab-pipeline.test.ts":
    "Asserts the expected output-file argument each pipeline job is dispatched with, a literal it compares "
    + "against rather than a path it resolves or reads. Its dataset-paths EXEMPT entry says the same.",
  "packages/lab/src/training/real-page-corpus-freshness.test.ts":
    "It reads SOURCE FILES, never a capture: it walks packages/lab's own tree looking for files that both "
    + "resolve realCorpusRoot() and call readdirSync, and its only readFileSync takes a path under "
    + "REPO_ROOT. It matched this scan because it names those markers as the SUBJECT of its assertions -- "
    + "its own header says so, and it excludes itself from its own walk for the identical reason. Note it "
    + "is the guard that polices corpus readers for age-reporting, so wiring it would have been a reader "
    + "exempting itself from a guard it does not need; the classification is what keeps that visible.",
  "packages/worker-fleet/src/lab-job.test.ts":
    "Reads the lab-job.yml catalogue and asserts on the argv it declares; the runs/ paths it matches are "
    + "job arguments in that YAML, not a corpus this test opens.",
};

/** Every test file whose source, comments stripped, looks like it might read the corpus. */
function candidates(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.test\.(ts|mjs)$/.test(entry.name)) continue;
      const source = stripComments(readFileSync(path, "utf8"));
      if (!CORPUS_PATH.test(source) && !CORPUS_ACCESSOR.test(source)) continue;
      if (!READS_FILES.test(source)) continue;
      const rel = relative(REPO_ROOT, path);
      if (rel !== SELF) found.push(rel);
    }
  };
  walk(join(REPO_ROOT, "packages"));
  return found.sort();
}

/**
 * The floor. Sized below today's count rather than at it, so adding a corpus reader does not fail this
 * test — the failure that matters is the scan matching NOTHING, which is how a discovery test comes to
 * pass having examined nothing.
 */
const MIN_CANDIDATES = 12;

test("the scan still finds the corpus readers it exists to classify", () => {
  const found = candidates();
  assert.ok(found.length >= MIN_CANDIDATES,
    `only ${found.length} corpus-reading candidate(s) discovered, expected at least ${MIN_CANDIDATES}. `
    + "Either the scan's markers no longer match how tests reach the corpus, or the population really did "
    + "shrink -- and the first is what makes this test pass having examined nothing");
});

test("every corpus-reading candidate is guarded, or classified with a reason", () => {
  const unclassified: string[] = [];
  for (const file of candidates()) {
    const source = stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
    if (CONSULTS_GUARD.test(source)) continue;
    if (UNGUARDED_BY_CYCLE[file] || NOT_A_CORPUS_READ[file]) continue;
    unclassified.push(file);
  }
  assert.deepEqual(unclassified, [],
    "these read the corpus and neither consult `corpusReadable` nor carry a reason why they cannot. A "
    + "green result from a moving corpus is as untrustworthy as a red one, so an unclassified reader is a "
    + "check nobody can tell the standing of: "
    + unclassified.join(", "));
});

test("every declared exemption still names a file the scan actually finds", () => {
  // The vacuity guard. An entry naming a file that has been renamed, deleted, or has stopped matching is
  // an exemption for a problem that no longer exists — and it makes the list look like coverage while
  // excusing nothing. `dataset-paths.test.ts`'s EXEMPT carries the same check for the same reason.
  const found = new Set(candidates());
  for (const [file, reason] of Object.entries({ ...UNGUARDED_BY_CYCLE, ...NOT_A_CORPUS_READ })) {
    assert.ok(reason.length > 40, `the entry for ${file} needs a real reason, not a placeholder`);
    assert.ok(found.has(file),
      `${file} is classified here but the scan no longer finds it. Either it stopped reading the corpus -- `
      + "in which case delete the entry -- or the scan's markers have drifted and it is now invisible");
  }
});

test("nothing is classified as BOTH cycle-exempt and not-a-read", () => {
  // Two answers to one question is how a reader comes to believe there are two questions. It also hides a
  // real change: a file moving from one bucket to the other should be visible, and cannot be if it sits
  // in both.
  const both = Object.keys(UNGUARDED_BY_CYCLE).filter((f) => f in NOT_A_CORPUS_READ);
  assert.deepEqual(both, [], `classified twice, with two different reasons: ${both.join(", ")}`);
});

test("no cycle exemption names a file inside packages/lab, which has no cycle to plead", () => {
  // The bucket's whole justification is the dependency direction. A lab file in it would be an ordinary
  // unguarded reader wearing an excuse that does not apply to it.
  const inLab = Object.keys(UNGUARDED_BY_CYCLE).filter((f) => f.startsWith("packages/lab/"));
  assert.deepEqual(inLab, [],
    `these are inside packages/lab, so they CAN import corpus-settled.mjs and must: ${inLab.join(", ")}`);
});
