/**
 * #2155: A CORPUS-SIZE FIGURE IN A FILE AN OPERATOR ACTS ON MUST SAY WHEN IT WAS READ.
 *
 * The corpus is 1,715 cases and 4,500 captures (`orchestrator` on the lab, `a11y-lab`, `/srv/a11y-runs`,
 * 2026-09-23T14:26Z; #1561 comment 5796655391). The tree said 1,061 pairs and 2,122 captures in 106 files,
 * and a handful of those said it in the PRESENT TENSE, in files somebody reads before pricing a recapture.
 * `capture-cache.mjs`'s own header argued a design decision from the figure -- *"invalidating 1,061 pairs
 * over a reworded comment is how a cache becomes something people turn off"* -- and `cli.ts` stated it to a
 * reader as a live property of this repository. It mis-priced a real estimate in #2143's cost section.
 *
 * ## WHAT THIS GUARDS, AND WHAT IT DELIBERATELY CANNOT REACH
 *
 * **An explicit file list, never a tree walk.** Most of the 208 occurrences in the tree are RIGHT: `docs/`,
 * the ADRs and the incident write-ups quote 2,122 as what a past decision cost or what a past population
 * was, and those are dated records that must not be rewritten. A walk would reach them, and a guard that
 * flags correct text is a guard somebody turns off. #2155's Region says so in words -- *"Deliberately NOT
 * in the Region: the docs tree, the ADR directory, and the incident write-ups"* -- and `noDocsPaths` below
 * pins that boundary in code so widening the list is a visible edit rather than a silent one.
 *
 * **Structural, never tense-based.** Tense is not machine-decidable, and this file does not try: it asks
 * only whether an as-of DATE, or the manifest that holds the number, sits beside the figure. A dated past
 * reading passes, and that is correct -- `fleet-status.mjs` still names the 1,061-case corpus of
 * 2026-07-26 to explain where its old derivation came from, and must be able to.
 *
 * ## THE THREE CHOICES THAT DECIDE WHAT THIS SEES
 *
 * **A FLOOR OF 1,000.** A corpus-size figure here is four figures; below that a number beside these nouns
 * is a sample, a bucket or a family count. The README's *"Measured on 10 mixed cases"* is the case that
 * fixes it: a benchmark population, correct undated, and flagging it is how this guard would earn a
 * blanket exemption. **Stated as a limit rather than a property:** a future corpus of 900 cases could be
 * written bare here and this file would not see it. The magnitude was chosen because it cannot be evaded
 * by rewording, and rewording is not the failure mode -- retyping a number is.
 *
 * **A WINDOW OF 120 CHARACTERS, and it was measured rather than picked.** "Beside the number" is the
 * repository's own habit, and a window is the literal reading of it. At 160 the scan passed
 * `"~2122 NVDA captures"` on `origin/main` because the SAMPLE OUTPUT two paragraphs below it carried a
 * 2026-07-26 timestamp -- an attestation bleeding across a paragraph boundary onto a figure it says
 * nothing about. At 120 that occurrence is flagged and every legitimate one still passes:
 * **9 of 10 figures flagged at `d9521699e`, 0 of 12 at this commit.**
 *
 * **A COMMAND NAMED NEARBY IS NOT AN ATTESTATION.** The first version accepted `training:status` as a
 * named source, and it swallowed that same `"~2122 NVDA captures"` -- the README names the command four
 * lines below, as a thing to run, not as where the number came from. So the only non-date attestation is
 * `manifest.json`: a FILE that holds the number, which a reader can open.
 *
 * ## THE HOLE THIS LEAVES: PROXIMITY IS A PROXY FOR ATTRIBUTION, AND IT CANNOT SAY WHICH FIGURE
 *
 * **AN ATTESTATION INSIDE THE WINDOW ATTESTS EVERY FIGURE INSIDE THE WINDOW.** A date says when SOMETHING
 * was read; nothing in the text says which number it is about. So a stale figure retyped into a paragraph
 * that already carries a date rides that date and passes. `reviewer-2` found this on #2242 by restoring
 * `capture-cache.mjs`'s line 4 alone to main's `"1,061 pairs"`, leaving the next line's
 * `read 2026-09-23T14:26Z` and `manifest.json` in place: the guard stays GREEN. Reproduced at
 * `fbd46362d`, and pinned below as `LIMIT: an attestation in the window attests every figure in it`, so
 * it is a measured boundary rather than a hole nobody has walked into. The mutation that DOES reach the
 * main assertion is the whole block -- attestations and all -- which is what was actually run.
 *
 * **NARROWING THE WINDOW DOES NOT CLOSE IT, AND BINDING THE ATTESTATION TO ONE FIGURE COSTS MORE THAN IT
 * BUYS.** The date in that mutation sits ~60 characters away, inside any window the legitimate 12 survive.
 * The other candidate rule -- an attestation attests only the corpus figure NEAREST to it -- was written
 * and run over these five files before being rejected: it flags 2 of today's 12, both in one README
 * sentence where a single `read 2026-09-23T14:26Z` covers `1,715 cases`, `4,500 captures` and
 * `2,327 page dirs` read at the same moment, and it would demand that one date be retyped three times in
 * three clauses. It does not even close the reported case, where the stale figure is the only figure
 * left in the paragraph and so is its own nearest. A guard that flags correct dated prose is the guard
 * somebody turns off -- the same argument the file list is built on.
 *
 * ## THE POSITIVE CONTROL
 *
 * `flagged` returns [] when every figure is attested, which is the state this file will sit in for the
 * rest of its life. The control is `CONTROL: a bare corpus figure IS flagged, and the same figure dated is
 * not`, below, whose fixture carries a bare `1,061` -- and the tenth figure of the origin-blob test, which
 * drives the same scan over `d9521699e`'s real text. The floor assertion is the other half: a scan that
 * matched nothing would pass having examined nothing.
 */

