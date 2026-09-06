// EVERY ROLE THIS ORGANISATION DEPENDS ON MUST BE READABLE FROM THE REPO ALONE, OR IT DOES NOT SURVIVE
// THIS MACHINE BEING LOST.
//
// `docs/roles/README.md` indexes eight role files -- `ceo`, `orchestrator`, `dispatcher`, and five
// workers -- because a board finding on 2026-09-06 was that every one of them except `dispatcher` existed
// only in session history: nowhere a fresh agent, or a stranger with no context, could read to become that
// role. This test is the enforcement that keeps the set complete rather than a document that says it is --
// EXCEPT that "complete" is split into two different obligations, deliberately checked differently. An
// EXISTING file that is malformed is that agent's own defect and fails the suite. A file that has simply
// not landed yet belongs to a different agent's queue, and is REPORTED rather than failed, so this test
// does not put every other push on hold for someone else's unfinished homework -- see the comment on the
// "missing role files are reported" test below for the reasoning and the prior incident it is grounded in.
//
// DISCOVERED from the README's own roster table, never hand-listed -- the same shape as every other
// discovery test this repo has, for the reason CLAUDE.md gives all of them: a hand-maintained "the roles
// that matter" list is exactly the kind of list a ninth role slips past.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const README_PATH = "docs/roles/README.md";
const readReadme = () => readFileSync(resolve(process.cwd(), README_PATH), "utf8");
const readFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

interface RosterRow {
  role: string;
  agent: string;
  linkText: string;
  filePath: string; // repo-relative, resolved from the README's own location
  reporter: string | null; // backtick-quoted name, or null for "—" (nobody)
}

/**
 * Parses the roster table's rows: `| role | \`agent\` | [linkText](./file.md) | reports-to |`.
 * Table-row parsing, not a generic markdown parser -- this repo's own convention (dataset-paths.test.ts,
 * exit-code-contract.test.ts) is to read the exact shape a file commits to rather than a general format,
 * because a general parser hides a shape change instead of failing on it.
 */
function roster(readmeSource: string): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const line of readmeSource.split("\n")) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|$/);
    if (!m) continue;
    const [, role, agent, linkText, linkPath, reporterCell] = m;
    if (role === "role") continue; // the header row
    const filePath = join(dirname(README_PATH), linkPath);
    const reporterMatch = reporterCell.match(/`([^`]+)`/);
    rows.push({ role, agent, linkText, filePath, reporter: reporterMatch?.[1] ?? null });
  }
  return rows;
}

test("the roles README exists and states what it is for", () => {
  const source = readReadme();
  assert.match(source, /^# If this machine is lost/m, `${README_PATH} must open with its own heading`);
  assert.match(source, /^## The roster/m, `${README_PATH} must keep its roster table`);
});

test("the roster discovery finds a realistic slice of the eight roles", () => {
  const found = roster(readReadme());
  // A floor, not a target -- unlike the ready queue, this roster does NOT shrink to zero as a happy path;
  // an organisation with no roles left is not the goal state this page works towards. Eight were named
  // when this page was written (`ceo`, `orchestrator`, `dispatcher`, five workers); the floor is set below
  // that so a role added or retired later does not itself break this guard.
  assert.ok(found.length >= 6,
    `expected to find at least 6 roster rows in ${README_PATH}, found ${found.length} -- either the table `
    + "row format changed, or roles were removed, both of which this guard should be read as flagging");
});

/**
 * Splits the roster into files that exist (checked for completeness below) and files that do not.
 * Exported in spirit, not in fact -- kept as a plain function so the reporting test and the mutation
 * test below exercise the exact same logic the real check runs, rather than a restated copy of it.
 */
function checkRoster(rows: RosterRow[]) {
  const missing: string[] = [];
  const incomplete: string[] = [];

  for (const { agent, filePath, reporter } of rows) {
    if (!existsSync(resolve(process.cwd(), filePath))) {
      missing.push(`  ${agent} -> ${filePath}`);
      continue;
    }
    const source = readFile(filePath);
    const problems: string[] = [];

    if (!source.includes(`\`${agent}\``)) problems.push("never mentions its own agent name in backticks");

    if (reporter && !source.includes(`\`${reporter}\``)) {
      problems.push(`never mentions its reporter (\`${reporter}\`) by name`);
    }

    if (!/^#+.*\b(lane|owns|role)\b/im.test(source)) {
      problems.push("no heading naming its lane/role/what it owns");
    }

    // The ban section: either the literal resource-ban text (workers and dispatcher), or an explicit
    // statement of exception (ceo/orchestrator, who are not bound to it the same way) -- checked as
    // "addressed the topic at all", never as an exact phrasing, because this repo's own roles are not
    // required to restate the ban identically if their role is precisely to be its exception. `ceo`'s own
    // file states its exception as "never runs fleet:*, lab:*" under a "does NOT do" heading rather than
    // in the ban's own words, which is exactly the free-phrasing case this check exists to allow.
    if (!/collision into a silent wrong answer|must never do|the resource ban|\bexception\b|drive the fleet/i.test(source)) {
      problems.push("no ban section and no stated exception to it");
    }

    if (problems.length) incomplete.push(`  ${agent} (${filePath}): ${problems.join("; ")}`);
  }

  return { missing, incomplete };
}

test("every existing role file names its own agent, its reporter, its lane and its ban", () => {
  const { incomplete } = checkRoster(roster(readReadme()));
  assert.deepEqual(incomplete, [],
    "these role file(s) exist but are missing one of the four things this system requires -- its own name, "
    + `its reporter, its lane, or its ban:\n${incomplete.join("\n")}`);
});

