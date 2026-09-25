/**
 * #1087: NOTHING ASSERTS THAT TEXT LEAVING `CLAUDE.md` STILL EXISTS ANYWHERE.
 *
 * #181 is what that costs: a CLAUDE.md split removed **1,337 substantive lines** that appeared neither in
 * the new CLAUDE.md nor anywhere under `docs/`. A large deletion, a green build, and a reviewer expected
 * to notice by hand. #907 deleted the previous guard (`claude-md-content-preservation.test.ts`) because it
 * compared LINE BY LINE and its own message admitted it: *"This guard cannot tell a corrected sentence
 * from a deleted one, and does not try to."*
 *
 * ## THIS MEASURES WHETHER THE TEXT SURVIVED, NEVER WHETHER THE MEANING DID
 *
 * That distinction is the whole design and it is `worker-judge`'s ruling on their own row. A reword that
 * keeps the meaning loses no text -- the fact is still on the page in different words. An instrument that
 * tried to judge MEANING would be a false-negative machine, and that is measured rather than asserted:
 * scoring a removed line against the best-matching paragraph by shared words, over the **6,818 paragraphs**
 * of CLAUDE.md plus `docs/`, gives an INVENTED sentence **0.63** against real removals' 0.71-1.00. With
 * enough paragraphs something always overlaps. So the question is textual: does a long run of these exact
 * words still appear somewhere?
 *
 * ## THE UNIT IS A RUN OF WORDS, NOT A LINE
 *
 * A line is not the unit of text -- a re-wrap moves words across boundaries without removing any, and a
 * de-numbering changes one token in the middle. Both are what a real edit looks like, and both defeated
 * the old guard (its `digitBlind` exemption blanked digits and still could not see a re-wrap).
 *
 * ## HOW THE THRESHOLD WAS SET, AND WHY IT IS CALIBRATION RATHER THAN A LAW
 *
 * Measured against #907's own diff (PR #1080, `8fa9a2ea` -> `67ad999b`), which removed 9 substantive
 * lines from CLAUDE.md. For each, the longest run of its words still present in the new CLAUDE.md plus
 * `docs/` -- and, decisively, WHAT that run was:
 *
 * ```
 * 17  "| [`docs/README.md`](docs/README.md) | the index to every guide and runbook, gro..."
 * 13  "> **THE LOCAL UTM WORKER VMs ARE DEPRECATED. Capture on the bare-metal fleet.**"
 *  9  "`-1` is retired and its number is never reused."
 *  6  "> [`-10` rejoined 2026-09-09 →](docs/operational-lessons.md#a11y-worker-10-withd..."
 * 49  "defined once in `packages/nvda-worker/src/worker-files.mjs`) and reboots each gu..."
 *  7  "A run starts what it needs and"
 *  5  "Do not go looking for"                                        <- GENERIC FILLER
 * 12  "and do not open the UTM GUI — just run the capture."
 *  6  "commit containing files nobody has touched"
 * ```
 *
 * **Eight of the nine matched distinctive text. One matched a generic English phrase.** `"Do not go
 * looking for"` appears in `docs/not-working.md` by coincidence of ordinary wording, not because that
 * line's content was preserved -- its text really was rewritten away. That is the line #1087's own row
 * accounts for when it says *"eight lines, SEVEN are false positives"*: the eighth is a true positive.
 *
 * So the floor sits at **6**, and it is derived from the row author's own 7-of-8 accounting rather than
 * fitted to a target. Four invented sentences written in this repository's vocabulary scored 3, 3, 4, 3.
 *
 * **A fifth invented sentence scored 6 and was a broken fixture, not a datum**: it contained
 * *"while every count-based check stayed green"*, which is near-verbatim CLAUDE.md. A fixture containing
 * the thing it claims is absent tests nothing, and had it been believed the floor would have moved by two.
 *
 * **THE THRESHOLD IS CALIBRATION AND THE NEXT DIFF RE-DERIVES IT RATHER THAN INHERITING IT.** A guard
 * fitted to one diff goes wrong on the next in a direction nobody predicts. That is why the failure
 * message prints the run it MATCHED rather than only the number: a reader who sees what matched can judge
 * the threshold themselves, and a reader handed `6` cannot.
 *
 * ## Two different "empty" cases, kept apart
 *
 * `git diff origin/main -- CLAUDE.md` is meaningless without a real `origin/main` (a shallow checkout has
 * no such ref). But an empty diff, once it resolves, is legitimate: `trunk-guard.yml` runs this suite
 * against main's own tip where HEAD IS `origin/main`. "The ref never resolved" and "the ref resolved and
 * there is nothing new" look identical in the diff's output and only the first is a defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { RULES_DIR, RULES_FILES } from "./rules-files.ts";
import { IMPERATIVE, pinById, readPinSubject, textForPin } from "./prefix-pins.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A "substantive" line: long enough that it could not just be a fragment or bare markup punctuation. */
const MIN_SUBSTANTIVE_LENGTH = 25;

/**
 * How many consecutive words must survive for a removed line to count as preserved. See the header for
 * the measurement: 8 of #907's 9 removals matched 6 or more distinctive words; the ninth matched 5 words
 * of generic English and its text really was gone. Invented prose in this repo's vocabulary reached 4.
 */
const MIN_SURVIVING_RUN = 6;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The contents of many blobs, in ONE `git` process -- `git cat-file --batch` takes the revisions on
 * stdin and streams each blob back, so reading N files costs one spawn rather than N.
 *
 * Reads a BUFFER, never an encoded string: the size in each header is a count of BYTES, and slicing a
 * utf8-decoded string by a byte offset silently mis-slices the first blob containing a multi-byte
 * character -- and every blob after it, since the offsets are cumulative.
 */
function blobsAt(revs: string[]): string[] {
  if (revs.length === 0) return [];
  const out = execFileSync("git", ["cat-file", "--batch"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), input: `${revs.join("\n")}\n`, maxBuffer: 1024 * 1024 * 64 });
  const texts: string[] = [];
  let at = 0;
  for (const rev of revs) {
    const nl = out.indexOf(0x0a, at);
    if (nl < 0) throw new Error(`git cat-file --batch: output ended before the header for ${rev}`);
    const header = out.toString("utf8", at, nl);
    // "<sha> <type> <size>", or "<rev> missing" -- the second is a real answer and must not read as empty.
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) throw new Error(`git cat-file --batch: ${rev} -> "${header}"`);
    texts.push(out.toString("utf8", nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;  // the blob, then the LF git writes after it
  }
  return texts;
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
 * Does `origin/main` resolve HERE? NO NETWORK, deliberately.
 *
 * This used to fall back to `git fetch --depth=50` when the ref was missing, which made a unit test a
 * network client: it can hang, it can fail behind a proxy or an offline runner, and it puts a remote in
 * the critical path of a suite whose whole subject is local text. It also self-healed the very condition
 * the tests below are written to report, so a checkout missing the ref silently became one that had it.
 *
 * The rule this file already states for missing history applies verbatim: *a guard that cannot see the
 * history must say so, not compare against what it happens to have.* Fetching is the same error one step
 * earlier -- going and getting the history rather than reporting its absence. So the callers skip, naming
 * the remedy, and CI is unaffected: the `ts` job checks out at `fetch-depth: 0`.
 */
function originMainResolves(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** One wording for the skip, so all three sites report the absence and the remedy identically. */
const NO_ORIGIN_MAIN = "origin/main does not resolve in this checkout -- run `git fetch origin main`. "
  + "Not run, and not counted as a pass.";

/** Every substantive line the diff marks as REMOVED from CLAUDE.md, whitespace-normalised. */
export function removedSubstantiveLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => norm(l.slice(1)))
    .filter((l) => l.length > MIN_SUBSTANTIVE_LENGTH);
}

