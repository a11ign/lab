/**
 * EVERY REPO-RELATIVE PATH NAMED IN A ROW'S PROSE -- a LEAF module (#462, B4), extracted out of
 * `row-reachability.mjs` so `row-claim/file-overlap-rule.mjs` can read the SAME extraction without
 * dragging in that file's own `@a11ign/worker-fleet/cli-flags` import (fine for ITS `main()`, fatal
 * before `npm ci`/`npm run build` if reached from a pre-install entry -- `pre-install-import-graph.test.ts`
 * caught exactly this the first time sharing the regex was tried by importing the whole file).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import {
  regionPathsFromBody, extractRegionSection, declaredRegionFiles, regionCovers, rootFilesOnMain,
  extractLabeledSection, hasTemplateField,
} from "../../../../scripts/region-paths.mjs";

/** #999's fixture lives beside the others this directory already keeps (`pr-584-body.md`, `issue-687-body.txt`). */
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

test("extracts a backticked path from a Region section", () => {
  assert.deepEqual(regionPathsFromBody("Region: `scripts/row-claim.mjs`."), ["scripts/row-claim.mjs"]);
});

test("extracts more than one path, deduplicated", () => {
  const body = "Region: `scripts/row-claim.mjs` and `scripts/row-claim.mjs` again, plus "
    + "`packages/lab/src/packaging/row-claim.test.ts`.";
  assert.deepEqual(regionPathsFromBody(body),
    ["scripts/row-claim.mjs", "packages/lab/src/packaging/row-claim.test.ts"]);
});

test("prose with no path returns [], not a crash or a guess", () => {
  assert.deepEqual(regionPathsFromBody("This row is about the ready lane in general."), []);
});

test("only recognises the four real top-level roots -- a path-shaped word elsewhere is not swept in", () => {
  assert.deepEqual(regionPathsFromBody("See node_modules/foo/bar.mjs for reference."), []);
});

test("a docs path (.md) is extracted too -- the caller decides whether to treat it as code", () => {
  assert.deepEqual(regionPathsFromBody("Region: `docs/getting-started.md`."), ["docs/getting-started.md"]);
});

// --- extractRegionSection / declaredRegionFiles: #710, scoping "what will this row change" to the
// declared Region section rather than every path the whole body mentions ---

test("#710 ACCEPTANCE: a body with no Region section at all returns null -- CANNOT_ASK, not an empty list", () => {
  const body = "Just some prose about the ready lane, with no Region heading or line anywhere.";
  assert.equal(extractRegionSection(body), null);
  assert.equal(declaredRegionFiles(body), null);
});

test("a '## Region' heading section runs until the next heading", () => {
  const body = "## What\n\nSome text mentioning `scripts/unrelated.mjs` as a worked example.\n\n"
    + "## Region\n\n`scripts/acceptance-commands.mjs`, `packages/lab/src/packaging/acceptance-commands.test.ts`.\n\n"
    + "## Acceptance\n\nnpx tsx --test whatever\n";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/acceptance-commands.mjs", "packages/lab/src/packaging/acceptance-commands.test.ts"]);
});

test("a '## Region' heading section at the END of the body runs to the end, not forever", () => {
  const body = "## What\n\ntext\n\n## Region\n\n`scripts/foo.mjs` for the fix.\n";
  assert.deepEqual(declaredRegionFiles(body), ["scripts/foo.mjs"]);
});

test("a bare inline 'Region:' line -- this issue's own shape -- is read as a single-line section", () => {
  const body = "Some prose above.\n\nRegion: `scripts/row-claim/file-overlap-rule.mjs`, `scripts/row-claim.mjs`.";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/row-claim/file-overlap-rule.mjs", "scripts/row-claim.mjs"]);
});

test("a Region section that mentions directories only inside a SENTENCE returns [], not null -- a real, " +
  "comparable, empty answer (#941: a STANDALONE directory line declares a prefix; see below)", () => {
  const body = "## Region\n\n`scripts/` for the helper, `packages/lab/src/packaging/` for its test, and "
    + "`docs/` wherever the procedure ends up being written down.\n";
  assert.deepEqual(declaredRegionFiles(body), []);
});

