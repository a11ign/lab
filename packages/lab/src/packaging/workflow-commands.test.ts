/**
 * Every command CI runs must exist — including the ones it only NAMES in advice.
 *
 * `workflow-filters.test.ts` already checks that `node packages/….mjs` paths in `capture-regression.yml`
 * exist. Nothing checked `npm run <script>`, in any workflow, and that is the more common shape: five
 * workflows and `action.yml` invoke eight scripts between them, and a rename would surface as
 * `Missing script` on a runner rather than here.
 *
 * The echoed ones count too. Twice today a message told the reader to run a command that does not exist
 * (`--write-baseline` for `--update-baseline`, and a job name that was never added), and an error naming a
 * command nobody can run is worse than no suggestion — the reader trusts it and loses the time twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(REPO, "package.json"), "utf8")).scripts ?? {};

/** Every CI-owned file that can invoke something: the workflows, plus the published action. */
function ciFiles(): string[] {
  const workflows = readdirSync(join(REPO, ".github/workflows"))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => `.github/workflows/${name}`);
  return [...workflows, "action.yml"].filter((path) => existsSync(join(REPO, path)));
}

test("every `npm run <script>` in CI names a script that exists", () => {
  const seen: string[] = [];
  const missing: string[] = [];
  for (const path of ciFiles()) {
    const text = readFileSync(join(REPO, path), "utf8");
    for (const [, name] of text.matchAll(/npm run (?:--silent )?([a-z][a-z0-9:-]*)/g)) {
      seen.push(`${path}:${name}`);
      if (!SCRIPTS[name]) missing.push(`${path} runs \`npm run ${name}\``);
    }
  }
  // A scan finding nothing passes having examined nothing — the failure this repo has shipped three times.
  assert.ok(seen.length >= 8,
    `found only ${seen.length} npm invocation(s) across ${ciFiles().length} CI file(s); the scan is broken`);
  assert.deepEqual(missing, [],
    "these would fail on a runner with `Missing script`, after npm ci and a full install have already run");
});

test("every program CI invokes by path exists", () => {
  // The generalisation of the existing check, which read ONE workflow. A `node packages/…` path that has
  // moved fails the same way and is just as invisible from here.
  const missing: string[] = [];
  let seen = 0;
  for (const path of ciFiles()) {
    const text = readFileSync(join(REPO, path), "utf8");
    for (const [, program] of text.matchAll(/node\s+(packages\/[A-Za-z0-9._/-]+\.mjs)/g)) {
      seen += 1;
      if (!existsSync(join(REPO, program))) missing.push(`${path} runs ${program}`);
    }
  }
  assert.ok(seen > 0, "found no program invocations across the CI files; the scan is broken");
  assert.deepEqual(missing, [], "these paths do not exist in the repo");
});
