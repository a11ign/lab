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
 * ## ONE GUARD, NOT TWO — `build-bootstrap-no-workspace-imports.test.ts` is deleted by this change
 *
 * Two guards for one class were written independently within an hour, and two guards for one class
 * DRIFT: the next person adding an entry adds it to whichever they happened to open. That is this
 * repository's most-recorded shape and neither of us should ship a second instance of it.
 *
 * The deleted guard walked `build-packages.mjs`'s own import graph and DECLARED the rest in an
 * `ALSO_CONSTRAINED` list of `ci-changed.mjs` and `install-git-hooks.mjs`. Measured on `main` before
 * deleting it: **zero mentions of `workflow-run-liveness.mjs`** — the entry that had been crashing on
 * this exact import on every run since it was written, reporting SUCCESS each time because its only
 * step carries `continue-on-error: true`.
 *
 * **That is not a criticism of its author.** It is the identical limitation this file's own first
 * version had, and neither list could have contained a file nobody knew was in the population. It is
 * the argument for deriving, arrived at twice in one morning by two people independently.
 *
 * It did real work while it existed: it is what caught the reintroduced import in a live reproduction
 * when the build step itself stayed green.
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

// #725: BLANK COMMENTS BEFORE SCANNING -- otherwise the word "import" used as ordinary English inside a
// `//` comment (this repo writes a great many of them: "import `REPO` from here", "the import closure
// ... walks") lets the specifier regex's own lazy `from ... quote` clause bridge, unbounded, to the NEXT
// unrelated quoted string anywhere later in the file, and report THAT as a package specifier. Measured
// live on #725: adding one real relative import to `arm-pr.mjs` made `acceptance-commands.mjs` and (via
// a worked-example import shown inside `local-import-closure.mjs`'s own docstring) `board-data.mjs`
// reachable for the first time, and both produced a bogus offender this way.
//
// A SINGLE ALTERNATION, not `local-import-closure.mjs`'s own sequential block-comment-then-line-comment
// `stripComments` -- that one is a DIFFERENT bug: running the block-comment pass over the whole text
// first means a `//` line comment that happens to contain a slash-star sequence (this repo's own
// npm-scope wildcard notation for the `@a11ign` org, written as `@a11ign` followed by a slash and a
// star, used constantly in comments) is read as a block-comment START, silently swallowing everything
// up to the next real slash-star closer -- which is exactly how it ate the real
// `import { changedPackages } from "./changed-packages.mjs"` line whole. Trying BOTH alternatives at
// every position, in order, and taking whichever matches at that exact spot resolves it correctly: at
// the position of a `//`, the block alternative requires the very next character to be a star, so a
// bare `//` never gets misread as a block start regardless of what appears later on the same line.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Every `import ... from "<spec>"` in a module, in source order. */
function specifiersOf(source: string): string[] {
  // `from` is OPTIONAL: `import "./side-effect.mjs"` has none, and the first version of this could not
  // see one. Borrowed from `build-bootstrap-no-workspace-imports.test.ts`, which got it right first --
  // recorded rather than silently copied, because two guards covering one class is the drift this repo
  // pays for most and the next reader should know both exist.
  return [...stripComments(source).matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * Scripts a workflow invokes with no `npm ci`/`npm install` earlier in the same job.
 *
 * Read line by line rather than through a YAML parser, deliberately: `packages/control` cannot depend on
 * one (ADR 0012) and `lab-job.mjs` already slices its catalogue by the indentation the file commits to,
 * for the same reason. A job header resets the "has installed" state; an install step sets it.
 *
 * #558: A LINE THAT MERELY PRINTS THE SHAPE IS NOT AN INVOCATION OF IT -- the same "a file that only
 * MENTIONS spawning git has not spawned it" class this repo has hit repeatedly (`git-spawn-classification`,
 * the path-string search stripping comments first). `consumer-gate.yml`'s `check-pin` job tells a human
 * to regenerate via `echo "::error::... regenerate (node scripts/generate-consumer-gate.mjs) ..."`, inside
 * a job with no `npm ci` (it needs only `git`, never `node`) -- so the bare regex below read that ADVICE
 * TEXT as a pre-install invocation. `echo` lines are skipped before the invocation regex runs; a real
 * `run: node scripts/…` (or one inside a `run: |` block) never starts with `echo`, so nothing legitimate
 * is excluded.
 */
export function preInstallScripts(workflowText: string): string[] {
  const found: string[] = [];
  let installed = false;
  for (const line of workflowText.split("\n")) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) installed = false;          // a new job
    if (/npm (ci|install)\b/.test(line)) installed = true;
    if (installed) continue;
    if (/^\s*echo\b/.test(line)) continue;                                 // prose, not an invocation
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
 * Scripts invoked by an `action.yml` step whose `if:` includes `always()`.
 *
 * #567: A DIFFERENT PRE-INSTALL SHAPE THAN A WORKFLOW'S OWN, found by the V1 rehearsal (#324) rather than
 * by this file — `action.yml` (the composite action's own step list) is not one of the `.github/
 * workflows/*.yml` files `preInstallScripts` already walks, and its risk is not "before `npm ci` in
 * sequence" (`preInstallScripts`'s own rule): an ordinary step skips when an earlier one fails, but an
 * `always()` step runs REGARDLESS -- including the exact run where "Install a11ign" (the step that
 * creates `node_modules` in the action's own checkout) itself failed or never started. `action.yml`'s own
 * "Comment on the pull request" step is this shape, and #567 measured it crashing live: `post-comment.ts`
 * imported a workspace package, and the ONE step whose entire job is reporting honestly on failure was
 * itself unable to run under exactly the failure it exists to handle.
 *
 * Split into per-step chunks on `- name:`/`- uses:` (the same loose, indentation-tolerant boundary
 * `preInstallScripts` already trusts for a workflow job), so a chunk's own `if:` line can be checked
 * independently of whichever step precedes or follows it.
 */
export function alwaysStepScripts(actionYmlText: string): string[] {
  const found: string[] = [];
  const steps = actionYmlText.split(/(?=^\s*- (?:name|uses):)/m);
  for (const step of steps) {
    if (!/if:.*always\(\)/.test(step)) continue;
    for (const line of step.split("\n")) {
      const call = /\b(?:node|npx tsx)\s+([A-Za-z0-9._/-]+\.(?:mjs|ts))\b/.exec(line);
      if (call) found.push(call[1]);
    }
  }
  return found;
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
  const actionYml = join(REPO, "action.yml");
  if (existsSync(actionYml)) {
    for (const script of alwaysStepScripts(readFileSync(actionYml, "utf8"))) {
      entries.add(script);
    }
  }
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as
    { scripts: Record<string, string> };
  // `build` PRODUCES `dist`, so it cannot import from one. `prepare` is npm's own lifecycle hook: it
  // runs on every plain `npm install` in a fresh checkout, before any package's `dist/` exists.
  //
  // THE `prepare` REASON IS PRESERVED FROM `build-bootstrap-no-workspace-imports.test.ts`, the guard this
  // file replaced, and it is worth keeping verbatim because a derivation cannot express it: that script
  // is "not reachable via build-packages.mjs's own import graph; carries the identical constraint by npm
  // lifecycle timing rather than by being imported from the same entry point." The walk finds the file;
  // only that sentence says WHY it belongs.
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

// --- #725: specifiersOf strips comments before scanning, and does it correctly ---

test("#725: stripComments blanks a `//` comment that contains `@a11ign/*` -- this repo's own npm-scope "
  + "wildcard notation -- WITHOUT misreading the embedded `/*` as a block-comment start", () => {
  const source = [
    "// mentions the real `@a11ign/*` scope in a plain comment",
    'import { real } from "./real.mjs";',
  ].join("\n");
  assert.deepEqual(specifiersOf(source), ["./real.mjs"],
    "a `//` comment containing `/*`-shaped text must not swallow the real import that follows it");
});

test("#725 ACCEPTANCE, MUTATION TARGET: a plain-English \"import ... from\" inside a `//` comment, "
  + "followed much later by an unrelated quoted string, is not reported as a specifier -- exactly what "
  + "made board-data.mjs and acceptance-commands.mjs false offenders when arm-pr.mjs first reached them", () => {
  const source = [
    "// import `REPO` from here, so it stays exported at this one path",
    "const later = someCall(); // a totally unrelated line reading \"not a specifier\" out loud",
  ].join("\n");
  assert.deepEqual(specifiersOf(source), []);
});

test("#725: specifiersOf still finds a real import sitting right after a comment containing the word "
  + "\"import\"", () => {
  const source = [
    "// this comment mentions import as an ordinary word",
    'import { real } from "./real.mjs";',
  ].join("\n");
  assert.deepEqual(specifiersOf(source), ["./real.mjs"]);
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

test("#558 MUTATION TARGET: an echo line MENTIONING a script's name is not read as invoking it -- "
  + "the same 'a mention is not a use' shape this repo has hit for comments and path strings, arriving "
  + "here through advice text printed inside a job that has no npm ci because it never needs node at "
  + "all (consumer-gate.yml's check-pin, which only runs git)", () => {
  const yaml = [
    "jobs:",
    "  check-pin:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: |",
    '          echo "::error::regenerate (node scripts/generate-consumer-gate.mjs) and dispatch again"',
  ].join("\n");
  assert.deepEqual(preInstallScripts(yaml), [],
    "an echo string naming a script is prose, not a pre-install invocation of it");
});

test("#567 alwaysStepScripts: finds a script invoked by an always() step, ignores one that isn't", () => {
  // Driven against a fixture, same reasoning as preInstallScripts's own test above: the real action.yml
  // could stop having any always() step tomorrow and this must not go blind to the shape when that happens.
  const yaml = [
    "steps:",
    "  - name: Install a11ign",
    "    run: npm ci",
    "  - name: Report",
    "    run: |",
    "      npx tsx packages/cli/src/action/run.ts --result=out.json",
    "  - name: Comment on the pull request",
    "    if: ${{ always() && inputs.comment-on-pr == 'true' }}",
    "    run: |",
    "      npx tsx packages/cli/src/action/post-comment.ts --summary=x.md",
  ].join("\n");
  assert.deepEqual(alwaysStepScripts(yaml), ["packages/cli/src/action/post-comment.ts"],
    "only the always()-gated step's script belongs -- an ordinary sequential step (Report) is safe "
    + "because it is skipped, not run, when an earlier step fails");
});

test("#567 alwaysStepScripts: a step with no always() in its `if:` is not swept in", () => {
  const yaml = [
    "steps:",
    "  - name: Something conditional",
    "    if: ${{ github.event_name == 'pull_request' }}",
    "    run: node scripts/conditional.mjs",
  ].join("\n");
  assert.deepEqual(alwaysStepScripts(yaml), []);
});

test("#567 MUTATION TARGET: post-comment.ts is discovered as a pre-install entry via action.yml's own "
  + "always() step, not merely present in the tree", () => {
  assert.ok(preInstallEntries().includes("packages/cli/src/action/post-comment.ts"),
    "action.yml's real 'Comment on the pull request' step must be discovered by alwaysStepScripts");
});
