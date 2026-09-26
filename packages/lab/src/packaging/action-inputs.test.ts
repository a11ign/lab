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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";

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
  "flows": "exported as the FLOWS environment variable and made absolute against the workspace in the Capture step's shell, "
    + "which then passes `--flows`; deliberately NOT interpolated into the run text (ADR 0038, Constraint 2: these are the "
    + "inputs of an action that handles secrets, and `authenticated-action.test.ts` pins that none of the three is)",
  "login-flow": "exported as LOGIN_FLOW and passed as `--login-flow` from the environment variable, for the reason `flows` is",
  "auth-state": "exported as AUTH_STATE, made absolute against the workspace in the Capture step's shell, and passed as `--auth-state` "
    + "from that variable; not interpolated into the run text, for the reason `flows` is (ADR 0038, amendment 7, choice 6)",
  "send-authenticated-transcript-to-judge-vendor": "exported as SEND_TRANSCRIPT and passed as `--send-authenticated-transcript-to-judge-vendor` "
    + "ONLY when it is exactly `true`; an argument in the CLI and never an environment variable it reads (clause 5's override)",
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

/**
 * A LIST IN WHICH ONE PAGE FAILED MUST STILL BE REPORTED (#2313's review at 0209b180).
 *
 * The CLI exits 1 for such a list AFTER writing every page's result, and GitHub runs `shell: bash` with `-eo
 * pipefail`, so a bare invocation stopped the capture step before `result-json` was set and the Report step -- the
 * only thing that renders the failed page -- never ran. Both halves below RUN the shell text out of action.yml
 * rather than grep it, because a grep for `|| status=$?` is satisfied by a comment that says so.
 */
function stepText(startMarker: string, endMarker: string): string {
  const from = ACTION.indexOf(startMarker);
  const to = ACTION.indexOf(endMarker, from);
  assert.ok(from > 0 && to > from, `action.yml no longer has ${JSON.stringify(startMarker)} .. ${JSON.stringify(endMarker)}`);
  return ACTION.slice(from, to);
}

