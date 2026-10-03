// no-token: gh -- reads package.json and runs a local script; no `gh`, `herdr` or network is reached
/**
 * #3277: `scripts/release-gate-scope.mjs` PARSED ZERO STAGES and printed it as a count.
 *
 * `release:gate` changed its links from `pnpm run <stage>` to `node scripts/pnpm.mjs run <stage>`, the script's
 * pattern (`npm run ...`) stopped matching, and its subset check passed `0 + 0 === 0`, so the release workflow
 * warned "ran 0 of release:gate's 0 stages". The positive control is the count DERIVED from the real chain by
 * splitting on `&&`, which shares no code with the script's pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stagesOf, gateScope } from "../../../../scripts/release-gate-scope.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const { scripts } = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as { scripts: Record<string, string> };

/** The number of `run <stage>` links in a chain, counted by splitting on `&&` (not by the script's pattern). */
function linksIn(chain: string): number {
  return chain.split("&&").filter((link) => /\brun\s+[\w:.-]+/.test(link)).length;
}

test("the real release chains parse to as many stages as they have links", () => {
  for (const name of ["release:gate", "release:gate:ci"]) {
    const stages: string[] = stagesOf(scripts, name);
    assert.ok(stages.length > 0, `${name} parsed to zero stages`);
    assert.equal(stages.length, linksIn(scripts[name]), `${name}: stages parsed vs links in the string`);
  }
});

test("the positive control itself counts: the real chains have links to count", () => {
  assert.ok(linksIn(scripts["release:gate"]) > linksIn(scripts["release:gate:ci"]));
  assert.ok(linksIn(scripts["release:gate:ci"]) > 0);
});

test("a chain that parses to zero stages is refused, naming the pattern expected", () => {
  assert.throws(() => stagesOf({ x: "echo hello && true" }, "x"), /parsed to zero stages.*run/s);
  assert.throws(() => stagesOf({}, "missing"), /parsed to zero stages/);
  assert.throws(
    () => gateScope({ "release:gate": "echo a", "release:gate:ci": "echo b" }),
    /parsed to zero stages/,
    "0 + 0 === 0 must not pass the subset check",
  );
});

test("both spellings of a link parse", () => {
  const node = "node scripts/pnpm.mjs run x && node scripts/pnpm.mjs run y";
  assert.deepEqual(stagesOf({ c: node }, "c"), ["x", "y"]);
  assert.deepEqual(stagesOf({ c: "pnpm run x" }, "c"), ["x"]);
  assert.deepEqual(stagesOf({ c: "npm run x && npm run z:w" }, "c"), ["x", "z:w"]);
});

test("gateScope separates what ci runs from what it leaves to the lab", () => {
  const scope = gateScope({
    "release:gate": "node scripts/pnpm.mjs run a && node scripts/pnpm.mjs run b && node scripts/pnpm.mjs run c",
    "release:gate:ci": "node scripts/pnpm.mjs run a",
  });
  assert.deepEqual(scope, { full: ["a", "b", "c"], ci: ["a"], skipped: ["b", "c"] });
});

test("run against the real package.json the script states a nonzero count", () => {
  const out = execFileSync("node", ["scripts/release-gate-scope.mjs"], { cwd: ROOT, encoding: "utf8" });
  const { full, ci } = gateScope(scripts);
  assert.ok(out.startsWith(`::warning::release:gate:ci ran ${ci.length} of release:gate's ${full.length} stages.`), out);
  assert.doesNotMatch(out.split("\n")[0], /ran 0 of/);
});
