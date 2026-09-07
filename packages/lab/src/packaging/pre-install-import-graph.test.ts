/**
 * A SCRIPT THAT RUNS BEFORE `npm ci` OR BEFORE `dist` EXISTS CANNOT IMPORT A WORKSPACE PACKAGE.
 *
 * `packages/worker-fleet`'s export map is `{"./cli-flags": {"default": "./dist/cli-flags.mjs"}}`, so
 * `@a11ign/worker-fleet/cli-flags` needs BOTH `node_modules` and a completed build. Several scripts
 * here have neither when they run, and every one of them dies on startup:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@a11ign/worker-fleet'
 *
 * INVISIBLE ON EVERY DEVELOPER MACHINE, which is why it needs a test rather than care: a working tree has
 * `node_modules` and a built `dist`, so lint, typecheck and the pre-push hook are all green while CI dies
 * before the workflow starts.
 *
 * ## THE ENTRY LIST IS DERIVED, AND THE FIRST VERSION OF THIS FILE IS THE ARGUMENT FOR WHY
 *
 * This test previously walked ONE hand-named entry, `scripts/ci-changed.mjs`. It was written in the same
 * pull request that added the very import it could not see — `scripts/build-packages.mjs`, one file over,
 * which is `package.json`'s `build` and therefore breaks every job that builds anything. It claimed to
 * pin a CLASS and pinned an instance.
 *
 * The author had named that exact shape in somebody else's code an hour earlier — *"the knowledge stopped
 * at that file and never reached its dependencies"* — and then committed it. **That is not a lapse of
 * attention, it is evidence that the knowledge does not travel with the person**, which is precisely why
 * the population has to be computed rather than remembered.
 *
 * ## What counts as an entry, and why each

 * - **A workflow step running `node scripts/…` with no `npm ci` before it in that job.** Measured:
 *   `ci-changed.mjs` (ci.yml's `changed` job, which decides whether anything else installs at all) and
 *   `workflow-run-liveness.mjs` (whose workflow never installs anywhere).
 * - **`package.json`'s `build`.** It is the thing that PRODUCES `dist`, so it cannot import from one.
 * - **`package.json`'s `prepare`.** npm runs it during install, before any build.
 *
 * `workflow-run-liveness.mjs` is why this must be derived rather than listed: it had been crashing on
 * this exact import for every one of its runs, reporting SUCCESS each time because its only step carries
 * `continue-on-error: true`. Nobody knew it was in the population. A derived walk finds it without being
 * told it exists.
 *
 * ## The vacuity guard is on the ENTRY COUNT, not just the file count
 *
 * The old version asserted that the WALK found several files — true, and useless, because it was handed
 * the one entry that happened to be clean. A guard given a literal cannot tell "one entry is correct
 * here" from "somebody forgot the second". So the discovery itself is asserted to find a plausible
 * population, and to contain the entries this file was written about.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const WORKFLOWS = join(REPO, ".github/workflows");

/** Every `import ... from "<spec>"` in a module, in source order. */
function specifiersOf(source: string): string[] {
  // `from` is OPTIONAL: `import "./side-effect.mjs"` has none, and the first version of this could not
  // see one. Borrowed from `build-bootstrap-no-workspace-imports.test.ts`, which got it right first --
  // recorded rather than silently copied, because two guards covering one class is the drift this repo
  // pays for most and the next reader should know both exist.
  return [...source.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * Scripts a workflow invokes with no `npm ci`/`npm install` earlier in the same job.
 *
 * Read line by line rather than through a YAML parser, deliberately: `packages/control` cannot depend on
 * one (ADR 0012) and `lab-job.mjs` already slices its catalogue by the indentation the file commits to,
 * for the same reason. A job header resets the "has installed" state; an install step sets it.
 */
export function preInstallScripts(workflowText: string): string[] {
  const found: string[] = [];
  let installed = false;
  for (const line of workflowText.split("\n")) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) installed = false;          // a new job
    if (/npm (ci|install)\b/.test(line)) installed = true;
    if (installed) continue;
    const call = /\bnode\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/.exec(line);
    if (call) found.push(call[1]);
  }
  return found;
}

/** The script behind an npm lifecycle entry, when it is a plain `node scripts/…` invocation. */
function scriptBehind(command: string | undefined): string | null {
  const call = /\bnode\s+(scripts\/[A-Za-z0-9._-]+\.mjs)/.exec(command ?? "");
  return call ? call[1] : null;
}

