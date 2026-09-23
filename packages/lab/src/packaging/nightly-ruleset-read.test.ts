/**
 * #2120: THE NIGHTLY THAT MAKES `branch-protection.test.ts`'s LIVE RULESET READ ACTUALLY HAPPEN.
 *
 * Until `nightly.yml`'s `mainRulesetBinds` job existed, BOTH of that guard's live reads were opt-in,
 * nothing in `.github/`, `scripts/` or `packages/` set either flag, and the skip that makes the silence
 * green prints `NOT RUN` and PASSES. So #2022's behavioural read-back of the approving-review requirement
 * -- the one `ceo` ruled in precisely because reading it off the field proves nothing -- had never once run
 * unattended, and its silence was indistinguishable from a pass.
 *
 * THIS FILE PINS THE CALLER, NOT THE READ. The guard already supports both flags and needed no change; what
 * was missing was something that sets one. Deleting the job, dropping its `LIVE PASS` assertion, quietly
 * swapping its identity, or re-enabling console interception would each return the repo to that silence
 * while every existing test stayed green -- so each is a red test here.
 *
 * WHY THE `LIVE PASS` LITERAL IS CHECKED AGAINST THE GUARD'S OWN SOURCE (the test at the end). The step's
 * whole discriminating power is a `grep` for a line the guard PRINTS. A grep and a print in two files drift
 * silently in the one direction that matters: reword the guard's message and the grep matches nothing, so
 * the nightly fails every night -- noisy but safe -- while the reverse, loosening the grep until a skip
 * also matches it, is silent and is the defect this row exists to end. Neither can happen without this
 * assertion going red first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const NIGHTLY = ".github/workflows/nightly.yml";
/** The guard the job runs. Not reserved by this row's Region -- read here, never written. */
const GUARD = "packages/lab/src/packaging/branch-protection.test.ts";
/** The job, named so a rename is a single red assertion rather than an empty scan everywhere below. */
const JOB = "mainRulesetBinds";
/** The hourly cron the nightly jobs skip; this job skips it too, so it runs once a day, not 24 times. */
const HOURLY_CRON = "37 * * * *";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
type Job = { if?: string; steps?: Step[]; permissions?: Record<string, string> };

function nightlyJobs(): Record<string, Job> {
  return (parseYaml(readFileSync(join(REPO, NIGHTLY), "utf8")) as { jobs: Record<string, Job> }).jobs;
}

function readJob(): Job {
  const job = nightlyJobs()[JOB];
  assert.ok(job, `${NIGHTLY} has no \`${JOB}\` job -- #2120's scheduled ruleset read is gone, and with it the `
    + "only thing that ever sets `A11Y_CHECK_MAIN_RULESET` outside a hand-run command");
  return job;
}

/** The one step that runs the read: the only `run:` step naming the guard file. */
function readStep(): Step {
  const steps = (readJob().steps ?? []).filter((s) => (s.run ?? "").includes(GUARD));
  assert.equal(steps.length, 1, `expected exactly one step in \`${JOB}\` to run ${GUARD}, found ${steps.length}`);
  return steps[0] as Step;
}

/** Shell lines with blanks and `#` comments dropped -- a flag named only in a comment sets nothing. */
function codeLines(run: string): string[] {
  return run.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}

// --- ANTI-VACUITY: the scans above find something before anything is asserted about what they find ------

/** Floors, never counts (#1321's "a floor cannot hold a count"): 8 jobs and ~11 shell lines today. */
const MIN_NIGHTLY_JOBS = 7;
const MIN_STEP_SHELL_LINES = 5;

test("#2120 ANTI-VACUITY: the nightly parses, has its usual jobs, and the read step has real shell in it", () => {
  const jobs = nightlyJobs();
  // A floor, not a count: this file must not go red because someone adds a ninth nightly job.
  assert.ok(Object.keys(jobs).length >= MIN_NIGHTLY_JOBS,
    `only ${Object.keys(jobs).length} job(s) in ${NIGHTLY} -- the parse is broken`);
  assert.ok(codeLines(readStep().run ?? "").length >= MIN_STEP_SHELL_LINES,
    "the read step has almost no shell in it -- the scan is broken");
});

// --- the job runs, once a day, unattended ---------------------------------------------------------------

test("#2120: the ruleset read runs on the DAILY cron, not the hourly one -- once a night, not 24 times", () => {
  // The same `if` every other nightly job carries. Stated as the behaviour rather than as string equality
  // so the assertion says what it means: this job must not fire on the hourly org-watch tick.
  assert.match(readJob().if ?? "", new RegExp(`!=\\s*'${HOURLY_CRON.replace(/\*/g, "\\*")}'`),
    `\`${JOB}\` must skip the hourly cron, or the live read runs 24 times a night`);
});

