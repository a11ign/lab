/**
 * A TREE-WALKING GUARD MAY DECLARE THE SUBTREE IT WALKS, AND ITS OWN RUN MUST PROVE IT — #929.
 *
 * `alwaysRunTests` runs every guard whose population is discovered from the tree, on every pull request,
 * because a file added anywhere can join such a population. That is right for a guard whose population IS
 * the repository, and it stays exactly as it is. Measured by running all 131 always-run guards under the
 * observer: 38 walk the whole repository and 69 read inside a product package, but 24 read nothing a
 * product diff can touch — 6 of them nothing outside their own imports at all.
 *
 * So a guard may declare its scope, and `narrowByDeclaredScope` leaves it out of a run whose diff touches
 * none of it. The three properties this file pins are the row's acceptance:
 *
 *   - a declared guard is left out of a diff outside its scope, and kept for one inside it — BOTH directions;
 *   - a guard that declares nothing is kept exactly as today — the safe default, asserted;
 *   - a declaration narrower than what the guard actually reads FAILS THE GUARD'S OWN RUN. Without this the
 *     row ships a promise.
 *
 * The third is tested by RUNNING a fixture guard, not by describing one: a declaration check that has never
 * been seen to fail is the canary that cannot express its fault.
 *
 * This file never declares a scope of its own — it walks every test file in the repository to find the
 * guards that do — and it names the declaration only by concatenation, so the parser it tests does not read
 * this file as a declaration either.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fsModule, {
  closeSync, copyFileSync, globSync, mkdirSync, mkdtempSync, openAsBlob, openSync, readFileSync, readdir, readdirSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import moduleApi, { builtinModules, createRequire } from "node:module";
import * as nodeTest from "node:test";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { tmpdir } from "node:os";
import childProcessModule, { execSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import {
  DECLARER_BUILTINS, ESM_UNSYNCED, NOT_WRAPPED, WHOLE_REPOSITORY, inScope, isObserved, parseWalkScope, readsDuring,
} from "../../../../scripts/walk-scope.mjs";
import { knownPackages } from "../../../../scripts/ci-changed.mjs";
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { withGitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";
import {
  alwaysRunTests, broadReasons, discoverTestFiles, narrowByDeclaredScope, packageIndex, sourceClosure,
} from "../../../../scripts/select-changed-tests.mjs";
// #939: the shared reader every "which paths changed" caller now imports.
import { changedFiles } from "../../../../scripts/changed-files.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const W = "WALK" + "_SCOPE";
const declaring = (scope: string) => `import { test } from "node:test";\nexport const ${W} = ${scope};\n`;

// ---------------------------------------------------------------------------------------------------------
// The declaration, read statically.
// ---------------------------------------------------------------------------------------------------------

test("a declaration is read exactly, and trailing slashes do not change the scope", () => {
  assert.deepEqual(parseWalkScope(declaring(`["scripts", "docs/"]`)), ["scripts", "docs"]);
});

test("NOT DECLARED and DECLARED EMPTY are different answers", () => {
  // `null` keeps today's always-run behaviour; `[]` claims the guard reads nothing outside its own imports,
  // which its run then has to prove. Collapsing them is how a guard would stop running with nobody deciding.
  assert.equal(parseWalkScope(`const a = 1;\n`), null);
  assert.deepEqual(parseWalkScope(declaring("[]")), []);
});

test("a mention in a string, a comment, or a fixture inside a template is not a declaration", () => {
  // The selector parses every always-run guard. If a mention counted, a test that merely talks about the
  // declaration would crash selection for every pull request.
  assert.equal(parseWalkScope(`assert.equal(x, "${W} is missing");\n`), null);
  assert.equal(parseWalkScope(`// ${W} would go here\nconst a = 1;\n`), null);
  assert.equal(parseWalkScope("const fixture = `\n" + `export const ${W} = ["docs"];\n` + "`;\n"), null);
});

test("a name in code that is not the one parseable declaration is REFUSED, never guessed", () => {
  // Read as undeclared, a malformed declaration keeps the guard running; read as `[]`, it would stop it.
  assert.throws(() => parseWalkScope(`const ${W} = computeIt();\n`), /refusing to guess/);
  assert.throws(() => parseWalkScope(declaring("[ROOT]")), /not a string literal/);
});

test("a scope entry covers itself and everything under it, and nothing that merely shares a prefix", () => {
  assert.equal(inScope("scripts", ["scripts"]), true);
  assert.equal(inScope("scripts/merge-guard.mjs", ["scripts"]), true);
  assert.equal(inScope("scripts-old/x.mjs", ["scripts"]), false, "a shared prefix is not a subtree");
  assert.equal(inScope("scripts/x.mjs", []), false, "an empty scope covers nothing");
});

// ---------------------------------------------------------------------------------------------------------
// Selection.
// ---------------------------------------------------------------------------------------------------------

const GUARDS = [
  { test: "g/declares-scripts.test.ts", why: "walks the tree itself" },
  { test: "g/declares-nothing.test.ts", why: "walks the tree itself" },
  { test: "g/declares-empty.test.ts", why: "imports the tree walker x" },
];
const SOURCES: Record<string, string> = {
  "g/declares-scripts.test.ts": declaring(`["scripts"]`),
  "g/declares-nothing.test.ts": `const walk = 1;\n`,
  "g/declares-empty.test.ts": declaring("[]"),
};
const readSource = (rel: string) => SOURCES[rel];

test("BOTH DIRECTIONS: a guard declaring scripts/ is left out of a judge diff and kept for a scripts diff", () => {
  const product = narrowByDeclaredScope(GUARDS, ["packages/judge/src/rules.ts"], { readSource });
  assert.ok(product.narrowed.some((n) => n.test === "g/declares-scripts.test.ts"));
  const pipeline = narrowByDeclaredScope(GUARDS, ["scripts/merge-guard.mjs"], { readSource });
  const kept = pipeline.kept.find((g) => g.test === "g/declares-scripts.test.ts");
  assert.ok(kept, "a diff inside the declared scope must keep the guard");
  assert.match(kept!.why, /declared walk scope \(scripts\) is touched/, "and say why it is running");
});

test("THE SAFE DEFAULT: a guard that declares nothing is kept on every diff, exactly as today", () => {
  for (const diff of [["packages/judge/src/rules.ts"], ["scripts/x.mjs"], ["docs/y.md"], []]) {
    const { kept } = narrowByDeclaredScope(GUARDS, diff, { readSource });
    assert.ok(kept.some((g) => g.test === "g/declares-nothing.test.ts" && g.why === "walks the tree itself"),
      `undeclared must be kept unchanged on ${JSON.stringify(diff)}`);
  }
});

test("a guard declaring an EMPTY scope is left out of every diff — its own imports still select it", () => {
  // Precise selection by import closure is untouched by this, so a change to the guard or anything it
  // imports still runs it. `[]` only removes it from the run it was never able to be affected by.
  const { narrowed } = narrowByDeclaredScope(GUARDS, ["scripts/x.mjs", "docs/y.md"], { readSource });
  assert.ok(narrowed.some((n) => n.test === "g/declares-empty.test.ts"));
});

test("with NO declarations anywhere, narrowing changes nothing at all", () => {
  const undeclared = GUARDS.map((g) => ({ ...g }));
  const plain = (rel: string) => (rel ? "const walk = 1;\n" : "");
  const { kept, narrowed } = narrowByDeclaredScope(undeclared, ["packages/judge/src/rules.ts"], { readSource: plain });
  assert.deepEqual(kept, undeclared);
  assert.deepEqual(narrowed, []);
});

test("A RENAME OUT OF THE SCOPE keeps the guard: the diff names the side that LEFT, not only where it went", () => {
  // `git diff --name-only` detects renames by default and prints only the destination. A PR moving
  // `scripts/a.mjs` to `tools/a.mjs` listed `tools/a.mjs` alone, and a guard declared on `scripts` -- whose
  // population had just lost a file -- was left out of the run that lost it.
  withGitSandbox(({ dir, run, commit }) => {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts/a.mjs"), "export const a = 1;\n");
    run(["add", "."]);
    commit("base");
    const base = run(["rev-parse", "HEAD"]).trim();
    mkdirSync(join(dir, "tools"));
    run(["mv", "scripts/a.mjs", "tools/a.mjs"]);
    commit("move a script out of scripts/");
    const files = changedFiles([`${base}...HEAD`], { repoRoot: dir });
    assert.deepEqual(files, ["scripts/a.mjs", "tools/a.mjs"]);
    const guard = [{ test: "g.test.ts", why: "walks the tree" }];
    const { kept } = narrowByDeclaredScope(guard, files, { readSource: () => declaring(`["scripts"]`) });
    assert.equal(kept.length, 1, "a guard over scripts/ must run on the PR that moved a file out of it");
  });
});

// ---------------------------------------------------------------------------------------------------------
// The guard's own run checks its declaration — RUN, not described.
// ---------------------------------------------------------------------------------------------------------

/** A fixture guard's test body that reads each of `paths`. */
const reading = (paths: string[]) => `for (const p of ${JSON.stringify(paths)}) fs.readFileSync(p, "utf8");`;

