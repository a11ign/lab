/**
 * THE PUBLISH MACHINERY MAY NOT DESCRIBE A WORLD THAT ENDED. #2052.
 *
 * `release.yml`'s header stated, in the present tense, that nothing had ever been published and that
 * `.changeset/config.json` read `restricted`. Both were TRUE WHEN WRITTEN and both stopped being true on
 * 2026-09-19, when `a11ign@0.1.0` and five `@a11ign/*` packages went to the public registry. On
 * 2026-09-23 a session working #1567 read that header first, drew the conclusion it states, and left five
 * milestone rows standing behind a fleet provision that was already unblocked. A direct registry read is
 * what reversed it.
 *
 * This is the worst shape of wrong comment by this repo's own standard: not noise restating the code, but
 * an intent-and-consequence comment that WAS right. CLAUDE.md's rule is to keep exactly this kind of
 * comment, which is why #2052 corrected the five copies rather than deleting them — and why this file
 * exists, since correcting them again in six months is not a mechanism.
 *
 * TWO GUARDS, AND ONLY THE FIRST CAN BE SAID TO PREVENT RECURRENCE:
 *
 *   1. `accessQuotations` DERIVES every place the machinery quotes the access setting, and this test reads
 *      `.changeset/config.json` ONCE and compares each quotation against it. The population is found, not
 *      listed, so a new quoting line is covered the day it is written. This is the clause that cannot
 *      drift: the two things are read from the same run.
 *   2. `staleClaims` matches a NAMED family of "not published yet" phrasings. It catches the six real
 *      lines #2052 found — they are the fixtures below — and it will not catch a seventh phrased freshly.
 *      Said plainly rather than implied: this half is a tripwire on known wording, not a proof.
 *
 * WHY THE FILE SET IS NAMED AND NOT WALKED, which is the judgement in this file. A repo-wide walk finds
 * `docs/publish-blocker.md`, `docs/not-working.md`, `docs/backlog.md`, `PLAN.md` and
 * `docs/architecture-audit.md` — and #2052 ruled every one of them OUT, because **a claim that carries its
 * own date is a RECORD and stays, while a present-tense claim has nothing keeping it true.** Their dates
 * live in section headings (`## What exists today, checked 2026-09-06`) and closed-row blockquotes, not on
 * the line, so no line-level rule can tell them from the defect; `docs/architecture-audit.md` is FROZEN by
 * `architecture-audit-is-frozen.test.ts`, and editing it to stay current is the exact failure that freeze
 * exists to stop. So the population here is MACHINERY — the files that instruct the next publish, where a
 * stale claim misdirects a run — and `.changeset/` plus `.github/workflows/` are walked rather than listed
 * so a new workflow or changeset document joins the population by existing.
 *
 * ONE `docs/` FILE JOINED IT AFTERWARDS, AND THE EXCLUSION ABOVE IS THE REASON IT COULD — #2058.
 * That exclusion rests on a PROPERTY, not on a directory: those files carry their dates in headings and
 * closed-row blockquotes, so no line-level rule can tell their records from the defect.
 * `docs/reliability-plan.md` does not have the property. Measured at `621425d3a`: its two B3 sections
 * carried no `checked <date>` heading and no closed-row blockquote, its three quotations of the access
 * setting were all present-tense — two of them reading `restricted` nine days after the config said
 * otherwise — and it holds a live instruction to whoever publishes ("Before a real publish, run the full
 * gate on the lab"). #2058 corrected it on exactly #2052's record-versus-present-tense line, which is what
 * puts it here. It is NAMED and not reached by widening the walk, because `docs/` also holds the records
 * that must not be touched and a walk would collect them too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";

const REPO = resolve(import.meta.dirname, "../../../..");

/** The access setting as the file ACTUALLY reads, read once and never restated. Everything else is compared to it. */
const CONFIG_ACCESS: string = JSON.parse(readFileSync(resolve(REPO, ".changeset/config.json"), "utf8")).access;

/** The date the first release reached the registry — `npm view a11ign time`, re-read 2026-09-23. */
const PUBLISHED_ON = "2026-09-19";

/** The gates the header enumerates, named in `release.yml`'s own words: "SEVEN INDEPENDENT THINGS". */
const GATE_COUNT = 7;
const SEVEN_GATES = Array.from({ length: GATE_COUNT }, (_unused, index) => index + 1);

/**
 * A floor on the walk, not a count of it. The workflows directory holds dozens of files; a walk returning
 * fewer than this has lost the directory, which is the failure that would make every assertion below pass
 * by checking nothing.
 */
const FEWEST_PLAUSIBLE_MACHINERY_FILES = 10;

/**
 * The same kind of floor for `packages/`, which the changelog walk below must be SEEN to reach. Eight
 * package directories carry a manifest today (eleven before #3447 took `nvda-worker` and `nvda-speech` out of the workspace, nine before #3504 took `worker-fleet`); a run that enumerates fewer than this has lost the
 * directory, and the emptiness assertion it feeds would then be reporting a walk that never looked.
 */
const FEWEST_PLAUSIBLE_PACKAGES = 8;

/**
 * The three files #2052 measured as carrying a stale claim, and therefore the three that must still be
 * REACHED by the rules below. This is the named half of the population: the walk finds sites, this names
 * the files whose coverage was proven by measurement, so a rule that quietly stopped matching any of them
 * fails rather than reporting an agreement it never checked.
 */
