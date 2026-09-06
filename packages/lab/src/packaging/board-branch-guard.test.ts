import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

/* THE SCHEDULED JOB MUST RENDER FROM `main`, AND THE CHECK IS NEEDED IN TWO PLACES.
 *
 * Install-time alone is not enough and that is the point of this file. Checking at install catches
 * installing from a feature branch; it does NOT catch the case that actually happened -- the tree is
 * checked out to a branch AFTER the job is installed, which is ordinary in a repository several agents
 * move daily, and the 08:00 job then renders from whatever is checked out at 08:00. An install-time check
 * would have reported success and published the wrong document anyway.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const source = (name: string) => readFileSync(path.join(REPO, "scripts", name), "utf8");

/** Run a shell script in a throwaway git repo on a named branch, and report its exit code. */
function onBranch(script: string, branch: string): { code: number; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "branch-guard-"));
  // THE CANONICAL HELPER, not a hand-rolled strip. This file had its own copy of the GIT_* filter, which
  // is a defensive filter stated twice -- one copy missing one variable is silent until the day that
  // variable is the one set. Sharper here than usual: this is the test for the guard whose entire job is
  // answering "am I on main?", and it runs under the pre-push hook where GIT_DIR IS set, so an unscrubbed
  // spawn would validate that guard against the real repository instead of the fixture.
  const env = sandboxGitEnv() as NodeJS.ProcessEnv;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe", env });
  git("init", "-q", "-b", branch);
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(dir, "seed"), "seed\n");
  git("add", "seed");
  git("commit", "-qm", "seed");

  // Only the branch guard is exercised: everything after it is replaced by an exit, so this test does not
  // install a launch agent or publish anything as a side effect of running.
  const whole = source(script);
  const cut = whole.indexOf("echo \"checkout: $REPO is on $BRANCH\"") !== -1
    ? whole.slice(0, whole.indexOf("echo \"checkout: $REPO is on $BRANCH\"")) + "\nexit 0\n"
    : whole.slice(0, whole.indexOf("out=$(node scripts/board-report.mjs")) + "\nexit 0\n";
  // PLACED AT <repo>/scripts/, not at the repo root. Both scripts derive REPO from their OWN location
  // (`dirname "${BASH_SOURCE[0]}"/..`), which is correct in production and means a copy dropped anywhere
  // else asks git about a DIFFERENT directory. The first version of this harness did exactly that: the
  // refusal fired, the exit code was 2, and it was refusing about the real checkout rather than the
  // fixture — a test that passed its exit-code assertion while examining the wrong repository.
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const file = path.join(dir, "scripts", "under-test.sh");
  writeFileSync(file, cut);
  chmodSync(file, 0o755);
  try {
    const out = execFileSync("bash", [file], { encoding: "utf8", stdio: "pipe", cwd: dir, env });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("the installer refuses a checkout that is not on main, and names the branch it found", () => {
  const { code, out } = onBranch("install-board-report.sh", "agent/something");
  assert.equal(code, 2, out);
  assert.match(out, /agent\/something/, "it must name the branch it found, not merely refuse");
  assert.match(out, /Nothing was installed/);
});

test("the installer proceeds on main", () => {
  const { code } = onBranch("install-board-report.sh", "main");
  assert.equal(code, 0, "a checkout on main must get past the branch guard");
});

test("the SCHEDULED JOB checks the branch too, because the tree moves after installation", () => {
  const { code, out } = onBranch("board-report-cron.sh", "agent/something");
  assert.equal(code, 2, out);
  assert.match(out, /agent\/something/);
  assert.match(out, /Nothing was published/);
});

test("both guards scrub GIT_* before asking git which branch this is", () => {
  // A leaked GIT_DIR makes `rev-parse` answer about a DIFFERENT repository -- confidently, and with the
  // wrong branch name printed as reassurance. Same defect that redirected fifteen real commits here.
  for (const script of ["install-board-report.sh", "board-report-cron.sh"]) {
    const text = source(script);
    const call = text.slice(text.indexOf("BRANCH="), text.indexOf("BRANCH=") + 300);
    assert.match(call, /env -u GIT_DIR/, `${script} asks git for the branch without scrubbing GIT_*`);
  }
});
