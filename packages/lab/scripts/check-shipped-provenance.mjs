#!/usr/bin/env node
// @ts-check

/**
 * REFUSE a release whose weights no changelog entry accounts for.
 *
 * The reasoning is in `shipped-provenance.mjs`. This file is the wiring: read the shipped training
 * report, the pending `promote-*.md` changesets and the package CHANGELOG, and report what the pure
 * function finds.
 *
 * It runs in `release:gate` rather than in `npm test` because it is a property of a RELEASE, not of the
 * source: a tree with no pending promotion and a published changelog is correct, and the same tree
 * mid-promotion is not. Putting it in the unit suite would make it fail for everyone the moment somebody
 * started a promotion, which is how a check gets deleted.
 */
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { provenanceLines } from "./promote-model.mjs";
import { provenanceProblems } from "../src/packaging/shipped-provenance.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

refuseUnknownFlags([], { entry: import.meta.url, command: "npm run release:provenance" });

/**
 * The tree to examine. Overridable so this gate can be PROVEN.
 *
 * `docs/proving-a-gate.md` step 2: separate the DECISION from the DATA, or the only way to watch a gate
 * refuse is to break the repo. Every path below derives from one root, so a test plants a three-file tree
 * in a temp directory and gets the real command, the real exit code and the real message -- which is the
 * tier that matters here, since this repo's recurring defect is a correct decision some path never
 * reaches. Same convention as `audit-rule-coverage.ts`'s `CAPTURE_ROOT`.
 */
const REPO = process.env.A11Y_PROVENANCE_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const SHIPPED = resolve(REPO, "packages/scorer/models/screenreader-scorer/training-report.json");
const CHANGESETS = resolve(REPO, ".changeset");
const CHANGELOG = resolve(REPO, "packages/scorer/CHANGELOG.md");

/** @returns {number} process exit code */
function main() {
  const shippedReport = existsSync(SHIPPED)
    ? JSON.parse(readFileSync(SHIPPED, "utf8"))
    : null;
  const changesets = existsSync(CHANGESETS)
    ? readdirSync(CHANGESETS)
      .filter((name) => name.startsWith("promote-") && name.endsWith(".md"))
      .map((name) => ({ name, text: readFileSync(join(CHANGESETS, name), "utf8") }))
    : [];
  const changelog = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : null;

  const problems = provenanceProblems({ shippedReport, changesets, changelog, renderProvenance: provenanceLines });

  // WHAT IT EXAMINED, always. A pass that does not say how many entries it read is indistinguishable from
  // a pass over an empty directory, which is this repo's definition of a check that reports success
  // having examined nothing.
  process.stdout.write(`  ${changesets.length} pending promotion changeset(s); `
    + `CHANGELOG ${changelog ? "present" : "absent (never published)"}\n`);
  for (const problem of problems) process.stdout.write(`\n  ${problem}\n`);
  if (problems.length) {
    process.stdout.write("\n  The weights ARE the API (ADR 0007), so a release that cannot say which model "
      + "it ships is one nobody can trace a finding back to.\n");
  }
  // COVERAGE IS TRIVIALLY 1 HERE, and saying so is the honest version rather than manufacturing a
  // denominator. There is one shipped model; the question is whether its provenance is stated. A missing
  // shipped report or an absent changeset is a PROBLEM that `provenanceProblems` names, not a coverage gap.
  //
  // The value of the shape here is consistency and the SOURCE string: every gate in this repo now reports
  // in the same shape, so a reader does not have to learn each one's dialect to know what was examined —
  // determinism-plan D6.
  const verdict = gateVerdict({
    examined: 1,
    of: 1,
    source: `the shipped weights, ${changesets.length} pending changeset(s) and the CHANGELOG`,
    failures: problems.length,
  });
  process.stdout.write(`\n  ${renderVerdict(verdict)}\n`);
  return exitCodeFor(verdict);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
