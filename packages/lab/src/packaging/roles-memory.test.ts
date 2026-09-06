// worker-config's `~/.claude` memory moved into `docs/roles/memory/`, so it survives losing this Mac
// alongside the role files it complements. Three obligations, each with its own reason to be a test
// rather than prose:
//
//   1. Every fact file MEMORY.md links to must exist and carry name/description/metadata.type
//      frontmatter -- the same shape the live Claude Code memory system uses, so a fact can move back
//      and forth without translation.
//   2. The set must not shrink to zero -- unlike the ready queue, an organisation with no accumulated
//      lessons is not a goal state, so this is a FLOOR, never a target the count should trend toward.
//   3. Nothing reachability-sensitive leaked through. One real memory file named a live host address, an
//      SSH key filename and a container layout; it was redacted by hand for this migration, and this test
//      is what keeps a FUTURE migration (or a future memory file dropped in here unreviewed) from
//      reintroducing the same class of leak silently.
//
// DISCOVERED from MEMORY.md's own index and from the directory listing, never hand-listed, for the same
// reason every other discovery test in this repo gives: a hand-maintained list is exactly the kind of
// list a new entry slips past.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LEAK_PATTERNS } from "./leak-patterns.mjs";

const MEMORY_DIR = "docs/roles/memory";
const INDEX_PATH = `${MEMORY_DIR}/MEMORY.md`;
const read = (relPath: string) => readFileSync(resolve(process.cwd(), relPath), "utf8");

interface IndexEntry {
  title: string;
  file: string; // filename only, resolved relative to MEMORY_DIR
  hook: string;
}

/** Parses `- [Title](file.md) — hook` lines -- this repo's own established index shape (MEMORY.md itself,
 * the live Claude Code memory system this was migrated from). */
function parseIndex(indexSource: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const line of indexSource.split("\n")) {
    const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\) — (.+)$/);
    if (!m) continue;
    const [, title, file, hook] = m;
    entries.push({ title, file, hook });
  }
  return entries;
}

function factFiles(): string[] {
  return readdirSync(resolve(process.cwd(), MEMORY_DIR))
    .filter((name) => name.endsWith(".md") && name !== "MEMORY.md");
}

test("the memory index exists and every entry links to a real file", () => {
  assert.ok(existsSync(resolve(process.cwd(), INDEX_PATH)), `${INDEX_PATH} must exist`);
  const entries = parseIndex(read(INDEX_PATH));
  const missing = entries.filter((e) => !existsSync(resolve(process.cwd(), MEMORY_DIR, e.file)));
  assert.deepEqual(missing.map((e) => e.file), [],
    `these MEMORY.md entries link to files that do not exist: ${missing.map((e) => e.file).join(", ")}`);
});

test("the index discovery finds a realistic floor of migrated facts", () => {
  const entries = parseIndex(read(INDEX_PATH));
  // A floor, not a target -- this set does not shrink to zero as a happy path. 17 were migrated when this
  // page was written; set well below that so trimming a stale entry later does not itself break the guard.
  assert.ok(entries.length >= 10,
    `expected at least 10 entries in ${INDEX_PATH}, found ${entries.length} -- either the index line `
    + "format changed, or entries were removed, both of which this guard should be read as flagging");
});

test("every fact file on disk carries the memory system's own frontmatter shape", () => {
  const problems: string[] = [];
  for (const file of factFiles()) {
    const source = read(`${MEMORY_DIR}/${file}`);
    if (!/^---\nname: /m.test(source)) problems.push(`${file}: missing "name:" frontmatter`);
    if (!/\ndescription: /m.test(source)) problems.push(`${file}: missing "description:" frontmatter`);
    if (!/\n {2}type: (user|feedback|project|reference)\n/m.test(source)) {
      problems.push(`${file}: missing or unrecognised "metadata.type:"`);
    }
  }
  assert.deepEqual(problems, [],
    `these fact file(s) do not carry the required frontmatter shape:\n${problems.join("\n")}`);
});

test("every fact file on disk is linked from the index, and vice versa", () => {
  const linked = new Set(parseIndex(read(INDEX_PATH)).map((e) => e.file));
  const onDisk = new Set(factFiles());
  const unlinked = [...onDisk].filter((f) => !linked.has(f));
  const dangling = [...linked].filter((f) => !onDisk.has(f));
  assert.deepEqual(unlinked, [], `these files exist under ${MEMORY_DIR} but are not indexed: ${unlinked.join(", ")}`);
  assert.deepEqual(dangling, [], `MEMORY.md links to file(s) not present on disk: ${dangling.join(", ")}`);
});

/**
 * THE LEAK GUARD. Scans every fact file for the SHAPE of reachability-sensitive material -- a private LAN
 * address, a named SSH private key file, `pct exec` (the retired container-hop command whose whole point
 * was that it should never appear in a runnable form again) -- rather than for the specific redacted
 * strings, so it also catches a *different* secret dropped into a *different* future memory file, not only
 * a regression of this one migration.
 *
 * SHARED with `tracked-prose-leak-guard.test.ts`'s repo-wide sweep, not a second independently-typed copy
 * of the same three regexes -- extracted by worker-audit from this file's own original array, which is
 * exactly the "a fact stated twice, and the copies drifted" shape CLAUDE.md names as this repo's most
 * expensive recurring defect.
 */
test("no fact file leaks a host address, a key filename, or the retired container-hop command", () => {
  const findings: string[] = [];
  for (const file of factFiles()) {
    const source = read(`${MEMORY_DIR}/${file}`);
    for (const { name, pattern } of LEAK_PATTERNS) {
      if (pattern.test(source)) findings.push(`${file}: matches "${name}" pattern (${pattern})`);
    }
  }
  assert.deepEqual(findings, [],
    `these fact file(s) contain reachability-sensitive material that must be described, never printed `
    + `(see docs/roles/README.md's "Credentials" section):\n${findings.join("\n")}`);
});

/**
 * MUTATION HALF, against synthetic strings only -- proves the leak guard actually fires rather than
 * passing vacuously, and proves it in both directions (real redacted file stays clean; an injected leak
 * of each pattern's shape is caught).
 */
test("MUTATION: the leak guard catches each pattern shape and does not fire on the real redacted file", () => {
  const clean = "Two credential domains exist; ask whoever holds today's keys.";
  const leaks = [
    "reached at REDACTED-INTERNAL-ADDRESS as root", // private-shaped ON PURPOSE -- this proves the pattern fires
    "using the key at ~/.ssh/a11y-pve_ed25519",
    "via pct exec 121 -- bash -lc \"...\"",
  ];
  for (const text of [clean]) {
    for (const { pattern } of LEAK_PATTERNS) {
      assert.ok(!pattern.test(text), `a clean string incorrectly matched ${pattern}`);
    }
  }
  const caught = leaks.map((text) => LEAK_PATTERNS.some(({ pattern }) => pattern.test(text)));
  assert.deepEqual(caught, leaks.map(() => true), "at least one injected leak of each shape went uncaught");

  // And the real, already-redacted file must itself be clean -- proving the redaction actually took,
  // not just that the guard can theoretically fire.
  const redacted = read(`${MEMORY_DIR}/nvda-worker-vm-access.md`);
  for (const { name, pattern } of LEAK_PATTERNS) {
    assert.ok(!pattern.test(redacted), `the redacted file still matches "${name}" -- redaction did not take`);
  }
});