function runCaptureTail(fake: string): { status: number | null; outputs: string; result: string } {
  const dir = mkdtempSync(join(tmpdir(), "capture-tail-"));
  try {
    // Only the lines that invoke the CLI and record its outcome; `npx tsx packages/cli/src/cli.ts "${args[@]}"` is the fake.
    const tail = stepText("        status=0\n        npx tsx packages/cli/src/cli.ts", '    - name: Report')
      .replace(/npx tsx packages\/cli\/src\/cli\.ts "\$\{args\[@\]\}"/, "fake_cli");
    const script = `set -eo pipefail\nargs=()\nout="$D/result.json"\nfake_cli() { ${fake}; }\n${tail}`;
    const ran = spawnSync("bash", ["-c", script], {
      env: { ...process.env, D: dir, GITHUB_OUTPUT: join(dir, "outputs") }, encoding: "utf8",
    });
    const read = (name: string) => { try { return readFileSync(join(dir, name), "utf8"); } catch { return ""; } };
    return { status: ran.status, outputs: read("outputs"), result: read("result.json") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a CLI that exits 1 AFTER writing its result does not stop the capture step: the outputs are set and the status is handed on", () => {
  const run = runCaptureTail(`echo '{"multiPage":true,"pages":[]}'; return 1`);
  assert.equal(run.status, 0, "the capture step must not fail here: the Report step is what renders the failed page");
  assert.match(run.outputs, /^result-json=.*result\.json$/m);
  assert.match(run.outputs, /^capture-status=1$/m);
});

test("a CLI that exits nonzero with NO result still fails the capture step, and sets no result-json", () => {
  const run = runCaptureTail("return 2");
  assert.equal(run.status, 2, "a refusal or crash left nothing to report, and must fail where it always did");
  assert.doesNotMatch(run.outputs, /result-json=/);
});

test("a CLI that succeeds sets capture-status=0", () => {
  const run = runCaptureTail(`echo '{}'`);
  assert.equal(run.status, 0);
  assert.match(run.outputs, /^capture-status=0$/m);
});

test("the Report step re-raises the capture's status once the report exists, and the outputs reducer survives a PDF page", () => {
  const report = stepText("    - name: Report\n", "    # Last, and `always()`");
  assert.match(report, /capture-status \|\| 0/, "the Report step must read the capture's status");
  // The reducer, run as the runner runs it, over a list holding a PDF result (`{ url, task, pdf }`: no verdict) beside a page with one.
  const reducer = /node -e '\n([\s\S]*?)\n\s*' "\$\{\{ steps\.capture\.outputs\.result-json \}\}"/.exec(report)?.[1];
  assert.ok(reducer, "the outputs reducer is no longer an inline `node -e` in the Report step");
  const dir = mkdtempSync(join(tmpdir(), "reducer-"));
  try {
    const result = join(dir, "result.json");
    const withVerdict = { url: "https://a.example/", verdict: { findings: [{}, {}], taskCompletable: true } };
    const pdf = { url: "https://a.example/x.pdf", task: "t", pdf: [] };
    writeFileSync(result, JSON.stringify({
      multiPage: true,
      pages: [{ url: withVerdict.url, status: "captured", results: [withVerdict] },
        { url: pdf.url, status: "captured", results: [pdf] }],
    }));
    const ran = spawnSync("node", ["-e", reducer, result], {
      env: { ...process.env, GITHUB_OUTPUT: join(dir, "outputs") }, encoding: "utf8",
    });
    assert.equal(ran.status, 0, `the reducer crashed on a verdict-less result: ${ran.stderr}`);
    const outputs = readFileSync(join(dir, "outputs"), "utf8");
    assert.match(outputs, /^findings=2$/m, "the verdict-less page adds no findings");
    assert.match(outputs, /^task-completable=false$/m, "a page with no verdict is never completable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Report step exits with the capture's status only when the report's own status is 0", () => {
  const raise = stepText('        if [ "$status" -eq 0 ]; then status="${{', "\n    # Last, and `always()`");
  const exitOf = (reportStatus: number, captureStatus: string) => spawnSync("bash", ["-c",
    `set -eo pipefail\nstatus=${reportStatus}\n${raise.replace(/\$\{\{ steps\.capture\.outputs\.capture-status \|\| 0 \}\}/, captureStatus)}`,
  ]).status;
  assert.equal(exitOf(0, "1"), 1, "a failed page must fail the job after the report is written");
  assert.equal(exitOf(0, "0"), 0);
  assert.equal(exitOf(2, "1"), 2, "the report's status says WHICH failure; the capture's must not overwrite it");
});

/**
 * `task` IS OPTIONAL, DESCRIBED AS WHAT IT DOES, AND AN UNSET ONE IS THE CLI'S DEFAULT, NEVER AN EMPTY TASK (#2268, #2262 a).
 *
 * Making the input optional alone would have shipped a second defect: an unset input is the empty string, the workflow
 * passed `--task ""`, and the CLI parsed with `argv[++i] ?? args.task`, which only falls back on a MISSING value. The
 * report then printed a blank `Task:` line. Both halves are pinned: the workflow does not build the flag from an empty
 * input, and the parser does not take an empty value for a task, so removing either fails here.
 */
const entryOf = (name: string) => new RegExp(`^ {2}${name}:\\n((?:(?: {4}.*)?\\n)*)`, "m").exec(ACTION)?.[1] ?? "";

test("task is not required, and its description names what it does and denies what it does not", () => {
  const task = entryOf("task");
  assert.ok(task.length > 0, "found no `task` entry in action.yml -- the block format changed and this went blind");
  assert.match(task, /^ {4}required: false$/m, "task must not be required: an unset one is the CLI's default");
  const description = task.replace(/\s+/g, " ");
  assert.match(description, /NAMES A BUTTON FOR THE PROBE TO PRESS/, "it steers which button the probe presses");
  assert.match(description, /LABEL FOR YOUR REPORT/, "it is a label for the report");
  assert.match(description, /It does NOT change the analysis/, "and it does not change the analysis");
  // The other half: the description must never claim the judgement follows the task. The rented backends DO read it, and
  // that sentence is allowed to say so -- as a thing only they do.
  assert.doesNotMatch(description, /\b(?:sharpen|improve|steer|tune)s?\b[^.]*\b(?:judg|analysis|findings|verdict)/i,
    "the description must not claim the task steers or sharpens the judgement");
  assert.doesNotMatch(description, /load-bearing/, "the description no longer calls the task load-bearing");
});

/** The Capture step's argv, built by the workflow's own shell text with the input substituted the way the runner does. */
function argvFromWorkflow(task: string): string[] {
  const text = stepText("        args=(", "        # ONE OF THESE TWO").replaceAll("${{ inputs.task }}", task);
  const ran = spawnSync("bash", ["-c", `set -eo pipefail\n${text}\nprintf '%s\\0' "\${args[@]}"`], { encoding: "utf8" });
  assert.equal(ran.status, 0, `the workflow's argv block failed: ${ran.stderr}`);
  return ran.stdout.split("\0").slice(0, -1);
}

/** What the CLI makes of an argv: the task it parsed, and the `Task:` line the report prints for it. */
function taskAndReportLine(argv: string[]): { task: string; line: string | undefined } {
  const script = `
    import { parseArgs } from "./packages/cli/src/cli.ts";
    import { reportLines } from "./packages/cli/src/report.ts";
    const { task } = parseArgs(JSON.parse(process.env.WITNESS_TEST_ARGV));
    const lines = reportLines({ url: "https://example.com", task, screenReader: "NVDA", announcements: 1,
      verdict: { taskCompletable: true, confidence: 0.9, summary: "s", findings: [] }, axe: null });
    console.log(JSON.stringify({ task, line: lines.find((l) => l.startsWith("Task:")) }));`;
  const npx = npmCliInvocation("npx", ["tsx", "-e", script]);
  const ran = spawnSync(npx.command, npx.args, {
    cwd: REPO, encoding: "utf8", // by environment: cli.ts's entry guard reads `process.argv[1]` as a script path
    env: { ...process.env, WITNESS_TEST_ARGV: JSON.stringify(["https://example.com", ...argv]) },
  });
  assert.equal(ran.status, 0, `parsing the argv failed: ${ran.stderr}`);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "{}");
}

const CLI_DEFAULT_TASK = "Read and understand this page";

test("an Action run with task unset builds no --task and reaches the report as the CLI default, never an empty task", () => {
  const argv = argvFromWorkflow("");
  assert.deepEqual(argv, ["--json"], "an unset task passes no --task flag");
  const { task, line } = taskAndReportLine(argv);
  assert.equal(task, CLI_DEFAULT_TASK);
  assert.match(line ?? "", new RegExp(`^Task:  ${CLI_DEFAULT_TASK}  \\(`), "the report prints the default, not a blank Task line");
});

test("an Action run with task set passes it through, and a blank one still gets the default from the parser", () => {
  assert.deepEqual(argvFromWorkflow("Buy a bag"), ["--json", "--task", "Buy a bag"]);
  assert.equal(taskAndReportLine(argvFromWorkflow("Buy a bag")).task, "Buy a bag");
  // The parser's own half, independent of the workflow: `--task ""` and a whitespace-only value are not a task.
  assert.equal(taskAndReportLine(["--task", ""]).task, CLI_DEFAULT_TASK);
  assert.equal(taskAndReportLine(["--task", "  "]).task, CLI_DEFAULT_TASK);
});

test("README and docs/github-action.md say what task does in the same words, and README no longer says it is not a label", () => {
  const sentence = "`task` is optional. It names a button for the probe to press, by a word from that button's label; "
    + "it is a label for your report; and it does NOT change the analysis.";
  for (const file of ["README.md", "docs/github-action.md"]) {
    const text = readFileSync(resolve(REPO, file), "utf8");
    assert.ok(text.includes(sentence), `${file} must carry the ruling's sentence verbatim: ${sentence}`);
    assert.doesNotMatch(text, /`--task` is not a label|Give it a real task/, `${file} still tells the reader the task is not a label`);
  }
});