/**
 * The longest run of consecutive words from `line` that still appears in `haystack`, and the run itself.
 *
 * The run is returned, not just its length, because it is the evidence: `"Do not go looking for"` and
 * `"defined once in \`packages/nvda-worker/src/worker-files.mjs\`) and reboots each guest"` are both
 * matches, and only one of them means the content survived. A number cannot say which.
 */
export function longestSurvivingRun(line: string, haystack: string): { words: number; text: string } {
  const w = line.split(" ");
  let words = 0;
  let text = "";
  for (let i = 0; i < w.length; i++) {
    // Start from one longer than the best so far: a shorter run cannot improve the answer, and a run
    // that is absent stays absent when extended, so the inner loop stops at the first miss.
    for (let len = words + 1; i + len <= w.length; len++) {
      const run = w.slice(i, i + len).join(" ");
      if (!haystack.includes(run)) break;
      words = len;
      text = run;
    }
  }
  return { words, text };
}

/**
 * #1240: NESTED `CLAUDE.md` FILES ARE DESTINATIONS, and they are NAMED rather than globbed.
 *
 * Claude Code loads a `CLAUDE.md` from the directory being worked in, so a paragraph moved from root to
 * `packages/nvda-worker/CLAUDE.md` still reaches the session that needs it — which is what makes it a
 * MOVE rather than a deletion, and what this guard has to be able to see.
 *
 * A TREE-WIDE `**\/CLAUDE.md` GLOB WOULD PASS THIS ROW AND EVERY FUTURE ONE FOR THE WRONG REASON.
 * `docs/` and these four paths are destinations somebody chose; a glob is the absence of a choice, and it
 * would silently accept text moved to a file nobody reads. Adding a fifth destination is a deliberate
 * edit here, which is the property worth keeping.
 */
const NESTED_CLAUDE_MD = [
  "packages/control/CLAUDE.md",
  "packages/nvda-worker/CLAUDE.md",
  "packages/lab/CLAUDE.md",
  ".github/CLAUDE.md",
];

/** The new CLAUDE.md, every nested `CLAUDE.md`, every rules file, and every `docs/*.md`, normalised.
 *
 *  #2092: the rules files are named in `rules-files.ts` and are destinations for the same reason the
 *  nested `CLAUDE.md` files are -- they load in every session, so text moved there is MOVED, not lost. */