// requires: history
// `CONTROL ON REAL HISTORY` reads `d9521699e` out of git, and skips honestly without it. Declared here
// rather than left to `deriveClosureRequirements` to infer, because the `History: full` line in the pull
// request body is checked against THIS marker: without it the deepening reads as time spent for nothing
// (`anyCommandUsesHistory`, #497/#621). Unlike `content-preservation`'s pinned pair (#2252), `d9521699e`
// IS an ancestor of `origin/main`, so `git fetch --unshallow origin main` really does reach it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { REPO_ROOT } from "../dataset-paths.mjs";

/**
 * The files an operator acts on. #2155's Region, minus this file.
 *
 * THIS FILE IS NOT IN ITS OWN LIST, and that is not an oversight to tidy: the control below has to carry a
 * bare `1,061` for the guard to flag, so a self-scan would refuse the fixture that proves the guard works.
 * The same device `corpus-readers-are-guarded.test.ts` uses on itself, for the same reason.
 */
const GUARDED_2155 = [
  "packages/lab/src/training/README.md",
  "packages/lab/src/training/capture-cache.mjs",
  "packages/nvda-worker/CLAUDE.md",
  "packages/cli/src/cli.ts",
  "packages/control/src/fleet-status.mjs",
];

/**
 * #2244: THE DEPLOY GUARDS AND THEIR NEIGHBOURS -- what #2155's five files did not reach. Eight files, each
 * guarded for the reason beside it, and none of them a dated record.
 *
 * **Printed to an operator, at the moment of a refusal** (the two that priced a decision wrongly, 2,122
 * where a full re-run is twice the manifest's cases): `protocol-guard.mjs` and `deploy-worker.mjs`.
 * **Stated about the present, about what a protocol bump costs**: `protocol-guard.test.ts`,
 * `check-worker-code.mjs` and `lab-job.test.ts`. **Stated about this repository's contents, falsely**:
 * `cli.test.ts` (the captures are not in this repository). **Quoting a line that no longer exists**:
 * `worker-code-check.mjs` and `stamp-provision-revision.ps1`, which quoted `capture-cache.mjs`'s
 * "invalidating 1,061 pairs" after #2242 reworded it.
 *
 * Listed apart from #2155's five so that `CONTROL ON REAL HISTORY` below, which reads `d9521699e`, is not
 * asked for files that did not carry the figure there, and so that each list's length is pinned by the
 * row that added it.
 */
