/**
 * Every command a human is meant to type must be written down somewhere a human will look.
 *
 * ## Why this is a test and not a habit
 *
 * A command nobody can find is a command nobody runs, which is this repo's own most-repeated failure —
 * *"a check that exists and does not run"* — arriving through discoverability rather than through
 * automation. It is also the reason `capture-check` was mandatory and never ran once, and why
 * `release:gate` was broken from the day it was written.
 *
 * Measured on 2026-08-25: three commands and two flags were added in one day (`fleet:provision`,
 * `lab:inventory`, `lab:pipeline`, `--serial`, `--allow-stale-workers`) and only one of them reached
 * CLAUDE.md. The other two were discoverable solely by reading their own source, which is the same
 * "somebody has to remember" that this repo removes everywhere else. That is what this stops.
 *
 * ## Why a two-list shape rather than a generated index
 *
 * `docs/coverage.md` is generated and pinned, and that is right for a table of criteria. It is wrong for
 * commands: this repo documents a command **in the context of the problem it solves** — `fleet:provision`
 * next to the provisioning trap, `lab:inventory` next to the other diagnostics — which is far more useful
 * than an alphabetical list, and cannot be generated.
 *
 * So the DESCRIPTIONS stay hand-written where they belong, and only the COVERAGE is enforced. A script
 * that is genuinely not user-facing goes in `INTERNAL` with a reason, which is a decision rather than a
 * shape and so cannot be inferred.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

import { COMMANDS } from "../../../../scripts/commands.mjs";

/**
 * Scripts nobody is expected to type, with the reason each is exempt.
 *
 * A reason rather than a bare name: "why is this one allowed to be undocumented" is exactly the question
 * a future reader will have, and an unexplained allowlist is a hole nobody can audit.
 */
const INTERNAL: Record<string, string> = {
  build: "invoked by npm lifecycle and by run-job.yml; not something an operator chooses to run",
  test: "the universal convention; documenting `npm test` would be noise",
  lint: "the universal convention",
  typecheck: "the universal convention",
  pretest: "an npm lifecycle hook — npm runs it, nobody types it",
  pretypecheck: "an npm lifecycle hook — npm runs it, nobody types it",
  "test:python": "one half of `npm test`, which runs it; not chosen separately",
  "test:ts": "one half of `npm test`, which runs it; not chosen separately",
};

/** Where a human would look. CLAUDE.md is for working ON the repo; docs/ is for using it. */
function documentation(): string {
  const parts = [readFileSync(join(REPO, "CLAUDE.md"), "utf8")];
  for (const name of ["README.md", "CONTRIBUTING.md"]) {
    if (existsSync(join(REPO, name))) parts.push(readFileSync(join(REPO, name), "utf8"));
  }
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(join(REPO, "docs"));
  // The ansible playbooks are where the lab jobs are defined, and their headers are real documentation —
  // `lab-job.yml`'s catalogue explains every job it can run, with the reason each exists.
  walk(join(REPO, "packages/control/ansible"));
  return parts.join("\n");
}

const DOCS = documentation();

function npmScripts(): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as
    { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).sort();
}

/**
 * THE COMMAND CATALOGUE COUNTS TOO — A3, and this is the half that makes A3 safe.
 *
 * A3 gives a command a home outside `package.json`, so a new one no longer means editing the file 19 PRs
 * collided in. **A guard that reads only `package.json` would then stop seeing the commands that move**,
 * and this row would have bought B4 by putting a hole in the discoverability rule -- trading one of this
 * repository's guards for another, which is never the deal.
 *
 * So the population is the UNION. A command is held to the same standard wherever it is declared.
 *
 * Worth stating what this does NOT fix: `scripts/` holds 24 runnable commands with no npm entry, 20 of
 * them undocumented, and they are invisible here TODAY because this function reads `package.json` alone.
 * A3 does not close that -- the catalogue is seeded with four that ARE documented, so nothing is exempted
 * to make this pass -- but every command that moves from now on lands inside the guard rather than outside.
 */
function catalogueCommands(): string[] {
  // IMPORTED, NOT SCRAPED. The first version of this read the keys out of the file's text with a regex,
  // and CLAUDE.md names that shape by itself: *"a test must not derive its expectations from source
  // TEXT"* -- the signal-type scrape matched nothing after a refactor and asserted over an empty set, and
  // passed. Reading the exported VALUE deletes the copy instead of pinning it, which is the remedy that
  // file puts first. The vacuity guard below stays anyway, because it now catches a different fault: an
  // emptied catalogue rather than a broken reader.
  return Object.keys(COMMANDS).sort();
}

/** Every command a person can type, wherever it is declared. */
function allCommands(): string[] {
  return [...new Set([...npmScripts(), ...catalogueCommands()])].sort();
}

test("the documentation being searched is real, so this cannot pass having read nothing", () => {
  // A guard written against a shape you did not verify is the count-based check all over again.
  assert.ok(DOCS.length > 50_000, `only ${DOCS.length} chars of documentation found; the layout moved`);
  assert.ok(npmScripts().length > 30, "too few npm scripts parsed; package.json shape changed");
  // The catalogue half of the population, guarded the same way: a regex that stopped matching would make
  // every catalogued command silently exempt, which is the hole this addition exists to prevent.
  assert.ok(catalogueCommands().length > 0,
    "scripts/commands.mjs parsed to ZERO commands -- the catalogue is the other half of this test's "
    + "population, and reading none of it means every command declared there is silently unguarded");
  assert.match(DOCS, /npm run fleet:status/, "a command known to be documented is not being found");
});

test("every command is documented, or explicitly declared internal", () => {
  // `allCommands()`, NOT `npmScripts()`. Renaming this test to say "command" while its body still read
  // `package.json` alone would be a title claiming more than the body checks, which is worse than leaving
  // the old name -- a reader trusts the sentence, not the call.
  const undocumented = allCommands()
    .filter((name) => !Object.hasOwn(INTERNAL, name))
    .filter((name) => !DOCS.includes(name));

  assert.deepEqual(undocumented, [],
    "These commands exist and are discoverable only by reading source. Document each where the problem "
    + "it solves is described — that is far more useful than an index — or add it to INTERNAL with a "
    + "reason. A command nobody can find is a command nobody runs.");
});

test("the internal list is honest: every entry is a real script", () => {
  // An allowlist that outlives its entries is a hole nobody can see.
  const scripts = new Set(allCommands());
  for (const [name, why] of Object.entries(INTERNAL)) {
    assert.ok(scripts.has(name), `${name} is exempted and is not a command in either population`);
    assert.ok(why.length > 15, `${name} is exempted without a reason`);
  }
});