test("#710 REGRESSION FIXTURE: #705's real body, boiled down -- a file cited in prose as a worked " +
  "example must not appear in declaredRegionFiles when the Region section never names it", () => {
  const body = "## The fixture: what it would actually have taken\n\n"
    + "Rescuing `packages/lab/scripts/audit-rule-coverage.ts` from `lead/inventory-bootstrap` "
    + "(2026-09-06):\n\n"
    + "## Region\n\n`scripts/` for the helper, `packages/lab/src/packaging/` for its test, and `docs/` "
    + "wherever the stranded-branch procedure ends up being written down.\n";
  // regionPathsFromBody (the whole-body scan) DOES pick up the fixture mention -- this is what #710
  // measured as the actual cause of the false collision.
  assert.deepEqual(regionPathsFromBody(body), ["packages/lab/scripts/audit-rule-coverage.ts"]);
  // declaredRegionFiles must not: the Region section itself names only bare directories.
  assert.deepEqual(declaredRegionFiles(body), []);
});

test("a genuine Region-declared file with an extension is still extracted -- the fix must not become " +
  "\"never find anything\"", () => {
  const body = "## Region\n\n`scripts/row-claim.mjs` and `packages/lab/src/packaging/row-claim.test.ts`.\n";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/row-claim.mjs", "packages/lab/src/packaging/row-claim.test.ts"]);
});

// --- #941: a STANDALONE directory line in a Region declares a PREFIX, never nothing ---

/** #941's own three-line block: one file and two directories, fenced the way rows are filed. */
const THREE_LINE_REGION = "## Region\n\n```\nscripts/select-changed-tests.mjs\npackages/lab/src/packaging/\ndocs/\n```\n\n"
  + "## Not in scope\n\nnothing\n";

test("#941 REPRODUCED: the file grammar alone reads only the file out of this block -- the defect's own output", () => {
  // What `declaredRegionFiles` returned for this block before #941: the two directory lines vanished.
  assert.deepEqual(regionPathsFromBody(extractRegionSection(THREE_LINE_REGION) ?? ""), ["scripts/select-changed-tests.mjs"]);
});

test("#941: a standalone directory line declares a prefix, beside the files the block names", () => {
  assert.deepEqual(declaredRegionFiles(THREE_LINE_REGION),
    ["scripts/select-changed-tests.mjs", "packages/lab/src/packaging/", "docs/"]);
});

test("#941: a Region of ONLY directories no longer declares the empty set -- the five zero-declaration rows' shapes", () => {
  const region = (...lines: string[]) => `## Region\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`;
  assert.deepEqual(declaredRegionFiles(region("docs/", "packages/lab/src/packaging/")), ["docs/", "packages/lab/src/packaging/"]);
  assert.deepEqual(declaredRegionFiles(region("packages/lab/src/packaging/")), ["packages/lab/src/packaging/"]);
  assert.deepEqual(declaredRegionFiles(region("scripts/")), ["scripts/"]);
  assert.deepEqual(declaredRegionFiles(region("packages/control/ansible/")), ["packages/control/ansible/"]);
});

test("#941: a bulleted or backticked directory line is still a standalone line", () => {
  const body = "## Region\n\n- `packages/control/ansible/`\n* docs/board/\n";
  assert.deepEqual(declaredRegionFiles(body), ["packages/control/ansible/", "docs/board/"]);
});

test("#941: regionCovers -- a directory covers everything under it, and nothing that merely shares its spelling", () => {
  assert.ok(regionCovers("docs/", "docs/board/summaries/x.md"));
  assert.ok(!regionCovers("docs/", "docsite/x.md"), "a prefix is a directory, not a string");
  assert.ok(regionCovers("scripts/a.mjs", "scripts/a.mjs"));
  assert.ok(!regionCovers("scripts/a.mjs", "scripts/a.mjs.bak"), "a file entry covers only itself");
});

