/**
 * THE ACCEPTANCE CHECK MOVES FROM PR TIME TO FILING TIME — #879.
 *
 * `pr-open` refuses an Acceptance that names the whole suite, and it caught the only instance: *"needs
 * `corpus`, which this job does not have — abstention-regression.test.ts requires corpus via
 * compareAtFloor"*. The acceptance job has no token and no corpus and runs commands taken from a body, so
 * "the whole suite" is not something it can run.
 *
 * **A row's acceptance is written before anybody knows which job will run it**, which is exactly why it
 * has to name the files the change is verified by rather than the command a developer would type. Asking
 * at filing is the same question, at the moment the filer still has the context; by PR time it costs a
 * rewrite of a section written hours earlier by somebody who has moved on.
 *
 * ## ONE IMPLEMENTATION, WHICH IS THE POINT
 *
 * `template-fields-rule.mjs` imports `runsTheWholeSuite` and `extractAcceptanceSection` from
 * `acceptance-commands.mjs` unchanged. The row's acceptance is that **the same command string gets the
 * same answer at both times, from one implementation** — so this file drives both entry points over the
 * same strings and asserts they agree, and asserts the import is the shared one rather than a copy.
 *
 * ## WHAT DID NOT LIFT, AND WHY THAT IS A LIMIT RATHER THAN AN OVERSIGHT
 *
 * `jobCapabilities(body)` and `unmetCommandRequirements` read a PR BODY and the capabilities a JOB
 * declares. **At filing time there is no PR and no job**, so the requirement half stays where it works.
 * The command-shape half is a pure function of a string and lifts cleanly; a second, weaker copy of the
 * capability half would be the defect this row exists to avoid.
 *
 * ## AND THE CONSTRAINT THAT WAS EXPECTED TO DECIDE THE SHAPE DOES NOT APPLY
 *
 * The row was scoped around `template-fields-rule.mjs` being a pre-install entry with no `@a11ign/*`
 * import, with `region-paths.mjs` as the precedent for extracting rather than importing. **Measured:
 * `row-claim.mjs` and `row-file.mjs` are invoked by no workflow at all**, so neither is a pre-install
 * entry and the direct import is available. `pre-install-import-graph.test.ts` passes with it in place —
 * asserted below, so this stays true rather than being a fact about the day it was written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { wholeSuiteAcceptanceReason } from "../../../agent-org/src/row-claim/template-fields-rule.mjs";
import { fileRefusalReason } from "../../../agent-org/src/row-file.mjs";
import {
  acceptancePathTokens, acceptancePathsReason, runsTheWholeSuite, testFileArgumentsResolve,
  unresolvedAcceptancePaths,
} from "../../../agent-org/src/acceptance-commands.mjs";
import { trackedTopLevelDirs } from "../../../agent-org/src/region-paths.mjs";

// #1943: THE REGION DECLARES THE TEST FILE TOO, and that is not fixture housekeeping. This body used to
// declare `packages/x/y.ts` while its Acceptance ran `packages/x/y.test.ts` — a row that names a file it
// neither has nor reserves, which is exactly what the path check added below refuses. The fixture was
// internally inconsistent in the one way a real row must not be, so it is stated consistently instead.
const rowWith = (acceptance: string) =>
  "## Region\n\n`packages/x/y.ts`, `packages/x/y.test.ts`\n\n"
  + `## Acceptance\n\n\`\`\`\n${acceptance}\n\`\`\`\n\n`
  + "## Open-check\n\n`grep -n foo y.ts`\n";

test("a row whose Acceptance says `npm test` is refused at FILING", () => {
  const reason = fileRefusalReason(rowWith("npm test"));
  assert.ok(reason, "the row that produced #879 must be refused before it reaches GitHub");
  assert.match(reason, /npm test/, "the refusal must quote the command, not describe it");
  assert.match(reason, /has no corpus/, "and say why that job cannot run it");
  assert.match(reason, /name the test files this change is verified by/i,
    "a refusal a filer can follow exactly must pass — so it has to say what to write instead");
});

test("a row naming its test files is filed", () => {
  assert.equal(fileRefusalReason(rowWith("npx tsx --test packages/x/y.test.ts")), null,
    "the check must not refuse the shape it is asking for");
});

test("PRESENCE and CONTENT are different refusals", () => {
  // A row with no Acceptance at all is refused for that, by name. Collapsing the two would tell a filer
  // to add a section they already have — the same argument `missingTemplateFields` makes for naming each
  // field rather than counting them.
  const noAcceptance = "## Region\n\n`packages/x/y.ts`\n\n## Open-check\n\n`grep -n foo y.ts`\n";
  const reason = fileRefusalReason(noAcceptance);
  assert.ok(reason);
  assert.match(reason, /missing Acceptance/,
    "a missing section is refused as missing, never as naming the wrong command");
});

test("ONE IMPLEMENTATION: filing time and PR time agree on every command string", () => {
  // The row's own acceptance. Not "both refuse `npm test`" — that a single function decides it, so the
  // two times cannot drift apart by one being updated.
  const strings = [
    "npm test", "npm run test", "npm run test:ts", "npm  test",
    "npm run test:python", "npx tsx --test packages/x/y.test.ts",
    "npm run lint && npm test", "node --test packages/x/y.test.ts",
  ];
  // THE SET MUST CONTAIN BOTH ANSWERS, or "they agree" is satisfied by a list where nothing is the whole
  // suite and the check has been shown nothing. The same guard PM put on #879's own zero.
  assert.ok(strings.some((c) => runsTheWholeSuite(c)) && strings.some((c) => !runsTheWholeSuite(c)),
    "this list must exercise both verdicts, or the agreement it asserts is vacuous");
  for (const command of strings) {
    const filing = wholeSuiteAcceptanceReason(rowWith(command), "row-file") !== null;
    assert.equal(filing, runsTheWholeSuite(command),
      `filing time and \`runsTheWholeSuite\` disagree about ${JSON.stringify(command)} — which means `
      + "there are two answers to one question, and the copy that drifts is the one that decides "
      + "whether a row can be filed");
  }
});

test("`test:python` is NOT the whole suite, and the shared function is why that is free", () => {
  // Its population is the pytest tree rather than the `.test.ts` glob, and `runsTheWholeSuite`'s regex
  // already knows that (`(?![:\w-])` rather than `\b`). Importing it means filing time inherits the
  // reasoning instead of re-deriving it — badly, since a hand-written copy would very likely use `\b`.
  assert.equal(wholeSuiteAcceptanceReason(rowWith("npm run test:python"), "row-file"), null);
});

test("the refusal names the tool that refused, so two callers do not read as one", () => {
  const reason = wholeSuiteAcceptanceReason(rowWith("npm test"), "row-claim");
  assert.match(reason!, /^row-claim: /,
    "a filer reading `row-file:` when row-claim refused would look in the wrong place");
});

test("the import is the SHARED function, not a second copy", () => {
  const rule = readFileSync(
    resolve(import.meta.dirname, "../../../agent-org/src/row-claim/template-fields-rule.mjs"), "utf8");
  assert.match(rule, /import \{[^}]*runsTheWholeSuite[^}]*\} from "\.\.\/acceptance-commands\.mjs"/,
    "template-fields-rule must IMPORT the whole-suite test; a local regex here would be the second "
    + "implementation this row exists to avoid");
  assert.doesNotMatch(rule, /npm\\s\+\(\?:run/,
    "no hand-written copy of the command pattern");
});

test("neither row tool is a pre-install entry, which is why the direct import is available", () => {
  // The row was scoped around `template-fields-rule.mjs` being a pre-install entry, where an
  // `@a11ign/*` import is refused and `region-paths.mjs` was extracted rather than imported. A
  // pre-install entry is a script a workflow invokes BEFORE `npm ci`; these are invoked by no workflow at
  // all. Asserted rather than remembered, so the day someone adds one, this says why it matters.
  const workflows = readdirSync(resolve(import.meta.dirname, "../../../../.github/workflows"))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(workflows.length > 5, "the workflow directory did not read — this check examined nothing");
  const invoking = workflows.filter((f) => {
    const text = readFileSync(
      resolve(import.meta.dirname, "../../../../.github/workflows", f), "utf8");
    // A MENTION IS NOT A USE: `coverage.yml` names `row-claim.test.ts` in a comment about GH_TOKEN.
    return text.split("\n").some((line) =>
      !line.trim().startsWith("#") && /scripts\/(row-file|row-claim)\.mjs/.test(line));
  });
  assert.deepEqual(invoking, [],
    "a workflow now invokes a row tool. If it runs before `npm ci`, the import added by #879 has to "
    + "become an extraction — see `region-paths.mjs` for the shape.");
});

/**
 * ## AND THE SECOND HALF THAT LIFTS: THE PATHS THE COMMAND NAMES — #1943.
 *
 * The header above says the requirement half stayed at PR time because *"at filing time there is no PR
 * and no job"*. **That reasoning is right about job capabilities and wrong about paths.** Whether
 * `packages/lab/rstest.config.ts` exists is not a fact about a PR or a job; it is a fact about the
 * checkout the filer is standing in, available at filing time for the cost of a `stat`.
 *
 * It was measured twice in one day, 2026-09-22, and both rows passed `row-file` cleanly:
 *
 *   #1939  `npx rstest run --config packages/lab/rstest.config.ts packages/lab/src/packaging/lab-job-params.test.ts`
 *          NEITHER path exists. The row was the front of the capture chain.
 *   #1936  `npx vitest run …`, and `vitest` is in no `package.json` — it only appeared to pass because
 *          `npx` downloaded it from the network. (That one is the EXECUTABLE half, not this path half.)
 *
 * The rule is not "the path must exist": a row legitimately names files it will CREATE, which is most
 * rows. It is **exist on disk, OR be declared in the row's own `## Region`** — the separation this
 * repository already runs on, since B4 reserves what a Region declares.
 */

