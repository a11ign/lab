/**
 * A gate's exit code is a contract, and this repo has ~50 of them agreeing on nothing.
 *
 * `verdict.mjs` defines 0 PASS / 1 FAIL / 2 INCONCLUSIVE. Six scripts adopt it. Everywhere else, 2 means
 * usage error, or a stale build, or a missing precondition, or "the dispatch died before answering" —
 * script by script, undocumented, until now. `docs/gate-exit-codes.md` is the full table, read from source,
 * never inferred from a name.
 *
 * This test does not change a single exit code — see that document's "What this recommends": most of these
 * scripts collapse several real causes into one code on purpose, and changing one is changing a contract a
 * chain may already read. What it DOES do is make the gap impossible to grow silently: every script that
 * calls `process.exit`/sets `process.exitCode` with a code a caller might sequence on must be classified —
 * adopts `verdict.mjs`, is documented with its own scheme, or is shared infrastructure whose code is
 * inherited by whoever calls it. A new script joining the ~50 without a line here fails this test instead
 * of silently becoming an eighth meaning for exit code 2.
 *
 * Mirrors `cli-flags.test.ts`'s shape over the identical discovery method, for the identical reason: the
 * obvious "derive the codes from the source" test cannot be trusted — a script's exit codes are usually
 * behind named constants, ternaries and thrown errors a regex cannot resolve, so a derivation would report
 * zero for most of these and pass having examined nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const DOC = "docs/gate-exit-codes.md";

/**
 * The six scripts that import `gateVerdict`/`exitCodeFor` (or `fleetVerdict`, which wraps them) from
 * `verdict.mjs`, so their non-zero codes follow the shared 1=FAIL/2=INCONCLUSIVE contract rather than a
 * bespoke one. `check-shipped-provenance.mjs` is here AND flagged in the doc: it hardcodes
 * `examined: 1, of: 1`, so `examined < of` can never be true and it can never actually return 2 — adopting
 * the type does not guarantee exercising every state it defines.
 */
const ADOPTS_VERDICT = new Set<string>([
  "packages/lab/scripts/check-dataset-distribution.mjs",
  "packages/lab/scripts/score-rules.ts",
  "packages/lab/scripts/check-shipped-provenance.mjs",
  "packages/lab/scripts/gate-probe-order.mjs",
  "packages/lab/scripts/stability-gate.mjs",
  "packages/lab/scripts/check-real-page-findings.ts",
]);

/**
 * Shared machinery whose `process.exit` is inherited by whatever calls it — the exit code belongs to the
 * infrastructure, not to any one gate's verdict. Excluded from classification below for the same reason
 * `verdict.mjs` and `fleet.mjs` never appear in the discovered set at all: they don't decide anything
 * themselves, they are the thing gates are built from.
 */
const INFRASTRUCTURE: Record<string, string> = {
  "packages/lab/src/gates/dispatch.mjs":
    "dispatches a gate to the lab and exits with whatever it returns, except a killed/errored spawn also "
    + "produces 2 — self-documented as the honest INCONCLUSIVE for a dispatch that died, and the reason a "
    + "bare 2 from anything using this helper is ambiguous between three distinct causes. See the doc's "
    + "'gave up observing' section",
  "packages/worker-fleet/src/cli-flags.mjs":
    "`refuseUnknownFlags` exits 2 on an unrecognised flag — the one place in this repo code 2 means exactly "
    + "one thing by design, inherited by every one of its ~30 callers rather than chosen by them",
  "packages/worker-fleet/src/code-drift.mjs":
    "`assertWorkersServe` exits 3 for an empty worker pool or genuine code drift and has no `main` of its "
    + "own — whatever imports it inherits 3 directly, the same shape as `dispatch.mjs` one code over",
};

