/**
 * A DECLARED-UNEXAMINABLE PAGE LEAVES THE DENOMINATOR. This file is what stops that becoming a way to
 * launder a failure into a pass.
 *
 * `83 of 85` is INCONCLUSIVE for ever if two of the 85 can never be examined, which tells a reader nothing
 * and blocks everything downstream on a number that cannot move. `83 of 83, with 2 declared` is a
 * conclusive statement about what was examined PLUS an honest statement about what was not — the same
 * distinction `rule-ownership.json` draws with `decidedBy: "unavailable"`, for the same reason: "nobody"
 * and "somebody forgot" must never be the same state.
 *
 * Every suppression list this project has considered fails the same way — it accumulates entries nobody
 * re-reads, and the thing it suppresses stops being visible. Four properties are what make this one
 * different, and each is asserted below:
 *
 *   1. every entry states a REASON, or it is a suppression rather than a declaration
 *   2. every entry states what REMOVES it, or it is permanent wearing temporary's clothes
 *   3. the gate PRINTS every entry on every run, so it cannot sit here unread
 *   4. an UNDECLARED unusable page still reduces coverage — the declaration removes a page from the
 *      denominator, never a finding, and never applies to a page nobody wrote a reason for
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const DECLARATION = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../baselines/real-page-unexaminable.json", import.meta.url)), "utf8")) as {
    why?: string; pages?: Record<string, { reason?: string; removedWhen?: string; declaredAt?: string }> };

const GATE = readFileSync(
  fileURLToPath(new URL("../../scripts/check-real-page-findings.ts", import.meta.url)), "utf8");

test("every declared page states a REASON and what REMOVES it", () => {
  const pages = Object.entries(DECLARATION.pages ?? {});
  // Vacuity guard: an empty declaration would pass this loop having checked nothing. Empty is a legitimate
  // state — it is the state we want — so it is asserted as a distinct outcome rather than allowed to
  // masquerade as a clean run of the loop below.
  if (pages.length === 0) {
    assert.ok(true, "no page is declared unexaminable, which is the state to aim for");
    return;
  }
  for (const [url, entry] of pages) {
    assert.equal(typeof entry?.reason, "string",
      `${url} is excluded from the denominator with no reason — that is a suppression, not a declaration`);
    assert.ok((entry.reason ?? "").length > 40,
      `${url}'s reason is too short to be one. It must say what the tool could not do and why, in enough `
      + "words that somebody who did not write it can check whether it is still true.");
    assert.equal(typeof entry?.removedWhen, "string",
      `${url} states no condition that removes it, so it is a PERMANENT exclusion wearing a temporary `
      + "one's clothes — the failure mode of every suppression list this project has considered");
    assert.equal(typeof entry?.declaredAt, "string", `${url} does not say WHEN it was declared`);
  }
});

test("the gate PRINTS every declaration, so an exclusion cannot sit unread", () => {
  assert.match(GATE, /DECLARED unexaminable, and therefore not in the/,
    "the gate must announce the exclusions it applied");
  assert.match(GATE, /why: \$\{entry\.reason\}/,
    "printing the URL alone reproduces the count-with-no-identity defect — the reason must print too");
  assert.match(GATE, /removed when: \$\{entry\.removedWhen\}/,
    "and the exit condition, or a reader cannot tell a scheduled exclusion from an abandoned one");
});

test("a declaration for a page that IS examinable says so, rather than quietly shrinking the denominator", () => {
  // The anti-stale half. Once the `sameDocument` fix lands these two become examinable, and a declaration
  // nobody removes would silently keep taking them out of the denominator for ever — the exact way a
  // temporary exclusion becomes a permanent one without anybody deciding to make it one.
  assert.match(GATE, /declared, but examinable in THIS run — remove it/,
    "a declaration that no longer applies must be reported, not silently honoured");
});

test("only pages actually unusable in THIS run leave the denominator", () => {
  // Property 4, and the one that stops this laundering anything: `declaredHere` is the INTERSECTION of the
  // declared set with the pages this run found unusable. A declared page that was examined stays in the
  // denominator and is reported above; an unusable page that is NOT declared comes off `examined` alone
  // and therefore still shows as a shortfall.
  assert.match(GATE, /\.filter\(\(url\) => declared\.has\(url\)\)/,
    "the exclusion must be the intersection with what was actually unusable, never the declared list "
    + "applied wholesale");
  assert.match(GATE, /of: pages - declaredHere\.length/,
    "the denominator must be reduced by the pages excluded HERE, not by the size of the declaration file");
});

test("a missing declaration file makes the gate STRICTER, never more permissive", () => {
  assert.match(GATE, /if \(!existsSync\(path\)\) return out;/,
    "an absent or unreadable declaration must yield an EMPTY set, so every unusable page counts as a "
    + "shortfall — a gate that gets weaker when a file goes missing is one a deleted file can silence");
});

// --- #1030: the path the OPERATOR is told to edit, and the path the gate actually reads ---

const LAB_JOB = fileURLToPath(new URL("../../../control/ansible/lab-job.yml", import.meta.url));
const LAB_JOB_YML = readFileSync(LAB_JOB, "utf8");
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/**
 * The declaration path as the GATE resolves it, read out of the gate's own source.
 *
 * Derived, not restated. A second literal here would drift the next time the baseline moves, which is the
 * defect this row exists to fix — so if `check-real-page-findings.ts` starts resolving a different path,
 * this value follows it and the assertion below goes red on its own.
 *
 * Exactly one match is required. A regex that finds nothing would otherwise make every assertion below
 * vacuously true about an empty string — the shape where a check reports cleanly having examined nothing.
 */
