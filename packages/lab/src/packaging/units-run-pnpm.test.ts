/**
 * #2892 (row 5 of 10, #57 follow-through): THE AGENTS HOST'S UNITS RUN PNPM, EXCEPT THE WORK-TICK UNIT.
 *
 * Four units and one template ran `/usr/bin/npm run`, and `pnpm` was not even on this host's PATH until the
 * chairman's session installed the corepack shim at `~/.local/bin/pnpm` on 2026-10-01. A unit that names
 * `npm` after the move is a unit that quietly keeps the old package manager, and nothing but a reader of the
 * unit text would notice.
 *
 * `work-tick.service.in` IS THE ONE UNIT ALLOWED TO STAY, BY NAME AND BY `ceo`'S RULING ON #2867: its two
 * npm lines are the live tick, so editing them is the cut itself -- one `host:install` would perform the
 * cut-over early. They move in #2623's cut-over PR. That PR deletes `NPM_UNTIL_THE_CUT` below, and this test
 * then refuses the file's npm lines like any other's; until it does, the test ALSO refuses the file
 * if it STOPS spelling npm, because an exemption for a file that no longer needs it is a hole nobody reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

// Not `REPO_ROOT` from host-units.mjs: importing it reaches the gate's `history` reader and taxes this file
// in `work-gate.test.ts`'s closure population, for a path this file can compute itself.
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const UNIT_DIRS = [".agent-org/units", "packages/agent-org/host"];
const UNIT_FILE = /\.service(\.in)?$/;
const PNPM_SHIM = "%h/.local/bin/pnpm";
const PACKAGE_MANAGERS_RETIRED = new Set(["npm", "npx"]);

/** The one unit that still runs npm, until #2623's cut-over PR (done-when 4) moves it. */
const NPM_UNTIL_THE_CUT = new Set(["packages/agent-org/host/work-tick.service.in"]);

/** The units in this row's Region -- the ones that MUST be on the shim, not merely free of npm. */
const MOVED = [
  ".agent-org/units/a11ign-corpus-snapshot.service",
  ".agent-org/units/a11ign-corpus-release-nightly.service",
  ".agent-org/units/a11ign-fleet-watch.service",
  ".agent-org/units/a11ign-lab-watch.service",
  "packages/agent-org/host/worktree-prune.service.in",
];

type ExecLine = { line: number; text: string; program: string };

/** Every `Exec*=` line, with systemd's own prefixes (`-`, `@`, `+`, `!`, `:`) stripped to the program. */
function execLines(unitText: string): ExecLine[] {
  return unitText.split("\n").flatMap((text, index) => {
    const m = /^Exec[A-Za-z]*=(.*)$/.exec(text);
    if (!m) return [];
    const program = m[1].trim().replace(/^[-@+!:]+/, "").trim().split(/\s+/)[0] ?? "";
    return [{ line: index + 1, text, program }];
  });
}

/** The refusals in one unit's text: each names the file and the line, so the fix is one jump away. */
function npmRefusals(file: string, unitText: string): string[] {
  return execLines(unitText)
    .filter(({ program }) => PACKAGE_MANAGERS_RETIRED.has(basename(program)))
    .map(({ line, text }) => `${file}:${line}: ${text.trim()} -- run pnpm (${PNPM_SHIM}), not npm`);
}

function shippedUnitFiles(): string[] {
  return UNIT_DIRS.flatMap((dir) => readdirSync(join(REPO_ROOT, dir))
    .filter((name) => UNIT_FILE.test(name)).map((name) => `${dir}/${name}`)).sort();
}

const unitText = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8");

test("#2892: a unit that runs `/usr/bin/npm run` is REFUSED, naming the file and the line", () => {
  const fixture = "[Service]\nType=oneshot\n\nExecStartPre=-/usr/bin/npm run primary:update\nExecStart=/usr/bin/npm run x\n";
  assert.deepEqual(npmRefusals("fixture.service", fixture), [
    "fixture.service:4: ExecStartPre=-/usr/bin/npm run primary:update -- run pnpm (%h/.local/bin/pnpm), not npm",
    "fixture.service:5: ExecStart=/usr/bin/npm run x -- run pnpm (%h/.local/bin/pnpm), not npm",
  ]);
  assert.equal(npmRefusals("fixture.service", "[Service]\nExecStart=npx tsc\n").length, 1,
    "`npx` is the same retired manager spelled differently");
});

test("#2892: the same unit on the pnpm shim passes", () => {
  const fixture = `[Service]\nExecStartPre=-${PNPM_SHIM} run primary:update\nExecStart=${PNPM_SHIM} run x\n`;
  assert.deepEqual(npmRefusals("fixture.service", fixture), []);
  assert.deepEqual(npmRefusals("fixture.service", "[Service]\n# `/usr/bin/npm run` in a comment is prose\nExecStart=/usr/bin/node a.mjs\n"), [],
    "a comment or another program is not a package-manager command");
});

test("#2892: the five moved units spell the shim and no Exec line names npm", () => {
  // POSITIVE CONTROL for the emptiness below: the five real files are READ and their Exec lines COUNTED, so
  // an `assert.deepEqual(offenders, [])` over a population that quietly emptied cannot pass.
  const execs = MOVED.flatMap((file) => execLines(unitText(file)).map((e) => ({ file, ...e })));
  assert.ok(execs.length >= MOVED.length, `read only ${execs.length} Exec lines from ${MOVED.length} units`);
  assert.deepEqual(MOVED.flatMap((file) => npmRefusals(file, unitText(file))), []);
  for (const file of MOVED) {
    const runs = execLines(unitText(file)).filter(({ text }) => /\brun\b/.test(text));
    assert.ok(runs.length >= 1, `${file} has no \`... run <script>\` line, so it is not what this row moved`);
    for (const { line, program } of runs) {
      assert.equal(program, PNPM_SHIM, `${file}:${line} must start the shim by its %h path, not a bare name`);
    }
  }
});

test("#2892: no shipped unit anywhere names npm except work-tick, which is allowlisted BY NAME until the cut", () => {
  const files = shippedUnitFiles();
  assert.ok(files.length >= MOVED.length + NPM_UNTIL_THE_CUT.size,
    `POSITIVE CONTROL: only ${files.length} unit files found under ${UNIT_DIRS.join(", ")}`);
  for (const file of NPM_UNTIL_THE_CUT) assert.ok(files.includes(file), `${file} is allowlisted but is not a shipped unit`);
  const offenders = files.filter((file) => !NPM_UNTIL_THE_CUT.has(file)).flatMap((file) => npmRefusals(file, unitText(file)));
  assert.deepEqual(offenders, []);
});

test("#2892: work-tick.service.in still runs npm -- an exemption for a file that no longer needs one is a hole", () => {
  for (const file of NPM_UNTIL_THE_CUT) {
    const refusals = npmRefusals(file, unitText(file));
    assert.ok(refusals.length >= 1,
      `${file} no longer names npm: the cut has happened, so delete its NPM_UNTIL_THE_CUT entry`);
  }
});
