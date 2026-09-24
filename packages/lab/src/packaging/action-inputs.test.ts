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

/**
 * AN INPUT THAT MIRRORS A `--no-<name>` FLAG MUST KEEP THE CLI'S POLARITY: ON unless the consumer writes `false`.
 *
 * The test above proves the name reaches the argv and cannot see which way it points. A `default: "false"`, or a
 * guard written `= "true"`, still reaches the CLI — and turns a default-ON probe off for every workflow that
 * never sets the input, silently (reviewer on #1601; `ceo`'s ruling on #1392 is that the probes stay ON).
 *
 * Two guard spellings keep the probe ON, and only two: `= "false" ] && args+=(--no-<name>)` (off on an explicit
 * `false`) and `= "true" ] || args+=(--no-<name>)` (`axe`'s older form: off on anything but `true`). With
 * `default: "true"` both leave an unset input ON. They differ only on a value that is neither word, which is not the
 * polarity this checks, so both are accepted rather than one rewritten.
 *
 * The population is derived — every declared input the CLI also parses as `--no-<name>` — and pinned by name so
 * that a parse going blind reads as a failure, not as a clean pass over nothing.
 */
test("an input mirroring a --no-<name> flag defaults true and passes the flag only on an explicit false", () => {
  const mirrored = declaredInputs().filter((name) => CLI.includes(`"--no-${name}"`));
  assert.deepEqual(mirrored, ["probe-focus", "probe-navigation", "axe"],
    "the inputs mirroring a CLI --no-<name> flag changed; a new one belongs here only once its polarity is checked");

  for (const name of mirrored) {
    const entry = new RegExp(`^ {2}${name}:\\n((?:(?: {4}.*)?\\n)*)`, "m").exec(ACTION)?.[1] ?? "";
    assert.match(entry, /^ {4}default: "true"$/m,
      `${name} must default "true": the CLI defaults it ON, and a workflow that never sets it gets that default`);

    const passes = ACTION.split("\n").filter((line) => /\bargs\+=\(/.test(line) && line.includes(`inputs.${name} }}`));
    const onPreserving = [
      `[ "\${{ inputs.${name} }}" = "false" ] && args+=(--no-${name})`,
      `[ "\${{ inputs.${name} }}" = "true" ] || args+=(--no-${name})`,
    ];
    assert.equal(passes.length, 1, `${name} must reach the argv on exactly one line, found ${passes.length}`);
    assert.ok(onPreserving.includes(passes[0].trim()),
      `${name}'s guard ${passes[0].trim()} is not one that leaves the probe ON by default; use ${onPreserving[0]}`);
  }
});

/**
 * THE PAGE LIST (#2272): `url` AND `urls` ARE TWO FORMS OF ONE INPUT, AND THE CAP OVERRIDE IS AN INPUT AND NOTHING ELSE.
 *
 * Three things a workflow file could get wrong without any other test noticing, each of them a way for a run to
 * capture something other than what its author wrote:
 * - `url` stayed `required: true`, so a list-only workflow could not be written (the runner refuses a missing
 *   required input before any step runs, which reads as a broken Action);
 * - the both-or-neither refusal moved AFTER setup, so the ~100 s of runner minutes it exists to save were billed
 *   anyway;
 * - the override was made reachable some other way -- an environment default or a config file -- and a cap the
 *   author never raised on purpose was raised for them.
 */
test("url and urls are alternatives: neither is required, and both-or-neither is refused before setup", () => {
  const entry = (name: string) => new RegExp(`^ {2}${name}:\\n((?:(?: {4}.*)?\\n)*)`, "m").exec(ACTION)?.[1] ?? "";
  // `url` carries no `default:`: `example-matches-action-defaults.test.ts` compares every input an example SETS
  // against its default, and `url: ""` would read as a contradiction by every example that names a page.
  for (const name of ["url", "urls", "max-pages"]) {
    assert.match(entry(name), /^ {4}required: false$/m, `${name} must not be required: exactly one of url and urls is`);
    if (name !== "url") {
      assert.match(entry(name), /^ {4}default: ""$/m, `${name} must default to the empty string, which is "not given"`);
    }
  }
  const guard = ACTION.indexOf("Check exactly one of url and urls is given");
  const setup = ACTION.indexOf("uses: actions/setup-node");
  assert.ok(guard > 0 && setup > 0 && guard < setup, "the both-or-neither refusal must come BEFORE setup-node, which is where billing starts");
  const step = ACTION.slice(guard, setup);
  assert.match(step, /Give exactly one of url and urls, not both/);
  assert.match(step, /Give exactly one of url and urls: no page was given/);
});

test("the page list reaches the CLI as --urls, the override as --max-pages, and nothing else raises the cap", () => {
  for (const flag of ["--urls", "--max-pages"]) {
    assert.ok(CLI.includes(`"${flag}"`), `${flag} is not a flag the CLI parses, so this expectation is stale rather than met`);
    assert.ok(ACTION.split("\n").some((line) => /\bargs\+=\(/.test(line) && line.includes(flag)),
      `the Action never passes ${flag}: the input would be declared and ignored`);
  }
  assert.ok(ACTION.split("\n").some((line) => /\bargs\+=\(/.test(line) && line.includes("inputs.max-pages }}")),
    "max-pages must reach the argv");
  // `multi-page.test.ts` proves the CLI reads no environment variable for the cap; this is the workflow's half.
  assert.doesNotMatch(ACTION, /\bMAX_PAGES\b/, "action.yml exports no environment default for the cap");
});