const rowWithRegion = (region: string, acceptance: string) =>
  `## Region\n\n\`\`\`\n${region}\n\`\`\`\n\n## Acceptance\n\n\`\`\`\n${acceptance}\n\`\`\`\n\n`
  + "## Open-check\n\n`grep -n foo y.ts`\n";

/** #1939's Acceptance as filed, verbatim. Both paths are absent from this tree. */
const AS_FILED_1939 =
  "npx rstest run --config packages/lab/rstest.config.ts packages/lab/src/packaging/lab-job-params.test.ts";
/** And as `product-manager` corrected it by hand while promoting. Both paths are real. */
const CORRECTED_1939 = "npx rstest run --config scripts/rstest/rstest.config.mjs --include "
  + "packages/worker-fleet/src/lab-job-params-reach-the-command.test.ts";

test("THE POSITIVE CONTROL: #1939's Acceptance as filed is REFUSED, and its correction is FILED", () => {
  // THE CONTROL EXISTS BECAUSE THE CALIBRATION BELOW ASSERTS AN EMPTINESS. `assert.deepEqual(offenders,
  // [])` passes when the population is empty, so there has to be an assertion somewhere that it is not,
  // and the writer has to be able to point at it. This is it, and it is the real string off the real row.
  assert.ok(existsSync("package.json") && existsSync("scripts/rstest/rstest.config.mjs"),
    "this test reads the real tree with repo-relative paths, so it must run from the repository root — "
    + "if it does not, every path reads as absent and the refusal below is vacuous");

  const reason = fileRefusalReason(rowWithRegion("packages/agent-org/src/evidence-check.mjs", AS_FILED_1939));
  assert.ok(reason, "#1939 reached an engineer with two paths that do not exist; it must not file again");
  assert.match(reason, /packages\/lab\/rstest\.config\.ts/, "the refusal must quote the path, not describe it");
  assert.match(reason, /packages\/lab\/src\/packaging\/lab-job-params\.test\.ts/,
    "and BOTH of them — reporting the first alone sends the filer back for a second refusal");

  assert.equal(fileRefusalReason(rowWithRegion("packages/agent-org/src/evidence-check.mjs", CORRECTED_1939)), null,
    "the corrected form names two files that are both on disk, and the check must not refuse the shape "
    + "it is asking for");
});

