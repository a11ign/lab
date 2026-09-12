/**
 * #575: `decideRevert` MUST OPEN ITS REVERT PR WITH A TOKEN THAT CAN OPEN ONE, AND WHOSE EVENTS FIRE.
 *
 * Measured on run 34275102543 -- the first run in which this job ever reached its READY path, after A1
 * fixed the implicit `success()` that had skipped it on 6 of 6 real trunkGate failures. It decided
 * correctly, cut `revert/4e87c87565-316`, pushed it, and died on the last call of the last step:
 *
 *     pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull
 *     requests (createPullRequest)
 *
 * TWO INDEPENDENT REASONS FOR THE PAT, and this file asserts the fix rather than either symptom, because
 * each reason alone is sufficient and fixing only the visible one produces a WORSE failure:
 *
 *  1. That message is a REPOSITORY setting, confirmed from the API rather than inferred --
 *     `actions/permissions/workflow` answers `can_approve_pull_request_reviews: false` -- and it blocks
 *     `GITHUB_TOKEN` REGARDLESS of the job's `permissions:` block, which already granted
 *     `pull-requests: write` on that very run. So the obvious remedy adds a scope that is already there.
 *  2. A PR created with `GITHUB_TOKEN` fires no `pull_request` event (#416's own measurement, 37 data
 *     points). `gate` would never run on the revert PR and `auto-arm` would never arm it, so the revert
 *     would sit unmergeable with no checks -- which looks like success from every angle but the one that
 *     matters. Flipping the repository setting alone would produce exactly that.
 *
 * A SEPARATE FILE FROM `auto-arm-token.test.ts` ON PURPOSE. That file's own header records why it is
 * scoped to two named jobs and not to a whole workflow: a third job in the same file falls back for a
 * DIFFERENT reason, and a whole-file regex would have coupled its assertions to a job it is not about.
 * The same argument applies across files -- this job's warning names what IT loses, not what auto-arm
 * loses, and the two must be free to diverge.
 *
 * NOT ASSERTED HERE, deliberately: that the credential works. That is only knowable by execution, and
 * #575's acceptance is a `workflow_dispatch` against a commit whose gate failed, read for a created PR
 * URL. A guard that has never been shown to complete is not a verified guard, and this one has now been
 * shown to complete every step but the last.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/trunk.yml`;
const JOB = "decideRevert";

type Step = { env?: Record<string, string>, run?: string };
type Doc = { jobs: Record<string, { permissions?: Record<string, string>, steps: Step[] }> };

const doc = (): Doc => parseYaml(readFileSync(WORKFLOW, "utf8")) as Doc;
const steps = (d: Doc): Step[] => d.jobs[JOB]?.steps ?? [];
const runText = (d: Doc): string => steps(d).map((s) => s.run ?? "").join("\n");

// ANTI-VACUITY. Every assertion below reads a job out of a parsed document by name, and a renamed job, a
// moved file or a parse that silently yields nothing would make each of them examine an empty set and
// pass. This repo's own recorded defect -- a scrape that matched nothing, so the test asserted over an
// empty set and passed -- and the reason `gh-token-jobs.test.ts` carries the same guard.
test("the job and its steps are actually found -- a rename must fail this file, never empty it", () => {
  assert.ok(doc().jobs[JOB], `${JOB} not found in ${WORKFLOW} -- if it was renamed, update this file`);
  assert.ok(steps(doc()).length >= 2, "expected a checkout plus at least the revert step");
  assert.match(runText(doc()), /trunk-revert\.mjs/, "the revert step must still invoke the script");
});

test("the revert step reads A11IGN_BOT_TOKEN through an env: mapping, never as a CLI argument", () => {
  const withToken = steps(doc()).find((s) => s.env?.A11IGN_BOT_TOKEN === "${{ secrets.A11IGN_BOT_TOKEN }}");
  assert.ok(withToken, `${JOB} must read secrets.A11IGN_BOT_TOKEN through an env: mapping`);
  assert.ok(!(withToken?.run ?? "").includes("secrets.A11IGN_BOT_TOKEN"),
    "the run: script must never reference the secret directly -- only through the env var it was mapped "
    + "into, or the value risks appearing on a command line a log could capture");
});

test("MUTATION TARGET: the step BRANCHES on whether the token is set -- a present secret is used, not "
  + "merely read and ignored", () => {
  const branches = [...runText(doc()).matchAll(/if \[ -n "\$A11IGN_BOT_TOKEN" \]/g)];
  assert.equal(branches.length, 1, `expected exactly one such conditional in ${JOB}, found ${branches.length}`);
});

test("the fallback FALLS BACK rather than refusing -- the decision and the branch push are worth having "
  + "without the credential; only the PR is not", () => {
  const text = runText(doc());
  assert.match(text, /export GH_TOKEN="\$FALLBACK_TOKEN"/,
    "the else branch must still set a token and continue: refusing here throws away a correct verdict "
    + "over a missing credential");
  assert.ok(!/\bexit 1\b/.test(text.split("fi")[0] ?? ""),
    "the token selection must not exit non-zero -- the step runs under `bash -e`");
});

test("the fallback warning names what THIS job loses, so the path it took is on the record", () => {
  const warnings = [...runText(doc()).matchAll(/::warning::A11IGN_BOT_TOKEN is not set[^\n]*/g)];
  assert.equal(warnings.length, 1, `${JOB} must print exactly one fallback warning`);
  const [[warning]] = warnings;
  assert.match(warning, /pull request/i, "name the refusal this job will hit");
  assert.match(warning, /#575/, "cite the row, so the next reader can find the measurement");
});

test("the fallback token is github.token, never hard-coded and never absent", () => {
  const withToken = steps(doc()).find((s) => s.env?.A11IGN_BOT_TOKEN);
  assert.equal(withToken?.env?.FALLBACK_TOKEN, "${{ github.token }}");
});

test("the permissions block stays -- it is NOT what was wrong, and dropping it would break the git push", () => {
  const perms = doc().jobs[JOB]?.permissions ?? {};
  assert.equal(perms["contents"], "write", "the branch push needs contents: write");
  assert.equal(perms["pull-requests"], "write", "kept: it is necessary for the PAT path and was never the fault");
});
