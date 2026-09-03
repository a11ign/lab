/**
 * EVERY INPUT THE ACTION DECLARES MUST REACH THE CLI, AND THE CAPABILITIES THAT DECIDE CRITERIA MUST BE
 * EXPOSED.
 *
 * Two directions, and each has a distinct failure this repo has already paid for.
 *
 * **Declared but never passed.** An `inputs:` entry a consumer sets and the `args=(...)` block never
 * reads is the "a flag nobody reads" defect at the workflow boundary — YAML accepts it, the run
 * succeeds, and the default silently applies. `refuseUnknownFlags` guards the CLI's own argv and cannot
 * see this, because the argument is never sent.
 *
 * **A capability that ships in the CLI and not here.** `--forms` was exactly that until 2026-09-03: ADR
 * 0024's whole purpose is to make 3.3.1, 3.3.3 and 4.1.3 reachable on a form that rejects guesses, and it
 * shipped in the CLI while the Action — where `probe-forms` defaults ON *because* "a workflow in your own
 * repository is testing your own application, where submitting a form is the intended act" — had no way
 * to supply a config. The one context where a declared config is most valuable was the one that could not
 * use it, which is the same inversion as a gate that does not exercise what ships.
 *
 * Read from the two files rather than from a list, so the check cannot drift from either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../../../..");
const ACTION = readFileSync(resolve(REPO, "action.yml"), "utf8");
const CLI = readFileSync(resolve(REPO, "packages/cli/src/cli.ts"), "utf8");

/** Input names, from the `inputs:` block only — not from every `${{ inputs.x }}` reference. */
function declaredInputs(): string[] {
  const block = /^inputs:\n([\s\S]*?)^\S/m.exec(ACTION)?.[1] ?? "";
  return [...block.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(([, name]) => name);
}

/**
 * Inputs that configure the ACTION rather than the capture, so no CLI argument corresponds to them.
 * Classified with a reason, never pattern-excluded: "nothing needs this" and "somebody forgot" must stay
 * different states.
 */
const NOT_A_CLI_ARGUMENT: Readonly<Record<string, string>> = {
  "judge-backend": "exported as an environment variable, not passed as argv",
  "anthropic-api-key": "an environment variable, and a secret — never on a command line, where it would "
    + "reach the process table and any `ps` in a later step",
  "judge-base-url": "environment variable, same as judge-backend",
  "judge-model": "environment variable, same as judge-backend",
  "fail-on": "read by the Report step to decide the exit status; the capture does not see it",
  "comment-on-pr": "read by the Report step to decide whether to post; the capture does not see it",
  "node-version": "consumed by actions/setup-node before the CLI exists",
};

test("every declared input either reaches the CLI or is classified", () => {
  const inputs = declaredInputs();
  assert.ok(inputs.length > 5,
    `parsed only ${inputs.length} input(s) from action.yml — the block format changed and this went blind`);

  // Matched on what the line DOES — builds the argv — rather than on the shell shape around it. The first
  // version enumerated the shapes (`= "true" ] &&`, `] ||`, ...) and reported three inputs as unread that
  // are passed on the very next lines: a guard deriving its expectation from a guessed spelling, which is
  // the same defect as a test scraping source text for the list it is checking.
  const buildsArgv = ACTION.split("\n").filter((line) => /\bargs(\+)?=\(/.test(line));
  assert.ok(buildsArgv.length > 1,
    "found no lines building the CLI argv — the Run step changed shape and this went blind");

  const unread = inputs.filter((name) =>
    !(name in NOT_A_CLI_ARGUMENT) && !buildsArgv.some((line) => line.includes(`inputs.${name} }}`)));

  assert.deepEqual(unread, [],
    "These inputs are declared and never reach the CLI's argv:\n  " + unread.join("\n  ")
    + "\n\nA consumer sets one, YAML accepts it, the run succeeds and the DEFAULT applies. Either pass it"
    + "\nin the `args=(...)` block or classify it in NOT_A_CLI_ARGUMENT with the reason.");
});

/**
 * CLI flags that decide which CRITERIA a run can reach. These are capabilities, not preferences: without
 * the flag the criterion is structurally unreachable rather than clean, so a consumer who cannot set it
 * gets a quieter report and no way to know why.
 */
const CAPABILITY_FLAGS: Readonly<Record<string, string>> = {
  "--probe-forms": "3.3.1 and 4.1.3 need a control to be activated",
  "--forms": "ADR 0024 — 3.3.1, 3.3.3 and 4.1.3 on a form that will not submit on a guess",
};

test("every capability flag the CLI takes is reachable from the Action", () => {
  for (const [flag, why] of Object.entries(CAPABILITY_FLAGS)) {
    assert.ok(CLI.includes(`"${flag}"`),
      `${flag} is not a flag the CLI parses, so this expectation is stale rather than met`);
    assert.ok(ACTION.includes(flag),
      `the Action never passes ${flag} — ${why}. A capability in the CLI and not in CI leaves the one `
      + "context where it matters most unable to use it.");
  }
});
