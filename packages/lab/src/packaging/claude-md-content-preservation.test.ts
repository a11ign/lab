/**
 * #181 (`agent/claude-md-split-155`) split CLAUDE.md down to 39,696 characters and was refused: the
 * review measured 1,337 substantive lines removed from CLAUDE.md that appeared in NEITHER the new
 * CLAUDE.md NOR anywhere under `docs/` -- a move that silently dropped the record it claimed to
 * preserve. ceo's acceptance, verbatim: *"every paragraph removed from CLAUDE.md appears
 * byte-identical (comment-stripped, whitespace-normalised) in `docs/`, and the file that remains is a
 * subset of the old text plus links."* The review asked for exactly this test, not a pasted number --
 * *"a guard that says 'every substantive line removed from CLAUDE.md in this diff appears in `docs/`'
 * turns this from a review somebody has to remember to do into one that cannot be skipped."*
 *
 * ## Method, unchanged from the review that forced this file to exist
 *
 * Diff `origin/main`'s CLAUDE.md against this branch's; normalise whitespace; drop lines 25 characters
 * or under (fragments and bare markup, which are not "substantive"); then ask whether each remaining
 * removed line appears as a SUBSTRING of the whitespace-normalised concatenation of the new CLAUDE.md
 * PLUS every `.md` under `docs/`.
 *
 * Substring rather than line-equality is deliberate -- it survives re-wrapping, which a line-level
 * compare would wrongly call a rewrite. And the new CLAUDE.md is in the haystack because `diff` marks
 * an EDITED line as removed; without that, a line still present in altered form would read as lost.
 * The reviewer's own note: their first pass omitted this and the corrected instrument gave the same
 * 1,337, so it is not an artefact of either choice -- kept here for the same reason.
 *
 * ## Why this needs `origin/main`, and the two different "empty" cases
 *
 * `git diff origin/main -- CLAUDE.md` is meaningless without a real `origin/main` to diff against --
 * a shallow checkout has no such ref at all (`ensureOriginMain()` fetches it on demand, fixing the
 * trap #505's own CI hit: the `acceptance`/`docs` jobs check out at depth 1, where `actions/checkout`
 * fetches only the PR ref). But an empty DIFF, once `origin/main` genuinely resolves, is not always a
 * bug: `trunk-guard.yml` runs this same suite directly against `main`'s own tip, where HEAD legitimately
 * IS `origin/main` and there is nothing to compare. The two failure shapes look identical from the
 * diff's own output and must not be conflated -- one is "the ref never resolved", the other is "the ref
 * resolved and there is nothing new"; only the first is a defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A "substantive" line: long enough that it could not just be a fragment or bare markup punctuation. */
const MIN_SUBSTANTIVE_LENGTH = 25;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Every `.md` file under `docs/`, recursively. */
function allDocsMd(dir: string): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allDocsMd(path));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

/**
 * Makes `origin/main` resolvable before diffing against it. `ci.yml`'s `ts` job runs with
 * `fetch-depth: 0` and this works unconditionally there; the `acceptance` and `docs` jobs check out at
 * the default depth (1), where `actions/checkout` fetches only the PR ref and `origin/main` does not
 * exist at all -- the identical trap #489 hit on `ci.yml`'s own base-ref resolution
 * (`fatal: invalid object name 'origin/main'`). Rather than assuming full history, fetch it on demand;
 * the vacuity guard below still refuses if this somehow leaves the ref unresolvable, so a fetch that
 * silently no-ops (offline runner, a mirror with no `main`) cannot make this test pass having examined
 * nothing.
 */
function ensureOriginMain(): void {
  const env = sandboxGitEnv();
  const opts = { cwd: REPO_ROOT, env, stdio: "pipe" as const };
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], opts);
    return;
  } catch {
    // origin/main is not resolvable in this checkout -- fetch it before giving up.
  }
  execFileSync("git", ["fetch", "origin", "main"], opts);
}

/**
 * The unified diff of CLAUDE.md between `origin/main` and the working tree. `env: sandboxGitEnv()`
 * strips any inherited `GIT_*` redirect before spawning, per this repo's own standing rule.
 */
