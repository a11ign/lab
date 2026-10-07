// no-token: lookups.mjs
/**
 * #3289 -- THE FLEET PART'S VERDICT AS A `qualification` COMMIT STATUS.
 *
 * The release reads this status (#3136) and WAITS on `pending`, RELEASES on `success`. So the function that
 * decides what it says is tested through its SHIPPED export, never a copy of its rules, and the case that
 * matters most is the one that looks like silence: a lab job that died before printing a verdict.
 *
 * POSITIVE CONTROL for every "never success" assertion below: the table HAS a `success` row, asserted to
 * be reachable, so a function that returned `failure` for everything would fail it, and one that returned
 * `success` for everything is refused by the exit-2 and missing-verdict rows.
 *
 * The poster is driven through an injected `gh`, so it runs offline and posts nothing. The one live post
 * (done-when 4) is read back on the row from the host's own credential; this file proves only what fixtures
 * can, and says so rather than standing for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUALIFICATION_CONTEXT, QUALIFICATION_GATE, qualificationStatus,
} from "../gates/qualification-status.mjs";
import { gateVerdict } from "../gates/verdict.mjs";
import { QUALIFICATION_CONTEXT as READ_CONTEXT } from "../../../../scripts/release-reads-qualification.mjs";
import {
  EXIT, parseArgs, postQualificationStatus, renderResult, requireFullSha,
} from "../../../control/src/post-qualification-status.mjs";

const SHA = "308b2de5bbd8a1f0c4e7d9b3a6f2e1d0c9b8a7f6";
const GITHUB_DESCRIPTION_LIMIT = 140;
const LONG_SOURCE = 400;

/** What the function accepts; malformed fixtures are cast through `unknown` so the casts are visible. */
type Outcome = Parameters<typeof qualificationStatus>[0]["outcome"];
const malformed = (value: unknown) => value as Outcome;

const PASS = gateVerdict({ examined: 8, of: 8, source: "8 canaries" });
const FAIL = gateVerdict({ examined: 8, of: 8, source: "8 canaries", failures: 1 });
const INCONCLUSIVE = gateVerdict({ examined: 5, of: 8, source: "8 canaries" });

const TABLE: { name: string; outcome: Outcome; state: string }[] = [
  { name: "a started run", outcome: { started: true }, state: "pending" },
  { name: "PASS verdict", outcome: { verdict: PASS }, state: "success" },
  { name: "exit 0", outcome: { exitCode: 0 }, state: "success" },
  { name: "FAIL verdict", outcome: { verdict: FAIL }, state: "failure" },
  { name: "exit 1", outcome: { exitCode: 1 }, state: "failure" },
  { name: "INCONCLUSIVE verdict", outcome: { verdict: INCONCLUSIVE }, state: "failure" },
  { name: "exit 2 (INCONCLUSIVE)", outcome: { exitCode: 2 }, state: "failure" },
  { name: "no outcome at all", outcome: undefined, state: "failure" },
  { name: "an empty outcome", outcome: malformed({}), state: "failure" },
  { name: "a verdict object with no verdict name", outcome: malformed({ verdict: { why: "?" } }), state: "failure" },
  { name: "a verdict named something else", outcome: malformed({ verdict: { verdict: "OK" } }), state: "failure" },
  { name: "a null verdict", outcome: malformed({ verdict: null }), state: "failure" },
  { name: "a non-numeric exit code", outcome: malformed({ exitCode: "0" }), state: "failure" },
  { name: "exit 127 (job not wired)", outcome: { exitCode: 127 }, state: "failure" },
  { name: "exit 137 (killed)", outcome: { exitCode: 137 }, state: "failure" },
  { name: "exit 3 (a precondition, not a verdict)", outcome: { exitCode: 3 }, state: "failure" },
];

