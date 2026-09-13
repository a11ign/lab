/**
 * A test that spawns `git` to enumerate a ref/branch/tag/file population and then asserts something about
 * every member of it must first prove that population is non-empty — or it answers correctly about the
 * WRONG population (docs/backlog.md, "a check that answers correctly about the wrong population", named
 * by `ceo` after six instances in one day). `git branch -r --list 'origin/agent/*'` is the sharpest of
 * the six: this repo's agent branches are never pushed, so that check answers "clear" unconditionally,
 * for every branch, forever — the failure mode with teeth, because a false CLEAN is ignored while a false
 * WORK LIST gets acted on.
 *
 * DISCOVERED, never hand-listed, over the identical shape as `git-spawn-classification.test.ts` (env
 * scrubbing) and `exit-code-contract.test.ts`'s Python extension (exit-code classification): every
 * `.test.ts` file spawning git to list branches/tags/log/grep/ls-files/show/diff must be classified here.
 *
 * CLASSIFICATION, not a bare pass/fail, because phrasing varies too much to trust a regex on its own —
 * `.length >= N`, `.size >= N`, a named local (`scanned`, `checked`) compared against a floor, or (for a
 * population used only as a lookup SET rather than iterated) a documented reason no guard is needed. Each
 * classified file's quoted guard expression is checked to literally still appear in the file, so a
 * classification cannot silently drift from what the file actually does.
 *
 * #633: `diff` JOINED THE POPULATION LIST, and it is the sharpest member. This file's own scope used to
 * read "branch/tag/log/grep/ls-files/show" — `diff` was left out on the reasoning that a two-ref
 * comparison "enumerates" less obviously than `ls-files`. It is the identical vacuity, sharper: a `git
 * diff A..B` where `B` is an ancestor of `A` (routinely `A` itself — `HEAD` compared against
 * `origin/main` on `main`'s own tip) is `diff(B, B)`, empty BY CONSTRUCTION, and a "0 missing" assertion
 * over it is proven about zero symbols. `pre-push-resolve-toward-main.test.ts`'s "A CLEAN MERGE PASSES"
 * test was exactly this shape — measured live, 2026-09-09, after the vacuity held a real SIGPIPE false
 * refusal invisible for weeks (the guard's own test could never have caught it: it examined nothing).
 * Fixed there directly (a synthetic 100 KB fixture with a genuinely non-empty, two-symbol population);
 * this entry is what stops the SAME shape landing unclassified in the next file that reaches for `diff`.
 *
 * SWEPT AND BOUNDED, not exhaustive: this file's population is git-ref/branch/tag/log/grep/ls-files/
 * show/diff calls specifically (items 1-2 of the six-instance row, plus #633's `diff` extension).
 * `readdirSync`-based discovery was already swept separately (docs/backlog.md, "checked every
 * readdirSync-based discovery test in the tree (55 files)... all but that instance already have one")
 * and is not re-walked here. A broader sweep of every `matchAll`-based population in the tree (~50 files)
 * found two further confirmed gaps outside this file's scope (`criteria-counts-are-not-spelled-out.test.
 * ts`, `candidate-gate-examines-the-candidate.test.ts` — both fixed directly, not folded into this
 * discovery, because each has its own bespoke population shape that a generic classifier could not
 * describe honestly) and two soft gaps also fixed directly (`capture-faults.test.ts`'s negative
 * assertion lacked a positive-count proof that the file it reads is non-trivial; `action-reference.test.
 * ts`'s third test relied on a SIBLING test's guard rather than proving its own population, which
 * `node:test` cannot enforce since one test's failure does not stop a sibling from reporting a false
 * pass). See docs/backlog.md for the full sweep record.
 *
 * DELIBERATELY NOT BROADENED to catch an indirected call site (`const git = (...args) =>
 * execFileSync("git", args, ...)`, the shape `pre-push-resolve-toward-main.test.ts` and `pre-push-stale-
 * base.test.ts` both use). `git-spawn-classification.test.ts`'s sibling walk covers "any git spawn" with
 * a wrapper-tolerant `<identifier>("git", ...)` pattern for a DIFFERENT question (env-scrubbing); this
 * file's own literal-subcommand pattern is what makes CLASSIFICATION's guard-expression check meaningful
 * (it greps for the exact string proving a population non-empty, which only exists to find for a call
 * whose subcommand is a literal in the source). Widening it would require inventing a second checking
 * strategy for wrapped calls this file was never built to describe honestly — narrower coverage that is
 * checkable beats broader coverage that only looks checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { declareTreeWideGuard } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * This file itself spawns `git ls-files` to build `tracked()`, which matches `SPAWNS_GIT_POPULATION` --
 * so once committed it discovers ITSELF. Excluded here, in code, rather than by adding a `CLASSIFICATION`
 * entry for it: the honest classification would be true (it IS guarded, by the vacuity-guard test above
 * it) and also a file writing its own exemption into the list it maintains, which a reader has no way to
 * tell apart from an ordinary row. Same device `real-page-corpus-freshness.test.ts` uses for the
 * identical reason.
 */
