import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workflowCode } from "./workflow-code.ts";

const ci = workflowCode("ci.yml");

test("the job the protection requires exists, named `gate`, and runs on the queue's branches too", () => {
  assert.match(ci, /^ {2}gate:$/m);
  assert.match(ci, /^ {2}pull_request:$/m);
  assert.match(ci, /^ {2}merge_group:$/m);
});

test("the core is laid at a full commit sha, never a branch", () => {
  const pin = /^ {2}CORE_REF: ([^\s]+)$/m.exec(ci);
  assert.ok(pin, "positive control: the pin is found");
  assert.match(pin[1], /^[0-9a-f]{40}$/);
  assert.match(ci, /ref: "\$\{\{ env\.CORE_REF \}\}"/, "the checkout uses the pin");
});

test("this repository's package replaces the core's own AFTER the install and the build, and before anything reads it", () => {
  // The core's `prepare` (run by `pnpm install` and by `build`) lays the core's PINNED lab, which has no tests and no manifest, over whatever is there: laying first is "No test files found".
  const lay = ci.indexOf("rm -rf packages/lab");
  assert.ok(lay > 0, "positive control: the laying step is found");
  assert.ok(lay > ci.indexOf("pnpm install --no-frozen-lockfile"), "laid after the install");
  assert.ok(lay > ci.indexOf("pnpm run build"), "laid after the build");
  assert.ok(lay < ci.indexOf("pnpm exec eslint"), "laid before the lint");
  assert.ok(lay < ci.indexOf("pnpm exec rstest run"), "laid before the tests");
});

test("the laid package is staged, then given its `@a11ign/control` link, in that order", () => {
  // Staged because the core's `packages/lab` is gitignored and the lab's tests walk `git ls-files`; linked AFTER, so the link is not a tracked entry.
  const stage = ci.indexOf("git add -f packages/lab");
  const link = ci.indexOf("ln -s ../../../control packages/lab/node_modules/@a11ign/control");
  assert.ok(stage > 0, "positive control: the staging is found");
  assert.ok(link > stage, "the link comes after the staging");
  assert.ok(stage > ci.indexOf("cp -R ../lab/packages/lab packages/lab"), "staged after it is laid");
  assert.ok(link < ci.indexOf("pnpm exec rstest run"), "linked before the tests");
});

test("the lab is linted with the ignore removed, and the core's own tsc is not claimed to check it", () => {
  // The core's eslint config ignores `packages/lab/**`, so a plain `eslint packages/lab` lints nothing and exits 0; its tsconfig excludes the lab, so `tsc --noEmit` would check the core alone.
  assert.match(ci, /pnpm exec eslint --no-ignore packages\/lab\n/);
  assert.doesNotMatch(ci, /pnpm exec tsc --noEmit\n {8}working-directory: core/);
});

test("the first release has a CHANGELOG entry for the version the package declares", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const { version } = JSON.parse(read("packages/lab/package.json")) as { version: string };
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(read("packages/lab/CHANGELOG.md"), new RegExp(`^## ${version.replaceAll(".", "\\.")}$`, "m"));
});