test("the refusal names BOTH ways to satisfy it, so a filer can follow it exactly", () => {
  // #741: a refusal that states no way forward is not one a filer can act on. This rule has exactly two
  // arms, so it owes exactly two remedies.
  const reason = acceptancePathsReason(rowWithRegion("packages/x/y.ts", AS_FILED_1939), "row-file");
  assert.match(reason!, /^row-file: /, "a filer reading the wrong tool's name looks in the wrong place");
  assert.match(reason!, /spelling/i, "arm one: the file exists under another name");
  assert.match(reason!, /Region/, "arm two: the row is going to create it, so it declares it");
});

test("ONE IMPLEMENTATION: filing time and the shared predicate agree on every row body", () => {
  // The row's own acceptance, and the same property the whole-suite half asserts above: not "both refuse
  // #1939" but that a SINGLE function decides it, so the two cannot drift by one being updated.
  const bodies = [
    rowWithRegion("packages/x/y.ts", AS_FILED_1939),
    rowWithRegion("packages/x/y.ts", CORRECTED_1939),
    rowWithRegion("packages/lab/rstest.config.ts", AS_FILED_1939),
    rowWithRegion("packages/x/y.ts", "npx tsx --test packages/lab/src/packaging/does-not-exist.test.ts"),
    rowWithRegion("packages/x/y.ts", "npm run lint"),
    rowWithRegion("packages/x/y.ts", "npx rstest run --config scripts/rstest/rstest.config.mjs"),
  ];
  // THE SET MUST CONTAIN BOTH ANSWERS, or the agreement is satisfied by a list nothing refuses.
  assert.ok(bodies.some((b) => unresolvedAcceptancePaths(b).length > 0)
    && bodies.some((b) => unresolvedAcceptancePaths(b).length === 0),
    "this list must exercise both verdicts, or the agreement it asserts is vacuous");
  for (const body of bodies) {
    assert.equal(fileRefusalReason(body) !== null, unresolvedAcceptancePaths(body).length > 0,
      `filing time and \`unresolvedAcceptancePaths\` disagree about ${JSON.stringify(body)} — which means `
      + "there are two answers to one question, and the copy that drifts is the one that decides whether "
      + "a row can be filed");
  }
});

