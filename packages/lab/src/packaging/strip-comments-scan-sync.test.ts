/**
 * `stripComments` must not LOSE SYNC on any tracked source file — and the reading is taken against the
 * TypeScript parser, not against a list of files somebody remembered to keep current.
 *
 * ## Why a tree-wide reading, and not only the isolated cases
 *
 * `stripComments` is the shared source reader for roughly twenty guards that cannot import the thing they
 * check. When its scan mistakes a quote character for a string's opening delimiter, everything after that
 * point is copied through as string content: the guard reading it sees no code there at all. **That is a
 * guard going quiet, and a quiet guard never announces itself** — which is why the property is asserted
 * over the real tree rather than inferred from the unit cases in
 * `packages/evidence/src/source-text.test.ts`, where the mechanism is isolated.
 *
 * Both directions matter and they are asserted separately below:
 *
 *   - **It kept a comment** (`no tracked source file loses scan sync`) — the quiet direction. A guard sees
 *     prose where it expected code, or charges a file for a pattern written in a comment.
 *   - **It deleted real code** (`nothing but a comment is ever deleted`) — the loud-but-wrong direction.
 *     A regex literal containing `//` was read as a comment start and the rest of the line vanished.
 *
 * ## The readings that produced these assertions, #2131
 *
 * Taken HERE, against THIS file's own population and its own oracle — every tracked `.ts`/`.mjs` under
 * `packages/` and `scripts/`, `dist/` and `node_modules/` excluded, which is exactly what
 * `trackedSourceFiles()` below walks — so any reader can regenerate every number by driving that walk and
 * `commentsRemovedByTheParser` over it. **An earlier draft of this table quoted a second, narrower
 * population from a throwaway census script (1005 files), and `reviewer` could not reproduce it at
 * `def6aef9`; those figures are withdrawn rather than re-explained.** A measurement whose population
 * cannot be rebuilt from the tree is a claim.
 *
 * **EVERY FIGURE BELOW IS A READING AT A NAMED COMMIT, AND THE POPULATION MOVES WITH THE TREE.** It read
 * 1042 files when this file was written, 1043 at `def6aef9`+fix, 1048 when `reviewer` rebuilt it
 * independently at `b00a10fd`, 1049 at `b9867a3ec` and 1050 at `d269bf9d4` — five readings in one
 * afternoon, each true where it was taken, and a flat "over N files" went stale inside an hour. **Do not
 * expect this number to match your head, and note that nothing here asserts it:** the only figure this
 * file asserts is the one that does not depend on the population at all, **`0`, at any head.**
 *
 * | at `d269bf9d4`: 1050 tracked files | before regex-literal recognition | at the fix |
 * |---|---|---|
 * | files keeping a comment the parser removes | 100 | **0 — asserted below** |
 * | files losing a character the parser keeps | 56 | **0 — asserted below** |
 * | agrees with the parser character for character | 838 | 994 |
 *
 * The `before` column is a historical reading of code that is no longer in the tree (`def6aef9^`'s
 * `stripComments`, driven over `d269bf9d4`'s files), so it can only ever be a stamped reading — but it is
 * reproducible from the repository, which is the property the withdrawn figures lacked: check that file
 * out and drive it over the same walk. `reviewer`'s independent rebuild at `b00a10fd` read 837/100/56 →
 * 993/0/0 over 1048 files, which is this table file for file with the population two smaller — the
 * agreement between two people's oracles matters, the population count does not.
 *
 * **The other two columns are not quoted at all — they are what the two tests below assert at whatever
 * head they run on**, which is what keeps the safety argument from rotting the way the population count
 * did. The 56 files that still differ from the parser at `d269bf9d4` differ in ONE direction, and that
 * direction is likewise asserted rather than described: `nothing but a comment is ever deleted` charges
 * any file that loses a character, so every remaining difference is a KEPT one. All 56 are the one
 * already-documented reason, measured rather than assumed — the first divergence in every one of them
 * falls inside a `${...}` interpolation, where a comment is copied through as string content, which
 * `source-text.test.ts` pins as a KNOWN LIMITATION. Neither predicate here charges it: the interpolation's
 * text is not a leading-`//` line, and keeping a character is not losing one.
 *
 * ## Why the offender count can be `0` without an exemption list
 *
 * Three files — `nvda-worker/src/browser-session.mjs`, `nvda-worker/src/powershell.mjs` and
 * `lab/src/packaging/ready-label-audit.test.ts` — still have `//` lines in their stripped output, and all
 * three are CORRECT: the lines are browser JS, C# and a fixture written inside real template literals, so
 * they are string content and removing them would corrupt the string. Rather than name them in an
 * allowlist that rots, the offender test asks the parser the same question and charges a file only where
 * the two answers DIFFER. A fourth such file is legitimate and silent; a real desync is not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { stripComments } from "@a11ign/evidence/source-text";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// #716/#704: this file's population is the whole tracked tree, declared by importing and CALLING the
// marker rather than left to be discovered from its source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** The reading this file was written against — see the header for how it was taken. */
const OFFENDERS_AT_THE_FIX = 0;
/**
 * A FLOOR and not a count, because the population is head-relative: it grew 1042 → 1043 → 1048 → 1049 →
 * 1050 across four merges while this row was in review, and an equality here would turn trunk red on the next
 * ordinary file addition — a tripwire rather than a guard. Below this the WALK is broken (a moved root, a
 * sandboxed `git ls-files`), which is the only thing this test is for; the count it actually found is in
 * the failure message, so a reader never has to trust the number in this comment.
 */