const CORRECTED_BY_2052 = [
  ".github/workflows/release.yml",
  ".changeset/README.md",
  "packages/lab/src/packaging/release-safety.test.ts",
];

/** The one `docs/` file in the population — see the docblock for the property that lets it in (#2058). */
const RELIABILITY_PLAN = "docs/reliability-plan.md";

/**
 * Every file MEASURED to quote the access setting in the present tense, and therefore every file the
 * comparison below must be seen to reach. The floor is per file rather than a count, because a rule that
 * quietly stopped matching one of them would report an agreement it never checked.
 */
const MUST_BE_COMPARED = [...CORRECTED_BY_2052, RELIABILITY_PLAN];

/**
 * Files that INSTRUCT the next publish, as opposed to recording a past one.
 *
 * `.changeset/` and `.github/workflows/` are walked, not listed: the defect #2052 found was a copy in a
 * file nobody thought to check, so a new one must join this population without anybody remembering to add
 * it. `release-safety.test.ts` is named because it is the guard ON this machinery and its docblock carried
 * the same false claim while its own guard-4 body recorded the truth.
 */
function machineryFiles(): string[] {
  const walked = [".changeset", ".github/workflows"].flatMap((dir) =>
    readdirSync(resolve(REPO, dir))
      .filter((name) => /\.(ya?ml|md)$/.test(name))
      .map((name) => join(dir, name)));
  return [...walked, "packages/lab/src/packaging/release-safety.test.ts", RELIABILITY_PLAN].sort();
}

export type Quotation = { file: string; line: number; value: string; text: string };

/**
 * The phrasings that bind a quoted value to a moment that has PASSED, which is what makes a line a record
 * of its own moment rather than a claim about now. #2052's ruling made mechanical.
 *
 * A NAMED VOCABULARY, AND NOT "THE LINE HAS A DATE ON IT", which is what this file shipped at `9d201937`
 * and what reviewer-2 refused. Their mutation: take `release.yml`'s live gate requirement, flip its quote
 * to `restricted`, append `(checked 2026-09-23)` — and all nine tests passed. `checked <date>` records
 * when somebody LOOKED; it says nothing about whether the claim is about the past, so a stale quote could
 * evade this guard by carrying any date at all. **A date is not evidence of a record. A date bound to a
 * past boundary is.**
 *
 * The two rules fail in OPPOSITE directions, and that — not the wording — is the argument. A bare date
 * test fails OPEN: an unforeseen line is dropped from the population silently and the guard reports an
 * agreement it never checked, which is the exact failure `the machinery population … is not empty` exists
 * to catch one level up. This list fails CLOSED: a genuine record phrased in a way not listed here is
 * REPORTED, and a human either rephrases the line or adds the form. The cost of being wrong here is a red
 * test somebody reads; the cost of being wrong there was a silent hole.
 *
 * Both live exemptions in the tree are this one shape, and `the exemption's whole live population` below
 * pins that they are the only two.
 */
const RECORD_MARKERS: readonly RegExp[] = [
  // "It read `restricted` until 2026-09-14" (.changeset/README.md) and "Until 2026-09-14 this asserted
  // `restricted`" (release-safety.test.ts) — the date is the END of the value's life, on either side of it.
  /\b(?:until|up until|before|prior to|up to)\s+\d{4}-\d{2}-\d{2}\b/i,
];

/** Does this line bound its quoted value to a moment that has passed, rather than merely mention a date? */
export function isDatedRecord(line: string): boolean {
  return RECORD_MARKERS.some((pattern) => pattern.test(line));
}

/**
 * Every place in one file that QUOTES a value for the changeset access setting.
 *
 * A quoted `public` or `restricted` in the publish machinery means the access setting and nothing else —
 * verified against all three files #2052 touched, where every quoted occurrence was one. Quoting is what
 * is required: `public registry` in prose is not a claim about the config, and demanding the word `access`
 * on the same LINE was tried and rejected, because `release.yml`'s guard error message — the one copy a
 * human reads at the moment of publishing — quotes `'restricted'` two lines below the `access=` it belongs
 * to. That near-miss is exactly how the filed open-check on #2052 matched two of five sites.
 *
 * A LINE THAT BINDS ITS VALUE TO A PAST MOMENT IS EXEMPT — see `RECORD_MARKERS`, which is that test and
 * the reason it is not simply "the line has a date on it".
 */
export function accessQuotations(file: string, text: string): Quotation[] {
  return text.split("\n").flatMap((line, index) => {
    if (isDatedRecord(line)) return [];
    return [...line.matchAll(/[`'"](public|restricted)[`'"]/g)].map((match) => ({
      file,
      line: index + 1,
      value: match[1],
      text: line.trim(),
    }));
  });
}

/** The quotations that disagree with what the config file actually says. Takes the value so a FIXTURE value can be passed. */
export function accessMismatches(quotations: Quotation[], access: string): Quotation[] {
  return quotations.filter((quotation) => quotation.value !== access);
}

/**
 * The "not published yet" phrasings #2052 found, each one matched by a real line it corrected.
 *
 * Deliberately NOT a general "does this sentence deny publication" rule: that needs intent, and inferring
 * intent is the defect this row is about one level up. The honest description is a tripwire on the wording
 * that already went stale once.
 */