const GUARDED_2244 = [
  "packages/worker-fleet/src/protocol-guard.mjs",
  "packages/worker-fleet/src/protocol-guard.test.ts",
  "packages/worker-fleet/src/deploy-worker.mjs",
  "packages/worker-fleet/src/check-worker-code.mjs",
  "packages/worker-fleet/src/worker-code-check.mjs",
  "packages/worker-fleet/src/lab-job.test.ts",
  "packages/worker-fleet/src/provisioning/stamp-provision-revision.ps1",
  "packages/cli/src/cli.test.ts",
];

const GUARDED = [...GUARDED_2155, ...GUARDED_2244];

/**
 * A figure counting the corpus: a number, then up to two words, then a corpus noun.
 *
 * The two-word gap is what reaches `"2,122 real captures"` and `"~2122 NVDA captures"`; the `[\s-]`
 * separator is what reaches the adjectival `"1,061-case corpus run"`. `captures?` and not `captured`:
 * `"(1,061 captured, 0 failed)"` is a progress line, and the \b keeps it out.
 */
const CORPUS_FIGURE = /(\d[\d,]*)[\s-]*(?:[A-Za-z][A-Za-z-]*[\s-]+){0,2}(pairs?|cases?|captures?|page files?|page dirs?)\b/g;

/** Below this, a number beside a corpus noun is a sample or a family count. See the header. */
const MIN_CORPUS_FIGURE = 1000;

/** How far either side of the figure an attestation counts as being "beside the number". See the header. */
const ATTESTATION_WINDOW = 120;

/**
 * An as-of date, with or without a time: `2026-09-23`, `2026-09-23T14:26Z`.
 *
 * `(?!\d)` and NOT a trailing `\b`, and the difference is not cosmetic: `\b` after the day requires a
 * non-word character next, and the `T` of `2026-09-23T14:26Z` is a word character -- so a `\b` here
 * rejects every TIMESTAMPED reading, which is the form this repository actually writes. It was written
 * with the `\b` first and flagged 7 of its own 12 attested figures, each with the date visible in the
 * context the refusal printed.
 */
const AS_OF_DATE = /\b20\d\d-\d\d-\d\d(?!\d)/;

/** The one named source that counts: the file that HOLDS the number, never a command that reads it. */
const NAMED_SOURCE = /manifest\.json/;

export type Figure = { rel: string; figure: string; context: string };

/**
 * Every corpus-size figure in `text` with no as-of date and no named source within the window.
 *
 * Returns the CONTEXT and not just the number, for the reason `content-preservation.test.ts` returns the
 * run it matched: a reader handed a bare count cannot judge the window, and a reader handed the text can.
 */
export function flagged(rel: string, text: string): Figure[] {
  const found: Figure[] = [];
  for (const match of text.matchAll(CORPUS_FIGURE)) {
    if (Number(match[1].replace(/,/g, "")) < MIN_CORPUS_FIGURE) continue;
    const at = match.index ?? 0;
    const window = text.slice(Math.max(0, at - ATTESTATION_WINDOW), at + match[0].length + ATTESTATION_WINDOW);
    if (AS_OF_DATE.test(window) || NAMED_SOURCE.test(window)) continue;
    found.push({ rel, figure: match[0], context: window.replace(/\s+/g, " ").trim() });
  }
  return found;
}

/** Every corpus-size figure at or above the floor, attested or not -- the population, so zero flags cannot read as zero examined. */
export function examined(text: string): number {
  return [...text.matchAll(CORPUS_FIGURE)]
    .filter((m) => Number(m[1].replace(/,/g, "")) >= MIN_CORPUS_FIGURE).length;
}

