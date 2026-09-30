// no-token: GH_TOKEN
// #2792: this file holds auto-arm.yml's TEXT as a record and runs its `run:` script under bash against a fake `gh` on PATH; the literal
// `GH_TOKEN` is the variable that script exports, and the file never reads or sends a token. Without this the token-less acceptance job
// refuses the row's own Acceptance command and verifies nothing.
/**
 * #2792 (child 5a of #2623): WHAT `a11ign/agent-org` WAS BOOTSTRAPPED WITH, AS A CHECKED RECORD.
 *
 * ADR 0040 decision 6 step 2 said the first commit of `agent-org` carries the leak scan and the PR template. It could not: the pushed
 * history is a `filter-repo` of `packages/agent-org/`, and those files never lived under that path, so `a11ign/agent-org` had no `.github`
 * at all and #2623's Done-when 1 (the first pull request arms with `A11IGN_BOT_TOKEN`, its `auto-arm` log names the path) was unreadable
 * for want of a workflow to arm or to log. The first pull request into that repository adds `.github/`, and its files are recorded HERE,
 * byte for byte, because the repository they land in is outside this checkout and nothing in this one would otherwise notice them change.
 *
 * WHAT THE RECORD IS, AND IS NOT. It is the bootstrap as opened, not a mirror: a later change in `agent-org` does not move this file, and
 * this file does not stop one. What it pins is the SHAPE the bootstrap was accepted in, run through the scripts the workflows call:
 *
 *   1. every path a workflow names exists in `agent-org`'s tree (a fixture tree below stands in for it) -- and a workflow naming one the
 *      fixture lacks is REFUSED, naming it, including the shape that motivated the check: a product path (`packages/agent-org/src/...`)
 *      copied out of `a11ign/a11ign`;
 *   2. `auto-arm.yml` arms with `A11IGN_BOT_TOKEN` when the secret is present, falls back to `GITHUB_TOKEN` when it is not, and its log line
 *      names which one ran (read by driving the workflow's own `run:` script, not by grepping it);
 *   3. the `gate` job runs the leak scan, and the scan refuses a private LAN IPv4 address (positive control: a fixture body carrying one).
 *
 * WHAT `gate` DOES NOT RUN is the tool's own test suite, and `ci.yml`'s header says why with the reading: the tool reads
 * `.agent-org/project.json` from a project checkout it is pointed at and its repository is not one, so the suite is red there until
 * decision 8's fixture project lands. That is not this file's to fix and not this row's; it is named so the record does not read as
 * "the tool is tested in its own repository".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const TOOL_SOURCE = `${REPO}packages/agent-org/src/`;
const SCRIPT_TIMEOUT_MS = 30_000;
const EXECUTABLE = 0o755;

// The two files the leak scan imports, taken from THIS repository's copy: `agent-org`'s own `src/lib/leak-patterns.mjs` is the same bytes at
// its first commit (265c9d8), which is what makes running the scan here a reading of the scan it will run there.
const TOOL_FILES_THE_SCAN_IMPORTS = ["project-config.mjs", "lib/leak-patterns.mjs"];

/** `.github/workflows/ci.yml`, byte for byte as the pull request carries it. */
const CI_WORKFLOW = `name: ci

# THE REQUIRED CHECK IS \`gate\` (a11ign/a11ign#2792; ADR 0040 decision 6 step 6). A check name can be required only after it has run once,
# and this file's first pull request is that run.
#
# WHAT \`gate\` DOES NOT RUN, ON PURPOSE: the tool's own test suite. Measured on the first commit of this repository (265c9d8, run with
# tsx over every src/**/*.test.ts): 158 of 464 subtests failed and 60 of 125 modules did not import, all for the same reason -- the tool
# reads \`.agent-org/project.json\` from a project checkout it is pointed at, and this repository is not one. The suite becomes runnable
# here when the fixture project of ADR 0040 decision 8 lands; until then a step running it would be red on every pull request, and a
# gate people learn to ignore is worse than a narrower one. What \`gate\` checks is what the bootstrap can be held to today.

on:
  pull_request:
    branches: [main]
  # A merge queue tests the queue's merge commit and waits for a check reporting on THIS event; without it a queued pull request never merges.
  merge_group:

permissions:
  contents: read

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Every path a workflow names exists in this repository
        run: node .github/scripts/workflow-paths.mjs
      - name: Leak scan -- refuses a private LAN IPv4 address or a named SSH key file anywhere in the tree
        run: node .github/scripts/leak-scan.mjs
`;

