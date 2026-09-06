/**
 * A test that CITES the architecture audit and would fail if the finding it closes recurred is the third
 * disposition channel — established in `audit-findings-dispositioned.test.ts` after `vocabulary-parity
 * .test.ts` closed a §9 row neither `docs/architecture-audit.md` nor `docs/backlog.md` reflects, and
 * confirmed as a recurring shape (not a one-off) when `git-hooks-installed.test.ts` did the same for §7.2
 * the same night. Both were found BY HAND, by disbelieving a doc-only grep that reported the row open.
 *
 * That is luck, not method. `grep -rl "architecture audit\|architecture-audit" packages --include="*.ts" |
 * grep '\.test\.'` finds **31** files — the largest of the three disposition channels, and until this file,
 * nothing enumerated it. A finding closed this way is invisible to anyone reading only `docs/`.
 *
 * THIS IS AN ENUMERATION, NOT A FIX. It does not decide whether any citation is still accurate; it makes
 * the population of citing tests, and what each one cites, discoverable and checkable in one place — the
 * same shift `audit-findings-dispositioned.test.ts` made for backlog rows.
 *
 * ## How a citation is read
 *
 * Every `§N` or `§N.N` token in a file's own text is a citation to that section — extracted MECHANICALLY,
 * scanning the whole file as one string rather than line by line, because this repo hard-wraps comment
 * prose and a citation like "docs/architecture-audit.md\n * §4.1)" (`evidence-units-parity.test.ts`) has the
 * marker and the section number on different physical lines. A per-line grep misses exactly this shape —
 * measured while building this file, not assumed: the naive line-by-line version found 21 of the 31 files'
 * citations and silently missed the other 10, several of which DO cite a specific section this way.
 *
 * A file matching the citing pattern with NO `§N` token anywhere is not an error — some genuinely cite the
 * audit's methodology or a general finding rather than a numbered row (`judge-composition.test.ts`: *"per
 * the architecture audit's own closing sentence"*). Those need a human to confirm the absence is real and
 * not a citation spelled without the `§` symbol (`worker-port.test.ts` quotes §9's own row text verbatim
 * with no `§`) — `GENERAL_CITATIONS` below is that confirmation, and it is intentionally the harder path:
 * every entry states WHY no section number, so a future citation that quietly drops its own `§9` does not
 * get grandfathered into "general" by a copy-paste.
 *
 * ## A CLASS, not three coincidences
 *
 * The line-by-line citation miss above, a mutation that silently no-opped against a `* `-wrapped target in
 * `audit-findings-dispositioned.test.ts`, and that same file's backlog-substring check failing on text
 * wrapped the same way, are the SAME defect found three times in one day: in this repo, a citation, a
 * search target or a mutation target is as likely to be split across a `* `-prefixed comment line as not.
 * Match against collapsed full text, never a line — this file's `citedSections` and
 * `audit-findings-dispositioned.test.ts`'s `collapsed()` are the two working examples.
 *
 * ## Search the TITLE, not only the label — corrected 2026-09-06, same day as found
 *
 * `docs/backlog.md` refers to a finding by its TITLE ("A published export the tarball cannot satisfy"),
 * essentially never by the audit's own `§N` label. Two entries below (`adr-status.test.ts`,
 * `exports-are-shipped.test.ts`) were first reported as test-only closures invisible to `docs/backlog.md`
 * on the strength of a literal `"§3.1"`/`"§10.3"` search finding nothing there — which is true and means
 * nothing, because that page was never going to contain that string. Both are dual-channel; see their own
 * entries below for the corrected reading. The lesson is the same shape as the citation-format one above,
 * one level up: a search answered correctly about the wrong population (the LABEL) rather than the real
 * one (the TITLE).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Every `.test.ts` under `packages/`, skipping `node_modules` and `dist` — mirrors this repo's other walkers. */
function testFilesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) testFilesUnder(rel, found);
    else if (entry.name.endsWith(".test.ts")) found.push(rel);
  }
  return found;
}

const CITING_PATTERN = /architecture[ -]audit/i;
const SECTION_PATTERN = /§(\d+(?:\.\d+)*)/g;

