// no-token: gh -- nothing here calls GitHub: the workflow's shell is run under `bash -e` with `node` and `pnpm` stubbed,
// and `A11IGN_BOT_TOKEN` appears only as an obvious non-secret handed to the stub, so the acceptance job needs none.
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
 * ## ONCE PER LISTED REPOSITORY (#3123, ADR 0039 item 5)
 *
 * The step used to read one repository. It now loops over `.agent-org/project.json`'s `code` array and sets
 * `A11Y_PROTECTION_REPO` for each, and what is pinned about THAT is behaviour, not text: the step is executed
 * with two repositories and the stub records one invocation per repository; a repository whose run prints no
 * pass line, or fails, turns the step red WITHOUT stopping the others being read; and the pass line it greps
 * for names the repository, so one repository's pass cannot be counted for another's. The list itself is
 * derived from the file, and the derivation is RUN against the real `project.json` below, not scanned.
 *
 * WHY THE `LIVE PASS` LITERAL IS CHECKED AGAINST THE GUARD'S OWN SOURCE (the test at the end). The step's
 * whole discriminating power is a `grep` for a line the guard PRINTS. A grep and a print in two files drift
 * silently in the one direction that matters: reword the guard's message and the grep matches nothing, so
 * the nightly fails every night -- noisy but safe -- while the reverse, loosening the grep until a skip
 * also matches it, is silent and is the defect this row exists to end. Neither can happen without this
 * assertion going red first.
 *
 * ## WHY THE LOAD-BEARING LINES ARE EXECUTED AND NOT SCANNED (reviewer-2's blocker on #2124, 2026-09-23)
 *
 * The first version of this file read the step's shell as TEXT: it found the line mentioning `rstest run`
 * and asserted that the same line carried the flag, the config and `--disableConsoleIntercept`. Measured
 * by `reviewer-2` at `e81497e6` and reproduced here before it was fixed: replacing the runner with
 * `echo '<the same tokens>' | tee ruleset-read.log` left all 15 tests GREEN. A guard certifying a job that
 * never makes the read -- which is this row's own defect, moved one level out.
 *
 * So each load-bearing line is now pinned twice. A SHAPE assertion requires it to BE a command rather than
 * a token inside an `echo` argument, and below that the step's own `run:` text is EXECUTED under `bash -e`
 * -- the shell a `run:` block gets -- with `node` and `pnpm` stubbed, so what is asserted is "the guard was
 * invoked, with this flag, this config and this token" rather than "these words appear somewhere". The
 * `echo` mutation leaves no stub invocation to find, so it cannot pass. That is `auto-arm-sweep.test.ts`'s
 * shape (#1970) and it is here for the same reason: what is at stake is a BEHAVIOUR, so a text scan is the
 * wrong instrument for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = { if?: string; env?: Record<string, string>; steps?: Step[]; permissions?: Record<string, string> };

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

/**
 * The same lines with `\`-continuations JOINED, so a check reads the whole command it is about rather than
 * whichever physical line a token happened to land on. The runner spans three lines; its flag is on the
 * first, its `--include` on the second and its `| tee` on the third, and each of those is asserted here.
 */
function commands(run: string): string[] {
  const joined: string[] = [];
  for (const line of codeLines(run)) {
    const previous = joined.at(-1);
    if (previous !== undefined && previous.endsWith("\\")) joined[joined.length - 1] = `${previous.slice(0, -1).trim()} ${line}`;
    else joined.push(line);
  }
  return joined;
}

/**
 * THE RUNNER, AS A COMMAND RATHER THAN AS TOKENS -- reviewer-2's blocker on #2124, and the reason every
 * check below goes through this function instead of `find((line) => line.includes("rstest run"))`.
 *
 * A leading `VAR=value` prefix is allowed because that is how the opt-in flag is set; anything else in
 * front of `pnpm` -- an `echo`, a `printf`, a `:` -- means the tokens are an ARGUMENT and nothing runs.
 */
const RUNNER_INVOCATION = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*pnpm\s+exec\s+rstest\s+run\b/;

function runnerLine(): string {
  const mentions = commands(readStep().run ?? "").filter((line) => line.includes("rstest run") && line.includes(GUARD));
  assert.equal(mentions.length, 1,
    `expected exactly one command in \`${JOB}\` to run rstest on ${GUARD}, found ${mentions.length}`);
  const [runner] = mentions as [string];
  assert.match(runner, RUNNER_INVOCATION,
    "the rstest command must be EXECUTED, not quoted. MEASURED at `e81497e6`: `echo '<the same tokens>' | "
    + "tee ruleset-read.log` satisfied every token assertion in this file and made no read at all");
  return runner;
}

/**
 * An EXECUTED `grep -qF "<literal>${repo}@" <log>`, with both halves read out of it rather than assumed. The
 * literal is the part BEFORE the repository, which is what the guard's source must contain (#3123: the pass
 * line names the repository, so the grep is for THIS repository's line).
 */
const GREP_INVOCATION = /^grep\s+-qF\s+"([^"$]+)\$\{repo\}@"\s+(\S+)/;