/** `.github/workflows/auto-arm.yml`, byte for byte as the pull request carries it. */
const AUTO_ARM_WORKFLOW = `name: auto-arm

# ENABLE AUTO-MERGE ON EVERY NON-DRAFT PULL REQUEST AGAINST main, so nobody arms by hand (pared from a11ign/a11ign's auto-arm.yml,
# a11ign/a11ign#2792). Arming only ARMS the merge: GitHub still withholds it until the required check \`gate\` is green and the ruleset's
# approving review is present for the current head.
#
# WHICH TOKEN ARMS MATTERS, AND THE LOG SAYS WHICH RAN. GitHub does not trigger workflows from events created with GITHUB_TOKEN, so a merge
# completed with it fires no \`pull_request: closed\` and no \`push\` (measured on a11ign/a11ign: 19 of 19 bot merges never ran close-rows). A
# merge armed with A11IGN_BOT_TOKEN is attributed to that identity and fires them. When the secret is absent this arms with GITHUB_TOKEN and
# prints a warning; the first \`AUTO-ARM:\` line of a run is the reading of which path ran (a11ign/a11ign#2623 Done-when 1).
#
# NOT COPIED, AND WHY: the sweep, the stalled report and update-branch jobs of the original call a11ign's own scripts and need its board; this
# repository holds only the tool. They are added when something here needs them, not before.

on:
  pull_request:
    branches: [main]
    types: [opened, ready_for_review, reopened, synchronize]

permissions:
  pull-requests: write
  contents: write

jobs:
  arm:
    # A fork's pull request gets no secrets and a read-only token, so arming it would only fail; a fork's change is armed by a maintainer.
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - name: Enable auto-merge (merge commit)
        env:
          A11IGN_BOT_TOKEN: \${{ secrets.A11IGN_BOT_TOKEN }}
          FALLBACK_TOKEN: \${{ github.token }}
          PULL_REQUEST: \${{ github.event.pull_request.number }}
          REPOSITORY: \${{ github.repository }}
        run: |
          if [ -n "$A11IGN_BOT_TOKEN" ]; then
            export GH_TOKEN="$A11IGN_BOT_TOKEN"
            token_name=A11IGN_BOT_TOKEN
          else
            echo "::warning::A11IGN_BOT_TOKEN is not set -- arming with GITHUB_TOKEN instead. A merge completed with it fires no workflow events."
            export GH_TOKEN="$FALLBACK_TOKEN"
            token_name=GITHUB_TOKEN
          fi
          echo "AUTO-ARM: arming #\${PULL_REQUEST} in \${REPOSITORY} with \${token_name}"
          gh pr merge "$PULL_REQUEST" --repo "$REPOSITORY" --auto --merge
`;