test("#2120: the step sets `A11Y_CHECK_MAIN_RULESET=1` on the command line that runs the guard", () => {
  // The flag is the whole job. Without it the guard prints `NOT RUN` and exits 0 -- the exact silence this
  // row exists to end -- so it is pinned on the same line as the runner rather than anywhere in the step.
  const runner = codeLines(readStep().run ?? "").find((line) => line.includes("rstest run"));
  assert.ok(runner, "the step runs no rstest command");
  assert.match(runner, /\bA11Y_CHECK_MAIN_RULESET=1\b/,
    "the opt-in flag must be set on the runner invocation itself; without it the guard skips and passes");
});

test("#2120: the runner disables console interception, or the `LIVE PASS` assertion can never match", () => {
  // MEASURED 2026-09-23 at `a82ddbc1c`: the same command WITHOUT this flag exits 0, reports 39/39 passed
  // and prints ZERO occurrences of `LIVE PASS` -- or of `NOT RUN` -- anywhere in its output, because rstest
  // intercepts `console.log` and its reporter drops it. A step built on that could not tell the pass from
  // the skip. Losing this flag would make the nightly fail every night rather than pass wrongly, but it
  // would fail for a reason that has nothing to do with `main`, which is its own kind of unreadable.
  const runner = codeLines(readStep().run ?? "").join(" ");
  assert.match(runner, /--disableConsoleIntercept\b/,
    "rstest swallows the guard's printed verdict without this; the grep below would then never match");
});

// --- a skip must not pass: the printed line is the observable --------------------------------------------

test("#2120: the step ASSERTS the `LIVE PASS` line was printed -- a green exit is not a pass", () => {
  // Every "could not ask" arm inside the guard logs its reason and RETURNS, so an unreadable
  // `rules/branches/main` exits 0 having established nothing. Requiring the printed line is what makes
  // that red, and it is the whole of done-when 2.
  const lines = codeLines(readStep().run ?? "");
  assert.ok(lines.some((line) => /\bgrep\b/.test(line) && line.includes("LIVE PASS")),
    "the step must grep its captured log for the guard's LIVE PASS line; exit status alone cannot tell a "
    + "pass from a skip, which is the defect this job exists to end one layer up");
  assert.ok(lines.some((line) => /\btee\b/.test(line)),
    "the runner's output must be captured to a file for that grep to read");
});

/**
 * The step's refusal arms, named so the count is a statement rather than a number: the missing secret, an
 * unreadable runner config, and a run that never printed its `LIVE PASS` line. An EXACT count, not a floor,
 * because a fourth arm added without a reason to expect it is the kind of thing to notice, and each of the
 * three is exercised end to end against the committed shell (the table in this row's PR body).
 */
const REFUSAL_ARMS = 3;

test("#2120: a failure is CANNOT_TELL and LOUD, and names where to look for which read was unavailable", () => {
  // `ceo`'s 2026-09-22 rule: a verdict that cannot read the exemption surface is CANNOT_TELL, loudly --
  // never a pass. `::error::` is what makes it loud in the Actions UI rather than one line of log.
  const run = readStep().run ?? "";
  const errors = codeLines(run).filter((line) => line.includes("::error::"));
  assert.equal(errors.length, REFUSAL_ARMS, "every refusal arm -- the missing secret, an unreadable runner config, and "
    + "the missing LIVE PASS line -- must be loud");
  for (const line of errors) {
    assert.match(line, /CANNOT_TELL/, "a refusal must say which verdict it is, not merely that something went wrong");
  }
  assert.match(run, /could not be read/,
    "the LIVE PASS refusal must tell the next reader what to look for in the log, so they need not reproduce it");
});

// --- the identity, which is the thing #2120 said to settle before building --------------------------------

test("#2120: the read is made as `A11IGN_BOT_TOKEN`, the identity that completes every merge here", () => {
  // `BINDS_ME` is identity-scoped by construction: `current_user_can_bypass` answers FOR THE ASKING
  // IDENTITY ONLY. Measured 2026-09-23 on the three most recently merged PRs (#2109, #2112, #2115),
  // `merged_by` is `DanBeckDev` on all three -- the PAT behind this secret, per `trunk.yml`'s own header --
  // while the PRs themselves are authored by `a11ign-ai-workers`.
  const step = readStep();
  assert.equal(step.env?.A11IGN_BOT_TOKEN, "${{ secrets.A11IGN_BOT_TOKEN }}",
    "the secret must arrive through an `env:` mapping, never interpolated into the shell text");
  assert.match(step.run ?? "", /GH_TOKEN="\$A11IGN_BOT_TOKEN"/, "and it must be the token `gh` actually uses");
});

