/**
 * A PATH FILTER IS A WAY TO NOT RUN A TEST, and this repo has already paid for one nobody checked.
 *
 * `capture-regression.yml` was filtered to `packages/lab/src/capture/**` and therefore did not fire for
 * changes under `packages/lab/src/training/**` — *"which is exactly where the guard bug lived"*. That is
 * not a CI configuration detail: it is a suite with a hole in it, reporting green. #70 asks for the
 * standing version of that check before the repository is split by layer, on the grounds that the failure
 * mode of the split is arriving at it having never practised.
 *
 * ## What this asserts, and why the order matters
 *
 * **1. An UNFILTERED backstop must exist.** Today `lint.yml` has no `paths:` at all and runs the whole
 * suite on every push to `main`/`agent/**`/`lead/**` and every PR, so every source directory is reachable
 * and no filter below can currently hide anything. That is the load-bearing fact, and it is invisible:
 * nothing said it, so adding `paths:` to `lint.yml` would have looked like an optimisation and would have
 * silently made every other filter's exclusions real.
 *
 * **2. Every FILTERED workflow must say what it excludes and why.** A filter is a claim that the excluded
 * paths cannot affect this gate's verdict, and that claim is exactly what was wrong before. A comment is
 * required rather than suggested, in the same spirit as every EXEMPT table in this repo: a bare list of
 * globs is a decision nobody can review.
 *
 * **3. Reachability is asserted CONDITIONALLY, and that is deliberate rather than weak.** While an
 * unfiltered backstop exists, "every source directory is reachable" is true by construction and asserting
 * it directly would pass having examined nothing — the vacuity this repo pays for most. So the assertion
 * is: *if the backstop goes away, every source directory must be named by some workflow's filter.* It does
 * no work today and becomes a hard gate at the exact moment path-filtered CI lands, which is what #70 is
 * rehearsing for. The set is computed either way, so the failure names directories rather than a count.
 *
 * Publishing workflows (`board-report`, `board-summary-check`, `board-liveness`, `release`) are NOT gates
 * and are excluded by name with a reason: they run on a schedule or a push to deliver something, and
 * requiring them to cover source directories would be requiring the wrong thing of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS = join(REPO, ".github/workflows");

/**
 * Workflows that deliver something rather than judging a change. A reason each, never a bare name —
 * this list is the one place the guard can be quietly disabled.
 */
const NOT_A_GATE: Record<string, string> = {
  "board-report.yml": "publishes the daily board edition on a schedule; it judges no change and its "
    + "trigger is the clock, so covering a source directory is not a thing it could mean.",
  "board-summary-check.yml": "the 21:00 warning that tomorrow's executive summary is unwritten — a "
    + "scheduled reminder about a document, not a gate over source.",
  "board-liveness.yml": "asks whether the board editions are still arriving. It runs on push precisely "
    + "because a scheduled watchdog is disabled by the inactivity it watches for, and it examines the "
    + "issue tracker rather than the diff.",
  "release.yml": "publishes. It is triggered deliberately and its own gate chain is `release:gate:ci`, "
    + "not a path filter over the change that happens to be at HEAD.",
  "changeset-check.yml": "asks whether a change carries a changeset — a question about the PR's "
    + "metadata, not about which source it touched.",
};

const workflowFiles = (): string[] =>
  readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

const gateFiles = (): string[] => workflowFiles().filter((f) => !NOT_A_GATE[f]);

const read = (file: string) => readFileSync(join(WORKFLOWS, file), "utf8");

