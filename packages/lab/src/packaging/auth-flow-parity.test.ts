/**
 * THE CONSTANTS THE WORKER SHARES WITH THE CLI'S `flows.ts` ARE EQUAL, FROM BOTH SIDES (ADR 0038).
 *
 * Split out of `packages/nvda-worker/src/auth-flow.test.ts` (#2612, child 1 of #69), which compared the worker's
 * `auth-flow.mjs` with `packages/cli/src/auth/flows.ts` by a `../../cli/` path. A layer that is to leave for its own
 * repository cannot lean on a sibling's file by path, and the two halves of a parity check must stay checked by
 * something, so THE ASSERTION MOVED and was not deleted.
 *
 * It lives in `lab` and not in `cli` because `lab` already declares `@a11ign/nvda-worker`, which this reads BY NAME
 * (`./auth-flow` is exported for the purpose); `cli` would need a new manifest dependency and a lockfile edit for one
 * test. The CLI half is read by path, which is `lab` reaching a sibling core package and not a layer edge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ENV_NAME, EXPECT_DEFAULT_SECONDS, EXPECT_MAX_SECONDS, FLOW_VERBS } from "@a11ign/nvda-worker/auth-flow";
import {
  EXPECT_DEFAULT_SECONDS as CLI_EXPECT_DEFAULT, EXPECT_MAX_SECONDS as CLI_EXPECT_MAX, FLOW_VERBS as CLI_FLOW_VERBS,
} from "../../../cli/src/auth/flows.js";

test("the constants the worker shares with the CLI's flows.ts are equal, from BOTH sides", () => {
  assert.deepEqual([...FLOW_VERBS], [...CLI_FLOW_VERBS]);
  assert.equal(EXPECT_MAX_SECONDS, CLI_EXPECT_MAX);
  // `ENV_NAME` is not exported by flows.ts, so it is read from its source. The scrape's own guard: it must find one.
  const source = readFileSync(new URL("../../../cli/src/auth/flows.ts", import.meta.url), "utf8");
  const scraped = /const ENV_NAME = (\/.+\/);/.exec(source);
  assert.ok(scraped, "flows.ts no longer declares ENV_NAME in the shape this test reads; update it, do not delete it");
  assert.equal(String(ENV_NAME), scraped[1]);
  assert.equal(EXPECT_DEFAULT_SECONDS, CLI_EXPECT_DEFAULT);
});
