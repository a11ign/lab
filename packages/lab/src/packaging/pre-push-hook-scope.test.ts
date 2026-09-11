/**
 * WHAT THE PRE-PUSH HOOK IS ALLOWED TO RUN, AND NOTHING MORE — #911, step 4 of the CI Reset.
 *
 * The hook was a second copy of CI: lint, typecheck, an `.mjs` parse check, 22 tree-wide guards, a board
 * guard glob, a changeset gate and two corpus-reading gates. Everything in that list except the leak
 * guards runs again in CI minutes later, on the whole tree, where an unscoped sweep belongs. Measured on
 * this checkout at `40e36ba4`, wall clock: the sweep alone was 30.22s of about 39s.
 *
 * **The leak scan is the one check whose value is being BEFORE the push rather than before the merge.**
 * This repository is public; a pushed branch is visible the moment it lands. It was two of the 22 files in
 * `guards:sweep` — `tracked-source-leak-guard.test.ts` and `tracked-prose-leak-guard.test.ts` — which is
 * why "keep the leak scan and delete the sweep" would, taken literally, have deleted it.
 *
 * ## Why this test parses the hook rather than scanning the tree for command strings
 *
 * A FIXTURE CANNOT NAME ITSELF. This file necessarily contains the command strings it asserts the hook may
 * run, so a tree-wide grep for `guards:sweep` or `training:check-signals` would match THIS FILE the moment
 * it is committed and report the hook as still running them. Everything below reads
 * `scripts/git-hooks/pre-push` and parses it.
 *
 * ## The population, and the two kinds of thing in it
 *
 * `run <label> <command...>` is the hook's own mechanism for "a check that can fail this push", and those
 * call sites are the CHECKS. A second population runs alongside them — `node -e` for a millisecond clock,
 * `changed-files.mjs` to build lint's path list, `merge-guard.mjs` for the armed-PR lookup — which execute
 * a command without being a check. Those are enumerated by name with a reason each, the same shape
 * `cli-flags.test.ts`'s `UNGUARDED` uses, so a new one cannot arrive unnoticed either.
 *
 * THE GIT-ONLY REFUSALS ARE OUT OF SCOPE BY NAME, not by omission — the stale-base check,
 * `resolve-toward-main`, the 300-deletion warning and the `A11Y_SKIP_VERIFY` gate. None is a copy of CI,
 * each is git plumbing costing milliseconds, and each is push SAFETY rather than verification. Asserting
 * over "everything the hook executes" would assert something false and fail on the first `git rev-parse`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK_PATH = `${REPO}scripts/git-hooks/pre-push`;
const hook = (): string => readFileSync(HOOK_PATH, "utf8");

/**
 * The hook's CODE, with comments and echoed TEXT removed.
 *
 * Both removals are load-bearing. This hook is two thirds prose, and that prose names every command it has
 * ever run, including the ones #911 removed — a parse that kept comments would report the hook as still
 * running them. And its messages QUOTE commands at the reader (`npm run lab:job -- -e job=rules-gate` is
 * the whole point of the not-run line below), which is text, not execution.
 *
 * A `#` is only a comment when whitespace precedes it, which is what keeps `${#lint_paths[@]}` intact.
 */
function codeLines(source: string): string[] {
  return source.split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .map((line) => line.replace(/\b(echo|printf)\b.*$/, ""))
    .filter((line) => line.trim().length > 0);
}

/** Every `run <label> <command...>` call site, with its line continuations joined. */
function runSites(source: string): { label: string; command: string }[] {
  const joined = source.replace(/\\\n\s*/g, " ");
  return [...joined.matchAll(/^\s*run "([^"]*)"\s+(.+)$/gm)]
    .map((m) => ({ label: m[1], command: m[2].trim() }));
}