/**
 * Every other script discovered below must appear here: a one-line statement of what ITS non-zero codes
 * mean, sourced from the code (never inferred from the name), with the full detail in `docs/gate-exit-codes.md`.
 *
 * Read out of each file by hand, the same way `cli-flags.test.ts`'s `GUARDED` reasons are — a regex over
 * these call sites would resolve named constants (`capture-status.mjs`'s `EXIT` map), ternaries
 * (`lab-job.mjs`'s Ansible passthrough) and thrown-error catches (`guest-run.mjs`) inconsistently or not at
 * all, so deriving this list is the exact defect this file exists to prevent.
 */
const DOCUMENTED: Record<string, string> = {
  "packages/control/src/fleet-playbook.mjs":
    "2 five distinct argument/precondition refusals share one code; 3 a CAPTURE_PROTOCOL_VERSION refusal — "
    + "a SECOND, different meaning for 3 from promote-model's; 1 wrong commit OR a passed-through unit "
    + "status; 4 `followUnit` gave up watching a still-running unit — the clearest confirmed instance of "
    + "'stopped observing' read as 'failed' in this repo",
  "packages/control/src/lab-job.mjs":
    "its one exit call is a direct, unmodified passthrough of ansible-playbook's own raw exit status — "
    + "0/1/2/3/4/5/99/250 are ANSIBLE's documented codes, not this script's own, and a caller reading them "
    + "as a verdict about the JOB is reading Ansible's verdict about the PLAYBOOK",
  "packages/control/src/lab-pipeline.mjs":
    "2 seven distinct usage/precondition causes share one code; 3 'NOT LOADED' — no pipeline of this name "
    + "has run, a fourth distinct meaning for 3 in this table; 1 the unit's own Result/ExecMainStatus read "
    + "as failed; 0 covers three states on purpose (--list, still-running, and dispatch-succeeded, "
    + "explicitly NOT the same as 'the pipeline passed') — the --follow status exit passes through a "
    + "stage's own code, non-literal the same way lab-job.mjs's 1 is",
  "packages/lab/scripts/audit-corpus-starvation.mjs":
    "2 a stale export — the featurizer can't read a pre-`parsed`-block record; 0 otherwise",
  "packages/lab/scripts/audit-corpus-urls.mjs":
    "1 a corpus URL moved; 0 none moved — deliberately does not fail on an unreachable host, a check that "
    + "goes red for somebody else's outage teaches people to ignore it",
  "packages/lab/scripts/audit-observation-ambiguity.mjs":
    "0 in --json mode regardless of findings; 2 no captures found under the given root",
  "packages/lab/scripts/audit-rule-coverage.ts":
    "0 no captures to examine (an honest skip) or every rule-owned criterion validated; 1 a rule-owned "
    + "criterion has never fired on a real page anywhere; 2 the corpus is mid-run — a refusal to measure a "
    + "moving target",
  "packages/lab/scripts/audit-size-sensitivity.mjs":
    "2 corpus too small for either of two size checks; 1 a size-dependent accusation found; 0 otherwise",
  "packages/lab/scripts/bench-capture.mjs":
    "1 no worker/page given OR every live capture from --from-disk was lost — two causes share one code; "
    + "2 every live capture lost its socket",
  "packages/lab/scripts/build-realism-tier.mjs":
    "0 success, including the legitimate 'no training captures, base dataset only' state; 2 every training "
    + "capture truncated on a channel the model reads",
  "packages/lab/scripts/calibrate-abstention.mjs":
    "0 success; 2 no calibration captures found",
  "packages/lab/scripts/corpus-backup.mjs":
    "1 any of several precondition refusals, collapsed to one code",
  "packages/lab/scripts/corpus-snapshot.mjs":
    "0 success; 2 nothing to snapshot",
  "packages/lab/scripts/everything-pipeline.mjs":
    "0 every stage succeeded; 1 any stage failed OR crashed for an unrelated reason — two causes share one "
    + "code via its own pipeline() helper, not verdict.mjs",
  "packages/lab/scripts/evidence-check.mjs":
    "2 means THREE things in one file per its own contract comment ('0 safe to ship, 1 evidence changed, 2 "
    + "could not answer') — no --worker given, no comparable current-page capture, and unreadable page "
    + "title all share it",
  "packages/lab/scripts/explain-capture.mjs":
    "2 no search term given OR no capture file matched — usage and not-found share one code",
  "packages/lab/scripts/explain-scorer.mjs":
    "2 no --model= given outside --compare mode",
  "packages/lab/scripts/lab-inventory.mjs":
    "0 in --json mode, on EPIPE, and on one specific benign refusal; 2 the other refusal branch (schema/data "
    + "problem) — this script has NO exit-1 path at all, it never reports a hard FAIL",
  "packages/lab/scripts/promote-model.mjs":
    "2 no --from= given; 1 any thrown promotion error including a detected regression; 3 an uncommitted/"
    + "dirty git tree blocking promotion — a THIRD distinct meaning for 3",
  "packages/lab/scripts/retrain-pipeline.mjs":
    "1 a pipeline stage failed (same pipeline() helper as everything-pipeline.mjs) OR a named --candidate= "
    + "is not releasable; 0 otherwise",
  "packages/lab/scripts/verify-safetensors.mjs":
    "2 no model dir given, or one starting with '-'; 1 can't read the model dir OR the model has a real "
    + "problem — two causes share one code",
  "packages/lab/src/eval/rules-check.ts":
    "0 no false positives on conformant fixtures, including when zero fixtures were examined; 1 any false "
    + "positive found",
  "packages/lab/src/eval/run.ts":
    "0 by default, always, unless EVAL_GATE is set AND fitness fails (then 1, also 1 on a thrown error) — by "
    + "default this CANNOT fail on judge quality at all, only on a crash",
  "packages/lab/src/harnesses/assert-action-report.mjs":
    "0 every requested assertion passed; 1 no path argument OR any assertion failed — several assertion "
    + "kinds conflated into one code",
  "packages/lab/src/harnesses/capture-check.mjs":
    "0 all checks passed; 1 a real check failure; 2 malformed --worker OR a worker already serving — two "
    + "meanings share 2",
  "packages/lab/src/harnesses/capture-fixtures.mjs":
    "0 all fixtures recaptured; 1 some fixture failed; 2 no pages matched --set/--only",
  "packages/lab/src/harnesses/judge-file.ts":
    "0 ran; 1 no path argument OR judge() threw — one top-level catch for both",
  "packages/lab/src/harnesses/judge-sample.ts":
    "0 ran; 1 judge() threw. A one-off demo tool with no verdict concept",
  "packages/lab/src/harnesses/page-identity-rate.mjs":
    "0 no wrong-page reads; 1 a real wrong-page read; 2 malformed --worker; 3 'MEASURED NOTHING' — the fault "
    + "under test structurally could not occur, this script's own bespoke INCONCLUSIVE spelled 3 not 2",
  "packages/lab/src/harnesses/run-spike.ts":
    "0 ran; 1 no URL argument OR any thrown error. One-off spike tool",
  "packages/lab/src/training/capture-real-pages.mjs":
    "0 all pages captured; 1 any page failed; 2 bad --worker OR no pages for the given role; 3 fleet "
    + "browser-version inconsistency",
  "packages/lab/src/training/capture-screenreader-dataset.mjs":
    "0 default/success; 1 any thrown error; 2 host power state refuses to start (battery) without "
    + "--allow-battery — a precondition, not a verdict about any capture",
  "packages/lab/src/training/capture-status.mjs":
    "its own named EXIT map, the contract CLAUDE.md documents in prose: 0 clean, 1 finished with failures, 2 "
    + "no run recorded, 3 stale/'WEDGED' — identical scheme to wait-for-capture.mjs, independently",
  "packages/lab/src/training/check-signals.mjs":
    "1 no case matches --only, OR signalVerdict()'s own FAIL; 2 REFUSING on a stale local manifest, OR "
    + "signalVerdict()'s own INCONCLUSIVE below MIN_EXAMINED — both codes already carry two meanings before "
    + "its hand-written signalVerdict() (a from-scratch PASS/FAIL/INCONCLUSIVE, not imported from "
    + "verdict.mjs) is even reached",
  "packages/lab/src/training/page-server.mjs":
    "130/143 — standard Unix 128+signal codes for SIGINT/SIGTERM. A long-running daemon, not a gate",
  "packages/lab/src/training/preflight-screenreader-dataset.mjs":
    "0 generated page manifest validates; 1 a validation error in the manifest — reported, not a "
    + "screen-reader verdict, per the script's own note",
  "packages/lab/src/training/repeat-capture.mjs":
    "2 --probe-forms without --task OR a missing --url/--worker — two usage errors share 2; 1 any of five "
    + "distinct sub-conditions (too few samples, a varied field, an error, an empty capture, an inconsistent "
    + "capture) collapsed into one code",
  "packages/lab/src/training/wait-for-capture.mjs":
    "0 finished clean; 1 finished with failures; 2 no run recorded; 3 'wedged' — threshold-based on the "
    + "run's OWN declared captureTimeoutMs, confirmed principled rather than the 'gave up observing' "
    + "antipattern, per a specific request to check this one closely",
  "packages/worker-fleet/src/check-worker-code.mjs":
    "0 no worker configured, or zero stale workers found; 1 one or more workers serve a mismatched code hash "
    + "— an unreachable worker is explicitly excluded from 'stale'",
  "packages/worker-fleet/src/compare-workers.mjs":
    "2 usage error — missing page URL, or fewer than two workers named",
  "packages/worker-fleet/src/deploy-worker.mjs":
    "3 an uncommitted CAPTURE_PROTOCOL_VERSION bump refused — the exact 'fleet:deploy exits 3' incident "
    + "that prompted this audit; 2 no local worker VMs registered; 1 one or more VMs failed to deploy; 0 all "
    + "deployed",
  "packages/worker-fleet/src/doctor.mjs":
    "1 ready is false, any check failed; 0 all checks pass",
  // MOVED 2026-09-05 from `packages/worker-fleet/src/`. The published package read the PRIVATE `control`
  // package's `inventory.yml`, and these three had no cross-package dependents in either direction, so
  // they belonged where their consumers already live. This test caught the collision between that move and
  // this catalogue landing on the same day — in BOTH directions at once: a phantom (classified, no longer
  // there) and a hole (present, unclassified). Neither alone would have been visible in either diff.
  "packages/control/src/fleet-discover.mjs":
    "2 usage error, could not determine a subnet to scan; 1 a declared worker moved, or an unenrolled "
    + "worker remains after --enroll; 0 no mismatch — absence is explicitly not a fault",
  "packages/control/src/fleet-status.mjs":
    "1 zero workers reachable; 0 otherwise, INCLUDING when the fleet is reported SPLIT/inconsistent code — a "
    + "real operational problem invisible in the exit code entirely, not merely under-coded",
  "packages/control/src/fleet-wake.mjs":
    "2 no workers matched, or an empty inventory; 1 a requested worker timed out waking (does not "
    + "distinguish never-woke from woke-too-slowly — a softer version of 'gave up observing') OR has no MAC "
    + "on file; 0 every requested worker answered",
  "packages/worker-fleet/src/guest-run.mjs":
    "2 usage error; 1 via a top-level catch for ANY thrown error, including the polling-timeout path whose "
    + "own message reads 'the script may still be running' — a confirmed 'gave up observing' instance "
    + "conflated with real failures under one code",
  "packages/worker-fleet/src/normalise-fleet.mjs":
    "2 no a11y-worker* VMs registered; 1 one or more guests' normalise command failed for real; 0 otherwise",
};