/**
 * A FALLBACK, not a MENTION of one -- the split `runner-path-has-no-tsx-c8.test.ts` had to make for `c8`,
 * for the same reason and at the cost of the same wasted run. This step's own refusal message SAYS
 * "deliberately not falling back to github.token", which is real code (an `echo` argument) rather than a
 * comment, so a bare `/github\.token/` reads that sentence as the thing it forbids. The two shapes below
 * are the ones a fallback is actually made of, and neither has ever occurred in prose: the Actions token
 * can only reach a step as the `${{ github.token }}` expression, and it can only become the token `gh` uses
 * through an assignment to `GH_TOKEN`.
 */
const ACTIONS_TOKEN_EXPR = /\$\{\{\s*github\.token\s*\}\}/;
const GH_TOKEN_ASSIGNMENT = /\bGH_TOKEN=(\S+)/g;

/** Every value assigned to `GH_TOKEN` in a step's shell, comments stripped. */
function ghTokenSources(run: string): string[] {
  return codeLines(run).flatMap((line) => [...line.matchAll(GH_TOKEN_ASSIGNMENT)].map((m) => m[1] as string));
}

test("positive control: the fallback detectors catch a real one, and do not fire on a sentence about it", () => {
  // Proven on a fixture before it is trusted on the real file. The first two lines are `ready-audit`'s
  // ACTUAL fallback shape, copied from this same workflow; the third is this step's refusal message.
  const fallback = 'export GH_TOKEN="$GITHUB_TOKEN"\nGITHUB_TOKEN: ${{ github.token }}\n'
    + "echo 'not falling back to github.token, which merges nothing here'";
  assert.deepEqual(ghTokenSources(fallback), ['"$GITHUB_TOKEN"']);
  assert.match(fallback, ACTIONS_TOKEN_EXPR);
  const proseOnly = "echo 'not falling back to github.token, which merges nothing here'";
  assert.deepEqual(ghTokenSources(proseOnly), []);
  assert.doesNotMatch(proseOnly, ACTIONS_TOKEN_EXPR);
});

test("#2120: there is NO fallback to `github.token` -- a swapped subject is worse than no answer", () => {
  // THE DIFFERENCE FROM EVERY OTHER JOB IN THIS FILE, and it is deliberate. `ready-audit` falls back to
  // `GITHUB_TOKEN` with a warning because a degraded answer about the tracker is still an answer about the
  // tracker. Here a fallback would read `current_user_can_bypass` for the `github-actions` app, which
  // authors nothing and merges nothing here: a TRUE STATEMENT ABOUT THE WRONG SUBJECT, reading in the log
  // exactly like the useful one. A missing secret is CANNOT_TELL, and CANNOT_TELL fails.
  const step = readStep();
  assert.equal(step.env?.GITHUB_TOKEN, undefined, `\`${JOB}\` must not be handed a second token to fall back to`);
  assert.doesNotMatch(JSON.stringify(step.env ?? {}) + (step.run ?? ""), ACTIONS_TOKEN_EXPR,
    "no fallback: the step must refuse rather than certify the `github-actions` app's own exemption state");
  // Not "no OTHER assignment" but "every assignment", so a second one added below the first cannot hide.
  assert.deepEqual(ghTokenSources(step.run ?? ""), ['"$A11IGN_BOT_TOKEN"'],
    "every `GH_TOKEN` the step sets must come from the merging identity's secret and from nothing else");
  assert.match(step.run ?? "", /if \[ -z "\$A11IGN_BOT_TOKEN" \]/,
    "and it must check for the secret explicitly, so an absent one is a named refusal rather than a `gh` error");
});

// --- the runner's config path: read out of its owner, never spelled in a workflow -------------------------