/** `.github/scripts/leak-scan.mjs`, byte for byte as the pull request carries it. */
const LEAK_SCAN_SCRIPT = `// @ts-check
// THE LEAK SCAN \`gate\` RUNS (#2792, ADR 0040 decision 6 step 2; a11ign/a11ign#2623). This repository is PUBLIC, so what is committed here is
// published. The scan reads the tool's OWN generic patterns (\`src/lib/leak-patterns.mjs\`: a private LAN IPv4 address, a named SSH private key
// file) over every file in the tree and REFUSES on a hit, naming the file and the value. It deliberately does not call \`allLeaksIn\`, which reads
// a project's declaration (\`.agent-org/project.json\`) that this repository does not hold: the tool is configured by the project that runs it.
//
// Usage: node .github/scripts/leak-scan.mjs [--root=<dir>]   (default: the current directory)
// Exit:  0 = clean, 1 = a leak was found, 2 = the scan could not examine anything (an empty scan is not a clean one).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GENERIC_LEAK_PATTERNS } from "../../src/lib/leak-patterns.mjs";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

// A (file, value) exemption, never a value-class one: the same value appearing in a NEW file is still a leak. The one entry is a fixture that
// exists to prove the tool REFUSES an SSH key path, so it has to contain one. The value is assembled from parts so this file does not itself
// carry the contiguous string the pattern matches.
const EXEMPT = Object.freeze([
  { file: "src/packaging/tracker-leak-refusal.test.ts", value: ["~/.ssh/", "a11y-fixture", "_ed25519"].join("") },
]);

/** @param {string} root @returns {string[]} every file under \`root\`, relative to it, in a stable order */
function filesUnder(root) {
  const found = [];
  const visit = (/** @type {string} */ directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) visit(join(directory, entry.name));
      else if (entry.isFile()) found.push(relative(root, join(directory, entry.name)));
    }
  };
  visit(root);
  return found.sort();
}

/** @param {string} file @param {string} value */
function isExempt(file, value) {
  return EXEMPT.some((entry) => entry.file === file && entry.value === value);
}

/** @param {string} text @returns {Array<{ name: string; value: string }>} matches in text collapsed so a hard-wrapped line cannot hide one */
function leaksIn(text) {
  const collapsed = text.replace(/\\s+/g, " ");
  return GENERIC_LEAK_PATTERNS.flatMap(({ name, pattern }) =>
    [...collapsed.matchAll(new RegExp(pattern.source, "g"))].map((match) => ({ name, value: match[0] })));
}

/** @param {string} root @returns {{ scanned: number; leaks: string[] }} */
export function scan(root) {
  let scanned = 0;
  const leaks = [];
  for (const file of filesUnder(root)) {
    const text = readFileSync(join(root, file), "utf8");
    if (text.includes("\\0")) continue;
    scanned += 1;
    for (const { name, value } of leaksIn(text)) {
      if (!isExempt(file, value)) leaks.push(\`LEAK: \${file}: \${name}: \${value}\`);
    }
  }
  return { scanned, leaks };
}

function main() {
  const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) ?? process.cwd();
  const { scanned, leaks } = scan(root);
  if (scanned === 0) {
    console.error(\`CANNOT_ASK: no file under \${root} was examined, so "no leaks" would mean nothing\`);
    process.exit(2);
  }
  for (const line of leaks) console.error(line);
  if (leaks.length > 0) process.exit(1);
  console.log(\`leak scan: \${scanned} files examined, 0 leaks\`);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href) main();
`;

/** `.github/scripts/workflow-paths.mjs`, byte for byte as the pull request carries it. */
const WORKFLOW_PATHS_SCRIPT = `// @ts-check
// EVERY PATH A WORKFLOW NAMES MUST EXIST IN THIS REPOSITORY (#2792, a11ign/a11ign#2623). This repository was extracted from a product's
// \`packages/agent-org/\` by a history rewrite, so a workflow copied from that product can name a path that only ever lived beside it
// (\`packages/agent-org/src/...\`, \`scripts/...\`) and would fail at run time, or worse, be skipped. This check reads each workflow's text for
// paths under the directories this repository has and refuses one that is not there, naming it.
//
// Usage: node .github/scripts/workflow-paths.mjs [--root=<dir>]   (default: the current directory)
// Exit:  0 = every named path exists, 1 = a workflow names one that does not, 2 = nothing was examined.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = ".github/workflows";
// The top-level directories a path is CLAIMED under: this repository's own, then the ones only the product has. The second group is the point
// of the check -- a copied workflow that says \`packages/agent-org/src/arm-pr.mjs\` names a directory that does not exist here, so it must be
// caught as a missing path and not skipped as "not one of ours". A directory in neither list is not a claim about any tree and is ignored.
const OWN_DIRECTORIES = ["\\\\.github", "src", "host"];
const PRODUCT_ONLY_DIRECTORIES = ["packages", "scripts", "docs"];
const NAMED_PATH = new RegExp(\`(?<![\\\\w./-])((?:\${[...OWN_DIRECTORIES, ...PRODUCT_ONLY_DIRECTORIES].join("|")})/[\\\\w./-]*\\\\w)\`, "g");

/** @param {string} text @returns {string[]} */
export function pathsNamedIn(text) {
  return [...new Set([...text.matchAll(NAMED_PATH)].map((match) => match[1] ?? ""))];
}

/** @param {string} root @returns {{ examined: number; named: number; missing: string[] }} */
export function check(root) {
  const workflowDirectory = join(root, WORKFLOWS);
  const files = existsSync(workflowDirectory) ? readdirSync(workflowDirectory).filter((name) => /\\.ya?ml$/.test(name)).sort() : [];
  const missing = [];
  let named = 0;
  for (const file of files) {
    for (const path of pathsNamedIn(readFileSync(join(workflowDirectory, file), "utf8"))) {
      named += 1;
      if (!existsSync(join(root, path))) missing.push(\`MISSING PATH: \${WORKFLOWS}/\${file} names \${path}, which is not in this repository\`);
    }
  }
  return { examined: files.length, named, missing };
}

function main() {
  const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) ?? process.cwd();
  const { examined, named, missing } = check(root);
  if (examined === 0 || named === 0) {
    console.error(\`CANNOT_ASK: \${examined} workflow files and \${named} named paths under \${root}; a check that finds nothing has verified nothing\`);
    process.exit(2);
  }
  for (const line of missing) console.error(line);
  if (missing.length > 0) process.exit(1);
  console.log(\`workflow paths: \${examined} workflows, \${named} paths named, all present\`);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href) main();
`;