/** Run a fixture guard that declares `scope` and runs `body`, from the repository root, as CI would. */
function runFixtureGuard(scope: string, body: string) {
  const dir = mkdtempSync(join(tmpdir(), "walk-scope-"));
  // `.mts`, not `.ts`: a temp directory has no `package.json` saying `"type": "module"`, so a `.ts` file
  // there compiles as CommonJS, where the top-level `await` a declaring guard needs is a transform error.
  // The first version of this fixture was `.ts` and "failed" for that reason rather than the one asserted.
  const file = join(dir, "fixture.test.mts");
  const walkScope = pathToFileURL(join(REPO, "scripts/walk-scope.mjs")).href;
  writeFileSync(file, [
    `import { declareWalkScope } from ${JSON.stringify(walkScope)};`,
    `import { test } from "node:test";`,
    `import * as fs from "node:fs";`,
    `import { spawnSync } from "node:child_process";`,
    `import { join } from "node:path";`,
    `import { tmpdir } from "node:os";`,
    `export const ${W} = ${scope};`,
    `await declareWalkScope(import.meta.url);`,
    `const REPO = ${JSON.stringify(REPO)};`,
    `test("reads", () => { ${body} });`,
    "",
  ].join("\n"));
  // `NODE_TEST_CONTEXT` scrubbed: node sets it for a test's children, and a nested `--test` run then reports
  // over the parent's protocol instead of printing -- empty stdout, exit 0, no error. The first version of
  // this fixture inherited it, and the positive control's exit code said green while its output said
  // nothing had run. Same defect `pre-push-fast-gate.test.ts` records one layer over.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const npx = npmCliInvocation("npx", ["tsx", "--test", "--test-reporter=spec", file]);
    return spawnSync(npx.command, npx.args, { cwd: REPO, env, encoding: "utf8", timeout: 120_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("A DECLARATION NARROWER THAN THE WALK FAILS THE GUARD'S OWN RUN", () => {
  // The row's mutation, made permanent: declared `docs`, read a product file.
  const run = runFixtureGuard(`["docs"]`, reading(["packages/judge/src/rules.ts"]));
  assert.notEqual(run.status, 0, "a guard that reads outside its declaration must fail");
  assert.match(`${run.stdout}${run.stderr}`,
    /declares WALK_SCOPE \["docs"\] and read 1 path\(s\) outside it: packages\/judge\/src\/rules\.ts/,
    "and the failure must name what it read, so the fix is followable");
});

test("...and a declaration that covers the walk passes — or the check above could be failing on everything", () => {
  const run = runFixtureGuard(`["packages/judge"]`, reading(["packages/judge/src/rules.ts"]));
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  // AND IT RAN. Exit 0 alone is not a pass: the first version of this fixture could not compile, and an
  // assertion on the exit code reported the control as green. The fixture's one test must be seen passing.
  assert.match(run.stdout, /ℹ pass 1\b/, "the fixture's own test must have run and passed");
  assert.match(run.stdout, /ℹ fail 0\b/);
});

test("THE REVIEW'S FIXTURE: a guard declaring docs that reads the whole repository by four routes FAILS its own run", () => {
  // worker-judge's reproduction on #938, which passed at `86029cfd` with `ℹ pass 1`. One route per family.
  const body = [
    `spawnSync("git", ["ls-files", ":(exclude)docs"], { cwd: REPO });`,
    `const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: REPO, encoding: "utf8" }).stdout.trim();`,
    `const away = fs.mkdtempSync(join(tmpdir(), "fixture-away-"));`,
    `spawnSync("git", ["-C", away, "--git-dir", gitDir, "ls-files"]);`,
    `fs.copyFileSync(join(REPO, "packages/judge/src/rules.ts"), join(away, "r.ts"));`,
    `fs.readFileSync(join(REPO, "node_modules/@a11ign/judge/package.json"));`,
    `fs.rmSync(away, { recursive: true, force: true });`,
  ].join(" ");
  const run = runFixtureGuard(`["docs"]`, body);
  const said = `${run.stdout}${run.stderr}`;
  assert.notEqual(run.status, 0, `the review's fixture must fail its own run:\n${said.slice(-1500)}`);
  assert.match(said, /declares WALK_SCOPE \["docs"\] and read \d+ path\(s\) outside it/);
  assert.match(said, /\(the whole repository\) -- git ls-files/, "the pathspec magic, named");
  assert.match(said, /pointed back at this checkout/, "the --git-dir from elsewhere, named");
  assert.match(said, /packages\/judge\/src\/rules\.ts/, "the copied file, named");
});

// ---------------------------------------------------------------------------------------------------------
// Every route to the tree is SEEN, or fails closed. An unseen read is a false pass: a declaration narrower
// than the walk, checked by an observer that missed the walk, reads as verified. The first observer wrapped
// only the sync `fs` calls and `git` in argv form -- `await readdir(...)`, `openSync`, `execSync("git ...")`
// and any child process all walked past it.
// ---------------------------------------------------------------------------------------------------------

const JUDGE = "packages/judge";
const MANIFEST = `${JUDGE}/package.json`;
// Scrubbed of `GIT_*`: run from a hook, a leaked `GIT_DIR` would point these at another repository.
const inRepo = { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" as const };
const isUnbounded = (reads: string[]) => reads.length === 1 && reads[0].startsWith(WHOLE_REPOSITORY);

test("fs.promises -- the same object as node:fs/promises -- is seen", async () => {
  assert.deepEqual(await readsDuring(() => readFile(join(REPO, MANIFEST), "utf8")), [MANIFEST]);
});

test("a callback readdir is seen", async () => {
  const reads = await readsDuring(() => new Promise((done, fail) =>
    readdir(join(REPO, JUDGE), (error) => (error ? fail(error) : done(undefined)))));
  assert.deepEqual(reads, [JUDGE]);
});

test("openSync is seen, so a read through a file descriptor is not a way round", async () => {
  assert.deepEqual(await readsDuring(() => closeSync(openSync(join(REPO, MANIFEST), "r"))), [MANIFEST]);
});

test("LISTING THE ROOT is the whole repository, never nothing -- the root was once dropped as an empty path", async () => {
  assert.ok(isUnbounded(await readsDuring(() => readdirSync(REPO))));
});

test("a glob is recorded at its static prefix, resolved against its OWN cwd", async () => {
  // The prefix, and nothing outside it -- not an exact list. Node's glob stats each literal segment through
  // `fs`, and whether those stats are seen depends on whether its internals loaded before the observer did:
  // measured, they are with the observer on `--import` and are not with it imported here.
  const within = (reads: string[], prefix: string) =>
    reads.includes(prefix) && reads.every((read) => inScope(read, [prefix]));
  const judge = await readsDuring(() => globSync("*.json", { cwd: join(REPO, JUDGE) }));
  assert.ok(within(judge, JUDGE), judge.join(", "));
  const every = await readsDuring(() => globSync("packages/*/package.json", { cwd: REPO }));
  assert.ok(within(every, "packages"), every.join(", "));
});

test("git ls-files is bounded by its pathspecs, read against -C, past git's own -c", async () => {
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["-C", "packages", "ls-files", "judge"], inRepo)), [JUDGE]);
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["-c", "core.quotepath=off", "ls-files", JUDGE], inRepo)),
    [JUDGE], "an unskipped `-c` value reads as the subcommand -- unknown, so the whole repository");
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files"], inRepo))), "no pathspec is the whole tree");
});

