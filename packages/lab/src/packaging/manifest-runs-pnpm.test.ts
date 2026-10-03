/**
 * THE ROOT MANIFEST RUNS ITS OWN SCRIPTS THROUGH pnpm (#2888, row 1 of 10 of the finish of #57).
 *
 * #57's six rows moved INSTALLS. Nothing moved the RUNNING of things, so `pnpm install` fired `prepare`, which
 * ran `npm run build`, and `pnpm test` fired `pretest`, which did the same: a worker who did everything right
 * was still launching npm underneath. The manifest is the first place that shows.
 *
 * `npx` becomes `pnpm exec`, never `pnpm dlx`: a tool the manifest does not declare is DECLARED, not fetched
 * at run time.
 *
 * WHAT COUNTS AS "CALLING npm". The check parses the JSON and reads each script VALUE as a shell line: it
 * splits on the command separators and looks at the first word of every segment, after any `VAR=value`
 * prefixes. A text grep would flag `node scripts/npm-token-liveness.mjs` (a script that is ABOUT the npm
 * registry and runs nothing from npm), and would miss nothing a command-position read misses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FORBIDDEN_COMMANDS = new Set(["npm", "npx"]);
/** Below this the parse has broken rather than the manifest having shrunk: it carries well over a hundred scripts. */
const MIN_SCRIPTS = 100;

type Scripts = Record<string, string>;

/** Each simple command of a shell line, split on `&&`, `||`, `;`, `|`, `&`, newlines and subshell parens. */
function segmentsOf(line: string): string[] {
  return line.split(/&&|\|\||[;|&\n()]/).map((segment) => segment.trim()).filter(Boolean);
}

/** The program a segment runs: its first word once leading `VAR=value` assignments are skipped. */
function commandOf(segment: string): string | undefined {
  return segment.split(/\s+/).find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

/** Every script whose value runs npm or npx as a command, as `name: command`. */
function npmCallers(scripts: Scripts): string[] {
  return Object.entries(scripts).flatMap(([name, value]) =>
    segmentsOf(value)
      .map(commandOf)
      .filter((command): command is string => command !== undefined && FORBIDDEN_COMMANDS.has(command))
      .map((command) => `${name}: ${command}`));
}

/** The scripts a script runs by `pnpm run <name>` (flags such as `--silent` allowed before the name). */
function delegatesOf(value: string): string[] {
  return segmentsOf(value).flatMap((segment) => {
    const match = /^(?:pnpm|node\s+scripts\/pnpm\.mjs)\s+run\s+(?:-{1,2}[\w-]+\s+)*([\w:-]+)/.exec(segment);
    return match ? [match[1]] : [];
  });
}

/** Every script reachable from `name` through `pnpm run`, `name` included; `seen` guards against a cycle. */
function chainOf(scripts: Scripts, name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name) || typeof scripts[name] !== "string") return seen;
  seen.add(name);
  for (const next of delegatesOf(scripts[name])) chainOf(scripts, next, seen);
  return seen;
}

const rootScripts = (): Scripts =>
  (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Scripts }).scripts;

test("a fixture script that runs `npm run` is REFUSED, naming the script", () => {
  assert.deepEqual(npmCallers({ clean: "rm -rf dist", test: "npm run test:ts && pnpm run test:python" }),
    ["test: npm"]);
});

test("a fixture script that runs `npx` is REFUSED, naming the script, wherever in the chain it sits", () => {
  assert.deepEqual(npmCallers({ lint: "FORCE_COLOR=1 npx eslint ." }), ["lint: npx"]);
  assert.deepEqual(npmCallers({ docs: "pnpm run build && npx typedoc" }), ["docs: npx"]);
  assert.deepEqual(npmCallers({ docs: "pnpm run build | npx tee" }), ["docs: npx"]);
});

test("`pnpm exec` and `pnpm run` pass, and so does a script that is only ABOUT npm", () => {
  assert.deepEqual(npmCallers({
    lint: "pnpm exec eslint .",
    test: "pnpm run test:ts && pnpm run test:python",
    "npm-token:check": "node scripts/npm-token-liveness.mjs",
    publish: "echo npm is the registry",
  }), []);
});

test("THE REAL ROOT MANIFEST runs no script through npm or npx", () => {
  const scripts = rootScripts();
  // The positive control for the emptiness below: a manifest that lost its scripts would pass over nothing.
  assert.ok(Object.keys(scripts).length >= MIN_SCRIPTS,
    `only ${Object.keys(scripts).length} scripts read from package.json -- the parse broke or the scripts went`);
  assert.deepEqual(npmCallers(scripts), [],
    "a root script still launches npm or npx; spell it `pnpm run` / `pnpm exec` (never `pnpm dlx`)");
});

test("`pnpm install` and `pnpm test` reach `build` through pnpm, read from the resolved script chain", () => {
  const scripts = rootScripts();
  for (const entry of ["pretest", "pretypecheck"]) {
    assert.ok(chainOf(scripts, entry).has("build"), `\`${entry}\` no longer reaches \`build\` by \`pnpm run\``);
  }
  // `prepare` is a LIFECYCLE script and runs on a worker with no bare `pnpm` (#2945), so it names the build
  // script's own command rather than `pnpm run build`; that script reaches pnpm through `pnpmCliInvocation`.
  assert.ok(scripts.prepare.includes(scripts.build), "`prepare` no longer runs the `build` script's command");
  const test = chainOf(scripts, "test");
  for (const delegate of ["test:ts", "test:python"]) {
    assert.ok(test.has(delegate), `\`test\` no longer reaches \`${delegate}\` by \`pnpm run\``);
  }
});

// #3151: the lab runs a job as `corepack pnpm run <script>` and has no `pnpm` on PATH, so a chain whose second word is a bare `pnpm`
// dies at `sh: pnpm: not found` (#2945's class, #3141). `test` is the chain `pnpm test` runs, so it reaches pnpm by `scripts/pnpm.mjs`.
const bareChainedPnpm = (value: string): string[] => segmentsOf(value).map(commandOf).filter((command) => command === "pnpm") as string[];

test("a fixture chain whose segment starts with a bare `pnpm` is FOUND, and the passthrough spelling is not", () => {
  assert.deepEqual(bareChainedPnpm("pnpm run test:ts && pnpm run test:python"), ["pnpm", "pnpm"]);
  assert.deepEqual(bareChainedPnpm("node scripts/pnpm.mjs run test:ts && node scripts/pnpm.mjs run test:python"), []);
});

test("THE REAL `test` script starts no segment with a bare `pnpm`, and still reaches both of its delegates", () => {
  const scripts = rootScripts();
  assert.deepEqual(bareChainedPnpm(scripts.test), [], "`test` names a bare `pnpm`; spell it `node scripts/pnpm.mjs run <script>`");
  // The positive control for the emptiness above: the chain still reaches its two delegates through the passthrough.
  assert.deepEqual(delegatesOf(scripts.test.split("&&")[0]).concat(delegatesOf(scripts.test.split("&&")[1])), ["test:ts", "test:python"]);
});
