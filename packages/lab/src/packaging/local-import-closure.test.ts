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
 * WHO WALKS IT: `acceptance-commands.mjs`'s closure requirement walk (token/corpus/history),
 * `tree-wide-guards.mjs`'s guard discovery, and `row-claim/file-overlap-rule.mjs` — B4, which the org leans
 * on harder since B2 stopped counting open PRs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments, localImports } from "../../../../scripts/local-import-closure.mjs";

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

test("#1019 THE LIVE INSTANCE: row-claim.mjs's twelve local imports are visible", () => {
  // The real file, pinned rather than a fixture: it is the instance that found this. TWELVE, not thirteen
  // -- the thirteenth relative specifier in that file is a `//` comment quoting an import, which is prose
  // and correctly blanked. Counted from the raw source it reads as thirteen, and that wrong number sat in
  // this row's own open-check until worker-judge counted independently.
  assert.equal(localImports(`${REPO}scripts/row-claim.mjs`).length, 12);
  // The two that decide what CI runs, and a SIGHTED control so this cannot pass by the walk finding
  // nothing anywhere.
  assert.equal(localImports(`${REPO}scripts/ci-changed.mjs`).length, 5);
  assert.equal(localImports(`${REPO}scripts/select-changed-tests.mjs`).length, 5);
  assert.equal(localImports(`${REPO}scripts/arm-pr.mjs`).length, 3,
    "arm-pr.mjs was never blinded -- if this changes, the walk is broken in the other direction");
});

test("#1019 THE VACUITY FLOOR: no tracked file loses a local import to the stripper", () => {
  // The sweep that measured the defect, kept as the guard. A new `//` comment containing a block-opener
  // fails here rather than being re-measured by hand a month later.
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.ts"], { cwd: REPO, encoding: "utf8" })
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