for (const row of TABLE) {
  test(`${row.name} -> ${row.state}`, () => {
    const payload = qualificationStatus({ sha: SHA, outcome: row.outcome, run: "a11y-job-gate-stability" });
    assert.equal(payload.state, row.state);
    assert.equal(payload.context, QUALIFICATION_CONTEXT);
    assert.equal(payload.context, "qualification");
    assert.match(payload.description, new RegExp(QUALIFICATION_GATE));
    assert.ok(payload.description.length <= GITHUB_DESCRIPTION_LIMIT, payload.description);
  });
}

test("the context is the one the release READS, not a second spelling of it", () => {
  assert.equal(QUALIFICATION_CONTEXT, READ_CONTEXT);
  assert.equal(READ_CONTEXT, "qualification", "positive control: the reader's own constant is not empty or renamed");
});

test("POSITIVE CONTROL: the table reaches success, and ONLY through a PASS reading", () => {
  const successes = TABLE.filter((row) => row.state === "success").map((row) => row.name);
  assert.deepEqual(successes, ["PASS verdict", "exit 0"]);
  const states = new Set(TABLE.map((row) => row.state));
  assert.deepEqual([...states].sort(), ["failure", "pending", "success"]);
});

test("a missing or unparseable verdict is never success, and says so", () => {
  for (const outcome of [undefined, {}, { verdict: "PASS" }, { verdict: 0 }, { exitCode: Number.NaN },
    { exitCode: 1.5 }, { exitCode: null }]) {
    const payload = qualificationStatus({ sha: SHA, outcome: malformed(outcome) });
    assert.equal(payload.state, "failure", JSON.stringify(outcome));
    assert.match(payload.description, /not a pass/, JSON.stringify(outcome));
  }
});

test("INCONCLUSIVE is a failure that says it could not tell, not a pass and not pending", () => {
  const payload = qualificationStatus({ sha: SHA, outcome: { exitCode: 2 } });
  assert.equal(payload.state, "failure");
  assert.notEqual(payload.state, "pending");
  assert.match(payload.description, /INCONCLUSIVE/);
});

test("the description claims the fleet part only, never the whole release gate", () => {
  for (const row of TABLE) {
    const { description } = qualificationStatus({ sha: SHA, outcome: row.outcome, run: "r" });
    assert.match(description, /fleet part only/, row.name);
    assert.doesNotMatch(description, /release:gate/, row.name);
  }
});

test("a long reason is trimmed but the gate, the scope and the run survive", () => {
  const long = gateVerdict({ examined: 1, of: 8, source: "x".repeat(LONG_SOURCE) });
  const payload = qualificationStatus({ sha: SHA, outcome: { verdict: long }, run: "run-123" });
  assert.ok(payload.description.length <= GITHUB_DESCRIPTION_LIMIT);
  assert.match(payload.description, /gate:stability \(fleet part only\)/);
  assert.match(payload.description, /\[run-123\]$/);
});

test("a malformed sha throws rather than yielding a payload for nothing", () => {
  for (const sha of ["", "abc123", SHA.toUpperCase(), `${SHA}0`, undefined, null, 42]) {
    assert.throws(() => qualificationStatus({ sha: sha as string, outcome: { started: true } }), /40-character/);
  }
});

// ---- the poster ------------------------------------------------------------------------------------

type GhAnswer = { status: number | null; stdout: string; stderr: string; missing: boolean };
const answer = (over: Partial<GhAnswer> = {}): GhAnswer => ({ status: 0, stdout: "{}", stderr: "", missing: false, ...over });

/** An injected `gh` that records the argv it was asked to run. */
const recorder = (reply: GhAnswer = answer()) => {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return reply;
  };
  return { calls, gh };
};