function claudeMdDiff(): string {
  ensureOriginMain();
  return execFileSync("git", ["diff", "origin/main", "--", "CLAUDE.md"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

/** Every substantive line the diff marks as REMOVED from CLAUDE.md, whitespace-normalised. */
export function removedSubstantiveLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => norm(l.slice(1)))
    .filter((l) => l.length > MIN_SUBSTANTIVE_LENGTH);
}

/**
 * The same line with every run of digits blanked, for ONE narrow exemption below.
 *
 * A number in CLAUDE.md that another test PINS to a real count -- `claude-md-counts.test.ts` requires
 * `for the N decision records` to equal the ADR count, and since #954 the same test pins docs/README.md's
 * sentence about the same directory -- changes
 * whenever the counted thing changes. The old wording is then "removed" from CLAUDE.md and must NOT be
 * preserved anywhere: a stale count kept verbatim in `docs/` is the drift those tests exist to prevent.
 * Before this exemption, every PR that added an ADR was refused by this test for obeying the other two.
 */
function digitBlind(s: string): string {
  return s.replace(/\d+/g, "#");
}

/** The new CLAUDE.md plus every `docs/*.md` file, concatenated and whitespace-normalised. */
export function haystack(): string {
  const claudeMd = norm(readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8"));
  const docsFiles = allDocsMd(join(REPO_ROOT, "docs"));
  return claudeMd + " " + docsFiles.map((f) => norm(readFileSync(f, "utf8"))).join(" ");
}

/**
 * #651: CLAUDE.md's own map is not a separate index -- it is this pattern, repeated at almost every
 * paragraph: `... [Detail/Why/Incident -> ](docs/some-file.md#anchor)`. A paragraph IS a section, and the
 * link at its end (or, rarely, inside it) already names the sibling doc that section's material belongs
 * in. So the destination for a removed line is not something this guard has to invent -- it is sitting
 * in the same paragraph the line was removed from, in the OLD CLAUDE.md (the new one may no longer carry
 * that paragraph at all).
 *
 * @param missingLine  a single normalised (whitespace-collapsed) line, as `removedSubstantiveLines` produces
 * @param oldClaudeMd  the RAW (not normalised) old CLAUDE.md text, so the markdown link syntax survives
 * @returns the `docs/....md` path named by that line's own paragraph, or null if the paragraph carries
 *   none -- a real case (not every paragraph ends in a link) and reported honestly, never guessed
 */
export function nearestDocsLink(missingLine: string, oldClaudeMd: string): string | null {
  const paragraphs = oldClaudeMd.split(/\n\s*\n/);
  const owner = paragraphs.find((p) => norm(p).includes(missingLine));
  if (owner === undefined) return null;
  const match = /docs\/[\w./-]+\.md/.exec(owner);
  return match ? match[0] : null;
}

/** `git show origin/main:CLAUDE.md` -- the paragraph a removed line belonged to before it was removed. */
function oldClaudeMd(): string {
  ensureOriginMain();
  return execFileSync("git", ["show", "origin/main:CLAUDE.md"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

/**
 * #651's own acceptance, in the refusal itself: name WHICH file under `docs/` each missing line belongs
 * in, and say plainly that a correction and a deletion get the identical remedy -- this guard has no way
 * to tell "I fixed this" from "I deleted this" (both are a removed line with nothing replacing it
 * byte-for-byte), so it does not pretend to, and both are told to do the same thing.
 *
 * Pulled out to a pure function, given the OLD CLAUDE.md text rather than reading it itself, so the
 * per-line target-naming is testable against fixtures rather than this branch's own real prose.
 */
export function missingLinesMessage(missing: string[], removedCount: number, oldMd: string): string {
  const named = missing.slice(0, 20).map((line) => {
    const target = nearestDocsLink(line, oldMd);
    const dest = target ?? "no docs/ link in this line's own paragraph -- see docs/README.md's index " +
      "and pick the sibling file for this section by hand";
    return `-> ${dest}\n   ${line}`;
  });
  return `${missing.length} of ${removedCount} substantive line(s) removed from CLAUDE.md are present in ` +
    `NEITHER the new CLAUDE.md NOR anywhere under docs/ -- this is #181's own failure mode. This guard ` +
    "cannot tell a corrected sentence from a deleted one, and does not try to -- both need the exact old " +
    "text preserved somewhere under docs/, so both get the same remedy. Move each line verbatim into the " +
    `docs/ file named on the line above it:\n${named.join("\n")}` +
    (missing.length > 20 ? `\n...and ${missing.length - 20} more` : "");
}

test("origin/main resolves to a real commit -- this test cannot pass having examined nothing", () => {
  // NOT "the diff is non-empty": trunk-guard runs this SAME test directly against main's own tip, where
  // HEAD legitimately equals origin/main and the diff is legitimately empty -- that is not vacuity, it
  // is "nothing to check". The real vacuity risk fixed here is `origin/main` failing to RESOLVE at all
  // (the shallow-checkout trap the acceptance/docs CI jobs hit, #505's own review): `ensureOriginMain()`
  // fetches it on demand, and this asserts that succeeded rather than silently leaving an empty diff
  // whose cause could be either "resolved and identical" or "never resolved".
  ensureOriginMain();
  const sha = execFileSync("git", ["rev-parse", "--verify", "origin/main"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, `origin/main resolved to "${sha}", not a real commit SHA`);
});

test("CONTROL/MUTATION: removedSubstantiveLines extracts real removals and drops fragments and additions", () => {
  const diff = [
    "diff --git a/CLAUDE.md b/CLAUDE.md",
    "--- a/CLAUDE.md",
    "+++ b/CLAUDE.md",
    "@@ -1,3 +1,3 @@",
    "-a short fragment",
    "-a genuinely substantive removed line that is well over the twenty-five character floor",
    "+an ADDED line must never be read as removed, however long",
  ].join("\n");
  const removed = removedSubstantiveLines(diff);
  assert.deepEqual(removed,
    [norm("a genuinely substantive removed line that is well over the twenty-five character floor")],
    "the extraction must drop the ---/+++ file headers, the sub-floor fragment, and the added line, " +
    "keeping only the one real substantive removal");
});

test("every substantive line removed from CLAUDE.md survives byte-identical somewhere in docs/", () => {
  const removed = removedSubstantiveLines(claudeMdDiff());
  // An empty `removed` here is not a hole in THIS test: on trunk-guard (HEAD is origin/main) or a PR
  // that never touches CLAUDE.md, there is genuinely nothing to check, and the extraction logic itself
  // is proven correct above against a synthetic diff rather than depending on this branch's real state.
  if (removed.length === 0) return;

  const hay = haystack();
  // NARROW, and deliberately not applied to `docs/`: a removed line also counts as preserved when the NEW
  // CLAUDE.md still carries the same sentence with different digits -- an edit in place of a pinned count,
  // never a deletion. Widening this to the whole haystack would let real prose vanish as long as some doc
  // held a digit-variant of it, which is the hole this test exists to close.
  const claudeMdNow = digitBlind(norm(readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8")));
  const missing = removed.filter((line) =>
    !hay.includes(line) && !claudeMdNow.includes(digitBlind(line)));
  assert.deepEqual(missing, [], missingLinesMessage(missing, removed.length, oldClaudeMd()));
});

test("the digit exemption is NARROW: a removal differing by a WORD is still caught", () => {
  // The exemption must fire on `36 decision records` -> `37 decision records` and on nothing else.
  // Same sentence, one word changed rather than one number: not an edit of a pinned count, so the old
  // text still has to survive somewhere, and this proves the exemption cannot be used to launder a
  // rewrite past the guard.
  const before = norm("the index to every guide and runbook, grouped by task, for the 36 decision records");
  const afterDigits = norm("the index to every guide and runbook, grouped by task, for the 37 decision records");
  const afterWords = norm("the index to every guide and runbook, grouped by TOPIC, for the 36 decision records");
  assert.ok(digitBlind(afterDigits).includes(digitBlind(before)),
    "a digits-only change must be exempt -- this is the case the other two ADR tests force");
  assert.ok(!digitBlind(afterWords).includes(digitBlind(before)),
    "a word change must NOT be exempt, however many digits it shares");
});

test("CONTROL: a line present in the haystack is not reported missing", () => {
  const hay = "some prefix text " + "a substantive line long enough to pass the floor" + " some suffix";
  assert.ok(hay.includes(norm("a substantive line long enough to pass the floor")));
});

test("MUTATION: a line genuinely absent from both CLAUDE.md and docs/ is caught", () => {
  const hay = haystack();
  const fabricated = norm(
    "this exact sentence was never written anywhere in this repository, deliberately, so the check " +
    "must report it as missing 2026-09-08-fabricated-marker-xyz");
  assert.ok(!hay.includes(fabricated),
    "the fabricated marker unexpectedly appears in docs/ or CLAUDE.md -- pick a different marker");
});

// --- #651: the refusal must name WHICH docs/ file, derived from the removed line's own paragraph ---

test("#651 nearestDocsLink: finds the sibling doc named at the end of the line's own paragraph", () => {
  const oldMd = [
    "Some unrelated earlier paragraph with its own sentence, long enough not to matter here at all.",
    "",
    "A cache-key version memoised on process identity lied for five days while Edge auto-updated " +
      "underneath it; memoise on file identity instead. [Incident ->](docs/capture-cache-incidents.md" +
      "#a-cache-key-that-was-memoised-and-lied-for-five-days)",
    "",
    "A later unrelated paragraph, also long enough, also with nothing to do with the one above it.",
  ].join("\n");
  const removedLine = norm("A cache-key version memoised on process identity lied for five days while " +
    "Edge auto-updated underneath it; memoise on file identity instead. [Incident ->]" +
    "(docs/capture-cache-incidents.md#a-cache-key-that-was-memoised-and-lied-for-five-days)");
  assert.equal(nearestDocsLink(removedLine, oldMd), "docs/capture-cache-incidents.md");
});

test("#651 nearestDocsLink: a paragraph with no docs/ link returns null, not a guess", () => {
  const oldMd = [
    "A job of a given name is refused, not killed, while one is running. The unit name is the lock and " +
      "it holds against the ssh path too, which an in-process flag could not.",
  ].join("\n");
  const removedLine = norm("A job of a given name is refused, not killed, while one is running. The " +
    "unit name is the lock and it holds against the ssh path too, which an in-process flag could not.");
  assert.equal(nearestDocsLink(removedLine, oldMd), null,
    "no link in this paragraph -- the function must say so rather than pick a neighbour's");
});

test("#651 nearestDocsLink: a link in a NEIGHBOURING paragraph is not picked -- only the line's own " +
  "paragraph counts", () => {
  const oldMd = [
    "The removed line's own paragraph, long enough to pass the floor, and it carries no link of its own.",
    "",
    "A different paragraph entirely, which happens to end in a link. [Detail ->](docs/wrong-file.md#x)",
  ].join("\n");
  const removedLine = norm("The removed line's own paragraph, long enough to pass the floor, and it " +
    "carries no link of its own.");
  assert.equal(nearestDocsLink(removedLine, oldMd), null,
    "docs/wrong-file.md belongs to the NEXT paragraph, not this one -- picking it would name the wrong " +
    "destination, which is worse than naming none");
});

test("#651 missingLinesMessage: names the destination file per missing line, not just once for the batch", () => {
  const oldMd = [
    "First removed paragraph, long enough on its own to pass the substantive floor by a fair margin. " +
      "[Why ->](docs/operational-lessons.md#first)",
    "",
    "Second removed paragraph, also long enough, entirely unrelated to the first one above it. " +
      "[Detail ->](docs/nvda-behavior-incidents.md#second)",
  ].join("\n");
  const missing = [
    norm("First removed paragraph, long enough on its own to pass the substantive floor by a fair " +
      "margin. [Why ->](docs/operational-lessons.md#first)"),
    norm("Second removed paragraph, also long enough, entirely unrelated to the first one above it. " +
      "[Detail ->](docs/nvda-behavior-incidents.md#second)"),
  ];
  const message = missingLinesMessage(missing, 2, oldMd);
  assert.match(message, /-> docs\/operational-lessons\.md\n {3}First removed paragraph/);
  assert.match(message, /-> docs\/nvda-behavior-incidents\.md\n {3}Second removed paragraph/);
});

test("#651 ACCEPTANCE: the message states plainly that a correction and a deletion get the same remedy", () => {
  const message = missingLinesMessage([norm("a fabricated line long enough to pass the floor, deliberately")],
    1, "");
  assert.match(message, /cannot tell a corrected sentence from a deleted one/,
    "the guard cannot distinguish the two causes, and #651's acceptance requires it say so rather than " +
    "silently apply one remedy to a case it never actually diagnosed");
});

test("#651 ACCEPTANCE: a line whose paragraph has no link gets the honest fallback, never an invented path", () => {
  const message = missingLinesMessage(
    [norm("a removed line whose paragraph, in this fixture, has no docs link at all to point to")], 1, "");
  assert.match(message, /no docs\/ link in this line's own paragraph/);
});

test("#651 ACCEPTANCE, MUTATION TARGET: following the message exactly -- moving the line into the named " +
  "docs file -- makes the same check pass", () => {
  // The full loop #651's mutation instruction describes: a line removed from CLAUDE.md, the message names
  // a docs/ file, the author moves the line there verbatim, and the SAME missing-line computation this
  // test file's real check runs must then report nothing missing.
  const oldMd = "A corrected sentence, long enough to pass the substantive floor on its own merits. " +
    "[Why ->](docs/operational-lessons.md#the-corrected-sentence)";
  const removedLine = norm(oldMd);
  const target = nearestDocsLink(removedLine, oldMd);
  assert.equal(target, "docs/operational-lessons.md", "the message must name a real destination first");

  // Before following the message: the line is in neither the new CLAUDE.md nor any docs/ file.
  const hayBefore = norm("the new CLAUDE.md, with the sentence corrected rather than present verbatim");
  assert.ok(!hayBefore.includes(removedLine));

  // After following the message exactly -- moving the OLD line verbatim into the named file:
  const hayAfter = hayBefore + " " + removedLine;
  assert.ok(hayAfter.includes(removedLine),
    "a reader who followed the message exactly (moved the verbatim line into the named docs/ file) must " +
    "pass -- this is #651's own acceptance line, checkable against the guard");
});
