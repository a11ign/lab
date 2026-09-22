/**
 * #2006 — EVERY TRACKED POWERSHELL FILE PARSES, AND NOTHING IN THIS REPOSITORY PARSED ONE BEFORE.
 *
 * A script that cannot be parsed passes every test it has. Found as the instance on #1968:
 * `packages/worker-fleet/src/provisioning/set-display-mode.ps1` carried FOURTEEN parse errors at
 * `0c4f39b1d` and its suite was 22/22 green, through two reviewer rounds and three mutation sweeps —
 * because every assertion there was a regex over the file's text, and a regex cannot tell a script
 * Windows will run from one it will refuse to load. #1968 answered that for one file. This answers it
 * for the population, which is reached only by a real fleet play, where a parse error costs a ten-host
 * run to discover.
 *
 * THREE THINGS HERE ARE DELIBERATE, and each answers an emptiness that would otherwise pass:
 *
 *  - **The population comes from `git ls-files`, not from `find` and not from a hand-typed list.** A
 *    typed list is not the tree: a script added tomorrow must join the population without anybody
 *    remembering this file. `find` walks the FILESYSTEM and counts untracked, gitignored files — green
 *    locally and red in CI, for a reason the failure would not explain (#1274's own 46-vs-44).
 *  - **The count is asserted EQUAL, not floored.** A walk that silently finds nothing passes a floor
 *    perfectly, and reaching every file is the whole value of this guard. Wrong cwd, a glob the shell
 *    ate, `GIT_DIR` inherited from a hook: each leaves the offender list empty having examined ZERO
 *    files, which is the same shape as the defect this guard answers.
 *  - **`pwsh` is REQUIRED, not optional.** A guard that skips when its instrument is missing is the
 *    defect one level up, and #1968's own blocker was exactly that. GitHub's `ubuntu-latest` ships
 *    PowerShell, and #1968's `acceptance` job is green proof that a pwsh-executing test runs in this CI.
 *
 * NO EXCLUSION BY FILENAME. The row's filed text excluded `*.Tests.ps1` on the ground that Pester
 * already parses them; `product-manager` measured that nothing here runs Pester — `Invoke-Pester`
 * appears in one vendored README and no workflow mentions it — so those three files were as unguarded
 * as the rest. They are in. `.psm1` is in for the same reason: PowerShell refuses to load a broken
 * module exactly as it refuses a broken script. The ONE exclusion is this guard's own positive control,
 * named by its exact path below, because a deliberately broken `.ps1` fixture is itself a tracked `.ps1`
 * and a tree walk finds it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");

/**
 * `pwsh` is REQUIRED; `A11Y_PWSH` names the binary where it is not on PATH. Read at CALL time, not at
 * import, so the control below can point this at a binary that does not exist and watch the guard FAIL.
 */
const pwshBinary = () => process.env.A11Y_PWSH ?? "pwsh";

/** The one tracked PowerShell file that is SUPPOSED not to parse — this guard's own positive control. */
const CONTROL = "packages/lab/src/packaging/fixtures/broken-continuation.ps1";

/**
 * Every tracked `.ps1` and `.psm1` except `CONTROL`, measured at `bedbf787c` (origin/main) with #1968
 * merged, which is where `packages/worker-fleet/src/display-mode-harness.ps1` comes from: 17 `.ps1` and
 * 1 `.psm1`. If a script is added or removed, move this number DELIBERATELY — it moving on its own is
 * how a population stops being the one anybody checked.
 */
const EXPECTED_FILES = 18;

/** Exactly one file is excluded, and it is the control. Asserted, so the exclusion cannot widen quietly. */
const EXPECTED_EXCLUDED = 1;

const trackedPowerShell = () =>
  // `sandboxGitEnv()` is CALLED, not merely imported: git exports GIT_DIR into every hook environment, so
  // a spawn with an inherited env reads whatever repository the caller was in. A test that walks the tree
  // is exactly the shape that inherits one.
  //
  // The repository is named by `cwd`, NOT by a leading `-C`, and that is deliberate:
  // `git-population-vacuity.test.ts` discovers a git-population guard by matching the SUBCOMMAND as the
  // first array element, so a `["-C", REPO, "ls-files"]` call escapes its census through argument order
  // alone. This guard asserts over an offender list, which is exactly the population that census exists to
  // require a pin for, so it is written in the shape that gets found and is classified there.
  execFileSync("git", ["ls-files", "*.ps1", "*.psm1"],
    { encoding: "utf8", cwd: REPO, env: sandboxGitEnv() })
    .split("\n").filter(Boolean);

/**
 * One `pwsh` start for the whole population — a process per file is 18 starts for one answer. The paths
 * arrive on stdin rather than in the command, because a command line assembled from file names is a
 * quoting bug waiting for a path with a space in it.
 *
 * `ParseFile` reports an unreadable file as a parse error rather than throwing (measured: "The file could
 * not be read"), so a mistyped or missing path lands in the offender list instead of vanishing from it.
 */
const PARSE_SCRIPT = [
  "$paths = [Console]::In.ReadToEnd() -split \"`n\" | Where-Object { $_ -ne '' }",
  "$out = foreach ($p in $paths) {",
  "  $parseErrors = $null",
  "  [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref] $null, [ref] $parseErrors)",
  "  [pscustomobject]@{ path = $p; errors = @($parseErrors | ForEach-Object { $_.ToString() }) }",
  "}",
  "ConvertTo-Json -InputObject @($out) -Depth 4 -Compress",
].join("\n");