function grepStep(): { literal: string, log: string } {
  const greps = commands(readStep().run ?? "")
    .map((line) => GREP_INVOCATION.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  assert.equal(greps.length, 1, `expected exactly one executed \`grep -qF "<literal>\${repo}@" <log>\` in \`${JOB}\`, `
    + `found ${greps.length} -- a grep named inside an \`echo\` argument asserts nothing`);
  const [[, literal, log]] = greps as [RegExpExecArray];
  return { literal: literal as string, log: log as string };
}

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  assert.match(runnerLine(), /^A11Y_CHECK_MAIN_RULESET=1\s+(?:[A-Za-z_]\w*="?\$?\w*"?\s+)*pnpm\b/,
    "the opt-in flag must be set on the runner invocation itself; without it the guard skips and passes");
  assert.match(runnerLine(), /\sA11Y_PROTECTION_REPO="\$repo"\s+pnpm\b/,
    "and the repository must be handed to the guard on that same invocation, or every iteration reads the primary");
});

test("#2120: the runner disables console interception, or the `LIVE PASS` assertion can never match", () => {
  // MEASURED 2026-09-23 at `a82ddbc1c`: the same command WITHOUT this flag exits 0, reports 39/39 passed
  // and prints ZERO occurrences of `LIVE PASS` -- or of `NOT RUN` -- anywhere in its output, because rstest
  // intercepts `console.log` and its reporter drops it. A step built on that could not tell the pass from
  // the skip. Losing this flag would make the nightly fail every night rather than pass wrongly, but it
  // would fail for a reason that has nothing to do with `main`, which is its own kind of unreadable.
  assert.match(runnerLine(), /--disableConsoleIntercept\b/,
    "rstest swallows the guard's printed verdict without this; the grep below would then never match");
});

// --- a skip must not pass: the printed line is the observable --------------------------------------------

test("#2120: the step ASSERTS the `LIVE PASS` line was printed -- a green exit is not a pass", () => {
  // Every "could not ask" arm inside the guard logs its reason and RETURNS, so an unreadable
  // `rules/branches/main` exits 0 having established nothing. Requiring the printed line is what makes
  // that red, and it is the whole of done-when 2.
  const { literal, log } = grepStep();
  assert.ok(literal.includes("LIVE PASS"),
    `the step greps for ${JSON.stringify(literal)}, not the guard's LIVE PASS line; exit status alone `
    + "cannot tell a pass from a skip, which is the defect this job exists to end one layer up");
  // The two halves are asserted AGAINST EACH OTHER rather than separately: a renamed log file would
  // otherwise leave the grep reading a file nobody writes, which is green on every scan and red every night.
  assert.match(runnerLine(), new RegExp(`\\|\\s*tee\\s+${escapeForRegExp(log)}$`),
    `the runner must pipe its output to ${log}, the file the grep above reads`);
});

/**
 * The step's refusal arms, named so the count is a statement rather than a number: the missing secret, an
 * unreadable runner config, an unreadable (or empty) repository list, a runner that FAILED for a repository,
 * a run that never printed its `LIVE PASS` line for one, the settings table failing (#3708), the settings table
 * exiting green without its output (#3708), and the closing summary naming everything that did not certify. An EXACT count, not a floor, because a seventh arm added without a reason to expect it is
 * the kind of thing to notice, and each is exercised end to end against the committed shell below.
 */
const REFUSAL_ARMS = 8;