export function haystack(): string {
  const claudeMd = norm(readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8"));
  const nested = [...NESTED_CLAUDE_MD, ...RULES_FILES]
    .map((rel) => join(REPO_ROOT, rel))
    .filter((abs) => existsSync(abs))
    .map((abs) => norm(readFileSync(abs, "utf8")));
  const docsFiles = allDocsMd(join(REPO_ROOT, "docs"));
  return [claudeMd, ...nested, ...docsFiles.map((f) => norm(readFileSync(f, "utf8")))].join(" ");
}

/** Removed lines whose longest surviving run falls below the floor, each with what it DID match. */
export function unpreservedLines(removed: string[], hay: string, minRun = MIN_SURVIVING_RUN):
{ line: string; matched: string; words: number }[] {
  return removed
    // #1240: A WHOLE LINE PRESENT VERBATIM IS PRESERVED, whatever its word count. The floor exists to
    // tell a surviving RUN from coincidental shared vocabulary -- and an exact match of the entire line
    // is not coincidence, it is the strongest evidence this guard can have. Without this a short line
    // that MOVED wholesale (`npm run worker:deploy -- --vm=a11y-worker-2`, five words) is reported as
    // lost, which is the false positive that would make a reader stop trusting the report.
    .filter((line) => !hay.includes(line))
    .map((line) => ({ line, ...longestSurvivingRun(line, hay) }))
    .filter((r) => r.words < minRun)
    .map((r) => ({ line: r.line, matched: r.text, words: r.words }));
}

/**
 * #651: CLAUDE.md's own map is this pattern repeated at almost every paragraph --
 * `... [Detail →](docs/some-file.md#anchor)`. The destination for a removed line is not something this
 * guard has to invent; it is sitting in the same paragraph the line was removed from, in the OLD file.
 */
export function nearestDocsLink(missingLine: string, oldClaudeMd: string): string | null {
  const paragraphs = oldClaudeMd.split(/\n\s*\n/);
  const owner = paragraphs.find((p) => norm(p).includes(missingLine));
  if (owner === undefined) return null;
  const match = /docs\/[\w./-]+\.md/.exec(owner);
  return match ? match[0] : null;
}

/**
 * The refusal. Names the `docs/` file each line belongs in, and prints what the guard DID match so the
 * threshold is auditable from the message rather than only from this file.
 *
 * **The population is stated.** `examined` is here so that zero flags cannot read the same as zero
 * examined -- a guard reporting "0 unpreserved" having looked at nothing is the vacuity this repo has
 * been bitten by, and the count is the only thing that separates the two.
 */
export function unpreservedMessage(
  missing: { line: string; matched: string; words: number }[],
  examined: number,
  oldMd: string,
): string {
  const named = missing.slice(0, 20).map(({ line, matched, words }) => {
    const target = nearestDocsLink(line, oldMd);
    const dest = target ?? "no docs/ link in this line's own paragraph -- see docs/README.md's index "
      + "and pick the sibling file for this section by hand";
    return `-> ${dest}\n   REMOVED: ${line}\n   longest surviving run: ${words} word(s) `
      + `${words === 0 ? "(nothing)" : JSON.stringify(matched)}`;
  });
  return `${missing.length} of ${examined} substantive line(s) removed from CLAUDE.md have no run of `
    + `${MIN_SURVIVING_RUN} consecutive words left anywhere in the new CLAUDE.md, a nested CLAUDE.md, or under docs/ -- this `
    + "is #181's failure mode, where 1,337 lines left the file and landed nowhere. This checks whether the "
    + "TEXT survived, not whether the meaning did: a reword keeping a long run is the same text, and a "
    + "reword keeping none is a rewrite worth a human's eye. Move each line into the docs/ file named "
    + `above it, or say on the PR why the text should not survive:\n${named.join("\n")}`
    + (missing.length > 20 ? `\n...and ${missing.length - 20} more` : "");
}

test("origin/main resolves to a real commit -- this test cannot pass having examined nothing", (t) => {
  // NOT "the diff is non-empty": trunk-guard runs this SAME suite against main's own tip, where HEAD
  // legitimately equals origin/main. The vacuity risk is `origin/main` failing to RESOLVE at all.
  if (!originMainResolves()) { t.skip(NO_ORIGIN_MAIN); return; }
  const sha = execFileSync("git", ["rev-parse", "--verify", "origin/main"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, `origin/main resolved to "${sha}", not a real commit SHA`);
});

/**
 * THE BASE IS THE MERGE-BASE, AND NEITHER OF THE TWO OBVIOUS SPELLINGS IS RIGHT.
 *
 * `git diff origin/main -- CLAUDE.md` is TWO-DOT: it compares main's tip to this working tree, so a
 * branch that is merely BEHIND main is accused of removing every line main has added since. Measured on
 * a head 741 commits back: **14 removed lines two-dot, 0 three-dot**, and 4 of them flagged -- with the
 * message telling the author to move main's own new text into `docs/`. It does not fire in PR CI, where
 * checkout takes the merge ref and HEAD already contains main; it fires LOCALLY, on any branch that has
 * not merged main, which is the ordinary state here.
 *
 * But `origin/main...HEAD` is not the fix either: three-dot compares against the COMMIT, so it silently
 * drops removals that are still only in the working tree -- exactly the edit this guard should catch
 * soonest, while the author still has the body in front of them.
 *
 * So: resolve the merge-base, then diff the WORKING TREE against it. `fetch-depth: 0` on the `ts` job is
 * what makes `merge-base` resolvable, and `ci.yml`'s `deliberateRefusals` already records that a
 * merge-base diff needs it. Found by `worker-judge` in review, driving these exports against a real
 * behind-main head rather than reasoning about the dots.
 */
test("every substantive line removed from CLAUDE.md still exists as text somewhere", (t) => {
  if (!originMainResolves()) { t.skip(NO_ORIGIN_MAIN); return; }
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  // A MERGE-BASE NEEDS HISTORY, AND NOT EVERY JOB HAS IT. `ci.yml`'s `acceptance` job runs this suite
  // as the PR's own acceptance command at the default checkout depth, where `merge-base` THROWS -- there
  // is no common ancestor in the clone. Found by CI, not by reasoning: the belief going in was that every
  // job running this suite is `fetch-depth: 0`, which is true of `ts` and false of `acceptance`.
  //
  // Skipping is the honest answer rather than deepening the clone from inside a test: the `ts` job runs
  // this same assertion with full history, so the check is not lost -- it is just not this job's to make.
  // A guard that cannot see the history must say so, not compare against what it happens to have.
  let base: string;
  try {
    base = git("merge-base", "origin/main", "HEAD").trim();
  } catch {
    t.skip("no merge-base with origin/main in this checkout -- shallow clone (the `acceptance` job). "
      + "The `ts` job runs this with fetch-depth: 0. Not run, and not counted as a pass.");
    return;
  }
  const removed = removedSubstantiveLines(git("diff", base, "--", "CLAUDE.md"));
  const missing = unpreservedLines(removed, haystack());
  assert.deepEqual(missing, [], unpreservedMessage(missing, removed.length, git("show", `${base}:CLAUDE.md`)));
});

/**
 * The positive control for the assertion above, which is an emptiness assertion and passes when the
 * population is empty. On main's own tip the diff is legitimately empty, so without this the real test
 * is green having compared nothing -- and that is the state it would sit in for most of its life.
 */
test("CONTROL: a line present nowhere IS reported, and one present verbatim is not", () => {
  const hay = norm("the fleet is defined once in inventory.yml and every box serves /health");
  const gone = "the witness harness reconciles every ledger entry against the shadow manifest nightly";
  // `words: 1` and `matched: "the"`, not zero: the haystack contains the word "the". That is the point of
  // returning the run rather than a bare length -- a match can be real and worth nothing, and the reader
  // can see which. An expectation of 0 here would have been wrong about the code, not about the rule.
  assert.deepEqual(unpreservedLines([gone], hay), [{ line: gone, matched: "the", words: 1 }],
    "a line sharing nothing substantive with the haystack must be reported, with its useless match shown");
  assert.deepEqual(unpreservedLines(["the fleet is defined once in inventory.yml"], hay), [],
    "a line present verbatim must not be reported");
});

test("a re-wrapped line is NOT reported -- a re-wrap moves words across boundaries, it removes none", () => {
  // The shape every real edit takes, and the one the old line-by-line guard could not see.
  const hay = norm("Deploy pushes every hashed file, defined once in worker-files.mjs, and reboots each guest");
  const rewrapped = "Deploy pushes every hashed file, defined once in worker-files.mjs, and";
  assert.deepEqual(unpreservedLines([rewrapped], hay), []);
});

test("a de-numbered sentence is NOT reported -- the number goes, the sentence stays", () => {
  // #907's deliverable: a number in prose must be free to change. The old guard's `digitBlind` exemption
  // existed for exactly this and still failed, because it blanked digits without addressing the unit.
  const hay = norm("the index to every guide and runbook, grouped by task, for the decision records");
  const numbered = "the index to every guide and runbook, grouped by task, for the 37 decision records";
  assert.deepEqual(unpreservedLines([numbered], hay), []);
});

test("the refusal names the docs/ file, the removed line, AND what it matched", () => {
  const oldMd = "Some paragraph about the fleet that was removed.\n[Full detail →](docs/operational-lessons.md#x)";
  const msg = unpreservedMessage(
    [{ line: "Some paragraph about the fleet that was removed.", matched: "about the fleet", words: 3 }],
    9, oldMd);
  assert.match(msg, /docs\/operational-lessons\.md/, "the remedy must name where the text belongs");
  assert.match(msg, /longest surviving run: 3 word\(s\) "about the fleet"/,
    "the run it matched is the evidence -- a reader handed only a number cannot judge the threshold");
  assert.match(msg, /1 of 9 substantive line\(s\)/,
    "the population is stated, so zero flags cannot read the same as zero examined");
});

test("MIN_SURVIVING_RUN separates #907's real removals from invented prose", () => {
  // The calibration, as a test rather than a claim in a comment. These are the measured runs from #907's
  // diff (see the header) and from four invented sentences written in this repository's vocabulary.
  const realRemovals = [17, 13, 9, 6, 49, 7, 12, 6];
  const inventedProse = [3, 3, 4, 3];
  for (const words of realRemovals) {
    assert.ok(words >= MIN_SURVIVING_RUN,
      `a real removal surviving ${words} words must not be reported at a floor of ${MIN_SURVIVING_RUN}`);
  }
  for (const words of inventedProse) {
    assert.ok(words < MIN_SURVIVING_RUN,
      `invented prose surviving ${words} words must be reported at a floor of ${MIN_SURVIVING_RUN}`);
  }
  // The ninth line of #907's nine is deliberately absent from `realRemovals`: it survived 5 words, and
  // those 5 words were "Do not go looking for" -- generic English matching `docs/not-working.md` by
  // coincidence. Its text really was rewritten away, which is the row's own "seven of eight".
  assert.equal(5 < MIN_SURVIVING_RUN, true,
    "the true positive among #907's eight flags must still be reported");
});

/**
 * #907's DIFF AS A FIXTURE, so the calibration runs in EVERY job (#2252).
 *
 * The end-to-end control below pins `8fa9a2ea` -> `67ad999b`, and `67ad999b` is PR #1080's HEAD: #1080 was
 * squashed, so that commit is reachable from no branch ref and survives on GitHub only under
 * `refs/pull/1080/head`. `actions/checkout` fetches branch refs and the ref of the pull request being built,
 * never another pull request's head, so NO `fetch-depth` reaches it -- `fetch-depth: 0` included -- and that
 * control skipped in every CI job it was ever in. It ran only on a host whose stale local branches happened
 * to hold the head. This fixture is the same measurement without the objects.
 *
 * WHAT IS IN IT, AND WHY IT GIVES THE SAME ANSWER: the 9 substantive lines #907 removed (verbatim from the
 * diff), and the 7 paragraphs of `CLAUDE.md` / `docs/` at `67ad999b` that hold each line's longest
 * surviving run. The haystack is a SUBSET of the real one that contains, for every line, the paragraph its
 * best run came from -- and a longest run over a subset that includes the argmax is the same longest run.
 * So the nine counts match the full 140-file haystack exactly, and the host cross-check below re-reads them
 * from real history wherever those commits exist, so this fixture cannot drift from what it copies.
 *
 * WHAT IT GIVES UP: it calibrates against a frozen copy, not against history. A shorter haystack cannot
 * produce a coincidence the full one would not, but it also cannot show a NEW coincidence appearing in a
 * later `docs/` -- that is what `every substantive line removed from CLAUDE.md still exists` above is for.
 */
const DIFF_907_REMOVED = [
  "| [`docs/README.md`](docs/README.md) | the index to every guide and runbook, grouped by task, with [`docs/adr/README.md`](docs/adr/README.md) for the 37 decision records |",
  "> **THE LOCAL UTM WORKER VMs ARE DEPRECATED. Capture on the bare-metal fleet.** TEN boxes",
  "> (`a11y-worker-2` … `-11`, in `inventory.yml`; `-1` is retired and its number is never reused.",
  "> [`-10` rejoined 2026-09-09 →](docs/operational-lessons.md#a11y-worker-10-withdrawn-2026-09-07-rejoined-2026-09-09)) serve",
  "A new bare-metal box needs no console visit — PXE + `autounattend.xml` plants the account and key. Deploy pushes every hashed file (27 now, defined once in `packages/nvda-worker/src/worker-files.mjs`) and reboots each guest, since `utmctl exec` cannot be trusted to restart the worker. Roll back by checking out the ref and redeploying — git is the source of truth. `worker:deploy` refuses a `CAPTURE_PROTOCOL_VERSION` change without `--allow-protocol-change` (it invalidates the whole cache). [Full detail →](docs/operational-lessons.md#a-new-box-needs-no-console-visit-and-the-protocol-version-trap)",
  "> **Stopped worker VMs are the correct resting state.** A run starts what it needs and releases",
  "> it afterwards. `all stopped` is a READY state, not a fault. Do not go looking for another",
  "> worker, and do not open the UTM GUI — just run the capture.",
  "commit containing files nobody has touched in 30 minutes, or more than 12 files at once, and",
];

const DIFF_907_SURVIVORS = [
  // CLAUDE.md
  "| | | |---|---| | [`CONTRIBUTING.md`](CONTRIBUTING.md) | the 60-second orientation, and the question that decides everything: **does your change need a Windows worker?** Most of the repo does not. | | [`SECURITY.md`](SECURITY.md) | what this tool does that somebody must know before running it — `probeForms` presses buttons, the worker has no authentication, `A11Y_PYTHON` is executable | | [`docs/README.md`](docs/README.md) | the index to every guide and runbook, grouped by task, with [`docs/adr/README.md`](docs/adr/README.md) for the decision records | | [`docs/backlog.md`](docs/backlog.md) | **The RECORD of what was found and what it cost.** [GitHub Issues](https://github.com/DanBeckDev/a11y-witness/issues) answers \"what is open\" — `ready` is pickable, `in-progress` plus a `session:` label is claimed. This file, `known-gaps.md` and `not-working.md` hold the measurement, the wrong turn and the command that settles it: the half an issue is bad at | | [`docs/known-gaps.md`](docs/known-gaps.md) | **what this project does NOT do, or does not yet know** — each with what it would cost and what would tell you it is fixed. Read it before claiming a thing is finished; \"all gates pass\" and \"everything is validated\" are different claims |",
  // CLAUDE.md
  "> **THE LOCAL UTM WORKER VMs ARE DEPRECATED. Capture on the bare-metal fleet.** Every box > `inventory.yml` lists (`a11y-worker-2` upward; `-1` is retired and its number is never reused. > [`-10` rejoined 2026-09-09 →](docs/operational-lessons.md#a11y-worker-10-withdrawn-2026-09-07-rejoined-2026-09-09)) serves > `/health` without a laptop in the path, and `npm run fleet:status` is the one command that says > so. Deploy with **`npm run fleet:deploy`**, never `worker:deploy` — that one is `utmctl file push` to a > VM UUID and cannot reach a physical box. > > [Why this note exists, and what \"kept\" means below →](docs/operational-lessons.md#why-the-deprecation-note-exists-and-what-kept-means)",
  // docs/operational-lessons.md
  "> **THE LOCAL UTM WORKER VMs ARE DEPRECATED. Capture on the bare-metal fleet.** NINE boxes",
  // CLAUDE.md
  "A new bare-metal box needs no console visit — PXE + `autounattend.xml` plants the account and key. Deploy pushes every hashed file (defined once in `packages/nvda-worker/src/worker-files.mjs`) and reboots each guest, since `utmctl exec` cannot be trusted to restart the worker. Roll back by checking out the ref and redeploying — git is the source of truth. `worker:deploy` refuses a `CAPTURE_PROTOCOL_VERSION` change without `--allow-protocol-change` (it invalidates the whole cache). [Full detail →](docs/operational-lessons.md#a-new-box-needs-no-console-visit-and-the-protocol-version-trap)",
  // CLAUDE.md
  "> **A stopped worker VM is the correct resting state, not a fault.** A run starts what it needs and > releases it when it is done, so `all stopped` means ready rather than broken. Do not hunt for > another worker and do not open the UTM GUI — just run the capture.",
  // docs/not-working.md
  "- **`landmark` is the outlier at 15.2%**, and that is the independent confirmation of why `landmark_present` was deleted — measured on 6,467 captures rather than on the 16 that prompted it. Every other sweep is under 2%. **Do not go looking for a general sweep defect; there is not one.** - **`tableCells` is never observable when empty** — 6,094 of 6,095, because `probeTables` is opt-in. The four `table_*` features survive this only because each falls back to the transcript (`table_evidence`, `screenreader_features.py:691`). The channel is unusable; the features are not.",
  // CLAUDE.md
  "- **Commit explicit paths.** `git add -A` cannot tell your edits from someone else's. - A **pre-commit hook** (`scripts/git-hooks/pre-commit`, wired via `core.hooksPath`) refuses a commit containing files nobody has touched recently, or too many at once, and names the offenders with their ages. In a shared tree, an 8-hour-old staged file is someone else's work. - If the block is a false positive — long debugging session, files genuinely yours — check `git diff --cached` first, then `A11Y_COMMIT_ALL=1 git commit ...`. - To commit **part** of a file another agent is also editing, stage just your hunk: `git apply --cached your.patch`, then `git commit` with **no path arguments** (a path argument makes git commit the working tree, not your staged hunk). - `git status` before you start. Files already modified are not yours to commit.",
];

/** The longest surviving run of each removed line, in the order of `DIFF_907_REMOVED`. */
const DIFF_907_RUNS = [17, 13, 9, 6, 49, 7, 5, 12, 6];

const diff907 = () => removedSubstantiveLines(DIFF_907_REMOVED.map((l) => `-${l}`).join("\n"));

test("#907's diff, as a fixture: the old guard flagged 8 of 9, this flags the 1 whose text really went", () => {
  const removed = diff907();
  assert.equal(removed.length, 9, "the population is pinned: #907 removed 9 substantive lines");
  const hay = DIFF_907_SURVIVORS.map(norm).join(" ");
  assert.deepEqual(removed.map((l) => longestSurvivingRun(l, hay).words), DIFF_907_RUNS,
    "every line's longest surviving run is the one measured at 67ad999b");
  const missing = unpreservedLines(removed, hay);
  assert.equal(missing.length, 1,
    `expected exactly the one true positive; got ${missing.length}: `
    + missing.map((m) => `${m.words}w ${JSON.stringify(m.matched)}`).join(", "));
  assert.match(missing[0].line, /Do not go looking for another/);
  assert.equal(missing[0].words, 5, "and it survives 5 words -- one below the floor, which is the margin");
  assert.equal(missing[0].matched, "Do not go looking for",
    "the matched run is generic English, which is why 5 words is not preservation");
});

test("CONTROL: the #907 fixture fails when the preserved text goes, and when the lost text returns", () => {
  const removed = diff907();
  const whole = DIFF_907_SURVIVORS.map(norm);
  // Restoring the text the fixture says was lost must clear the one flag: had the fixture flagged that line
  // for any other reason, this would still report it.
  const restored = [...whole, removed[6] + " " + removed[7]].join(" ");
  assert.deepEqual(unpreservedLines(removed, restored), [],
    "the true positive's own words are back, so nothing may be reported");
  // Dropping a paragraph that carried a real removal's run must ADD a flag, so the fixture can fail in the
  // direction that matters -- a haystack that lost preserved content.
  const withoutDeploy = whole.filter((p) => !p.includes("Deploy pushes every hashed file")).join(" ");
  assert.equal(unpreservedLines(removed, withoutDeploy).length, 2,
    "the 49-word run vanishes with its paragraph, so the deploy line joins the one already flagged");
});

/**
 * #907's OWN DIFF, driven end to end against real history -- the host cross-check for the fixture above.
 *
 * The commits are pinned. `8fa9a2ea` -> `67ad999b` is PR #1080, which deleted the previous guard and
 * reworded the paragraphs it had been refusing. **The old guard flagged 8 of these 9 lines. This flags 1.**
 *
 * **THIS SKIPS IN EVERY CI JOB, AND THAT IS THE NORMAL PATH, NOT A DEFENCE.** `67ad999b` is PR #1080's head;
 * #1080 was squashed, so the commit is on no branch ref and only `refs/pull/1080/head` holds it. No
 * `fetch-depth` reaches that, so `fetch-depth: 0` skips exactly as a depth-1 checkout does (#2252). It runs
 * only where a clone happens to hold the object -- a developer host with stale local branches. What CI
 * confirms is the fixture above; this confirms that the fixture still matches history.
 *
 * SKIPS HONESTLY where the objects are absent: a test that silently passed there would report a
 * calibration it never ran. The skip names the reason.
 */
test("#907's diff, from history: the fixture's nine runs are the ones real history gives", (t) => {
  const BASE = "8fa9a2ea";
  const HEAD = "67ad999b";
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  try {
    git("cat-file", "-e", `${BASE}^{commit}`);
    git("cat-file", "-e", `${HEAD}^{commit}`);
  } catch {
    // REACHABILITY, not depth: `${HEAD}` is PR #1080's head, on no branch ref, so this branch is the one CI
    // takes in every job. `worker-judge` exercised it against a fixture repo -- `origin/main` resolving,
    // neither commit present -- and it reported `skipped 1` with the rest passing.
    t.skip(`#907's commits (${BASE}, ${HEAD}) are not in this checkout -- ${HEAD} is a squashed PR's head, `
      + "reachable from no branch ref, so CI never has it. The fixture test above is what CI runs. "
      + "Not run, and not counted as a pass.");
    return;
  }
  const removed = removedSubstantiveLines(git("diff", BASE, HEAD, "--", "CLAUDE.md"));
  assert.deepEqual(removed, diff907(), "the fixture's removed lines are the diff's, verbatim");
  const docs = git("ls-tree", "-r", "--name-only", HEAD, "docs/").split("\n").filter((f) => f.endsWith(".md"));
  // ONE git process for all 140 blobs, not one per file. This spawned `git show` once per `docs/*.md`
  // -- 139 of them at this commit -- and then threw the per-file boundaries away, because the haystack is
  // a CONCATENATION. The spawns bought nothing the join did not immediately discard.
  const hay = blobsAt([`${HEAD}:CLAUDE.md`, ...docs.map((f) => `${HEAD}:${f}`)]).map(norm).join(" ");
  assert.deepEqual(removed.map((l) => longestSurvivingRun(l, hay).words), DIFF_907_RUNS,
    "the fixture's pinned runs are what full history gives");
  assert.equal(unpreservedLines(removed, hay).length, 1, "and full history flags the same one line");
});

/**
 * THE CASE THAT DISTINGUISHES TWO-DOT FROM THREE-DOT, which the suite did not have.
 *
 * A branch LEVEL with main produces the same answer either way, so every test that exercises the happy
 * state is blind to this. The distinguishing case is a branch genuinely BEHIND main with no removals of
 * its own: two-dot accuses it of removing everything main has added since it forked, and the accusation
 * grows louder the longer the branch lives. `product-manager` named the mutation; `worker-judge` found
 * the defect by driving these exports rather than re-implementing the comparison beside them.
 *
 * Driven against real history rather than a fixture, because the bug was never in the comparison -- it
 * was in which two trees were handed to it, and a hand-made diff cannot be wrong in that way.
 */
test("a branch merely BEHIND main is accused of nothing -- the two-dot trap", (t) => {
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  if (!originMainResolves()) { t.skip(NO_ORIGIN_MAIN); return; }
  // DERIVED, not a magic depth: the parent of the last commit that touched CLAUDE.md is by construction
  // a point where main has since changed the file. My first attempt used `--skip=200` and the guard
  // below caught it -- CLAUDE.md had not moved in 200 commits, so the naive diff reported 0 and the test
  // would have passed having exercised nothing. A depth chosen by eye is a depth that goes stale.
  const lastTouch = git("log", "-n1", "--format=%H", "origin/main", "--", "CLAUDE.md").trim();
  if (lastTouch === "") {
    t.skip("no commit touching CLAUDE.md in this history -- shallow clone. Not run, and not a pass.");
    return;
  }
  // The PARENT may be outside a shallow clone even when the commit itself is in it -- which is exactly
  // how this failed in the `acceptance` job: `lastTouch` resolved and `lastTouch^` did not.
  let behind: string;
  try {
    behind = git("rev-parse", `${lastTouch}^`).trim();
  } catch {
    t.skip(`${lastTouch.slice(0, 8)} is in this clone but its parent is not -- shallow. Not run, and `
      + "not counted as a pass.");
    return;
  }
  const naive = removedSubstantiveLines(git("diff", "origin/main", behind, "--", "CLAUDE.md"));
  const base = git("merge-base", "origin/main", behind).trim();
  const correct = removedSubstantiveLines(git("diff", base, behind, "--", "CLAUDE.md"));

  // The trap must be REAL at this depth, or this test proves nothing by passing.
  assert.ok(naive.length > 0,
    "the naive two-dot diff reported no removals, so this history cannot exercise the trap -- the test "
    + "would pass for the wrong reason");
  assert.equal(base, behind,
    "a commit reachable from main IS its own merge-base with main; if this moved, the setup is wrong");
  assert.deepEqual(correct, [],
    `a branch that is only BEHIND main removed nothing, but the merge-base diff found ${correct.length} `
    + "removed line(s) -- the base is wrong");
});

/**
 * #2083: A DELIVERY CLOCK THAT OUTLIVED ITS CLOCK, IN THE FILE EVERY SESSION LOADS.
 *
 * The guards above ask whether text that LEFT an always-loaded document still exists. This asks the
 * neighbouring question about text that STAYED: `.claude/rules/agent-practices.md` deleted the standing
 * crons on 2026-09-17 ("No session holds a standing cron ... and the reversal is the point") and left a
 * routing clause, 176 lines further down, telling `product-manager` to post the org's only state reading
 * at three fixed minutes past the hour "so the tick at" four minutes later "reads it". There is no such
 * tick. A session following it literally posts to a thread nobody is scheduled to read; measured
 * 2026-09-23, one decision in that reading had waited 6h52m. Region: this file and that one.
 *
 * ## IT REFUSES A CONTRADICTION WITHIN ONE DOCUMENT, WHICH IS WHY THE ANCHOR IS ASSERTED *PER FILE*
 *
 * This is not an outside opinion about scheduling. The file itself says no session holds a standing cron,
 * so a sentence in the same file that times a session's action to a wall-clock minute contradicts it. The
 * anchor is therefore asserted separately: if that statement is ever removed, this guard stops being a
 * consistency check and must fail loudly rather than keep enforcing a rule the document no longer makes.
 *
 * **`files.some(f => f.text.includes(anchor))` DOES NOT ASSERT THAT, and the gap was a live escape
 * hatch.** `reviewer-2` mutated the first version of this guard at `dfe72936`: delete the statement from
 * `agent-practices.md`, add that same sentence to a NEW `.claude/rules/secondary-anchor.md`, and the whole
 * acceptance stays green. A set-level `some` cannot tell an anchor sitting beside the clause from one two
 * files away, so the document carrying the delivery clause had lost its own premise while the guard went
 * on enforcing it -- which is precisely the "outside opinion" the paragraph above promises to refuse.
 *
 * So the anchor is asserted of `CLAUSE_FILE` BY NAME. The filename is the anchor's home and never the
 * guarded population: the population stays the whole directory, because a second rules file loads in
 * every session exactly the same way. If `agent-practices.md` is ever split the way `CLAUDE.md` was
 * (#1240), this fails loudly and the anchor is re-pointed at whichever file the delivery clause went to.
 * **#2092 did split it, and kept the anchor and the clause in ONE file on purpose:** `Timers and state`
 * (the anchor) and `Routing` (the clause) both live in `org-routing-and-timers.md`, so the "contradicts
 * its own document" argument still holds and the anchor did not have to be copied to a second file.
 * The loud failure IS the notice; deleting the assertion instead is how a guard quietly outlives its
 * premise, which is the shape this whole file exists to refuse one directory over.
 *
 * ## THE FOUR LITERALS ARE NOT WHAT IS MATCHED, BECAUSE THE NEXT ONE WILL SPELL THEM DIFFERENTLY
 *
 * The row's own open-check was `grep -c ':09/:29/:49'`, and it said so: that goes to `0` when somebody
 * deletes the sentence and replaces it with nothing, which is worse than today. What is matched is the
 * SHAPE: a `:MM` with no hour in front of it, OR an `H:MM`/`HH:MM` that is not part of a timestamp. Both
 * are positions on a repeating clock, and in a document that has no clock left there is nothing for
 * either to be.
 *
 * **THE HOUR-PREFIXED HALF WAS MISSING AND `reviewer-2` FOUND IT AT `dfe72936`:** a mutation rewriting
 * the routing clause to `post it at 9:17` stayed green, because the first version of this shape required
 * the colon to have no digit in front of it. `9:17` is the most ordinary spelling of a daily clock, so a
 * guard whose argument is that it matches the shape rather than the four literals could not be left
 * unable to see it.
 *
 * **WHAT SEPARATES THE TWO IS THE TIMESTAMP TAIL, AND IT WAS MEASURED RATHER THAN REASONED ABOUT.** A
 * timestamp in these files ends in `Z` (`14:02Z`, `01:55Z`) or carries seconds (`19:22:54Z`), so the
 * matcher refuses a `:MM` followed by another digit, another colon, or a `Z`. Run over
 * `.claude/rules/*.md` at `ce8e5a37`: the widened shape flags **0** markers, while the same widening
 * WITHOUT the tail rule flags **12** -- every one of those twelve a measured timestamp, and not one of
 * them a clock. That is why the tail rule is there, and it is not a matter of taste.
 *
 * **What it cannot see:** a clock written in words ("post it at quarter past"). That is a real hole and
 * not a closable one -- the alternative is a rule that infers intent from prose, which this repo has
 * already ruled is worse than a habit that decays (#1157). **What it will over-see:** a timestamp spelled
 * as a bare `14:02`, with no `Z` and no seconds, reads as a clock and WILL be flagged. There are none in
 * these files today, the direction of that error is a loud red on a docs edit rather than a silent miss,
 * and the failure message says which spellings are not flagged.
 */
const ALWAYS_LOADED_RULES = RULES_DIR;

/** The general statement in that file which a delivery clock contradicts. Asserted, never assumed. */
const NO_STANDING_CRON = "No session holds a standing cron";

/** The always-loaded file carrying the delivery clause #2083 struck, and therefore the one that must
 *  state the anchor ITSELF. Named because "some file states it" is a different, weaker claim -- see the
 *  mutation in the header. This is the anchor's home, not the guarded population. */
const CLAUSE_FILE = `${ALWAYS_LOADED_RULES}/org-routing-and-timers.md`;

/**
 * Every wall-clock minute marker in `text`: a bare `:MM`, or an `H:MM`/`HH:MM`, in either case with no
 * timestamp tail after it -- no further digit, no further colon, no `Z`. The tail is what tells a
 * scheduled minute from a recorded one; the header records what each alternative was measured to catch.
 *
 * Returns the LINE as well as the marker, because the marker alone (`:45`) tells a reader nothing about
 * which sentence to fix -- the same evidence-over-number choice `longestSurvivingRun` makes above.
 */
export function wallClockMinuteMarkers(text: string): { line: number; marker: string; context: string }[] {
  const found: { line: number; marker: string; context: string }[] = [];
  text.split("\n").forEach((context, i) => {
    for (const m of context.matchAll(/(?:^|[^0-9:])((?:[0-9]{1,2})?:[0-9]{2})(?![0-9:])(?!Z)/g)) {
      found.push({ line: i + 1, marker: m[1], context: norm(context) });
    }
  });
  return found;
}

/** The always-loaded rules files that state the anchor THEMSELVES, in the order they were read.
 *
 *  Takes the files rather than reading them, so the association can be pinned against a population this
 *  test constructs -- including the one the real tree cannot have, where nothing states it at all. A
 *  `some()` over the same population answers a weaker question and was the defect at `dfe72936`. */
export function filesStatingAnchor(files: { rel: string; text: string }[]): string[] {
  return files.filter(({ text }) => text.includes(NO_STANDING_CRON)).map(({ rel }) => rel);
}

/** Every `.md` under `.claude/rules/`, read. The directory, not a literal filename: a second rules file
 *  loads in every session exactly the same way and must not be a place the clock can come back to. */
function alwaysLoadedRuleFiles(): { rel: string; text: string }[] {
  const dir = join(REPO_ROOT, ALWAYS_LOADED_RULES);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ rel: `${ALWAYS_LOADED_RULES}/${name}`, text: readFileSync(join(dir, name), "utf8") }));
}