test("git grep's first operand is its PATTERN: only what follows -- bounds it", async () => {
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["grep", "-l", "packages/judge"], inRepo))));
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["grep", "-l", "x", "--", JUDGE], inRepo)), [JUDGE]);
});

test("git history readers are the whole repository; rev-parse reads no population", async () => {
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["log", "-1", "--format=%H"], inRepo))));
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["rev-parse", "HEAD"], inRepo)), []);
});

test("a shell string is parsed only when it is plain git; a pipeline is the whole repository", async () => {
  assert.deepEqual(await readsDuring(() => execSync(`git ls-files ${JUDGE}`, inRepo)), [JUDGE]);
  assert.ok(isUnbounded(await readsDuring(() => execSync(`git ls-files ${JUDGE} | head -1`, inRepo))));
});

test("ANY OTHER CHILD PROCESS is the whole repository -- what it reads is not visible, so it cannot be verified", async () => {
  assert.ok(isUnbounded(await readsDuring(() => spawnSync(process.execPath, ["-e", "0"]))));
});

test("a WORKER THREAD is the whole repository -- it reads off this thread, where nothing is observed", async () => {
  const reads = await readsDuring(async () => {
    const worker = new Worker("0", { eval: true });
    await once(worker, "exit");
  });
  assert.ok(isUnbounded(reads), reads.join(", "));
});

