/**
 * `referral-repeat-share` takes file paths and no flags, so it must REFUSE a flag rather than read `--nonsense` as a file
 * (a11ign/a11ign#4580). Control's `cli-flags` test finds CLIs by reading their source for `refuseUnknownFlags(`; this is the
 * half it cannot read: that the call FIRES, and that the usage exit the script already had is unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// The script is TypeScript and the host's plain node has no type stripping (ADR 0043), so it is spawned through tsx like the other .ts scripts.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const SCRIPT = fileURLToPath(new URL("../../scripts/referral-repeat-share.ts", import.meta.url));
const USAGE_EXIT = 2;

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", TSX, SCRIPT, ...args], { encoding: "utf8" });
}

test("an unknown flag is refused, naming the flag, before any file is read", () => {
  const result = run(["--nonsense"]);
  assert.equal(result.status, USAGE_EXIT);
  assert.match(result.stderr, /unknown flag --nonsense/);
  assert.doesNotMatch(result.stderr, /cannot read referrals/);
});

test("no arguments still exits with the usage line", () => {
  const result = run([]);
  assert.equal(result.status, USAGE_EXIT);
  assert.match(result.stderr, /usage: referral-repeat-share\.ts/);
  assert.doesNotMatch(result.stderr, /unknown flag/);
});