test("CONTROL: a delivery clock spelled ANY way is flagged, and a timestamp is not", () => {
  // Deliberately NOT the four literals the row's own grep matched. If this guard were matching them, this
  // fixture would pass and the guard would be worthless against the next stale clause.
  const restated = "posted on #928 at :12/:32/:52 so the tick at :19 reads it";
  assert.deepEqual(wallClockMinuteMarkers(restated).map((m) => m.marker), [":12", ":32", ":52", ":19"],
    "a clock in a spelling this row never saw must still be flagged -- the shape is what is matched");
  // The false positives that would make a reader stop trusting the report. Every one of these is real
  // text from the file this guards, which is stuffed with measured timestamps and durations.
  const timestamps = "measured 2026-09-22T19:22:54Z, again at 08:49Z and 23:45Z, after 4m37s and 6h52m, "
    + "clearing at ~1/tick; every verdict from 14:02Z, reset 20:08:43Z, unanswered since 01:55Z; "
    + "see https://github.com/a11ign/a11ign/issues/928";
  assert.deepEqual(wallClockMinuteMarkers(timestamps), [],
    "a timestamp tail -- a `Z`, or seconds -- means it records WHEN, and schedules nothing. Every "
    + "spelling here is real text from the file this guards, which is stuffed with measured times");
  // #2107's should-fix: the first version of this shape required no digit before the colon, so the most
  // ordinary spelling of a daily clock walked straight past it. A mutation to `post it at 9:17` was green.
  const hourPrefixed = "post the reading at 9:17, and the late one at 09:45";
  assert.deepEqual(wallClockMinuteMarkers(hourPrefixed).map((m) => m.marker), ["9:17", "09:45"],
    "an hour in front of the minutes is still a clock when no timestamp tail follows it");
});

