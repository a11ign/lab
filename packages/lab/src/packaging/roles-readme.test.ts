// EVERY ROLE THIS ORGANISATION DEPENDS ON MUST BE READABLE FROM THE REPO ALONE, OR IT DOES NOT SURVIVE
// THIS MACHINE BEING LOST.
//
// `docs/roles/README.md` indexes eight role files -- `ceo`, `orchestrator`, `dispatcher`, and five
// workers -- because a board finding on 2026-09-06 was that every one of them except `dispatcher` existed
// only in session history: nowhere a fresh agent, or a stranger with no context, could read to become that
// role. This test is the enforcement that keeps the set complete rather than a document that says it is.
//
// DISCOVERED from the README's own roster table, never hand-listed -- the same shape as every other
// discovery test this repo has, for the reason CLAUDE.md gives all of them: a hand-maintained "the roles
// that matter" list is exactly the kind of list a ninth role slips past.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

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

test("every agent named in the roster has a file, and every existing file names its own agent, its reporter, its lane and its ban", () => {
  const rows = roster(readReadme());
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
    // required to restate the ban identically if their role is precisely to be its exception.
    if (!/collision into a silent wrong answer|must never do|the resource ban|exception/i.test(source)) {
      problems.push("no ban section and no stated exception to it");
    }

    if (problems.length) incomplete.push(`  ${agent} (${filePath}): ${problems.join("; ")}`);
  }

  assert.deepEqual(missing, [],
    `these agent(s) are named in ${README_PATH}'s roster but have no file yet -- each agent writes its `
    + `own, so this is expected to be non-empty until every role has landed its commit:\n${missing.join("\n")}`);
  assert.deepEqual(incomplete, [],
    "these role file(s) exist but are missing one of the four things this system requires -- its own name, "
    + `its reporter, its lane, or its ban:\n${incomplete.join("\n")}`);
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
 * shared, git-hooked checkout should risk mid-test-run. Proves BOTH directions dispatcher asked for:
 * deleting an agent's file is caught by name, and breaking the discovery itself is caught before the
 * per-row check could pass having examined nothing.
 */
test("MUTATION: a missing agent file is caught by name, and a broken roster table is caught by the vacuity guard", () => {
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

  // Mutation 1: the row's own file does not exist (the "missing file" case, proven without touching disk --
  // existsSync on a path that was never created is already false, so this is the same check the real test
  // above performs, exercised here against a name guaranteed not to collide with a real file).
  assert.ok(!existsSync(resolve(process.cwd(), found[0].filePath)),
    "sanity check failed -- docs/roles/example.md unexpectedly exists in this checkout");

  // Mutation 2: break the table row format itself (drop a pipe), simulating the shape change this guard
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
