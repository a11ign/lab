// @ts-check
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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { releasability } from "../src/packaging/releasability.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * the most dangerous silent default here: a mistyped `--dry-run` PROMOTES.
 *
 * An unrecognised flag is otherwise IGNORED — every CLI here parses argv by looking for the flags it
 * knows — so it runs the default and reports success. See `cli-flags.mjs`.
 */
refuseUnknownFlags(["--from=", "--dry-run", "--accept-regression"],
  { entry: import.meta.url, command: "npm run promote:model" });

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SHIPPED = resolve(REPO, "packages/scorer/models/screenreader-scorer");
const CHANGESETS = resolve(REPO, ".changeset");

/** Read a JSON file, or explain which missing file blocks the promotion. */
/** @param {string} path @param {string} what */
function readReport(path, what) {
  if (!existsSync(path)) {
    throw new Error(`${what} is missing at ${path}. A candidate that has not been evaluated cannot be `
      + "promoted — run the acceptance gate against it first.");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The gates, from ONE definition rather than three.
 *
 * This file used to carry its own: `releaseEligible` off the candidate, `passed` off the acceptance
 * report, and a hand-rolled regression comparison. `releasability()` is now the single place that decides,
 * so the trainer, the evaluator and this command cannot disagree about what "shippable" means — which they
 * did, and the disagreement was a deadlock nothing could pass.
 *
 * Read from the candidate's OWN files. Deliberately not flags the caller can set: the failure that
 * prevents is promoting a model because you believe it is good, which is exactly the state of mind in
 * which the belief is wrong.
 */
/**
 * @param {string} candidate
 * @param {Record<string, any> | null} shipped
 * @param {Record<string, any> | null} shippedAcceptance
 * @param {boolean} acceptRegression
 */
function assertPromotable(candidate, shipped, shippedAcceptance, acceptRegression) {
  const training = readReport(join(candidate, "training-report.json"), "the training report");
  const acceptance = existsSync(join(candidate, "acceptance-report.json"))
    ? JSON.parse(readFileSync(join(candidate, "acceptance-report.json"), "utf8"))
    : null;
  // Hashed HERE, from the file about to be copied, rather than taken from any report. A provenance check
  // fed a number from the same document it is checking proves only that the document agrees with itself.
  //
  // Absent weights are REPORTED alongside every other blocker, never thrown as an ENOENT: the first
  // version hashed unconditionally and replaced "acceptance has not been run" with a filesystem error,
  // which is a verdict a reader cannot act on.
  const weightsFile = join(candidate, "model.safetensors");
  const candidateModelSha256 = existsSync(weightsFile)
    ? createHash("sha256").update(readFileSync(weightsFile)).digest("hex")
    : null;
  const verdict = releasability({
    training, acceptance, shipped, shippedAcceptance, candidateModelSha256,
  });
  if (!candidateModelSha256) verdict.blockers.unshift(`there are no weights at ${weightsFile} to promote`);
  const blockers = acceptRegression
    ? verdict.blockers.filter((b) => !/ (precision|recall) [\d.]+ -> /.test(b))
    : verdict.blockers;
  if (blockers.length > 0) {
    throw new Error(`${candidate} is not releasable:\n  ${blockers.join("\n  ")}\n`
      + (verdict.notes.length ? `\nNotes:\n  ${verdict.notes.join("\n  ")}\n` : "")
      + "\nA deliberate regression against the shipped model can be accepted with --accept-regression, "
      + "which records it in the changeset rather than hiding it. Nothing else here is overridable.");
  }
  return { training, acceptance: acceptance ?? { passed: false } };
}

/** The provenance ADR 0007 requires, taken from the report rather than retyped. */
/**
 * Render one provenance value.
 *
 * An OBJECT is rendered by whatever identifies it, never by `${value}` — which produces the literal
 * string `[object Object]`, and did, in every changeset this has ever written. The encoder is the case:
 * `representation.encoder` is null so it falls through to the top-level one, which is
 * `{path, hiddenSize, modelSha256}`. This function's own docstring calls the encoder HASH the point of
 * recording it, and the hash was the part being destroyed.
 */
/** @param {unknown} value @returns {string} */
function describeValue(value) {
  if (value === null || typeof value !== "object") return String(value);
  // `typeof x === "object"` narrows to `object`, which has no index signature -- so reading a candidate
  // identity off it needs the cast. This function exists BECAUSE an object stringified as
  // `[object Object]` in every changeset ever written; the fields it probes are the whole point.
  const fields = /** @type {Record<string, unknown>} */ (value);
  const identity = fields.modelSha256 ?? fields.sha256 ?? fields.hash ?? fields.version ?? fields.path;
  return identity === undefined ? JSON.stringify(value) : String(identity);
}

/** @param {Record<string, any>} training @returns {string} */
function provenanceLines(training) {
  const ood = training.outOfDistribution ?? {};
  const rows = [
    ["records", training.dataset?.records ?? training.records],
    ["in-distribution floor", ood.inDistributionFloor],
    ["derived floor", ood.derivedFloor],
    ["floor source", ood.floorSource],
    ["encoder", training.representation?.encoder ?? training.encoder],
    // `representation.schema`, which is what the report actually carries and what `scorer:migration`
    // gates on. It read `representation.featureSchemaVersion` — a field name that appears NOWHERE else in
    // this repo and that nothing writes — so the row was filtered out as absent and this provenance has
    // never once appeared in a changeset. A row that silently vanishes is worse than a missing one: the
    // template promises it, so its absence reads as "this model has no feature schema".
    ["feature schema", training.representation?.schema ?? training.representation?.featureSchemaVersion],
  ].filter(([, value]) => value !== undefined && value !== null);
  return rows.map(([name, value]) => `- ${name}: \`${describeValue(value)}\``).join("\n");
}

export { describeValue, provenanceLines };

/** @param {Record<string, any>} training @returns {string} */
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
 * A changeset filename derived from WHAT IS BEING PROMOTED, without a timestamp.
 *
 * `Date.now()` is unavailable in some of this repo's runners and a random name would differ between a dry
 * run and the real one, so the name must be a pure function of the release. It is now a hash of the
 * changeset body — which is itself derived entirely from the training report — giving three properties
 * the previous scheme did not have: promoting the same weights twice rewrites ONE file with identical
 * content, promoting different weights can never land on the same name, and a dry run names the file the
 * real run will write.
 *
 * THE PREVIOUS SCHEME COLLIDED, and its docstring claimed it could not. It counted every `.md` in
 * `.changeset/` and appended `count + 1`, on the assumption that the count only grows. It does not:
 * `changeset version` CONSUMES changesets on release, and unrelated ones (`quiet-melons-smile.md`) move
 * the number without having anything to do with a promotion. Measured 2026-08-27 on this repo — five
 * changesets on disk, so the next promotion computed `promote-candidate-6.md`, **a tracked file already
 * holding a previous promotion's release note.** That is what the lab's `M .changeset/promote-candidate-6.md`
 * was: not an edit, a promotion overwriting an earlier one's provenance.
 *
 * It presents as a MODIFICATION rather than an untracked file, which is why nothing caught it — the
 * changeset is the only record of why weights moved (`lab-fetch.yml` says so where it fetches this file),
 * and losing one is losing a release's reason while the tree still looks tidy.
 */
/** @param {string} candidateName @param {string} entry @returns {string} */
function changesetPath(candidateName, entry) {
  const identity = createHash("sha256").update(entry).digest("hex").slice(0, 8);
  return join(CHANGESETS, `promote-${candidateName}-${identity}.md`);
}

/**
 * @param {object} input
 * @param {string} input.candidate       directory holding the candidate's weights and reports
 * @param {string} input.candidateName   the name it is known by, used in the changeset
 * @param {boolean} [input.dryRun]       print what would happen and write nothing
 * @param {boolean} [input.acceptRegression]  allow a deliberate loss against the shipped model
 * @param {object|null} [input.shippedReport] the shipped model's training report, or null on a first release
 * @param {object|null} [input.shippedAcceptance] its acceptance report — the only fixed-set baseline
 */
export function promote({ candidate, candidateName, dryRun = false, acceptRegression = false,
  shippedReport = null, shippedAcceptance = null }) {
  const { training, acceptance } = assertPromotable(candidate, shippedReport, shippedAcceptance,
    acceptRegression);
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
  const target = changesetPath(candidateName, entry);
  if (dryRun) {
    process.stdout.write(`DRY RUN — would copy ${candidate} -> ${SHIPPED}\n`
      + `DRY RUN — would write ${target}:\n\n${entry}\n`);
    return { target, entry };
  }
  mkdirSync(SHIPPED, { recursive: true });
  // The acceptance report ships WITH the weights, and that is not tidiness. It is the only fixed-set
  // measurement a future candidate can be compared against — the shipped model had none, which is why the
  // first regression check fell back to development figures and reported thirteen false regressions.
  for (const file of ["model.safetensors", "training-report.json", "acceptance-report.json"]) {
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
      // Kept beside the weights by this same command, so every promotion leaves a baseline for the next.
      shippedAcceptance: existsSync(join(SHIPPED, "acceptance-report.json"))
        ? JSON.parse(readFileSync(join(SHIPPED, "acceptance-report.json"), "utf8"))
        : null,
    });
  } catch (cause) {
    process.stderr.write(`REFUSING to promote: ${/** @type {Error} */ (cause).message}\n`);
    process.exit(1);
  }
}