test("#941: a one-line LIST of directories declares each item -- 7 older rows were written this way", () => {
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/`, `.github/workflows/`, `docs/adr/`\n"),
    ["packages/", ".github/workflows/", "docs/adr/"], "#69's shape");
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/scorer/python/`; `packages/judge/src/`\n"),
    ["packages/scorer/python/", "packages/judge/src/"]);
  assert.deepEqual(declaredRegionFiles("## Region\n\ndocs/board/ and scripts/\n"), ["docs/board/", "scripts/"]);
  // #43's shape: one item is a path and one is not a repository path at all. The path is still declared.
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/lab/scripts/`, the lab machine\n"), ["packages/lab/scripts/"]);
});

test("#941: EVERY root the tree tracks declares -- read from the tree, never from a list someone typed", () => {
  // The first version hand-listed four roots and read `examples/`, `data/` and `.claude/skills/` as `[]`.
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const roots = execFileSync("git", ["ls-tree", "-d", "--name-only", "HEAD"], { cwd: repo, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean);
  assert.ok(roots.length >= 5, `the tree listed ${roots.length} root(s), so this asserts over almost nothing`);
  for (const root of roots) {
    assert.deepEqual(declaredRegionFiles(`## Region\n\n${root}/\n`), [`${root}/`], `${root}/ vanished`);
    assert.deepEqual(declaredRegionFiles(`## Region\n\n\`${root}/nested/\`\n`), [`${root}/nested/`]);
  }
});

test("#975: a ROOT-LEVEL file the tree has is declared -- on its own line, backticked, or in a fenced list", () => {
  // `PATH_IN_PROSE` needs one of four prefixes, so a Region naming `package.json` declared NOTHING for it and
  // the claim-time overlap check was blind to the repository's most-edited files. Measured 2026-09-11: 10 of
  // 64 open rows named a root file the parser dropped.
  for (const name of ["package.json", "CLAUDE.md", "eslint.config.js"]) {
    assert.deepEqual(declaredRegionFiles(`## Region\n\n${name}\n`), [name], `${name} on its own line vanished`);
    assert.deepEqual(declaredRegionFiles(`## Region\n\n\`${name}\`\n`), [name], `backticked ${name} vanished`);
    assert.deepEqual(declaredRegionFiles(`## Region\n\n\`\`\`\nscripts/row-file.mjs\n${name}\n\`\`\`\n`),
      ["scripts/row-file.mjs", name], `${name} beside a prefixed path vanished`);
  }
});

test("#975: ANCHORED TO THE TREE -- a word with a dot that is not a root file declares nothing", () => {
  // The rule a person can check: `origin/main` has a file of that name at the root, or it is prose. Otherwise
  // "the census writes evidence.json" would declare a file nobody touches, and the overlap check would refuse
  // an unrelated claim.
  const known = new Set(["package.json"]);
  assert.deepEqual(declaredRegionFiles("## Region\n\nevidence.json\nmanifest.json\n", { rootFiles: known }), []);
  assert.deepEqual(declaredRegionFiles("## Region\n\npackage.json\nevidence.json\n", { rootFiles: known }), ["package.json"]);
  // And the real tree answers the same way: `package.json` is there, `evidence.json` is not.
  const tree = rootFilesOnMain().files;
  assert.ok(tree.has("package.json") && tree.has("CLAUDE.md"), "the root listing is empty or wrong, so the rule asserts nothing");
  assert.equal(tree.has("evidence.json"), false);
});

test("#975: a root file named in the Region's PROSE is a declaration, and one named elsewhere in the body is not", () => {
  // The parsed-section rule: what the Region says is a declaration, wherever in the section it appears. A row
  // that cites `package.json` in its "What it is" is not declaring it -- `extractRegionSection` bounds this.
  assert.deepEqual(declaredRegionFiles("## Region\n\nThe fix is in `package.json`, one line.\n"), ["package.json"]);
  assert.deepEqual(declaredRegionFiles("## What it is\n\n`package.json` is wrong.\n\n## Region\n\nscripts/row-file.mjs\n"),
    ["scripts/row-file.mjs"]);
});

test("#975: the #941 directory rule still declares its prefixes beside a root file", () => {
  // #941 is the row this file's other half exists for, and a root-file rule must not cost it: a Region of one
  // directory and one root file declares both.
  assert.deepEqual(declaredRegionFiles("## Region\n\npackages/control/ansible/\npackage.json\n"),
    ["packages/control/ansible/", "package.json"]);
  assert.deepEqual(declaredRegionFiles("## Region\n\ndocs/, scripts/, README.md\n"), ["docs/", "scripts/", "README.md"]);
});

test("#941: `.` and `..` segments declare nothing -- neither names a directory inside the tree", () => {
  assert.deepEqual(declaredRegionFiles("## Region\n\n../outside/\n./\ndocs/../x/\n"), []);
});

