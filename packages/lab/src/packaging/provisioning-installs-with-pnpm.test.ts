/**
 * THE PROVISIONERS INSTALL WITH pnpm, AND NONE OF THEM TELLS AN OPERATOR TO RUN npm (#2890, row 3 of 10 of #57).
 *
 * These are the only places in the tree that really ran `npm install` against this repository. CI, the lab's normal
 * install and the workers' deploys moved to `corepack pnpm install --frozen-lockfile` (#2298, #2299), so a freshly
 * PROVISIONED lab or worker still got an npm-shaped `node_modules` and, with `package-lock.json` gone, resolved versions
 * the lockfile never named -- guidepup's among them, which is evidence in the capture cache key.
 *
 * What is pinned, on the real files:
 *   - no non-comment line of the three provisioning scripts or `doctor.mjs` runs or recommends `npm install|ci|run|...`
 *     (a comment naming the old behaviour is history, not an instruction);
 *   - every `pnpm install` line is FROZEN: an unfrozen one reconciles a drifted lockfile instead of refusing it;
 *   - the Windows provisioner installs with the SAME flags `roles/worker/tasks/nvda.yml` does, which
 *     `packages/control/src/worker-install-sites-match.test.ts` pins against `deploy.yml`;
 *   - `doctor.mjs` reaches pnpm through `pnpmCliInvocation` and never spawns npm.
 *
 * The scan is only worth its verdict if it can see: the fixtures below show it refusing each defect, and the real-file
 * test asserts the install lines it finds are not an empty population.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROVISIONING = "packages/worker-fleet/src/provisioning/";
const BOOTSTRAP = `${PROVISIONING}bootstrap-control-plane.sh`;
const PROVISION = `${PROVISIONING}provision-nvda-worker.ps1`;
const DIAGNOSE = `${PROVISIONING}diagnose-nvda-worker.ps1`;
const DOCTOR = "packages/worker-fleet/src/doctor.mjs";
const NVDA_ROLE = "packages/control/ansible/roles/worker/tasks/nvda.yml";

const read = (file: string): string => readFileSync(`${ROOT}${file}`, "utf8");

/** `#` (sh, ps1) and `//` or `*` (mjs): a comment line is prose about a command, and runs nothing. */
const isComment = (line: string): boolean => /^(#|\/\/|\*|\/\*)/.test(line.trim());

/**
 * One line as a command reads it: PowerShell passes `corepack`'s arguments as a quoted array
 * (`@('pnpm', 'install', ...)`), so quotes and commas are dropped before looking for the spelling.
 */
const asCommand = (line: string): string => line.replace(/['",]/g, " ").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();

/** `file:line: text` for every non-comment line a predicate selects. */
function linesWhere(file: string, text: string, selects: (command: string) => boolean): string[] {
  return text.split("\n").flatMap((line, index) =>
    !isComment(line) && selects(asCommand(line)) ? [`${file}:${index + 1}: ${line.trim()}`] : []);
}

const RUNS_NPM = /\bnpm\s+(?:install|i|ci|add|update|run)\b/;
const PNPM_INSTALL = /\bpnpm install\b/;
const FROZEN_PNPM_INSTALL = /\bpnpm install --frozen-lockfile\b/;

/** Every way a provisioner can still send the install down the npm path or let it drift: file, line, text. */
export function installProblems(file: string, text: string): string[] {
  return [
    ...linesWhere(file, text, (command) => RUNS_NPM.test(command)),
    ...linesWhere(file, text, (command) => PNPM_INSTALL.test(command) && !FROZEN_PNPM_INSTALL.test(command)),
  ];
}

/** The lines that really install, so a scan that found nothing cannot pass for a clean tree. */
export const frozenInstallLines = (file: string, text: string): string[] =>
  linesWhere(file, text, (command) => FROZEN_PNPM_INSTALL.test(command));

const REAL = [BOOTSTRAP, PROVISION, DIAGNOSE].map((file) => ({ file, text: read(file) }));

test("#2890: a provisioner that still runs npm install is refused, naming file and line", () => {
  const fixture = "#!/bin/sh\ncd \"$REPO\"\n  npm install --silent --no-audit --no-fund\n";
  assert.deepEqual(installProblems("fixture.sh", fixture), ["fixture.sh:3: npm install --silent --no-audit --no-fund"]);
  assert.deepEqual(installProblems("fixture.ps1", "try { Invoke-Native $npm @('install') 'npm install' }\n"), [
    "fixture.ps1:1: try { Invoke-Native $npm @('install') 'npm install' }",
  ]);
  assert.equal(installProblems("fixture.ps1", "throw 'guidepup is not installed. Run npm install.'\n").length, 1,
    "a message telling the operator to run npm is the same defect as a command that runs it");
  assert.equal(installProblems("fixture.sh", "    npm run doctor\n").length, 1, "a remedy that says npm run is refused too");
});

test("#2890: a frozen pnpm install passes, in the shell spelling and the PowerShell array spelling", () => {
  assert.deepEqual(installProblems("a.sh", "  corepack pnpm install --frozen-lockfile --silent\n"), []);
  const powershell = "    Invoke-Native $corepack @('pnpm', 'install', '--frozen-lockfile', '--prefer-offline') 'pnpm install --frozen-lockfile'\n";
  assert.deepEqual(installProblems("a.ps1", powershell), []);
  assert.equal(frozenInstallLines("a.ps1", powershell).length, 1);
});

test("#2890: an UNFROZEN pnpm install is refused, because it reconciles a drifted lockfile instead of refusing it", () => {
  assert.deepEqual(installProblems("a.sh", "  corepack pnpm install --silent\n"), ["a.sh:1: corepack pnpm install --silent"]);
  assert.equal(installProblems("a.ps1", "Invoke-Native $corepack @('pnpm', 'install') 'install'\n").length, 1);
});

test("#2890: a comment that names the old behaviour is not an instruction, and is not refused", () => {
  const comments = "# a tree npm made: `npm install` once ran here\n// npm run build was the remedy\n * npm ci\n";
  assert.deepEqual(installProblems("a.mjs", comments), []);
  assert.deepEqual(frozenInstallLines("a.sh", "# corepack pnpm install --frozen-lockfile\n"), [],
    "a commented-out install is not an install, so it cannot satisfy the positive control either");
});

test("#2890: the real provisioners and diagnose script install and advise with pnpm only", () => {
  // Positive control, EXACT per file: measured 2026-10-01 at bootstrap 1, provision 2 (the command and the refusal
  // message) and diagnose 1, counted by this function. An equality, not a floor, so a moved or emptied script cannot
  // pass as a clean one and a count that is reported is a count that is right (#1067).
  const perFile = Object.fromEntries(REAL.map(({ file, text }) => [file, frozenInstallLines(file, text).length]));
  assert.deepEqual(perFile, { [BOOTSTRAP]: 1, [PROVISION]: 2, [DIAGNOSE]: 1 },
    "frozen pnpm install lines per script; a change here is a changed install, or a scan that no longer sees one");
  assert.deepEqual(REAL.flatMap(({ file, text }) => installProblems(file, text)), []);
});

test("#2890: the Windows provisioner installs with the SAME flags as the worker role (corepack pnpm, frozen, prefer-offline)", () => {
  assert.match(read(NVDA_ROLE), /corepack pnpm install --frozen-lockfile --prefer-offline/, "the role this provisioner must match has moved");
  const provisioner = linesWhere(PROVISION, read(PROVISION), (command) => /\$corepack @\(pnpm install --frozen-lockfile --prefer-offline\)/.test(command));
  assert.equal(provisioner.length, 1, `expected one corepack install line in ${PROVISION}, found ${provisioner.length}`);
  assert.match(read(PROVISION), /\$corepack = Join-Path \$env:ProgramFiles 'nodejs\\corepack\.cmd'/,
    "corepack is reached from the Node install, not from a global pnpm");
});

test("#2890: doctor.mjs spawns pnpm through the shared helper, never npm, and prints pnpm remedies", () => {
  const text = read(DOCTOR);
  assert.match(text, /import \{ pnpmCliInvocation \} from "\.\/npm-cli-executable\.mjs"/);
  assert.deepEqual(linesWhere(DOCTOR, text, (command) => /\bnpmCliInvocation\(/.test(command)), [],
    "doctor spawns pnpm; a call to npmCliInvocation is the old install path coming back");
  assert.deepEqual(installProblems(DOCTOR, text), []);
  assert.ok(linesWhere(DOCTOR, text, (command) => /\bpnpm run \S+/.test(command)).length >= 5,
    "positive control: doctor prints its remedies as `pnpm run ...`; fewer found means the scan, not the file, has changed");
});