/** `.github/PULL_REQUEST_TEMPLATE.md`, byte for byte as the pull request carries it. */
const PULL_REQUEST_TEMPLATE = `<!--
This repository holds the agent-org tool only. \`gate\` (ci.yml) runs a path check over the workflows and a leak scan over the
whole tree; it does NOT run the tool's test suite yet (see the header of ci.yml for why), so what you ran is what tells the reviewer
the change works. The repository is PUBLIC: nothing in this body or the diff may carry a private address, a key path or a token.
-->

Row: a11ign/a11ign#

## What changes, and why

<!-- The why matters more than the what; the diff shows the what. -->

## How you verified it

<!-- The command and what it printed. A number without its command is a claim, not a reading. -->

## Anything a reviewer should be sceptical of

<!-- An assumption you could not check, a path you could not test. -->
`;

/** `.github/CODEOWNERS`, byte for byte as the pull request carries it. */
const CODEOWNERS_FILE = `# Who must look at a change to how this repository builds, gates and merges. The team holds admin on the repository.
/.github/ @a11ign/bots
`;

/** The bootstrap: repository-relative path -> the file as the pull request carries it. */
const BOOTSTRAP: Record<string, string> = {
  ".github/workflows/ci.yml": CI_WORKFLOW,
  ".github/workflows/auto-arm.yml": AUTO_ARM_WORKFLOW,
  ".github/scripts/leak-scan.mjs": LEAK_SCAN_SCRIPT,
  ".github/scripts/workflow-paths.mjs": WORKFLOW_PATHS_SCRIPT,
  ".github/PULL_REQUEST_TEMPLATE.md": PULL_REQUEST_TEMPLATE,
  ".github/CODEOWNERS": CODEOWNERS_FILE,
};

// The fixture that must carry an SSH key path because it exists to prove the tool refuses one. Assembled from parts so THIS file does not
// carry the contiguous string a leak guard over this repository would match.
const EXEMPT_FIXTURE_PATH = "src/packaging/tracker-leak-refusal.test.ts";
const EXEMPT_VALUE = ["~/.ssh/", "a11y-fixture", "_ed25519"].join("");

/** The rest of `a11ign/agent-org`'s tree at 265c9d8 that the bootstrap's checks reach or that stand for it: not its 275 files, the ones that matter here. */
const AGENT_ORG_TREE_BESIDES_THE_BOOTSTRAP = ["LICENSE", "package.json", "host/gh", "src/wake.mjs", EXEMPT_FIXTURE_PATH,
  ...TOOL_FILES_THE_SCAN_IMPORTS.map((file) => `src/${file}`)];