const POPULATION_FLOOR = 900;

/**
 * Ground truth: the source with exactly the ranges the TypeScript PARSER calls comments removed.
 *
 * THE PARSER AND NOT THE SCANNER, learned the hard way while writing this. `ts.createScanner` has to be
 * told when a `/` is a regex (`reScanSlashToken`) AND when a `}` resumes a template literal
 * (`reScanTemplateToken`); driving it without the second read `` `;\n}\n\n/**…` `` as one long template
 * literal and quietly reported 0 comments for the rest of the file — the very failure this guard exists to
 * detect, reproduced in its own oracle. `createSourceFile` has already made both judgements correctly, so
 * the comment trivia is read off the parsed tree instead.
 */
function commentsRemovedByTheParser(file: string, source: string): string {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const ranges: [number, number][] = [];
  const seen = new Set<string>();
  const collectAt = (pos: number) => {
    for (const read of [ts.getLeadingCommentRanges, ts.getTrailingCommentRanges]) {
      for (const range of read(source, pos) ?? []) {
        const key = `${range.pos}:${range.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ranges.push([range.pos, range.end]);
      }
    }
  };
  const walk = (node: ts.Node) => {
    for (const child of node.getChildren(tree)) { collectAt(child.pos); walk(child); }
  };
  collectAt(0);
  walk(tree);
  ranges.sort((a, b) => a[0] - b[0]);
  let kept = "";
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last) continue; // a range already inside one taken: never double-cut
    kept += source.slice(last, start);
    last = end;
  }
  return kept + source.slice(last);
}

/** Lines whose trimmed start is `//` — the same population the #2131 census counted. */
function leadingCommentLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().startsWith("//")).length;
}

/**
 * Whether every character of `part` appears in `whole`, in order.
 *
 * This is how "did we delete anything the parser kept?" is asked WITHOUT reconstructing which ranges
 * `stripComments` deleted, which a pure function cannot be asked. If it only ever removed comment
 * characters, then everything the parser leaves behind is still present, in order, inside what we left
 * behind. Delete one character of real code and it is not.
 */
function isSubsequence(part: string, whole: string): boolean {
  let i = 0;
  for (let j = 0; j < whole.length && i < part.length; j += 1) if (whole[j] === part[i]) i += 1;
  return i === part.length;
}

function trackedSourceFiles(): string[] {
  return walkTree({ kind: "both", roots: ["packages", "scripts"] }).map((f) => f.path)
    .filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"));
}

const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

test("the walk finds a non-trivial population -- vacuity guard for the scan itself", () => {
  const files = trackedSourceFiles();
  assert.ok(files.length >= POPULATION_FLOOR,
    `only found ${files.length} tracked .ts/.mjs files under packages/ and scripts/, below the `
    + `${POPULATION_FLOOR} floor -- the walk is broken, not the tree (it read 1050 at d269bf9d4, and `
    + "that figure is a reading at a commit rather than a property of the repository)");
});

test("the leading-comment counter is not vacuous: real files DO carry comment-shaped lines through, and "
  + "that is the population the offender test filters", () => {
  // Without this, `offenders is empty` would also pass if `leadingCommentLines` counted nothing at all.
  // Three files legitimately carry `//` lines into the stripped output (browser JS, C# and a fixture, each
  // inside a real template literal) -- a floor of 1, because the point is that the counter counts.
  const carried = trackedSourceFiles().filter((f) => leadingCommentLines(stripComments(read(f))) > 0);
  assert.ok(carried.length >= 1,
    "no tracked file carries a `//` line into the stripped output at all -- the counter is broken, and "
    + "the offender assertion below would then be passing by counting nothing");
});

test("MUTATION: the offender comparison CHARGES a scan that left the comment behind", () => {
  // The exact opener from wake.test.ts:603, plus a comment for a desynchronised scan to swallow. This is
  // the positive control that `no tracked source file loses scan sync` names: that test asserts an empty
  // population, and an empty population proves nothing unless the comparison can be shown to charge.
  const desynchronising = "const named = text.match(/message `([^`]+)`/)?.[1];\n"
    + "// a real comment, hundreds of which vanished from view when this line desynchronised the scan\n"
    + "export const x = 1;\n";
  const byTheParser = leadingCommentLines(commentsRemovedByTheParser("f.ts", desynchronising));
  assert.equal(byTheParser, 0,
    "the oracle must agree that line is a comment -- otherwise the comparison could never charge it");
  // A scan that opens a phantom template literal at the first backtick copies everything after it through
  // verbatim, so its output IS the source: that is the output being charged here.
  assert.ok(leadingCommentLines(desynchronising) > byTheParser,
    "a stripper that left the comment behind must be charged by this comparison");
  assert.equal(leadingCommentLines(stripComments(desynchronising)), 0,
    "and the real stripper must not be -- one without the other pins nothing");
});

test("no tracked source file loses scan sync: stripComments keeps no comment line the parser removes", () => {
  const offenders: string[] = [];
  for (const file of trackedSourceFiles()) {
    const source = read(file);
    const ours = leadingCommentLines(stripComments(source));
    if (ours === 0) continue;
    const parser = leadingCommentLines(commentsRemovedByTheParser(file, source));
    if (ours > parser) offenders.push(`${file}  (${ours} left, parser leaves ${parser})`);
  }
  assert.equal(offenders.length, OFFENDERS_AT_THE_FIX,
    `${offenders.length} file(s) come out of stripComments still carrying a real comment line, which can `
    + "only happen where the scan believed it was inside a string while passing a comment. Every guard "
    + "reading one of these is quiet from that point on (#2131, where the unfixed stripComments read 99 "
    + "of 1042 tracked files, and 100 of 1050 once main had moved -- both readings at a commit):\n"
    + offenders.map((o) => `  ${o}`).join("\n"));
});

test("nothing but a comment is ever deleted: everything the parser keeps survives stripComments", () => {
  // The dangerous direction, and the one the leading-comment census above is structurally blind to: a
  // file with no comments left after the desync point reads clean to that census and can still have lost
  // code. The unfixed stripComments charged 56 files at ec27b8ccb and 56 again at d269bf9d4, each a regex
  // literal containing `//` read as a comment start -- the one figure in this row that three different
  // populations agreed on.
  const offenders: string[] = [];
  for (const file of trackedSourceFiles()) {
    const source = read(file);
    if (!isSubsequence(commentsRemovedByTheParser(file, source), stripComments(source))) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `${offenders.length} file(s) lost characters the TypeScript parser does not call a comment -- real `
    + "code deleted from what every guard downstream reads as the file (#2131, where this first read 56 files):\n"
    + offenders.map((o) => `  ${o}`).join("\n"));
});

test("MUTATION: the deleted-real-code predicate CATCHES an over-eager strip", () => {
  // `assert.deepEqual(offenders, [])` above passes on an empty population, so the predicate itself is
  // shown to charge: an output with a line of real code missing is no longer a supersequence of what the
  // parser keeps. The fixture is the very line the old scan truncated -- a regex full of escaped slashes.
  const source = "const r = /a\\/\\//;\nconst keep = 1;\n";
  const overEager = source.replace("const keep = 1;\n", ""); // real code deleted, no comment involved
  const kept = commentsRemovedByTheParser("f.ts", source);
  assert.ok(isSubsequence(kept, stripComments(source)),
    "the real stripper must pass its own predicate on this line");
  assert.ok(!isSubsequence(kept, overEager),
    "and an output with a real line deleted must be charged");
});