/**
 * THE FILE THAT OWNS rstest's CONFIG PATH, and the reason the workflow asks it rather than re-typing it.
 *
 * `entry-points.test.ts` scans every workflow's text -- UNSTRIPPED, so comments count -- for a
 * whitespace-preceded `scripts/….mjs` and reads each hit as something the workflow EXECUTES, demanding an
 * entry guard on it. rstest's config module is meant to be IMPORTED, not run, so it has no such guard and
 * never should: measured on this row's own branch, `--config <that path>` turned `ts / run` red at
 * `26f4d80f8` (run 35854391590) on exactly that assertion, having been green on every other check.
 *
 * `reusable-board.yml` hit the same wall and its own comment rules on it -- "guarding it the way an entry
 * point is guarded would be the wrong fix … Keeping its path OUT of this file entirely is the real one".
 * This job needs flags that floor script refuses (`--disableConsoleIntercept`, above), so it reads the path
 * from the floor's exported `RSTEST_CONFIG` instead of going through its `--run`. Same ruling, same answer:
 * the literal appears in one file, and the two cannot drift apart.
 */
const FLOOR = "packages/guards/src/assert-glob-not-empty.mjs";
/** Exactly what `entry-points.test.ts` matches, so this cannot disagree with the guard it exists to satisfy. */
const WORKFLOW_SCRIPT_INVOCATION = /(?:^|\s)((?:packages|scripts)\/[^\s]+\.(?:mjs|ts))/g;

test("positive control: the entry-point pattern DOES fire on the spelling that turned this branch red", () => {
  // The emptiness asserted below is worth nothing unless this same regex catches the real thing. The first
  // is the exact text committed at `26f4d80f8`; the second is a comment, because the scan does not strip
  // them and a prose mention is matched on identical terms.
  const asCommitted = '          A11Y_CHECK_MAIN_RULESET=1 npx rstest run --config scripts/rstest/rstest.config.mjs \\';
  const inAComment = "  # the runner reads scripts/rstest/rstest.config.mjs, which is imported and not run";
  for (const text of [asCommitted, inAComment]) {
    assert.deepEqual([...text.matchAll(WORKFLOW_SCRIPT_INVOCATION)].map((m) => m[1]),
      ["scripts/rstest/rstest.config.mjs"], `the pattern stopped matching: ${text}`);
  }
  // THE ONE SPELLING IT DOES NOT SEE, and `reusable-build-test.yml` depends on it: the match must be
  // preceded by whitespace or line start, so a path wrapped in backticks -- how this repo writes a path in
  // prose -- is invisible to it. That is not a loophole to exploit, it is why the workflow comment above
  // names rstest's config DIRECTORY rather than trusting a punctuation mark to stay put.
  const backticked = "  # `scripts/rstest/rstest.config.mjs` turns `performance.buildCache` on only when `CI` is set";
  assert.deepEqual([...backticked.matchAll(WORKFLOW_SCRIPT_INVOCATION)].map((m) => m[1]), []);
});

test("#2120: the nightly never spells rstest's config path -- not in the step, not in a comment", () => {
  const text = readFileSync(join(REPO, NIGHTLY), "utf8");
  const invoked = [...text.matchAll(WORKFLOW_SCRIPT_INVOCATION)].map((m) => m[1]);
  // Named, not counted: the offence is this one path, and nothing else this file names is at issue.
  assert.deepEqual(invoked.filter((path) => path.endsWith("rstest.config.mjs")), [],
    `${NIGHTLY} spells rstest's config path, which \`entry-points.test.ts\` reads as an unguarded entry `
    + `point -- read it from ${FLOOR}'s RSTEST_CONFIG export instead, as the step already does`);
});

test("#2120: the step reads RSTEST_CONFIG from the floor script, which really exports it", () => {
  // THE CROSS-FILE LINK, the same shape as the LIVE PASS one below: a shell that reads a named export and
  // a module that provides it drift silently, and the direction that matters here is the quiet one --
  // rename the export and the step gets an empty string, which is why it also refuses one (above).
  const lines = codeLines(readStep().run ?? "");
  const derived = lines.find((line) => line.includes("RSTEST_CONFIG=") && line.includes(FLOOR));
  assert.ok(derived, `the step must derive the runner config from ${FLOOR}, not spell it`);
  assert.match(derived, /m\.RSTEST_CONFIG/, "and it must read that module's RSTEST_CONFIG export");
  assert.ok(readFileSync(join(REPO, FLOOR), "utf8").includes("export const RSTEST_CONFIG"),
    `${FLOOR} no longer exports RSTEST_CONFIG, so the nightly would run with an empty --config`);
  // THE EXIT CODE, NOT THE EMPTY STRING -- measured, not assumed. A renamed export makes `console.log`
  // print the four characters `undefined`, which passes `[ -z ]`; the step died on rstest's own
  // `Cannot find config file: <repo>/undefined`, red but naming neither the cause nor this job. So the
  // reader must exit non-zero on a missing export, and the assignment must convert that into the empty
  // string the refusal is written for -- without the `||` arm, `bash -e` aborts before it can print.
  assert.match(derived, /process\.exit\(1\)/,
    "the reader must exit non-zero on a missing export; `undefined` is not an empty string");
  assert.match(derived, /\|\|\s*RSTEST_CONFIG=""\s*$/,
    "and a failed read must become the empty string, or `bash -e` kills the step before the loud refusal");
  // And the runner must actually USE the variable, rather than derive it and ignore it.
  const runner = lines.find((line) => line.includes("rstest run"));
  assert.match(runner ?? "", /--config "\$RSTEST_CONFIG"/,
    "the derived path must be the one handed to rstest, quoted so a path with a space cannot split");
});