test("CONTROL: the anchor is read PER FILE, so a copy in another rules file cannot stand in for it", () => {
  // `reviewer-2`'s mutation at `dfe72936`, as a fixture rather than as an edit to the real tree: the
  // document carrying the clause keeps the clock and loses the statement, a NEW rules file gains it.
  const clause = { rel: CLAUSE_FILE, text: "posted on #928 at :05/:25/:45 so the tick at :09 reads it" };
  const elsewhere = { rel: `${ALWAYS_LOADED_RULES}/secondary-anchor.md`, text: `x ${NO_STANDING_CRON} x` };
  assert.deepEqual(filesStatingAnchor([clause, elsewhere]), [elsewhere.rel],
    "the file carrying the clause states no anchor of its own. A `some()` over this same population "
    + "reports it anchored, which is exactly the green the mutation produced");
  assert.deepEqual(filesStatingAnchor([{ ...clause, text: `${NO_STANDING_CRON}\n${clause.text}` }, elsewhere]),
    [CLAUSE_FILE, elsewhere.rel],
    "and it is not simply blind to that file: a clause file that DOES state the anchor is reported");
  // The positive control for the emptiness this guard's own rule demands: the population where the
  // statement is nowhere, which the real tree cannot supply while the guard is passing.
  assert.deepEqual(filesStatingAnchor([clause]), [],
    "nothing states the anchor here, so the assertion below must go red rather than pass having looked");
});