const STALE_CLAIMS: readonly RegExp[] = [
  // "nothing has been pushed to any registry" / "No package has been published yet ... registry"
  /\b(?:nothing|no package|none)\b[^.\n]{0,100}\b(?:published|pushed)\b[^.\n]{0,60}\b(?:registry|npm)\b/i,
  // "Nothing has been published to any registry"
  /\b(?:has|have|been)\s+published\s+to\s+any\s+registry\b/i,
  // "IT PUBLISHES NOTHING TODAY" — a dry run publishing nothing is a different, still-true statement.
  /\bpublishes\s+nothing\s+today\b/i,
  // "the name is undecided (PLAN.md B5)"
  /\bname\s+is\s+(?:still\s+)?undecided\b/i,
  // "under a name we may not keep"
  /\bname\s+we\s+(?:may|might)\s+not\s+keep\b/i,
  // "until PLAN.md B5 (the name) is settled" — the dry-run message and the old gate-4 rationale.
  /\b(?:until|before)\s+(?:PLAN\.md\s+)?B5\b[^.\n]{0,20}(?:\(the name\)\s*)?is\s+settled\b/i,
  // "Change this to `public` in the same change that cuts the first release, not before." An instruction
  // to perform a change that was made on 2026-09-14 — stale without denying publication in so many words.
  /\bchange\s+this\s+to\s+[`'"]?public\b/i,
];

/** Every line of `text` matching a known-stale phrasing. */
export function staleClaims(file: string, text: string): { file: string; line: number; text: string }[] {
  return text.split("\n").flatMap((line, index) =>
    STALE_CLAIMS.some((pattern) => pattern.test(line))
      ? [{ file, line: index + 1, text: line.trim() }]
      : []);
}

const read = (file: string): string => readFileSync(resolve(REPO, file), "utf8");

test("the machinery population is found by walking, and it is not empty", () => {
  const files = machineryFiles();
  assert.ok(files.includes(".github/workflows/release.yml"),
    "the walk must reach release.yml — if it does not, every emptiness assertion below passes vacuously");
  assert.ok(files.includes(".changeset/README.md"),
    "the walk must reach .changeset/README.md, which is the README of the file gate 4 quotes");
  assert.ok(files.length > FEWEST_PLAUSIBLE_MACHINERY_FILES,
    `expected the walk to contribute many files, got ${files.length} — a walk that suddenly returns a `
    + "handful has stopped finding the directory rather than found it empty");
});

test("every quoted access value in the publish machinery matches the config file as it actually reads", () => {
  const quotations = machineryFiles().flatMap((file) => accessQuotations(file, read(file)));

  // THE POSITIVE CONTROL FOR THE EMPTINESS ASSERTION BELOW. `accessMismatches(…, CONFIG_ACCESS)` passes
  // when there is nothing to check, so the population itself is asserted non-empty first, per file that
  // #2052 or #2058 measured as carrying one.
  for (const file of MUST_BE_COMPARED) {
    assert.ok(quotations.some((quotation) => quotation.file === file),
      `${file} quotes the access setting and must appear in the population — a rule that stopped finding `
      + "it would report agreement it never checked");
  }

  assert.deepEqual(accessMismatches(quotations, CONFIG_ACCESS), [],
    `.changeset/config.json reads "${CONFIG_ACCESS}"; these lines quote something else and are describing `
    + "a world that ended");
});

test("POSITIVE CONTROL: flipping the config value makes every quoting site fail, in each file", () => {
  // #2052's own Mutation line. Without this the test above asserts agreement between two things that
  // could both be wrong — or, worse, that it never actually read.
  const other = CONFIG_ACCESS === "public" ? "restricted" : "public";
  const filesThatNotice = machineryFiles()
    .filter((file) => accessMismatches(accessQuotations(file, read(file)), other).length > 0);

  for (const file of MUST_BE_COMPARED) {
    assert.ok(filesThatNotice.includes(file),
      `against a config reading "${other}", ${file} must report a mismatch. It does not, which means this `
      + "file's quotations are not being compared to the config at all");
  }
});

test("accessQuotations exempts a PAST-BOUNDED record, and only that", () => {
  // A skip that fires always is a check that never runs, so the exemption is tested from both sides.
  const dated = 'Until 2026-09-14 this asserted "restricted": PLAN.md B5 was open.';
  assert.deepEqual(accessQuotations("fixture.ts", dated), [],
    "a value bounded to a moment that has passed is a record of that moment and stays");

  const undated = 'It currently says `restricted`, so even a correctly-confirmed run fails.';
  assert.equal(accessQuotations("fixture.ts", undated).length, 1,
    "the same sentence without a date is the defect and must be caught");

  // The `access=` two lines above it is what a line-scoped rule needed and did not have.
  const guardMessage = `echo "this is deliberately 'restricted' so an accidental release cannot claim a name."`;
  assert.deepEqual(accessQuotations("fixture.yml", guardMessage).map((q) => q.value), ["restricted"],
    "the guard's own error message quotes the value without naming `access` on the line, and the filed "
    + "open-check missed it for exactly that reason");
});

test("RED CONTROL: a date on the line does not exempt a present-tense claim", () => {
  // reviewer-2's refusal of `9d201937`, reproduced as a test rather than as a reading of the regexp. The
  // exemption there was "the line contains a date", so appending `(checked …)` to a live gate requirement
  // took it out of the population and the FULL acceptance still passed 9/9. This is the control that a
  // mismatch dressed in a date is still a mismatch.
  const evasion = '#      It currently says `restricted` (checked 2026-09-23), so a confirmed run fails.';
  assert.deepEqual(accessQuotations("fixture.yml", evasion).map((quotation) => quotation.value), ["restricted"],
    "`checked <date>` records when somebody looked, not that the claim is about the past — this is still "
    + "a present-tense requirement and must be compared against the config");
  assert.equal(accessMismatches(accessQuotations("fixture.yml", evasion), "public").length, 1,
    "and against a config reading `public` it must be REPORTED, which is the assertion reviewer-2 found "
    + "passing vacuously");

  assert.equal(isDatedRecord("Deprecated 2026-09-19; the gate still demands `public` today."), false,
    "a date elsewhere in the sentence does not bind the quoted value to a past moment");
  assert.equal(isDatedRecord("It read `restricted` until 2026-09-14 (#1530)."), true,
    "and the boundary form must still be recognised, or the exemption has simply been deleted");
});

test("the exemption's whole live population is the two records #2052 left standing", () => {
  // An exemption is a hole in the population, so the holes are enumerated. A third file starting to use
  // one means a line left the comparison and nobody said so — which is how `9d201937` shipped.
  const exempted = machineryFiles().filter((file) =>
    read(file).split("\n").some((line) => isDatedRecord(line) && /[`'"](public|restricted)[`'"]/.test(line)));
  assert.deepEqual(exempted, [".changeset/README.md", "packages/lab/src/packaging/release-safety.test.ts"],
    "these are the only files whose access quotations the record exemption removes from the comparison");
});