test("THE REGION ESCAPE: an absent path the row DECLARES is filed, because that is what a Region is for", () => {
  // MUTATION TARGET. Drop the Region arm from `unresolvedAcceptancePaths` and this test is the one that
  // fails — the rule becomes "the path must exist", which refuses most rows in this repository, since a
  // row's test file is written by the row.
  const willBeCreated = "packages/agent-org/src/row-claim/not-yet-written.test.ts";
  assert.ok(!existsSync(willBeCreated), "this fixture is only a control while the file is genuinely absent");
  assert.equal(fileRefusalReason(rowWithRegion(willBeCreated, `npx tsx --test ${willBeCreated}`)), null,
    "a row that declares the file it is about to create has said exactly what the refusal would ask for");
  // And the same string with a DIFFERENT Region is refused, so the pass above is the Region's doing and
  // not something about the path.
  assert.ok(fileRefusalReason(rowWithRegion("packages/x/y.ts", `npx tsx --test ${willBeCreated}`)),
    "undeclared, the identical path must refuse — otherwise the test above proves nothing about the Region");
});

test("A DIRECTORY entry in the Region covers the file beneath it, the one way `regionCovers` already reads it", () => {
  const under = "packages/agent-org/src/row-claim/not-yet-written.test.ts";
  assert.equal(fileRefusalReason(rowWithRegion("packages/agent-org/src/row-claim/", `npx tsx --test ${under}`)), null,
    "B4 reserves everything under a `/`-terminated entry, so the Acceptance check must read it the same "
    + "way or the two disagree about what one Region declared");
});

test("THE GLOB EXEMPTION: a pattern is matched by a runner, not opened — so it is not path-checked", () => {
  // MUTATION TARGET. The token grammar admits `*`, `?`, `[`, `]`, `{` and `}` precisely so that dropping
  // this exemption CHANGES THE ANSWER and this test fails. Had the grammar excluded them, globs would be
  // exempt by accident and the exemption could be deleted with nothing to show for it.
  const glob = "packages/lab/src/packaging/nothing-here-matches-*.test.ts";
  assert.deepEqual(acceptancePathTokens(`npx tsx --test ${glob}`), [],
    "a glob has no single file to stat, and neither remedy the refusal offers applies to one");
  assert.equal(fileRefusalReason(rowWithRegion("packages/x/y.ts", `npx tsx --test ${glob}`)), null);
  // Whether that glob matches anything is `testFileArgumentsResolve`'s question, at PR time, unchanged.
  assert.equal(testFileArgumentsResolve(`npx tsx --test ${glob}`).ok, false,
    "the glob is still caught — by the check that owns globs, which is the reason this one may skip them");
});