test("the file carrying the delivery clause states the guard's own anchor -- not merely SOME file", () => {
  const files = alwaysLoadedRuleFiles();
  assert.ok(files.length > 0, `no .md files under ${ALWAYS_LOADED_RULES}/ -- the population is empty, so `
    + "the assertion below would pass having read nothing");
  const anchored = filesStatingAnchor(files);
  assert.ok(anchored.includes(CLAUSE_FILE),
    `${CLAUSE_FILE} no longer states "${NO_STANDING_CRON}" (stated by: ${anchored.join(", ") || "no file"}).`
    + " The test below refuses a wall-clock minute in that file because it CONTRADICTS that statement, "
    + "within one document. Without the statement THERE it is an outside opinion about scheduling, and a "
    + "copy of the sentence in another rules file does not restore it -- that move is the mutation this "
    + "assertion exists to kill. If the delivery clause has moved to another always-loaded file, re-point "
    + "CLAUSE_FILE at it; if the premise is genuinely gone, the guard is re-argued rather than left "
    + "running on it.");
});

test("no rule loaded by every session times a session's action to a wall-clock minute", () => {
  const files = alwaysLoadedRuleFiles();
  // The population, in THIS test and not only in the anchor test above: `flagged` is derived from
  // `files`, so an empty `files` makes the emptiness assertion below pass having read nothing -- the
  // vacuity this whole file exists to refuse, one directory over.
  assert.ok(files.length > 0, `no .md files under ${ALWAYS_LOADED_RULES}/ -- nothing was examined`);
  // Each marker carries WHICH anchor refuses it, because the two grounds are different and a reader
  // fixing one of them needs to know which they are answering: the file's own statement, or the
  // statement in a sibling that loads in the same session.
  const anchored = new Set(filesStatingAnchor(files));
  const ground = (rel: string) => (anchored.has(rel)
    ? "contradicts this file's own statement"
    : `contradicts ${[...anchored].join(", ") || "no file"}, loaded in the same session`);
  const flagged = files.flatMap(({ rel, text }) =>
    wallClockMinuteMarkers(text).map((m) => ({ file: `${rel}:${m.line}`, why: ground(rel), ...m })));
  assert.deepEqual(flagged, [], `${flagged.length} wall-clock minute marker(s) in ${files.length} `
    + `always-loaded rule file(s). ${NO_STANDING_CRON} -- so there is no tick at a named minute for a `
    + "session to post before or wait on, and an instruction that names one sends its reader to a thread "
    + "nobody is scheduled to read (#2083: a state reading with a 6h52m-old decision in it). State the "
    + "RATE and the mechanism instead: one reading per `ceo` tick, posted on #928 as the record and "
    + "delivered with `npm run prompt:session`. A timestamp (`19:22:54Z`) is not this and is not "
    + `flagged:\n${flagged.map((f) => `-> ${f.file}  ${f.marker}  [${f.why}]\n   ${f.context}`).join("\n")}`);
});