const SELF = "packages/lab/src/packaging/git-population-vacuity.test.ts";

/** `git branch -r`, `git tag`, `git log`, `git grep`, `git ls-files`, `git show`, `git for-each-ref`,
 * `git diff` (#633) -- every git subcommand that ENUMERATES a population, comments stripped first so a
 * docstring mentioning one (this file's own header, or the sibling divergence test's) cannot be mistaken
 * for a real call. */
const SPAWNS_GIT_POPULATION =
  /\b(?:execFileSync|spawnSync)\(\s*["']git["'],\s*\[\s*["'](?:branch|tag|log|grep|ls-files|show|for-each-ref|diff)/;

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "*.test.ts"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"));
}

function discoverGitPopulationTests(): string[] {
  return tracked().filter((f) => f !== SELF && SPAWNS_GIT_POPULATION.test(stripComments(read(f))));
}

/**
 * Every discovered file: the quoted guard expression that proves its population non-empty (checked to
 * still literally appear in the file's source below), or `null` with a stated reason no guard applies.
 */
const CLASSIFICATION: Record<string, { guard: string | null; note: string }> = {
  "packages/lab/src/packaging/tracker-writer-population.test.ts": {
    guard: "examined >= 100",
    note: "guarded -- #1053's walk spawns `git ls-files scripts` once and asks, of every `.mjs` it "
      + "returns, whether the file sends a body to GitHub and whether its import closure reaches the leak "
      + "guard. A clean result is the EXPECTED answer, so 'no writer is undeclared or unguarded' and 'the "
      + "walk read no files' are otherwise the same observation. The floor counts FILES WALKED, not "
      + "writers found, because the writers found is the number that ought to be small -- and the writers "
      + "found is pinned EXACTLY against the registry's length beside it. A floor cannot hold a count "
      + "(#1067): the count that is also a claim gets an equality, the vacuity guard gets the floor. "
      + "Measured at 132 walked and 11 sending when written.",
  },
  "packages/lab/src/packaging/reported-counts.test.ts": {
    guard: 'assert.deepEqual(found, ["reported.test.ts: walked.length"]',
    note: "guarded, and NOT by a floor -- which would be this guard committing the defect it exists to "
      + "find (#1067). Its `git ls-files` walk over the packaging directory is proved non-empty by driving "
      + "the same predicate over a SYNTHETIC directory where the answer is known: a planted reported-floor "
      + "must be found and a planted precondition must not. Over the real tree a broken predicate returns "
      + "the baseline and looks clean; over the planted one it cannot. The two baseline tests then hold "
      + "the real walk in both directions -- a new instance fails, and an entry matching nothing fails -- "
      + "so no single number stands in for the count.",
  },
  "packages/lab/src/packaging/fixture-absence-guard.test.ts": {
    guard: "tree.files.length, countedByGit.size",
    note: "guarded twice, and the file count alone was not enough. #1067: the file-count guard was "
      + "`tree.files.length > 500` against a tree of 1,460 -- a floor tolerating the loss of two thirds of "
      + "the walk -- and is now an EQUALITY against a count derived from git independently of the walk "
      + "under test. This `guard` field moved with it: the table checks the literal still appears, so the "
      + "assertion and its classification go together or CI catches you. A clean result is the EXPECTED answer "
      + "here -- every declared symbol is absent from the working tree -- so 'nothing leaked' and 'the "
      + "walk read no files' are the same observation, which the count floor separates. But the count "
      + "does not say WHICH tree was read: pointing the walk at `origin/main` instead turned 0 red, "
      + "because the symbols are absent from both. The positive control is a marker present in that file "
      + "and not on the base, which the guard must FIND -- and it also forced `--others "
      + "--exclude-standard`, since plain `ls-files` is blind to the untracked file most likely to carry "
      + "a fresh leak. Its `ls-files` scrubs `GIT_*` through `sandboxGitEnv()` for the usual reason.",
  },
  "packages/lab/src/packaging/row-reachability.test.ts": {
    guard: "available === 0",
    note: "guarded, and the shape is the INVERSE of every other entry here. The usual guard proves a "
      + "population non-empty BEFORE asserting over it. This one asks whether the checkout can hold a "
      + "population AT ALL, and skips the assertion by name when it cannot -- `remoteRefsBesidesMain()` "
      + "counts remote-tracking refs under `origin/` besides main and HEAD, and `refPopulationVerdict` "
      + "returns \"skip\" at zero. #1064: the floor it gates (`examined.refs > 0`, #772's, and still "
      + "right) was asserting against an environment CI does not have -- `actions/checkout` fetches the "
      + "PR's ref and its base, not the other ~290 `origin/agent/*` -- so `docs` was red on #1057 and "
      + "#1062 and #1057 MERGED through it. THE READ IS DELIBERATELY A DIFFERENT QUESTION: asking "
      + "\"are there unmerged refs\" a second way would be asking the function under test. And only the "
      + "floor is conditional -- #719's own subject, that `environmentKey` is not reported missing, still "
      + "runs and is asserted with the ref question answered as CI answers it.",
  },
  "packages/lab/src/packaging/backlog-ready.test.ts": {
    guard: null,
    note: "RETIRED WITH ITS SUBJECT by #907, kept as an entry rather than deleted -- the same convention "
      + "the `action-reference` entry uses for #954, and the one worker-capture pointed out I had "
      + "followed once and not twice. The file is gone: it was one of six prose pins #907 removed, "
      + "because a test that fails when a sentence is reworded teaches people not to edit the docs. It "
      + "had already stopped being a git population on 2026-09-06 when the tracker moved to GitHub "
      + "Issues. **The record is the point: a classification that simply vanishes leaves the next reader "
      + "unable to tell a guard that was retired from one that was never classified.**",
  },
  "packages/lab/src/packaging/content-preservation.test.ts": {
    guard: "unpreservedLines([gone], hay)",
    note: "guarded BY A POSITIVE CONTROL, and a floor here would be wrong -- which is why this entry "
      + "reads differently from every other one. #1087 revived the check the entry below records as "
      + "retired. Its population is `git diff origin/main -- CLAUDE.md`, and on main's own tip that diff "
      + "is legitimately EMPTY: `trunk-guard.yml` runs this suite against main, where HEAD IS origin/main "
      + "and there is nothing to compare. So 'the population is non-empty' is not a precondition this "
      + "test may assert -- most of its life is spent correctly examining nothing, and a floor would fail "
      + "it for being in its normal state. The two empties are kept apart instead: `origin/main` failing "
      + "to RESOLVE is a defect and has its own test, while resolving to an identical tree is not. What "
      + "stands in for the floor is a CONTROL with a known answer -- a line present nowhere must be "
      + "reported and one present verbatim must not -- so the comparison is exercised on every run "
      + "regardless of what the diff holds. #1067's rule with the sign flipped: where a count would be a "
      + "claim, assert the count; where the count is legitimately zero, assert the INSTRUMENT instead.",
  },
  "packages/lab/src/packaging/claude-md-content-preservation.test.ts": {
    guard: null,
    note: "RETIRED WITH ITS SUBJECT by #907, for the reason above. Its own verdict on that PR is why: "
      + "it flagged eight substantive lines, and SEVEN were re-wrapped or de-numbered lines whose "
      + "content survives -- including the three of the paragraph #907 reworded to demonstrate that "
      + "rewording no longer fails the build. **It compares LINE BY LINE, and its own message says it "
      + "cannot tell a corrected sentence from a deleted one and does not try to.** What it did hold -- "
      + "that text leaving CLAUDE.md still exists somewhere under docs/, #181's 1,337 lines -- is real "
      + "and is now #1087, filed in the same commit range rather than left as a gap.",
  },
  "packages/lab/src/gates/unexaminable-declaration.test.ts": {
    guard: "found.size >= 20",
    note: "guarded -- #1030's sweep spawns `git grep -l -F` once per path-like token in lab-job.yml, "
      + "asking whether anything in the tree READS the path the prose names. A clean result is the "
      + "EXPECTED answer, so 'no prose names a file nothing reads' and 'the pattern stopped matching' "
      + "are otherwise the same observation -- which is why the floor counts TOKENS FOUND rather than "
      + "orphans found. Measured at 31 when written. Each `git grep` scrubs `GIT_*` through "
      + "`sandboxGitEnv()`: a leaked GIT_DIR would search another repository and vouch for this one's "
      + "prose from it. The grep's own exit 1 (no match) is the FINDING here, not an error, and is "
      + "caught and read as such.",
  },
  "packages/lab/src/packaging/local-import-closure.test.ts": {
    guard: "files.length > 500",
    note: "guarded -- it sweeps `git ls-files` for any tracked file whose local imports the stripper makes "
      + "invisible, and a clean result is the EXPECTED answer there, so 'nothing blinded' and 'the walk "
      + "read no files' are otherwise the same observation. The floor is a file count, not a finding "
      + "count. Its `ls-files` scrubs `GIT_*` through `sandboxGitEnv()` for the same reason: a leaked "
      + "GIT_DIR would sweep another repository and assert clean about it.",
  },
  "packages/lab/src/packaging/changed-files-renames.test.ts": {
    guard: "scanned >= 100",
    note: "guarded -- its two git spawns are a sandbox repository it BUILDS (a two-commit tree with one "
      + "`git mv`), so those populations are non-empty by construction and asserted member by member. The "
      + "population that could be vacuous is the SOURCE walk for bare `git diff --name-only` sites, and "
      + "the floor counts files read rather than sites found: a clean list is the expected answer there, "
      + "so 'nothing unexplained' and 'the walk opened no files' are otherwise the same observation.",
  },
  "packages/lab/src/packaging/declared-walk-scope.test.ts": {
    guard: null,
    note: "NOT a discovery test (#929). It spawns git to prove that `walk-scope.mjs` records each argv form "
      + "(`ls-files` by pathspec, `grep` after `--`, `log` as the whole repository), and it asserts over "
      + "what the observer RECORDED, never over git's output -- so there is no population to be vacuous "
      + "about. Its own discovery walk, the always-run guards, is floored by `declarers.length > 0`.",
  },
  "packages/lab/src/packaging/rescue-hunk.test.ts": {
    guard: null,
    note: "NOT a discovery test — it drives `git merge-file` and `git show` on ONE named pair of refs "
      + "(#705's fixture), so there is no population to be vacuous about. Its end-to-end case skips "
      + "honestly when either ref is absent rather than passing having examined nothing, which is the "
      + "same protection a floor gives a discovery test and the reason this needs no guard expression.",
  },
  "packages/lab/src/gates/inventory-is-control-plane-only.test.ts": {
    guard: "reaching.length > 0",
    note: "guarded — it walks `git ls-files` for readers of `inventoryWorkerUrls` outside packages/control, "
      + "and the floor asserts the reader is found SOMEWHERE. Without it a rename of that export would "
      + "make the test pass having examined nothing, which is precisely the defect it was written for: "
      + "the question 'does anything on the lab read inventory.yml?' was answered correctly about three "
      + "directories and wrongly about the repository.",
  },
  "packages/worker-fleet/src/protocol-guard.test.ts": {
    guard: "clients.length >= 2",
    note: "guarded — the two known deploy call sites (check-worker-code.mjs, deploy-worker.mjs)",
  },
  "packages/worker-fleet/src/lab-job.test.ts": {
    guard: "referenced.length >= 5",
    note: "guarded — `git grep` for job= references across the tree; comment explicitly names the vacuity risk",
  },
  "packages/lab/src/referenced-scripts.test.ts": {
    guard: "referenced.size >= 10",
    note: "guarded — TWO populations in this file (referenced scripts, tsconfig extends targets); this "
      + "is the referenced-scripts one, the stronger of the two",
  },
  "packages/lab/src/packaging/action-reference.test.ts": {
    guard: null,
    note: "RETIRED WITH ITS SUBJECT, 2026-09-11 (#954). The file is deleted: `action-reference`'s rule "
      + "runs once a night in `scripts/doc-cross-reference-report.mjs`, which reads the same module, and "
      + "the report states its own examined count -- which is the vacuity question this entry asked. Its "
      + "guard was `lines.length >= 3`, added when the ref-existence test computed `usesLines()` "
      + "independently of the sibling test that guarded it, so a sibling's failure did not stop this one "
      + "reporting a false pass on the same empty population. Kept as an entry rather than deleted, the "
      + "same as `backlog-ready.test.ts` above, so the record says RETIRED rather than quietly dropped.",
  },
  // #1144 MOVED THIS to `packages/lab/nightly/` when its per-node half became an ESLint rule. The
  // discovery walk (`git ls-files "*.test.ts"`) reaches the new path unchanged; only this KEY was a
  // path literal, so the table went stale the moment the file moved and CI failed on an ENOENT.
  //
  // WORTH KNOWING FOR THE REST OF #908: every conversion that relocates a residual breaks any
  // path-keyed classification naming it, in a file the mover has no reason to open.
  "packages/lab/nightly/bounded-window-reads.test.ts": {
    guard: "Object.keys(EXPECTED_READERS).filter((file) => !readers.includes(file))",
    note: "guarded — #634. It walks `git ls-files` for every file whose CODE reads `statusCheckRollup` "
      + "off an object and requires each read to narrow the rollup to the newest run per NAME. Vacuity "
      + "is the failure with teeth here and it ALREADY HAPPENED once inside that file: its discovery "
      + "regex carried a lookbehind that excluded the READS instead of the `--json` field list, and it "
      + "found 3 reader FILES where there were 4. Every other assertion in that file is about the "
      + "RESULT — are the sites it found classified? — and each is SATISFIED by finding fewer sites. "
      + "Only this floor asks about the SEARCH. THE FLOOR IS NOW A LIST OF NAMES, not `readers.length "
      + ">= 4` (2026-09-09): `queue-table.mjs` legitimately stopped reading the rollup when the table "
      + "moved to REST `check-runs`, and the repair a bare count offers is to write 3 — the same edit "
      + "that would paper over the predicate shrinking again. A named list makes a departure a deleted "
      + "line that must say what answers the question now, and makes a broken predicate lose every "
      + "entry at once. Strictly stronger than the cardinality it replaces: it pins WHICH.",
  },
  "packages/lab/src/packaging/guest-paths-are-measured.test.ts": {
    guard: "named.length >= 15",
    note: "guarded — the guest-checkout outage of 2026-09-08. It walks `git ls-files` for every tracked "
      + "text file naming a path under a Windows guest root and requires the directory to be the one "
      + "MEASURED on a real box. Vacuity is the failure with teeth and it has already happened five "
      + "times to this population: four sessions swept it and each found a real subset — one grepped a "
      + "Linux path, one scoped to packages/, one read JavaScript only while the facts were in YAML and "
      + "PowerShell, and one used a single-backslash pattern that cannot match a JS string literal.",
  },
  "packages/lab/src/packaging/control-plane-checkout-is-one-fact.test.ts": {
    guard: "sites.length >= 8",
    note: "guarded — the outage of 2026-09-08. It walks `git ls-files` for every site that ENTERS a "
      + "directory (a `cd` in a command string, or `systemd-run --working-directory=`) and requires each "
      + "to interpolate the one module that knows the control plane's checkout name. Vacuity is the "
      + "failure with teeth: a broken discovery reports every site classified by examining none, and the "
      + "floor has already earned its keep once — an unanchored flag pattern dropped `/root` as though "
      + "it were cmd.exe's `/d`, silently shrinking the population from 8 to 7, and nothing but the "
      + "floor could have noticed because less checking produces no error.",
  },
  "packages/lab/src/packaging/fleet-key-name-is-one-fact.test.ts": {
    guard: "all.length >= 8",
    note: "guarded — #515. It walks `git ls-files` for every site naming an SSH private key and asserts "
      + "they all name the one `group_vars/a11y_workers.yml` decides, so a rename sweep cannot split "
      + "them again. Vacuity is the failure with teeth here for the usual reason: a broken discovery "
      + "reports every site consistent by examining none, and the rename it exists to catch is exactly "
      + "the change that would look like a clean sweep.",
  },
  "packages/lab/src/packaging/git-spawn-classification.test.ts": {
    guard: "spawningGit.length >= 18",
    note: "guarded — this file's own discovery, over a different population (files spawning git at all, "
      + "not specifically ref-enumerating ones)",
  },
  "packages/lab/src/gates/verdict-adoption.test.ts": {
    guard: "gates.length >= 10",
    note: "guarded — the discovered gate-script population, walked via `git ls-files packages/lab/scripts`",
  },
  "packages/judge/src/criteria-counts-are-not-spelled-out.test.ts": {
    guard: "files.length >= 40",
    note: "FIXED this unit — `git ls-files` output for packages/judge/src + packages/evidence/src had no "
      + "floor at all; an empty result reported zero offenders having examined nothing",
  },
  "packages/judge/src/rule-oracles.test.ts": {
    guard: "callers.length >= 8",
    note: "guarded — `git grep -l ruleFindings` across packages",
  },
  "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts": {
    guard: "files.length >= MIN_TRACKED_MARKDOWN_FILES",
    note: "guarded — `git ls-files '*.md'` for the repo-wide leak sweep, floored at 50 tracked files",
  },
  "packages/lab/src/packaging/criterion-list-duplication.test.ts": {
    guard: "candidates(read, sourceFiles()).length >= 3",
    note: "guarded — #120's census of files holding a criterion list beside the canonical one, walked "
      + "via `git ls-files packages`. The floor is the three known members (the canonical source, one "
      + "justified subset, and the tracked stale copy in #136); fewer means the detection patterns have "
      + "stopped matching real files rather than the duplication being fixed. Its three positive "
      + "controls drive the detector against sources built in the test, so the shape is pinned even if "
      + "the repository population were to empty entirely.",
  },
  "packages/worker-fleet/src/entry-points.test.ts": {
    guard: "declared.length >= 85",
    note: "guarded — #211's FORM population, walked via `git ls-files`: every tracked source declaring "
      + "`import.meta.url ===`. Floored at 85 against 93 today, and deliberately a DIFFERENT population "
      + "from the same file's `entryPoints()` discovery, which enumerates invocation sources and is "
      + "inherently incomplete. Two populations in one file answering two questions: whether a guard has "
      + "the right FORM (the file declares itself, complete) and whether a file NEEDS one (the sources, "
      + "not complete). This entry covers the first; the second has no floor because there is no honest "
      + "number to floor it at.",
  },
  "packages/lab/src/packaging/tracked-source-leak-guard.test.ts": {
    guard: "files.length >= MIN_TRACKED_SOURCE_FILES",
    note: "guarded — `git ls-files '*.mjs' '*.ts' '*.py' '*.ps1' '*.sh' '*.yml'` for #83's source-comment "
      + "leak sweep (the sibling `tracked-prose-leak-guard.test.ts` above was scoped to `.md` only), "
      + "floored at 500 tracked files",
  },
  "packages/lab/src/packaging/history-secret-scan.test.ts": {
    guard: null,
    note: "NOT A POPULATION -- the one matching call (`git show HEAD:inventory.yml`) reads a SINGLE, "
      + "named file's content at a known commit, deterministically; there is no listing whose result "
      + "could silently be empty. It exists to prove the fixture's own premise (the disposable repo's "
      + "current tree does not carry the address the earlier commit does), not to enumerate anything -- "
      + "if the file or commit did not exist, `execFileSync` would throw rather than return an empty, "
      + "silently-accepted result.",
  },
  "packages/lab/src/packaging/generated-paths.test.ts": {
    guard: "tracked.size > 200",
    note: "guarded — #459's `git ls-files` walk (every tracked path, checked against the generated-file "
      + "population for offenders). Floored independently of the generated-file floor a few lines above "
      + "it: `git ls-files` returning empty would make every generated path read as untracked and the "
      + "offenders list trivially empty, which is this exact vacuity shape pointed at the OTHER "
      + "population this file enumerates. Live-mutation-checked rather than only floor-guarded: `git add "
      + "-f docs/coverage.md` on a real checkout made this test fail, naming the file; restoring made it "
      + "pass again -- the evidence a guard here actually bites, not merely that it could not read as "
      + "empty.",
  },
  "packages/lab/src/packaging/npm-cli-windows-spawn.test.ts": {
    guard: "touchingNpmCli.length >= 20",
    note: "guarded — #492's `git ls-files '*.ts' '*.mjs'` walk for every file mentioning npx/npm as a call "
      + "argument, floored at 20 against the known census of ~26 (23 real spawns plus 3 files carrying "
      + "documented data-not-a-spawn exemptions)",
  },
  "packages/lab/src/packaging/merge-guard-checks-rule.test.ts": {
    guard: "files.length > 200",
    note: "#1101: joined this classification the day its sweep was written, because this file refused it "
      + "first. Its `tracked()` enumerates every `packages/*/src/**/*.test.ts` to assert that NO test file "
      + "imports another -- an emptiness assertion, so it needs exactly what this table exists to require: "
      + "the quoted floor proves `ls-files` returned a population, and a separate control drives the "
      + "offender predicate over a source that must produce one. The control came first and was not "
      + "enough: it proved the PREDICATE could match while nothing proved the LIST was non-empty.",
  },
  "packages/lab/src/packaging/checkout-dash-safety.test.ts": {
    guard: "files.length > 100",
    note: "#637: joined this classification the same way `git-spawn-classification.test.ts` and every "
      + "other sibling did -- its own `tracked()` calls a DIFFERENT population (destructive `git checkout "
      + "--` sites, not ref/branch/tag/log/diff), so it is guarded, not exempt: the quoted floor is that "
      + "file's own vacuity guard, now downstream of `walkTree` rather than a literal spawn (#795).",
  },
  "packages/lab/src/packaging/tree-wide-guard-walk.test.ts": {
    guard: "found.length > 20",
    note: "#795: the ONE real, literal `execFileSync(\"git\", [\"ls-files\"...])` call left in the tree-wide "
      + "guard population, deliberately -- it independently re-derives what `walkTree` should have returned, "
      + "so it must spawn git itself rather than call `walkTree` (which would make the cross-check "
      + "meaningless, comparing the helper against itself). Guarded on its own vacuity floor.",
  },
};

