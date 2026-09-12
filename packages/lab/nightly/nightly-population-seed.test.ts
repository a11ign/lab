/**
 * #1135: THE FIRST RESIDENT OF THE NIGHTLY-ONLY POPULATION, so the population is never empty.
 *
 * `npm run test:nightly` refuses a glob that resolves to zero files (`assert-glob-not-empty`, `--min=1`),
 * which is the right refusal: an emptied directory reads identically to a passing one otherwise. But a
 * refusal on the first night, before #908 has moved any residual here, would read as the wiring being
 * broken rather than the population being new. This file is the population until a real one arrives, and
 * it asserts the one fact that is true of every file here and false of every file the PR path runs: it
 * lives under `packages/<pkg>/nightly/`, not `src/`. When #908's first residual lands, this file may go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

test("#1135 this file runs from the nightly-only path, which the PR suite's glob cannot reach", () => {
  const here = fileURLToPath(import.meta.url);
  assert.match(here, /\/packages\/[^/]+\/nightly\//, "under packages/<pkg>/nightly/");
  assert.doesNotMatch(here, /\/packages\/[^/]+\/src\//, "never under src/, or the PR path would run it too");
});
