/**
 * #1067: A `>= N` FLOOR HOLDS "THE WALK IS NOT EMPTY". IT DOES NOT HOLD "THE COUNT IS RIGHT".
 *
 * `prune-worktrees.mjs` reported `58 worktree(s) examined` over a population of 57 — the primary was
 * counted and then skipped. It carried a floor and a test asserting the number was PRINTED, and both
 * passed. Only one mutation separates them:
 *
 *     the count disappears from the report   ->  1 red
 *     examined: entries.length + 99          ->  0 red
 *
 * `>= 4` is satisfied by 4, by 58 and by 157.
 *
 * **THE MECHANISM, worker-judge's, and it is why this is a class rather than a slip:** the floor is what
 * you write when the exact number is inconvenient to obtain, and the inconvenience is what disguises it as
 * a decision. In `fixture-absence-guard.test.ts` the same author wrote an EXACT assertion for the registry
 * and a FLOOR for the tree, eight lines apart, in the same hour — the strong claim where the population
 * was small enough to enumerate and the weak one where it was not — and did not notice choosing.
 *
 * **WHAT THIS GUARD DOES, AND WHAT IT DELIBERATELY DOES NOT.** It cannot decide which floors are wrong:
 * *a floor guarding a PRECONDITION is correct* (`try-it-runnable.test.ts`'s `everywhere.length >= 2` —
 * "this only means anything while the page states the range twice", and the assertion after it iterates
 * the real population). Telling that apart from a floor standing in for a count needs a human. So this is
 * a RATCHET: the 66 that exist are a frozen baseline, a NEW one fails, and an entry whose floor has been
 * fixed must LEAVE the baseline. The class stops growing without anyone rewriting 66 assertions.
 *
 * **SCOPE IS THE GUARD DIRECTORY**, where a floored number is most often also a figure reported to a
 * reader. Measured 2026-09-12 across the whole tree: 434 floors in 235 test files; 142 in this directory;
 * 67 of those floor a subject the same assertion also reports. Widening the scope is a later row — 434
 * entries is a baseline nobody reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCOPE = "packages/lab/src/packaging";

/**
 * A floor whose subject the same assertion also REPORTS — `assert.ok(n >= 5, `only ${n} found`)`.
 *
 * The interpolation is the signal, and it is a proxy rather than the thing: a count in a failure message
 * is usually good practice, and it is also what a number being a CLAIM looks like from outside. It errs
 * toward reporting, which is right for a ratchet — a new floor lands in the baseline with a reason, and
 * the cost of a false positive is one line.
 */
const REPORTED_FLOOR =
  /assert\.ok\(\s*([A-Za-z_$][\w$.()[\]]*(?:\.length|\.size)?)\s*>=?\s*(\d+)\s*(,[\s\S]{0,300}?)?\);/g;

/**
 * THE BASELINE: floors on a reported count that existed when this guard landed.
 *
 * Data, not verdicts. **Being here is not an endorsement** — it says "this predates the rule and nobody
 * has looked at it yet". It may SHRINK and may not GROW, and an entry that no longer matches anything
 * fails, so fixing a floor forces its removal rather than leaving a stale allowance behind.
 *
 * `fixture-absence-guard.test.ts: tree.files.length` is deliberately ABSENT: it is the worked example, and
 * it now derives the count a second way and asserts equality.
 *
 * **The two `tracker-writer-population.test.ts` entries were added by the ratchet working**, on #1053's
 * merge: the walk found them, this guard refused, and they were examined rather than waved through.
 * `examined` is a vacuity floor over 132 files and is right; `sending.length` is a floor beside an EXACT
 * equality against the registry's length, so the count that is a claim is already held and the floor is
 * the vacuity half. **Both are in the baseline anyway** — the guard cannot tell an examined floor from an
 * unexamined one, and a baseline that recorded verdicts would be a second place for the reasoning to
 * drift from the code. `> 500` against a 1,460-file tree tolerated
 * losing two thirds of it, in the guard whose whole subject is which tree is being asked.
 */