/**
 * #795: MOST OF THIS FILE'S OWN CLASSIFIED POPULATION MOVED BEHIND `walkTree` (`scripts/tree-wide-
 * guard.mjs`), and dropped out of `discoverGitPopulationTests()` as a direct consequence -- not because
 * the discovery pattern broke, but because the population it was built to find (a file's OWN literal
 * `execFileSync("git", ["ls-files"...])`) genuinely shrank when 17 guards stopped writing that call
 * themselves. Each one's vacuity floor is still real and still tested (`inventory-is-control-plane-
 * only.test.ts`'s `reaching.length > 0` and its siblings did not move or weaken) -- it now runs one call
 * deeper, inside the shared helper, rather than inline in the guard's own source.
 *
 * THIS FILE'S OWN LITERAL-SUBCOMMAND DESIGN (see the header's "DELIBERATELY NOT BROADENED") means it
 * cannot see through that indirection without inventing the second checking strategy the header already
 * argues against -- so their CLASSIFICATION entries stay, as a historical record, the same way `backlog-
 * ready.test.ts`'s entry above records a guard "RETIRED WITH ITS SUBJECT rather than quietly dropped."
 * `git-spawn-classification.test.ts`'s own broader, wrapper-tolerant walk is what still finds `walkTree`'s
 * own real spawn inside `tree-wide-guard.mjs` and requires IT to import and call a canonical scrubbing
 * helper -- which it does. The census here dropped from 19 (2026-09-09, pre-#795) to 6 (measured directly
 * against the tree the same day, post-#795); the floor below was lowered to match, with slack for genuine
 * future drops rather than a number that will need touching again for the next one.
 */

