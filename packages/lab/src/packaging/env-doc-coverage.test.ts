/**
 * A `process.env` variable read in more than one file must be documented somewhere a human looks.
 *
 * ## Why "more than one file", not every variable
 *
 * `docs/architecture-audit.md`'s §9 row on environment configuration measured three populations among
 * the ~70 distinct names this repo reads (2026-09-06): 10 read across more than one PACKAGE (none of
 * which actually disagree — see that row), 15 read in more than one FILE and documented nowhere, and 48
 * read in exactly one file with a sensible default. That last group is a decision, not a gap: a name that
 * appears once, beside the code that reads it, is already as discoverable as it needs to be — grep or an
 * editor's "find references" finds it in the one place it matters. Requiring every one of the ~70 to be
 * written up a second time would be the "fact stated twice" defect this repo warns about, aimed at
 * documentation instead of code.
 *
 * A name read in 2+ files is different: **CLAUDE.md's own words for this exact shape** — *"a command
 * nobody can find is a command nobody runs"* (`commands-documented.test.ts`) — apply just as well to a
 * switch. Something worth reading in more than one place is worth being able to find without reading
 * either.
 *
 * ## No exemption list, and that is the point
 *
 * `commands-documented.test.ts` and `dataset-paths.test.ts` both need one, because a real member of
 * their population can legitimately be exempt (an npm lifecycle hook nobody types; a package that cannot
 * import the shared module without a dependency cycle). Here there is no such case: a variable is either
 * read in one file (out of this guard's scope entirely, by construction) or in two-plus (in scope, and
 * belongs somewhere). Adding an exemption would mean asserting "this switch matters enough to appear in
 * more than one file, and still isn't worth writing down" — which is not a real position, only a deferred
 * one. If that position is ever genuinely held, argue it in the corpus this test reads, not in a list
 * inside the test that reads it.
 *
 * ## Where "documented" means
 *
 * `CLAUDE.md`, root `README.md`/`CONTRIBUTING.md`, every `docs/*.md`, and every package's own `README.md` —
 * the same set `commands-documented.test.ts` already treats as "somewhere a human looks", extended to
 * package READMEs because two of the fifteen this test closed belong there (`packages/cli/README.md` for
 * a consumer choosing a judge backend, `packages/control/README.md` for an operator reaching the control
 * plane) rather than in CLAUDE.md, which is for working ON the repo rather than using it.
 *
 * `docs/architecture-audit.md` is the one deliberate exclusion. It is the audit **of** this
 * under-documentation, so every name it discusses appears in its own prose — counting that as
 * documentation would have made the coverage measurement read "0 undocumented" while the real number was
 * 55, which is exactly what happened on the first pass before the exclusion was added. A check that
 * counts the complaint as the fix is examining the wrong thing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Every file matching `filter` under `dir`, recursively. */
function walk(dir: string, filter: (name: string) => boolean): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, filter);
    return filter(entry.name) ? [full] : [];
  });
}

/**
 * Where a human would look — CLAUDE.md is for working ON the repo, docs/ and package READMEs are for
 * using it. `docs/architecture-audit.md` is excluded on purpose: see this file's own header.
 */
function documentation(): string {
  const parts = [readFileSync(join(REPO, "CLAUDE.md"), "utf8")];
  for (const name of ["README.md", "CONTRIBUTING.md"]) {
    if (existsSync(join(REPO, name))) parts.push(readFileSync(join(REPO, name), "utf8"));
  }
  for (const file of walk(join(REPO, "docs"), (n) => n.endsWith(".md") && n !== "architecture-audit.md")) {
    parts.push(readFileSync(file, "utf8"));
  }
  for (const file of walk(join(REPO, "packages"), (n) => n === "README.md")) {
    parts.push(readFileSync(file, "utf8"));
  }
  return parts.join("\n");
}

/** Names this project's own convention would never expect written up: shell/OS built-ins that a
 *  process.env read can pick up incidentally, never anything this repo defines the meaning of. */
const NOT_A_PROJECT_VARIABLE = new Set([
  "HOME", "HOSTNAME", "HOST", "PATH", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
]);

const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)\b|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g;

/** Every `process.env.NAME` this repo's own source reads, mapped to the files that read it. */
function envReadsByFile(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const files = [
    ...walk(join(REPO, "packages"), (n) => /\.(mjs|ts|js)$/.test(n)),
    ...walk(join(REPO, "scripts"), (n) => /\.(mjs|ts|js)$/.test(n)),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(ENV_READ)) {
      const name = match[1] ?? match[2];
      if (NOT_A_PROJECT_VARIABLE.has(name)) continue;
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(file);
    }
  }
  return map;
}

test("the discovery finds a realistic population, so this cannot pass having read nothing", () => {
  const reads = envReadsByFile();
  assert.ok(reads.size > 50, `only found ${reads.size} distinct env var names; the scan is broken`);
  const multiFile = [...reads.entries()].filter(([, files]) => files.size > 1);
  assert.ok(multiFile.length >= 15,
    `only found ${multiFile.length} names read in 2+ files; expected at least the 15 this test was `
    + "written to cover (fewer would mean the walk stopped reaching real source)");

  const docs = documentation();
  assert.ok(docs.length > 50_000, `only ${docs.length} chars of documentation found; the layout moved`);
  assert.match(docs, /JUDGE_BACKEND/, "a name known to be documented is not being found");
});

test("every variable read in 2+ files is documented somewhere a human looks", () => {
  const docs = documentation();
  const multiFile = [...envReadsByFile().entries()].filter(([, files]) => files.size > 1);

  const undocumented = multiFile
    .filter(([name]) => !new RegExp(`\\b${name}\\b`).test(docs))
    .map(([name, files]) => `  ${name} (${files.size} files)`);

  assert.deepEqual(undocumented, [],
    "These variable(s) are read in more than one file and appear nowhere in CLAUDE.md, README.md, "
    + "docs/*.md (excluding architecture-audit.md) or a package README:\n"
    + undocumented.join("\n")
    + "\n\nDocument what it is for, what happens if you do not set it, and when you would reach for it — "
    + "see docs/architecture-audit.md's environment-configuration row for where the existing fifteen "
    + "landed and why. There is no exemption list here: a variable read in more than one file belongs "
    + "somewhere, not on an allowlist for being forgotten.");
});

test("architecture-audit.md is excluded from the documentation corpus, by name, not by accident", () => {
  // Not proven by a coincidental fixture name in real prose -- an earlier version of this test relied on
  // `A11Y_VM_NAME` appearing in architecture-audit.md's own duplication table and nowhere else, and that
  // premise broke the moment this unit rewrote the row it lived in (the same table!) to record what it
  // found. A guard whose passing depends on a sentence elsewhere in the repo not being edited is not
  // testing its own mechanism; this tests the WALK directly instead.
  assert.ok(existsSync(join(REPO, "docs/architecture-audit.md")),
    "the file this test excludes must actually exist, or excluding it proves nothing");
  const included = walk(join(REPO, "docs"), (n) => n.endsWith(".md") && n !== "architecture-audit.md");
  assert.ok(included.length > 20, `the docs/ walk found only ${included.length} files; the filter is too broad`);
  assert.ok(!included.some((f) => f.endsWith("architecture-audit.md")),
    "architecture-audit.md must not appear in the documentation corpus -- it is the audit OF this "
    + "problem, not documentation of any variable it discusses (see this file's own header for why that "
    + "distinction matters: including it once made a real coverage measurement read \"0 undocumented\" "
    + "while the true number was 55)");
});