const KNOWN_REPORTED_FLOORS: readonly string[] = Object.freeze([
  "acceptance-commands.test.ts: files.length",
  // #1101, and MY OWN RATCHET CAUGHT ME — the second time this one has. The floor is on the file list the
  // no-test-file-imports sweep runs over, and it is a PRECONDITION rather than a stand-in: there is no
  // right number to assert, because the tree's test-file count changes with every row, and the question
  // the assertion answers is only "did `git ls-files` return a population at all". The sweep's real
  // verdict is an EQUALITY on the offenders (`deepEqual(offenders, [])`), with its own control driving
  // the predicate over a source that must produce one.
  // #1213, and both are PRECONDITIONS rather than stand-ins. The derivation has three places it can
  // silently find nothing -- the `git ls-files` walk, the variable binding, and the pattern extraction --
  // and an empty result at any of them leaves the real assertion green over an empty set. There is no
  // right number to assert: the population changes with every test file added, and the count is reported
  // only so a reader of the failure can see WHICH stage came back empty. The verdict this file actually
  // gives is an EQUALITY (`deepEqual(unaccounted, [])`), with its own mutation driving a planted
  // instance through the predicate.
  "prose-satisfiable-guards.test.ts: bound.length",
  "prose-satisfiable-guards.test.ts: patterns.length",
  "merge-guard-checks-rule.test.ts: files.length",
  "action-inputs.test.ts: inputs.length",
  "board-liveness.test.ts: named.length",
  "candidate-gate-examines-the-candidate.test.ts: stages.length",
  "changed-files-renames.test.ts: scanned",
  "checkout-dash-safety.test.ts: discovered.length",
  "checkout-dash-safety.test.ts: files.length",
  "ci-changed.test.ts: map.size",
  "ci-changed.test.ts: packages.length",
  "commands-documented.test.ts: scripts.length",
  "control-plane-checkout-is-one-fact.test.ts: sites.length",
  "control-plane-hygiene.test.ts: trap.checked",
  "derived-artifact-sweep.test.ts: discovered.length",
  "doc-cross-reference-report.test.ts: guards.size",
  "documented-checkout-step.test.ts: found.length",
  "exports-are-shipped.test.ts: checked",
  "exports-are-shipped.test.ts: packages.length",
  "fetch-wrapper-coverage.test.ts: files.length",
  "fetch-wrapper-coverage.test.ts: found.size",
  "fleet-key-name-is-one-fact.test.ts: all.length",
  "gates-are-proven.test.ts: proof.unproven.length",
  "generated-paths.test.ts: files.length",
  "generated-paths.test.ts: tracked.size",
  "gh-token-jobs.test.ts: parsed.length",
  "git-population-vacuity.test.ts: discovered.length",
  "git-population-vacuity.test.ts: files.length",
  "git-spawn-classification.test.ts: files.length",
  "git-spawn-classification.test.ts: spawningGit.length",
  "guest-paths-are-measured.test.ts: named.length",
  "licence-boundary.test.ts: obliged.length",
  "local-import-closure.test.ts: files.length",
  "local-import-closure.test.ts: walked",
  "merge-method-is-one-fact.test.ts: sites.length",
  "npm-cli-windows-spawn.test.ts: files.length",
  "npm-cli-windows-spawn.test.ts: touchingNpmCli.length",
  "pre-push-hook-scope.test.ts: sites.length",
  "pre-push-resolve-toward-main.test.ts: block.length",
  "project-references.test.ts: projects.size",
  "public-claim.test.ts: carrying.length",
  "public-claim.test.ts: discovered.length",
  "python-ci-requirements.test.ts: ci.size",
  "python-ci-requirements.test.ts: full.size",
  "ready-label-audit.test.ts: statuses.size",
  "reconstitution-drill.test.ts: report.agents.length",
  "region-paths.test.ts: roots.length",
  "releasability.test.ts: VERDICTS.cases.length",
  "repo-identity-consolidated.test.ts: SITES.length",
  "row-claim-stale-rule.test.ts: derived.length",
  "schema-migration-citations.test.ts: SOURCE_FILES.length",
  "schema-migration-citations.test.ts: headings.length",
  "select-changed-tests.test.ts: alwaysRun.length",
  "select-changed-tests.test.ts: every.length",
  "select-changed-tests.test.ts: files.length",
  "spawned-paths.test.ts: files.length",
  "tracker-writer-population.test.ts: examined",
  "tracker-writer-population.test.ts: sending.length",
  "trainer-callers.test.ts: invocations.length",
  "tree-wide-guard-walk.test.ts: found.length",
  "tree-wide-guards.test.ts: files.length",
  "trunk-revert-guard.test.ts: spawns.length",
  "user-facing-docs-file-facts.test.ts: names.length",
  "workflow-commands.test.ts: seen.length",
  "workflow-path-coverage.test.ts: sourceDirectories().length",
  "workflow-path-coverage.test.ts: workflowFiles().length",
  "workspace-prepack-not-prepare.test.ts: found.length",
  "wrong-population-row.test.ts: instanceRows().length",
]);

