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
 *
 * ## Python — added 2026-09-06, after this test's own filter was the gap
 *
 * `hasExitContract` filtered to `.mjs`/`.ts` from the day this file was written, which was correct then —
 * `gateVerdict`/`fleetVerdict` are JS-only concepts — and became a defect the moment somebody treated "not
 * classified here" as "not a gate": the eight Python-driven `lab-job.yml` scripts had never been asked
 * whether examining fewer records than expected can silently exit 0 (`docs/backlog.md`, "Python gates and
 * the partial-corpus question"), and that audit found two real gaps and fixed them. **A one-off audit is
 * not a standing guard** — nothing stopped a ninth Python gate arriving with the same defect, and nothing
 * would have noticed if either fix were reverted. This section is the guard the audit needed and did not
 * have: `hasExitContractPy`/`DOCUMENTED_PY`/`INFRASTRUCTURE_PY` are the identical discover-and-classify
 * shape as the `.mjs`/`.ts` side above, over Python's own syntax.
 *
 * Scoped to `packages/lab/scripts` and `packages/scorer/python` — the two directories where every
 * `lab-job.yml`-dispatched Python script actually lives, matching this document's own existing boundary
 * statement ("this table covers the `.mjs`/`.ts` layer, not the Ansible playbook layer"). Two other
 * directories with `sys.exit`-calling `.py` files were deliberately excluded, each for a reason stated
 * once rather than a silent omission: `packages/control/ansible/**` (Ansible module/playbook tooling —
 * `check-modules.py` and the collection's custom modules follow Ansible's own module-exit-code contract,
 * a different domain entirely) and `packages/nvda-speech/**` (a GPL-licensed announcement-composition
 * port with its own standalone data-generation scripts, no `lab-job.yml` entry or npm script reads any of
 * their exit codes as a verdict). Both are genuine package-boundary exclusions in the same spirit as this
 * file's own three-package root list above, not scope creep the walk happens not to reach.
 *
 * No shared Python `verdict.py` was built, deliberately — the earlier audit ruled this out explicitly
 * ("a second `gateVerdict` across the language boundary is the fact-stated-twice hazard in its most
 * expensive form") and that ruling stands. This is discovery and classification only, exactly as asked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";

/**
 * THE REPOSITORY ROOT, NOT A CORPUS ROOT — and the distinction is load-bearing enough to state.
 *
 * Every read in this file resolves against `REPO` and opens a script, a `.py` file, or
 * `docs/gate-exit-codes.md`. This file reads SOURCE; it never opens a capture, so
 * `corpus-readers-are-guarded.test.ts` classifies it `not-a-corpus-read` rather than requiring
 * `labCorpusReadable`. It became a candidate for that scan only because one INFRASTRUCTURE reason below
 * mentions `runsRoot()` in prose — a string about the corpus, not a read of it.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const DOC = "docs/gate-exit-codes.md";

/**
 * The six scripts that import `gateVerdict`/`exitCodeFor` (or `fleetVerdict`, which wraps them) from
 * `verdict.mjs`, so their non-zero codes follow the shared 1=FAIL/2=INCONCLUSIVE contract rather than a
 * bespoke one. `check-shipped-provenance.mjs` is here AND flagged in the doc: it hardcodes
 * `examined: 1, of: 1`, so `examined < of` can never be true and it can never actually return 2 — adopting
 * the type does not guarantee exercising every state it defines.
 */
/**
 * DERIVED, not listed — and it was a hand-written set of six until 2026-09-05.
 *
 * `verdict-adoption.test.ts` predates this file and already answers "does this gate adopt the verdict
 * helpers", by matching `gateVerdict(`/`fleetVerdict(` in the source. Maintaining a second list of the
 * same six scripts is this repo's most-repeated defect — a fact stated twice with nothing comparing the
 * copies — and the two could have disagreed silently: a script listed here as ADOPTING while the other
 * test carries it as `owed` would leave both green and the contradiction invisible.
 *
 * Deriving is CLAUDE.md's second remedy and is available here, so the list is gone. The regex is
 * deliberately the same one, for the same reason `name-normalisation.test.ts` drives both implementations
 * over one input: the point is that the two tests cannot form different opinions, not that they happen to
 * agree today.
 *
 * Found by the peer who wrote this file, self-reported after noticing the older test on a later pass.
 */
const DERIVED_VERDICT = /\b(gateVerdict|fleetVerdict)\(/;

/** The derived set, for the tests that need to iterate rather than ask about one path. */
function adoptingScripts(): string[] {
  return exitCodeModules().filter(adoptsVerdict);
}

function adoptsVerdict(path: string): boolean {
  // NOT a bare `catch { return false }`, and the first version of this was — which turned a typo (`ROOT`
  // for `REPO`) into "no script adopts the contract" and made all six read as unclassified. That is the
  // swallow-to-null shape this repo fixed in `readCapture` the same day: an unreadable file and a file
  // that genuinely does not adopt became the same answer, and the wrong one was the loud one.
  //
  // A MISSING file is the next test's finding, so it is the one case answered quietly. Anything else
  // rethrows, because a derivation that cannot read its own input must not report a verdict about it.
  if (!existsSync(join(REPO, path))) return false;
  return DERIVED_VERDICT.test(readFileSync(join(REPO, path), "utf8"));
}

/**
 * Shared machinery whose `process.exit` is inherited by whatever calls it — the exit code belongs to the
 * infrastructure, not to any one gate's verdict. Excluded from classification below for the same reason
 * `verdict.mjs` and `fleet.mjs` never appear in the discovered set at all: they don't decide anything
 * themselves, they are the thing gates are built from.
 */
const INFRASTRUCTURE: Record<string, string> = {
  "packages/lab/src/dataset-paths.mjs":
    "`refuseIfRunsReadonly` exits 3 when A11Y_RUNS_READONLY=1 is set and the given path resolves under "
    + "runsRoot() — not a gate and has no main of its own, inherited directly by every one of its 16 "
    + "callers, the identical shape code-drift.mjs uses for a different meaning of 3",
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
  "packages/lab/scripts/fleet-hours.mjs":
    "2 it billed no capture and REFUSES to report a total it did not measure — deliberately not 1, "
    + "because 1 would read as 'the fleet cost nothing', and a cost report that examined nothing "
    + "prints the same reassuring small number as a cheap run. 0 is a real total. It does not adopt "
    + "the verdict helpers because it is a REPORT rather than a gate: there is no pass/fail subject "
    + "to have partial coverage of, only a sum and the captures it could not bill, which it names",
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

test("every discovered script either ADOPTS the verdict helpers, or is DOCUMENTED / INFRASTRUCTURE", () => {
  const all = exitCodeModules();
  const missing = all.filter((path) =>
    !adoptsVerdict(path) && !(path in DOCUMENTED) && !(path in INFRASTRUCTURE));
  assert.deepEqual(missing, [],
    `these call process.exit/set process.exitCode and are classified nowhere — read what each code means `
    + `from the source and add a line to ${DOC}, then classify here (never infer from the name)`);

  const inTwoPlaces = all.filter((path) => {
    const buckets = [adoptsVerdict(path), path in DOCUMENTED, path in INFRASTRUCTURE]
      .filter(Boolean).length;
    return buckets > 1;
  });
  assert.deepEqual(inTwoPlaces, [], "a script cannot adopt the contract AND carry its own — pick one");
});

test("every classified path still exists and still has an exit contract", () => {
  // A stale entry hides a rename or deletion the same way a stale UNGUARDED entry does in
  // cli-flags.test.ts: it would silently exempt nothing while making the covered set look larger than it
  // is, and the renamed file would fail the discovery test above as a surprise instead of as a diff here.
  for (const path of [...adoptingScripts(), ...Object.keys(DOCUMENTED), ...Object.keys(INFRASTRUCTURE)]) {
    assert.ok(existsSync(join(REPO, path)), `${path} is classified but no longer exists`);
    assert.ok(hasExitContract(path),
      `${path} is classified as having an exit-code contract but no longer calls process.exit / sets `
      + `process.exitCode — remove its entry`);
  }
});

test("every script that adopts the verdict helpers actually imports the shared contract", () => {
  for (const path of adoptingScripts()) {
    const source = readFileSync(join(REPO, path), "utf8");
    assert.match(source, /exitCodeFor\(/,
      `${path} is listed as adopting verdict.mjs's contract but does not call exitCodeFor(...)`);
  }
});

// --- Python ---

/** `#` line comments and triple-quoted docstrings stripped -- so a docstring MENTIONING `sys.exit(` in
 * prose cannot be mistaken for a script that calls it, the identical reason `stripComments` exists above. */
function stripPyComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/#.*$/gm, "");
}

/** Deliberately excluded package roots -- see this file's header for why each one is a real boundary. */
const PY_ROOTS = ["packages/lab/scripts", "packages/scorer/python"];

/** pytest's own naming convention, not a gate shape -- separated out so it is testable without disk I/O. */
function isPyTestFile(filename: string): boolean {
  return filename.startsWith("test_") || filename.endsWith("_test.py");
}

function hasExitContractPy(rel: string): boolean {
  if (!rel.endsWith(".py")) return false;
  if (isPyTestFile(rel.split("/").pop()!)) return false;
  const source = stripPyComments(readFileSync(join(REPO, rel), "utf8"));
  return source.includes("sys.exit(") || source.includes("raise SystemExit");
}

/** Every script with an exit-code contract under the Python gate roots — DISCOVERED, same reason as above. */
function exitCodeModulesPy(): string[] {
  const found: string[] = [];
  for (const root of PY_ROOTS) {
    for (const entry of readdirSync(join(REPO, root), { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      const rel = `${root}/${entry.name}`;
      if (hasExitContractPy(rel)) found.push(rel);
    }
  }
  return found;
}

/**
 * Shared machinery whose `SystemExit` is inherited by every importer, never called as its own script —
 * neither has an `if __name__ == "__main__":` block. Same role as `INFRASTRUCTURE` above.
 */
const INFRASTRUCTURE_PY: Record<string, string> = {
  "packages/scorer/python/screenreader_features.py":
    "`assert_input_version` raises SystemExit (a plain string, so exit code 1) when a record was built "
    + "under a stale model-input contract -- called by every trainer/audit that reads exported records, "
    + "inherited rather than chosen by each of them",
};

/**
 * Every other discovered Python script: a one-line statement of what its non-zero codes mean, read from
 * the source, never inferred from the name — the identical discipline as `DOCUMENTED` above.
 */
const DOCUMENTED_PY: Record<string, string> = {
  "packages/lab/scripts/audit-scorer-shortcuts.py":
    "0 --update-baseline written, --no-baseline, no baseline file yet, or compare_to_baseline finds "
    + "nothing wrong; 1 any of REGRESSION/UNAUDITED/LOST COVERAGE (three distinct findings collapsed) OR "
    + "the exported corpus is empty (a plain-string SystemExit); 2 no record in the corpus could be "
    + "featurized at all -- the real 'examined nothing' refusal, distinct from an empty corpus",
    "packages/lab/scripts/check-screenreader-hardening.py":
    "0 every adversarial/hardening check passed; 1 any failed -- run via `npm run training:hardening`",
  "packages/lab/scripts/compose-multi-defect-probe.py":
    "a module-level ADR 0015 mechanism probe with no `if __name__` guard and no caller anywhere in this "
    + "repo -- run by hand only. Its one `raise SystemExit(f'...')` (a string, so exit 1) refuses when the "
    + "corpus has no donor page for a required marker feature",
  "packages/lab/scripts/diagnose-false-positives.py":
    "0 always, unconditionally, including on zero records -- NAMED, not fixed, in the earlier audit: no "
    + "gate or promotion decision reads this script's exit code today, a human runs it deliberately with a "
    + "record count already in hand",
  "packages/lab/scripts/evaluate-screenreader-acceptance.py":
    "0 held-out acceptance passed; 1 the acceptance result failed OR a precondition refusal (stamping a "
    + "verdict into tracked source) -- two distinct causes share 1; the bare code cannot itself distinguish "
    + "'could not measure stability' from a real regression, only the JSON/message can",
  "packages/lab/scripts/train-screenreader-model.py":
    "0 (implicit, `main() -> None`) trained; 1 three distinct precondition failures share it (a stale "
    + "realism-tier dataset, an unknown rule-ownership key, a forbidden key present in the export) -- all "
    + "plain-string SystemExits; 3 refuses to overwrite a RELEASE-ELIGIBLE model directory, a separate code "
    + "on purpose because the fix is different (train to a scratch --output instead of fixing the corpus)",
  "packages/scorer/python/audit_applicability.py":
    "0 no precondition silences a labelled positive; 1 a precondition DELETES real evidence a labelled "
    + "positive depends on; 2 no corpus found under runs/ -- the real INCONCLUSIVE",
  "packages/scorer/python/audit_container_exits.py":
    "0 always when anything could be examined -- report-only by design, a fact about NVDA's own container "
    + "announcements, never a corpus defect; 2 no corpus found OR no record could be parsed, two causes share it",
  "packages/scorer/python/audit_grants.py":
    "0 every accompanying defect grants the feature it declares; 1 a defect declares evidence the corpus "
    + "does not contain; 2 four distinct refusal causes (no grants map, no corpus, nothing survives the "
    + "stale-`parsed`-block filter, no multi-defect record matched) collapsed to one INCONCLUSIVE",
  "packages/scorer/python/explain_feature.py":
    "0 always when the requested subtype/feature pair has any samples; 2 no exported dataset at --data, OR "
    + "zero samples for the requested pair -- both real preconditions collapsed",
  "packages/scorer/python/export-encoder-onnx.py":
    "0 exported ONNX encoder matches the torch reference within tolerance; 1 embedding drift exceeds "
    + "tolerance, refuses to ship. Run once, offline, by hand -- CI never runs this",
};

test("every discovered Python script is DOCUMENTED or INFRASTRUCTURE", () => {
  const all = exitCodeModulesPy();
  // Vacuity guard: the known population at the time this was written is 12 (6 in each root). A lower
  // bound, not a pin -- a legitimate new script raises it; the test below is what catches one arriving
  // unclassified. This guard exists only to catch the walk itself breaking and finding nothing.
  assert.ok(all.length >= 10,
    `only found ${all.length} Python gate script(s) with an exit contract, fewer than the known census of `
    + "~12 -- the discovery (roots, or the sys.exit/SystemExit pattern) is probably broken, not the "
    + "population shrinking");

  const missing = all.filter((path) => !(path in DOCUMENTED_PY) && !(path in INFRASTRUCTURE_PY));
  assert.deepEqual(missing, [],
    `these Python scripts call sys.exit()/raise SystemExit and are classified nowhere -- read what each `
    + `code means from the source and add a line to ${DOC} and to DOCUMENTED_PY/INFRASTRUCTURE_PY here `
    + `(never infer from the name):\n${missing.map((m) => `  ${m}`).join("\n")}`);

  const inBoth = all.filter((path) => path in DOCUMENTED_PY && path in INFRASTRUCTURE_PY);
  assert.deepEqual(inBoth, [], "a script cannot be both a standalone gate and inherited infrastructure");
});

/**
 * THE DISPATCH SURFACES, read from their own text — `lab-job.yml`'s argv and `package.json`'s scripts.
 *
 * WHY THIS EXISTS, and it is the one thing the Python side above could not answer for itself. Its
 * discovery walks two DIRECTORIES; the row that asked for it (#12) asked for discovery DERIVED from
 * `lab-job.yml`, *"never a hand-written list — a forgotten job is the one that slips through"*. Those are
 * two different mechanisms and swapping one for the other silently is the wrong-mechanism shape
 * (`not-working.md` §26): a directory walk that happens to cover the catalogue today reads exactly like
 * one that was designed to.
 *
 * So neither replaces the other. The walk stays, because it is strictly the better primary — it finds a
 * Python gate nobody added to the catalogue, which a catalogue-derived scan structurally cannot — and
 * this test PROVES the containment the walk's scope silently assumes: every Python script either dispatch
 * surface names lives under `PY_ROOTS`, so nothing the lab actually runs is outside the walk's reach. The
 * same shape as `everything-chain.test.ts`, which permits a job to be COVERED by a stage and then
 * verifies each claimed containment rather than accepting the claim.
 *
 * A path here that is NOT under a root is not automatically a defect; it is a question with two answers —
 * add the root, or state why that script is not a gate — and this test's job is to make it impossible to
 * answer neither.
 *
 * **THE MEASUREMENT, ATTACHED, because a substitution without one is the wrong-mechanism shape.** Counted
 * 2026-09-06 across both surfaces: **12 distinct `.py` paths, every one inside a root.** So the walk IS a
 * superset of the catalogue today — and nothing pinned that it stays one, which is the whole reason this
 * test exists rather than a sentence claiming it.
 *
 * A second reader counted the same population by hand and got 11, one fewer. Not reconciled to a cause,
 * and deliberately not chased: the disagreement IS the argument for deriving the number here rather than
 * writing it down. Note only that both surfaces are read, not just the catalogue —
 * `check-screenreader-hardening.py` is reachable through `package.json`'s `training:hardening` and
 * appears in no `lab-job.yml` argv, so a catalogue-only count is short by construction.
 */
const DISPATCH_SURFACES = ["packages/control/ansible/lab-job.yml", "package.json"];
const PY_PATH = /\bpackages\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.py\b/g;

/** Every `.py` path either surface names, pytest files excluded — they are tests, not gates. */
function dispatchedPythonScripts(): string[] {
  const found = new Set<string>();
  for (const surface of DISPATCH_SURFACES) {
    for (const match of readFileSync(join(REPO, surface), "utf8").matchAll(PY_PATH)) {
      const rel = match[0];
      if (!isPyTestFile(rel.split("/").pop()!)) found.add(rel);
    }
  }
  return [...found].sort();
}

test("every Python script the lab actually dispatches lives inside the discovery walk's roots", () => {
  const dispatched = dispatchedPythonScripts();
  // THE VACUITY GUARD, AND IT COMES FIRST — deliberately, so "the derivation broke" can never be read as
  // "there are legitimately none". A regex that stops matching returns an empty list, every containment
  // check then passes trivially, and the test reports coverage having examined nothing. That is the exact
  // failure this repo has paid for in a signal-type scrape, a Jinja `\b`, and this file's own JS-side
  // derivation. Sized below the census (12 distinct paths across the two surfaces) rather than at it.
  //
  // Note the derived set is NOT the classified set and is not meant to be: `score.py`, `fetch-encoder.py`
  // and `report-screenreader-errors.py` are dispatched and call neither `sys.exit(` nor `raise
  // SystemExit`, so they have no exit contract to declare and the walk correctly ignores them. This test
  // asks only whether the walk could SEE them, which is the assumption its two roots quietly make.
  assert.ok(dispatched.length >= 8,
    `only ${dispatched.length} dispatched Python script(s) derived from ${DISPATCH_SURFACES.join(" and ")}. `
    + "The derivation is probably broken -- if the lab genuinely stopped dispatching Python, lower this "
    + "floor deliberately rather than letting an empty list read as full coverage");

  // THE OTHER DIRECTION, and it is the one that fails by name. A dispatched script is accounted for when
  // the walk DISCOVERED it, or when it is inside a root and has no exit contract at all -- in which case
  // the walk saw it and correctly had nothing to classify. Anything else is a script the lab runs and this
  // file structurally cannot reach, which is the state that must never be silent.
  const discovered = new Set(exitCodeModulesPy());
  const inScope = (rel: string) => PY_ROOTS.some((root) => rel.startsWith(`${root}/`));
  const unreachable = dispatched.filter((rel) => !discovered.has(rel) && !inScope(rel));
  assert.deepEqual(unreachable, [],
    "these Python scripts are dispatched by the lab but sit outside PY_ROOTS, so the discovery above "
    + "cannot see them and they can never be asked to declare their exit codes. Either add the root, or "
    + `state at PY_ROOTS why that script is not a gate:\n${unreachable.map((o) => `  ${o}`).join("\n")}`);
});

test("MUTATION: a dispatched path outside the roots is caught, not silently tolerated", () => {
  // Fired against a synthetic path rather than the real surfaces, because a clean repo is exactly what a
  // working guard produces and cannot itself demonstrate the guard works.
  const planted = "packages/nvda-speech/compose-announcement.py";
  assert.ok(!PY_ROOTS.some((root) => planted.startsWith(`${root}/`)),
    "a script outside both roots must fail the containment test above, or that test excuses everything");
  assert.ok(PY_ROOTS.some((root) => "packages/scorer/python/audit_grants.py".startsWith(`${root}/`)),
    "and a real in-scope script must still pass it, or the check refuses everything instead");
});

test("MUTATION: the path regex reads a real dispatch line and ignores a bare filename", () => {
  // The derivation's own correctness, independent of disk. A bare `test_applicability.py` (pytest's own
  // argument in lab-job.yml) must not be mistaken for a package-rooted script path.
  const line = "argv: ['.venv/bin/python', 'packages/scorer/python/audit_grants.py', '--data', 'x.jsonl']";
  assert.deepEqual([...line.matchAll(PY_PATH)].map((m) => m[0]),
    ["packages/scorer/python/audit_grants.py"]);
  assert.deepEqual([..."pytest test_applicability.py -q".matchAll(PY_PATH)].map((m) => m[0]), []);
});

test("every classified Python path still exists and still has an exit contract", () => {
  for (const path of [...Object.keys(DOCUMENTED_PY), ...Object.keys(INFRASTRUCTURE_PY)]) {
    assert.ok(existsSync(join(REPO, path)), `${path} is classified but no longer exists`);
    assert.ok(hasExitContractPy(path),
      `${path} is classified as having an exit-code contract but no longer calls sys.exit()/raises `
      + `SystemExit -- remove its entry`);
  }
});

// --- The guard must be shown to fail, in both directions ---

test("MUTATION: a docstring MENTIONING sys.exit is stripped, not mistaken for a real call", () => {
  const fixture = '"""This script does not call sys.exit( -- it just talks about it."""\nprint("ok")\n';
  assert.ok(!stripPyComments(fixture).includes("sys.exit("),
    "the docstring mention must be stripped, or a file merely TALKING about sys.exit reads as a real gate");
});

test("MUTATION: a # comment mentioning sys.exit is stripped too", () => {
  const fixture = "# this used to call sys.exit(1) but no longer does\nprint('ok')\n";
  assert.ok(!stripPyComments(fixture).includes("sys.exit("));
});

test("CONTROL: a real sys.exit call survives the strip", () => {
  // Without this, both mutations above could pass because stripPyComments deletes EVERYTHING.
  const fixture = "import sys\n# a real gate\nsys.exit(1)\n";
  assert.ok(stripPyComments(fixture).includes("sys.exit("));
});

test("MUTATION: a pytest test_*.py / *_test.py file is excluded even with a real call", () => {
  assert.ok(isPyTestFile("test_something.py"));
  assert.ok(isPyTestFile("something_test.py"));
  assert.ok(!isPyTestFile("audit_grants.py"), "a real gate script must not be swept up by the test-file exclusion");
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