test("the wrappers keep what they wrap: realpathSync.native still resolves", () => {
  assert.equal(realpathSync.native(REPO), realpathSync(REPO));
});

// --- worker-judge's review of #938: eleven routes, each a false pass at `86029cfd`, in four families. ---

const gitDirectory = () => spawnSync("git", ["rev-parse", "--absolute-git-dir"], inRepo).stdout.trim();

test("PATHSPEC MAGIC is the whole repository: `:(exclude)docs` is everything EXCEPT docs", async () => {
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", ":(exclude)docs"], inRepo))));
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", ":!docs"], inRepo))));
  // `:^` is the spelling the glob-prefix rule does NOT already catch -- no glob syntax in it -- so it is the one
  // that shows the magic check is load-bearing rather than redundant.
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", ":^docs"], inRepo))));
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["grep", "-l", "x", "--", ":(exclude)docs"], inRepo))));
});

test("an OPTION is never read as a pathspec: one that can change which files are read is the whole repository", async () => {
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", "-x", "docs"], inRepo))));
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", "--exclude-from", "docs/README.md"], inRepo))));
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["ls-files", "--exclude-standard", "-o", JUDGE], inRepo))),
    "--exclude-standard reads the root .gitignore, which no declaration of packages/judge covers");
  assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["grep", "-f", "docs/README.md", "--", JUDGE], inRepo))),
    "-f reads a pattern FILE");
  // The control: options known to bound nothing away keep the pathspec, or every option would fail closed.
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["ls-files", "-z", "--cached", JUDGE], inRepo)), [JUDGE]);
  assert.deepEqual(await readsDuring(() => spawnSync("git", ["grep", "-il", "-e", "x", "--", JUDGE], inRepo)), [JUDGE]);
});