/**
 * Every reported-count floor in a set of files, as `<file>: <subject>`.
 *
 * The file list and the reader are injectable so the PREDICATE can be driven over a synthetic directory
 * where the right answer is known. Over the real tree it returns the baseline, and **a predicate that
 * matched nothing would return the baseline too** if the baseline were empty — the synthetic case is the
 * only one that can tell "it found nothing" from "there is nothing".
 */
/**
 * What the last walk actually read. Recorded BY the walk rather than recomputed beside it: a second
 * `git ls-files` compared against the first is a check whose input contains its own claim, which is the
 * defect this file exists to find and the one I wrote here first.
 */
let walkedFiles: string[] = [];

function discoverReportedFloors(
  deps: { files?: string[]; read?: (f: string) => string; strip?: string } = {},
): string[] {
  const files = deps.files ?? execFileSync("git", ["ls-files", SCOPE],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() })
    .split("\n").filter((f) => f.endsWith(".test.ts"));
  const read = deps.read ?? ((f: string) => readFileSync(resolve(REPO, f), "utf8"));
  const strip = deps.strip ?? `${SCOPE}/`;
  walkedFiles = files;
  const found = new Set<string>();
  for (const file of files) {
    const text = read(file);
    for (const hit of text.matchAll(REPORTED_FLOOR)) {
      const [, subject, , message = ""] = hit;
      const root = subject.split(".")[0];
      if (!message.includes(`\${${subject}`) && !message.includes(`\${${root}`)) continue;
      found.add(`${file.replace(strip, "")}: ${subject}`);
    }
  }
  return [...found].sort();
}

test("#1067: no NEW floor stands in for a count it also reports", () => {
  const added = discoverReportedFloors().filter((f) => !KNOWN_REPORTED_FLOORS.includes(f));
  assert.deepEqual(added, [],
    "these assert a floor on a number the same assertion reports to a reader. A floor holds 'the walk is "
    + "not empty' and never 'the count is right' -- `>= 4` is satisfied by 4, by 58 and by 157. Either "
    + "derive the count a second way and assert EQUALITY, or add it to KNOWN_REPORTED_FLOORS in the same "
    + "commit with the reason it is a precondition rather than a stand-in");
});

