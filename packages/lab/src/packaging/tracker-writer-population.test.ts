// no-token: gh
//
// Every `gh` argv in this file is `["--version", …]` — a read that prints a version string and touches
// nothing — chosen deliberately: see `PROBE_ARGV` below. Nothing here reaches GitHub, and the one test
// that spawns at all spawns `gh --version`.
//
/**
 * #1053: #1052 gave three GitHub writers a leak refusal. **Eight more sent a body and had none, and
 * nothing in the tree would have noticed a ninth** — `tracker-leak-refusal.test.ts` named the three in
 * PROSE, and prose does not fail when a fourth appears.
 *
 * TWO FAILURES, TWO MESSAGES. "Not declared" and "declared but does not check" are different repairs, and
 * a single line telling a reader to do one when they need the other is the defect #1040 was filed for.
 *
 * THE GUARD IS REACHABILITY, NOT TEXT. Eleven writers are served by five spawn helpers, and the guard went
 * into the helpers: `board-data.mjs` alone covers four of them. A `grep` for `leakRefusalReason` in each
 * script — which is what this row's own open-check did — reports four correctly guarded writers as
 * unguarded. That is the row's own objection to counting writers by the shape of their `gh` call, one
 * level in: **a guard whose population is defined by how something is WRITTEN is routed around by writing
 * the next one differently.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TRACKER_WRITERS, sendsABody, bodyFromArgv, assertNoLeakInArgv }
  from "../../../../packages/lab/src/packaging/leak-patterns.mjs";
import { localImports } from "../../../../scripts/local-import-closure.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const GUARD = resolve(REPO, "packages/lab/src/packaging/leak-patterns.mjs");

/** Every `.mjs` under `scripts/`, from git rather than a glob, so an untracked scratch file is not a writer. */
const trackedScripts = () =>
  execFileSync("git", ["ls-files", "scripts"], { cwd: REPO, encoding: "utf8", env: sandboxGitEnv() })
    .split("\n").filter((f) => f.endsWith(".mjs"));

/** Does `entry`'s local-import closure reach the guard? */
function reachesGuard(entry: string, deps: { imports?: (f: string) => string[]; guard?: string } = {}) {
  const imports = deps.imports ?? localImports;
  const guard = deps.guard ?? GUARD;
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of imports(file)) visit(next);
  };
  visit(entry);
  return seen.has(guard);
}

/**
 * The walk, as a function of its inputs so it can be driven over a SYNTHETIC tree.
 *
 * The real tree's answer is `[] / []` on the day this lands, and **a walk that examined nothing gives the
 * same two empty lists** — so the walk is proved to FAIL over a directory built to make it fail, not
 * proved to be silent over the one it is written for.
 */
function writerPopulation(
  { root, files, declared, read, reaches }: {
    root: string; files: string[]; declared: readonly string[];
    read: (f: string) => string; reaches: (entry: string) => boolean;
  },
) {
  const sending = files.filter((f) => sendsABody(read(resolve(root, f))));
  return {
    examined: files.length,
    sending,
    undeclared: sending.filter((f) => !declared.includes(f)),
    unguarded: sending.filter((f) => declared.includes(f) && !reaches(resolve(root, f))),
  };
}

const realPopulation = () => writerPopulation({
  root: REPO,
  files: trackedScripts(),
  declared: TRACKER_WRITERS,
  read: (f) => readFileSync(f, "utf8"),
  reaches: (entry) => reachesGuard(entry),
});

test("#1053: every script that sends a body to GitHub is DECLARED", () => {
  const { undeclared, examined, sending } = realPopulation();
  assert.deepEqual(undeclared, [],
    `${examined} scripts walked, ${sending.length} send a body; these are not in TRACKER_WRITERS. Add each `
    + "to that list deliberately — a writer nobody declared is a writer nobody checked");
});

test("#1053: every DECLARED writer reaches the leak guard through its import closure", () => {
  const { unguarded } = realPopulation();
  assert.deepEqual(unguarded, [],
    "these are declared writers whose closure never reaches `leak-patterns.mjs`, so the body they send is "
    + "checked by nothing. Guard the SPAWN HELPER they use, not the call site");
});

test("#1053: the population is real — this cannot pass having walked nothing", () => {
  // Both counts, because they fail differently: zero scripts means `git ls-files` moved, zero senders
  // means the body-flag predicate did. Either one gives two empty lists above and a clean sheet.
  const { examined, sending } = realPopulation();
  assert.ok(examined >= 100, `expected the whole scripts directory, walked ${examined}`);
  assert.ok(sending.length >= 8,
    `only ${sending.length} script(s) read as sending a body; the flag predicate is broken, not the tree `
    + "empty. Measured at 11 when this landed");
  assert.equal(sending.length, TRACKER_WRITERS.length,
    "and the declared list is exactly the found set — a writer removed from the tree must leave the list");
});

