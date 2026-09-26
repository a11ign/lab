/**
 * `stripComments` BLANKED REAL CODE, AND THREE GUARDS WALK WHAT IT LEAVES — #1019.
 *
 * The block-comment pass ran before the line-comment pass, so a `//` comment CONTAINING `/*` — a glob in
 * prose, `--branches='agent/*'`, `@a11ign/*` — opened a match that closed at the next `*` + `/` anywhere
 * later in the file, blanking every line between. Real imports disappeared, and the walkers that read them
 * reported a narrower closure than the file has.
 *
 * **The direction is UNDER-charging**, which is why this went first: a requirement behind an invisible
 * import is never derived, so a command reads runnable and a job reports success having verified something
 * it could not run. That is the opposite of the over-charging fallback `acceptance-commands.mjs` argues is
 * the safe direction, and the asymmetry is the whole argument for fixing it before anything else there.
 *
 * IT NEEDED BOTH HALVES, which is why #725's test — written for this exact class — did not catch it: the
 * `//`-embedded opener AND a later block comment to close against. With no closer the regex never matches
 * and the case passes. **The fixture was missing the closer, not the opener.**
 *
 * WHO WALKS IT: `acceptance-commands.mjs:70`'s closure requirement walk (token/corpus/history),
 * `tree-wide-guards.mjs:23`'s guard discovery, and `gh-token-jobs.test.ts:23`. Re-derived rather than
 * relayed — an earlier version of this sentence named `row-claim/file-overlap-rule.mjs`, which does NOT
 * walk this closure: its imports are `repo-identity.mjs`, `merge-guard/lookups.mjs` and `region-paths.mjs`,
 * so it is one of the ten BLINDED files, a subject and not a walker.
 *
 * AND THE COST COMPOUNDS, which is product-manager's restatement and the better one: **a walk that REACHES
 * a blinded file stops there.** So all three walkers saw closures that terminated early at any of the ten —
 * and B4's own module being one of them means whatever walked toward it never saw `region-paths.mjs`
 * behind it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments, localImports } from "../../../guards/src/local-import-closure.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The defect, both halves. Built by concatenation so this file does not contain the opener itself — a
 * fixture spelling out `/` + `*` inside a `//` line would make THIS file an instance of what it tests, and
 * the sweep below reads every tracked file including this one.
 */
const OPENER = `// a line comment mentioning a glob like agent/${"*"} and then some prose`;
const CLOSER = `/${"**"} a perfectly ordinary doc block ${"*"}/`;

test("#1019 REPRODUCED: a `//` comment containing a block-opener does not eat the code beneath it", () => {
  const source = `${OPENER}\nimport MARKER from "./y.mjs";\n${CLOSER}\n`;
  assert.match(stripComments(source), /import MARKER from "\.\/y\.mjs";/,
    "the line comment's embedded opener matched forward to the doc block's closer and blanked the import "
    + "between them -- which is how twelve real imports became zero");
});

test("#1019 THE SECOND HALF: with nothing to close against, the same input always survived", () => {
  // This is why the defect outlived a test written for its class. #725's fixture had the opener and no
  // closer, so the regex never matched and the case passed while the real files failed.
  const source = `${OPENER}\nimport MARKER from "./y.mjs";\n`;
  assert.match(stripComments(source), /import MARKER/,
    "if this ever fails, the reproduction above is no longer testing what it claims");
});

test("#1019: a real block comment is still blanked, and OFFSETS ARE PRESERVED", () => {
  // Load-bearing, and the reason this module does not use `@a11ign/evidence/source-text`'s tokenizer
  // instead: `closureRequirementMessage` reads an offset into the STRIPPED text as a line number in the
  // REAL file, so the output must be the same length with its newlines intact.
  const source = `const a = 1;\n${CLOSER.replace(" a perfectly", "\n a perfectly")}\nconst b = 2;\n`;
  const stripped = stripComments(source);
  assert.equal(stripped.length, source.length, "same length, or every reported line number shifts");
  assert.equal(stripped.split("\n").length, source.split("\n").length, "newlines must survive");
  assert.doesNotMatch(stripped, /perfectly ordinary/, "the block comment's text must still be gone");
  assert.match(stripped, /const a = 1;/);
  assert.match(stripped, /const b = 2;/);
});

