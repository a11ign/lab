/**
 * CI INSTALLS WITH pnpm, AND THE CACHE FOLLOWS (#2298, child 2 of #57).
 *
 * The migration can look done and not be in four ways, each pinned here against the parsed workflows (comments and
 * prose are not steps, so a workflow that only MENTIONS `npm ci` in a history note does not fail):
 *
 *   - a job still runs `npm ci` / `npm install`, so CI resolves a different tree than the one pnpm-lock.yaml records;
 *   - a job still asks setup-node for `cache: npm`, which caches npm's download cache and never sees pnpm's store;
 *   - a cache is still keyed on `package-lock.json`, which no longer changes when a dependency does under pnpm, so it
 *     never invalidates (the silent one: it reads green and restores a stale tree);
 *   - a job runs `pnpm install` without a pnpm on PATH (`pnpm/action-setup` must come first, also because setup-node's
 *     `cache: pnpm` shells out to `pnpm store path`), or without `--frozen-lockfile`, which lets CI rewrite the
 *     lockfile it is meant to be checking.
 *
 * `release.yml` WAS EXEMPT until #2301 moved the publish path (it had to prove `gate:isolation` and a green dry run
 * first), and is covered here like every other workflow now. `pnpm-publish-path.test.ts` pins what is specific to it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const WORKFLOWS = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));
interface Step { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
interface Job { steps?: Step[] }

/** Every job with steps, across every workflow file, as `file:job`. */
function jobs(): { where: string; steps: Step[] }[] {
  return readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).flatMap((file) => {
    const doc = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs?: Record<string, Job> };
    return Object.entries(doc.jobs ?? {}).flatMap(([name, job]) =>
      (job.steps ? [{ where: `${file}:${name}`, steps: job.steps }] : []));
  });
}

/** A step's shell lines with blank and comment lines dropped: a command named only in prose runs nothing. */
const codeLines = (step: Step): string[] =>
  (step.run ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));

const allSteps = () => jobs().flatMap((j) => j.steps.map((step) => ({ where: j.where, step })));
const installLines = () => allSteps().flatMap(({ where, step }) =>
  codeLines(step).filter((l) => /\bpnpm install\b/.test(l)).map((line) => ({ where, line })));

/** Below these the scan has broken rather than the repo shrunk: measured 2026-09-24 at 19 installs and 16 pnpm caches (20 and 17 with release.yml, #2301). */
const MIN_INSTALLS = 15;
const MIN_PNPM_CACHES = 12;

test("#2298: no job in any workflow installs with npm", () => {
  const offenders = allSteps().flatMap(({ where, step }) =>
    codeLines(step).filter((l) => /\bnpm (ci|install)\b/.test(l)).map((l) => `${where}: ${l}`));
  assert.ok(installLines().length >= MIN_INSTALLS, `only ${installLines().length} pnpm installs found; the scan is broken`);
  assert.deepEqual(offenders, [], "these still resolve CI's tree from package-lock.json, not pnpm-lock.yaml");
});

test("#2298: no setup-node asks for npm's cache, and every pnpm one is present", () => {
  const caches = allSteps().flatMap(({ where, step }) =>
    (step.uses ?? "").startsWith("actions/setup-node@") && step.with?.cache ? [{ where, cache: step.with.cache }] : []);
  assert.deepEqual(caches.filter((c) => c.cache !== "pnpm"), [], "`cache: npm` never sees pnpm's store");
  assert.ok(caches.length >= MIN_PNPM_CACHES, `only ${caches.length} setup-node caches found; the scan is broken`);
});

test("#2298: no cache is keyed on package-lock.json, and the rstest cache is keyed on pnpm-lock.yaml", () => {
  const caches = allSteps().filter(({ step }) => (step.uses ?? "").startsWith("actions/cache@"));
  const stale = caches.filter(({ step }) => `${step.with?.key ?? ""}${step.with?.["restore-keys"] ?? ""}`.includes("package-lock"));
  assert.deepEqual(stale.map((s) => s.where), [], "a key on the OLD lockfile never invalidates when pnpm-lock.yaml changes");
  const rstest = caches.filter(({ step }) => String(step.with?.path ?? "").includes("rstest"));
  assert.equal(rstest.length, 1, "positive control: the one remaining cache is rstest's");
  assert.match(String(rstest[0].step.with?.key), /pnpm-lock\.yaml/);
});

test("#2298: every pnpm install is frozen, and every job that needs a pnpm has one set up before it", () => {
  const unfrozen = installLines().filter(({ line }) => !line.includes("--frozen-lockfile")).map((i) => `${i.where}: ${i.line}`);
  assert.deepEqual(unfrozen, [], "an unfrozen install lets CI rewrite the lockfile it is checking");

  const unready = jobs().flatMap(({ where, steps }) => {
    const setup = steps.findIndex((s) => (s.uses ?? "").startsWith("pnpm/action-setup@"));
    const firstNeed = steps.findIndex((s) => codeLines(s).some((l) => /\bpnpm install\b/.test(l)) || s.with?.cache === "pnpm");
    return firstNeed >= 0 && (setup < 0 || setup > firstNeed) ? [`${where} (needs pnpm at step ${firstNeed}, sets it up at ${setup})`] : [];
  });
  assert.deepEqual(unready, []);
});