// --- the walk, driven over a synthetic tree built to make it fail ---

function syntheticTree() {
  const root = mkdtempSync(join(tmpdir(), "a11y-writers-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  const write = (name: string, text: string) => writeFileSync(join(root, "scripts", name), text);
  write("declared-and-guarded.mjs", 'import { assertNoLeakInArgv } from "../guard.mjs";\ngh(["x", "--body", b]);\n');
  write("quiet.mjs", 'gh(["pr", "list"]);\n'); // no body flag: not a writer, must not be listed
  writeFileSync(join(root, "guard.mjs"), "export const assertNoLeakInArgv = () => {};\n");
  return root;
}

test("#1053 MUTATION: a NINTH writer nobody declared turns the walk red, and says 'not declared'", () => {
  const root = syntheticTree();
  try {
    const declared = ["scripts/declared-and-guarded.mjs"];
    const reaches = (entry: string) => entry.endsWith("declared-and-guarded.mjs");
    const before = writerPopulation({ root, files: ["scripts/declared-and-guarded.mjs", "scripts/quiet.mjs"],
      declared, read: (f) => readFileSync(f, "utf8"), reaches });
    assert.deepEqual([before.undeclared, before.unguarded], [[], []], "the tree starts clean");

    writeFileSync(join(root, "scripts", "newcomer.mjs"), 'gh(["issue", "comment", "1", "--body", b]);\n');
    const after = writerPopulation({ root,
      files: ["scripts/declared-and-guarded.mjs", "scripts/quiet.mjs", "scripts/newcomer.mjs"],
      declared, read: (f) => readFileSync(f, "utf8"), reaches });
    assert.deepEqual(after.undeclared, ["scripts/newcomer.mjs"], "the ninth writer is NOT DECLARED");
    assert.deepEqual(after.unguarded, [],
      "and it is not reported as unguarded as well — one defect, one message, so the reader makes one repair");
    assert.ok(!after.sending.includes("scripts/quiet.mjs"),
      "and a script spawning `gh` WITHOUT a body flag is not a writer — the predicate is the flag, not the call");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1053 MUTATION: a writer DECLARED but not reaching the guard is red for the OTHER reason", () => {
  // The row's second half: list it and leave it unguarded, and the walk must still go red — with a
  // different message, because "declare it" and "guard it" are different repairs.
  const root = syntheticTree();
  try {
    writeFileSync(join(root, "scripts", "newcomer.mjs"), 'gh(["issue", "comment", "1", "--body", b]);\n');
    const files = ["scripts/declared-and-guarded.mjs", "scripts/newcomer.mjs"];
    const declared = ["scripts/declared-and-guarded.mjs", "scripts/newcomer.mjs"];
    const result = writerPopulation({ root, files, declared, read: (f) => readFileSync(f, "utf8"),
      reaches: (entry) => entry.endsWith("declared-and-guarded.mjs") });
    assert.deepEqual(result.undeclared, [], "declaring it silences the first failure");
    assert.deepEqual(result.unguarded, ["scripts/newcomer.mjs"], "and the second one fires instead");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- the guard at the spawn, driven rather than reasoned about ---

/**
 * A private LAN address ASSEMBLED, never written whole — and the tree guard is why.
 *
 * The first version of these files wrote the literal out, and `tracked-source-leak-guard` refused the push
 * naming all four occurrences. That is the guard working on the file that builds a guard, and the fix is
 * #1037's: **concatenate, so the literal never appears contiguously in the tree, while the assembled
 * string still matches the pattern** — because a positive control for a leak guard has to be the thing it
 * looks for. The documentation ranges cannot serve here; they are exactly what the pattern does not match.
 */
const PRIVATE_LAN = ["192.168", "1.50"].join(".");

/**
 * `gh --version` CARRYING A LEAK. Chosen so this probe cannot write: if the guard were ever removed, this
 * argv spawns `gh --version`, prints a version and returns — it does not post a comment. A probe testing a
 * write guard must not be able to perform the write it is testing for.
 */
const PROBE_ARGV = ["--version", "--body", `the box at ${PRIVATE_LAN} answered`];

test("#1053: the guard throws on a leaking body BEFORE the spawn, and the probe cannot write either way", () => {
  assert.equal(bodyFromArgv(PROBE_ARGV), `the box at ${PRIVATE_LAN} answered`);
  assert.throws(() => assertNoLeakInArgv("gh", PROBE_ARGV), /REFUSING/,
    "a leaking body must stop the spawn");
  assert.doesNotThrow(() => assertNoLeakInArgv("gh", ["--version", "--body", "nothing of interest"]));
  assert.doesNotThrow(() => assertNoLeakInArgv("git", ["commit", "-m", `the box at ${PRIVATE_LAN}`]),
    "and a non-`gh` command is not this guard's business — the tree guard already holds committed files");
});