function refusal(found: Figure[], population: number): string {
  const named = found.map((f) => `-> ${f.rel}: ${JSON.stringify(f.figure)}\n   ...${f.context}...`);
  return `${found.length} of ${population} corpus-size figure(s) in #2155's Region carry no as-of date and `
    + `name no source within ${ATTESTATION_WINDOW} characters. The corpus moves -- it went from 1,061 pairs `
    + "to 1,715 cases without one of these sentences looking wrong -- so a bare figure here mis-prices the "
    + "next recapture somebody estimates from the tree. Write the date you read it beside the number, or "
    + `name \`manifest.json\`, or state no figure at all:\n${named.join("\n")}`;
}

/** The guarded files with their text, read once. */
function guardedFiles(): { rel: string; text: string }[] {
  return GUARDED.map((rel) => ({ rel, text: readFileSync(join(REPO_ROOT, rel), "utf8") }));
}

/** Every corpus-size figure across the guarded files, attested or not. */
function population(files: { rel: string; text: string }[]): number {
  return files.map(({ text }) => examined(text)).reduce((a, b) => a + b, 0);
}

/**
 * The floor. An emptiness assertion over a scan that matched nothing is a pass that examined nothing, and
 * this scan CAN empty itself -- a rewrite that drops every figure would. Sized below today's 12 rather
 * than at it, so restating a paragraph does not fail the suite.
 */
const MIN_FIGURES = 8;

test("every corpus-size figure in #2155's Region carries an as-of date or names its source", () => {
  const files = guardedFiles();
  // The control ON THE POPULATION, in this test, because the assertion below is an emptiness one: `found`
  // is [] both when every figure is attested and when the scan looked at nothing at all.
  assert.ok(files.length > 0, "the guarded file list is empty -- this test would examine nothing");
  const examinedCount = population(files);
  assert.ok(examinedCount >= MIN_FIGURES,
    `only ${examinedCount} corpus-size figure(s) matched across ${GUARDED.length} files; the guard is `
    + "examining almost nothing, which is how an emptiness assertion comes to be green for no reason");
  const found = files.flatMap(({ rel, text }) => flagged(rel, text));
  assert.deepEqual(found, [], refusal(found, examinedCount));
});

test("CONTROL: a bare corpus figure IS flagged, and the same figure dated is not", () => {
  // The fixture #2155's done-when 4 names: a bare `1,061`, exactly as `capture-cache.mjs` carried it.
  const bare = "// A full dataset run is 1,061 pairs and ~1.5 h across three workers, and almost all of it";
  assert.deepEqual(flagged("fixture.mjs", bare).map((f) => f.figure), ["1,061 pairs"],
    "a bare four-figure corpus count must be flagged -- this is the line the row was filed about");

  // The same sentence with the date beside it passes. The guard asks WHEN, never WHETHER-IT-IS-CURRENT.
  const dated = "// A full dataset run was 1,061 pairs when it was read, 2026-07-26, and almost all of it";
  assert.deepEqual(flagged("fixture.mjs", dated), [],
    "a dated reading is a record, not a defect -- flagging it would make the guard punish the remedy");

  // And the named source passes on its own, with no date anywhere in the fixture.
  const sourced = "// A full dataset run is 1,061 pairs -- `screenreader-dataset/manifest.json` -> `cases`";
  assert.deepEqual(flagged("fixture.mjs", sourced), [],
    "naming the file that holds the number is the other attestation done-when 3 allows");
});

test("CONTROL: the floor, the noun and the window each decide a case on their own", () => {
  // Below the floor: the README's own benchmark line, correct undated. See the header.
  assert.deepEqual(flagged("fixture.md", "Measured on 10 mixed cases: 318s on one worker, 167s on two"), []);
  // A four-figure number with no corpus noun is not this guard's business.
  assert.deepEqual(flagged("fixture.mjs", "a full run makes ~3,192 worker requests in four hours"), []);
  // `captured` is a progress verb, not a count of captures.
  assert.deepEqual(flagged("fixture.md", "progress: 1,061 captured, 0 failed, 0 skipped"), []);
  // Just outside the window: the same date, pushed past 120 characters, no longer attests.
  const far = `read 2026-07-26.${" ".repeat(ATTESTATION_WINDOW + 1)}A full run is 1,061 pairs.`;
  assert.deepEqual(flagged("fixture.md", far).map((f) => f.figure), ["1,061 pairs"],
    "an attestation a paragraph away is the false negative the window was narrowed to 120 to stop");
});