/**
 * #2092: THE RULES FILE WAS SPLIT BY TOPIC, AND THE SPLIT IS PROVED AGAINST THE COMMIT THAT MADE IT.
 *
 * `.claude/rules/agent-practices.md` was one file and B4 admits one open pull request per file, so every
 * row amending any org practice waited on every other (#2025: refused three times in 15 hours, by three
 * pull requests about unrelated topics). It is one file per topic now, and moving text between files is
 * the operation `CLAUDE.md`'s guard above exists to make safe -- so the same standard applies: the move is
 * BYTE-IDENTICAL, and the destinations are NAMED rather than globbed.
 *
 * ## WHY THIS COMPARES TWO FIXED COMMITS AND NOT "MAIN VERSUS NOW"
 *
 * The `CLAUDE.md` guard diffs against the merge-base, so it judges every future edit. Doing that here would
 * refuse the ordinary act of striking a stale rule (#2083 deleted a delivery clock; #2025 rewrote a false
 * sentence) -- a policy change nobody ruled on, made inside a split. The question this asks is narrower
 * and has one answer forever: **did the split lose or alter a section?** Its inputs are the commit that
 * ADDED the second rules file and that commit's parent, both immutable, so a later edit to any rules file
 * cannot turn it red and cannot hide a loss the split itself made.
 *
 * ## THE UNIT IS THE SECTION, EXACTLY
 *
 * Every `## ` section of the parent's `agent-practices.md` must appear, byte for byte, in EXACTLY one
 * destination that commit created -- and no destination may carry a section the parent did not have. That
 * is three refusals with three names: DROPPED, DUPLICATED, ALTERED (which reads as one dropped and one
 * added, both printed). The title and preamble are outside the claim: they were edited on purpose in the
 * same commit, to say the file is no longer the only one.
 *
 * ## WHAT IT CANNOT SEE
 *
 * It says the sections moved intact; it does not say they moved to the RIGHT file. Which topic lives where
 * is a judgement, and the directory listing test below only says the set is the one named.
 *
 * Skips, naming the reason, where the history is absent (the `acceptance` job's clone has no parent for
 * the commit) -- the `ts` job runs it with `fetch-depth: 0`, as the guards above do.
 */
