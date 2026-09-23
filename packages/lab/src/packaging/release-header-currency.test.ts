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
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  return [...walked, "packages/lab/src/packaging/release-safety.test.ts"].sort();
}

export type Quotation = { file: string; line: number; value: string; text: string };

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
 * A LINE CARRYING A DATE IS EXEMPT, and that is #2052's ruling made mechanical rather than a loophole: a
 * dated claim is a record of its own moment and stays true. `release-safety.test.ts:72` ("Until 2026-09-14
 * this asserted `restricted`") is the live example, and `exempts a dated record` below is the test that
 * this exemption does not swallow the undated case with it.
 */
export function accessQuotations(file: string, text: string): Quotation[] {
  return text.split("\n").flatMap((line, index) => {
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(line)) return [];
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
  // #2052 measured as carrying one.
  for (const file of CORRECTED_BY_2052) {
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

  for (const file of CORRECTED_BY_2052) {
    assert.ok(filesThatNotice.includes(file),
      `against a config reading "${other}", ${file} must report a mismatch. It does not, which means this `
      + "file's quotations are not being compared to the config at all");
  }
});

test("accessQuotations exempts a dated record, and only a dated one", () => {
  // A skip that fires always is a check that never runs, so the exemption is tested from both sides.
  const dated = 'Until 2026-09-14 this asserted "restricted": PLAN.md B5 was open.';
  assert.deepEqual(accessQuotations("fixture.ts", dated), [],
    "a claim carrying its own date is a record of its own moment and stays");

  const undated = 'It currently says `restricted`, so even a correctly-confirmed run fails.';
  assert.equal(accessQuotations("fixture.ts", undated).length, 1,
    "the same sentence without a date is the defect and must be caught");

  // The `access=` two lines above it is what a line-scoped rule needed and did not have.
  const guardMessage = `echo "this is deliberately 'restricted' so an accidental release cannot claim a name."`;
  assert.deepEqual(accessQuotations("fixture.yml", guardMessage).map((q) => q.value), ["restricted"],
    "the guard's own error message quotes the value without naming `access` on the line, and the filed "
    + "open-check missed it for exactly that reason");
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