test("MUTATION: without the SELF exclusion, this file would discover itself", () => {
  // This file's own `tracked()` calls `execFileSync("git", ["ls-files", ...])`, which matches
  // SPAWNS_GIT_POPULATION -- so once committed, the unfiltered walk finds itself. Proven directly against
  // this file's own source, not asserted from memory.
  assert.ok(SPAWNS_GIT_POPULATION.test(stripComments(read(SELF))),
    "this file's own source must still match its own discovery pattern, or the SELF exclusion guards nothing");
  assert.ok(!discoverGitPopulationTests().includes(SELF),
    "the SELF exclusion must keep this file out of its own discovered population");
});

test("the discovery finds a non-trivial population -- vacuity guard for the walk itself", () => {
  const files = tracked();
  assert.ok(files.length > 200, `only found ${files.length} tracked .test.ts files -- the ls-files scan is broken`);
  const discovered = discoverGitPopulationTests();
  // The known census DROPPED, correctly, from 19 to 6 on 2026-09-09 (#795): 17 guards moved their own
  // population-enumerating `git ls-files` call behind the shared `walkTree` helper, so they stopped
  // matching this file's deliberately literal, unwrapped `execFileSync("git", [...` pattern -- see the
  // header note above CLASSIFICATION. That is the population genuinely shrinking for a real, verified
  // reason, not this discovery breaking -- the floor is set with slack below 6 rather than pinned to it,
  // so the NEXT genuine drop does not require touching this number again, and the test below is what
  // catches a real member arriving unclassified.
  assert.ok(discovered.length >= 4,
    `only found ${discovered.length} git-population test(s), fewer than the post-#795 census of 6 -- the `
    + "discovery pattern is probably broken, not the population shrinking further");
});

