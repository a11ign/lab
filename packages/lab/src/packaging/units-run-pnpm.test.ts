/**
 * #2892 (row 5 of 10, #57 follow-through): THE AGENTS HOST'S UNITS RUN PNPM.
 *
 * Four units and one template ran `/usr/bin/npm run`, and `pnpm` was not even on this host's PATH until the
 * chairman's session installed the corepack shim at `~/.local/bin/pnpm` on 2026-10-01. A unit that names
 * `npm` after the move is a unit that quietly keeps the old package manager, and nothing but a reader of the
 * unit text would notice.
 *
 * `work-tick.service.in` WAS THE ONE EXEMPTION, BY NAME AND BY `ceo`'S RULING ON #2867: its npm line was the
 * live tick, so editing it was the cut itself. The cut is #2974 (cut-over 3 of 6, 2026-10-02), which moved the
 * line to the shim and deleted the exemption (`NPM_UNTIL_THE_CUT`), so this file now refuses every shipped
 * unit's npm line alike and `work-tick` is among the units that MUST be on the shim.
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

/** The units in this row's Region -- the ones that MUST be on the shim, not merely free of npm. */
const MOVED = [
  ".agent-org/units/a11ign-corpus-snapshot.service",
  ".agent-org/units/a11ign-corpus-release-nightly.service",
  ".agent-org/units/a11ign-fleet-watch.service",
  ".agent-org/units/a11ign-lab-watch.service",
  "packages/agent-org/host/worktree-prune.service.in",
  "packages/agent-org/host/work-tick.service.in",
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

test("#2892: the six moved units spell the shim and no Exec line names npm", () => {
  // POSITIVE CONTROL for the emptiness below: the six real files are READ and their Exec lines COUNTED, so
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

test("#2892: no shipped unit anywhere names npm -- work-tick is no longer exempt (#2974)", () => {
  const files = shippedUnitFiles();
  assert.ok(files.length >= MOVED.length,
    `POSITIVE CONTROL: only ${files.length} unit files found under ${UNIT_DIRS.join(", ")}`);
  assert.ok(files.includes("packages/agent-org/host/work-tick.service.in"),
    "POSITIVE CONTROL: the file whose exemption was deleted is among the files scanned, so its npm line is read");
  assert.deepEqual(files.flatMap((file) => npmRefusals(file, unitText(file))), []);
});