/** Three ranges of private IPv4, each built at run time so no literal address sits in this file. */
const LAN_ADDRESSES = [["10", "20", "30", "40"], ["172", "16", "5", "9"], ["192", "168", "7", "9"]].map((octets) => octets.join("."));

/** Write `agent-org`'s fixture tree (plus `extra`) into a scratch directory, run `use` on it, and always remove it. */
function withTree<T>(extra: Record<string, string>, use: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "agent-org-bootstrap-"));
  try {
    for (const path of AGENT_ORG_TREE_BESIDES_THE_BOOTSTRAP) write(root, path, "// stands in for the file of that name\n");
    write(root, EXEMPT_FIXTURE_PATH, `// carries the value it exists to prove is refused: ${EXEMPT_VALUE}\n`);
    for (const file of TOOL_FILES_THE_SCAN_IMPORTS) copyFileSync(`${TOOL_SOURCE}${file}`, join(root, "src", file));
    for (const [path, text] of Object.entries({ ...BOOTSTRAP, ...extra })) write(root, path, text);
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Run one of the bootstrap's scripts, from the tree it was written into, against that tree. */
function run(root: string, script: string) {
  return spawnSync(process.execPath, [join(root, ".github/scripts", script), `--root=${root}`], { encoding: "utf8", timeout: SCRIPT_TIMEOUT_MS });
}

// ---- 1. every path a workflow names exists in agent-org's tree ----------------------------------------------

test("every path the bootstrap's workflows name exists in agent-org's tree", () => {
  const result = withTree({}, (root) => run(root, "workflow-paths.mjs"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /workflow paths: 2 workflows, [1-9]\d* paths named, all present/);
});

test("control: a workflow naming a path the tree lacks is REFUSED, naming the workflow and the path", () => {
  const named = "src/arm-pr-that-is-not-there.mjs";
  const result = withTree({ ".github/workflows/copied.yml": `jobs:\n  x:\n    steps:\n      - run: node ${named}\n` },
    (root) => run(root, "workflow-paths.mjs"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`\\.github/workflows/copied\\.yml names ${named.replace(/\./g, "\\.")}`));
});

test("control: the shape that motivated the check -- a PRODUCT path copied out of a11ign -- is REFUSED, not skipped as 'not ours'", () => {
  const named = "packages/agent-org/src/arm-pr.mjs";
  const result = withTree({ ".github/workflows/copied.yml": `      - run: node ${named} --pr=1\n` }, (root) => run(root, "workflow-paths.mjs"));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(named), result.stderr);
});

test("control: a tree with no workflows is CANNOT_ASK (exit 2), never a clean pass", () => {
  const result = withTree({}, (root) => {
    rmSync(join(root, ".github/workflows"), { recursive: true });
    return run(root, "workflow-paths.mjs");
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CANNOT_ASK/);
});

// ---- 2. auto-arm arms with A11IGN_BOT_TOKEN and its log names which token ran -------------------------------

type Step = { env?: Record<string, string>; run?: string };
const autoArm = parseYaml(AUTO_ARM_WORKFLOW) as { on: { pull_request: { types: string[] } }; jobs: { arm: { if: string; steps: Step[] } } };
const armStep = autoArm.jobs.arm.steps[0] as Required<Step>;

test("auto-arm reads the secret through env: only, and skips drafts and forks", () => {
  assert.equal(armStep.env.A11IGN_BOT_TOKEN, "${{ secrets.A11IGN_BOT_TOKEN }}");
  assert.ok(!armStep.run.includes("secrets."), "the script must see the token only through the env var it was mapped into");
  assert.ok(autoArm.on.pull_request.types.includes("opened"));
  assert.match(autoArm.jobs.arm.if, /draft == false/);
  assert.match(autoArm.jobs.arm.if, /head\.repo\.full_name == github\.repository/);
});

/** Drive the arm step's own `run:` script under bash with a `gh` that records what it was called with and which token it held. */
function arm(secret: string) {
  const dir = mkdtempSync(join(tmpdir(), "agent-org-arm-"));
  try {
    const calls = join(dir, "calls");
    const seen = join(dir, "seen");
    write(dir, "bin/gh", `#!/bin/sh\nprintf '%s' "$*" > "${calls}"\nprintf '%s' "$GH_TOKEN" > "${seen}"\n`);
    chmodSync(join(dir, "bin/gh"), EXECUTABLE);
    const env = { PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, A11IGN_BOT_TOKEN: secret, FALLBACK_TOKEN: "the-actions-token",
      PULL_REQUEST: "7", REPOSITORY: "a11ign/agent-org" };
    const result = spawnSync("bash", ["-c", armStep.run], { encoding: "utf8", env, timeout: SCRIPT_TIMEOUT_MS });
    return { result, gh: readIfPresent(calls), token: readIfPresent(seen) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "(gh was never called)";
}

test("with the secret set, it arms with A11IGN_BOT_TOKEN and the log line says so", () => {
  const { result, gh, token } = arm("the-bot-token");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AUTO-ARM: arming #7 in a11ign\/agent-org with A11IGN_BOT_TOKEN/);
  assert.equal(token, "the-bot-token");
  assert.equal(gh, "pr merge 7 --repo a11ign/agent-org --auto --merge");
  assert.ok(!result.stdout.includes("::warning::"));
});

test("with the secret absent, it arms with GITHUB_TOKEN, WARNS, and the log line says so", () => {
  const { result, gh, token } = arm("");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AUTO-ARM: arming #7 in a11ign\/agent-org with GITHUB_TOKEN/);
  assert.match(result.stdout, /::warning::A11IGN_BOT_TOKEN is not set/);
  assert.equal(token, "the-actions-token");
  assert.equal(gh, "pr merge 7 --repo a11ign/agent-org --auto --merge");
});

// ---- 3. the gate job runs the leak scan, and the scan refuses a private LAN IPv4 ----------------------------

const ci = parseYaml(CI_WORKFLOW) as { on: Record<string, unknown>; jobs: Record<string, { steps: Step[] }> };

test("the gate job is named `gate`, runs both scripts, and reports on pull_request AND merge_group", () => {
  const commands = (ci.jobs.gate?.steps ?? []).map((step) => step.run ?? "");
  assert.deepEqual(Object.keys(ci.jobs), ["gate"], "the required check name is the job's id");
  assert.ok(commands.includes("node .github/scripts/leak-scan.mjs"), commands.join(" | "));
  assert.ok(commands.includes("node .github/scripts/workflow-paths.mjs"), commands.join(" | "));
  assert.ok("pull_request" in ci.on && "merge_group" in ci.on, "a queued pull request never merges on a check that does not report on merge_group");
});

test("the scan passes the bootstrapped tree, honouring the one (file, value) exemption", () => {
  const result = withTree({}, (root) => run(root, "leak-scan.mjs"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /leak scan: [1-9]\d* files examined, 0 leaks/);
});

for (const address of LAN_ADDRESSES) {
  test(`control: a fixture body carrying a private LAN IPv4 (${address.split(".")[0]}.x) is REFUSED, naming file and value`, () => {
    const result = withTree({ "src/notes.md": `the worker answers at http://${address}:8765/ today\n` }, (root) => run(root, "leak-scan.mjs"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LEAK: src\/notes\.md: private LAN IPv4 address: /);
    assert.ok(result.stderr.includes(address), result.stderr);
  });
}

test("control: the exemption is a (file, value) key -- the exempt value in ANY OTHER file is a leak", () => {
  const result = withTree({ "src/other.md": `see ${EXEMPT_VALUE}\n` }, (root) => run(root, "leak-scan.mjs"));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("src/other.md"), result.stderr);
  assert.ok(!result.stderr.includes(EXEMPT_FIXTURE_PATH), "the exempt file itself must stay exempt");
});

test("control: an empty tree is CANNOT_ASK (exit 2), never 'no leaks'", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-org-empty-"));
  try {
    const result = withTree({}, (populated) => spawnSync(process.execPath, [join(populated, ".github/scripts/leak-scan.mjs"), `--root=${root}`],
      { encoding: "utf8", timeout: SCRIPT_TIMEOUT_MS }));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CANNOT_ASK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