test("#1019 THE LIVE INSTANCE: row-claim.mjs's local imports are visible, and one of them is prose", () => {
  // The real file, pinned rather than a fixture: it is the instance that found this. The point is not the
  // number, it is the GAP -- exactly one relative specifier in that file is a `//` comment quoting an
  // import, so the raw source always reads one higher than the truth, and that wrong number sat in #1019's
  // own open-check until worker-judge counted independently. Pinning the gap instead of the total means
  // the next import added to `row-claim.mjs` does not falsify a test that was never about the total.
  //
  // (#1014 added the thirteenth import and this assertion caught it, which is the test working. It was
  // an exact `12` then; it is the difference now, for the reason above.)
  const walked = localImports(`${REPO}packages/agent-org/src/row-claim.mjs`).length;
  const rawSpecifiers = new Set(
    [...readFileSync(`${REPO}packages/agent-org/src/row-claim.mjs`, "utf8").matchAll(/from\s+"(\.[^"]*)"/g)].map((m) => m[1]),
  ).size;
  assert.ok(walked >= 12, `expected row-claim.mjs's imports to be visible, walked ${walked}`);
  assert.equal(rawSpecifiers - walked, 1,
    `raw source spells ${rawSpecifiers} relative specifiers and the walk sees ${walked}: exactly one is `
    + "the `//` comment quoting an import. A gap of 0 means the stripper stopped blanking comments; a gap "
    + "above 1 means it started eating real ones");
  // The two that decide what CI runs, and a SIGHTED control so this cannot pass by the walk finding
  // nothing anywhere.
  assert.equal(localImports(`${REPO}scripts/ci-changed.mjs`).length, 5);
  assert.equal(localImports(`${REPO}scripts/select-changed-tests.mjs`).length, 5);
  // A SIGHTED CONTROL, and the number is incidental to it: it says the walk finds this file's imports
  // rather than nothing. It read `3` until #1969 added `./api-pool.mjs`, and the message then sent the
  // reader after a broken walker for a count that had moved for a perfectly good reason. So it now pins
  // the SPECIFIERS -- a control that says WHICH imports are seen cannot pass by finding nothing, and a
  // legitimate fourth import falsifies it only by being missing from this list.
  //
  // #2046 IS THAT CASE, and it is the first one: the arm refusal path was made to read the ARMED state,
  // the predicate lifted to `pr-armed-state.mjs`, and the fifth specifier below is that import. The list
  // moved because the file did; the walk is fine. This is the failure mode the paragraph above designed
  // for, and updating the list IS the response -- there is nothing here to fix in the walker.
  //
  // #2391 IS THE SECOND: the sixth specifier is `trunk-red.mjs`, imported so that "main is red" in the jump's
  // grant is the gate's own `newestVerdictRun` and not a second reading of it.
  assert.deepEqual(
    localImports(`${REPO}packages/agent-org/src/arm-pr.mjs`).map((p: string) => p.replace(REPO, "")).sort(),
    ["packages/agent-org/src/acceptance-commands.mjs", "packages/agent-org/src/api-pool.mjs",
      "packages/agent-org/src/pr-armed-state.mjs", "packages/agent-org/src/pr-hold-state.mjs",
      "packages/agent-org/src/trunk-red.mjs", "packages/worker-fleet/src/cli-flags.mjs"],
    "arm-pr.mjs's local imports must all be visible to the walk");
});

test("#1019 THE VACUITY FLOOR: no tracked file loses a local import to the stripper", () => {
  // The sweep that measured the defect, kept as the guard. A new instance fails here rather than being
  // re-measured by hand a month later.
  //
  // WHAT THIS PREDICATE REACHES, measured by worker-judge blinding each statement shape in turn: a plain
  // `import ... from` is FLAGGED; `export ... from`, `import "./x"`, `await import("./x")` and a
  // MULTI-LINE `import {\n...\n} from` are all four SILENT -- and `localImports` walks all four. Two are
  // live here: `board-report.mjs` and `check-scheduled-jobs.mjs` score 0 on this predicate while
  // `localImports` finds imports in both, because their import lists span lines.
  //
  // THE REACH, RE-DERIVED HERE RATHER THAN QUOTED. Of 871 tracked `.mjs`/`.ts` files, **541 have a local
  // import by `localImports`, 46 of those score zero on this line predicate, so the floor covers 495.** A
  // count of 635/60/575 was in an earlier draft of this comment; it came to me in a message, I put it in
  // the file without re-deriving it, and the subtraction in it was wrong as well. The population is stated
  // here so the next reader can re-run it instead of inheriting it. Counting what `localImports` itself counts,
  // rather than a second differently-shaped predicate over lines, is the better guard and is its own row.
  // `sandboxGitEnv()`, and it is this test's own vacuity at stake rather than a convention: a leaked
  // `GIT_DIR` points `ls-files` at ANOTHER repository, the sweep reads that tree, finds nothing blinded and
  // asserts `[]` -- clean, having examined the wrong repo, in the one test whose whole job is not to be
  // vacuous. `files.length > 500` does not save it; any large repository clears 500.
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.ts"],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/dist/"));
  assert.ok(files.length > 500, `only ${files.length} files discovered; the sweep is broken, not the tree`);
  // AN IMPORT STATEMENT, not any mention of a specifier. The first version of this sweep counted every
  // quoted relative path and reported nine false positives — files whose only match is inside a real block
  // comment (`* `node -e "import('./corpus-backup.mjs')"``), which the stripper is SUPPOSED to blank.
  // Measuring "did anything disappear" cannot tell correct blanking from the defect; measuring "did a LINE
  // THAT IS AN IMPORT STATEMENT disappear" can, because a comment mentioning one never begins with `import`.
  const count = (src: string) =>
    src.split("\n").filter((line) => /^\s*import\b[^\n]*from\s*['"]\./.test(line)).length;
  const blinded = files.filter((file) => {
    const src = readFileSync(`${REPO}${file}`, "utf8");
    const real = count(src);
    return real > 0 && count(stripComments(src)) < real;
  });
  assert.deepEqual(blinded, [],
    "these files have local imports the stripper makes invisible, so every walker reading them sees a "
    + "shorter closure than the file has -- and it fails by finding LESS, which reads as clean");
});

