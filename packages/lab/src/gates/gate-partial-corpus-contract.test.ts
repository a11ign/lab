/**
 * `exit-code-contract.test.ts` answers "is every exit code's MEANING documented" — a completeness
 * question, already fully answered there. This asks a narrower, different question it does NOT cover:
 * of the gates that dispatch over a POPULATION (a corpus, a page set, a canary list), does examining only
 * PART of that population actually surface as INCONCLUSIVE, or can a partial run silently read as a
 * pass/fail? That is the shape of this project's single most expensive gate defect —
 * `evidence-check` once reported `2 compared: 2 same ... safe to ship` and exited 0 on 2 of 48 captures,
 * because its own `examinedNothing` guard covered only `compared === 0` and called that "the extreme case
 * rather than a different one" (verdict.mjs's own header).
 *
 * SCOPE, stated rather than implied: the population is every job `lab-job.yml` dispatches, plus the npm
 * `*:gate`/`gate:*` scripts — the same "gates" the orchestrating brief for this unit named. It is
 * DELIBERATELY narrower than `exit-code-contract.test.ts`'s (every script with an exit-code contract
 * across three packages): a lab job that generates a dataset or trains a model is not itself a verdict
 * gate, and forcing every one into a binary classification would be noise around the real question.
 *
 * PYTHON GATES ARE OUT OF SCOPE HERE, and the reason is now NARROWER than it was — this paragraph was
 * stale and it is worth saying how, because a stale MECHANISM is more expensive than a stale status.
 *
 * It used to read: *"`exit-code-contract.test.ts`'s own discovery filters to `.mjs`/`.ts`"*, and then
 * named eight Python scripts *"none has ever been examined by any test for this question"*. Both
 * sentences were true when written and neither is true now. That file gained a full Python
 * discover-and-classify side (`hasExitContractPy`/`DOCUMENTED_PY`/`INFRASTRUCTURE_PY`, twelve scripts,
 * four mutation tests and a floor) on 2026-09-06, hours after this comment; it has TWO `endsWith` filters
 * now, one per language.
 *
 * **The cost of leaving it was measured, not hypothetical.** Board issue #12's own open-check grepped
 * `endsWith` in that file, matched the `.mjs`/`.ts` line, read this paragraph agreeing with it, and
 * concluded *"the filter is still `.mjs`/`.ts` and the sibling test names the gap in a comment"* — a row
 * dispatched against work that already shipped. Two copies of one fact agreeing with each other and
 * neither agreeing with the code is `not-working.md` §26 exactly: a stale row reads as DONE, a stale
 * mechanism reads as UNDERSTOOD, and understood is a closed question that stops investigation.
 *
 * What remains true, and is the whole of the exclusion: MEANING and PARTIAL-COVERAGE are different
 * questions. `exit-code-contract.test.ts` now asks the first of Python and still cannot ask the second,
 * because `gateVerdict`/`fleetVerdict` are JS-only concepts a Python script cannot "adopt". The audit that
 * answered the second by hand (docs/backlog.md, "Python gates and the partial-corpus question") found
 * four scripts with an INCONCLUSIVE code they never reach on coverage grounds and two that can neither
 * detect nor express a short corpus, and DECIDED against a Python `verdict.py` — *"a second `gateVerdict`
 * across the language boundary is the fact-stated-twice hazard in its most expensive form."* That ruling
 * stands, so this scope stays JS-only by decision rather than by another file's filter.
 *
 * CLASSIFICATION SOURCE: `HAS_INCONCLUSIVE` for the six `gateVerdict`/`fleetVerdict` adopters is verified
 * structurally (they call the shared, correct-by-construction helper — `examined < of` is checked before
 * failure, per `verdict.mjs`'s own header). Every other entry's reasoning is grounded in
 * `exit-code-contract.test.ts`'s own `DOCUMENTED` text (itself "read out of each file by hand" per that
 * file's header) or in this session's own direct reads, named per entry — never inferred from a script's
 * name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

const PACKAGE_SCRIPTS = JSON.parse(read("package.json")).scripts as Record<string, string>;
const LAB_JOBS = (parseYaml(read("packages/control/ansible/lab-job.yml")) as Array<
  { vars?: { lab_jobs?: Record<string, { argv?: unknown }> } }
>)[0].vars?.lab_jobs ?? {};

/** Same regex `exit-code-contract.test.ts` and `lab-job.test.ts` use — copied deliberately, not imported. */
const DERIVED_VERDICT = /\b(gateVerdict|fleetVerdict)\(/;

function resolvedScriptFile(argv: unknown): string | undefined {
  const tokens = Array.isArray(argv) ? argv.map(String) : typeof argv === "string" ? argv.split(/\s+/) : [];
  const direct = tokens.find((t) => t.endsWith(".mjs") || t.endsWith(".ts"));
  if (direct) return direct;
  const runIndex = tokens.indexOf("run");
  if (!tokens[0]?.includes("npm") || runIndex < 0) return undefined;
  const scriptName = tokens[runIndex + 1] === "--silent" ? tokens[runIndex + 2] : tokens[runIndex + 1];
  const command = PACKAGE_SCRIPTS[scriptName ?? ""];
  return command ? resolvedScriptFile(command.split(/\s+/)) : undefined;
}

function adoptsVerdict(scriptFile: string | undefined): boolean {
  if (!scriptFile) return false;
  const path = `${REPO}${scriptFile}`;
  return existsSync(path) && DERIVED_VERDICT.test(readFileSync(path, "utf8"));
}

/**
 * Genuinely examines a population it could see only PART of, and that shortfall surfaces as its own
 * bespoke INCONCLUSIVE code — verified via `exit-code-contract.test.ts`'s own `DOCUMENTED` text or a
 * direct read this session, cited per entry. `gateVerdict`/`fleetVerdict` adopters are NOT listed here —
 * they are derived, immediately below, so the two cannot silently disagree about a seventh adopter.
 */
const HAS_INCONCLUSIVE_DOCUMENTED: Record<string, string> = {
  "packages/lab/scripts/fleet-hours.mjs":
    "DOCUMENTED exit 2: it billed no capture and REFUSES to report a total it did not measure, and its "
    + "two silences are told apart — 'no JSON found' versus 'walked N and billed none' need opposite "
    + "fixes. That refusal covers ZERO and not PARTIAL, which would be the gap this file exists to name "
    + "were it not for the mitigation: the report STATES ITS OWN DENOMINATOR on every run — "
    + "capturesBilled, capturesFound, jsonFilesWalked, and the counts it could not bill. A reader sees "
    + "5,395 of 5,396 and knows what the total covers, so a short corpus is visible in the output rather "
    + "than hidden behind a plausible number. Naming what you examined is the general remedy for this "
    + "whole shape; here it is built in rather than gated on.",
  "packages/lab/scripts/audit-rule-coverage.ts":
    "DOCUMENTED: \"2 the corpus is mid-run — a refusal to measure a moving target\" — a genuine "
    + "population-in-flux detection, distinct from a stale-export or usage-error code",
  "packages/lab/src/training/check-signals.mjs":
    "DOCUMENTED: \"2 ... OR signalVerdict()'s own INCONCLUSIVE below MIN_EXAMINED\" — its own bespoke, "
    + "threshold-based population check, not derived from verdict.mjs but real and named in its own code",
  "packages/lab/scripts/evidence-check.mjs":
    "DOCUMENTED: \"2 means THREE things ... ('0 safe to ship, 1 evidence changed, 2 could not answer')\" "
    + "— this is the FOUNDING incident this whole file generalises: it once exited 0 on 2 of 48 captures "
    + "compared, and `docs/gate-exit-codes.md`/`verdict.mjs`'s own header both name it explicitly. Reaches "
    + "the wire via `evidence-diff.mjs`'s `inconclusive = compared === 0 || compared < attempted`.",
};

/**
 * Cannot fall short of its own population in a way that would matter, or has no population-of-evidence
 * concept at all (a fixed single artifact, a data-currency check, a report-only tool, a generator, a
 * sequencer of already-classified stages). Each reason is the thing that makes "did it see everything"
 * either always-true-by-construction or not-the-right-question for that script.
 */
const NO_PARTIAL_POPULATION: Record<string, string> = {
  "packages/lab/src/harnesses/capture-check.mjs":
    "NO EXTERNAL POPULATION: `CHECKS` is a fixed literal list in `capture-check.mjs` and the run iterates "
    + "ALL of it (`for (const check of CHECKS)`), so there is nothing it could examine fewer of. A check "
    + "that throws is counted as a FAILURE by `runCheck` rather than skipped, and a run that cannot start "
    + "at all exits 2 — so the two states a partial-corpus gate exists to separate are already separate "
    + "here. Same reasoning as `isolation-gate.mjs` above: a gate that enumerates its own targets has no "
    + "denominator to fall short of.",
  "packages/lab/scripts/build-realism-tier.mjs":
    "DOCUMENTED: \"0 success, including the legitimate 'no training captures, base dataset only' state\" "
    + "— zero training captures is an accepted PASS by design, not flagged as a coverage shortfall; "
    + "\"2 every training capture truncated\" is a content defect, not a population count",
  "packages/lab/scripts/calibrate-abstention.mjs":
    "DOCUMENTED: \"2 no calibration captures found\" — detects only total absence, never partial coverage; "
    + "no declared expected population to fall short of quantitatively",
  "packages/lab/scripts/audit-corpus-starvation.mjs":
    "DOCUMENTED: \"2 a stale export\" — examines case DEFINITIONS for a data-currency problem, not a "
    + "corpus with an expected size the run could fall short of",
  "packages/lab/scripts/audit-observation-ambiguity.mjs":
    "confirmed by direct read: its own header states it REPORTS AND NEVER BLOCKS. DOCUMENTED's \"2 no "
    + "captures found\" is total-absence only, and it renders no pass/fail verdict a caller could misread",
  "packages/lab/scripts/lab-inventory.mjs":
    "DOCUMENTED: \"this script has NO exit-1 path at all, it never reports a hard FAIL\" — a status "
    + "reporter; its \"2\" is a schema/data-shape refusal about the artifact, not a coverage shortfall",
  "packages/lab/scripts/verify-safetensors.mjs":
    "DOCUMENTED: examines ONE shipped model directory (a fixed artifact), never a population that could "
    + "be partially covered",
  "packages/lab/src/eval/run.ts":
    "DOCUMENTED: \"by default this CANNOT fail on judge quality at all, only on a crash\" — evaluates a "
    + "fixed, small labelled-fixture set (34 fixtures, CLAUDE.md); no INCONCLUSIVE concept is exposed",
  "packages/lab/scripts/retrain-pipeline.mjs":
    "DOCUMENTED: sequences other stages via its own pipeline() helper, not verdict.mjs — any coverage "
    + "concept belongs to the stage script, already classified independently",
  "packages/lab/scripts/everything-pipeline.mjs":
    "DOCUMENTED: \"0 every stage succeeded; 1 any stage failed\" — a sequencer; same reasoning as "
    + "retrain-pipeline.mjs immediately above",
  "packages/lab/src/training/generate-screenreader-dataset.mjs":
    "generates pages; not a verdict over an existing population of evidence",
  "packages/lab/src/training/generate-screenreader-acceptance.mjs":
    "generates the held-out set; not a verdict over an existing population",
  "packages/lab/src/training/capture-screenreader-dataset.mjs":
    "DOCUMENTED: \"0 default/success; 1 any thrown error; 2 host power state refuses to start\" — a "
    + "capture dispatcher writing evidence, not judging an existing population of it",
  "packages/lab/src/training/export-screenreader-dataset.mjs":
    "exports captures already on disk into training records; not a pass/fail verdict",
  "packages/lab/src/training/capture-real-pages.mjs":
    "DOCUMENTED: \"0 all pages captured; 1 any page failed\" — a capture dispatcher, not a verdict gate "
    + "over evidence that already exists",
  "scripts/isolation-gate.mjs":
    "confirmed by direct read (2026-09-06): enumerates its OWN full target list (`allPackages()`) before "
    + "running, so there is no external population it can fall short of by construction; its only "
    + "non-zero-besides-1 code (2) is a CLI usage error, not a coverage concept. NOT discovered by "
    + "exit-code-contract.test.ts at all -- that file's walk is scoped to packages/lab, packages/"
    + "worker-fleet and packages/control, and this script lives at repo-root scripts/. A second, genuine "
    + "gap this file closes: a gate outside those three roots was invisible to any exit-code test.",
};

/** Every job `lab-job.yml` can dispatch, by name. */
function jobNames(): string[] {
  return Object.keys(LAB_JOBS);
}

/**
 * npm scripts matching `*:gate`/`gate:*` that are a SINGLE script invocation. `release:gate`,
 * `release:gate:ci` and `candidate:gate` are excluded deliberately: each is a chain of several already-
 * independently-classified gates joined by `&&`, and its own exit code is whichever member's, non-
 * literal — the same shape `lab-pipeline.mjs`'s DOCUMENTED entry already describes for `--follow`. Forcing
 * a chain into this file's binary would answer a question about the wrong unit.
 */
const NPM_GATE_SCRIPTS = ["eval:gate", "gate:stability", "gate:isolation", "rules:gate", "gate:probe-order"];

/** Jobs whose dispatch is itself a composite chain of `&&`-joined npm scripts, not a single gate. */
const COMPOSITE_JOBS: Record<string, string> = {
  promote: "runs `promote:gated` = `candidate:gate && promote:model` -- each already classified on its own",
  "release-gate": "runs `npm run release:gate`, a ~12-stage chain of already-classified gates",
};

/**
 * A job's real script, for the handful `resolvedScriptFile` cannot reach: `evidence-check`'s argv is a
 * Jinja list-building expression (`{{ [lab_tsx, '...'] + ... }}`), not a plain array or `npm run` call.
 */
const JOB_SCRIPT_OVERRIDE: Record<string, string> = {
  "evidence-check": "packages/lab/scripts/evidence-check.mjs",
  // Its argv resolves the worker address through `hostvars[]`, so the whole thing is one multi-line Jinja
  // expression rather than a list of literals and `resolvedScriptFile` cannot read a path out of it. The
  // override is the designed answer to exactly that, and naming it here keeps "cannot be resolved" and
  // "nobody classified it" different states -- which is this file's own thesis.
  "capture-check": "packages/lab/src/harnesses/capture-check.mjs",
};

/**
 * Deliberately out of scope, by NAME rather than silently absent from both buckets -- an unexplained gap
 * and a stated exemption must never look the same. Two reasons appear here:
 *
 *   - PYTHON: `gateVerdict`/`fleetVerdict` are JS-only, so these are the out-of-scope population the
 *     header names. `resolvedScriptFile` also cannot generally reach them (the npm scripts driving them
 *     chain through a JS prerequisite emitter first — `corpus:unclosable-map`, `corpus:grants-map` — so
 *     even a fixed resolver would land on the wrong file), which is a second, independent reason not to
 *     force a classification through a mechanism built for JS.
 *   - NOT A GATE: `promote-diff` is `git status`; `python-tests` runs the whole pytest suite, not a corpus
 *     audit; `export-acceptance` exports captures already on disk, the same class already classified
 *     under NO_PARTIAL_POPULATION for its sibling export tools, just reached through an unresolvable
 *     multi-stage `REPEAT=... npm run ...` chain.
 */
const EXEMPT: Record<string, string> = {
  train: "PYTHON, out of scope (see file header)",
  "false-positives": "PYTHON, out of scope",
  shortcuts: "PYTHON, out of scope",
  "shortcuts-baseline": "PYTHON, out of scope",
  "shortcuts-baseline-candidate": "PYTHON, out of scope",
  acceptance: "PYTHON, out of scope",
  "acceptance-shipped": "PYTHON, out of scope",
  "acceptance-shipped-copy": "PYTHON, out of scope",
  "grants-audit": "PYTHON, out of scope",
  "container-exits": "PYTHON, out of scope",
  "applicability-audit": "PYTHON, out of scope",
  "explain-feature": "PYTHON, out of scope",
  "promote-diff": "NOT A GATE -- `git status`, no verdict of any kind",
  "python-tests": "NOT A GATE -- runs the whole pytest suite, not a corpus audit",
  "export-acceptance": "NOT A GATE -- an export tool, same class as the exported NO_PARTIAL_POPULATION "
    + "generators, reached through an unresolvable REPEAT=... chain",
};

test("the job catalogue and the npm gate-script list are not near-empty", () => {
  assert.ok(jobNames().length > 20, "lab-job.yml's catalogue must not read as near-empty");
  assert.ok(NPM_GATE_SCRIPTS.length >= 5, "the npm *:gate/gate:* list must not read as near-empty");
});

test("every gateVerdict/fleetVerdict adopter among the jobs is found -- vacuity guard for the derivation", () => {
  const adopters = jobNames().filter((name) => adoptsVerdict(resolvedScriptFile(LAB_JOBS[name]?.argv)));
  assert.ok(adopters.length >= 6,
    `found only ${adopters.length} adopting job(s) (${adopters.join(", ")}) -- six are confirmed by direct `
    + "reading (rules-gate, rules-real-pages, rules-real-pages-update, stability, gate-stability, "
    + "gate-probe-order), so six is the floor to investigate before relaxing this number");
});

/** Adopts the shared contract, or is named in one of the two hand-classified buckets above. */
function isClassified(scriptFile: string | undefined): boolean {
  if (adoptsVerdict(scriptFile)) return true;
  return scriptFile !== undefined
    && (scriptFile in HAS_INCONCLUSIVE_DOCUMENTED || scriptFile in NO_PARTIAL_POPULATION);
}

test("every job and every npm gate script is classified: has a real INCONCLUSIVE path, or cannot fall "
  + "short of its population in a way that matters", () => {
  const unclassified: string[] = [];
  for (const name of jobNames()) {
    if (name in COMPOSITE_JOBS || name in EXEMPT) continue;
    const scriptFile = JOB_SCRIPT_OVERRIDE[name] ?? resolvedScriptFile(LAB_JOBS[name]?.argv);
    if (!isClassified(scriptFile)) unclassified.push(`job ${name} -> ${scriptFile ?? "(unresolved)"}`);
  }
  for (const npmScript of NPM_GATE_SCRIPTS) {
    const scriptFile = resolvedScriptFile(PACKAGE_SCRIPTS[npmScript]?.split(/\s+/));
    if (!isClassified(scriptFile)) unclassified.push(`npm ${npmScript} -> ${scriptFile ?? "(unresolved)"}`);
  }
  assert.deepEqual(unclassified, [],
    "these gates are classified nowhere -- read what their exit codes mean and add a line to "
    + `HAS_INCONCLUSIVE_DOCUMENTED or NO_PARTIAL_POPULATION above:\n${unclassified.map((u) => `  ${u}`).join("\n")}`);
});

test("every classified path still exists", () => {
  for (const path of [...Object.keys(HAS_INCONCLUSIVE_DOCUMENTED), ...Object.keys(NO_PARTIAL_POPULATION)]) {
    assert.ok(existsSync(`${REPO}${path}`), `${path} is classified but no longer exists`);
  }
});

test("every exempted or composite name is still a real job -- a rename must not go silently forgiven", () => {
  const names = new Set(jobNames());
  for (const name of [...Object.keys(EXEMPT), ...Object.keys(COMPOSITE_JOBS)]) {
    assert.ok(names.has(name), `'${name}' is exempted/composite but no longer a job in lab-job.yml -- `
      + "remove the stale entry rather than leave it exempting nothing");
  }
});

test("a script cannot be classified in two places at once", () => {
  const overlap = Object.keys(HAS_INCONCLUSIVE_DOCUMENTED).filter((p) => p in NO_PARTIAL_POPULATION);
  assert.deepEqual(overlap, [], "a script cannot both have a real INCONCLUSIVE path and lack one");
});

test("the Python-scope paragraph above still describes the sibling test it cites", () => {
  // PINNED, BECAUSE THIS PARAGRAPH HAS ALREADY GONE STALE ONCE AND COST A DISPATCHED ROW.
  //
  // It used to say `exit-code-contract.test.ts`'s discovery "filters to `.mjs`/`.ts`". That file gained a
  // Python side hours later; nothing compared the two; and issue #12's open-check then grepped the file,
  // found the older filter, read this comment agreeing with it, and concluded the gap was still open. Two
  // copies of one fact, neither compared, is this repo's most-repeated defect -- and CLAUDE.md's own
  // remedy when a copy cannot be deleted is to pin them equal with a test.
  //
  // Deliberately asserts the DIRECTION the comment now claims (a Python side EXISTS), not its absence: if
  // somebody removes that discovery, this fails and points at the paragraph to rewrite, rather than the
  // paragraph quietly becoming true again for a reason nobody chose.
  const sibling = read("packages/lab/src/gates/exit-code-contract.test.ts");
  assert.match(sibling, /function hasExitContractPy\(/,
    "this file's Python-scope paragraph says exit-code-contract.test.ts DOES ask the meaning question of "
    + "Python. If that discovery has been removed, rewrite the paragraph -- do not leave it describing a "
    + "file it no longer matches, which is exactly what cost issue #12 a wrongly-dispatched row");
  assert.match(sibling, /DOCUMENTED_PY|INFRASTRUCTURE_PY/,
    "the same paragraph names DOCUMENTED_PY/INFRASTRUCTURE_PY as where Python exit codes are classified");
});