test("#1067: the WALK enumerated the scope -- protection that survives an empty baseline", () => {
  // worker-judge, reviewing #1071: with an empty scope AND an empty baseline, both tests above compare two
  // empty sets and pass. **The ratchet's protection decays to zero exactly as the row succeeds** -- when
  // the last floor is fixed and the last entry leaves, a walk that reads nothing is indistinguishable from
  // a tree with nothing to find, and the person it catches is the one doing what the row asked.
  //
  // The file count, derived independently of the walk, is non-emptiness without a floor.
  discoverReportedFloors();                       // the real walk, whose enumeration is what is under test
  const independently = execFileSync("git", ["ls-files", `${SCOPE}/*.test.ts`],
    { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() }).split("\n").filter(Boolean);
  assert.ok(independently.length > 0,
    "the scope is not empty -- this is the only claim a count can make here without becoming the floor "
    + "this row is about");
  // THE TWO CHECKS COMPOSE, and neither covers this alone: the independent listing is a different
  // PATHSPEC of the same command, so an `ls-files` defect would make both see the same wrong set -- and
  // that case is caught by the STALENESS test above instead, where all 66 baseline entries go stale at
  // once. Do not "simplify" by deleting either. (worker-judge, reviewing #1071.)
  assert.deepEqual(walkedFiles.sort(), independently.sort(),
    "the walk read exactly the files git lists -- MEMBERSHIP, not a count, and derived from a different "
    + "git invocation than the walk's own, or this is a check whose input contains its own claim");
});

test("#1067: the baseline SHRINKS and never rots -- a fixed floor must leave it", () => {
  // Without this the baseline is a permanent allowance: a floor could be fixed and its entry would sit
  // here for ever, saying a defect exists where none does, and the next reader would trust it.
  const discovered = new Set(discoverReportedFloors());
  const stale = KNOWN_REPORTED_FLOORS.filter((f) => !discovered.has(f));
  assert.ok(KNOWN_REPORTED_FLOORS.length > 0,
    "#1160: if `KNOWN_REPORTED_FLOORS` is empty this assertion passes having compared nothing -- "
    + "the control belongs on the population, not on `stale`");
  assert.deepEqual(stale, [],
    "these are in the baseline and match nothing in the tree -- either the floor was fixed (remove the "
    + "entry, in the commit that fixed it) or the test moved (update the entry)");
});

test("#1067 MUTATION TARGET: the PREDICATE finds a planted floor and ignores a bare one", () => {
  // THE RULE APPLIED TO ITSELF, AND MY FIRST ATTEMPT FAILED IT. This test was
  // `assert.equal(discovered.length, KNOWN_REPORTED_FLOORS.length)` -- and turning that into a floor was
  // **0 red**, because the two tests above already force the sets equal, so the length equality could
  // never fail independently. **A number asserted that cannot fail is the defect this row is about,
  // wearing the costume of the fix.** Deleted, and replaced with the assertion nothing else makes: that
  // the predicate distinguishes the two kinds over a directory where the answer is known.
  const files = ["plant/reported.test.ts", "plant/precondition.test.ts"];
  // THE FIXTURES ARE ASSEMBLED, and the walk itself is why: this file lives INSIDE the scope it scans, so
  // a planted floor written whole is discovered in this very source and reported as a new instance. The
  // fixture names the thing the checker greps for -- the fourth time this shape has fired tonight, and the
  // first time inside the guard that hunts it. A guard's own fixture file is the densest possible source
  // of false positives for the guard itself.
  const ok = `assert${".ok("}`;
  const sources: Record<string, string> = {
    // the shape this row is about: a floor on a number the same assertion reports
    "plant/reported.test.ts": `${ok}walked.length >= 40, \`only \${walked.length} walked\`);\n`,
    // the shape it must NOT flag: a precondition, stated in prose, iterated after
    "plant/precondition.test.ts": `${ok}everywhere.length >= 2, "only meaningful when stated twice");\n`,
  };
  const found = discoverReportedFloors({ files, read: (f) => sources[f], strip: "plant/" });
  assert.deepEqual(found, ["reported.test.ts: walked.length"],
    "the reported floor is found and the precondition is not -- a predicate that flagged both would report "
    + "all 434 in the tree and be deleted within the week, and one that flagged neither would return an "
    + "empty baseline and look clean");
});