/** Every place the hook invokes node, npm, npx or a local binary — checks and helpers alike. */
function invocations(source: string): string[] {
  return codeLines(source)
    .filter((line) => /(^|[^\w-])(node|npm|npx|\.\/node_modules\/\.bin\/[\w-]+)([\s(]|$)/.test(line))
    .map((line) => line.trim());
}

/**
 * The invocations that are NOT checks, each with why it is here. THIS LIST MAY ONLY SHRINK on the
 * strength of a row that says so: every entry executes something without being a verification.
 */
const NOT_A_CHECK: Record<string, string> = {
  "node -e":
    "the millisecond clock (`now_ms`). `date +%s.%N` is a GNU extension a bare BSD date does not have, "
    + "and node is already a hard dependency of every check here",
  "node scripts/changed-files.mjs":
    "builds lint's path list -- the INPUT to a check, not a check. #939's one helper, so the source side "
    + "of a rename is listed too",
  "node scripts/merge-guard.mjs":
    "the #386 armed-PR lookup: refusing to race a merge that can complete underneath the push. It fails "
    + "OPEN and loudly on anything that stops it asking, and never refuses for an unrelated reason",
};

test("THE THREE: the hook's checks are lint, typecheck and the leak scan -- and there is no fourth", () => {
  const sites = runSites(hook());
  // THE POPULATION FIRST. An empty parse would satisfy every assertion below about what is absent.
  assert.ok(sites.length >= 3,
    `the parse found ${sites.length} run call site(s) in the hook; the regex is broken, not the hook`);

  const commands = sites.map((s) => s.command);
  assert.equal(sites.length, 3,
    "#911 reduced this hook to three checks. A fourth is a second copy of CI, which is what the row "
    + `deleted -- found: ${sites.map((s) => `${s.label} => ${s.command}`).join(" | ")}`);
  assert.ok(commands.some((c) => /\beslint\b/.test(c)), `no lint site among: ${commands.join(" | ")}`);
  assert.ok(commands.some((c) => /\bnpm run --silent typecheck\b/.test(c)),
    `no typecheck site among: ${commands.join(" | ")}`);
  assert.ok(commands.some((c) => /tracked-source-leak-guard\.test\.ts/.test(c)),
    `no leak scan site among: ${commands.join(" | ")}`);
});

test("and nothing ELSE the hook executes is a check -- each non-check names its own reason", () => {
  const sites = new Set(runSites(hook()).map((s) => s.command));
  const unexplained = invocations(hook())
    .filter((line) => ![...sites].some((command) => line.includes(command.split(" ")[0])))
    .filter((line) => !Object.keys(NOT_A_CHECK).some((known) => line.includes(known)));
  assert.deepEqual(unexplained, [],
    "these run something the hook does not declare as a check or as a named helper. If it is a check it "
    + `belongs in the three above; if it is not, give it a NOT_A_CHECK entry with the reason:\n${unexplained.join("\n")}`);

  // And an entry cannot outlive its call site: a reason for something that is gone is a claim about nothing.
  const code = codeLines(hook()).join("\n");
  for (const known of Object.keys(NOT_A_CHECK)) {
    assert.ok(code.includes(known), `${known} is declared as a non-check and the hook no longer runs it`);
  }
});

test("LINT IS SCOPED BY PATH, and by the TREE as well as the committed diff", () => {
  const code = codeLines(hook()).join("\n");
  assert.match(code, /node scripts\/changed-files\.mjs origin\/main\.\.\.HEAD/,
    "lint's path list must come from the shared changed-files helper, not a second hand-rolled diff");
  // THE TREE TOO, and this is the half that is easy to lose. Every note in this hook says the gate reads
  // the TREE rather than the commits being pushed; a list built from `origin/main...HEAD` alone skips the
  // file you just edited, so a freshly branched worktree lints NOTHING and prints ok.
  assert.match(code, /git status --porcelain \| cut -c4-/,
    "the dirty working tree must reach lint's path list, or the first push of a new branch lints nothing");
  assert.doesNotMatch(code, /run "lint[^"]*"\s+npm run --silent lint\b/,
    "lint must not go back to reading the whole tree unconditionally -- that is what this row scoped");
  // NOT BY CHANGED PACKAGE, which is the trap: `changed-packages.mjs` lists `packages/<name>` only, so a
  // `scripts/`-only change scopes to the empty list and a check handed an empty population reports clean.
  assert.doesNotMatch(code, /lint_paths.*changed-packages\.mjs/,
    "scoping lint by changed PACKAGE would skip every scripts/-only change, which is most of them");
});

