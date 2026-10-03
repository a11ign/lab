/**
 * NO LAB JOB'S SCRIPT CHAIN NAMES A BARE `pnpm`, `npm` OR `npx` (#3141, #2945's class in another place).
 *
 * The lab runs every job as `/usr/bin/corepack pnpm run <script>` and has NO `pnpm` on PATH, by design
 * (`tasks/run-job.yml`: corepack, pinned by `packageManager`). So the argv is right, and a package script that
 * chains `pnpm run X && pnpm run Y` asks the SHELL for a `pnpm` the unit does not have: `release-gate` exited 1 in
 * under a second at `sh: 1: pnpm: not found`, with no stage run. `lifecycle-scripts-need-no-bare-pnpm.test.ts`
 * closed this for the root lifecycle scripts only. Nine jobs reached it (`release-gate`, `shortcuts`,
 * `shortcuts-baseline`, `shortcuts-baseline-candidate`, `capture`, `capture-only`, `promote`,
 * `promote-accepting-regression`, `grants-audit`).
 *
 * THE POPULATION IS THE CATALOGUE, NOT A COPY OF IT: every `lab-job.yml` job whose argv is
 * `corepack pnpm run <script>`. The walk follows that script through the scripts it NAMES (`pnpm run X` or its
 * remedy `node scripts/pnpm.mjs run X`, flags allowed) and through the `pre`/`post` hooks pnpm runs by itself,
 * and refuses a bare package manager in command position at any link. The remedy is `scripts/pnpm.mjs`, which
 * reaches pnpm through `pnpmCliInvocation` (`npm_execpath` first), so no unit needs a `pnpm` on PATH.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BARE_PACKAGE_MANAGERS = new Set(["pnpm", "npm", "npx"]);
/** How a lab job's argv names a package script; the job's own argv is `corepack`, which the lab has. */
const COREPACK_RUN = ["/usr/bin/corepack", "pnpm", "run"];
/** The jobs the issue found, read off the catalogue before the fix: the walk over the old manifest must find them. */
const FOUND_BEFORE_THE_FIX = 9;

type Scripts = Record<string, string>;
type Catalogue = Record<string, { argv: string[] | string }>;

/** Each simple command of a shell line, split on `&&`, `||`, `;`, `|`, `&`, newlines and subshell parens. */
function segmentsOf(line: string): string[] {
  return line.split(/&&|\|\||[;|&\n()]/).map((segment) => segment.trim()).filter(Boolean);
}

/** The program a segment runs: its first word once leading `VAR=value` assignments are skipped. */
function commandOf(segment: string): string | undefined {
  return segment.split(/\s+/).find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

/** The scripts a script value runs, by `pnpm run <name>` or `node scripts/pnpm.mjs run <name>` (flags allowed). */
function delegatesOf(value: string): string[] {
  return segmentsOf(value).flatMap((segment) => {
    const match = /^(?:pnpm|node\s+scripts\/pnpm\.mjs)\s+run\s+(?:-{1,2}[\w-]+\s+)*([\w:-]+)/.exec(segment);
    return match ? [match[1]] : [];
  });
}

/** Every script a lab job runs for `name`: itself, its `pre`/`post` hooks, and what each of them names. */
function chainOf(scripts: Scripts, name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name) || typeof scripts[name] !== "string") return seen;
  seen.add(name);
  const hooks = [`pre${name}`, `post${name}`];
  for (const next of [...hooks, ...delegatesOf(scripts[name])]) chainOf(scripts, next, seen);
  return seen;
}

/**
 * The words of a job's argv. Four jobs write it as a Jinja template (`"{{ [...] + (...) }}"`), whose leading literals
 * are the program and the script, so a string is read as its quoted literals in order.
 */