test("#941: a sentence that MENTIONS a directory declares nothing -- only a standalone path line does", () => {
  // Region prose was read as a declaration twice on 2026-09-11 (#848, #920), and a prefix rule must not
  // reopen that. The #710 fixture above is the same rule on a real body: its directories sit in a sentence.
  const body = "## Region\n\nWhatever it needs under `docs/`, and `scripts/` for the helper.\n";
  assert.deepEqual(declaredRegionFiles(body), []);
});

// --- extractLabeledSection / hasTemplateField: #707's generalisation, any field name ---

test("extractLabeledSection: a heading section's content runs to the next heading, for a field other "
  + "than Region", () => {
  const body = "## Acceptance\n\n```\nnpx tsx --test x\n```\n\n## Next\n\nirrelevant\n";
  assert.equal(extractLabeledSection(body, "Acceptance"), "```\nnpx tsx --test x\n```");
});

test("extractLabeledSection: a hyphenated, multi-word field (\"Open-check\") matches the real template's "
  + "own longer heading text (\"Open-check -- the command that shows this row is still open\")", () => {
  const body = "## Open-check -- the command that shows this row is still open\n\n"
    + "```\ngh issue view 707 --json state\n```\n";
  assert.equal(extractLabeledSection(body, "Open-check"), "```\ngh issue view 707 --json state\n```");
});

test("extractLabeledSection: an inline `Field:` line works exactly like Region's", () => {
  assert.equal(extractLabeledSection("Acceptance: npm test", "Acceptance"), "npm test");
});

test("extractLabeledSection: absent entirely returns null", () => {
  assert.equal(extractLabeledSection("no headings here", "Acceptance"), null);
});

test("extractLabeledSection: one field's heading does not match a DIFFERENT field's name -- word-bounded, "
  + "not a bare substring (\"Region\" must not match inside some other word)", () => {
  const body = "## Regional notes\n\nsomething unrelated\n";
  assert.equal(extractLabeledSection(body, "Region"), null);
});

test("hasTemplateField: false for a heading with nothing under it before the next one", () => {
  const body = "## Region\n\n## Acceptance\n\nreal content\n";
  assert.equal(hasTemplateField(body, "Region"), false);
  assert.equal(hasTemplateField(body, "Acceptance"), true);
});

/**
 * #999: A REGION CANNOT DECLARE A FILE WITH NO EXTENSION — the fenced half.
 *
 * `PATH_IN_PROSE` requires an extension of two to four letters, so a path without one was never a path to
 * this parser: not dropped with a message, never seen. The live instance is #911, whose whole subject is
 * `scripts/git-hooks/pre-push` — its Region named that file and the test beside it, and
 * `declaredRegionFiles` returned ONE entry, the test. Eleven tracked files under the four declarable
 * prefixes have no extension and four of them are the git hooks, which are files rows change; a hook's
 * name is its contract with git, so renaming one to suit a parser is not available.
 *
 * THE FIX IS SCOPED TO THE FENCE, and that is the whole design rather than an implementation detail.
 * Deleting the extension clause from `PATH_IN_PROSE` is the obvious fix and the wrong one: that regex runs
 * over prose too, so `packages/lab/src` in a sentence would become a declared FILE and #941/#945's
 * directory-prefix rule would go silently, in the same direction as the bug. The assertions below pin BOTH
 * halves — the fenced line declares, and the prose mention still does not.
 */
const REGION_FENCE = (...paths: string[]) =>
  `## Region\n\n\`\`\`\n${paths.join("\n")}\n\`\`\`\n\n## Acceptance\n\nx\n`;

test("#999 REPRODUCED: the prose grammar alone reads nothing out of an extension-less path", () => {
  // The defect's own output, from the grammar that has it -- so this file shows the fault rather than
  // describing it, and would fail if `PATH_IN_PROSE` ever started matching these on its own.
  assert.deepEqual(regionPathsFromBody("scripts/git-hooks/pre-push"), []);
  assert.deepEqual(regionPathsFromBody("`scripts/git-hooks/pre-commit`"), []);
});

