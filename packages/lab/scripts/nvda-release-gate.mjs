#!/usr/bin/env node
// @ts-check
// command: refuse a release whose NVDA reading of the held-out set regressed against the shipped one

/**
 * `ceo`'s #928 ruling point 1: `releasability.mjs` gates a scorer release on held-out acceptance versus
 * the shipped model's, same 35-case set. Nothing asked the equivalent question of the screen-reader/NVDA
 * LAYER itself -- `compareCapture` (`evidence-diff.mjs`) already answers "did the evidence change" per
 * field, but nothing ran it across a RELEASE boundary, against a stored shipped reading, as a gate that
 * can stop a pipeline. This is that gate; `nvda-release-regression.mjs` is the decision, this is the
 * wiring -- reading the candidate's own held-out captures and the shipped baseline off disk, and exiting
 * non-zero when the decision refuses.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";
import { readCapture } from "../src/capture/evidence-diff.mjs";
import { nvdaReleaseRegression } from "../src/packaging/nvda-release-regression.mjs";
import { REPO_ROOT, datasetRoot, captureRoot } from "../src/dataset-paths.mjs";

refuseUnknownFlags([], { entry: import.meta.url, command: "npm run gate:nvda-release" });

/**
 * The candidate's own held-out acceptance corpus -- `training:generate-acceptance` writes its manifest,
 * the fleet writes its captures. Overridable so this gate can be PROVEN rather than trusted
 * (`docs/proving-a-gate.md` step 2), the same convention `check-rehearsal-currency.mjs`'s
 * `A11Y_REHEARSAL_ROOT` and `promote-model.mjs`'s `A11Y_PROMOTE_ROOT` use for the same reason. Deliberately
 * its OWN name rather than the shared `DATASET_ROOT` -- that variable already means something to
 * `training:export-acceptance` and a dozen siblings in the same process tree, and this gate's fixture root
 * must not repoint them by accident.
 */
const CANDIDATE_ROOT = process.env.A11Y_NVDA_RELEASE_CANDIDATE_ROOT
  ? resolve(REPO_ROOT, process.env.A11Y_NVDA_RELEASE_CANDIDATE_ROOT)
  : datasetRoot("screenreader-acceptance");

/**
 * The stored snapshot of the currently-SHIPPED NVDA layer's reading of the same held-out set --
 * `nvdaReleaseRegression`'s `shipped` side of each pair. Empty (or entirely absent) on a repo that has
 * never run this gate before, which is a NOTE ("no shipped reading stored yet"), never a blocker -- the
 * first release must be possible, exactly as `releasability.mjs` treats no shipped model. See
 * `packages/lab/baselines/nvda-acceptance-shipped/README.md` for how a real snapshot gets committed here.
 */
const SHIPPED_ROOT = process.env.A11Y_NVDA_RELEASE_SHIPPED_ROOT
  ? resolve(REPO_ROOT, process.env.A11Y_NVDA_RELEASE_SHIPPED_ROOT)
  : resolve(REPO_ROOT, "packages/lab/baselines/nvda-acceptance-shipped");

const VARIANTS = /** @type {const} */ (["good", "bad"]);

/**
 * The case ids this release's held-out set names, read from the CANDIDATE's own manifest rather than
 * imported from `acceptance-matrix.mjs` -- the manifest is what the fleet actually captured against, and a
 * candidate whose generator ran ahead of a case-matrix change must be judged on what it captured, not on
 * whatever the source tree currently defines (`manifestDrift`, `manifest-matches-cases.mjs`, already
 * refuses that gap at export time; this gate does not need a second copy of it).
 *
 * @returns {string[] | null} `null` when the candidate has not generated a held-out set at all
 */
function candidateCaseIds() {
  const manifestPath = resolve(CANDIDATE_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return (manifest.cases ?? []).map((/** @type {{ id: string }} */ c) => c.id);
}

/**
 * Both readings of one case/variant, read off disk -- `readCapture` returns `null` for a file that does
 * not exist, and throws (never swallows) on one that exists and will not parse, exactly as it does for
 * every other consumer of the capture cache.
 *
 * @param {string} id @param {string} variant
 */
function readPair(id, variant) {
  return {
    id, variant,
    shipped: readCapture(captureRoot(SHIPPED_ROOT), id, variant),
    candidate: readCapture(captureRoot(CANDIDATE_ROOT), id, variant),
  };
}

/** @returns {number} process exit code */
function main() {
  const ids = candidateCaseIds();
  if (ids === null) {
    process.stdout.write(`  no held-out acceptance manifest at ${resolve(CANDIDATE_ROOT, "manifest.json")}`
      + " -- generate and capture it first (`npm run training:generate-acceptance` and the fleet capture "
      + "that follows it).\n");
    const verdict = gateVerdict({ examined: 0, of: 1, source: "the candidate's held-out acceptance manifest", failures: 1 });
    process.stdout.write(`\n  ${renderVerdict(verdict)}\n`);
    return exitCodeFor(verdict);
  }

  const pairs = ids.flatMap((id) => VARIANTS.map((variant) => readPair(id, variant)));
  const { blockers, notes } = nvdaReleaseRegression({ pairs });

  for (const note of notes) process.stdout.write(`  NOTE: ${note}\n`);
  for (const blocker of blockers) process.stdout.write(`  BLOCKED: ${blocker}\n`);

  const verdict = gateVerdict({
    examined: pairs.length, of: pairs.length,
    source: `the held-out acceptance corpus (${ids.length} case(s) x ${VARIANTS.length} variant(s))`,
    failures: blockers.length,
  });
  process.stdout.write(`\n  ${renderVerdict(verdict)}\n`);
  return exitCodeFor(verdict);
}

if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) {
  process.exit(main());
}