test("every discovered git-population test is classified, and its guard still exists", () => {
  const discovered = discoverGitPopulationTests();
  const unclassified = discovered.filter((f) => !(f in CLASSIFICATION));
  assert.deepEqual(unclassified, [],
    `these tests spawn git to enumerate a population and are classified nowhere -- prove the population `
    + `non-empty before asserting over it, then add an entry to CLASSIFICATION here (never assume a guard `
    + `merely because a sibling test has one):\n${unclassified.map((f) => `  ${f}`).join("\n")}`);

  const missingGuard: string[] = [];
  for (const [file, { guard }] of Object.entries(CLASSIFICATION)) {
    if (guard === null) continue;
    if (!stripComments(read(file)).includes(guard)) missingGuard.push(`${file}: "${guard}"`);
  }
  assert.deepEqual(undeclaredRetirements(CLASSIFICATION), [],
    `these classifications name a file that no longer exists and do not say so -- an entry whose file is `
    + `gone is either a RETIREMENT with its reason, or debris that will sit here for ever looking like `
    + `one:\n${undeclaredRetirements(CLASSIFICATION).map((m) => `  ${m}`).join("\n")}`);
  assert.deepEqual(missingGuard, [],
    `these classifications name a guard expression that no longer appears in the file -- the guard was `
    + `removed, renamed, or the classification is stale:\n${missingGuard.map((m) => `  ${m}`).join("\n")}`);
});