test("#999: a fenced Region line naming an extension-less file IS declared", () => {
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("scripts/git-hooks/pre-push")),
    ["scripts/git-hooks/pre-push"]);
  // All four hooks, because all four are files rows change and one working is not four working.
  for (const hook of ["pre-push", "pre-commit", "post-checkout", "reference-transaction"]) {
    assert.deepEqual(declaredRegionFiles(REGION_FENCE(`scripts/git-hooks/${hook}`)),
      [`scripts/git-hooks/${hook}`]);
  }
});

test("#999 ACCEPTANCE: #911's REAL body -- as filed, not an approximation -- resolves to TWO entries", () => {
  // THE BODY AS FILED, read from a fixture of the issue itself. A hand-built approximation would be a
  // fixture of what I believe the row says, and the defect was precisely that the row said something the
  // parser could not hear. `issue-911-body.md` is #911's body, fetched whole.
  const body = readFileSync(`${FIXTURES}/issue-911-body.md`, "utf8");
  const declared = declaredRegionFiles(body);
  assert.deepEqual([...(declared ?? [])].sort(),
    ["packages/lab/src/packaging/pre-push-hook-scope.test.ts", "scripts/git-hooks/pre-push"],
    "#911's Region names two files; before this row the hook was invisible and it resolved to one");
});

test("#999: PROSE still requires an extension -- #941/#945's directory rule is untouched", () => {
  // The trap, asserted rather than trusted. Each of these is a MENTION, and a mention is a guess.
  const prose = "## Region\n\nThe walk lives under packages/lab/src and the hooks in scripts/git-hooks.\n";
  assert.deepEqual(declaredRegionFiles(prose), [],
    "a sentence naming a directory declares nothing -- deleting the extension clause would make both of "
    + "these declared FILES, which is #941/#945 undone in the same direction as the bug this row fixes");
  // And an extension-less FILE in prose is still not a declaration: only the fence promotes it.
  assert.deepEqual(declaredRegionFiles("## Region\n\nIt changes scripts/git-hooks/pre-push, mostly.\n"), []);
  // While the directory rule keeps working, fenced or not -- a standalone line ending in `/` is a PREFIX.
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("packages/control/ansible/")),
    ["packages/control/ansible/"]);
});

test("#999: a fenced line with anything else on it is prose, not a declaration", () => {
  // The same standalone discipline `DIRECTORY_ITEM` carries. The Region's prose has been read as a
  // declaration twice (#848, #920) and a fence must not reopen that.
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("scripts/git-hooks/pre-push and the test beside it")), []);
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("# scripts/git-hooks/pre-push")), []);
});

test("#999: only the REGION's own fence declares -- a fenced block elsewhere in the body does not", () => {
  const body = "## Region\n\n```\nscripts/region-paths.mjs\n```\n\n## Acceptance\n\n```\n"
    + "scripts/git-hooks/pre-push\n```\n";
  assert.deepEqual(declaredRegionFiles(body), ["scripts/region-paths.mjs"],
    "a path in the Acceptance block is a command's argument or a worked example, never a declaration of "
    + "intent to change it -- the same line #975 draws for a root file named elsewhere in the body");
});

test("#999: #975's root-level files still resolve, and `.`/`..` still declare nothing", () => {
  const known = new Set(["package.json", "CLAUDE.md"]);
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("package.json"), { rootFiles: known }), ["package.json"],
    "a root file has no `/` and is #975's rule's to declare, not this one's -- both must keep working");
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("../outside/thing"), { rootFiles: known }), []);
  assert.deepEqual(declaredRegionFiles(REGION_FENCE("./scripts/git-hooks/pre-push"), { rootFiles: known }), []);
});

/**
 * #995: THE READER SAYS WHICH REF ANSWERED, SO AN EMPTY ANSWER IS NEVER SILENT.
 *
 * `rootFilesOnMain` used to return a bare `Set`, and three different situations produced the same value: a
 * successful read of `origin/main`, a fallback read of `HEAD`, and a total failure. The last one silently
 * declared that no Region names a root-level file — the exact state #975 had just fixed the parser to
 * avoid, arriving one function below it. This repository has recorded that shape four times: a guard that
 * skips quietly is indistinguishable from one that never ran.
 *
 * DRIVEN IN A REAL REPOSITORY, never by stubbing the module's own git call. The no-ref case is a directory
 * that `git` cannot answer about at all, which is the situation being claimed — a stub would prove the
 * branch is reachable, not that git's refusal reaches it.
 */
