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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

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
  assert.equal(countOf("promote-"), 1,
    "the standing shape is one promotion changeset — if this is no longer 1, the sentence below is stale "
    + "and the document must say what the new shape is");
  assert.ok(list.includes("holds **one** promotion changeset today"),
    "item 3 must state the count that is true now, not the five it was filed with");
  assert.ok(!list.includes("five promotion changesets are pending"),
    "the 2026-08-31 count must not survive as a present-tense claim");
});

test("#2058: the successor's own numbers are the tree's — six first-publish entries, no CHANGELOG", () => {
  const list = decisionList();
  assert.equal(countOf("first-publish-"), 6,
    "six first-publish entries were pending when #2058 measured; a different number makes the paragraph "
    + "below wrong rather than merely old");
  assert.ok(list.includes("Six of those 85 are `first-publish-*.md`"),
    "the successor decision must name how many of the pending entries announce a publish that happened");

  // The document says the first CHANGELOG was never written. That is a live claim, and the release that
  // falsifies it is the one this section exists to inform — so it fails here rather than misleading a
  // reader at publish time.
  const changelogs = readdirSync(resolve(REPO, "packages"))
    .filter((pkg) => existsSync(resolve(REPO, "packages", pkg, "CHANGELOG.md")));
  assert.deepEqual(changelogs, [],
    "docs/reliability-plan.md states that no CHANGELOG.md exists anywhere in the tree and that the "
    + "pending set has never been consumed; these packages now carry one, so that paragraph is wrong");
});