/**
 * #1180: AN ENTRY WHOSE FILE IS GONE IS A RETIREMENT OR IT IS DEBRIS, and only one of those says so.
 *
 * `guard: null` skips the guard-string assertion above entirely, which is right — a retired entry has no
 * guard to find. **The cost is that it also skips the only thing that reads the file at all**, so an entry
 * naming a path that no longer exists sits here for ever, indistinguishable from the three that are
 * deliberate. It would hide AMONG them: a reader who spot-checks one finds a tombstone with its reason and
 * stops.
 *
 * An absent file with a NON-null guard is already caught — `read(file)` cannot find a guard in a file that
 * is not there. **The unguarded case is exactly the one the convention exists to prevent.**
 *
 * I filed #1180 claiming three entries here were stale. They are not: `backlog-ready` and
 * `claude-md-content-preservation` were retired by #907, `action-reference` by #954, each with its reason
 * written down. **A right count with a wrong label, because I read the paths and not the entries** — which
 * is the shape `docs/operational-lessons.md` records and whose remedy is to read one of the N first.
 *
 * @param classification the table, keyed by path
 * @returns `path` for each entry whose file is absent and whose note does not declare the retirement
 */
export function undeclaredRetirements(
  classification: Record<string, { guard: string | null; note: string }>,
): string[] {
  return Object.entries(classification)
    .filter(([file, { note }]) => !existsSync(join(REPO, file)) && !/RETIRED/i.test(note))
    .map(([file]) => file);
}

