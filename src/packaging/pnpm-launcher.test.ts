/**
 * #3283: `scripts/pnpm.mjs` IS RUN, WITH A FAKE `pnpm` FIRST ON `PATH`.
 *
 * #3148 changed nine tests that name the launcher only inside script strings, and the mutation reading on #3213 found
 * every mutant of it surviving them (Stryker 18 of 18, the in-house set 17 of 17). A string that names the file proves
 * the file is named. These tests START it, as `node scripts/pnpm.mjs run X` does on a box with no `pnpm` of its own
 * (#3141), and read what the chain sees: the exit status, the arguments, and what is said when nothing can be started.
 *
 * The environment is built from NOTHING, never from `process.env`: a parent's `npm_execpath` would otherwise be the
 * pnpm the launcher found, and the fake would never be reached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../../../../scripts/pnpm.mjs");
const POSIX_ONLY = process.platform === "win32" ? "the fake pnpm is a /bin/sh script, which a Windows PATH does not run" : false;

/** A scratch directory holding a `pnpm` that runs `body` as a shell script, and the file it logs its arguments to. */
function withFakePnpm(body: string, run: (dir: string, log: string) => void, { executable = true } = {}): void {
  const dir = mkdtempSync(join(tmpdir(), "pnpm-launcher-3283-"));
  try {
    const log = join(dir, "args.log");
    writeFileSync(join(dir, "pnpm"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\n${body}\n`);
    chmodSync(join(dir, "pnpm"), executable ? 0o755 : 0o644);
    run(dir, log);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the launcher as a script, with `PATH` the one directory and no `npm_execpath`. */
function launch(path: string, args: string[], { entry = SCRIPT } = {}) {
  return spawnSync(process.execPath, [entry, ...args], { env: { PATH: path }, encoding: "utf8" });
}

test("the exit status is pnpm's own, so `&&` stops a chain at the first failing stage", { skip: POSIX_ONLY }, () => {
  for (const status of [0, 3]) {
    withFakePnpm(`exit ${status}`, (dir) => {
      assert.equal(launch(dir, ["run", "x"]).status, status);
    });
  }
});

test("the arguments reach pnpm verbatim and in order, `--` and flags included", { skip: POSIX_ONLY }, () => {
  withFakePnpm("echo from-the-fake", (dir, log) => {
    const args = ["run", "release:gate", "--silent", "--", "--flag=a b", "--other"];
    const result = launch(dir, args);
    assert.equal(result.status, 0);
    assert.deepEqual(readFileSync(log, "utf8").trimEnd().split("\n"), args);
    assert.match(result.stdout, /from-the-fake/, "pnpm's output is inherited, not swallowed");
  });
});

test("a pnpm killed by a signal has no exit status, and that reads as a FAILURE, never as 0", { skip: POSIX_ONLY }, () => {
  withFakePnpm("kill -TERM $$", (dir) => {
    assert.equal(launch(dir, ["run", "x"]).status, 1);
  });
});

test("nothing reachable to run is reported by name and exits 1", { skip: POSIX_ONLY }, () => {
  const empty = mkdtempSync(join(tmpdir(), "pnpm-launcher-3283-empty-"));
  try {
    const result = launch(empty, ["run", "x"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not find pnpm/);
    assert.match(result.stderr, /corepack/, "the message says what provides it");
    assert.equal(result.stdout, "");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("a pnpm that is found and cannot be STARTED is reported with the command it tried, and exits 1", { skip: POSIX_ONLY }, () => {
  withFakePnpm("exit 0", (dir) => {
    const result = launch(dir, ["run", "x"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not start `.*pnpm run x`/);
  }, { executable: false });
});

test("`npm_execpath` is the first choice: the pnpm that started the chain is the one that runs it", { skip: POSIX_ONLY }, () => {
  withFakePnpm("exit 7", (dir, log) => {
    const parent = join(dir, "pnpm.cjs");
    writeFileSync(parent, `require("node:fs").appendFileSync(${JSON.stringify(log)}, "parent\\n"); process.exit(5);\n`);
    const result = spawnSync(process.execPath, [SCRIPT, "run", "x"], { env: { PATH: dir, npm_execpath: parent }, encoding: "utf8" });
    assert.equal(result.status, 5, "the parent's pnpm answered, not the one on PATH (which exits 7)");
    assert.equal(readFileSync(log, "utf8").split("\n")[0], "parent");
  });
});

test("the main-module guard runs it as a script, through a symlink too, and does not run it when imported", { skip: POSIX_ONLY }, () => {
  withFakePnpm("exit 4", (dir, log) => {
    const link = join(dir, "linked-pnpm.mjs");
    symlinkSync(SCRIPT, link);
    assert.equal(launch(dir, ["run", "x"], { entry: link }).status, 4, "a symlinked entry is the main module once its real path is read");

    const imported = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(SCRIPT)})`], { env: { PATH: dir }, encoding: "utf8" });
    assert.equal(imported.status, 0, "importing runs nothing, so nothing fails");
    assert.equal(readFileSync(log, "utf8"), "run\nx\n", "only the symlinked launch reached pnpm; the import never did");
  });
});