test("no file in the publish machinery still claims nothing has been published", () => {
  const found = machineryFiles().flatMap((file) => staleClaims(file, read(file)));
  assert.deepEqual(found, [],
    `a11ign@0.1.0 shipped on ${PUBLISHED_ON}; these lines say otherwise`);
});

test("POSITIVE CONTROL: staleClaims catches each of the six lines #2052 corrected", () => {
  // The fixtures ARE the pre-fix text, verbatim at e33c2a62d. An emptiness assertion whose population
  // comes from a call needs a control it can point at, and this is the one: each pattern above earns its
  // place by catching a line that was really in the tree.
  const corrected: [string, string][] = [
    ["release.yml:1", "# The publish path. IT PUBLISHES NOTHING TODAY, AND CANNOT BE TRIGGERED BY ACCIDENT."],
    ["release.yml:3", "# The name is undecided (PLAN.md, B5) and nothing has been pushed to any registry. This workflow exists so"],
    ["release.yml:17", "#      name we may not keep."],
    ["release.yml:dry-run message", `            echo "until PLAN.md B5 (the name) is settled."`],
    ["changeset/README.md:47", "  publish errors outright, which is the failure direction we want. **Change this to `public` in the same"],
    ["release-safety.test.ts:4", " * Nothing has been published to any registry, the name is undecided (PLAN.md B5), and npm versions cannot"],
  ];
  for (const [where, line] of corrected) {
    assert.equal(staleClaims("fixture", line).length, 1, `staleClaims must catch ${where}: ${line.trim()}`);
  }

  // And must NOT catch a dry run's own true statement about itself.
  assert.deepEqual(staleClaims("fixture", `echo "DRY RUN — versioned and packed, published nothing."`), [],
    "a dry run publishes nothing, which is still true and is a different claim from the registry's state");
});

test("the seven gates and their rationale survive the correction", () => {
  // A diff that deletes the list to make the assertions above pass has removed the reason the publish
  // path is safe. #2052 is a correction, not a cull.
  const workflow = read(".github/workflows/release.yml");
  for (const gate of SEVEN_GATES) {
    assert.match(workflow, new RegExp(`^#\\s+${gate}\\. `, "m"), `gate ${gate} must still be listed in the header`);
  }
  assert.match(workflow, /SEVEN INDEPENDENT THINGS must all be true/,
    "the header must still say why the seven are independent");
  assert.match(workflow, /cannot be unpublished after 72 hours, only deprecated/,
    "the reason this workflow is shaped as it is must survive");
});

test("each corrected file states what IS published, and when", () => {
  for (const file of CORRECTED_BY_2052) {
    const text = read(file);
    assert.match(text, /a11ign@0\.1\.0/,
      `${file} discusses the publish state, so it must name the version that is live rather than leave a `
      + "reader to infer one");
    assert.ok(text.includes(PUBLISHED_ON), `${file} must carry the date the release shipped`);
  }
});

test("the dated records #2052 ruled OUT are untouched", () => {
  // Over-delivery fails this row as surely as under-delivery. Each of these was true on its own date and
  // says so; `docs/architecture-audit.md` is frozen besides, and editing it to stay current is the exact
  // failure `architecture-audit-is-frozen.test.ts` exists to stop.
  const records: [string, string][] = [
    ["docs/publish-blocker.md", '`.changeset/config.json` still reads `"access": "restricted"`'],
    ["PLAN.md", '`access: "restricted"` stays set because B5 (the name) is unresolved'],
    ["docs/architecture-audit.md", '`release.yml:14-17` calls `access: "restricted"`'],
  ];
  for (const [file, record] of records) {
    assert.ok(read(file).includes(record),
      `${file} is a record of its own moment and must keep saying what it said: ${record}`);
  }
});

/**
 * #2058: THE COUNTS ITEM 3 IS ABOUT, READ FROM `.changeset/` RATHER THAN QUOTED.
 *
 * Only the counts that HOLD STILL are pinned. The number of pending changesets moves with every merged
 * pull request, so the document states it as a dated reading and this file does not compare it — pinning
 * it would make an ordinary changeset turn the trunk red, which is the guard failing in the direction
 * that gets it deleted. The promotion count and the `first-publish-*` count do not move: `promote:model`
 * replaces the standing promotion changeset each time it promotes, and no new `first-publish-*` entry can
 * be written for a package that has already published.
 */