/** Files that mention the audit at all, in document order of discovery. PURE given the file list. */
function citingFiles(files: string[]): string[] {
  return files.filter((f) => CITING_PATTERN.test(readFileSync(join(REPO, f), "utf8")));
}

/** Every distinct `§N[.N]` this file's own text names, reading the WHOLE file as one string. */
function citedSections(file: string): string[] {
  const text = readFileSync(join(REPO, file), "utf8");
  return [...new Set([...text.matchAll(SECTION_PATTERN)].map((m) => m[1]))];
}

const ALL_TEST_FILES = testFilesUnder("packages");
const CITING = citingFiles(ALL_TEST_FILES);

test("VACUITY FLOOR -- at least 25 test files cite the architecture audit", () => {
  // 31 measured 2026-09-06. A floor rather than an exact pin: this population only grows as more findings
  // close this way, and pinning it exactly would make an unrelated new citation a spurious failure here.
  // Below 25 means the walk or the citing pattern broke, not that citations were deleted on purpose.
  assert.ok(CITING.length >= 25,
    `found ${CITING.length} file(s) citing the architecture audit, expected at least 25 -- either the walk `
    + "is broken (0 would mean it examined nothing) or the citing pattern no longer matches this repo's "
    + "phrasing");
});

/**
 * Files that cite the audit with NO `§N` token anywhere, and the reason a human confirmed that is real.
 * An unlisted file with no section number fails the coverage test below by name.
 */
const GENERAL_CITATIONS: Record<string, string> = {
  "packages/judge/src/judge-composition.test.ts":
    "cites \"the architecture audit's own closing sentence\" -- a methodological principle (a Map test does "
    + "not prove HTTP idempotency), not a numbered row",
  "packages/lab/src/packaging/backlog-lifecycle.test.ts":
    "mentions `architecture-audit.md` twice, both times as a PRECEDENT for the freeze mechanism itself "
    + "(\"orchestrator had already decided for the architecture-audit section\", \"the FROZEN "
    + "architecture-audit.md already do for the identical reason\") -- no `§N` anywhere in the file "
    + "(checked, not assumed, since this file's own point is that a citation can hide across a line "
    + "break), because it cites the DECISION to freeze docs/backlog.md's own contents, not any one "
    + "numbered finding inside the audit",
  // The next six cite a SPECIFIC finding by quoted phrase rather than by `§N` -- read individually rather
  // than assumed, because "no § token" and "no specific finding" are different claims and this file exists
  // to stop conflating them.
  //
  // TWO OF THESE WERE FIRST MISCLASSIFIED AS TEST-ONLY CLOSURES INVISIBLE TO docs/backlog.md, and they are
  // not -- CORRECTED 2026-09-06, same day. `docs/backlog.md` refers to findings by TITLE ("A published
  // export the tarball cannot satisfy", "Seven ADRs said Proposed while the index called them accepted"),
  // never by the audit's `§N` label -- so a search for the literal string "§3.1" or "§10.3" finds nothing,
  // and reads as "not tracked" when it is. That is this exact file's own lesson, one turn later: a search
  // answered correctly about the wrong population (the LABEL) when the real population is the TITLE.
  // `grep -c "3\.1\b" docs/backlog.md` alone returns 11 hits -- even a loose numeric search would have
  // caught it. Both are dual-channel, exactly like the other four below; the near-miss is recorded because
  // it is more useful than a silent fix would have been.
  "packages/lab/src/packaging/adr-status.test.ts":
    "closes §10.3 (\"seven status mismatches\") by quoted content -- ADRs 0001, 0003-0008 -- never by "
    + "`§10.3` itself. ALSO in docs/backlog.md:393 (\"Seven ADRs said `Proposed` while the index called "
    + "them accepted\" -- CLOSED, with the index as the authority) -- dual-channel, not test-only",
  "packages/lab/src/packaging/exports-are-shipped.test.ts":
    "closes §3.1 (\"a published export the tarball cannot satisfy\") by quoting the exact cli-flags/files "
    + "mismatch, never by `§3.1` itself. ALSO in docs/backlog.md:407 (struck through, \"FIXED `5374691`\", "
    + "naming this exact test by filename) -- dual-channel, not test-only",
  "packages/lab/src/packaging/git-hooks-installed.test.ts":
    "closes §7.2's hooks row by quoting its heading (\"gates that exist and run nowhere automated\") and its "
    + "exact wording (\"no prepare, no postinstall\"), never by `§7.2` itself",
  "packages/lab/src/packaging/pre-commit-hook.test.ts":
    "the sibling of git-hooks-installed.test.ts for the pre-COMMIT half specifically, same §7.2 hooks row, "
    + "same citation-by-quote-not-number shape",
  "packages/lab/src/packaging/python-ci-requirements.test.ts":
    "closes §7.2's pytest row (\"the 30 pytest files\") by quoting its heading, never by `§7.2` itself -- "
    + "already independently confirmed CLOSED in docs/backlog.md (\"§7.2 no Python in CI\")",
  "packages/worker-fleet/src/worker-port.test.ts":
    "closes §9's worker-port row by quoting it VERBATIM (\"a change to `worker_port` splits the role from "
    + "every other consumer silently\"), never by `§9` itself -- already independently confirmed via "
    + "docs/backlog.md (\"One worker port declared three times in three languages\")",
};