function wordsOf(argv: string[] | string): string[] {
  return Array.isArray(argv) ? argv : [...argv.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The package script a job runs, when its argv is `corepack pnpm run [--flags] <script>`. */
function scriptOf(argv: string[] | string): string | undefined {
  const words = wordsOf(argv);
  if (words.slice(0, COREPACK_RUN.length).join(" ") !== COREPACK_RUN.join(" ")) return undefined;
  return words.slice(COREPACK_RUN.length).find((word) => !word.startsWith("-"));
}

/** Every job whose chain runs a bare package manager, as `job: script -> command`. */
function bareCallers(catalogue: Catalogue, scripts: Scripts): string[] {
  return Object.entries(catalogue).flatMap(([job, { argv }]) => {
    const entry = scriptOf(argv);
    if (entry === undefined) return [];
    return [...chainOf(scripts, entry)].flatMap((script) =>
      segmentsOf(scripts[script])
        .map(commandOf)
        .filter((command): command is string => command !== undefined && BARE_PACKAGE_MANAGERS.has(command))
        .map((command) => `${job}: ${script} -> ${command}`));
  });
}

const rootScripts = (): Scripts =>
  (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Scripts }).scripts;

const realCatalogue = (): Catalogue => {
  const playbook = parseYaml(readFileSync(join(ROOT, "packages/control/ansible/lab-job.yml"), "utf8")) as
    Array<{ vars?: { lab_jobs?: Catalogue } }>;
  return playbook.find((play) => play.vars?.lab_jobs !== undefined)?.vars?.lab_jobs ?? {};
};

const corepackJob = (script: string) => ({ argv: [...COREPACK_RUN, script] });

test("a fixture job whose script chains `pnpm run X && pnpm run Y` is REFUSED at each bare link", () => {
  const scripts = { gate: "pnpm run a && pnpm run b", a: "node a.mjs", b: "node b.mjs" };
  assert.deepEqual(bareCallers({ gate: corepackJob("gate") }, scripts), ["gate: gate -> pnpm", "gate: gate -> pnpm"]);
});

test("the walk follows a script named through the remedy, and through a `pre` hook", () => {
  const scripts = {
    gate: "node scripts/pnpm.mjs run --silent inner",
    inner: "FORCE_COLOR=1 npx tsx check.ts",
    pregate: "npm run build",
  };
  assert.deepEqual(bareCallers({ gate: corepackJob("gate") }, scripts),
    ["gate: pregate -> npm", "gate: inner -> npx"]);
});

test("a chain that reaches pnpm only through `node scripts/pnpm.mjs` passes, and so does a job outside corepack", () => {
  const scripts = { gate: "node scripts/pnpm.mjs run a && node scripts/pnpm.mjs run b -- --flag", a: "node a.mjs", b: "node b.mjs" };
  assert.deepEqual(bareCallers({
    gate: corepackJob("gate"),
    elsewhere: { argv: ["/usr/bin/node", "x.mjs"] },
  }, scripts), []);
});

test("THE REAL CATALOGUE: no corepack job's chain names a bare package manager", () => {
  const catalogue = realCatalogue();
  const scripts = rootScripts();
  const jobs = Object.values(catalogue).filter(({ argv }) => scriptOf(argv) !== undefined);
  // The positive controls for the emptiness below. The catalogue holds well over the nine jobs that were broken, and
  // the chain `release-gate` runs must be READ (its first stage is the one the lab never reached), so a parse that
  // found no jobs, or a walk that stopped at the entry script, finds nothing and must not read as a pass.
  assert.ok(jobs.length >= FOUND_BEFORE_THE_FIX, `only ${jobs.length} corepack jobs read from lab-job.yml -- the parse broke`);
  const releaseGate = chainOf(scripts, scriptOf(catalogue["release-gate"].argv) as string);
  for (const stage of ["release:gate", "scorer:verify", "release:provenance", "gate:isolation"]) {
    assert.ok(releaseGate.has(stage), `the walk from release-gate no longer reaches ${stage}`);
  }
  assert.deepEqual(bareCallers(catalogue, scripts), [],
    "a lab job's script chain names a bare `pnpm`/`npm`/`npx`; the lab has only `corepack pnpm`, so the job exits 1 at "
    + "the shell's `pnpm: not found`. Chain with `node scripts/pnpm.mjs run <script>` instead (#3141)");
});