function changesetNames(): string[] {
  return readdirSync(resolve(REPO, ".changeset"))
    .filter((name) => name.endsWith(".md") && name !== "README.md");
}

const countOf = (prefix: string): number => changesetNames().filter((name) => name.startsWith(prefix)).length;

/**
 * Which side of the first release this tree is on (#3131). `changeset version` writes a `CHANGELOG.md` into every
 * package it versions and deletes the changesets it consumed, so a `CHANGELOG.md` anywhere is the release having
 * been cut. THE RELEASE IS AUTOMATIC NOW: its version pull request carries the far-side tree while `main` still
 * holds the near one, and that pull request must pass this file too (#3353 went red on four pins that described
 * only the near side). So a claim about the tree BEFORE the release is asserted only before it, and what holds on
 * both sides (the names, the registry split, "never more than one promotion") is asserted on both.
 */
const firstReleaseCut = (): boolean => filesNamed(REPO, "CHANGELOG.md").length > 0;

/**
 * The decision list ITSELF, sliced out of the document — not the whole file.
 *
 * Measured while writing this: every phrase below appears a second time in the `B3 (as originally
 * scoped)` section further down, so a whole-file `includes` passes with the list deleted. The assertion
 * has to be about the section the row is about, or it is satisfied by a copy of the reasoning in a
 * section the row never touched.
 */
function decisionList(): string {
  const text = read(RELIABILITY_PLAN);
  const start = text.indexOf("**Three decisions remained when this list was written");
  assert.notEqual(start, -1, "the decision list must still be in the document — #2058 is a correction, not a cull");
  const end = text.indexOf("\n---", start);
  assert.notEqual(end, -1, "the decision list must still end at a section break");
  return text.slice(start, end);
}

test("#2058: the three-decisions list survives the correction, and each item says what decided it", () => {
  // A diff that deletes the list to make the currency assertions pass has removed the record of why the
  // publish waited. #2052's shape: a correction, not a cull.
  const list = decisionList();
  for (const reasoning of [
    "ADR 0006's AGPL/Apache split is gated on it and is effectively irreversible",
    "ADR 0007 makes the weights the API",
    "is a call about what a first release says, not a tidy-up",
  ]) {
    assert.ok(list.includes(reasoning), `the reasoning must survive inside the list itself: ${reasoning}`);
  }
  assert.equal((list.match(/\*\*DECIDED/g) ?? []).length, 3,
    "each of the three items must say that it was decided — a list that merely drops the stale numbers "
    + "leaves a reader unable to tell a settled item from an open one");
});

test("#2058: item 3's promotion count is today's, read from the directory it describes", () => {
  const list = decisionList();
  assert.ok(countOf("promote-") <= 1,
    "`promote:model` replaces the standing promotion changeset, so there is never more than one — on either "
    + "side of the release");
  if (!firstReleaseCut()) {
    assert.equal(countOf("promote-"), 1,
      "the standing shape is one promotion changeset — if this is no longer 1, the sentence below is stale "
      + "and the document must say what the new shape is");
    assert.ok(list.includes("holds **one** promotion changeset today"),
      "item 3 must state the count that is true now, not the five it was filed with");
  }
  assert.ok(!list.includes("five promotion changesets are pending"),
    "the 2026-08-31 count must not survive as a present-tense claim");
});

/**
 * Directories whose contents are not THIS tree's record: `node_modules` and `.venv` are dependency
 * installs holding third-party changelogs, and the rest are caches, run records or version-control
 * output. `derived-artifact-sweep.test.ts` prunes the same names for the same reason.
 *
 * `dist` IS DELIBERATELY NOT AMONG THEM, and it is the one name this list drops from that sweep's.
 * Everything else here belongs to something other than this repository; `dist` is this repository's own
 * build output, and `npm pack` puts a package's `CHANGELOG.md` into what it ships. Reviewer's refusal of
 * #2159 at `fa72a9bf` planted `dist/CHANGELOG.md` and nothing went red. A changelog there means one was
 * written or copied, which is exactly the event the paragraph below claims has not happened — so the walk
 * reaches it rather than the document carving it out. No `package.json` lives under any `dist` in this
 * tree, so the manifest population this same walk feeds is unchanged by including them.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "runs", "__pycache__", ".venv", "coverage"]);

/**
 * Every file named `name` under `root`, root-relative and sorted.
 *
 * WHOLE-TREE, BECAUSE THE CLAIM IS WHOLE-TREE — reviewer's refusal of #2159 at `12c2d579`. This shipped
 * as `readdirSync(REPO + "/packages")` filtered by `existsSync`, i.e. a scan of the immediate children of
 * ONE directory, under a document sentence saying no `CHANGELOG.md` existed anywhere in the tree. A
 * changelog at the repository root, under `scripts/`, or in a package nested one level deeper would have
 * left that sentence reading as verified when nothing had looked at it. The walk and the sentence now
 * name the same boundary — the tree, `node_modules` and the derived directories aside.
 */
