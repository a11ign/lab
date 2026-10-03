// @ts-check
/**
 * THE FLEET PART'S VERDICT, AS A GITHUB COMMIT STATUS PAYLOAD (#3289, #3136 done-when 3).
 *
 * The release reads a `qualification` status on the sha (#3136); this is the function that decides what
 * that status says. It is PURE and lives beside the verdict it reads, because the poster that holds the
 * token runs on the control plane (ADR 0012: the lab gets no write credential, `ceo` ruled A on #3289) and
 * must not carry a second copy of the rules.
 *
 * ## What it refuses to say
 *
 * `success` has exactly one source: a `PASS` verdict, or exit code 0, for the right gate. Everything else
 * that is not a start is `failure` -- including exit 2 (INCONCLUSIVE, "could not tell") and a verdict that is
 * missing or unreadable. A status is read by a machine that WAITS on `pending` and RELEASES on `success`,
 * so "could not tell" posted as `pending` would make the release wait for a run that already ended, and
 * posted as `success` would release on nothing. The case that most needs a test is the unreadable one: a
 * lab job that died before printing a verdict looks exactly like silence.
 *
 * ## What it claims to cover
 *
 * The FLEET PART ONLY: `gate:stability`, the one stage of the release gate that needs a Windows worker
 * (#3132's measurement). The description says so and never says "release:gate passed" -- the runner-part
 * stages have no lab wall-clock (#3141), and a description that implied them would be the scope-dropped-at-
 * the-boundary defect `verdict.mjs` was written about.
 */
import { exitCodeFor } from "./verdict.mjs";

/** The status context the release reads. One fact: #3136's reader and the poster must agree on it. */
export const QUALIFICATION_CONTEXT = "qualification";

/** The gate this status is a verdict on, named in every description. */
export const QUALIFICATION_GATE = "gate:stability";

/** GitHub rejects a status description longer than this. */
const DESCRIPTION_LIMIT = 140;

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** The exit codes `verdict.mjs` defines. Anything else is not a verdict. */
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_INCONCLUSIVE = 2;

/**
 * @typedef {{ state: "pending" | "success" | "failure", context: string, description: string }} StatusPayload
 * @typedef {{ started: true }
 *   | { verdict: { verdict?: unknown, why?: unknown } }
 *   | { exitCode: unknown }} Outcome
 *   What the poster knows. `started` is the run beginning; `verdict` is a `GateVerdict` the lab printed;
 *   `exitCode` is the job's exit status. A caller that has none of them passes `{}`, and gets `failure`.
 */

/**
 * @param {unknown} sha @returns {string}
 */
function requireSha(sha) {
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    // THROWN, not a failure payload: a status posted to a malformed sha lands on nothing, so there is no
    // honest payload to return. The poster turns the throw into a refusal that names the value.
    throw new Error(`a qualification status needs a full 40-character lowercase sha, got ${JSON.stringify(sha)}`);
  }
  return sha;
}

/**
 * One line that names the gate, the scope and the run, within GitHub's limit. The part that varies
 * (`detail`) is what gets trimmed, never the gate name or the scope.
 * @param {{ lead: string, detail: string, run?: string }} parts @returns {string}
 */
function describe({ lead, detail, run }) {
  const fixed = `${lead} ${QUALIFICATION_GATE} (fleet part only)`;
  const suffix = run ? ` [${run}]` : "";
  const room = DESCRIPTION_LIMIT - fixed.length - suffix.length - " -- ".length;
  const trimmed = detail.length > room ? `${detail.slice(0, Math.max(0, room - 1))}…` : detail;
  return `${fixed}${trimmed ? ` -- ${trimmed}` : ""}${suffix}`.slice(0, DESCRIPTION_LIMIT);
}

/**
 * The exit code a verdict object stands for, or `undefined` if it is not a readable `GateVerdict`.
 * Goes through `exitCodeFor` so the 0/1/2 meaning is stated once, in `verdict.mjs`.
 * @param {{ verdict?: unknown }} candidate @returns {number | undefined}
 */
function codeOfVerdict(candidate) {
  const name = candidate.verdict;
  if (name !== "PASS" && name !== "FAIL" && name !== "INCONCLUSIVE") return undefined;
  return exitCodeFor(/** @type {any} */ (candidate));
}

/**
 * @param {Outcome | undefined} outcome @returns {{ code: number | undefined, detail: string }}
 */
function readOutcome(outcome) {
  if (outcome && "verdict" in outcome && outcome.verdict && typeof outcome.verdict === "object") {
    const why = typeof outcome.verdict.why === "string" ? outcome.verdict.why : "";
    return { code: codeOfVerdict(outcome.verdict), detail: why };
  }
  if (outcome && "exitCode" in outcome && Number.isInteger(outcome.exitCode)) {
    return { code: /** @type {number} */ (outcome.exitCode), detail: "" };
  }
  return { code: undefined, detail: "" };
}

/**
 * The status to post for one moment in a run.
 *
 * @param {{ sha: unknown, outcome?: Outcome, run?: string }} input
 *   `run` names the lab run (the unit and when it ended) so a reader can find it; optional only because a
 *   `pending` post is made before the run has a name worth quoting.
 * @returns {StatusPayload}
 */
export function qualificationStatus({ sha, outcome, run }) {
  requireSha(sha);
  const base = { context: QUALIFICATION_CONTEXT };
  if (outcome && "started" in outcome && outcome.started === true) {
    return { ...base, state: "pending", description: describe({ lead: "running", detail: "", run }) };
  }
  const { code, detail } = readOutcome(outcome);
  if (code === EXIT_PASS) {
    return { ...base, state: "success", description: describe({ lead: "PASS", detail, run }) };
  }
  if (code === EXIT_FAIL) {
    return { ...base, state: "failure", description: describe({ lead: "FAIL", detail, run }) };
  }
  if (code === EXIT_INCONCLUSIVE) {
    return { ...base, state: "failure",
      description: describe({ lead: "INCONCLUSIVE", detail: detail || "could not tell, not a pass", run }) };
  }
  // Missing, unparseable, or an exit code that is none of 0/1/2 (127 is "the job is not wired", a signal
  // is "the job was killed"): none of these is a reading, so none of them may be a `success`.
  const said = code === undefined ? "no readable verdict" : `exit ${code} is not a verdict`;
  return { ...base, state: "failure",
    description: describe({ lead: "NO VERDICT", detail: `${said}, not a pass`, run }) };
}