test("#2120: a failure is CANNOT_TELL and LOUD, and names where to look for which read was unavailable", () => {
  // `ceo`'s 2026-09-22 rule: a verdict that cannot read the exemption surface is CANNOT_TELL, loudly --
  // never a pass. `::error::` is what makes it loud in the Actions UI rather than one line of log.
  const run = readStep().run ?? "";
  const errors = codeLines(run).filter((line) => line.includes("::error::"));
  assert.equal(errors.length, REFUSAL_ARMS, "every refusal arm -- the missing secret, an unreadable runner config or "
    + "repository list, a failed runner, the missing LIVE PASS line, the settings table's two and the closing summary -- must be loud");
  for (const line of errors) {
    assert.match(line, /CANNOT_TELL/, "a refusal must say which verdict it is, not merely that something went wrong");
    assert.match(line, /^echo ["']::error::/, "and it must be an executed `echo`, not a line of prose about one");
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
  assert.ok(commands(step.run ?? "").some((line) => /^export GH_TOKEN="\$A11IGN_BOT_TOKEN"$/.test(line)),
    "and it must be EXPORTED as the token `gh` actually uses, as a command rather than inside an `echo`");
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
  assert.ok(commands(step.run ?? "").some((line) => line.startsWith('if [ -z "$A11IGN_BOT_TOKEN" ]')),
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
  const derived = commands(readStep().run ?? "").find((line) => /^RSTEST_CONFIG="\$\(/.test(line));
  assert.ok(derived, `the step must ASSIGN the runner config from a command substitution reading ${FLOOR}`);
  assert.ok(derived.includes(FLOOR), `and that substitution must read ${FLOOR}, not some other file`);
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
  assert.match(runnerLine(), /--config "\$RSTEST_CONFIG"/,
    "the derived path must be the one handed to rstest, quoted so a path with a space cannot split");
});

test("#2120: the job BUILDS before that read, because the module it imports resolves to `dist/`", () => {
  // The guard itself imports nothing built, so this step is easy to drop as dead weight. It is not:
  // `assert-glob-not-empty.mjs` imports `@a11ign/screenreader-fleet/cli-flags`, a package export resolving to
  // `dist/cli-flags.mjs`, which `pnpm install --ignore-scripts` does not produce and this repo does not track.
  // Without the build the derivation fails and the nightly reports CANNOT_TELL every night -- loud and
  // honest, but about the wrong thing. Every other nightly job that runs tests builds for the same reason.
  const steps = readJob().steps ?? [];
  const build = steps.findIndex((s) => (s.run ?? "").trim() === "pnpm run build");
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
  const { literal } = grepStep();
  const guard = readFileSync(join(REPO, GUARD), "utf8");
  assert.ok(guard.includes(literal),
    `${NIGHTLY} greps for ${JSON.stringify(literal)}, which ${GUARD} never prints -- the nightly would fail every night`);
  // And it must be specific to the PASS. `LIVE PASS` alone appears in this repo's prose; the parenthesised
  // half is printed only on the far side of the `BINDS_ME` assertion.
  assert.ok(literal.length > "LIVE PASS".length,
    "the literal must be narrower than the bare words `LIVE PASS`, which a reworded skip message could also carry");
});

// --- THE STEP, EXECUTED: every check above bound to something that actually runs ---------------------------

/** The stubs are invoked as commands, so they have to be runnable. */
const STUB_MODE = 0o755;
/** Generous: the stubs return at once, and a hang here should fail rather than stall the suite. */
const STEP_TIMEOUT_MS = 20_000;
/** An obvious non-secret, so the step takes its normal branch; the value never leaves this process. */
const STUB_TOKEN = "not-a-secret-stub-token";
/**
 * DELIBERATELY NOT A PATH IN THIS REPO. What is asserted below is that rstest is handed WHAT `node`
 * PRINTED, which a hardcoded real path could not tell apart from a runner that ignores the variable.
 */
const STUB_CONFIG = "/stub/only/rstest-config-the-node-stub-printed.mjs";
/**
 * The guard's REAL output, measured 2026-10-03 by running the committed runner command as
 * `a11ign-ai-workers` (`A11Y_PROTECTION_REPO=a11ign/a11ign`) -- not a plausible-looking invention
 * (`a-number-from-the-apparatus`: a fixture that merely looks like the artefact is not evidence about the
 * artefact). `%REPO%` is the one thing the stub fills in per invocation. The skip line is the same read with
 * the flag unset, which is the state this whole job exists to make red.
 */
const LIVE_PASS_OUTPUT = "  LIVE PASS (no admin required) on %REPO%@main: a `pull_request` rule requires 1 approval(s) on "
  + '`main`, and `current_user_can_bypass` is "never" for the identity running this check -- who ELSE may '
  + "bypass is not knowable without admin";
const NOT_RUN_OUTPUT = "  NOT RUN: the live ruleset read is opt-in -- `A11Y_CHECK_MAIN_RULESET=1 npx tsx "
  + "--test packages/lab/src/packaging/branch-protection.test.ts` asks GitHub whether the ruleset's "
  + "`pull_request` rule binds THIS identity. It needs no admin.";
const TWO_REPOS = ["a11ign/first-repo", "a11ign/second-repo"];

const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

function writeStub(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, STUB_MODE);
}

type StepOutcome = { status: number | null, output: string, ranRstest: string | null, repos: string[] };
type StepOptions = {
  token?: string | null; config?: string | null; says?: string; rstestExit?: number;
  /** What the repository lister prints, or null for a lister that fails. */
  repoList?: string | null;
  /** A repository for which the stub runner prints the skip line instead of the pass line. */
  skipFor?: string; failFor?: string;
  /** What the stub runner prints for the settings table, and its exit status. Default: a green table over the listed repositories. */
  tableSays?: string; tableExit?: number;
};

/**
 * Run the step's OWN `run:` text under `bash -e` -- the shell a `run:` block gets -- with `node` and `pnpm`
 * stubbed, so this needs no secret, no network and no `dist/`, and the runner RECORDS what it was handed.
 *
 * `node` is asked two things and the stub tells them apart by their text: the runner's config path (the
 * line naming `RSTEST_CONFIG`) and the repository list (anything else). `pnpm` appends one block per
 * invocation, so a step that reads one repository leaves one block, and `repos` is the list of
 * `A11Y_PROTECTION_REPO` values it was handed. `ranRstest` is `null` when the runner never started. That is
 * the whole point of this helper: every token assertion in this file passes on an `echo` carrying the same
 * words, and this one cannot.
 */
function writeStubs(dir: string, record: string, { config = STUB_CONFIG, repoList = TWO_REPOS.join(" "), rstestExit = 0 }: StepOptions): void {
  const answer = (value: string | null): string => (value === null ? "exit 1" : `printf '%s\\n' ${shellQuote(value)}`);
  writeStub(dir, "node", `case "$*" in\n  *RSTEST_CONFIG*) ${answer(config)} ;;\n  *) ${answer(repoList)} ;;\nesac\n`);
  writeStub(dir, "pnpm", `{ printf 'ARGV: %s\\n' "$*"\n`
    + `  printf 'A11Y_CHECK_MAIN_RULESET=%s\\n' "$A11Y_CHECK_MAIN_RULESET"\n`
    + `  printf 'A11Y_PROTECTION_REPO=%s\\n' "$A11Y_PROTECTION_REPO"\n`
    + `  printf 'GH_TOKEN=%s\\n' "$GH_TOKEN"\n`
    + `} >> ${shellQuote(record)}\n`
    + `case "$*" in *${TABLE_GUARD}*) printf '%s\\n' "$STUB_TABLE_SAYS"; exit "$STUB_TABLE_EXIT" ;; esac\n`
    + `if [ "$A11Y_PROTECTION_REPO" = "$STUB_FAIL_REPO" ]; then echo "stub: runner failed"; exit 1; fi\n`
    + `if [ "$A11Y_PROTECTION_REPO" = "$STUB_SKIP_REPO" ]; then printf '%s\\n' ${shellQuote(NOT_RUN_OUTPUT)}; exit 0; fi\n`
    + `printf '%s\\n' "$STUB_RSTEST_SAYS" | sed "s#%REPO%#$A11Y_PROTECTION_REPO#"\nexit ${rstestExit}\n`);
}

function stepEnv(dir: string, options: StepOptions): NodeJS.ProcessEnv {
  const { token = STUB_TOKEN, says = LIVE_PASS_OUTPUT, skipFor = "", failFor = "", tableExit = 0 } = options;
  const tableSays = options.tableSays ?? tableOutput((options.repoList ?? TWO_REPOS.join(" ")).split(" "));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`,
    STUB_TABLE_SAYS: tableSays, STUB_TABLE_EXIT: String(tableExit), STUB_RSTEST_SAYS: says, STUB_SKIP_REPO: skipFor || "-", STUB_FAIL_REPO: failFor || "-", A11IGN_BOT_TOKEN: token ?? "" };
  if (token === null) delete env.A11IGN_BOT_TOKEN;
  return env;
}

function runReadStep(options: StepOptions = {}): StepOutcome {
  const dir = mkdtempSync(join(tmpdir(), "nightly-ruleset-read-"));
  try {
    const record = join(dir, "rstest-invocation.txt");
    writeStubs(dir, record, options);
    // `-e` and nothing else: GitHub's default shell for a `run:` block does NOT set pipefail, which is why
    // the step sets it itself -- and why a test below can tell whether it still does.
    const result = spawnSync("bash", ["-e", "-c", readStep().run ?? ""],
      { cwd: dir, encoding: "utf8", env: stepEnv(dir, options), timeout: STEP_TIMEOUT_MS });
    const ran = existsSync(record) ? readFileSync(record, "utf8") : null;
    return { status: result.status, output: `${result.stdout}${result.stderr}`, ranRstest: ran,
      repos: [...(ran ?? "").matchAll(/^A11Y_PROTECTION_REPO=(.+)$/gm)].map((m) => m[1] as string) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#2120 EXECUTED: the step really INVOKES the guard, with the flag, the derived config and the token", () => {
  // THE CONTROL A TOKEN SCAN CANNOT GIVE, and the whole of reviewer-2's blocker on #2124.
  const run = runReadStep();
  assert.equal(run.status, 0, `a LIVE PASS run must leave the step green:\n${run.output}`);
  const invocation = run.ranRstest;
  assert.ok(invocation, "the runner was never invoked. That is reviewer-2's finding at `e81497e6`: an "
    + "`echo` carrying these same tokens satisfied every text assertion in this file while reading nothing");
  assert.match(invocation, /^ARGV: exec rstest run /,
    "the step must run rstest itself, rather than passing its name to something else");
  assert.ok(invocation.includes(`--config ${STUB_CONFIG}`),
    "and it must hand rstest the path the derivation PRINTED, not a path of its own");
  assert.ok(invocation.includes(`--include ${GUARD}`), `and it must include ${GUARD}, which is the read`);
  assert.match(invocation, /--disableConsoleIntercept/, "and keep the flag that lets the verdict be printed");
  assert.match(invocation, /^A11Y_CHECK_MAIN_RULESET=1$/m,
    "and the opt-in flag must reach the runner's ENVIRONMENT, which is where the guard reads it");
  assert.match(invocation, new RegExp(`^GH_TOKEN=${STUB_TOKEN}$`, "m"),
    "and the read must be made as the merging identity's secret, which is the subject the verdict is about");
});

test("#3123 EXECUTED: the guard is run ONCE PER LISTED REPOSITORY, each handed its own repository", () => {
  const run = runReadStep();
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.repos, TWO_REPOS, "one invocation per listed repository, in order, each with its own A11Y_PROTECTION_REPO");
  // POSITIVE CONTROL for the count: a one-repository list yields ONE invocation, so the two above are the list.
  assert.deepEqual(runReadStep({ repoList: TWO_REPOS[0] as string }).repos, [TWO_REPOS[0]]);
});

test("#3123 EXECUTED: one repository's pass is NOT another's -- a skip for the second is red and names it", () => {
  const skipped = TWO_REPOS[1] as string;
  const run = runReadStep({ skipFor: skipped });
  assert.equal(run.status, 1, "the first repository certified and the second never printed its pass line");
  assert.match(run.output, new RegExp(`the run for ${skipped} exited green but never printed its LIVE PASS line`));
  assert.doesNotMatch(run.output, new RegExp(`the run for ${TWO_REPOS[0]} exited green`), "and the one that passed is not blamed");
  assert.match(run.output, new RegExp(`did not certify: ${skipped}\\.`));
});

test("#3123 EXECUTED: a pass line for the WRONG repository certifies nothing -- the primary cannot answer for another", () => {
  // The defect the repository in the pass line exists to close: a guard that ignored `A11Y_PROTECTION_REPO`
  // prints the PRIMARY's line on every iteration, and a bare `LIVE PASS` grep would count it for each.
  const primary = "  LIVE PASS (no admin required) on a11ign/a11ign@main: a `pull_request` rule requires 1 approval(s)";
  const run = runReadStep({ says: primary });
  assert.equal(run.status, 1);
  for (const repo of TWO_REPOS) assert.match(run.output, new RegExp(`the run for ${repo} exited green but never printed`));
});

test("#3123 EXECUTED: a runner that FAILS for one repository does not stop the others being read", () => {
  const run = runReadStep({ failFor: TWO_REPOS[0] as string });
  assert.equal(run.status, 1, "a repository whose read failed is not certified");
  assert.deepEqual(run.repos, TWO_REPOS, "and the second was still read: `bash -e` must not end the loop at the first failure");
  assert.match(run.output, new RegExp(`read FAILED for ${TWO_REPOS[0]}`));
});

test("#3123 EXECUTED: an unreadable or EMPTY repository list refuses BY NAME and reads nothing", () => {
  for (const repoList of [null, ""]) {
    const run = runReadStep({ repoList });
    assert.equal(run.status, 1, `a list of ${JSON.stringify(repoList)} certifies no repository`);
    assert.match(run.output, /::error::CANNOT_TELL: could not read the code repositories out of \.agent-org\/project\.json/);
    assert.equal(run.ranRstest, null, "nothing may run against a list nobody could read");
  }
});

test("#3123: the list the step reads IS `project.json`'s `code` array -- the derivation is run, not scanned", () => {
  const line = commands(readStep().run ?? "").find((l) => l.startsWith('REPOS="$(node -e '));
  assert.ok(line, "the step must derive REPOS from a `node -e` command substitution");
  const script = /node -e '([^']+)'/.exec(line)?.[1];
  assert.ok(script, `could not read the script out of: ${line}`);
  const printed = spawnSync("node", ["-e", script], { cwd: REPO, encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  const declared = (JSON.parse(readFileSync(join(REPO, ".agent-org/project.json"), "utf8")) as { code: { repo: string }[] })
    .code.map((c) => c.repo);
  assert.ok(declared.length >= 2, "POSITIVE CONTROL: the real declared list has more than one repository, so 'per repository' is not vacuous");
  assert.deepEqual(printed.stdout.trim().split(/\s+/), declared);
});

test("#2120 EXECUTED: a green run that never printed LIVE PASS is RED -- done-when 2, as a behaviour", () => {
  const run = runReadStep({ says: NOT_RUN_OUTPUT });
  assert.equal(run.status, 1, "the guard exits 0 on every skip, so only the printed line can tell them apart");
  assert.match(run.output, /::error::CANNOT_TELL: the run for \S+ exited green but never printed its LIVE PASS line/);
  assert.ok(run.ranRstest,
    "POSITIVE CONTROL: the step must have really run the guard and then judged its output -- a step that "
    + "stopped invoking it would fail this case too, for the wrong reason, and read as this fix working");
});

test("#2120 EXECUTED: a missing secret refuses BEFORE any read -- a swapped subject is worse than none", () => {
  const run = runReadStep({ token: null });
  assert.equal(run.status, 1, "CANNOT_TELL fails the job; it does not warn and continue");
  assert.match(run.output, /::error::CANNOT_TELL: A11IGN_BOT_TOKEN is not set/);
  assert.equal(run.ranRstest, null,
    "and nothing may run: a read made as whatever identity happened to be available is a true statement "
    + "about the wrong subject, and reads in the log exactly like the useful one");
});

test("#2120 EXECUTED: a renamed RSTEST_CONFIG export refuses BY NAME, not by dying on `undefined`", () => {
  const run = runReadStep({ config: null });
  assert.equal(run.status, 1);
  assert.match(run.output, /::error::CANNOT_TELL: could not read RSTEST_CONFIG/);
  assert.equal(run.ranRstest, null, "the runner must not be started with an empty or `undefined` --config");
});

test("#2120 EXECUTED: `set -o pipefail` -- a runner that FAILS is red even with LIVE PASS in the log", () => {
  // Without it the pipeline reports `tee`'s zero, the grep then finds the LIVE PASS line the failing run
  // had already printed, and a read that crashed halfway certifies `main`. `bash -e` alone cannot see it.
  // The stub prints the pass line AND exits 1, which is the shape that case needs.
  const run = runReadStep({ rstestExit: 1 });
  assert.notEqual(run.status, 0, "a failing runner must fail the step even though its output was captured");
  assert.ok(run.ranRstest, "POSITIVE CONTROL: the runner ran and failed, rather than never starting");
  assert.match(run.output, /read FAILED for/, "and it is the runner's own status that is read, not the log's content");
});

// --- #3708: THE SETTINGS TABLE, run once a night in the same step, as the same identity -----------------------
//
// `layer-repository-protection.test.ts` reads every declared repository against `docs/new-code-repository.md`
// (#3705's table) and was opt-in, so nothing ran it unattended. It is the second runner of the step above and
// not a step of its own, because the secret would then be named a third time in `nightly.yml` and `agent-org`'s
// own test (#2358) pins that count at two. It reads ALL repositories in one run, so it follows the loop.

/** The test the table runs. Not reserved by this row's Region -- read here, never written. */
const TABLE_GUARD = "packages/lab/src/packaging/layer-repository-protection.test.ts";

/** The table's runner, as a command rather than as tokens (the shape `RUNNER_INVOCATION` demands of the first). */
function tableRunnerLine(): string {
  const mentions = commands(readStep().run ?? "").filter((line) => line.includes(TABLE_GUARD));
  assert.equal(mentions.length, 1, `expected exactly one command in \`${JOB}\` naming ${TABLE_GUARD}, found ${mentions.length} -- `
    + "#3705's table is read by nothing on a schedule without it, and a repository that drifts is found by the release that fails on it");
  assert.match(mentions[0] as string, RUNNER_INVOCATION, "the rstest command must be EXECUTED, not quoted in an `echo`");
  return mentions[0] as string;
}

/** The two literals the step requires in the table's output, read OUT of the step rather than re-typed here. */
function tableLiterals(): { pass: string, rowOf: (repo: string) => string } {
  const lines = commands(readStep().run ?? "");
  const pass = lines.map((l) => /^grep -qF "(LIVE PASS[^"$]+)" "\$TABLE_LOG"/.exec(l)?.[1]).find((m) => m !== undefined);
  const row = lines.map((l) => /^grep -qF "([^"$]+)\$\{repo\}([^"$]*)" "\$TABLE_LOG"/.exec(l)).find((m) => m !== null && m !== undefined);
  assert.ok(pass, "the step must grep the table's log for the protection read's LIVE PASS line, as an executed command");
  assert.ok(row, "and for each repository's own `release-shape` row, as an executed command");
  return { pass, rowOf: (repo) => `${row[1]}${repo}${row[2]}` };
}

test("#3708: the table is run after the ruleset read, with the flag, interception off and the derived config", () => {
  const run = readStep().run ?? "";
  assert.ok(run.indexOf(TABLE_GUARD) > run.indexOf(GUARD), "the table follows the per-repository loop, which it must not stop or skip");
  const runner = tableRunnerLine();
  assert.match(runner, /^A11Y_CHECK_MAIN_RULESET=1\s+pnpm\b/, "without the flag the test prints NOT RUN and exits 0");
  assert.match(runner, /--disableConsoleIntercept\b/, "rstest drops the test's printed output without it, so the greps could never match");
  assert.match(runner, /--config "\$RSTEST_CONFIG"/);
  assert.match(runner, /\|\s*tee\s+"\$TABLE_LOG"$/, "the output is captured to the file the greps read");
  assert.doesNotMatch(runner, /A11Y_PROTECTION_REPO/, "the table reads every declared repository; the narrowing variable does not apply to it");
});

test("#3708: the table adds NO second reference to the secret -- agent-org's own pin (#2358) counts it at two", () => {
  // A step of its own would name `secrets.A11IGN_BOT_TOKEN` a third time and turn that test red in the tool's repository,
  // which a PR here cannot fix. The count is of the whole file, comments included, as that test reads it.
  const text = readFileSync(join(REPO, NIGHTLY), "utf8");
  assert.equal(text.match(/secrets\.A11IGN_BOT_TOKEN/g)?.length, 2, "ready-audit's and this job's, and no third");
  assert.equal(nightlyJobs()[JOB]?.env, undefined, "and not as a job-level `env`, which would hand the token to install, build and clone");
});

test("#3708: the literals the step greps the table's output for are ones the table test actually prints", () => {
  // The cross-file link, in the direction that matters: a reworded print makes the nightly red every night, and a
  // loosened grep could match `NOT RUN`. Both literals are checked against the test's own source.
  const source = readFileSync(join(REPO, TABLE_GUARD), "utf8");
  const { pass, rowOf } = tableLiterals();
  assert.ok(source.includes(pass), `${TABLE_GUARD} never prints ${JSON.stringify(pass)}`);
  assert.ok(pass.length > "LIVE PASS".length, "narrower than the bare words, which a reworded skip message could also carry");
  assert.ok(source.includes('const RELEASE_COLUMN = "release-shape"'), "the column the row line names is the one the test prints");
  assert.ok(source.includes("`  ${RELEASE_COLUMN} ${r.repo}: ${"), "and it prints one such line per repository");
  assert.equal(rowOf("a11ign/x"), "release-shape a11ign/x: OK", "the row literal names the repository, so one repository's row cannot stand for another's");
  assert.ok(source.indexOf("NOT RUN: the live settings table") < source.indexOf("${RELEASE_COLUMN} ${r.repo}"),
    "the row line is printed only on the far side of the opt-in return, which is why its presence says the table was read");
});

/** What the table test prints on a green run over `repos`, in the shape its source prints it (derived from that source, pinned above, not captured live). */
function tableOutput(repos: string[], { skipRow = "", pass = true } = {}): string {
  return [
    "repository  protection  token  release-shape",
    ...repos.map((r) => `${r}  OK  OK  OK`),
    ...repos.filter((r) => r !== skipRow).map((r) => `  release-shape ${r}: OK a per-merge caller`),
    ...(pass ? [`  LIVE PASS (per-repository) over ${repos.length} repository(ies): ${repos.join(", ")}`] : []),
  ].join("\n");
}

test("#3708 EXECUTED: the step runs the table with the flag, the derived config and the merging identity's token", () => {
  const run = runReadStep();
  assert.equal(run.status, 0, run.output);
  const invocation = (run.ranRstest ?? "").split("ARGV: ").find((block) => block.includes(TABLE_GUARD));
  assert.ok(invocation, "the table runner was never invoked: an `echo` carrying these tokens would have passed every scan above");
  assert.ok(invocation.includes(`--config ${STUB_CONFIG}`));
  assert.match(invocation, /^A11Y_CHECK_MAIN_RULESET=1$/m);
  assert.match(invocation, new RegExp(`^GH_TOKEN=${STUB_TOKEN}$`, "m"));
  assert.deepEqual(run.repos, TWO_REPOS, "and the per-repository loop still ran once per repository beside it");
});

test("#3708 EXECUTED: a green exit that printed NO table is RED -- the skip the opt-in flag exists to end", () => {
  const run = runReadStep({ tableSays: NOT_RUN_OUTPUT });
  assert.equal(run.status, 1, "the test exits 0 on every skip, so only the printed output can tell a skip from a read");
  assert.match(run.output, /::error::CANNOT_TELL: the settings table exited green but never printed its output for:/);
  assert.match(run.output, /did not certify: <the-settings-table>\./, "and the closing summary names it");
  assert.equal(run.repos.length, TWO_REPOS.length, "POSITIVE CONTROL: the loop ran and certified, so the red is the table's alone");
});

test("#3708 EXECUTED: a table missing ONE declared repository's row is red and names it; the other's row cannot stand in", () => {
  const missing = TWO_REPOS[1] as string;
  const run = runReadStep({ tableSays: tableOutput(TWO_REPOS, { skipRow: missing }) });
  assert.equal(run.status, 1);
  assert.match(run.output, new RegExp(`never printed its output for: ${missing},`));
  assert.doesNotMatch(run.output, new RegExp(`output for:[^,]*${TWO_REPOS[0]}`), "and the repository whose row is there is not blamed");
});

test("#3708 EXECUTED: a table without the protection read's LIVE PASS line is red, because both live tests must have run", () => {
  const run = runReadStep({ tableSays: tableOutput(TWO_REPOS, { pass: false }) });
  assert.equal(run.status, 1);
  assert.match(run.output, /never printed its output for: <the-protection-read>/);
});

test("#3708 EXECUTED: a table run that FAILS is red even with its output present, and does not hide the loop's own failure", () => {
  const failed = runReadStep({ tableExit: 1 });
  assert.equal(failed.status, 1, "`set -o pipefail`: the lines a failing run printed must not certify it");
  assert.match(failed.output, /::error::CANNOT_TELL: the settings table FAILED \(exit 1\)/);
  const both = runReadStep({ tableExit: 1, skipFor: TWO_REPOS[1] as string });
  assert.match(both.output, /the run for a11ign\/second-repo exited green but never printed its LIVE PASS line/);
  assert.match(both.output, /did not certify: a11ign\/second-repo <the-settings-table>\./, "both are named: neither hides the other");
});
