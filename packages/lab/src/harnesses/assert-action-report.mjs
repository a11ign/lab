/**
 * Assert things about a report the ACTION produced, from a file you can also run locally.
 *
 * This logic used to be two `node -e` blocks inside `action-smoke.yml`, hand-escaped inside a
 * double-quoted bash string, with the second block re-implementing the first's parsing. Two costs, and
 * the second is the one that mattered: an assertion living in YAML cannot be run or linted here, so every
 * iteration on it was an **eight-minute CI round trip**. A check that expensive to change is a check
 * nobody changes.
 *
 *   node packages/lab/src/harnesses/assert-action-report.mjs <r.json> --expect-activation --forbid-wcag=1.1.1
 *   node packages/lab/src/harnesses/assert-action-report.mjs <r.json> --require-wcag=1.1.1
 *
 * In `packages/lab` because that package is private: this is a harness, like `capture-check.mjs` beside
 * it, and it must not ship inside a published package. It also has to sit inside a package's own `src` to
 * be covered by `npm test`'s glob at all — a test outside that glob is a test that never runs.
 *
 * Exit 0 on success, 1 with a named reason on failure. The predicates are exported and unit-tested in
 * `assert-action-report.test.ts`, because a guard nobody has watched fail is not a guard.
 */
import { readFileSync } from "node:fs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * these ARE the assertion: a mistyped `--require-wcag=` asserts nothing and the harness reports success.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--expect-activation", "--require-wcag=", "--forbid-wcag="], { entry: import.meta.url, command: "npm run assert:action-report" });

/**
 * The contract fields, checked against what `packages/cli/src/action/run.ts` actually depends on rather
 * than a shape assumed here — guessing it wrong once produced a check that failed for the wrong reason.
 *
 * @param {unknown} report
 * @returns {string | null} the reason it is unusable, or null
 */
export function contractFailure(report) {
  const r = /** @type {Record<string, any>} */ (report);
  if (!r?.url) return "report has no url";
  if (!r.verdict || !Array.isArray(r.verdict.findings)) {
    return "report has no verdict.findings — the judge did not run";
  }
  // Explicitly `=== false`: absent means "not reported", which is not the same as "rejected", and
  // conflating the two is the mistake this project refuses to make anywhere else.
  if (r.captureVerified === false) {
    return "captureVerified is false: the screen reader ran but its evidence was rejected";
  }
  return null;
}

/** How many controls the capture operated. Zero on a default run means `probe-forms` silently regressed. */
export function activationCount(report) {
  const interaction = report?.capture?.interaction ?? report?.interaction;
  return (interaction?.formChanges ?? []).length + (interaction?.stateChanges ?? []).length;
}

/** Findings for one criterion, matched on the `wcag` prefix so "1.1.1 Non-text Content" matches "1.1.1". */
export function findingsFor(report, wcag) {
  return (report?.verdict?.findings ?? []).filter((f) => String(f?.wcag ?? "").startsWith(wcag));
}

function flagValue(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function main(argv) {
  const [path, ...flags] = argv;
  if (!path) {
    process.stderr.write("usage: assert-action-report.mjs <report.json> " +
      "[--expect-activation] [--forbid-wcag=X] [--require-wcag=X]\n");
    return 1;
  }
  const report = JSON.parse(readFileSync(path, "utf8"));

  const contract = contractFailure(report);
  if (contract) return fail(contract);

  if (flags.includes("--expect-activation") && activationCount(report) === 0) {
    return fail("a default run activated no control: probe-forms is no longer on by default, so every " +
      "3.3.1 and 4.1.3 finding is now unreachable while this job stays green");
  }

  const forbidden = flagValue(flags, "forbid-wcag");
  if (forbidden) {
    const wrong = findingsFor(report, forbidden);
    if (wrong.length) {
      return fail(`${forbidden} claimed against a page published as conformant: ` +
        JSON.stringify(wrong.map((f) => f.evidence)));
    }
  }

  const required = flagValue(flags, "require-wcag");
  if (required && findingsFor(report, required).length === 0) {
    return fail(`no ${required} finding on a page that really fails it — a guard is silencing real ` +
      "failures, which is worse than the false positive it was added to fix");
  }

  process.stdout.write(`  url: ${report.url}\n`);
  process.stdout.write(`  controls activated: ${activationCount(report)}\n`);
  process.stdout.write(`  findings: ${report.verdict.findings.length}\n`);
  return 0;
}

function fail(reason) {
  process.stderr.write(`::error::${reason}\n`);
  return 1;
}

// Guarded so the predicates above can be imported by the test without running the CLI.
if (process.argv[1] && process.argv[1].endsWith("assert-action-report.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
