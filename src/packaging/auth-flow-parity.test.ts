/**
 * THE CONSTANTS THE WORKER SHARES WITH THE CLI'S `flows.ts` ARE EQUAL, FROM BOTH SIDES (ADR 0038).
 *
 * Split out of `packages/nvda-worker/src/auth-flow.test.ts` (#2612, child 1 of #69), which compared the worker's
 * `auth-flow.mjs` with `packages/cli/src/auth/flows.ts` by a `../../cli/` path. A layer that is to leave for its own
 * repository cannot lean on a sibling's file by path, and the two halves of a parity check must stay checked by
 * something, so THE ASSERTION MOVED and was not deleted.
 *
 * It lives in `lab` and not in `cli` because `lab` already declares `@a11ign/screenreader-worker`, which this reads BY NAME
 * (`./auth-flow` is exported for the purpose); `cli` would need a new manifest dependency and a lockfile edit for one
 * test. The CLI half is read by path, which is `lab` reaching a sibling core package and not a layer edge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ENV_NAME, EXPECT_DEFAULT_SECONDS, EXPECT_MAX_SECONDS, FLOW_VERBS } from "@a11ign/screenreader-worker/auth-flow";
import {
  EXPECT_DEFAULT_SECONDS as CLI_EXPECT_DEFAULT, EXPECT_MAX_SECONDS as CLI_EXPECT_MAX, FLOW_VERBS as CLI_FLOW_VERBS,
} from "../../../cli/src/auth/flows.js";

/**
 * THE VERBS THE CLI PARSES AND THE WORKER MAY NOT YET (a11ign/a11ign#5105, `CORE_REF` 2b8489a8d). The CLI's `flows.ts` gained `dismiss-if-shown` and `auto` (#4994) ahead of the
 * worker: the worker the core pins (`@a11ign/screenreader-worker` 0.9.0, `pnpm.overrides` in the core's `package.json`) knows neither, and the worker's later releases know
 * `dismiss-if-shown` and REFUSE `auto:` by name (screenreader-worker#46, a11ign/a11ign#5037). So "the two lists are equal" was true until the CLI moved and is not a claim this file can
 * make now; what it can still make is that no verb the worker knows is missing from the CLI, that the shared ones keep the CLI's order, and that a verb ONLY the CLI has is named here
 * with its reason. A new CLI verb the worker lacks therefore still fails this test until somebody writes down why.
 */
const CLI_ONLY_VERBS: Record<string, string> = {
  "dismiss-if-shown": "parsed by the CLI since #4994; the worker learned it in screenreader-worker#46, a release after the 0.9.0 the core pins",
  auto: "the CLI parses `auto:`; the worker refuses it by name (screenreader-worker#46, #5037)",
};

test("the verbs the worker shares with the CLI's flows.ts are the CLI's, in its order, and a verb only the CLI has is named with its reason", () => {
  const cli: string[] = [...CLI_FLOW_VERBS];
  const worker: string[] = [...FLOW_VERBS];
  assert.ok(worker.length > 0, "the worker declares no verb: the comparison below would pass having compared nothing");
  assert.deepEqual(cli.filter((verb) => worker.includes(verb)), worker,
    "every verb the worker knows must be a verb the CLI knows, in the CLI's order");
  assert.deepEqual(cli.filter((verb) => !worker.includes(verb) && !(verb in CLI_ONLY_VERBS)), [],
    "the CLI parses a verb the worker does not know and CLI_ONLY_VERBS does not say why");
  assert.deepEqual(Object.keys(CLI_ONLY_VERBS).filter((verb) => !cli.includes(verb)), [],
    "CLI_ONLY_VERBS names a verb the CLI no longer declares: remove the entry");
});

test("the constants the worker shares with the CLI's flows.ts are equal, from BOTH sides", () => {
  assert.equal(EXPECT_MAX_SECONDS, CLI_EXPECT_MAX);
  // `ENV_NAME` is not exported by flows.ts, so it is read from its source. The scrape's own guard: it must find one.
  const source = readFileSync(new URL("../../../cli/src/auth/flows.ts", import.meta.url), "utf8");
  const scraped = /const ENV_NAME = (\/.+\/);/.exec(source);
  assert.ok(scraped, "flows.ts no longer declares ENV_NAME in the shape this test reads; update it, do not delete it");
  assert.equal(String(ENV_NAME), scraped[1]);
  assert.equal(EXPECT_DEFAULT_SECONDS, CLI_EXPECT_DEFAULT);
});