/**
 * Does this file define an exit-code contract worth classifying? COMMENTS ARE STRIPPED FIRST, for the
 * identical reason `cli-flags.test.ts` strips them before matching `process.argv`: a file that only
 * MENTIONS `process.exit` in prose (this document's own past self, if it were source) is not a script that
 * exits with one.
 */
function hasExitContract(rel: string): boolean {
  if (!(rel.endsWith(".mjs") || rel.endsWith(".ts"))) return false;
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.mjs")) return false;
  const source = stripComments(readFileSync(join(REPO, rel), "utf8"));
  return source.includes("process.exit(") || source.includes("process.exitCode");
}

/** Every script with an exit-code contract — DISCOVERED, so a new one cannot arrive unclassified. */
function exitCodeModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(rel);
      else if (!entry.isDirectory() && hasExitContract(rel)) found.push(rel);
    }
  };
  const roots = ["packages/lab", "packages/worker-fleet", "packages/control"]
    .flatMap((pkg) => ["src", "scripts"].map((sub) => `${pkg}/${sub}`));
  for (const root of roots) {
    try { statSync(join(REPO, root)); } catch { continue; }
    walk(root);
  }
  return found;
}

test("every discovered script is in exactly one of ADOPTS_VERDICT, DOCUMENTED, INFRASTRUCTURE", () => {
  const all = exitCodeModules();
  const missing = all.filter((path) =>
    !ADOPTS_VERDICT.has(path) && !(path in DOCUMENTED) && !(path in INFRASTRUCTURE));
  assert.deepEqual(missing, [],
    `these call process.exit/set process.exitCode and are classified nowhere — read what each code means `
    + `from the source and add a line to ${DOC}, then classify here (never infer from the name)`);

  const inTwoPlaces = all.filter((path) => {
    const buckets = [ADOPTS_VERDICT.has(path), path in DOCUMENTED, path in INFRASTRUCTURE]
      .filter(Boolean).length;
    return buckets > 1;
  });
  assert.deepEqual(inTwoPlaces, [], "a script cannot adopt the contract AND carry its own — pick one");
});