/**
 * #1081: DOES THIS CHECKOUT HAVE `origin/main` AT ALL?
 *
 * `actions/checkout` fetches the pull request's merge ref and its base -- not the remote-tracking
 * `origin/main` these assertions name. `rootFilesOnMain()` loops `["origin/main", "HEAD"]`, so with the
 * first absent the second answers correctly and **the tests below fail on the checkout rather than on the
 * code**. Measured on #1080, where `docs` reported both as failures of a PR that touches neither file.
 *
 * THE CORRECT SHAPE WAS ALREADY FOUR LINES BELOW ONE OF THEM: `#995: the reading is a SHAPE` accepts
 * `"origin/main" | "HEAD" | null`. Two assertions in one file disagreeing about what a legitimate reading
 * looks like -- and it is three now, counting the memo test's closing line.
 *
 * ASKED BY A ROUTE THE SUBJECT DOES NOT USE (#1064's rule): `rootFilesOnMain` runs `git ls-tree`, this
 * runs `git rev-parse --verify`. A defect in one cannot silence the other.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const defaultRevParse = (): void => {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"],
    { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv(), stdio: ["ignore", "pipe", "pipe"] });
};

export function originMainReadable(
  { run = defaultRevParse }: { run?: () => void } = {},
): boolean {
  // THE CATCH IS NARROWED TO WHAT GIT SAYS, and that is not fastidiousness. My first version caught
  // everything and returned `false` -- and `REPO` was not defined in this file, so a **ReferenceError**
  // became the verdict "this checkout has no origin/main". Both source assertions silently skipped in a
  // checkout that has one, and the suite went green. **A catch that turns a coding error into an
  // environment verdict is the defect this row is about, committed inside its own fix.**
  try {
    run();
    return true;
  } catch (error) {
    if (typeof (error as { status?: number }).status !== "number") throw error;
    return false;
  }
}

/**
 * Reported at RUN time, never as a `{ skip }` option: a skipped test is invisible in an ordinary run and
 * reads as "not applicable", and this one is skipped for a reason a reader needs. The message scopes
 * itself, because only the SOURCE assertion is conditional -- the rest of each test still runs.
 */
export function sourceAssertionSkipped(
  { readable = originMainReadable, warn = console.error }:
    { readable?: () => boolean; warn?: (s: string) => void } = {},
): boolean {
  if (readable()) return false;
  warn("SKIPPED, the `origin/main` source assertion only (this checkout has no remote-tracking "
    + "`origin/main`, as a CI checkout does not): `rootFilesOnMain` falls through to HEAD, which is "
    + "correct. The rest of this test still ran.");
  return true;
}

test("#995: a successful reading names the ref that answered", () => {
  const reading = rootFilesOnMain();
  if (!sourceAssertionSkipped()) {
    assert.equal(reading.source, "origin/main",
      "this checkout HAS origin/main, so the first source must be the one reported -- a fallback here "
      + "would mean the reader silently answered from somewhere else");
  }
  // NOT conditional: whichever ref answered, a real reading names the repository's root files. Losing this
  // to an environment check would be the cure killing the patient.
  assert.ok(reading.files.has("package.json"));
});

test("#995: the reading is a SHAPE, so the empty case is distinguishable from a real read", () => {
  // The property the row is about, stated as a type rather than a value: every caller can tell the three
  // apart, whether or not it chooses to.
  const reading = rootFilesOnMain();
  assert.deepEqual(Object.keys(reading).sort(), ["files", "source"]);
  assert.ok(reading.files instanceof Set);
  assert.ok(reading.source === null || reading.source === "origin/main" || reading.source === "HEAD");
});