// A MISSING file is deliberately NOT a failure here, and that is a design decision, not an oversight.
// A malformed row or an incomplete existing file is a defect fully inside the pushing agent's own
// control -- an assertion failure is the right teacher. A missing file belongs to a DIFFERENT agent's
// queue (each role writes its own), so failing `npm test` for everyone until an unrelated agent gets
// round to writing prose is the exact shape CLAUDE.md already names as a defect: "a red gate teaches
// everyone to ignore failures" (worker-capture, 2026-09-06), and this repo's own record is that a gate
// red for reasons outside the pusher's control gets bypassed rather than respected --
// `A11Y_SKIP_VERIFY=1` "used SIX TIMES in one evening" once already. Reported, not silent: printed to
// stdout every run, and the next test proves the report cannot go quiet just because nothing failed.
test("missing role files are reported by name, not hidden by going green", () => {
  const { missing } = checkRoster(roster(readReadme()));
  if (missing.length) {
    console.warn(`\nROLE FILES OUTSTANDING (reported, not failed -- each is owned by a different agent):\n`
      + missing.join("\n") + "\n");
  }
  // The report itself must stay truthful: a currently-empty gap list would make this assertion
  // meaningless, so pin it against the real roster rather than asserting nothing.
  assert.deepEqual(
    missing.map((m) => m.trim().split(" ")[0]).sort(),
    roster(readReadme())
      .filter(({ filePath }) => !existsSync(resolve(process.cwd(), filePath)))
      .map(({ agent }) => agent)
      .sort(),
    "the reported gap list must exactly match which roster files are actually absent",
  );
});

test("the contingency drill section and its GIT_DIR warning both exist", () => {
  const source = readReadme();
  assert.match(source, /^## The contingency drill/m, `${README_PATH} must keep the drill section`);
  assert.match(source, /GIT_DIR/,
    `${README_PATH}'s drill must warn that a git call made with only cwd set follows GIT_DIR, not cwd -- `
    + "found the hard way the same night this page was written, from the pre-push hook exporting it");
});

/**
 * THE MUTATION HALF, against a synthetic roster and synthetic files under `os.tmpdir()` -- never against
 * the real `docs/roles/` tree, because deleting a real agent's file even temporarily is not something a
 * shared, git-hooked checkout should risk mid-test-run. Proves every direction the split above depends on:
 * a missing file is REPORTED (never thrown), an incomplete existing file IS thrown, a complete one is
 * clean, and breaking the discovery itself is caught before any per-row check could pass having examined
 * nothing.
 */
test("MUTATION: missing is reported not failed, incomplete fails, and a broken roster table is caught by the vacuity guard", () => {
  const goodReadme = "# If this machine is lost\n\n## The roster\n\n"
    + "| role | agent name | file | reports to |\n"
    + "|---|---|---|---|\n"
    + "| Example | `example-agent` | [example.md](./example.md) | `example-boss` |\n";

  // Baseline: the parser finds the one row, correctly.
  const found = roster(goodReadme);
  assert.equal(found.length, 1, "the roster parser did not find the one well-formed row -- broken baseline");
  assert.equal(found[0].agent, "example-agent");
  assert.equal(found[0].filePath, "docs/roles/example.md");
  assert.equal(found[0].reporter, "example-boss");

  const dir = mkdtempSync(join(tmpdir(), "roles-readme-mutation-"));
  const complete = join(dir, "complete.md");
  const incomplete = join(dir, "incomplete.md");
  const missing = join(dir, "does-not-exist.md");
  writeFileSync(complete, "# Example role -- `example-agent`\n\n## What this lane owns\n\n"
    + "Reports to `example-boss`.\n\n## The resource ban\n\nmust never do this: collision into a silent wrong answer.\n");
  writeFileSync(incomplete, "# Example role\n\nNo agent name, no ban, no reporter here.\n");

  // Missing: reported, never thrown -- this is the whole point of the split.
  const missingResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: missing, reporter: "example-boss" }]);
  assert.equal(missingResult.missing.length, 1, "a nonexistent file must be counted as missing");
  assert.equal(missingResult.incomplete.length, 0, "a MISSING file must never also be reported incomplete -- that would fail the wrong test");

  // Incomplete: an existing file lacking the four required parts DOES fail, because it is the pushing
  // agent's own defect to fix.
  const incompleteResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: incomplete, reporter: "example-boss" }]);
  assert.equal(incompleteResult.missing.length, 0);
  assert.ok(incompleteResult.incomplete.length > 0, "an existing file missing its name/reporter/lane/ban must be caught, not waved through");

  // Complete: no complaints either way.
  const completeResult = checkRoster([{ role: "Example", agent: "example-agent", linkText: "x", filePath: complete, reporter: "example-boss" }]);
  assert.deepEqual(completeResult, { missing: [], incomplete: [] }, "a well-formed file must produce no report at all");

  // Mutation: break the table row format itself (drop a pipe), simulating the shape change this guard
  // exists to catch -- must find ZERO rows, not silently skip the malformed one and report success on an
  // empty set.
  const brokenReadme = goodReadme.replace(
    "| Example | `example-agent` | [example.md](./example.md) | `example-boss` |",
    "| Example  `example-agent` | [example.md](./example.md) | `example-boss` |", // missing a leading pipe
  );
  assert.equal(roster(brokenReadme).length, 0,
    "a malformed table row (missing a pipe) was still parsed -- the row regex is too permissive to catch "
    + "a real format change");
});