test("a git run from ELSEWHERE that is pointed back here is the whole repository: --git-dir, GIT_DIR, a clone source", async () => {
  const gitDir = gitDirectory();
  const away = mkdtempSync(join(tmpdir(), "walk-scope-away-"));
  const fromAway = { cwd: away, env: sandboxGitEnv(), encoding: "utf8" as const };
  try {
    assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", ["--git-dir", gitDir, "ls-files"], fromAway))));
    assert.ok(isUnbounded(await readsDuring(() => spawnSync("git", [`--git-dir=${gitDir}`, "ls-files"], fromAway))));
    assert.ok(isUnbounded(await readsDuring(() =>
      spawnSync("git", ["ls-files"], { ...fromAway, env: sandboxGitEnv({ GIT_DIR: gitDir }) }))),
    "git exports GIT_DIR into every hook, so an inherited one points a temp-directory run straight back here");
    assert.ok(isUnbounded(await readsDuring(() =>
      spawnSync("git", ["clone", "-q", "--shared", "--no-checkout", REPO, "copy"], fromAway))));
    // The control: a fixture repository of its own, pointed at nothing here, still reads nothing here.
    assert.deepEqual(await readsDuring(() => spawnSync("git", ["init", "-q", "fixture"], fromAway)), []);
  } finally {
    rmSync(away, { recursive: true, force: true });
  }
});

test("a read INSIDE the git directory is the whole repository -- in a worktree, that directory is outside it", async () => {
  assert.ok(isUnbounded(await readsDuring(() => statSync(join(gitDirectory(), "HEAD")))));
});

test("copyFile and openAsBlob are seen -- two reads a hand-written list of wrappers did not name", async () => {
  const away = mkdtempSync(join(tmpdir(), "walk-scope-copy-"));
  try {
    assert.deepEqual(await readsDuring(() => copyFileSync(join(REPO, MANIFEST), join(away, "m.json"))), [MANIFEST]);
    assert.deepEqual(await readsDuring(() => openAsBlob(join(REPO, MANIFEST))), [MANIFEST]);
  } finally {
    rmSync(away, { recursive: true, force: true });
  }
});

test("EVERY function on fs, child_process, node:test, node:module, process and worker_threads is wrapped, or named in NOT_WRAPPED", () => {
  // Asked of the objects themselves, on whichever Node runs this, so a route a later Node adds fails HERE
  // instead of passing a guard. A hand-written list is how `copyFile` and `openAsBlob` went unseen.
  const asRecord = (value: unknown) => value as Record<string, unknown>;
  const owners: Array<[string, Record<string, unknown>, Readonly<Record<string, string>>]> = [
    ["fs", asRecord(fsModule), NOT_WRAPPED.fs],
    ["fs.promises", asRecord(fsModule.promises), NOT_WRAPPED.fs],
    ["child_process", asRecord(childProcessModule), NOT_WRAPPED.child_process],
    // #938's second review: the allowlisted builtins whose surface starts something or takes a path.
    ["test", asRecord(nodeTest.default ?? nodeTest), NOT_WRAPPED.test],
    ["module", asRecord(moduleApi), NOT_WRAPPED.module],
    ["process", asRecord(process), NOT_WRAPPED.process],
    ["worker_threads", asRecord(createRequire(import.meta.url)("node:worker_threads")), NOT_WRAPPED.worker_threads],
  ];
  const unaccounted: string[] = [];
  const listedYetWrapped: string[] = [];
  for (const [label, owner, reasons] of owners) {
    for (const [name, value] of Object.entries(owner)) {
      if (typeof value !== "function") continue;
      const listed = (label.startsWith("fs") ? name.replace(/Sync$/, "") : name) in reasons;
      if (!isObserved(value) && !listed) unaccounted.push(`${label}.${name}`);
      if (isObserved(value) && listed) listedYetWrapped.push(`${label}.${name}`);
    }
  }
  assert.deepEqual(unaccounted, [], "neither wrapped nor given the reason it cannot read a path unseen");
  assert.deepEqual(listedYetWrapped, [], "given a reason not to be wrapped, and wrapped anyway -- the list has drifted");
});

test("a path through a LINK is classified by where it leads", async () => {
  // Deterministic: a link from outside the checkout into it.
  const away = mkdtempSync(join(tmpdir(), "walk-scope-link-"));
  try {
    symlinkSync(join(REPO, JUDGE), join(away, "judge"));
    assert.deepEqual(await readsDuring(() => readFileSync(join(away, "judge/package.json"))), [MANIFEST]);
  } finally {
    rmSync(away, { recursive: true, force: true });
  }
  // The real workspace link, `node_modules/@a11ign/judge`: `packages/judge` wherever `npm ci` ran in this
  // checkout, CI included. A worktree borrowing another checkout's node_modules leads OUT, and reads nothing here.
  const link = join(REPO, "node_modules/@a11ign/judge");
  const leadsTo = relative(REPO, realpathSync(link));
  const expected = leadsTo.startsWith("..") ? [] : [`${leadsTo}/package.json`];
  assert.deepEqual(await readsDuring(() => readFileSync(join(link, "package.json"))), expected);
});