function gateDeclarationPath(): string {
  const matches = [...GATE.matchAll(/resolve\(REPO,\s*"([^"]*real-page-unexaminable[^"]*)"\)/g)];
  assert.equal(matches.length, 1,
    `expected exactly one declaration path in the gate's source, found ${matches.length} — a zero here `
    + "would make the comparison below true of nothing at all");
  return matches[0][1];
}

test("#1030: the path the INCONCLUSIVE message tells an operator to edit is the path the gate READS", () => {
  // `runs/real-page-unexaminable.json` was named here and nothing read it. An operator following the
  // refusal exactly created that file, the declaration did nothing, the gate kept returning 2, and the
  // same message told them to re-run — so they did, and got the same answer having done as they were told.
  // Worse than a typo: `runs/` is gitignored, so the useless file would have been invisible to review too.
  const expected = gateDeclarationPath();
  const named = LAB_JOB_YML.match(/DECLARED in (\S+\.json)/);
  assert.ok(named, "the INCONCLUSIVE message must still name a declaration file at all");
  assert.equal(named[1], expected,
    "the message must name the file the gate resolves. This assertion fails if the BASELINE MOVES, not "
    + "only if the prose is reworded — which is the difference between fixing the instance and pinning "
    + "the class, and the whole reason this is a test rather than an edit");
  assert.ok(existsSync(resolve(REPO_ROOT, expected)),
    "and that file must exist, so a rename that updates both copies and forgets the file is still caught");
});

test("#1030 SWEEP: no path in lab-job.yml's operator-facing prose is one that nothing reads", () => {
  // EXISTENCE IS THE WRONG PREDICATE, and measuring it first is what showed why: 12 of 32 path-like tokens
  // here do not exist in a checkout, and ten of those are CORRECT — `runs/…` artefacts written at runtime
  // by code that names them. A sweep on existence reports eleven false positives and buries the one that
  // matters. The invariant this row is actually about is READERSHIP: prose that names a path no code in
  // the tree ever mentions is prose instructing an operator to edit a file nothing reads.
  const PATHISH = /\/?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g;
  const found = new Map<string, number>();
  LAB_JOB_YML.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(PATHISH)) {
      const path = match[0];
      if (path.startsWith("/")) continue; // an absolute system path (/usr/bin/npm) is not this repo's
      if (!found.has(path)) found.set(path, index + 1);
    }
  });
  assert.ok(found.size >= 20,
    `expected the sweep to find the file's many paths, found ${found.size} — a population this small `
    + "means the pattern stopped matching, not that the paths went away");
  // A FLOOR CANNOT TELL "THE PATTERN STILL MATCHES EVERYTHING" FROM "IT MATCHES 22 OF THE 31 IT USED TO".
  // Measured by worker-judge reviewing this PR: narrowing the pattern to require two directory segments
  // drops the population 31 -> 26, and three segments -> 22. Both clear a floor of 20 in silence, and the
  // shape they drop FIRST is the single-segment one — `runs/real-page-unexaminable.json`, the defect this
  // row exists for, and ten of the twelve the first sweep flagged. So the SHAPE is asserted, not only the
  // size, in both directions: the pattern must match a known single-segment token, and the real corpus
  // must still contain one.
  assert.ok(PATHISH.test("declare it in runs/real-page-unexaminable.json before re-running"),
    "POSITIVE CONTROL: the pattern must match a single-directory-segment path. A narrowing that stops "
    + "matching this shape is invisible to a count, and this shape is the one the row is about");
  PATHISH.lastIndex = 0; // `g` regexes carry state between `.test()` calls; a stale index is a false negative
  const singleSegment = [...found.keys()].filter((path) => path.split("/").length === 2);
  assert.ok(singleSegment.length > 0,
    `the corpus must still contain single-segment paths; found ${singleSegment.length} of ${found.size}. `
    + "Zero here means the pattern narrowed even though the total stayed healthy");

  const orphans = [...found].filter(([path]) => {
    if (existsSync(resolve(REPO_ROOT, path))) return false;
    // `git grep -F` over the tree MINUS this file: a path only ever spelled in this YAML is named by
    // nobody who could act on it. `--` with an exclude pathspec keeps lab-job.yml from vouching for itself.
    try {
      const readers = execFileSync("git",
        ["grep", "-l", "-F", path, "--", ":!packages/control/ansible/lab-job.yml"],
        { cwd: REPO_ROOT, encoding: "utf8", env: sandboxGitEnv(), stdio: ["ignore", "pipe", "pipe"] });
      return readers.split("\n").filter(Boolean).length === 0;
    } catch {
      return true; // git grep exits 1 on no match: nothing in the tree spells this path
    }
  });

  assert.deepEqual(orphans.map(([path, line]) => `${path} (line ${line})`), [],
    `examined ${found.size} distinct path-like tokens in lab-job.yml; these are absent from the tree AND `
    + "spelled nowhere else in it, so nothing reads them and an operator following them cannot succeed");
});