// --- The guard must be shown to fail, in both directions ---

test("#1180: an entry whose file is gone must DECLARE the retirement, or it is indistinguishable from debris", () => {
  // Driven on a fixture rather than on the real table, because the real one satisfies this today — the
  // convention is followed and has never been enforced. A guard whose only evidence is that the tree
  // happens to comply has not been shown to fire, which is this row's own subject one level up.
  const retired = { guard: null, note: "RETIRED WITH ITS SUBJECT by #907, and here is why" };
  const debris = { guard: null, note: "a population used only as a lookup set, so no guard is needed" };
  const gone = "packages/lab/src/packaging/this-file-does-not-exist.test.ts";
  const here = "packages/lab/src/packaging/git-population-vacuity.test.ts";

  assert.deepEqual(undeclaredRetirements({ [gone]: retired }), [],
    "a declared retirement is the convention, not a finding");
  assert.deepEqual(undeclaredRetirements({ [gone]: debris }), [gone],
    "the same shape without the word is what this exists to surface, and the PATH is named -- a count "
    + "alone sends the reader to all 34, three of which are correct");
  assert.deepEqual(undeclaredRetirements({ [here]: debris }), [],
    "a file that EXISTS needs no retirement note, or every ordinary entry becomes a finding");
});

test("#1180: the real table satisfies it, and the three retirements are the reason rather than luck", () => {
  const absent = Object.entries(CLASSIFICATION).filter(([f]) => !existsSync(join(REPO, f)));
  assert.equal(absent.length, 3,
    "three entries name a file that is gone -- #907 retired two and #954 one; if this number moves, the "
    + "table gained or lost a tombstone and the note below should say which");
  assert.deepEqual(undeclaredRetirements(CLASSIFICATION), [],
    "and all three declare it, which is what makes the assertion above a guard rather than a wish");
});