test("#1019 THE MIRROR: a block comment whose closer is on the same line as a `//` does not eat the file", () => {
  // worker-judge, reviewing this: sequential passes fail in BOTH directions and the order only chooses
  // which. A block comment containing `//` with its closer on the SAME LINE -- a URL, the most ordinary
  // comment there is -- has that closer eaten by a line-first pass, leaving the opener to match forward to
  // the next closer anywhere later. Same under-charging direction, same silence.
  //
  // Concatenated for the reason the fixtures above are: a literal here would make this file an instance of
  // what it tests, and the sweep below reads every tracked file including this one.
  const oneLineBlock = `/${"*"} see http:/${"/"}example.com ${"*"}/`;
  const source = `${oneLineBlock}\nimport MARKER from "./y.mjs";\n${CLOSER}\n`;
  assert.match(stripComments(source), /import MARKER/,
    "the one-line block's closer was consumed as part of a line comment, and its opener then ran forward");
});

test("#1019: the LINE pass preserves offsets too, not just the block pass", () => {
  // The offset fixture above contains no `//` at all, so the line form's length preservation was asserted
  // nowhere -- worker-judge's catch. Both forms must keep the text the same length with newlines intact,
  // because `closureRequirementMessage` reads an offset into the stripped text as a line number in the real
  // file. That property rejects the `source-text` tokenizer; it does NOT choose between the orderings.
  const source = "const a = 1; // a trailing note\nconst b = 2;\n";
  const stripped = stripComments(source);
  assert.equal(stripped.length, source.length);
  assert.equal(stripped.split("\n").length, source.split("\n").length);
  assert.doesNotMatch(stripped, /trailing note/);
  assert.match(stripped, /const a = 1;/);
});

// --- #2546: THE FASTER BLANKING IS THE SAME BLANKING ---

/**
 * `stripComments` blanks a comment one RUN of non-newlines at a time now, where it used to call the engine once per
 * character (80s of the whole-suite closure walk's 156s). A faster function that is not the same function would
 * change what every walker reads, and it fails by finding LESS, which reads as clean -- so the OLD per-character
 * form is kept here as the reference and the two are compared byte for byte, over the shapes that could tell them
 * apart and over every tracked source file.
 *
 * THE POPULATION'S POSITIVE CONTROL: the equality below passes on an empty list and on a tree with no comments in it,
 * so the sweep asserts it saw more than 500 files AND that the blanking changed at least one character in most of them.
 */
const perCharacter = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

test("#2546 stripComments equals the per-character reference on the shapes that could tell them apart", () => {
  const star = "*";
  const shapes = [
    "",
    "no comments at all\n",
    `a // line\nb`,
    `a /${star} block ${star}/ b`,
    `/${star}\nmulti\n\nline\n${star}/\ncode`,
    `x /${star} crlf\r\nline ${star}/ y\r\n// tail\r\n`,
    `tab\t/${star}\t${star}/\t// \t\n`,
    `// astral \u{1F600} and a lone surrogate \uD800 \n`,
    `/${star} ${"\u{1F600}"} ${star}/`,
    `// one\n// two\n\n// three`,
    `//`,
    `/${star}${star}/`,
  ];
  for (const source of shapes) {
    const got = stripComments(source);
    assert.equal(got, perCharacter(source), `differs on ${JSON.stringify(source)}`);
    assert.equal(got.length, source.length, `length is the offset property: ${JSON.stringify(source)}`);
    assert.equal(got.split("\n").length, source.split("\n").length, `line count is preserved: ${JSON.stringify(source)}`);
  }
});

test("#2546 stripComments equals the per-character reference on every tracked source file", () => {
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.ts"],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/dist/"));
  assert.ok(files.length > 500, `only ${files.length} files discovered; the sweep is broken, not the tree`);
  const differing: string[] = [];
  let changed = 0;
  for (const file of files) {
    const src = readFileSync(`${REPO}${file}`, "utf8");
    const got = stripComments(src);
    if (got !== perCharacter(src)) differing.push(file);
    if (got !== src) changed += 1;
  }
  assert.deepEqual(differing, []);
  assert.ok(changed > files.length / 2, `${changed} of ${files.length} files had a comment blanked: the equality above compared comments, not nothing`);
});
