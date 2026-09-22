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
import { parse } from "yaml";
import {
  acceptancePathTokens, acceptancePathsReason, labFetchArtifacts, labFetchPathHits, runsTheWholeSuite,
  testFileArgumentsResolve, unresolvedAcceptancePaths,
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

/**
 * ## AND THE THIRD HALF: A PATH THAT EXISTS SOMEWHERE ELSE — #1973.
 *
 * The section above ends on an exemption: a path under `runs/` is never path-checked, because it is
 * PRODUCED rather than committed and both remedies a refusal would offer are unavailable for it. That is
 * right, and it is exactly what leaves this check something to say. **#1929's own `runs/` path was not
 * absent by accident; it was the wrong path**, and nothing at either time could tell the filer so.
 *
 * `lab:fetch -e artifact=acceptance-report` READS `runs/model-candidate/acceptance-report.json` on the
 * lab and WRITES `runs/fetched/candidate.acceptance-report.json` here — the playbook's own task is called
 * *"Name it after what it actually is"*, and it renames so that two candidates cannot overwrite each
 * other. #1929 fetched the artifact and then read the lab's path. Measured in `wt-1929` after a
 * successful fetch: the `jq` exited **2**, file not found, having never evaluated its own predicate.
 *
 * **The direction of the error is the reason this is worth a guard rather than a habit.** `jq -e` exits 1
 * on a false predicate and 2 on a missing file, and a shell `&&` chain cannot tell them apart. A run
 * whose data genuinely failed its bound and a row that named the wrong path both surface as "the
 * Acceptance did not pass" — and only the second is an apparatus fault. #1929's Open-check had the same
 * path and printed `no fetched report`, which its own body defined as "no run yet": a third state read as
 * one of the first two.
 *
 * THE POPULATION IS ONE AND IT IS CLOSED, so the controls below are the real strings off that row rather
 * than a sweep. An emptiness assertion over "open rows with this defect" would pass having examined
 * nothing — and measured 2026-09-22 over the 34 open rows, it would have examined nothing in a second way
 * too: three bodies mention `lab:fetch`, and **none of the three invokes it from its Acceptance section**
 * (#1889 in prose about a past fetch, #1042 in a `Region` note, #1973 quoting #1929). So the live
 * population this rule can even look at is currently EMPTY, the refusal count over it is 0, and neither
 * number is a control. The controls are `CORRECTED_1929` and the mismatched-artifact case below, which
 * are the two ways a fetching Acceptance can be right.
 */

/** #1929's Acceptance as filed, verbatim — the fetch and the read that did not evaluate. */
const AS_FILED_1929 = "npm run lab:job -- -e job=acceptance\n"
  + "npm run lab:fetch -- -e artifact=acceptance-report\n"
  + "jq -e '.resolution.records >= 381 and .resolution.falsePositiveUpperBound < 0.01' "
  + "runs/model-candidate/acceptance-report.json";
/** The same body reading where the fetch actually put it. */
const CORRECTED_1929 =
  AS_FILED_1929.replace("runs/model-candidate/acceptance-report.json",
    "runs/fetched/candidate.acceptance-report.json");

test("THE POSITIVE CONTROL: #1929's Acceptance as filed is REFUSED, and NAMES the path it meant", () => {
  const reason = fileRefusalReason(rowWithRegion("packages/x/y.ts", AS_FILED_1929));
  assert.ok(reason, "the row whose `jq` exited 2 instead of judging its bound must not file again");
  assert.match(reason, /runs\/model-candidate\/acceptance-report\.json/,
    "the refusal must quote the path the row wrote, not describe it");
  assert.match(reason, /runs\/fetched\/candidate\.acceptance-report\.json/,
    "and NAME the one meant — there is exactly one right answer here, and a refusal that sent the filer "
    + "to read an Ansible playbook for it would be followable only in principle (#741)");
});

test("THE NEGATIVE CONTROL: following that refusal exactly produces a body the checker accepts", () => {
  // Not "the corrected path is not refused BY THIS RULE" but that the WHOLE filing check passes it —
  // a remedy that trips the next check along is not a remedy, it is a second refusal with extra steps.
  assert.equal(fileRefusalReason(rowWithRegion("packages/x/y.ts", CORRECTED_1929)), null,
    "the refusal's own instruction must file, or following it exactly is not a way out");
  assert.deepEqual(labFetchPathHits(rowWithRegion("packages/x/y.ts", CORRECTED_1929)), []);
});

test("THE PAIRING is what is refused: the same read with no fetch beside it is left alone", () => {
  // MUTATION TARGET. Drop the "same Acceptance must fetch it" condition and this test fails. A row may
  // legitimately name a lab path in a command that runs ON the lab; the defect is only ever the pairing,
  // and a rule that refused every lab-shaped path would be the wall #741 rules against.
  const readOnly = "jq -e '.resolution.records >= 381' runs/model-candidate/acceptance-report.json";
  assert.deepEqual(labFetchPathHits(rowWithRegion("packages/x/y.ts", readOnly)), [],
    "without a fetch in the same Acceptance, that path is not this rule's business");
  assert.equal(fileRefusalReason(rowWithRegion("packages/x/y.ts", readOnly)), null);
});

test("the FETCH's own line cannot be its own offender: `-e artifact=` names a NAME, never a path", () => {
  const hits = labFetchPathHits(rowWithRegion("packages/x/y.ts", AS_FILED_1929));
  assert.equal(hits.length, 1, "one offender, and it is the `jq`, not the fetch that set it up");
  assert.match(hits[0].command, /^jq /, `the fetch line was reported as its own offender: ${hits[0].command}`);
  // AND THE REASON, asserted rather than assumed — because the first version of this rule asserted the
  // line above while SKIPPING the fetch command, and a mutation that disabled the skip killed nothing.
  // The protection is the token grammar: an artifact is a NAME, so the fetch line names no path at all.
  assert.deepEqual(acceptancePathTokens("npm run lab:fetch -- -e artifact=acceptance-report"), [],
    "if a fetch invocation ever starts yielding a path token, the test above stops proving anything");
});

test("THE ONE-LINER: `fetch && read` in a single command is the same defect and must be caught", () => {
  // MUTATION TARGET, and the one that found a real hole. Skipping the fetch's own command — which reads
  // as harmless, since a fetch names no path — silently loses this shape, and `cmd && cmd` is how half
  // the Acceptance sections in this repo are written. Restore the skip and this test is the one that
  // fails.
  const oneLine = "npm run lab:fetch -- -e artifact=acceptance-report && "
    + "jq -e '.resolution.records >= 381' runs/model-candidate/acceptance-report.json";
  const hits = labFetchPathHits(rowWithRegion("packages/x/y.ts", oneLine));
  assert.equal(hits.length, 1, "the fetch and the read on one line is the identical error on two");
  assert.equal(hits[0].localPath, "runs/fetched/candidate.acceptance-report.json");
});

test("A DIFFERENT ARTIFACT's lab path is not refused — the mapping is read, not pattern-matched", () => {
  // `shortcuts` is `runs/scorer-shortcuts.json`; fetching it says nothing about a read of the acceptance
  // report's lab path, and a rule keyed on "looks like a lab path" would refuse this.
  const mismatched = "npm run lab:fetch -- -e artifact=shortcuts\n"
    + "jq -e '.records >= 1' runs/model-candidate/acceptance-report.json";
  assert.deepEqual(labFetchPathHits(rowWithRegion("packages/x/y.ts", mismatched)), [],
    "only the artifact the Acceptance actually fetched can make its own lab path an error");
});

test("`-e out=` selects the candidate on BOTH sides, so the parameter is read rather than assumed", () => {
  // `lab_artifacts` spells it `runs/model-{{ out | default('candidate') }}/...` and the destination is
  // `runs/fetched/{{ out }}.<artifact>`. A rule that hardcoded `candidate` would miss this row entirely
  // AND would name the wrong remedy on it — two wrong answers from one assumption.
  const varied = "npm run lab:fetch -- -e artifact=acceptance-report -e out=varied\n"
    + "jq -e '.resolution.records >= 1' runs/model-varied/acceptance-report.json";
  const hits = labFetchPathHits(rowWithRegion("packages/x/y.ts", varied));
  assert.equal(hits.length, 1, "`runs/model-varied/...` is `out=varied`'s lab path, and must be caught");
  assert.equal(hits[0].localPath, "runs/fetched/varied.acceptance-report.json",
    "and the remedy must name THAT candidate's local copy, not `candidate`'s");
});

test("THE EXTENSION COMES FROM THE SOURCE, so the remedy is not itself a wrong path", () => {
  // The playbook's own reason, in that task: every artifact was JSON until a safetensors binary and a
  // markdown changeset, and writing those as `.json` would name a file after a format they are not. A
  // hardcoded `.json` here would print a remedy that is itself the defect this row is about.
  //
  // `acceptance-records` is the case that MEASURED it: the playbook records grepping a stale
  // `candidate.acceptance-records.json` beside the real `.jsonl` three times, concluding a fix had not
  // worked, and acting on two invented causes.
  const records = "npm run lab:fetch -- -e artifact=acceptance-records\n"
    + "wc -l runs/screenreader-acceptance/repeat-1.jsonl";
  const hits = labFetchPathHits(rowWithRegion("packages/x/y.ts", records));
  assert.equal(hits.length, 1, "`{{ repeat | default('repeat-1') }}` is a parameter, and a rule that "
    + "compared the mapping literally would miss every entry carrying one");
  assert.equal(hits[0].localPath, "runs/fetched/candidate.acceptance-records.jsonl",
    "`.jsonl` from the source — a hardcoded `.json` here is the eleven-day-stale sibling the playbook "
    + "deletes on every fetch, recreated by the refusal that was supposed to prevent it");
});

test("A TRACKED artifact is caught too: reading the lab's path reads this checkout's stale copy", () => {
  // `real-page-baseline` is committed, so its lab path EXISTS here — and that is worse than absent. The
  // `jq` would not exit 2; it would read a file, and answer about whatever was last committed rather than
  // about the run just fetched. The existence check one section up cannot see this at all.
  const baseline = "npm run lab:fetch -- -e artifact=real-page-baseline\n"
    + "jq -e '.findings | length > 0' packages/lab/baselines/real-page-findings.json";
  const hits = labFetchPathHits(rowWithRegion("packages/x/y.ts", baseline));
  assert.ok(existsSync("packages/lab/baselines/real-page-findings.json"),
    "this control is only a control while that path genuinely exists — absent, it would be caught by the "
    + "existence check instead and prove nothing about this one");
  assert.equal(hits.length, 1, "a path that exists is still the wrong path when a fetch renamed it");
  assert.equal(hits[0].localPath, "runs/fetched/candidate.real-page-baseline.json");
});

test("THE STATED MISS: an extension over ten characters is invisible to the token grammar", () => {
  // NAMED RATHER THAN DISCOVERED LATER. `promoted-weights` is `model.safetensors`, and
  // `acceptancePathToken`'s `\.[A-Za-z0-9]{1,10}$` — #1943's rule, which separates a file from a ref like
  // `origin/main` — does not reach eleven. So this rule cannot speak about that one entry.
  //
  // Widening the grammar is NOT this row's to do: it is the same predicate the EXISTENCE check runs on,
  // where a wider extension means new refusals on paths nobody has measured. It is a silent miss, not a
  // wrong answer, and it is written down here so the next reader finds it stated rather than empty.
  const weights = "npm run lab:fetch -- -e artifact=promoted-weights\n"
    + "ls -l packages/scorer/models/screenreader-scorer/model.safetensors";
  assert.deepEqual(labFetchPathHits(rowWithRegion("packages/x/y.ts", weights)), [],
    "if this ever starts returning a hit the grammar has widened, and this comment is the stale one");
  assert.equal(labFetchArtifacts(
    readFileSync(resolve(import.meta.dirname, "../../../control/ansible/lab-fetch.yml"), "utf8"),
  )["promoted-weights"], "packages/scorer/models/screenreader-scorer/model.safetensors",
    "and the miss is about the EXTENSION, not about the entry having been renamed out from under it");
});

test("THE MAPPING IS THE PLAYBOOK'S, read the same as a real YAML parser reads it", () => {
  // `@a11ign/agent-org` declares no dependencies and imports nothing outside the workspace, so
  // `labFetchArtifacts` reads the block by hand rather than reaching a hoisted `yaml`. That is only safe
  // while something compares it to the real parser — this is that something, and `packages/lab` has
  // `yaml` as a declared dependency, which is why the comparison can live here and not there.
  const text = readFileSync(resolve(import.meta.dirname, "../../../control/ansible/lab-fetch.yml"), "utf8");
  const plays = parse(text) as { vars?: { lab_artifacts?: Record<string, string> } }[];
  const real = plays.find((play) => play.vars?.lab_artifacts)?.vars?.lab_artifacts;
  assert.ok(real && Object.keys(real).length > 0,
    "the playbook's `lab_artifacts` map is empty or gone — a comparison against nothing passes having "
    + "examined nothing, which is the shape this whole file exists to refuse");
  assert.deepEqual(labFetchArtifacts(text), real,
    "the hand parser and `yaml` disagree about `lab-fetch.yml`. The playbook is right and "
    + "`labFetchArtifacts` is wrong — a mapping read two ways is the drift #959 was filed for");
});

test("a playbook with no `lab_artifacts` map THROWS rather than reporting an empty mapping", () => {
  // #1943's own lesson one file along: a check handed an empty population reports clean about something
  // it never saw. If the playbook's shape changes, this rule must go loud, not quiet.
  assert.throws(() => labFetchArtifacts("- name: something else\n  hosts: all\n"),
    /lab_artifacts/, "a silently empty map would pass every row this check exists to refuse");
});

test("the lab-fetch check is the SHARED function in `row-file`, not a second copy", () => {
  const tool = readFileSync(resolve(import.meta.dirname, "../../../agent-org/src/row-file.mjs"), "utf8");
  assert.match(tool, /import \{[^}]*labFetchPathReason[^}]*\} from "\.\/acceptance-commands\.mjs"/s,
    "row-file must IMPORT the check; a local copy of the fetch mapping here would be the third statement "
    + "of a path that already exists twice");
  assert.doesNotMatch(tool, /lab_artifacts|runs\/fetched/,
    "and must not re-state the mapping or the destination shape itself");
});
