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

// The first control tag that has `src/lab-carried.ts` (control#87, measured 2026-10-13: `git cat-file -e v0.5.3:src/lab-carried.ts` fails, `v0.13.15:src/lab-carried.ts` succeeds). A lab test that imports it
// fails `tsc` at any older tag, so this is the floor under `CONTROL_REF`, not a preference (a11ign/a11ign#5400, #5379).
const FIRST_CONTROL_WITH_LAB_CARRIED = [0, 13, 15];

function versionAtLeast(version: string, floor: number[]): boolean {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < floor.length; i += 1) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

test("control is laid at a release tag this file names, at or after the first one that carries `src/lab-carried.ts` (a11ign/a11ign#5400)", () => {
  const pin = /^ {2}CONTROL_REF: ([^\s]+)$/m.exec(ci);
  assert.ok(pin, "positive control: the declaration is found");
  assert.match(pin[1], /^v\d+\.\d+\.\d+$/, "a release tag, never a branch");
  assert.ok(versionAtLeast(pin[1], FIRST_CONTROL_WITH_LAB_CARRIED), `${pin[1]} predates control v0.13.15, which first has src/lab-carried.ts`);
  assert.ok(versionAtLeast("v0.13.15", FIRST_CONTROL_WITH_LAB_CARRIED) && !versionAtLeast("v0.13.14", FIRST_CONTROL_WITH_LAB_CARRIED) && !versionAtLeast("v0.5.3", FIRST_CONTROL_WITH_LAB_CARRIED), "positive control: the comparison separates v0.13.15 from the tag the core used to lay");
  assert.match(ci, /git clone [^\n]*--branch "\$CONTROL_REF" https:\/\/github\.com\/a11ign\/control\.git "\$RUNNER_TEMP\/control"\n/, "the clone uses the declaration");
  // Control's OWN `.layer-ref` is the one this guards: the core's pin decided which control was laid by writing it, and cut 9 deleted the file that did. The fleet and the worker write theirs below, from the tags this file names.
  assert.doesNotMatch(ci, /packages\/control\/\.layer-ref/, "the core's pin no longer decides which control is laid: cut 9 deleted the file that wrote it");
  assert.doesNotMatch(ci, /raw\.githubusercontent\.com\/a11ign\/control/, "the manifest is read from the clone, not fetched at a ref the core names");
});

test("control is laid AFTER the install and the build and BEFORE the lab is laid and linked to it", () => {
  const lay = ci.indexOf("git clone --quiet --depth 1 --branch \"$CONTROL_REF\"");
  assert.ok(lay > 0, "positive control: the control step is found");
  assert.ok(lay > ci.indexOf("pnpm install --no-frozen-lockfile"), "laid after the install");
  assert.ok(lay > ci.indexOf("pnpm run build"), "laid after the build");
  assert.ok(lay < ci.indexOf("rm -rf packages/lab"), "laid before the lab, whose step copies the manifest out of the clone");
  assert.match(ci, /rm -rf packages\/control\n {10}mkdir packages\/control\n/, "the core's laid copy is replaced, not merged into");
  // What the core's `lay-layer.ts` laid at its pin: `src`, `ansible` and the two docs, no `package.json`, no `.git`, and no test (laid whole, four lab guards that walk `packages/control` went red).
  assert.match(ci, /archive --format=tar HEAD src ansible CLAUDE\.md README\.md \| tar -x -C packages\/control\n/, "only what the core laid: no `.git`, no manifest, no `scripts/`");
  // The core deleted `layers.json` in cut 9 (a11ign/a11ign#5087, `23a179418`): a `cp` of it dies at every core commit from there, which is why moving `CORE_REF` was not one pin bump (a11ign/a11ign#5431).
  assert.doesNotMatch(ci, /layers\.json/, "no copy of a declaration the core no longer has");
  assert.match(ci, /find packages\/control\/src -type f \\\( -name '\*\.test\.ts' -o -name '\*\.test\.mts' -o -name '\*\.test\.mjs' \\\) -delete\n/, "and not its own tests");
});

// The releases the core's lockfile pinned at the sha this file moved to (`git show 87d89fdec:pnpm-lock.yaml`: `@a11ign/screenreader-fleet` 0.11.0, `@a11ign/screenreader-worker` 0.13.0). The core's `prepare` laid
// them at the releases its lockfile pinned until cuts 4 and 6 (a11ign/a11ign#5082, #5084); the lab's tests were written against that tree, so a lower tag reads a tree no test of this repository was run against (a11ign/a11ign#5431).
const FLEET_AT_CUT_9 = [0, 11, 0];
const WORKER_AT_CUT_9 = [0, 13, 0];