test("TYPECHECK IS NOT SCOPED, and the hook says why in terms of the MECHANISM", () => {
  const source = hook();
  const site = runSites(source).find((s) => /typecheck/.test(s.command));
  assert.ok(site, "no typecheck site found");
  assert.match(site!.command, /^npm run --silent typecheck$/,
    "typecheck must run the whole program -- tsc's unit IS the program, not the file");
  // THE REASON, not the conclusion. The next person to reach for this optimisation needs the three facts,
  // or "do not scope this" reads as taste and gets optimised away.
  const reason = source.slice(0, source.indexOf(site!.command));
  assert.match(reason, /exclude.*src\/\*\*\/\*\.test\.ts/s,
    "the reason must name the package tsconfigs' own test exclusion -- that is why a package program is 0 tests");
  assert.match(reason, /no package program contains top-level `scripts\/`/,
    "and that no package program contains top-level scripts/, which is where most of this repo's rows live");
});

test("THE LEAK SCAN names both guards by file, and both files exist", () => {
  const site = runSites(hook()).find((s) => /tracked-.*-leak-guard/.test(s.command));
  assert.ok(site, "no leak scan site found");
  for (const guard of ["tracked-source-leak-guard", "tracked-prose-leak-guard"]) {
    assert.match(site!.command, new RegExp(`packages/lab/src/packaging/${guard}\\.test\\.ts`),
      `${guard} must be named by the hook -- it is the one check whose value is being before the push`);
    assert.ok(existsSync(`${REPO}packages/lab/src/packaging/${guard}.test.ts`),
      `${guard}.test.ts does not exist; the hook names a file that is gone`);
  }
});

/** The not-run line, extracted between its own markers -- driven, never retyped. */
function notRunBlock(): string {
  const match = /# BEGIN #911 NOT-RUN LINE[^\n]*\n([\s\S]*?)# END #911 NOT-RUN LINE/.exec(hook());
  assert.ok(match, "expected the not-run line bounded by its own markers in the pre-push hook");
  return match[1];
}

test("WHAT IT DID NOT RUN IS SAID UNCONDITIONALLY -- driven, with no corpus and no env", () => {
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n${notRunBlock()}`], {
    encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, cwd: "/",
  });
  assert.equal(r.status, 0);
  // UNCONDITIONAL is the whole change. The old form was gated on `[ -d runs/... ]`, which is silent on the
  // machine that HAS a copy of runs/ -- and a stale copy is the machine that most needs telling. One
  // measured here was 89 hours old and reported cleanly having examined a corpus that no longer existed.
  const said = r.stdout;
  for (const named of ["training:check-signals", "rules:gate"]) {
    assert.match(said, new RegExp(named.replace(":", ":")),
      `the line must NAME ${named} -- "some checks did not run" is what gets scrolled past`);
  }
  assert.match(said, /lab:job/,
    "and must name where the authoritative verdict comes from, or the reader has nothing to do with it");
  assert.doesNotMatch(notRunBlock(), /\bif\b|\[ -d|\[ -f/,
    "the line must not be gated on anything -- that is the difference this row makes");
});

test("the SKIP-VERIFY message names the same three checks, so the two copies cannot drift", () => {
  const code = hook();
  assert.match(code, /It would skip: lint, typecheck and the leak scan\./,
    "the refusal must list what is actually skipped -- an abstract sentence is what got scrolled past nine times");
  // MESSAGES ONLY, never the whole file: the header's 2026-09-07 measurement quotes the old three by name
  // ("AFTER (lint, typecheck, the mjs parse check) 13.94s"), and a record of the past is never renamed.
  // What must not survive is a line the hook PRINTS, which a reader takes as a statement about now.
  const printed = hook().split("\n").filter((line) => /^\s*echo\b/.test(line)).join("\n");
  assert.ok(!/mjs parse check|guards:sweep|check-signals ran|board guards/.test(printed),
    `a message still names a check this hook no longer runs:\n${printed.split("\n").filter((l) => /mjs parse check|guards:sweep|board guards/.test(l)).join("\n")}`);
});
