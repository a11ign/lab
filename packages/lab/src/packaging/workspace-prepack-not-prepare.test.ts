/**
 * #168: `ci/ts` FAILED INTERMITTENTLY WITH ELEVEN TYPE ERRORS IN A PACKAGE THE PR NEVER TOUCHED --
 * A BUILD-ORDER RACE IN `npm ci`, NOT A REGRESSION.
 *
 * Five packages each carried BOTH `prepack: "tsc --build"` (fires on `npm pack`/`npm publish`, added in
 * cf8578de so a tarball built from a fresh checkout ships real code) AND an identical
 * `prepare: "tsc --build"`. `prepare` is the one that ALSO fires on `npm ci`/`npm install` (npm 10.9.8
 * runs it regardless of `--ignore-scripts`, #331) -- five independent, uncoordinated `tsc --build`
 * invocations, one per workspace, with nothing ordering "finish evidence's side-build before judge's own
 * side-build reads its dist/". `judge`'s own incremental `.tsbuildinfo`, written against a mid-write
 * snapshot of `evidence`'s dist, could then read as "up to date" once the deliberate, correctly-ordered
 * `npm run build` ran moments later -- which is why `tsc --build` never named a real fault in `evidence`
 * itself.
 *
 * `prepare` already covers everything `prepack` covers (npm's own documented lifecycle runs `prepare`
 * before packing too), so the pair was fully redundant, not two guards for two different risks. This
 * file pins the fix: `prepack` present, `prepare` absent, on every affected package.
 *
 * Verified live (not merely reasoned) on Node 22.23.2 / npm 10.9.8 -- the exact CI pin -- before writing
 * this test: with only `prepare` removed, `npm ci --ignore-scripts --loglevel=verbose` on a fresh clone
 * logs NO `run prepare`/`run prepack` line at all and `packages/evidence/dist` does not exist afterward,
 * while `npm pack --dry-run` inside `packages/evidence` still triggers `prepack` and ships a complete,
 * real `dist/` in the tarball -- the original cf8578de guarantee, intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGES_DIR = join(REPO, "packages");

/**
 * Every workspace package whose `package.json` declares a `prepack` script -- discovered, not listed,
 * for the identical reason `pre-install-import-graph.test.ts`'s own header gives: a hand-written list is
 * exactly the population a future sixth package silently falls outside of.
 */
function packagesWithPrepack(): string[] {
  const found: string[] = [];
  for (const dir of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = join(PACKAGES_DIR, dir.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts?.prepack) found.push(dir.name);
  }
  return found.sort();
}

test("VACUITY GUARD: the discovery finds a non-trivial population -- the five known publishable packages", () => {
  const found = packagesWithPrepack();
  assert.ok(found.length >= 5, `expected at least 5 packages with a prepack script, found ${found.length} `
    + `(${found.join(", ")}) -- the discovery walk is probably broken`);
});

test("ACCEPTANCE (#168): every package with prepack does NOT also carry an identical prepare -- the "
  + "redundant hook that raced during npm ci is gone", () => {
  const offenders: string[] = [];
  for (const name of packagesWithPrepack()) {
    const pkgPath = join(PACKAGES_DIR, name, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> };
    if (pkg.scripts.prepare === pkg.scripts.prepack) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    `these packages carry a prepare script identical to their prepack -- exactly the redundant pair that `
    + `raced during npm ci (#168): ${offenders.join(", ")}. prepare already covers everything prepack `
    + "covers, so remove prepare and keep prepack.");
});

test("MUTATION TARGET: prepack itself is still present on every one of those packages -- this removes "
  + "the RACE, not the safety net cf8578de added", () => {
  const missing = packagesWithPrepack().filter((name) => {
    const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, name, "package.json"), "utf8")) as
      { scripts: Record<string, string> };
    return pkg.scripts.prepack !== "tsc --build";
  });
  assert.deepEqual(missing, [], `these packages lost their prepack build step entirely: ${missing.join(", ")}`);
});
