/**
 * Promote a trained candidate to the shipped weights — and write the changeset that says so.
 *
 * **Promoting a model IS a release of `@a11y-witness/scorer`.** ADR 0007 is explicit that the weights are
 * that package's API and that any retrain is a MAJOR: a consumer's build goes from passing to failing with
 * no code change. So this is not a file copy that happens to precede a release; it is the release action,
 * and it belongs in the same machinery as every other package rather than beside it.
 *
 * Until 2026-08-22 there was NO promotion step at all — no script, no job, no npm entry. Getting a
 * candidate from the lab into `packages/scorer/models/` was an undocumented manual copy. That absence is
 * also why `train`'s overwrite guard was so blunt: with nothing declaring which model matters, it had to
 * treat every directory as precious, and the second train through the lab job always failed.
 *
 * Three things this does that a copy cannot:
 *
 * 1. **It reads the gates back rather than assuming them.** A candidate is promotable only if its own
 *    training report says `releaseEligible` AND its acceptance report says it passed. Both are read from
 *    the candidate's own files, not from whoever is running this.
 * 2. **It writes the changeset, at MAJOR, with the provenance filled in.** ADR 0007 requires "the
 *    training-report provenance (corpus, encoder hash, thresholds) in the changelog entry, because 'which
 *    model scored this' is the question a disputed finding turns on" — and left that to a human
 *    remembering to type it. Anything a human must remember does not happen; this repo's own rule.
 * 3. **It stops there.** Weights are copied and the changeset is written, both left UNCOMMITTED for
 *    review. Nothing is published: that is `release.yml`'s business and it is guarded separately.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SHIPPED = resolve(REPO, "packages/scorer/models/screenreader-scorer");
const CHANGESETS = resolve(REPO, ".changeset");

/** Read a JSON file, or explain which missing file blocks the promotion. */
function readReport(path, what) {
  if (!existsSync(path)) {
    throw new Error(`${what} is missing at ${path}. A candidate that has not been evaluated cannot be `
      + "promoted — run the acceptance gate against it first.");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Per-subtype precision and recall, from a training report. `{}` for a model that has no such head.
 *
 * Read from the report rather than recomputed: the numbers a release is judged on must be the ones the
 * trainer actually produced, not a second calculation that could differ.
 */
function headScores(report) {
  const out = {};
  for (const criterion of Object.values(report.criteria ?? {})) {
    for (const [subtype, sub] of Object.entries(criterion.subtypes ?? {})) {
      const dev = sub.development ?? {};
      if (dev.precision === undefined) continue;
      out[subtype] = { precision: dev.precision, recall: dev.recall, threshold: sub.threshold };
    }
  }
  return out;
}

/**
 * REFUSE A CANDIDATE THAT IS WORSE THAN WHAT IS ALREADY SHIPPED.
 *
 * The two gates below are ABSOLUTE bars — "this model is good enough" — and a candidate can clear both
 * while being worse than the incumbent on a criterion nobody looked at. "Good enough" is not "better", and
 * for weights that ship to consumers the second is the question.
 *
 * Measured on the first candidate this was applied to: the multi-defect retrain held recall exactly (58
 * true positives, 0 false negatives, same as shipped) and lost precision on ONE subtype,
 * `3.3.2:placeholder-only` — 1.000 to 0.368 on development, and 4 false positives on held-out acceptance
 * where the shipped model has none. Without this check the only thing standing between that and a release
 * was somebody reading two reports side by side.
 *
 * A head the shipped model does not have is NOT a regression — it is new coverage, and blocking on it
 * would make adding a criterion impossible.
 */
function assertNotWorse(candidateReport, shippedReport, tolerance) {
  const shipped = headScores(shippedReport);
  const candidate = headScores(candidateReport);
  const worse = [];
  for (const [subtype, now] of Object.entries(candidate)) {
    const before = shipped[subtype];
    if (!before) continue; // new head: coverage, not regression
    for (const metric of ["precision", "recall"]) {
      if (now[metric] < before[metric] - tolerance) {
        worse.push(`${subtype} ${metric} ${before[metric].toFixed(3)} -> ${now[metric].toFixed(3)}`);
      }
    }
  }
  if (worse.length > 0) {
    throw new Error(`the candidate is WORSE than the shipped model on ${worse.length} head(s):\n  `
      + `${worse.join("\n  ")}\n`
      + "A release must not lose ground on a criterion that already worked. If the regression is intended "
      + "— a deliberate trade — say so and pass --accept-regression, which records it in the changeset "
      + "rather than hiding it.");
  }
}

/**
 * Both gates, read from the CANDIDATE's own files.
 *
 * Deliberately not a flag the caller can set. The failure this prevents is somebody promoting a model
 * because they believe it is good, which is exactly the state of mind in which the belief is wrong.
 */
function assertPromotable(candidate) {
  const training = readReport(join(candidate, "training-report.json"), "the training report");
  if (!training.releaseEligible) {
    throw new Error(`${candidate} is not releaseEligible. `
      + `Blocked by: ${JSON.stringify(training.releaseBlockedBy ?? "(not recorded)")}`);
  }
  const acceptance = readReport(join(candidate, "acceptance-report.json"), "the acceptance report");
  if (acceptance.passed !== true) {
    throw new Error(`${candidate} did not pass held-out acceptance: `
      + `${JSON.stringify(acceptance.failureReasons ?? [])}`);
  }
  return { training, acceptance };
}

/** The provenance ADR 0007 requires, taken from the report rather than retyped. */
function provenanceLines(training) {
  const ood = training.outOfDistribution ?? {};
  const rows = [
    ["records", training.dataset?.records ?? training.records],
    ["in-distribution floor", ood.inDistributionFloor],
    ["derived floor", ood.derivedFloor],
    ["floor source", ood.floorSource],
    ["encoder", training.representation?.encoder ?? training.encoder],
    ["feature schema", training.representation?.featureSchemaVersion],
  ].filter(([, value]) => value !== undefined && value !== null);
  return rows.map(([name, value]) => `- ${name}: \`${value}\``).join("\n");
}

function thresholdLines(training) {
  const out = [];
  for (const [criterion, report] of Object.entries(training.criteria ?? {})) {
    for (const [subtype, sub] of Object.entries(report.subtypes ?? {})) {
      out.push(`- \`${subtype}\` threshold \`${sub.threshold}\``);
    }
    if (out.length > 24) { out.push(`- …and more, see \`${criterion}\` in the training report`); break; }
  }
  return out.join("\n");
}

/**
 * A changeset filename that cannot collide, without a timestamp.
 *
 * `Date.now()` is unavailable in some of this repo's runners and a random name would differ between a dry
 * run and the real one. The candidate name plus a count of existing files is stable and readable.
 */
function changesetPath(candidateName) {
  const existing = readdirSync(CHANGESETS).filter((f) => f.endsWith(".md") && f !== "README.md").length;
  return join(CHANGESETS, `promote-${candidateName}-${existing + 1}.md`);
}

export function promote({ candidate, candidateName, dryRun, acceptRegression, shippedReport, tolerance }) {
  const { training, acceptance } = assertPromotable(candidate);
  // Tiny movements are noise, not regressions: thresholds are calibrated on a finite development set and
  // a third decimal place is not a fact about the model. Anything larger is a real loss of ground.
  if (!acceptRegression && shippedReport) {
    assertNotWorse(training, shippedReport, tolerance ?? 0.005);
  }
  const entry = `---
"@a11y-witness/scorer": major
---

Retrained scorer weights (\`${candidateName}\`).

**Major, and not because the API changed — because the weights ARE the API.** A consumer's build can go
from passing to failing with no code change on their side, which is breaking however small the diff looks.

Provenance, so a disputed finding can be traced to the model that produced it:

${provenanceLines(training)}

Per-subtype thresholds:

${thresholdLines(training)}

Held-out acceptance: ${acceptance.passed ? "passed" : "FAILED"}.
${acceptRegression ? "\n**Accepted with a known regression against the previously shipped weights.** See the commit for why.\n" : ""}`;
  const target = changesetPath(candidateName);
  if (dryRun) {
    process.stdout.write(`DRY RUN — would copy ${candidate} -> ${SHIPPED}\n`
      + `DRY RUN — would write ${target}:\n\n${entry}\n`);
    return { target, entry };
  }
  mkdirSync(SHIPPED, { recursive: true });
  for (const file of ["model.safetensors", "training-report.json"]) {
    cpSync(join(candidate, file), join(SHIPPED, file));
  }
  writeFileSync(target, entry);
  process.stdout.write(`Promoted ${candidateName}.\n`
    + `  weights   -> ${SHIPPED}\n  changeset -> ${target}\n\n`
    + "Nothing is committed and nothing is published. Review both, then commit them together — the\n"
    + "changeset is what makes this a MAJOR release of @a11y-witness/scorer rather than a silent swap.\n");
  return { target, entry };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const from = (args.find((a) => a.startsWith("--from=")) ?? "").split("=")[1];
  if (!from) {
    process.stderr.write("usage: promote-model.mjs --from=<candidate-name> [--dry-run]\n"
      + "  reads runs/model-<name>/, or set A11Y_CANDIDATE_ROOT to point elsewhere\n");
    process.exit(2);
  }
  const root = process.env.A11Y_CANDIDATE_ROOT ?? resolve(REPO, "runs");
  try {
    const shippedPath = join(SHIPPED, "training-report.json");
    promote({
      candidate: join(root, `model-${from}`), candidateName: from,
      dryRun: args.includes("--dry-run"),
      acceptRegression: args.includes("--accept-regression"),
      // Compared against whatever is shipped RIGHT NOW, read at promotion time. A baseline recorded
      // earlier would describe a model that may already have been replaced.
      shippedReport: existsSync(shippedPath) ? JSON.parse(readFileSync(shippedPath, "utf8")) : null,
    });
  } catch (cause) {
    process.stderr.write(`REFUSING to promote: ${cause.message}\n`);
    process.exit(1);
  }
}