test("THIRD-PARTY node_modules is excluded ONLY because a lockfile change is a broad diff -- the premise, pinned", async (t) => {
  // A broad diff runs every guard before any narrowing, so what `npm ci` installed cannot differ on a run
  // that left a guard out. If either of these stopped being broad, this exclusion would become a false pass.
  assert.deepEqual(broadReasons(["package-lock.json"]), ["package-lock.json"]);
  assert.deepEqual(broadReasons(["package.json"]), ["package.json"]);
  // A probe of our own, because a real package can be a LINK to another checkout's node_modules (a worktree
  // set up that way) -- where a read leads out of this checkout and the exclusion is never reached, and this
  // assertion first passed having tested nothing.
  const modules = join(REPO, "node_modules");
  if (relative(REPO, realpathSync(modules)).startsWith("..")) {
    t.skip("node_modules here is a link to another checkout's, so no read under it can land in this one");
    return;
  }
  const probe = mkdtempSync(join(modules, ".walk-scope-probe-"));
  try {
    writeFileSync(join(probe, "package.json"), "{}");
    assert.deepEqual(await readsDuring(() => readFileSync(join(probe, "package.json"))), []);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
});

// --- worker-judge's second review of #938: allowlisted builtins that read or start something unseen. ---

test("node:test's run() is the whole repository -- it starts its files through Node's INTERNAL spawn", async () => {
  // Through the default export, the CommonJS object the wrapper sits on. The named ESM binding is NOT
  // re-pointed (ESM_UNSYNCED), which is why that spelling is refused in a declarer's source instead.
  const reads = await readsDuring(async () => {
    for await (const event of nodeTest.default.run({ files: [] })) void event;
  });
  assert.ok(isUnbounded(reads), reads.join(", "));
});

test("every WRAPPED function's ESM binding IS the wrapper -- or is named in ESM_UNSYNCED with what covers it", async () => {
  // `syncBuiltinESMExports` is what makes `import { readdir } from "node:fs"` reach a wrapper, and it does not
  // reach `node:test`: measured, and the reason this is a test rather than a sentence in a header.
  const specifiers: Record<string, string> = { fs: "node:fs", "child_process": "node:child_process",
    test: "node:test", module: "node:module", "worker_threads": "node:worker_threads" };
  const unsynced: string[] = [];
  for (const [label, specifier] of Object.entries(specifiers)) {
    const namespace = await import(specifier) as Record<string, unknown>;
    const cjs = createRequire(import.meta.url)(specifier) as Record<string, unknown>;
    for (const [name, value] of Object.entries(cjs)) {
      if (!isObserved(value) || namespace[name] === value) continue;
      const covered = (ESM_UNSYNCED as Record<string, Record<string, string>>)[label]?.[name];
      if (!covered) unsynced.push(`${specifier}.${name}`);
    }
  }
  assert.deepEqual(unsynced, [], "wrapped on the CommonJS object, unwrapped where an ESM import reaches it");
});

test("process.loadEnvFile and process.dlopen read their file through an internal binding, so they are wrapped", async () => {
  // `.gitignore` has no `=` in it, so loading it as an env file sets nothing.
  assert.deepEqual(await readsDuring(() => process.loadEnvFile(join(REPO, ".gitignore"))), [".gitignore"]);
  assert.deepEqual(await readsDuring(() => assert.throws(() => process.dlopen({ exports: {} }, join(REPO, MANIFEST)))), [MANIFEST]);
});

test("getBuiltinModule of a builtin OFF the allowlist is the whole repository -- no import names it", async () => {
  assert.ok(isUnbounded(await readsDuring(() => process.getBuiltinModule("node:vm"))));
  assert.deepEqual(await readsDuring(() => process.getBuiltinModule("node:path")), []);
  const raw = process as unknown as { binding: (name: string) => unknown };
  assert.ok(isUnbounded(await readsDuring(() => assert.throws(() => raw.binding("walk-scope-no-such-binding")))));
});

test("a CommonJS resolution is recorded -- what require.resolve found, or where a relative request looked", async () => {
  const requireFromJudge = createRequire(join(REPO, JUDGE, "src", "index.ts"));
  assert.deepEqual(await readsDuring(() => requireFromJudge.resolve("../package.json")), [MANIFEST]);
  assert.deepEqual(await readsDuring(() => assert.throws(() => requireFromJudge.resolve("./walk-scope-absent.mjs"))),
    [`${JUDGE}/src/walk-scope-absent.mjs`]);
});

test("findPackageJSON reads the directory it walked, and a loader hook is the whole repository", async () => {
  const find = (moduleApi as unknown as { findPackageJSON?: (s: string, b: string) => string | undefined }).findPackageJSON;
  if (find) assert.deepEqual(await readsDuring(() => find("./rules.ts", pathToFileURL(join(REPO, JUDGE, "src", "x.ts")).href)), [JUDGE]);
  assert.ok(isUnbounded(await readsDuring(() => assert.throws(() => (moduleApi.register as unknown as () => void)()))));
});

// ---------------------------------------------------------------------------------------------------------
// The repository as it is.
// ---------------------------------------------------------------------------------------------------------

type Guard = { test: string, why: string };
let repoGuards: Guard[];
let declarers: string[];
before(() => {
  // The selector's own index, not a third copy of it -- this file checks what the selector acts on.
  const dirs = knownPackages(REPO);
  const packages = packageIndex(REPO, dirs);
  const every = discoverTestFiles(REPO, dirs);
  repoGuards = alwaysRunTests(every, { closureOf: (t: string) => sourceClosure(join(REPO, t), REPO, packages), repoRoot: REPO });
  declarers = every.filter((t: string) => parseWalkScope(readFileSync(join(REPO, t), "utf8")) !== null);
});

test("every declaring guard imports walk-scope FIRST and runs its own check", () => {
  // The observer sees only reads made after it is imported, so a declaration whose import comes second
  // could pass having missed the reads above it. And a declaration without the call is a promise nobody
  // checks — the version of this row that must not ship.
  assert.ok(declarers.length > 0, "no guard declares a scope — this check examined nothing");
  for (const file of declarers) {
    const source = readFileSync(join(REPO, file), "utf8");
    const firstImport = source.split("\n").find((line) => line.startsWith("import "));
    assert.match(firstImport ?? "", /walk-scope\.mjs"/, `${file}: the walk-scope import must be the FIRST import`);
    assert.match(source, /await declareWalkScope\(import\.meta\.url\)/, `${file}: declares a scope and never checks it`);
  }
});

const ALLOWED_BUILTINS = new Set<string>(Object.keys(DECLARER_BUILTINS));
const BUILTINS = new Set(builtinModules);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Each ESM_UNSYNCED name this source can bind through ESM -- derived from the table, so an unsynced module
 * added there is refused here with no second list. EVERY spelling that can carry the name: a named import
 * (alone or beside a default), a named RE-EXPORT, a namespace import, a `*` re-export, and a dynamic import.
 * worker-judge's third review found the re-exports: a helper's `export { run } from "node:test"` handed a
 * declarer the unwrapped function, and neither file matched the import-only spellings.
 */
function unsyncedBindingsIn(code: string): string[] {
  const found: string[] = [];
  for (const [module, names] of Object.entries(ESM_UNSYNCED as Record<string, Record<string, string>>)) {
    const from = String.raw`\s*from\s*["'](?:node:)?${escapeRegExp(module)}["']`;
    const opener = String.raw`\b(?:import\s+(?:[\w$]+\s*,\s*)?|export\s*)`;
    const whole = new RegExp(String.raw`${opener}\*(?:\s*as\s+[\w$]+)?${from}|\bimport\s*\(\s*["'](?:node:)?${escapeRegExp(module)}["']\s*\)`);
    for (const name of Object.keys(names)) {
      const named = new RegExp(String.raw`${opener}\{[^}]*\b${escapeRegExp(name)}\b[^}]*\}${from}`);
      if (named.test(code) || whole.test(code)) found.push(`node:${module}'s ${name}`);
    }
  }
  return found;
}

/** Each route in one source file that reads through nothing the observer wraps -- empty when there is none. */
function unseenRoutesIn(code: string): string[] {
  const found: string[] = [];
  if (/\bimport\s*\(\s*[^"'`\s)]/.test(code)) found.push("imports a computed path");
  if (/\bnew\s+(?:\w+\.)?(?:File)?ReadStream\s*\(|\bnew\s+(?:\w+\.)?ChildProcess\s*\(/.test(code)) {
    found.push("builds a stream or a process by hand");
  }
  if (/\bimport\.meta\.resolve\s*\(/.test(code)) found.push("resolves a specifier through the ESM loader");
  for (const binding of unsyncedBindingsIn(code)) found.push(`reaches ${binding} through a binding the observer cannot re-point`);
  if (/\._(?:findPath|load|resolveFilename|resolveLookupPaths|nodeModulePaths|initPaths|preloadModules)\s*\(/.test(code)) {
    found.push("calls Node's module internals directly");
  }
  for (const [, spec] of code.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)) {
    const name = spec.replace(/^node:/, "");
    const builtin = spec.startsWith("node:") || BUILTINS.has(name);
    if (builtin && !ALLOWED_BUILTINS.has(name)) found.push(`imports node:${name}, which reads through nothing the observer wraps`);
  }
  return found;
}

test("no declaring guard reads by a route the observer cannot see -- refused in its own closure instead", () => {
  // A computed `import()` (the loader reads off this thread), a `ReadStream` or `ChildProcess` built by hand,
  // and any builtin outside DECLARER_BUILTINS (`node:sqlite`, `node:wasi`) read through nothing the observer
  // wraps. There is nothing in the process to record, so the guard's own source is where to refuse them.
  const packages = packageIndex(REPO, knownPackages(REPO));
  const refused = declarers.flatMap((file) => [...sourceClosure(join(REPO, file), REPO, packages)]
    .flatMap((source) => unseenRoutesIn(stripComments(readFileSync(source, "utf8")))
      .map((why) => `${file}: ${relative(REPO, source)} ${why}`)));
  assert.ok(declarers.length > 0,
    "#1160: if `declarers` is empty this assertion passes having compared nothing -- "
    + "the control belongs on the population, not on `refused`");
  assert.deepEqual(refused, []);
});

test("...and that refusal can fire: each unseen route is found, and a plain fs import is not", () => {
  assert.deepEqual(unseenRoutesIn(`const m = await import(name);`), ["imports a computed path"]);
  assert.deepEqual(unseenRoutesIn(`import { DatabaseSync } from "node:sqlite";`),
    ["imports node:sqlite, which reads through nothing the observer wraps"]);
  assert.deepEqual(unseenRoutesIn(`const s = new fs.ReadStream(p);`), ["builds a stream or a process by hand"]);
  assert.deepEqual(unseenRoutesIn(`const u = import.meta.resolve("@a11ign/judge");`), ["resolves a specifier through the ESM loader"]);
  assert.deepEqual(unseenRoutesIn(`Module._findPath(req, paths);`), ["calls Node's module internals directly"]);
  const viaTestBinding = ["reaches node:test's run through a binding the observer cannot re-point"];
  for (const spelling of [`import { test, run } from "node:test";`, `import t, { run as r } from "node:test";`,
    `import * as t from "node:test";`, `const { run } = await import("node:test");`,
    // worker-judge's round 3: the re-exports, through which a helper hands a declarer the unwrapped function.
    `export { run } from "node:test";`, `export * from "node:test";`, `export * as t from "node:test";`]) {
    assert.deepEqual(unseenRoutesIn(spelling), viaTestBinding, spelling);
  }
  for (const harmless of [`import { test, before } from "node:test";`, `import nodeTest from "node:test";`,
    `export { test } from "node:test";`, `import { runner } from "./x.mjs";`]) {
    assert.deepEqual(unseenRoutesIn(harmless), [], `${harmless} binds nothing unsynced`);
  }
  assert.deepEqual(unseenRoutesIn(`import { readFileSync } from "node:fs";\nconst m = await import("./x.mjs");`), []);
});

test("THE FAILURE SIGNATURE: on the four measured product diffs, only DECLARING guards are left out", () => {
  // A drop larger than the declared population would mean something other than a declaration narrowed the
  // run. Measured on the same four diffs that refuted #904.
  const readReal = (rel: string) => readFileSync(join(REPO, rel), "utf8");
  for (const diff of ["packages/judge/src/rules.ts", "packages/evidence/src/conformance.ts",
    "packages/nvda-worker/src/capture-probes.mjs", "packages/scorer/src/index.ts"]) {
    const { kept, narrowed } = narrowByDeclaredScope(repoGuards, [diff], { readSource: readReal });
    assert.equal(kept.length + narrowed.length, repoGuards.length, "every guard is kept or narrowed, never lost");
    for (const n of narrowed) assert.ok(declarers.includes(n.test), `${n.test} was narrowed without declaring a scope`);
  }
});

test("THE SELECTOR DOES NOT INSTALL THE OBSERVER -- it reads declarations through the parser module alone", () => {
  // It once imported `walk-scope.mjs` to parse, which wrapped fs, child_process, process and node:test in the
  // CI selector's own process for nothing. Asked in a fresh process, since this file's own is observed.
  // The observer must not be imported to ask, so this reads the wrapper's own marker symbol instead.
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", [
    `await import(${JSON.stringify(pathToFileURL(join(REPO, "scripts/select-changed-tests.mjs")).href)});`,
    `const fs = await import("node:fs");`,
    `const marked = Object.getOwnPropertySymbols(fs.readFileSync).map(String).filter((s) => s.includes("walk-scope"));`,
    `console.log(JSON.stringify(marked));`,
  ].join("\n")], { cwd: REPO, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim().split("\n").pop() ?? "null"), [],
    "fs.readFileSync carries the observer's marker in a process that only imported the selector");
});

test("this file declares no scope of its own — it walks every test file to find the ones that do", () => {
  assert.equal(parseWalkScope(readFileSync(fileURLToPath(import.meta.url), "utf8")), null);
});
