import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PROTOCOL_VERSION_FILE } from "@a11y-witness/control/fleet-playbook";
import { CAPTURE_PROTOCOL_VERSION } from "@a11y-witness/nvda-worker/protocol-version";

/**
 * The deploy guard SCRAPES `CAPTURE_PROTOCOL_VERSION` out of a worker file, and the file it scrapes moved.
 *
 * `fleet:deploy` refuses to run when it cannot read that constant — correctly, because deploying a
 * protocol bump invalidates every cached capture, and a guard that cannot tell must not guess. It reads
 * the file as TEXT rather than importing it, also correctly: the worker's capture modules import guidepup,
 * which throws `No available supported screen readers` at import on any host without one, and on a Mac
 * VoiceOver makes that throw invisible. A control-plane script must not need a screen reader to deploy.
 *
 * On 2026-09-06 `capture-core.mjs` was split three ways and the constant moved to its own module. The
 * guard went on scraping the old file, found nothing, and refused EVERY deploy — with the fleet ten
 * commits stale and a real-page recapture waiting on it. The guard was behaving exactly as designed while
 * pointed at the wrong place, which is the worst version of this repo's recurring shape: the surviving
 * path was a REFUSAL, so from a distance it looked like a guard doing its job.
 *
 * This pins the two together. Reading as text is forced by the guidepup problem, so the copies can be
 * neither deleted nor derived — CLAUDE.md's third remedy, pin them equal with a test.
 */
const WORKER_SRC = fileURLToPath(new URL("../../../nvda-worker/src/", import.meta.url));

test("the file the deploy guard scrapes is the file that declares CAPTURE_PROTOCOL_VERSION", () => {
  const text = readFileSync(`${WORKER_SRC}${PROTOCOL_VERSION_FILE}`, "utf8");
  const scraped = /CAPTURE_PROTOCOL_VERSION = (\d+)/.exec(text)?.[1];

  assert.ok(scraped !== undefined,
    `fleet:deploy scrapes CAPTURE_PROTOCOL_VERSION out of ${PROTOCOL_VERSION_FILE} and that file does not `
    + "declare it. Every deploy will refuse with \"cannot read CAPTURE_PROTOCOL_VERSION\". Point "
    + "PROTOCOL_VERSION_FILE at whichever worker module exports it now.");

  // And the SAME value the rest of the codebase imports -- a scrape that finds *a* number in the right
  // file but not the exported one would pass the check above and still deploy on a wrong answer.
  assert.equal(Number(scraped), CAPTURE_PROTOCOL_VERSION,
    `the deploy guard would read ${scraped} from ${PROTOCOL_VERSION_FILE}, but the exported constant is `
    + `${CAPTURE_PROTOCOL_VERSION}. The regex is matching something else in that file.`);
});