test("MUTATION: a git-population call is discovered even split across lines, comments stripped", () => {
  const fixture = "// mentions execFileSync(\"git\", [\"branch\" in a comment, not real\n"
    + 'execFileSync("git", ["branch", "-r"], opts);\n';
  assert.ok(SPAWNS_GIT_POPULATION.test(stripComments(fixture)),
    "a real call must be discovered even when a comment above it also mentions the shape");
});

test("CONTROL: a docstring MENTION alone, with no real call, is not discovered", () => {
  const fixture = '/** Do not use execFileSync("git", ["branch"...) -- see the sandbox helper instead. */\n'
    + "export const x = 1;\n";
  assert.ok(!SPAWNS_GIT_POPULATION.test(stripComments(fixture)));
});

test("CONTROL: a non-population git call (status, config, rev-parse) is not discovered", () => {
  const fixture = 'execFileSync("git", ["status", "--porcelain"], opts);\n';
  assert.ok(!SPAWNS_GIT_POPULATION.test(stripComments(fixture)),
    "status/config/rev-parse are not population-enumerating commands -- they are out of this file's scope");
});

test("#633 CONTROL: `diff` is discovered -- the extension this row exists to prove, not merely declare", () => {
  const fixture = 'execFileSync("git", ["diff", "--name-only", base, head], opts);\n';
  assert.ok(SPAWNS_GIT_POPULATION.test(stripComments(fixture)),
    "a `diff` call must now be discovered -- if this regresses, the classification below stops being "
    + "checked and every file in it could silently go vacuous again");
});

// --- #633's own required mutation: restore ONE self-diff, and show it goes green over nothing ---

/**
 * #633's own instruction: "restore ONE self-diff. That test must go green over nothing — and the sweep
 * must name it." This is that reproduction, self-contained rather than depending on the real hook
 * (already fixed elsewhere) or a specific file's internals — a THROWAWAY repo where `HEAD` and a second
 * ref are made to point at the identical commit, exactly the `runAgainst(head, head)` shape
 * `pre-push-resolve-toward-main.test.ts`'s positive control used before #633.
 *
 * `sandboxGitEnv()` scrubs `GIT_*`, the identical discipline `test-support/git-sandbox.ts` documents at
 * length: `cwd` is not isolation for a spawned git process, `GIT_DIR` is.
 */
function selfDiffFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "self-diff-vacuity-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
    git("init", "--quiet");
    execFileSync("bash", ["-c", "echo real-content > file.txt"], { cwd: dir });
    git("add", "file.txt");
    git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "one real commit");
    // THE VACUITY: `second` is the SAME commit as HEAD -- no second branch, no divergence. Naming it a
    // different local variable is what made the original bug read as a real two-sided comparison; it
    // was always one ref, twice.
    const second = git("rev-parse", "HEAD").trim();
    return git("diff", "--name-only", `${second}..HEAD`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#633 MUTATION: a self-diff is empty by construction, and a naive check reads that as CLEAN having "
  + "examined zero files -- the exact shape that held a real SIGPIPE false-refusal invisible for weeks in "
  + "pre-push-resolve-toward-main.test.ts's own positive control before this row", () => {
  const changedFiles = selfDiffFixture();
  assert.equal(changedFiles, "", "a ref diffed against itself must produce an empty diff -- this is the "
    + "premise the whole defect rests on, proven directly rather than assumed");

  // THE NAIVE CHECK, reproduced rather than imported: count what changed, report "0 checked, 0 missing".
  // Built the identical way the pre-#633 resolve-toward-main block was -- and it is TRUE, which is
  // exactly the trap: a check that examined nothing and a check that examined everything and found no
  // problems produce the SAME sentence.
  const checked = changedFiles.split("\n").filter(Boolean).length;
  const missing: string[] = [];
  assert.equal(checked, 0, "the naive check's own count must read zero -- proving it examined nothing, "
    + "not merely that nothing was wrong");
  assert.equal(missing.length, 0);
  // "0 checked, 0 missing" -- passes, unconditionally, having looked at nothing. This is the sentence
  // that must never be trusted alone; a real positive control needs a SECOND fixture with a genuinely
  // non-empty population, which is what #633 fixed directly in pre-push-resolve-toward-main.test.ts and
  // what this file's own CLASSIFICATION table now requires of every file that reaches for `diff`.
});