/**
 * Every entry that runs before `node_modules` and `dist` can both be relied on.
 *
 * DISCOVERED, never listed — see this file's header for what listing cost.
 */
export function preInstallEntries(): string[] {
  const entries = new Set<string>();
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
    for (const script of preInstallScripts(readFileSync(join(WORKFLOWS, file), "utf8"))) {
      entries.add(script);
    }
  }
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as
    { scripts: Record<string, string> };
  for (const lifecycle of ["build", "prepare"]) {
    const script = scriptBehind(pkg.scripts[lifecycle]);
    if (script) entries.add(script);
  }
  return [...entries].filter((script) => existsSync(join(REPO, script))).sort();
}

/**
 * Everything reachable from `entry` by relative import, plus every package specifier found on the way.
 *
 * STATIC, and that is the point: it must answer for the RUNNER rather than for this machine, where a
 * dynamic resolve succeeds through the very `node_modules` the runner lacks. A check that shares a
 * failure mode with the thing it checks verifies nothing.
 */
export function importGraph(entry: string): { files: Set<string>; packageSpecifiers: string[] } {
  const files = new Set<string>();
  const packageSpecifiers: string[] = [];
  const visit = (file: string): void => {
    const abs = resolve(file);
    if (files.has(abs) || !existsSync(abs)) return;
    files.add(abs);
    for (const spec of specifiersOf(readFileSync(abs, "utf8"))) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) { visit(resolve(dirname(abs), spec)); continue; }
      packageSpecifiers.push(`${relative(REPO, abs)} -> ${spec}`);
    }
  };
  visit(resolve(REPO, entry));
  return { files, packageSpecifiers };
}

test("the entry discovery finds a real population — the vacuity guard that matters here", () => {
  const entries = preInstallEntries();
  assert.ok(entries.length >= 3,
    `only ${entries.length} pre-install entries found (${entries.join(", ")}). The discovery is broken, `
    + "not the tree -- and a guard handed too few entries reports clean about a population it never saw, "
    + "which is exactly how the previous version of this file missed the import its own PR added.");
  // Named because each is a DIFFERENT reason for being in the population, and losing any one silently
  // narrows the walk: a workflow step, a workflow that never installs at all, and a lifecycle script.
  for (const expected of ["scripts/ci-changed.mjs", "scripts/build-packages.mjs"]) {
    assert.ok(entries.includes(expected),
      `${expected} must be discovered; found: ${entries.join(", ")}`);
  }
});

test("nothing any pre-install entry imports needs node_modules or dist", () => {
  const offenders: string[] = [];
  for (const entry of preInstallEntries()) {
    const { files, packageSpecifiers } = importGraph(entry);
    assert.ok(files.size >= 1, `${entry} resolved to no files -- the walk is broken`);
    offenders.push(...packageSpecifiers.map((s) => `[${entry}] ${s}`));
  }
  assert.deepEqual(offenders, [],
    "these run before `npm ci` completes or before `npm run build` produces `dist`, so a package "
    + "specifier dies with ERR_MODULE_NOT_FOUND. Import relatively from `packages/*/src/`, as "
    + "`ci-changed.mjs` does and explains above its own import.");
});

test("the walk follows relative imports — or the guard above passes having examined one file", () => {
  const names = [...importGraph("scripts/ci-changed.mjs").files].map((f) => relative(REPO, f));
  assert.ok(names.includes("scripts/changed-packages.mjs"),
    `the walk did not reach a known dependency; it found: ${names.join(", ")}`);
});

test("preInstallScripts stops at an install step, and resumes at the next job", () => {
  // Driven against a fixture rather than the real workflows, because the two states that matter --
  // "after an install" and "a new job resets it" -- cannot both be produced from a file that happens to
  // exist today, and a discovery only exercised on today's tree silently narrows when the tree changes.
  const yaml = [
    "jobs:",
    "  early:",
    "    steps:",
    "      - run: node scripts/before.mjs",
    "      - run: npm ci",
    "      - run: node scripts/after.mjs",
    "  later:",
    "    steps:",
    "      - run: node scripts/fresh-job.mjs",
  ].join("\n");
  assert.deepEqual(preInstallScripts(yaml), ["scripts/before.mjs", "scripts/fresh-job.mjs"],
    "a script after `npm ci` is safe; a new job starts uninstalled again");
});