export function rulesSections(text: string): string[] {
  return text.split(/^(?=## )/m).filter((p) => p.startsWith("## ")).map((p) => p.replace(/\s+$/, ""));
}

const headingOf = (section: string) => section.split("\n")[0];

/** What the split of `agent-practices.md` produced and consumed -- read off the two commits, pinned as literals
 *  because they are immutable (and `reported-counts.test.ts` refuses a floor standing in for a count). */
const SPLIT_DESTINATIONS = 6;
const SPLIT_SECTIONS = 12;

/** What a split did to the sections of the file it split. Empty arrays are the passing answer. */
export function splitVerdict(baseText: string, destinations: { rel: string; text: string }[]) {
  const base = rulesSections(baseText);
  const held = destinations.flatMap((d) => rulesSections(d.text).map((section) => ({ rel: d.rel, section })));
  return {
    examined: base.length,
    dropped: base.filter((s) => !held.some((h) => h.section === s)).map(headingOf),
    duplicated: base.filter((s) => held.filter((h) => h.section === s).length > 1).map(headingOf),
    added: held.filter((h) => !base.includes(h.section)).map((h) => `${h.rel}: ${headingOf(h.section)}`),
  };
}

test("CONTROL: a split that drops, duplicates or rewords a section is refused, and an intact one is not", () => {
  const a = "## Alpha\n\nfirst rule\n";
  const b = "## Beta\n\n- second rule\n  wrapped\n";
  const base = `# Title\n\npreamble\n\n${a}\n${b}`;
  const clean = splitVerdict(base, [{ rel: "one.md", text: `# Title\n\nedited preamble\n\n${a}` }, { rel: "two.md", text: b }]);
  assert.deepEqual(clean, { examined: 2, dropped: [], duplicated: [], added: [] },
    "an intact split, with an EDITED preamble, must pass -- the preamble is outside the claim");
  assert.deepEqual(splitVerdict(base, [{ rel: "one.md", text: a }]).dropped, ["## Beta"], "a dropped section");
  assert.deepEqual(splitVerdict(base, [{ rel: "one.md", text: a }, { rel: "two.md", text: `${a}\n${b}` }]).duplicated,
    ["## Alpha"], "a section in two destinations");
  const reworded = splitVerdict(base, [{ rel: "one.md", text: a }, { rel: "two.md", text: b.replace("second", "2nd") }]);
  assert.deepEqual([reworded.dropped, reworded.added], [["## Beta"], ["two.md: ## Beta"]],
    "a reword is a drop AND an addition, so nothing rewritten in the move can pass as moved");
  assert.equal(splitVerdict("no sections here", []).examined, 0,
    "a base with no sections examines nothing -- the real test below asserts a positive count");
});

test("the directory holds exactly the rules files `rules-files.ts` names -- named, never globbed", () => {
  const onDisk = readdirSync(join(REPO_ROOT, RULES_DIR)).filter((n) => n.endsWith(".md")).map((n) => `${RULES_DIR}/${n}`);
  assert.ok(RULES_FILES.length > 1, "the split produced more than one file, so a list of one is a regression");
  assert.deepEqual([...onDisk].sort(), [...RULES_FILES].sort(),
    `${RULES_DIR}/ and rules-files.ts disagree. A file on disk that is not named loads in every session with `
    + "nobody having chosen it; a name with no file is a destination that was silently dropped. Adding or "
    + "removing a rules file is a deliberate edit to rules-files.ts.");
});

test("the #2092 split moved every section of agent-practices.md, byte for byte, into exactly one destination", (t) => {
  if (!originMainResolves()) { t.skip(NO_ORIGIN_MAIN); return; }
  const git = (...args: string[]) => execFileSync("git", args,
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  // The commit that ADDED the second rules file IS the split. `--reverse` so a file later deleted and
  // re-added still answers with the first.
  const splitCommit = git("log", "--diff-filter=A", "--reverse", "--format=%H", "--", RULES_FILES[1]).trim().split("\n")[0];
  if (!splitCommit) { t.skip(`no commit adding ${RULES_FILES[1]} in this history. Not run, and not a pass.`); return; }
  let parent: string;
  try {
    parent = git("rev-parse", `${splitCommit}^`).trim();
  } catch {
    t.skip(`${splitCommit.slice(0, 8)} is in this clone but its parent is not -- shallow. Not run, and not counted as a pass.`);
    return;
  }
  // The destinations are what the split commit CREATED under the rules directory -- read from that immutable
  // tree, so renaming a rules file later leaves this proof intact. Whether the CURRENT set is the named one
  // is the previous test's question.
  const created = git("ls-tree", "--name-only", splitCommit, `${RULES_DIR}/`).split("\n").filter((f) => f.endsWith(".md"));
  const texts = blobsAt([`${parent}:${RULES_DIR}/agent-practices.md`, ...created.map((f) => `${splitCommit}:${f}`)]);
  const verdict = splitVerdict(texts[0], created.map((rel, i) => ({ rel, text: texts[i + 1] })));
  // The population, asserted by EQUALITY against literals: both inputs are immutable commits, so the counts
  // cannot drift, and a floor (`> 1`) would be satisfied by a split that lost half its sections.
  assert.equal(created.length, SPLIT_DESTINATIONS, `the split commit created ${created.length} rules files`);
  assert.equal(verdict.examined, SPLIT_SECTIONS, "the parent's agent-practices.md had a different section count");
  assert.deepEqual({ dropped: verdict.dropped, duplicated: verdict.duplicated, added: verdict.added },
    { dropped: [], duplicated: [], added: [] },
    `the split at ${splitCommit.slice(0, 8)} did not move ${verdict.examined} sections intact. DROPPED = in the `
    + "parent, in no destination; DUPLICATED = in two; ADDED = in a destination and not the parent (which is also "
    + "what a reworded section looks like). The move is byte-identical or it is a different change.");
});

/**
 * #2223: THE SCRATCHPAD IS SHARED BY EVERY SESSION, AND THE TWO HABITS THAT KEEP IT FROM FILLING ARE PINNED.
 *
 * A full scratchpad does not say so: commands return EMPTY output or ENOSPC, and a 0-byte file reads as "the
 * command printed nothing". A session that has not been told will conclude a grep found no matches. The
 * habits are IMPERATIVE in `prefix-pins.mjs`'s sense -- a session acting without them takes the wrong
 * action -- so each is matched against the LOADED rules alone and the incident's copy in
 * `docs/operational-lessons.md` cannot stand in for it. The pins themselves live in that table so
 * `roles-readme.test.ts` asserts the tier for every pin at once; this file states the ones this row owns and
 * carries the positive control that a deleted sentence is noticed.
 */
const SCRATCHPAD_PIN_IDS = ["scratchpad.no-self-capture", "scratchpad.no-large-artefacts", "scratchpad.full-is-unlabelled"];

test("CONTROL: a scratchpad habit deleted from the loaded rules is noticed, even when the destination keeps it", () => {
  assert.ok(SCRATCHPAD_PIN_IDS.length > 0, "no scratchpad pins named -- the loop below would assert nothing");
  for (const id of SCRATCHPAD_PIN_IDS) {
    const pin = pinById(id);
    // The matching text is manufactured FROM the pattern's own source words, so the control cannot pass by
    // a fixture that happens to contain the real prose: the real prose is read only in the test after this.
    const present = { loaded: flattenSource(pin.pattern), destinations: "" };
    assert.match(textForPin(pin, present), pin.pattern, `${id}: the control text must match, or "fails when deleted" proves nothing`);
    assert.doesNotMatch(textForPin(pin, { ...present, loaded: "" }), pin.pattern,
      `${id}: deleting the sentence from the loaded rules must make the pin fail`);
    assert.doesNotMatch(textForPin(pin, { loaded: "", destinations: present.loaded }), pin.pattern,
      `${id}: IMPERATIVE means the destination's copy is not enough -- a moved rule is read after the command it governed`);
    assert.doesNotMatch(textForPin(pin, { loaded: "an unrelated rule about something else", destinations: "" }), pin.pattern,
      `${id}: an unrelated sentence must not satisfy it`);
  }
});

test("#2223: both scratchpad habits and how a full scratchpad shows itself stay in the loaded rules", () => {
  const subject = readPinSubject();
  for (const id of SCRATCHPAD_PIN_IDS) {
    const pin = pinById(id);
    assert.equal(pin.tier, IMPERATIVE, `${id} must be IMPERATIVE: it tells a session what NOT to do before it does it`);
    assert.match(textForPin(pin, subject), pin.pattern,
      `${id} is not in the loaded rules (${RULES_DIR}/). The rule is what stops a session filling the shared `
      + "scratchpad; its incident is in docs/operational-lessons.md under 'The scratchpad is shared', and "
      + "a copy THERE does not count -- that file is read on demand, after the command it should have stopped.");
  }
});

/** The literal words of a pattern's source, unescaped enough to be matched by it. Only for the plain-prose
 *  patterns this file uses: anything with a metacharacter other than an escaped one is refused. */
function flattenSource(pattern: RegExp): string {
  assert.doesNotMatch(pattern.source.replace(/\\./g, ""), /[[\](){}|*+?^$]/,
    "flattenSource only handles a plain-prose pattern; write the control text by hand for this one");
  return pattern.source.replace(/\\(.)/g, "$1");
}