test("#995: a failed reading is NOT memoised -- one bad moment must not be permanent", () => {
  // THE SHARPER HALF OF THE MEMO. The cache was on the value and `new Set()` is truthy, so a single failed
  // read poisoned the process: every later call returned the cached empty set without retrying, and every
  // root file stayed undeclarable for the life of that process. A worktree read mid-fetch did exactly that.
  //
  // DRIVEN, not asserted on source text: a directory git cannot answer about, read through the same
  // `execFileSync` every other call uses, and then the real repository in the SAME process. If the failure
  // were cached, the second reading would come back empty.
  const nowhere = mkdtempSync(join(tmpdir(), "a11y-995-"));
  try {
    const failed = rootFilesOnMain({ repoRoot: nowhere });
    assert.equal(failed.source, null, "a directory outside any repository cannot name a source");
    assert.equal(failed.files.size, 0);
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
  }
  const afterwards = rootFilesOnMain();
  if (!sourceAssertionSkipped()) {
    assert.equal(afterwards.source, "origin/main",
      "the failure was cached: every root file would stay undeclarable for the life of this process");
  }
  // THE MEMO CLAIM ITSELF IS NOT CONDITIONAL, and this is the assertion that carries it: a cached failure
  // would return the empty set here whatever ref answered. The source line above is about WHICH ref; this
  // one is about whether the reader retried at all, which is the property the test is named for.
  assert.ok(afterwards.files.has("package.json"),
    "the failure was cached: every root file would stay undeclarable for the life of this process");
});

test("#1081: the source assertion is conditional and the READING assertion is not", () => {
  // Driven both ways over the predicate, because a skip proved only by running somewhere that happens to
  // lack the ref is a skip proved to be QUIET. The two directions are the two environments: a developer
  // checkout with remote-tracking refs, and CI's, which fetches the PR's merge ref and its base.
  // DRIVES THE REAL FUNCTION, not a local closure shaped like it. The first version of this test built
  // its own `skip` and asserted on that -- so making the real `sourceAssertionSkipped` unconditional was
  // **0 red**. A guard whose only input is a fixture proves the fixture (#1077), and it took a mutation
  // to see it here too.
  const said: string[] = [];
  const warn = (m: string) => said.push(m);
  assert.equal(sourceAssertionSkipped({ readable: () => true, warn }), false,
    "with origin/main present the source assertion is REACHED");
  assert.deepEqual(said, [], "and nothing is announced when nothing was skipped");
  assert.equal(sourceAssertionSkipped({ readable: () => false, warn }), true,
    "without it the source assertion is skipped");
  assert.equal(said.length, 1, "and it SAYS so -- a silent skip reads as 'not applicable'");
  assert.match(said[0], /The rest of this test still ran/,
    "and scopes itself, or a reader takes the whole test as skipped");

  // AND THE READABILITY READ ITSELF: a thrown ReferenceError must not become "no origin/main".
  assert.equal(originMainReadable({ run: () => {} }), true, "a clean rev-parse reads as present");
  assert.equal(originMainReadable({ run: () => { throw Object.assign(new Error("exit 1"), { status: 1 }); } }),
    false, "and git's own exit-1 reads as absent");
  assert.throws(() => originMainReadable({ run: () => { throw new ReferenceError("REPO is not defined"); } }),
    /REPO is not defined/,
    "a coding error must RETHROW -- my first version caught it and reported 'no origin/main', skipping "
    + "both assertions in a checkout that has one");

  // AND THE REAL PREDICATE AGREES WITH THIS CHECKOUT, or the two directions above are about nothing.
  assert.equal(originMainReadable(), true,
    "this checkout has origin/main, so the conditional above is exercised on its TRUE branch here; CI "
    + "exercises the other one");
});

test("#1081: the population of environment-asserting guards, stated", () => {
  // THE SWEEP IS THE ROW, not this file's two lines. Measured 2026-09-12 across
  // `packages/*/src/**/*.test.ts` by two patterns:
  //
  //   assertions comparing a reading's `source` to the literal "origin/main"   2, both in THIS file
  //   files already carrying a named skip for a missing ref                    1 (row-reachability)
  //
  // What the sweep CANNOT see, said rather than implied: an assertion that names a machine property
  // without spelling `origin/main` -- a port being free, a corpus present, a worker answering. Those are
  // different environment facts needing different reads, and each gets its own row (#1064's rule).
  const text = readFileSync(new URL("./region-paths.test.ts", import.meta.url), "utf8");
  const unconditional = [...text.matchAll(/assert\.equal\([^;]*?\.source, "origin\/main"/g)].length;
  const guarded = [...text.matchAll(/if \(!sourceAssertionSkipped\(\)\) \{/g)].length;
  assert.equal(unconditional, guarded,
    `every "origin/main" source assertion must sit inside the skip: ${unconditional} assertions, `
    + `${guarded} guards. A new one added outside it fails here rather than in CI`);
  assert.ok(guarded >= 2, "and the two this row fixed must still be guarded");
});