const uncited = CITING.filter((f) => citedSections(f).length === 0);

test("every citing file with no §N resolves to a confirmed-general reason", () => {
  const unclassified = uncited.filter((f) => !(f in GENERAL_CITATIONS));
  assert.deepEqual(unclassified, [],
    "the file(s) above cite the architecture audit with no `§N` token anywhere and are not in "
    + "GENERAL_CITATIONS -- either add an entry stating why the citation is genuinely general (methodology, "
    + "not a numbered row), or read the file: this repo hard-wraps comment prose, and a `§N` split across a "
    + "line break needs the WHOLE-FILE scan this test already does, not a fix here");
});

test("GENERAL_CITATIONS names no file that actually has a §N citation", () => {
  // The mirror image: an entry here for a file that DOES cite a section is worse than a missing entry --
  // it would hide a real, checkable citation behind an unearned "general" label.
  const wronglyGeneral = Object.keys(GENERAL_CITATIONS).filter((f) => citedSections(f).length > 0);
  assert.deepEqual(wronglyGeneral, [],
    "the file(s) above are listed in GENERAL_CITATIONS but DO cite a §N section -- remove the entry and let "
    + "the mechanical extraction classify it");
});

test("GENERAL_CITATIONS names only files that actually cite the audit", () => {
  const stale = Object.keys(GENERAL_CITATIONS).filter((f) => !CITING.includes(f));
  assert.deepEqual(stale, [],
    "the file(s) above are listed in GENERAL_CITATIONS but no longer cite the architecture audit at all -- "
    + "the citation was removed (the file may have been rewritten to close something else) and the entry is "
    + "now stale");
});

/**
 * THE MAP ITSELF: every citing file, and which section(s) it names or "general". Read by
 * `printCitationIndex` below on request, and by anyone extending `audit-findings-dispositioned.test.ts` to
 * a new section -- checking this list first answers "has a test already closed part of this" before
 * spending an investigation re-finding what `git-hooks-installed.test.ts` already proved once.
 */
function citationIndex(): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const file of CITING) {
    const sections = citedSections(file);
    index[file] = sections.length ? sections : ["general"];
  }
  return index;
}

test("the citation index covers every discovered file exactly once", () => {
  const index = citationIndex();
  assert.deepEqual(Object.keys(index).sort(), [...CITING].sort(),
    "the index's file list has drifted from the discovered CITING list -- citationIndex() and citingFiles() "
    + "must walk the same population");
});

if (process.env.PRINT_AUDIT_CITATIONS) {
  const index = citationIndex();
  for (const [file, sections] of Object.entries(index).sort()) {
    process.stdout.write(`${file}: ${sections.map((s) => (s === "general" ? s : `§${s}`)).join(", ")}\n`);
  }
}