test("an UNTRACKED top-level directory is not path-checked: #1929's `runs/` report is produced, not committed", () => {
  // `runs/` is gitignored, so a path under it can never exist in a fresh checkout AND can never be
  // declared in a `## Region`, which declares tracked files a PR will touch. Both remedies unavailable is
  // the unfollowable refusal #741 ruled against. Measured on #1929, whose Acceptance dispatches the lab
  // job that WRITES the file two lines before reading it.
  const produced = "jq -e '.resolution.records >= 381' runs/model-candidate/acceptance-report.json";
  assert.deepEqual(acceptancePathTokens(produced), [],
    "a path under a directory git does not track is an artefact, not a file the filer typed wrong");
  assert.ok(trackedTopLevelDirs().includes("packages") && !trackedTopLevelDirs().includes("runs"),
    "this exemption is derived from the tree (#1158's rule), so the assertion above has to check that "
    + "the derivation actually separates the two — a `trackedTopLevelDirs` returning everything, or "
    + "nothing, would make the test pass having examined nothing");
});

test("a REF and an EXTENSIONLESS path are not files: `origin/main`, `a11ign/a11ign`, `.venv/bin/python`", () => {
  assert.deepEqual(acceptancePathTokens("git diff origin/main -- packages/lab"), []);
  assert.deepEqual(acceptancePathTokens("gh issue list --repo a11ign/a11ign"), []);
  assert.deepEqual(acceptancePathTokens("A11Y_PYTHON=.venv/bin/python npm run test:python"), []);
  // But an `=`-assigned value that IS a repo file is still seen, which is why the assignment is split
  // rather than the whole token discarded.
  assert.deepEqual(acceptancePathTokens("npx rstest run --config=scripts/rstest/rstest.config.mjs"),
    ["scripts/rstest/rstest.config.mjs"]);
});

test("CALIBRATION: the rule refuses ONE of the Acceptance sections on `main`'s own open-row fixtures", () => {
  // Measured 2026-09-22 over the 28 open rows then carrying an Acceptance section: one refusal, #20,
  // which names `board-summary-origin.test.ts` against the real `board-summary-check.test.ts`. The
  // fixtures below are the real strings; the emptiness this asserts is controlled by the #1939 test above.
  const clean = [
    "npx rstest run --config scripts/rstest/rstest.config.mjs --include packages/lab/src/packaging/acceptance-check-at-filing.test.ts",
    "npm run lab:job -- -e job=acceptance",
    "npx tsx --test packages/lab/src/packaging/acceptance-commands.test.ts",
    "node packages/guards/src/tree-wide-guards.mjs",
  ];
  assert.ok(clean.length > 0, "the population this filters must not be empty, or the emptiness below is "
    + "satisfied by having examined nothing");
  const offenders = clean.flatMap((command) =>
    unresolvedAcceptancePaths(rowWithRegion("packages/x/y.ts", command)).map((hit) => hit.path));
  assert.deepEqual(offenders, [],
    "a real Acceptance command naming only real files must file — two offenders in twenty-eight is a "
    + "guard, and four false ones would be a wall");
  assert.deepEqual(
    unresolvedAcceptancePaths(rowWithRegion("packages/x/y.ts",
      "npx tsx --test packages/lab/src/packaging/board-summary-origin.test.ts")).map((hit) => hit.path),
    ["packages/lab/src/packaging/board-summary-origin.test.ts"],
    "#20's own string, which is what the calibration found");
});

test("the path check is the SHARED function in `row-file`, not a second copy", () => {
  const tool = readFileSync(resolve(import.meta.dirname, "../../../agent-org/src/row-file.mjs"), "utf8");
  assert.match(tool, /import \{[^}]*acceptancePathsReason[^}]*\} from "\.\/acceptance-commands\.mjs"/s,
    "row-file must IMPORT the path check; a local `existsSync` loop here would be the second "
    + "implementation this row exists to avoid");
  assert.doesNotMatch(tool, /existsSync/,
    "no hand-written filesystem check over acceptance tokens in the filing tool");
});