test("the fleet and the worker are laid at release tags this file names, as the core's `prepare` laid them until cuts 4 and 6 (a11ign/a11ign#5431)", () => {
  const fleet = /^ {2}FLEET_REF: ([^\s]+)$/m.exec(ci);
  const worker = /^ {2}WORKER_REF: ([^\s]+)$/m.exec(ci);
  assert.ok(fleet && worker, "positive control: both declarations are found");
  for (const [name, pin, floor] of [["FLEET_REF", fleet[1], FLEET_AT_CUT_9], ["WORKER_REF", worker[1], WORKER_AT_CUT_9]] as const) {
    assert.match(pin, /^v\d+\.\d+\.\d+$/, `${name} is a release tag, never a branch`);
    assert.ok(versionAtLeast(pin, [...floor]), `${name} ${pin} predates the release the core's lockfile pinned at the sha this file moved to`);
  }
  assert.ok(versionAtLeast("v0.11.0", FLEET_AT_CUT_9) && !versionAtLeast("v0.10.9", FLEET_AT_CUT_9), "positive control: the comparison separates the floor from the release before it");
  assert.match(ci, /git clone [^\n]*--branch "\$FLEET_REF" https:\/\/github\.com\/a11ign\/screenreader-fleet\.git "\$RUNNER_TEMP\/screenreader-fleet"\n/, "the fleet clone uses its declaration");
  assert.match(ci, /git clone [^\n]*--branch "\$WORKER_REF" https:\/\/github\.com\/a11ign\/screenreader-worker\.git "\$RUNNER_TEMP\/screenreader-worker"\n/, "the worker clone uses its declaration");
  assert.match(ci, /archive --format=tar HEAD src \| tar -x -C packages\/worker-fleet\n/, "the fleet's `src` only, at the path control's relative imports and the lab's tests name");
  assert.match(ci, /archive --format=tar HEAD src \| tar -x -C packages\/nvda-worker\n/, "the worker's `src` only, at the path the lab's tests name");
  assert.match(ci, /find packages\/worker-fleet\/src packages\/nvda-worker\/src -type f \\\( -name '\*\.test\.ts' -o -name '\*\.test\.mts' -o -name '\*\.test\.mjs' \\\) -delete\n/, "and not their own tests");
  // `laid-worker.ts` refuses a layer with no `.layer-ref`, and the file holds the tag so a reader can say which release a test read.
  assert.match(ci, /echo "\$FLEET_REF" > packages\/worker-fleet\/\.layer-ref\n/, "the fleet records its tag");
  assert.match(ci, /echo "\$WORKER_REF" > packages\/nvda-worker\/\.layer-ref\n/, "the worker records its tag");
});

test("the fleet and the worker are laid AFTER the install and the build, and BEFORE anything reads them", () => {
  const lay = ci.indexOf("rm -rf packages/worker-fleet packages/nvda-worker");
  assert.ok(lay > 0, "positive control: the laying step is found");
  assert.ok(lay > ci.indexOf("pnpm install --no-frozen-lockfile"), "laid after the install, or the clone would be read as a workspace member");
  assert.ok(lay > ci.indexOf("pnpm run build"), "laid after the build");
  assert.ok(lay < ci.indexOf("rm -rf packages/lab"), "laid before the lab, whose tests read them");
  assert.ok(lay < ci.indexOf("pnpm exec rstest run"), "laid before the tests");
  assert.ok(lay > ci.indexOf("git clone --quiet --depth 1 --branch \"$CONTROL_REF\""), "after control, so the three layers are laid in one order");
});

test("the tool is resolved at the newest release tag by the core's resolver, with no tag held here (a11ign/a11ign#4427)", () => {
  const resolve = 'node scripts/agent-org-newest-tag.ts --dest="$RUNNER_TEMP/agent-org"';
  const step = ci.indexOf(resolve);
  assert.ok(step > 0, "positive control: the resolver step is found");
  assert.ok(step < ci.indexOf("pnpm exec eslint"), "resolved before the lint");
  assert.ok(step < ci.indexOf("pnpm exec rstest run"), "resolved before the tests");
  assert.doesNotMatch(ci, /AGENT_ORG_PIN/, "no pin: the newest tag is what the tests read the tool at");
  // `CONTROL_REF`, `FLEET_REF` and `WORKER_REF` are the release tags written here, each the layer's own and pinned by the tests around this one; their lines are dropped so this still reads every other place a tag could hide.
  assert.doesNotMatch(ci.replace(/^ {2}(?:CONTROL|FLEET|WORKER)_REF: .*$/gm, ""), /\bv\d+\.\d+\.\d+\b/, "and no release tag is written in the code");
});

test("this repository's package replaces the core's own AFTER the install and the build, and before anything reads it", () => {
  // This repository's `package.json` names packages no registry holds, so a `packages/lab` laid before the install is a workspace member the install cannot resolve. (Until cut 9, a11ign/a11ign#5087, `prepare` also
  // laid the core's PINNED lab, which has no tests and no manifest, over whatever was there: laying first was "No test files found".)
  const lay = ci.indexOf("rm -rf packages/lab");
  assert.ok(lay > 0, "positive control: the laying step is found");
  assert.ok(lay > ci.indexOf("pnpm install --no-frozen-lockfile"), "laid after the install");
  assert.ok(lay > ci.indexOf("pnpm run build"), "laid after the build");
  assert.ok(lay < ci.indexOf("pnpm exec eslint"), "laid before the lint");
  assert.ok(lay < ci.indexOf("pnpm exec rstest run"), "laid before the tests");
});

test("the laid package is staged, then given its `@a11ign/control` package, in that order", () => {
  // Staged because the core's `packages/lab` is gitignored and the lab's tests walk `git ls-files`; the package comes AFTER, so it is not a tracked entry.
  // It is control's own manifest (read from the clone at `CONTROL_REF`) plus a link to the laid `src`, because since a11ign/a11ign#3506 the core's `packages/control` is a laid layer with NO `package.json`: a plain link has no `exports` to resolve `@a11ign/control/fleet-wake` through.
  const stage = ci.indexOf("git add -f packages/lab");
  const manifest = ci.indexOf('cp "$RUNNER_TEMP/control/package.json" "$control/package.json"');
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
  // Both run in the `own` leg only: the cross-repo leg is the tests, and a lint or type failure there would say nothing about the tests it reads.
  assert.match(ci, /pnpm exec eslint --no-ignore packages\/lab\n {8}if: matrix\.scope == 'own'\n/);
  const typecheck = ci.indexOf("pnpm exec tsc -p packages/lab/tsconfig.json --noEmit\n        if: matrix.scope == 'own'\n        working-directory: core");
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