/** The `paths:`/`paths-ignore:` globs a workflow declares, across every trigger it has. */
export function pathFilters(source: string): string[] {
  const globs: string[] = [];
  for (const match of source.matchAll(/^\s*paths(?:-ignore)?:\s*$((?:\n\s*[-#].*)*)/gm)) {
    for (const line of match[1].split("\n")) {
      const glob = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
      if (glob) globs.push(glob[1].trim());
    }
  }
  return globs;
}

/** Does this workflow run on every change, with no path filter at all? */
const isUnfiltered = (source: string) => !/^\s*paths(?:-ignore)?:/m.test(source);

/**
 * Words that mark a comment as being ABOUT the filter rather than about the workflow.
 *
 * NOT "has a comment before `jobs:`", which is what the first version of this asked and it was wrong in
 * both directions. It flagged `ansible-check.yml`, whose reasoning — *"Path-filtered: nothing else in
 * this repo depends on the fleet's Ansible layer"* — sits in the file header ABOVE `name:` rather than
 * inside the trigger block; and it would have passed `action-smoke.yml`, whose long header explains what
 * the workflow is FOR and says nothing about what it excludes. A correct method against the wrong
 * question, which is the shape this repo names most often.
 *
 * So the check is about the CONTENT of the reasoning and not its position. Anywhere before `jobs:` is
 * fine — this asks for a decision to be argued, not for a house style.
 */
const FILTER_REASONING = /path[- ]?filter|paths:|filtered|exclud|only runs|doc-only|spend .*minutes/i;

const explainsItsFilter = (source: string): boolean => {
  const header = source.slice(0, source.indexOf("jobs:"));
  return header.split("\n").filter((line) => line.trim().startsWith("#") || line.includes(" #"))
    .some((line) => FILTER_REASONING.test(line));
};

// Every directory a change could land in: each package's `src` and `scripts`, plus the repo's own
// `scripts/`. Written as a line comment because the glob it describes contains `*` followed by `/`, which
// closes a block comment — the same shape as the backtick-in-a-template-literal this repo already pins
// with `mjs-parses.test.ts`, and caught the same way: by the file refusing to parse.
function sourceDirectories(): string[] {
  const dirs: string[] = [];
  for (const pkg of readdirSync(join(REPO, "packages"), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    for (const sub of ["src", "scripts"]) {
      if (existsSync(join(REPO, "packages", pkg.name, sub))) dirs.push(`packages/${pkg.name}/${sub}`);
    }
  }
  dirs.push("scripts");
  return dirs.sort();
}

/** A glob covers a directory when it names it or any prefix of it. Negations (`!…`) never cover. */
function covers(glob: string, dir: string): boolean {
  if (glob.startsWith("!")) return false;
  const stem = glob.replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "");
  return stem !== "" && (dir === stem || dir.startsWith(`${stem}/`) || stem.startsWith(`${dir}/`));
}

test("the discovery finds the workflows and the source tree, so this cannot pass having read nothing", () => {
  assert.ok(workflowFiles().length >= 6,
    `found ${workflowFiles().length} workflow file(s); .github/workflows moved or the extension filter is wrong`);
  assert.ok(sourceDirectories().length >= 8,
    `found ${sourceDirectories().length} source director(ies); the packages/*/src walk is broken`);
  assert.ok(gateFiles().length >= 2,
    "every workflow was classified as not-a-gate -- the guard would then assert nothing at all");
});

test("an UNFILTERED gate exists, and it is what makes every other filter's exclusions harmless", () => {
  // THE LOAD-BEARING FACT NOBODY HAD WRITTEN DOWN. `lint.yml` carries no `paths:`, so it runs on every
  // push and PR and no filtered workflow can currently hide a directory. Adding `paths:` to it would look
  // like an optimisation and would silently make every exclusion below real -- including the one that
  // already cost this project a guard bug.
  const unfiltered = gateFiles().filter((file) => isUnfiltered(read(file)));
  assert.ok(unfiltered.length > 0,
    "no gate workflow runs without a path filter any more. That is a real architectural change and it may "
    + "be the right one -- but it means every `paths:` list in .github/workflows is now load-bearing, and "
    + "the test below stops being conditional. Read it before removing this assertion.");
});

test("every path-FILTERED gate says what it excludes and why", () => {
  // A filter is a claim that the excluded paths cannot change this gate's verdict, and that claim is
  // precisely what was wrong about capture-regression.yml. A bare list of globs is a decision nobody can
  // review; the requirement is the same one every EXEMPT table in this repo carries.
  const undocumented = gateFiles()
    .filter((file) => !isUnfiltered(read(file)))
    .filter((file) => !explainsItsFilter(read(file)));
  assert.deepEqual(undocumented, [],
    "these workflows filter by path and explain nothing about the exclusion:\n"
    + undocumented.map((f) => `  .github/workflows/${f}`).join("\n")
    + "\n\nA path filter is a way to NOT RUN A TEST. `capture-regression.yml` was filtered to "
    + "packages/lab/src/capture/** and so did not fire for packages/lab/src/training/**, which is exactly "
    + "where the guard bug lived. Say what is excluded and why that is safe.");
});

test("IF the unfiltered backstop goes away, every source directory must be named by some filter", () => {
  // CONDITIONAL ON PURPOSE. While an unfiltered gate exists this is true by construction, and asserting
  // it directly would be a check passing having examined nothing -- the vacuity this repo pays for most.
  // Written this way it does no work today and becomes a hard gate at the moment path-filtered CI lands,
  // which is the whole of what #70 is rehearsing.
  const filtered = gateFiles().filter((file) => !isUnfiltered(read(file)));
  const globs = filtered.flatMap((file) => pathFilters(read(file)));
  const unreachable = sourceDirectories().filter((dir) => !globs.some((glob) => covers(glob, dir)));

  const backstop = gateFiles().filter((file) => isUnfiltered(read(file)));
  if (backstop.length > 0) {
    // Not skipped silently: say which directories are riding on the backstop, so the cost of removing it
    // is visible BEFORE somebody removes it rather than in the incident afterwards.
    if (unreachable.length) {
      process.stdout.write(`\n  ${unreachable.length} source director(ies) are covered ONLY by the `
        + `unfiltered gate(s) ${backstop.join(", ")}:\n${unreachable.map((d) => `    ${d}\n`).join("")}`);
    }
    return;
  }

  assert.deepEqual(unreachable, [],
    "no unfiltered gate remains, so these source directories are now reachable by NO workflow -- a change "
    + "to any of them runs nothing and reports green:\n"
    + unreachable.map((d) => `  ${d}`).join("\n"));
});

test("PROOF: the glob matcher covers a directory, and a negation never does", () => {
  // The matcher is the whole of the check above, and today it runs against a population the backstop
  // makes empty. Driven directly so it is exercised whatever the workflows happen to contain.
  assert.ok(covers("packages/lab/**", "packages/lab/src"), "a ** glob must cover directories beneath it");
  assert.ok(covers("packages/lab/src/training/**", "packages/lab/src"),
    "a glob DEEPER than the directory still means a change in that directory can trigger the workflow");
  assert.ok(!covers("packages/judge/**", "packages/lab/src"), "an unrelated package must not count");
  assert.ok(!covers("!packages/nvda-worker/**/*.md", "packages/nvda-worker/src"),
    "a NEGATION excludes; reading it as coverage would count an exclusion as protection, which is the "
    + "capture-regression defect written into the matcher itself");
});

test("PROOF: pathFilters reads a real trigger block and ignores trailing comments", () => {
  const source = [
    "on:",
    "  push:",
    "    paths:",
    '      - "packages/nvda-worker/**"',
    '      - "!packages/nvda-worker/**/*.md" # doc-only edits shouldn\'t spend Windows minutes',
    "jobs:",
  ].join("\n");
  assert.deepEqual(pathFilters(source),
    ["packages/nvda-worker/**", "!packages/nvda-worker/**/*.md"]);
  assert.deepEqual(pathFilters("on:\n  push:\n    branches: [main]\njobs:"), [],
    "a workflow with no paths: must yield no globs, or an unfiltered gate would read as filtered");
});
