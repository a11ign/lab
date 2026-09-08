/**
 * A JOB THAT READS THE PR BODY MUST RUN WHEN THE BODY CHANGES — DERIVED, NEVER A LITERAL PIN.
 *
 * Measured 2026-09-07: unit 2's `acceptance` job (#353) reads `github.event.pull_request.body`, and
 * `ci.yml` carried GitHub's default `pull_request` types — `opened, synchronize, reopened`. **`edited` is
 * not among them.** So a PR whose only defect was its body — a prose `Acceptance:` line bash cannot run,
 * or no line at all — could not be fixed at all: editing the body fired nothing, and the job kept
 * reporting the body it had read at open time.
 *
 * Zero merges between 13:38Z and 21:10Z. Every `ci.yml` run red on `acceptance`. Eight open PRs, five of
 * them written before the field existed. The gate was correct and there was no way to satisfy it.
 *
 * **The general shape: a job that reads an input no trigger watches cannot be fixed by the person holding
 * the input.** It costs a whole queue rather than one PR, and it is invisible from inside any single PR —
 * from there it looks like a stubborn check.
 *
 * So this DISCOVERS the jobs that read the body rather than naming `acceptance`. A second such job added
 * to a workflow whose triggers do not include `edited` fails here, which a test naming today's one job
 * could never do — the same reason `busy-worker-guard.test.ts` discovers playbooks and
 * `worker-code-check.test.ts` discovers capture clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const WORKFLOWS = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));

type Job = {
  steps?: { env?: Record<string, string>; run?: string; with?: Record<string, string> }[];
  // A1 (#452): a job calling a REUSABLE WORKFLOW has no `steps` of its own -- its `with:` sits at the JOB
  // level instead, one per `workflow_call` input. `ci.yml#acceptance` reads the body this way now
  // (`with: { pr-body: ${{ github.event.pull_request.body }} }`), and a discovery that only looked inside
  // `steps` would find NOTHING here -- the exact "asserting over an empty set" shape this file's own
  // header already warns about, reached through a door that did not exist when it was written.
  with?: Record<string, string>;
};
type Workflow = { on?: Record<string, { types?: string[] }>; jobs?: Record<string, Job> };

const workflowFiles = () => readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));

/** Every `<file>#<job>` whose steps OR job-level `with:` (a reusable-workflow call) reference the pull
 * request's body in any position. */
function jobsReadingTheBody(): { file: string; job: string }[] {
  const found: { file: string; job: string }[] = [];
  for (const file of workflowFiles()) {
    const doc = parseYaml(readFileSync(`${WORKFLOWS}${file}`, "utf8")) as Workflow;
    for (const [job, definition] of Object.entries(doc.jobs ?? {})) {
      const surfaces = [
        ...Object.values(definition.with ?? {}),
        ...(definition.steps ?? []).flatMap((s) => [
          ...Object.values(s.env ?? {}), ...Object.values(s.with ?? {}), s.run ?? "",
        ]),
      ];
      // `event.pull_request.body`, and the `body` a `github-script` step would read the same way.
      if (surfaces.some((v) => /pull_request\s*\.\s*body/.test(String(v)))) found.push({ file, job });
    }
  }
  return found;
}

test("the discovery finds a real job, so this cannot pass having examined nothing", () => {
  const found = jobsReadingTheBody();
  assert.ok(found.length >= 1,
    "no workflow job reads the PR body. Either the acceptance job (#353) is gone — in which case this "
    + "test should go with it — or the discovery has stopped matching and is now asserting over an empty "
    + "set, which is the defect it exists to prevent.");
  assert.ok(found.some((f) => f.file === "ci.yml" && f.job === "acceptance"),
    `expected ci.yml#acceptance among ${JSON.stringify(found)}`);
});

test("every workflow with a body-reading job triggers on `edited`", () => {
  const offenders: string[] = [];
  for (const { file, job } of jobsReadingTheBody()) {
    const doc = parseYaml(readFileSync(`${WORKFLOWS}${file}`, "utf8")) as Workflow;
    const types = doc.on?.pull_request?.types;
    if (!Array.isArray(types) || !types.includes("edited")) offenders.push(`${file}#${job}`);
  }
  assert.deepEqual(offenders, [],
    "these jobs read the PR body, and their workflow does not run when the body is edited. An author "
    + "whose only defect is their body then has no way to make the check re-read it: on 2026-09-07 that "
    + "held the whole queue for eight hours with zero merges. Add `edited` to the workflow's "
    + "`pull_request.types`.");
});

test("naming `edited` does not silently drop the defaults", () => {
  // `types:` REPLACES the default list rather than extending it, so writing `types: [edited]` alone would
  // stop CI running on a push — a far worse failure, arriving through the fix for this one.
  const doc = parseYaml(readFileSync(`${WORKFLOWS}ci.yml`, "utf8")) as Workflow;
  const types = doc.on?.pull_request?.types ?? [];
  for (const required of ["opened", "synchronize", "reopened"]) {
    assert.ok(types.includes(required),
      `\`types:\` replaces GitHub's defaults rather than adding to them, so \`${required}\` must be `
      + `listed explicitly. Without \`synchronize\`, CI would stop running on a push.`);
  }
});