test("#2120: the job BUILDS before that read, because the module it imports resolves to `dist/`", () => {
  // The guard itself imports nothing built, so this step is easy to drop as dead weight. It is not:
  // `assert-glob-not-empty.mjs` imports `@a11ign/worker-fleet/cli-flags`, a package export resolving to
  // `dist/cli-flags.mjs`, which `npm ci --ignore-scripts` does not produce and this repo does not track.
  // Without the build the derivation fails and the nightly reports CANNOT_TELL every night -- loud and
  // honest, but about the wrong thing. Every other nightly job that runs tests builds for the same reason.
  const steps = readJob().steps ?? [];
  const build = steps.findIndex((s) => (s.run ?? "").trim() === "npm run build");
  const read = steps.findIndex((s) => (s.run ?? "").includes(GUARD));
  assert.ok(build >= 0, `\`${JOB}\` must run \`npm run build\`; without it ${FLOOR} cannot be imported`);
  assert.ok(build < read, "and it must build BEFORE the step that imports it");
});

// --- the admin-only half stays out ------------------------------------------------------------------------

test("#2120: the admin-only protection read is NOT scheduled, and the reason is recorded in the file", () => {
  // Measured 2026-09-22T23:05Z as `a11ign-ai-workers`: `branches/main/protection` 404s while
  // `branches/main.protected` reads `true`, so that 404 is FORBIDDEN, not ABSENT. Scheduling it would 404
  // every night against a branch that IS protected, and the next reader would conclude `main` is
  // unprotected. The comment is asserted, not just the absence, because an unexplained absence is exactly
  // what invites the re-addition.
  const text = readFileSync(join(REPO, NIGHTLY), "utf8");
  const setsIt = codeLines(text).filter((line) => line.includes("A11Y_CHECK_BRANCH_PROTECTION"));
  // POSITIVE CONTROL for this emptiness: the test above asserts the SAME scan finds
  // `A11Y_CHECK_MAIN_RULESET=1` on the runner line, so a `codeLines` that quietly returned nothing fails
  // there before it passes here.
  assert.deepEqual(setsIt, [], "the admin-only half must stay the hand-run read it is");
  assert.match(text, /FORBIDDEN, not ABSENT/,
    "and the 404-is-forbidden measurement must be in the file, or a later reader adds it back");
});

// --- the cross-file link the whole job hangs on ------------------------------------------------------------

test("#2120: the literal the step greps for is one the guard actually prints", () => {
  // THE ONE ASSERTION THAT SPANS BOTH FILES. A grep in a workflow and a `console.log` in a test drift
  // silently, and the direction that matters is the loosening one: a pattern broad enough to match the
  // guard's `NOT RUN` or `SKIPPED` lines would let a skip pass again. Pinning the literal against the
  // guard's own source closes both directions at once.
  const grepLine = codeLines(readStep().run ?? "").find((line) => /\bgrep\b/.test(line) && line.includes("LIVE PASS"));
  assert.ok(grepLine, "no grep for the LIVE PASS line");
  const literal = /grep\s+-q\s+'([^']+)'/.exec(grepLine)?.[1];
  assert.ok(literal, `could not read the grepped literal out of: ${grepLine}`);
  const guard = readFileSync(join(REPO, GUARD), "utf8");
  assert.ok(guard.includes(literal),
    `${NIGHTLY} greps for ${JSON.stringify(literal)}, which ${GUARD} never prints -- the nightly would fail every night`);
  // And it must be specific to the PASS. `LIVE PASS` alone appears in this repo's prose; the parenthesised
  // half is printed only on the far side of the `BINDS_ME` assertion.
  assert.ok(literal.length > "LIVE PASS".length,
    "the literal must be narrower than the bare words `LIVE PASS`, which a reworded skip message could also carry");
});
