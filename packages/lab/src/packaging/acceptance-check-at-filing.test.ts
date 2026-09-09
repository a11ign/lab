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
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { wholeSuiteAcceptanceReason } from "../../../../scripts/row-claim/template-fields-rule.mjs";
import { fileRefusalReason } from "../../../../scripts/row-file.mjs";
import { runsTheWholeSuite } from "../../../../scripts/acceptance-commands.mjs";

const rowWith = (acceptance: string) =>
  `## Region\n\n\`packages/x/y.ts\`\n\n## Acceptance\n\n\`\`\`\n${acceptance}\n\`\`\`\n\n`
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
    resolve(import.meta.dirname, "../../../../scripts/row-claim/template-fields-rule.mjs"), "utf8");
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
