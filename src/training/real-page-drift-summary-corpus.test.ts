/**
 * #781's own acceptance-4-shaped check, split from `real-page-drift-summary.test.ts` because importing
 * `runsRoot()` at all -- even inside a callback that honestly skips when `runs/` is absent -- marks an
 * ENTRY file corpus-dependent for `acceptance-commands.mjs`'s closure walk (`packages/lab/CLAUDE.md`'s "a
 * gate that reads runs/ is not yours to report": `runs/` is gitignored, so a GitHub-hosted CI runner never
 * has one). This file is not named in #781's Acceptance section; it is a PRE-CHECK, run locally by whoever
 * holds the fixture -- exactly #780's own `real-page-identity-summary.test.ts` acceptance-4 pattern.
 *
 *   npx tsx --test packages/lab/src/training/real-page-drift-summary-corpus.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { driftDistributionsByUrl, driftSummaryLine } from "./real-page-drift-summary.mjs";
import { runsRoot } from "../dataset-paths.mjs";
import { corpusReadable, skipLine } from "./corpus-settled.mjs";

test("#781: the real hubspot/calendly/ikea witness captures on disk, replayed", (t) => {
  const dir = join(runsRoot(), "witness");
  const guard = corpusReadable({ evidenceDirs: [dir], present: existsSync(dir) });
  if (!guard.read) { t.skip(skipLine(guard)); return; }
  const files = readdirSync(dir).filter((name) => /hubspot|calendly|ikea/.test(name));
  if (files.length === 0) { t.skip("no pre-registered real-page captures on this machine's runs/witness/"); return; }
  const records = files.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  const byUrl = driftDistributionsByUrl(records);
  for (const entry of byUrl) process.stdout.write(driftSummaryLine(entry));
  assert.ok(byUrl.length > 0);
});