test("it posts the payload to the sha's statuses endpoint through `gh api`, as the host's own credential", () => {
  const { calls, gh } = recorder();
  const result = postQualificationStatus({ sha: SHA, outcome: { exitCode: 0 }, run: "a11y-job-gate-stability", gh });
  assert.equal(result.posted, true);
  assert.equal(calls.length, 1);
  const payload = qualificationStatus({ sha: SHA, outcome: { exitCode: 0 }, run: "a11y-job-gate-stability" });
  assert.deepEqual(calls[0], ["api", "--method", "POST", `repos/a11ign/a11ign/statuses/${SHA}`,
    "-f", `state=${payload.state}`, "-f", `context=${payload.context}`, "-f", `description=${payload.description}`]);
  assert.match(renderResult(result), /^POSTED qualification: success/);
});

test("with NO usable credential it posts nothing, says so, and is exit 3 -- never success, never silent", () => {
  const cases: [string, GhAnswer][] = [
    ["no `gh` on this host", answer({ status: null, stderr: "", missing: true })],
    ["gh logged in as nobody (its own exit 4)", answer({ status: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" })],
    ["GitHub answering 401", answer({ status: 1, stderr: "gh: Bad credentials (HTTP 401)" })],
    ["GitHub answering 403, the token lacks statuses: write", answer({ status: 1, stderr: "gh: Resource not accessible by personal access token (HTTP 403)" })],
  ];
  for (const [name, reply] of cases) {
    const { gh } = recorder(reply);
    const result = postQualificationStatus({ sha: SHA, outcome: { verdict: PASS }, gh });
    assert.equal(result.posted, false, name);
    assert.equal((result as { reason?: string }).reason, "no-credential", name);
    const said = renderResult(result);
    assert.match(said, /NOT POSTED/, name);
    assert.match(said, /no usable GitHub credential/, name);
    assert.match(said, /not yet/, name);
    assert.match(said, /Would have posted: success/, name);
  }
  assert.notEqual(EXIT.NOT_YET, EXIT.POSTED);
  assert.notEqual(EXIT.NOT_YET, EXIT.REFUSED);
});

test("GitHub refusing the post for another reason is a REFUSAL (exit 1), reported and not swallowed", () => {
  for (const stderr of ["gh: Validation Failed (HTTP 422)", "gh: Not Found (HTTP 404)", "gh: Bad Gateway (HTTP 502)"]) {
    const result = postQualificationStatus({ sha: SHA, outcome: { exitCode: 0 }, gh: recorder(answer({ status: 1, stderr })).gh });
    assert.equal(result.posted, false, stderr);
    assert.equal((result as { reason?: string }).reason, "rejected", stderr);
    assert.match(renderResult(result), new RegExp(stderr.replace(/[()]/g, "\\$&")));
  }
});

test("a malformed sha is refused even when this host has no credential, and `gh` is never asked", () => {
  const { calls, gh } = recorder(answer({ missing: true, status: null }));
  assert.throws(() => postQualificationStatus({ sha: "abc", outcome: { started: true }, gh }), /40-character/);
  assert.equal(calls.length, 0);
  assert.throws(() => requireFullSha("abc"), /40-character/);
  assert.doesNotThrow(() => requireFullSha(SHA));
});

test("argv: --started, --exit-code and an unreadable --verdict-file map to outcomes, the last to failure", () => {
  assert.deepEqual(parseArgs([`--sha=${SHA}`, "--started"]).outcome, { started: true });
  assert.deepEqual(parseArgs([`--sha=${SHA}`, "--exit-code=2"]).outcome, { exitCode: 2 });
  const unreadable = parseArgs([`--sha=${SHA}`, "--verdict-file=/nonexistent/verdict.json"]).outcome;
  assert.equal(qualificationStatus({ sha: SHA, outcome: unreadable }).state, "failure");
  const none = parseArgs([`--sha=${SHA}`]).outcome;
  assert.equal(none, undefined);
  assert.equal(qualificationStatus({ sha: SHA, outcome: none }).state, "failure");
  const garbage = parseArgs([`--sha=${SHA}`, "--exit-code=banana"]).outcome;
  assert.equal(qualificationStatus({ sha: SHA, outcome: garbage }).state, "failure");
});