/**
 * THE LIMIT ABOVE, PINNED IN BOTH DIRECTIONS. An assertion that something is NOT flagged is an emptiness
 * one, so the second half removes the attestation and requires the same figure to BE flagged: what is
 * pinned is proximity failing to ATTRIBUTE, not the scan failing to SEE. If a later rule ever binds an
 * attestation to one figure, this test goes red and is the right place to record what replaced it.
 */
test("LIMIT: an attestation in the window attests every figure in it, so a stale figure beside a date survives", () => {
  // `reviewer-2`'s mutation on #2242, verbatim: `capture-cache.mjs`'s line 4 back to main's text, with the
  // line below it -- the attestation for a figure that this edit has just deleted -- left in place.
  const retyped = [
    "// A full dataset run is 1,061 pairs and ~1.5 h across three workers, and almost all of it is",
    "// `cases`, read 2026-09-23T14:26Z on the lab), and almost all of it is usually unchanged.",
  ].join("\n");
  assert.deepEqual(flagged("fixture.mjs", retyped), [],
    "the known limit: this guard asks whether a date sits beside the number, and cannot ask whether the "
    + "date is ABOUT that number. If this line goes red, the rule changed -- update the header with it");

  // The same text with the attestation gone IS flagged, so the figure is one this scan can see.
  const unattested = retyped.replace("read 2026-09-23T14:26Z on the lab", "read on the lab");
  assert.deepEqual(flagged("fixture.mjs", unattested).map((f) => f.figure), ["1,061 pairs"],
    "with the neighbouring date removed the retyped figure is flagged -- the miss above is attribution, "
    + "not blindness");
});

/**
 * #2155's own Region boundary, pinned. The row is explicit that `docs/`, the ADRs and the incident
 * write-ups hold DATED RECORDS of past populations and are correct as written: *"A builder who widens this
 * Region to reach them has misread the row."* A file list is the one place that misreading would land.
 */
test("the guarded list reaches no dated record -- nothing under docs/, and nothing outside the Region", () => {
  const strays = GUARDED.filter((rel) => rel.startsWith("docs/") || rel.includes("/adr/"));
  assert.deepEqual(strays, [],
    "#2155's Region deliberately excludes docs/ and the ADRs: their 2,122s are records of what a past "
    + "decision cost, and a guard that demanded an as-of date on them would be asking history to restate "
    + `itself. Found: ${strays.join(", ")}`);
  const REGION_FILES_2155 = 5;
  assert.equal(GUARDED_2155.length, REGION_FILES_2155,
    "#2155's Region names five existing files; a sixth is a deliberate edit here, not a glob's doing");
  const REGION_FILES_2244 = 8;
  assert.equal(GUARDED_2244.length, REGION_FILES_2244,
    "#2244's Region adds eight existing files (its ninth is this one, which is not self-scanned); a ninth "
    + "is a deliberate edit here, with the reason it is guarded written above the list");
  assert.equal(GUARDED.length, REGION_FILES_2155 + REGION_FILES_2244);
});

/**
 * THE GUARD AGAINST REAL TEXT, not a fixture. `d9521699e` is the commit this row was built from, where
 * every one of these files still carried the stale figure.
 *
 * **9 of 10, and the tenth is the interesting one.** The figure that passes at that commit is the
 * `progress: 1,061/1,061 cases` inside the README's sample `training:status` block, whose own
 * `run: started 2026-07-26T08:20:19.822Z` line sits four lines above it. That is a dated record and the
 * guard is right to pass it -- which is why the assertion is on the COUNT and the flagged set, rather than
 * "every figure at that commit is flagged".
 *
 * SKIPS HONESTLY when the commit is absent: a shallow checkout has no such object, and a test that
 * silently passed there would report a control it never ran.
 */