test("every classified path still exists and still has an exit contract", () => {
  // A stale entry hides a rename or deletion the same way a stale UNGUARDED entry does in
  // cli-flags.test.ts: it would silently exempt nothing while making the covered set look larger than it
  // is, and the renamed file would fail the discovery test above as a surprise instead of as a diff here.
  for (const path of [...ADOPTS_VERDICT, ...Object.keys(DOCUMENTED), ...Object.keys(INFRASTRUCTURE)]) {
    assert.ok(existsSync(join(REPO, path)), `${path} is classified but no longer exists`);
    assert.ok(hasExitContract(path),
      `${path} is classified as having an exit-code contract but no longer calls process.exit / sets `
      + `process.exitCode — remove its entry`);
  }
});

test("every ADOPTS_VERDICT script actually imports the shared contract", () => {
  for (const path of ADOPTS_VERDICT) {
    const source = readFileSync(join(REPO, path), "utf8");
    assert.match(source, /exitCodeFor\(/,
      `${path} is listed as adopting verdict.mjs's contract but does not call exitCodeFor(...)`);
  }
});

test("docs/gate-exit-codes.md exists and names the dangerous shape", () => {
  // The one thing the assigning session specifically asked to have named separately: an exit code that
  // means "I stopped observing" rather than "the thing failed".
  const doc = readFileSync(join(REPO, DOC), "utf8");
  assert.match(doc, /gave up watching/i,
    "the doc must record fleet-playbook.mjs's followUnit as a confirmed 'gave up observing' instance");
  assert.match(doc, /examined: 1, of: 1/,
    "the doc must record that check-shipped-provenance.mjs can never produce its own INCONCLUSIVE state");
});