interface ParseResult { path: string; errors: string[] }

function parseAll(paths: string[], binary = pwshBinary()): ParseResult[] {
  const run = spawnSync(binary, ["-NoProfile", "-NonInteractive", "-Command", PARSE_SCRIPT],
    { encoding: "utf8", cwd: REPO, input: paths.join("\n") });
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    assert.fail(`no PowerShell at \`${binary}\`, and this guard FAILS rather than skips without one. `
      + "Install it (https://github.com/PowerShell/PowerShell/releases/latest -> the linux-x64 tar.gz, "
      + "extracted anywhere) and either put `pwsh` on PATH or set A11Y_PWSH to the binary. A guard that "
      + "quietly does not run is the defect this file exists to answer, one level up");
  }
  assert.equal(run.status, 0, `${binary} exited ${run.status}:\n${run.stderr}`);
  const results = JSON.parse(run.stdout) as ParseResult[];
  // The reply is echoed back path by path, so "pwsh examined every file it was handed" is checked rather
  // than assumed: a parser that silently dropped inputs would otherwise report an empty offender list.
  assert.deepEqual(results.map((result) => result.path), paths,
    "pwsh reported on a different set of files than it was handed -- the offender list below would be "
    + "empty because files went missing, not because they parsed");
  return results;
}

test("#2006: every tracked PowerShell file parses, under a real PowerShell", () => {
  const all = trackedPowerShell();
  const population = all.filter((path) => path !== CONTROL);
  const excluded = all.filter((path) => path === CONTROL);

  assert.equal(excluded.length, EXPECTED_EXCLUDED,
    `the only excluded file is ${CONTROL}, this guard's own broken control, and it must be TRACKED for `
    + "the exclusion to be removing anything -- found " + `${excluded.length}`);
  // EQUAL, not floored: see the header. A guard that examined nothing is the shape it is answering.
  assert.equal(population.length, EXPECTED_FILES,
    `expected ${EXPECTED_FILES} tracked PowerShell files outside the control, found ${population.length}:`
    + `\n  ${population.join("\n  ")}\n\nIf a script was added or removed, update EXPECTED_FILES `
    + "deliberately -- this number moving silently is how the population stops being the one anybody checked.");

  const offenders = parseAll(population).filter((result) => result.errors.length > 0);
  assert.deepEqual(offenders, [],
    "a tracked PowerShell file does not parse:\n"
    + offenders.map((o) => `${o.path}\n${o.errors.join("\n")}`).join("\n\n")
    + "\nEvery test over these files matches TEXT, so they all stay green over a script Windows will "
    + "refuse to load, and the next fleet run is a poor place to learn that");
});

test("#2006 POSITIVE CONTROL: the parser REPORTS the defect shape this repo actually shipped", () => {
  // Without this, a parse that never reports anything -- a changed API, a swallowed [ref] -- satisfies the
  // emptiness above perfectly. The fixture carries `Write-Output ("a"` with the next line beginning `+ "b"`,
  // which is the literal shape of the fourteen errors #1968 found, so the instrument is proven on a defect
  // this repository has really shipped rather than on an invented one.
  const [control] = parseAll([CONTROL]);
  assert.ok(control.errors.length > 0,
    `${CONTROL} parsed cleanly -- the control is supposed to be broken, so either it was "fixed" or this `
    + "guard can no longer say no, and an empty offender list above means nothing either way");
  assert.match(control.errors.join("\n"), /Missing closing '\)' in expression/,
    "the control fails for the REASON it was written to fail; matching any error at all would accept a "
    + "missing file or an unreadable one as proof that the parser works");
});

test("#2006 POSITIVE CONTROL: the walk reaches the file the instance was found in, and it PARSES", () => {
  // An emptiness assertion names where its positive control lives. The walk's is here: the file whose
  // fourteen parse errors produced this row is named, so a walk that stops finding it fails as a broken
  // walk rather than passing as a clean tree.
  const population = trackedPowerShell().filter((path) => path !== CONTROL);
  const instance = "packages/worker-fleet/src/provisioning/set-display-mode.ps1";
  assert.ok(population.includes(instance),
    `the walk no longer reaches ${instance}, the file this guard was written for`);
  assert.ok(population.some((path) => path.endsWith(".psm1")),
    "the walk reaches .psm1 too -- PowerShell refuses to load a broken module exactly as it refuses a "
    + "broken script, and nothing here runs the Pester suite that was once said to cover them");
  assert.deepEqual(parseAll([instance])[0].errors, [],
    "and the same instrument ACCEPTS a real script, so `rejects everything` cannot satisfy the control above");
});

test("#2006: no PowerShell means this guard FAILS, and says how to get one", () => {
  // #1968's blocker was a check that skipped when its instrument was absent. A guard that skips is a guard
  // that reports nothing and reads as green, so the missing-instrument path is asserted rather than trusted.
  assert.throws(() => parseAll([CONTROL], resolve(REPO, "no-such-powershell-binary")), (error: unknown) => {
    assert.match((error as Error).message, /FAILS rather than skips/,
      "the absent-instrument path must fail as an assertion, not as an unhandled spawn error");
    assert.match((error as Error).message, /A11Y_PWSH/,
      "and the message must name how to get a PowerShell, or the failure tells a reader nothing");
    return true;
  });
});
