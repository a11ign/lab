import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkLayout, checkLayoutTree } from "@a11ign/toolchain/layout-check";
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

test("the tool is resolved at the newest release tag by the core's resolver, with no tag held here (a11ign/a11ign#4427)", () => {
  const resolve = 'node scripts/agent-org-newest-tag.mjs --dest="$RUNNER_TEMP/agent-org"';
  const step = ci.indexOf(resolve);
  assert.ok(step > 0, "positive control: the resolver step is found");
  assert.ok(step < ci.indexOf("pnpm exec eslint"), "resolved before the lint");
  assert.ok(step < ci.indexOf("pnpm exec rstest run"), "resolved before the tests");
  assert.doesNotMatch(ci, /AGENT_ORG_PIN/, "no pin: the newest tag is what the tests read the tool at");
  assert.doesNotMatch(ci, /\bv\d+\.\d+\.\d+\b/, "and no release tag is written in the code");
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

test("the laid package is staged, then given its `@a11ign/control` package, in that order", () => {
  // Staged because the core's `packages/lab` is gitignored and the lab's tests walk `git ls-files`; the package comes AFTER, so it is not a tracked entry.
  // It is control's own manifest plus a link to the laid `src`, because since a11ign/a11ign#3506 the core's `packages/control` is a laid layer with NO `package.json`: a plain link has no `exports` to resolve `@a11ign/control/fleet-wake` through.
  const stage = ci.indexOf("git add -f packages/lab");
  const manifest = ci.indexOf('/package.json" -o "$control/package.json"');
  const src = ci.indexOf('ln -s ../../../../control/src "$control/src"');
  assert.ok(stage > 0, "positive control: the staging is found");
  assert.ok(manifest > stage, "the manifest comes after the staging");
  assert.ok(src > manifest, "the src link comes after the manifest");
  assert.match(ci, /control=packages\/lab\/node_modules\/@a11ign\/control\n/, "both land in the lab's own node_modules");
  assert.ok(stage > ci.indexOf("cp -R ../lab/. packages/lab"), "staged after it is laid");
  assert.ok(src < ci.indexOf("pnpm exec rstest run"), "installed before the tests");
});

test("the lab is linted with the ignore removed, and typechecked by its own program, not the core's", () => {
  // The core's eslint config ignores `packages/lab/**`, so a plain `eslint packages/lab` lints nothing and exits 0; its tsconfig excludes the lab, so `tsc --noEmit` would check the core alone.
  assert.match(ci, /pnpm exec eslint --no-ignore packages\/lab\n/);
  assert.doesNotMatch(ci, /pnpm exec tsc --noEmit\n {8}working-directory: core/);
  // The lab's own program, run in the core, after the lab is laid (a11ign/a11ign#3927): the core's excludes `packages/lab`, so only this one reads the lab's `src`.
  const typecheck = ci.indexOf("pnpm exec tsc -p packages/lab/tsconfig.json --noEmit\n        working-directory: core");
  assert.ok(typecheck > ci.indexOf("cp -R ../lab/. packages/lab"), "the lab's typecheck runs after it is laid");
  assert.ok(typecheck < ci.indexOf("pnpm exec rstest run"), "and before the tests, so a type failure reads red without waiting for the suite");
});

test("the lab's tsconfig includes the lab's populations and the core's declarations, and extends the core's", () => {
  const raw = readFileSync(new URL("../../tsconfig.json", import.meta.url), "utf8");
  const { extends: base, include } = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as { extends: string; include: string[] };
  assert.equal(base, "../../tsconfig.json");
  for (const population of ["src/**/*.ts", "scripts/**/*.ts", "nightly/**/*.ts", "src/**/*.mjs", "../../scripts/test-support/*.d.ts"]) {
    assert.ok(include.includes(population), `${population} is in the lab's program`);
  }
});

test("the first release has a CHANGELOG entry for the version the package declares", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(read("CHANGELOG.md"), new RegExp(`^## ${version.replaceAll(".", "\\.")}$`, "m"));
});

test("the layout check runs first, from the toolchain this repository names, by path, and no `tsx --test` is left", () => {
  // The bin has no shebang, so `npx … layout-check` is run by `sh` and dies (exit 2); the module is run by `node`. It comes before the core is installed, so a layout failure reads red at once.
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
  assert.ok(pkg.devDependencies["@a11ign/toolchain"], "positive control: the toolchain is a dev dependency, and the step reads its version from there");
  const check = ci.indexOf("/node_modules/@a11ign/toolchain/dist/layout-check.mjs\" lab");
  assert.ok(check > 0, "positive control: the layout step is found");
  assert.ok(check < ci.indexOf("pnpm install --no-frozen-lockfile"), "before the core's install");
  assert.doesNotMatch(ci, /npx .*layout-check/);
  assert.doesNotMatch(JSON.stringify(pkg.scripts) + ci, /tsx --test/);
});

test("this repository's own tests run in the core's job: the toolchain is linked beside the laid package, and no root install is left", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { devDependencies: Record<string, string> };
  // No lockfile, because the manifest names packages no registry holds: a frozen install here could not run.
  assert.equal(existsSync(new URL("../../pnpm-lock.yaml", import.meta.url)), false, "a lockfile that could not be written is a lockfile that is stale");
  assert.doesNotMatch(ci, /pnpm install --frozen-lockfile/);
  const link = ci.indexOf('ln -s "$RUNNER_TEMP/toolchain/node_modules/@a11ign/toolchain" packages/lab/node_modules/@a11ign/toolchain');
  assert.ok(link > ci.indexOf("cp -R ../lab/. packages/lab"), "linked into the package after it is laid");
  assert.ok(link < ci.indexOf("pnpm exec rstest run"), "linked before the tests");
  // The toolchain's `merge-child-coverage` imports `@rstest/coverage-v8`, an OPTIONAL peer npm does not install; the link resolves from the install's own directory, so it is installed beside it.
  assert.ok(pkg.devDependencies["@rstest/coverage-v8"], "positive control: the coverage provider is a dev dependency, and the install reads its version from there");
  assert.match(ci, /"@a11ign\/toolchain@\$version" "@rstest\/coverage-v8@\$coverage"/);
});

test("the layout check passes on this repository's own tree, and fails the shape it was written for", () => {
  assert.equal(checkLayout({ root: fileURLToPath(new URL("../..", import.meta.url)) }).ok, true);
  const monorepo = { "package.json": '{"name":"lab-workspace","private":true}', "lerna.json": "{}", "packages/lab/package.json": '{"name":"@a11ign/lab"}' };
  assert.equal(checkLayoutTree(monorepo).ok, false, "positive control: the shape this change removed is red");
});