test("CONTROL ON REAL HISTORY: 9 of d9521699e's 10 figures are flagged", (t) => {
  const BASE = "d9521699e";
  /** Measured at that commit: 10 corpus-size figures, 9 of them bare. See this test's header. */
  const FIGURES_AT_BASE = 10;
  const FLAGGED_AT_BASE = 9;
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  try {
    git("cat-file", "-e", `${BASE}^{commit}`);
  } catch {
    t.skip(`${BASE} is not in this checkout (a shallow clone). Not run, and not counted as a pass.`);
    return;
  }
  const blobs = GUARDED_2155.map((rel) => ({ rel, text: git("show", `${BASE}:${rel}`) }));
  const found = blobs.flatMap(({ rel, text }) => flagged(rel, text));
  const count = population(blobs);
  assert.equal(count, FIGURES_AT_BASE, "the population at that commit is 10 corpus-size figures");
  assert.equal(found.length, FLAGGED_AT_BASE,
    `the scan flagged ${found.length} of ${count} at ${BASE}: ${found.map((f) => f.figure).join(", ")}`);
  assert.deepEqual(found.filter((f) => /1,061\/1,061/.test(f.context)), [],
    "the one figure that passes there is the sample status block, dated by its own `run: started` line");
});

/**
 * #2244's CONTROL, NOT #2155's. The one above drives the scan over the old five; this one drives it over
 * the eight this row added, at `a4eba30ed`, where every one of them still carried the stale figure. An
 * emptiness assertion over the new entries needs a control that is not the one already shipped for the
 * old ones, or a scan that looked at nothing in the eight would ride on the five.
 *
 * SKIPS HONESTLY when the commit is absent, as the control above does.
 */
test("CONTROL ON REAL HISTORY (#2244): the figures this row removed ARE flagged at a4eba30ed", (t) => {
  const BASE = "a4eba30ed";
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  try {
    git("cat-file", "-e", `${BASE}^{commit}`);
  } catch {
    t.skip(`${BASE} is not in this checkout (a shallow clone). Not run, and not counted as a pass.`);
    return;
  }
  const blobs = GUARDED_2244.map((rel) => ({ rel, text: git("show", `${BASE}:${rel}`) }));
  const found = blobs.flatMap(({ rel, text }) => flagged(rel, text));
  // Every file this row edited for a figure, by name: a per-file assertion, so one file's flags cannot
  // stand in for another's, and an eighth flag in a single file does not read as eight files covered.
  const flaggedIn = new Set(found.map((f) => f.rel));
  // `lab-job.test.ts` is the one file the scan CANNOT see the figure in, and it is a measured limit rather
  // than an oversight: its `2,122 cached` sits at the end of a `//` line and `captures` at the start of the
  // next, and CORPUS_FIGURE's gap admits whitespace and hyphens, not a comment marker. Widening the regex to
  // cross one would move #2155's population (16 figures today) for a wrapped sentence; the file stays listed
  // because the next figure written on ONE line is caught, and the assertion below pins the miss so that a
  // scan that later learns to see it turns this test red rather than leaving the limit unrecorded.
  const WRAPPED = "packages/worker-fleet/src/lab-job.test.ts";
  assert.equal(flaggedIn.has(WRAPPED), false,
    `${WRAPPED} is now flagged at ${BASE}: the scan crosses a wrapped comment, so drop WRAPPED from this test`);
  for (const rel of GUARDED_2244.filter((r) => r !== WRAPPED)) {
    assert.ok(flaggedIn.has(rel), `${rel} carried a stale corpus figure at ${BASE} and the widened scan `
      + `did not flag it; flagged: ${[...flaggedIn].join(", ")}`);
  }
  // The two printed refusals, by their figure, because they are the reason the row exists.
  const printed = found.filter((f) => /protocol-guard\.mjs|deploy-worker\.mjs/.test(f.rel)
    && /2,?122/.test(f.figure));
  const PRINTED_REFUSALS = 2;
  assert.ok(printed.length >= PRINTED_REFUSALS,
    `expected both refusals' 2,122 among the flags, got ${printed.map((f) => f.rel).join(", ") || "none"}`);
});