function filesNamed(root: string, name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name === name) out.push(full.slice(root.length + 1));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * THE POSITIVE CONTROL FOR THE EMPTY-CHANGELOG ASSERTION BELOW, AND WHERE THE ASSERTION SAYS IT LIVES.
 *
 * `assert.deepEqual(changelogs, [])` passes when the population is genuinely empty and equally when the
 * walk returned nothing because it never looked — and this repository's rule is that the writer has to be
 * able to POINT at the assertion that tells those apart. This is that assertion, and the reach floor in
 * the test below is its other half: this one proves the walker returns a `CHANGELOG.md` that exists, that
 * one proves the walker visited the real directories a publish would write one into.
 *
 * The fixture plants one two directories down and one inside a pruned directory, so a walker that stopped
 * descending and a prune list that swallowed the whole tree both fail here rather than reading as an
 * empty repository.
 */
test("#2159: the changelog walk returns a CHANGELOG.md that is there, and prunes the ones that are not this tree's", () => {
  const fixture = mkdtempSync(join(tmpdir(), "changelog-walk-"));
  try {
    mkdirSync(join(fixture, "packages", "scorer"), { recursive: true });
    writeFileSync(join(fixture, "packages", "scorer", "CHANGELOG.md"), "## 0.1.0\n");
    // One in EVERY pruned directory, not only `node_modules` — reviewer's refusal of #2159 at
    // `fa72a9bf` planted `dist/CHANGELOG.md` and no test moved, because the control exercised one
    // name out of seven. The prune list is the boundary the document now states, so each member of it
    // is a case here rather than an implementation detail nothing looks at.
    for (const pruned of SKIP_DIRS) {
      mkdirSync(join(fixture, pruned, "left-pad"), { recursive: true });
      writeFileSync(join(fixture, pruned, "left-pad", "CHANGELOG.md"), "## 1.3.0\n");
    }
    // AND ONE IN `dist`, WHICH MUST COME BACK. This is the mutant reviewer planted at `fa72a9bf`, as a
    // case rather than as an argument: `dist` is this repository's own build output, so a changelog
    // there is this tree's and the walk has to see it.
    assert.ok(!SKIP_DIRS.has("dist"), "dist is this repository's own output and is walked, not pruned");
    mkdirSync(join(fixture, "packages", "cli", "dist"), { recursive: true });
    writeFileSync(join(fixture, "packages", "cli", "dist", "CHANGELOG.md"), "## 0.1.0\n");

    assert.deepEqual(filesNamed(fixture, "CHANGELOG.md"),
      [join("packages", "cli", "dist", "CHANGELOG.md"), join("packages", "scorer", "CHANGELOG.md")],
      "the walk must descend past the root to find a package's changelog and the copy `npm pack` would "
      + "ship, and must not count one from any pruned directory — if this is empty, the emptiness "
      + "asserted below means nothing");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("#2058/#3131: the successor's own numbers are the tree's — six first-publish entries and no CHANGELOG before the release, none and only package CHANGELOGs after it", () => {
  const list = decisionList();
  const cut = firstReleaseCut();
  if (!cut) {
    assert.equal(countOf("first-publish-"), 6,
      "six first-publish entries were pending when #2058 measured; a different number makes the paragraph "
      + "below wrong rather than merely old");
    assert.ok(list.includes("**Six of the pending entries are `first-publish-*.md`**"),
      "the successor decision must name how many of the pending entries announce a publish that happened");
  } else {
    assert.equal(countOf("first-publish-"), 0,
      "`changeset version` consumes the `first-publish-*` entries it publishes, and none can be written again for "
      + "a package that has published, so a tree with a CHANGELOG that still holds one was versioned by hand");
  }

  // The document says the first CHANGELOG was never written. That is a live claim BEFORE the release. It used
  // to fail here the moment the release falsified it, so a person publishing by hand met it; the release is
  // automatic now (#3131) and its version pull request is that falsifying tree, so the claim is asserted only
  // while no CHANGELOG exists, and the document's paragraph is rewritten by whoever reads it after the release.
  //
  // THE EMPTINESS HAS TWO CONTROLS AND THIS NAMES BOTH. The test above proves this walker returns a
  // `CHANGELOG.md` that exists; the loop below proves that in THIS run it reached every directory
  // `changeset version` would write one into, enumerated independently of the walk. Without them a walk
  // that lost `packages/` and a tree that truly has no changelog are the same green.
  // AND THE CLAIM IS PINNED TO THE WALK'S SCOPE, because the two drifted once already: the sentence read
  // "anywhere in this tree" while the walk read the immediate children of one directory. The prune list
  // is part of what the reader is told, not an implementation detail of the guard, so a reversion to the
  // unscoped wording is red here rather than quietly re-opening the gap.
  if (!cut) {
    const flat = unwrapped(list);
    assert.ok(flat.includes("a walk of this tree finds no `CHANGELOG.md` at all outside"),
      "the document must state the scope this test actually walks");
    // THE BOUNDARY IS DERIVED FROM THE PRUNE LIST, NOT RETYPED BESIDE IT. The sentence said "outside
    // `node_modules`" while the walk skipped seven directories, so a `dist/CHANGELOG.md` left every
    // assertion green while falsifying the sentence — reviewer's refusal of #2159 at `fa72a9bf`, whose
    // mutant survived. Adding a directory to SKIP_DIRS without saying so in the document is red here.
    for (const pruned of SKIP_DIRS) {
      assert.ok(flat.includes(`\`${pruned}\``),
        `the document's changelog sentence does not name \`${pruned}\`, which the walk skips — a `
        + `CHANGELOG.md under it would leave this test green while the sentence reads as verified`);
    }
  }

  const manifests = filesNamed(REPO, "package.json");
  const packageDirs = readdirSync(resolve(REPO, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(REPO, "packages", entry.name, "package.json")))
    .map((entry) => entry.name);
  assert.ok(packageDirs.length >= FEWEST_PLAUSIBLE_PACKAGES,
    `only ${packageDirs.length} package directories were enumerated — the directory has been lost, and `
    + "the changelog population below would be empty for that reason rather than because none exists");
  for (const pkg of packageDirs) {
    assert.ok(manifests.includes(join("packages", pkg, "package.json")),
      `the walk did not reach packages/${pkg}, which is where changeset version writes its CHANGELOG — `
      + "so its absence from the changelog population says nothing");
  }

  const changelogs = filesNamed(REPO, "CHANGELOG.md");
  if (!cut) {
    assert.deepEqual(changelogs, [],
      "docs/reliability-plan.md states that a walk of this tree finds no CHANGELOG.md outside node_modules "
      + "and that the pending set has never been consumed; the tree now carries one, so that paragraph is "
      + "wrong");
    return;
  }
  // After the release the claim above is the document's to update, not this file's to keep true: what holds is
  // WHERE they are. `changeset version` writes one per package it versions and nowhere else, so a CHANGELOG
  // outside `packages/<name>/` is somebody's hand-written file masquerading as a release record.
  assert.ok(changelogs.length > 0, "`cut` means a CHANGELOG was found, so the population below is not empty by vacuity");
  const outsidePackages = changelogs.filter((file) => !packageDirs.some((pkg) => file === join("packages", pkg, "CHANGELOG.md")));
  assert.deepEqual(outsidePackages, [], "every CHANGELOG.md must sit beside a workspace package's manifest");
});

/**
 * Every workspace manifest, with the two fields the version claim turns on.
 *
 * The population comes from the walk above — which has its own control — narrowed to the ROOT
 * `workspaces` glob, read from the root manifest rather than hard-coded. That narrowing is the point:
 * `scripts/isolation-fixtures/` holds seven more `package.json` files, several of them public and at
 * `0.0.0`, and they are deliberately not workspace members. A guard that counted them would give the
 * right answer about the wrong population, and would keep giving it after a fixture changed.
 */
function workspaceManifests(): { path: string; name: string; version: string; isPrivate: boolean }[] {
  const globs = JSON.parse(read("package.json")).workspaces as string[];
  assert.deepEqual(globs, ["packages/*"],
    "this guard narrows the walk to the workspace glob; if the glob has changed, the narrowing below "
    + "reads a population the release no longer versions");
  return filesNamed(REPO, "package.json")
    .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file.split(sep).join("/")))
    .map((file) => {
      const manifest = JSON.parse(read(file));
      return { path: file, name: manifest.name, version: manifest.version, isPrivate: manifest.private === true };
    });
}

/** The decision list with its hand-wrapping collapsed, so a phrase may be asserted across a line break. */
const unwrapped = (text: string): string => text.replace(/\s+/g, " ");

/**
 * The four packages the registry holds at `0.1.0` (`npm view <name> version`, 2026-10-03, #3347), and the one
 * public one that was never published and so still reads `0.0.0` (`@a11ign/toolchain`, #3578: its first publish is that row's; the other
 * never-published package, the fleet, left the workspace with #3504).
 */
const PUBLISHED_AT_0_1_0 = ["@a11ign/evidence", "@a11ign/judge", "@a11ign/scorer", "a11ign"];
const NEVER_PUBLISHED = ["@a11ign/toolchain"];

/** `version` is at least `floor`, both plain `major.minor.patch`: the only shapes a manifest here holds. */
function versionAtLeast(version: string, floor: string): boolean {
  const parts = (text: string): number[] => text.split(".").map(Number);
  const [have, want] = [parts(version), parts(floor)];
  const firstDifference = have.findIndex((n, i) => n !== want[i]);
  return firstDifference === -1 || have[firstDifference] > want[firstDifference];
}

/**
 * The near side of the release (#3131): `main` before `changeset version` has run reads `0.1.0` for the four
 * published packages and `0.0.0` for the other one. The far side moves all five, so these are not claims
 * about the registry split (that is asserted on both sides, by name) but about the literals the document quotes.
 */
function assertVersionsAsTheNearSideHoldsThem(publicManifests: { name: string; version: string }[]): void {
  assert.deepEqual(publicManifests.filter((manifest) => manifest.version !== "0.0.0").map((manifest) => manifest.name).sort(),
    PUBLISHED_AT_0_1_0,
    "docs/reliability-plan.md states that exactly the four packages the registry holds read 0.1.0 and the rest of "
    + "the set `changeset version` writes reads 0.0.0. Another public manifest off 0.0.0 means a version has "
    + "landed since, and the successor decision's premise is stale");
  assert.deepEqual(publicManifests.filter((manifest) => PUBLISHED_AT_0_1_0.includes(manifest.name))
    .map((manifest) => manifest.version), ["0.1.0", "0.1.0", "0.1.0", "0.1.0"],
    "a published package must read the version the registry holds, or the pending changesets bump from the "
    + "wrong base and `plan` reads `nothing` rather than `publish` (#3130)");
}

/**
 * #2159, reviewer's refusal at `ff88e9ea`: the document said "every `package.json` still reads `0.0.0`",
 * and two of them read `0.1.0`. #3347 then moved four public manifests to the registry's `0.1.0`, so
 * the claim is now a PARTITION of the six public manifests rather than one number.
 *
 * THE EMPTINESS AND ITS POSITIVE CONTROL ARE HALVES OF ONE PARTITION, COMPUTED IN ONE RUN.
 * `public and not 0.0.0` must be exactly the four published packages, by NAME, each reading `0.1.0` — a
 * fifth public manifest drifting off `0.0.0` is the case that has to be loudest. `private and not
 * 0.0.0` must be exactly `@a11ign/control` and `@a11ign/lab`, and `public and 0.0.0` exactly the two
 * never-published: each is a NON-EMPTY population produced by the same read of the same files, so a walk
 * that returned nothing, a narrowing that matched nothing, or a `version` field this code failed to read
 * turns an assertion red rather than letting another pass by vacuity.
 */
test("#2159/#3347: the versions claim is true of the set changesets versions, split as the registry holds it", () => {
  const manifests = workspaceManifests();
  assert.ok(manifests.length >= FEWEST_PLAUSIBLE_PACKAGES,
    `only ${manifests.length} workspace manifests were read — the population is broken, and every half `
    + "of the partition below would be empty for that reason rather than because the tree says so");

  const publicManifests = manifests.filter((manifest) => !manifest.isPrivate);
  const namesOf = (list: { name: string }[]): string[] => list.map((manifest) => manifest.name).sort();
  const published = publicManifests.filter((manifest) => PUBLISHED_AT_0_1_0.includes(manifest.name));
  assert.deepEqual(namesOf(published), PUBLISHED_AT_0_1_0,
    "the four packages the registry holds must all be workspace members, on either side of the release");
  assert.deepEqual(namesOf(publicManifests.filter((manifest) => !PUBLISHED_AT_0_1_0.includes(manifest.name))), NEVER_PUBLISHED,
    "THE POSITIVE CONTROL for the split: the other public manifest is exactly the one never published, and "
    + "a new public package or a rename changes the registry split this file describes");
  assert.ok(published.every((manifest) => versionAtLeast(manifest.version, "0.1.0")),
    "a published package must read at least the version the registry holds, or `changeset publish` would send "
    + "an older one and could move `latest` back (#3130, #3167)");
  if (!firstReleaseCut()) assertVersionsAsTheNearSideHoldsThem(publicManifests);
  assert.deepEqual(namesOf(manifests.filter((manifest) => manifest.isPrivate && manifest.version !== "0.0.0")),
    ["@a11ign/control", "@a11ign/lab"],
    "THE POSITIVE CONTROL for the emptiness claims: these two private manifests are hand-set to 0.1.0 and "
    + "changesets never touches them, so this list is non-empty in any run where the manifests were "
    + "actually read");
  assert.equal(publicManifests.length, 5,
    `the document says FIVE versioned manifests and this tree has ${publicManifests.length} — a package added, `
    + "published or made private changes the sentence, and it is corrected here rather than left to rot");

  const list = unwrapped(decisionList());
  if (!firstReleaseCut()) {
    assert.ok(list.includes("**Four of the five versioned manifests read `0.1.0`**, the version the registry holds"),
      "the document must state the claim over the set it is true of — the reviewer refused the unqualified "
      + "form, and a narrowing that is not in the document narrows nothing");
  }
  for (const name of NEVER_PUBLISHED) {
    assert.ok(list.includes(name), `the document must name ${name} as the one that still reads 0.0.0`);
  }
  assert.ok(!/every `package\.json`[^.]{0,40}reads `0\.0\.0`/.test(list),
    "the unqualified sentence must not come back. It was false in this tree from the day @a11ign/control "
    + "was extracted, and it read as verified because nothing had looked at the manifests");
  for (const name of ["@a11ign/control", "@a11ign/lab"]) {
    assert.ok(list.includes(name),
      `the document must name ${name} as a manifest the claim does NOT cover — a narrowing that hides its `
      + "own exceptions is the same defect one step quieter");
  }
});

/**
 * #3717: THE HEADER MUST NOT STILL DESCRIBE THE VERSION PULL REQUEST AS THE LIVE PATH. `release.yml` was rewritten as a caller of the
 * per-merge workflow, and a header is the half a reader meets first: the old one said, in the present tense, that the file releases on
 * the merge of a version pull request and opens one with the bot token. The phrasings below are the ones that header used, each matched
 * by a real line of `scripts/fixtures/release-before-3717.yml`, so the tripwire is shown to notice what it looks for before it is trusted
 * to find nothing in the live file (a marker that cannot recognise its own remedy, and its opposite, are both half a test).
 */
const STALE_VERSION_PR_CLAIMS: readonly RegExp[] = [
  /RELEASES ON THE MERGE OF A VERSION PULL REQUEST/,
  /opens or updates the ONE version pull/,
  /`version-pr` opens/,
  /VERSION PULL REQUEST'S MERGE made/,
];

test("#3717: the live header names no version pull request as the path, and every tripwire phrase is matched by the file it replaced", () => {
  const before = read("scripts/fixtures/release-before-3717.yml");
  const live = read(".github/workflows/release.yml");
  for (const claim of STALE_VERSION_PR_CLAIMS) {
    assert.match(before, claim, `POSITIVE CONTROL: today's workflow before the row says '${claim}', so the tripwire can notice it`);
    assert.doesNotMatch(live, claim, `the live release.yml still says '${claim}', which was true only of the version pull request`);
  }
  assert.match(live, /release-per-merge\.yml/, "the header must name the workflow it calls, so a reader knows where the release itself is");
});
