/**
 * #494: `action-smoke` is green and could never have caught #491/#492/#493 -- it runs `uses: ./` with
 * full repository knowledge, needs no `actions/checkout`, and never reads the public documents. This
 * tests the generator that builds a CONSUMER-shaped gate instead: its steps are extracted verbatim from
 * README.md's own Quickstart fence, not hand-retyped, so a defect in the documented workflow (a missing
 * checkout step, a broken build on the specified runner) reaches the gate the same way it reaches a
 * reader.
 *
 * See scripts/generate-consumer-gate.mjs's own header for the full derivation, including why the action
 * reference is pinned as a literal sha (baked in at generation time) rather than an expression --
 * `uses:` steps do not accept `${{ }}` at all, verified with `actionlint` before relying on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  extractDocumentedJobsBlock, pinActionRef, substituteTarget, extractJobName, extractPinnedSha,
  buildConsumerGateWorkflow, generate, currentHeadSha, README_PATH, OUT,
} from "../../../../scripts/generate-consumer-gate.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

// --- extractDocumentedJobsBlock: finds the RIGHT fence, not just any yaml fence ---

test("extractDocumentedJobsBlock: finds the fence containing the action reference among several yaml blocks", () => {
  const markdown = [
    "some prose",
    "```yaml",
    "unrelated: example",
    "```",
    "more prose",
    "```yaml",
    "jobs:",
    "  a11y:",
    "    steps:",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
    "```",
  ].join("\n");
  const block = extractDocumentedJobsBlock(markdown);
  assert.match(block, /uses: DanBeckDev\/a11y-witness@main/);
  assert.doesNotMatch(block, /unrelated: example/);
});

test("extractDocumentedJobsBlock: refuses rather than returning nothing when no matching fence exists", () => {
  assert.throws(() => extractDocumentedJobsBlock("# no yaml fences here at all"),
    /no ```yaml fence/);
});

// --- #796: a fence carrying its OWN on:/name: silently dropped check-pin -- reproduced from the real
// mistake (README.md briefly carried `on: pull_request` above its own `jobs:` line) rather than invented ---

test("extractDocumentedJobsBlock: REFUSES a fence carrying its own top-level `on:` -- #796's own mistake, "
  + "used as the fixture", () => {
  const markdown = [
    "```yaml",
    "on: pull_request",
    "jobs:",
    "  a11y:",
    "    runs-on: windows-2022",
    "    steps:",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
    "```",
  ].join("\n");
  assert.throws(() => extractDocumentedJobsBlock(markdown), /top-level "on:" key/);
});

test("extractDocumentedJobsBlock: REFUSES a fence carrying its own top-level `name:`, the sibling key "
  + "buildWorkflowHeader also wraps", () => {
  const markdown = [
    "```yaml",
    "name: accessibility",
    "jobs:",
    "  a11y:",
    "    runs-on: windows-2022",
    "    steps:",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
    "```",
  ].join("\n");
  assert.throws(() => extractDocumentedJobsBlock(markdown), /top-level "name:" key/);
});

test("MUTATION TARGET: without the refusal, the exact #796 shape silently drops check-pin rather than "
  + "erroring -- proving the guard, not just its message, is load-bearing", () => {
  // Bypasses extractDocumentedJobsBlock's new check entirely, going straight to the splice it protects --
  // this is what shipped, unguarded, until #796.
  const jobsYaml = "on: pull_request\njobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n" + PINNED_STEP;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  assert.doesNotMatch(workflow, /check-pin:/,
    "this assertion documents the BUG buildConsumerGateWorkflow still has in isolation -- the real "
    + "protection is extractDocumentedJobsBlock refusing before this function is ever called, verified "
    + "by the two REFUSES tests above");
});

// --- pinActionRef: touches ONLY the a11y-witness uses: line ---

test("pinActionRef: pins the a11y-witness ref and leaves other uses: lines (e.g. actions/checkout) untouched", () => {
  const yaml = [
    "jobs:",
    "  a11y:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com",
  ].join("\n");
  const pinned = pinActionRef(yaml, "deadbeef1234567890deadbeef1234567890dead");
  assert.match(pinned, /uses: DanBeckDev\/a11y-witness@deadbeef1234567890deadbeef1234567890dead/);
  assert.match(pinned, /uses: actions\/checkout@v4/, "the checkout step's own ref must not be touched");
});

test("pinActionRef: refuses rather than silently doing nothing when no a11y-witness uses: line exists", () => {
  assert.throws(() => pinActionRef("jobs:\n  a11y:\n    steps:\n      - uses: actions/checkout@v4", "deadbeef"),
    /no "uses: DanBeckDev\/a11y-witness@<ref>" line/);
});

// --- substituteTarget: VALUES only, every key/line/indent preserved ---

test("substituteTarget: replaces url/task VALUES only, preserving every other line and indentation", () => {
  const yaml = [
    "jobs:",
    "  a11y:",
    "    runs-on: windows-2022",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
  ].join("\n");
  const out = substituteTarget(yaml, { url: "https://real.example/page", task: "Do the thing" });
  assert.match(out, /^ {10}url: https:\/\/real\.example\/page$/m);
  assert.match(out, /^ {10}task: Do the thing$/m);
  assert.match(out, /uses: actions\/checkout@v4/, "the checkout step must survive untouched");
  assert.match(out, /runs-on: windows-2022/, "runs-on must survive untouched");
});

test("substituteTarget: refuses rather than silently no-op when there is no url: line to substitute", () => {
  assert.throws(() => substituteTarget("jobs:\n  a11y:\n    steps: []", { url: "x", task: "y" }),
    /no "url:" line/);
});

// --- extractJobName: read, not assumed ---

test("extractJobName: reads the job key under jobs:, whatever it is named", () => {
  assert.equal(extractJobName("jobs:\n  screen-reader:\n    runs-on: windows-2022"), "screen-reader");
});

test("extractJobName: refuses rather than guessing when jobs: has no job key on the expected line", () => {
  assert.throws(() => extractJobName("not-jobs: true"), /no job key/);
});

// --- extractPinnedSha: read back from the already-pinned uses: line ---

test("extractPinnedSha: reads the sha pinActionRef already baked in", () => {
  const jobsYaml = "jobs:\n  a11y:\n    steps:\n      - uses: DanBeckDev/a11y-witness@deadbeef1234567890deadbeef1234567890dead";
  assert.equal(extractPinnedSha(jobsYaml), "deadbeef1234567890deadbeef1234567890dead");
});

test("extractPinnedSha: refuses rather than returning undefined when there is no uses: line to read at all", () => {
  assert.throws(() => extractPinnedSha("jobs:\n  a11y:\n    steps:\n      - uses: actions/checkout@v4"),
    /pinActionRef may not have run yet/);
});

// --- buildConsumerGateWorkflow: no double "jobs:" key, references the REAL job name ---

const PINNED_STEP = "      - uses: DanBeckDev/a11y-witness@deadbeef1234567890deadbeef1234567890dead";

test("buildConsumerGateWorkflow: does not duplicate the jobs: key the extracted block already carries", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  const jobsKeyCount = (workflow.match(/^jobs:$/gm) ?? []).length;
  assert.equal(jobsKeyCount, 1, "exactly one top-level jobs: key -- MUTATION target for the double-key bug "
    + "this generator shipped with on its first draft");
});

test("buildConsumerGateWorkflow: the verify job's needs: references the job name that was actually extracted", () => {
  const workflow = buildConsumerGateWorkflow(
    `jobs:\n  screen-reader:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`);
  assert.match(workflow, /needs: \[screen-reader\]/);
  assert.match(workflow, /needs\.screen-reader\.result/);
});

test("buildConsumerGateWorkflow: adds no permissions: block -- README never mentions one, and the report "
  + "lands in the job summary regardless", () => {
  const workflow = buildConsumerGateWorkflow(`jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`);
  assert.doesNotMatch(workflow, /^permissions:/m);
});

// --- #558: check-pin gates the extracted job, without touching its own steps ---

test("buildConsumerGateWorkflow: adds a check-pin job that the extracted job needs, "
  + "without touching the extracted job's own steps", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  assert.match(workflow, /^ {2}check-pin:$/m);
  assert.match(workflow, /needs: \[check-pin\]/);
  // The extracted step itself is untouched -- rule #1's "nothing added the document does not give" is
  // about what a reader would copy, and check-pin/needs: are job-level orchestration, not a step.
  assert.match(workflow, new RegExp(PINNED_STEP.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildConsumerGateWorkflow: check-pin's ancestor check names the SAME sha pinned in the "
  + "extracted job's own uses: line -- MUTATION target for the two shas independently drifting", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  const pinnedInStep = extractPinnedSha(workflow);
  assert.match(workflow, new RegExp(`merge-base --is-ancestor ${pinnedInStep} "\\$\\{\\{ github\\.sha \\}\\}"`));
});

test("buildConsumerGateWorkflow: check-pin checks ANCESTRY, not exact equality against github.sha -- "
  + "exact equality has the identical unsatisfiable shape --check's old sha comparison did (regenerate "
  + "at commit A, commit that regeneration as B, and github.sha is always B while the pin always names "
  + "A) -- MUTATION target for someone re-introducing that comparison", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  assert.doesNotMatch(workflow, /\{\{ github\.sha \}\}"\s*!=/,
    "check-pin must not compare github.sha for exact equality against the pin");
  assert.match(workflow, /git merge-base --is-ancestor/,
    "check-pin must ask whether the pin is an ancestor of github.sha, which a regenerate-then-commit "
    + "sequence can actually satisfy");
  assert.match(workflow, /git diff --name-only/,
    "check-pin must also confirm nothing that would change the generated output has landed since the pin");
});

test("buildConsumerGateWorkflow: check-pin's refusal names the ref and how the run was triggered, "
  + "not just the two shas -- a bare mismatch cannot tell a stale pin from a dispatch against an "
  + "unexpected ref", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  assert.match(workflow, /github\.ref_name/);
  assert.match(workflow, /github\.event_name/);
});

test("buildConsumerGateWorkflow: check-pin runs on ubuntu-latest, not windows-2022 -- "
  + "a stale pin must fail cheaply, before the Windows job it gates ever starts", () => {
  const jobsYaml = `jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n${PINNED_STEP}`;
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  const checkPinBlock = workflow.slice(workflow.indexOf("  check-pin:"), workflow.indexOf("  a11y:"));
  assert.match(checkPinBlock, /runs-on: ubuntu-latest/);
});

// --- THE CORE PROPERTY: nothing is added the document does not give ---

test("MUTATION-SHAPED: a documented workflow with NO checkout step generates a gate with none -- "
  + "this is #491's own defect (README.md itself carried no checkout step until that fix landed), and "
  + "the generator must remain ABLE to reproduce it rather than silently helping", () => {
  const withoutCheckout = [
    "jobs:",
    "  a11y:",
    "    runs-on: windows-2022",
    "    steps:",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
  ].join("\n");
  const workflow = generate(
    `\`\`\`yaml\n${withoutCheckout}\n\`\`\`\n`, "deadbeef1234567890deadbeef1234567890dead");
  // SCOPED TO THE a11y JOB'S OWN REGION, not the whole file -- #558's check-pin legitimately carries its
  // own `actions/checkout` (generator-added infrastructure, never something a reader copies), and a
  // whole-file match on this assertion's first run after #558 landed matched THAT checkout instead of
  // proving anything about the extracted a11y job. Also not the generator's own header prose (which names
  // "actions/checkout" by name while explaining why the a11y job has none) -- a bare substring match on
  // that prose is the false positive this assertion originally tripped on.
  const a11yBlock = workflow.slice(workflow.indexOf("\n  a11y:\n"), workflow.indexOf("\n  verify-report:\n"));
  assert.doesNotMatch(a11yBlock, /- uses: actions\/checkout/,
    "the generator must not silently ADD a checkout step the document never showed -- doing so would be "
    + "action-smoke with more steps, exactly what #494 exists to not be");
});

test("CONTROL: a documented workflow WITH a checkout step generates a gate that keeps it", () => {
  const withCheckout = [
    "jobs:",
    "  a11y:",
    "    runs-on: windows-2022",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: DanBeckDev/a11y-witness@main",
    "        with:",
    "          url: https://example.com/checkout",
    "          task: Complete the checkout",
  ].join("\n");
  const workflow = generate(`\`\`\`yaml\n${withCheckout}\n\`\`\`\n`, "deadbeef1234567890deadbeef1234567890dead");
  assert.match(workflow, /uses: actions\/checkout@v4/,
    "the generator must not silently DROP a checkout step the document DOES show");
});

// --- currentHeadSha: real git, not a fixture ---

test("currentHeadSha: returns a real, full 40-character commit sha for this checkout", () => {
  const sha = currentHeadSha();
  assert.match(sha, /^[0-9a-f]{40}$/);
  const real = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  assert.equal(sha, real);
});

// --- the checked-in file must match what generating from the CURRENT README produces ---

test("the committed .github/workflows/consumer-gate.yml matches what README.md generates today "
  + "(sha aside -- regenerating after this commit lands is expected, not a drift)", () => {
  const readme = readFileSync(README_PATH, "utf8");
  const generated = generate(readme, currentHeadSha());
  const committed = readFileSync(OUT, "utf8");
  const stripSha = (t: string) => t.replaceAll(/\b[0-9a-f]{40}\b/g, "<sha>");
  assert.equal(stripSha(committed), stripSha(generated),
    "run `node scripts/run.mjs consumer-gate` and commit the result -- README.md's Quickstart fence has "
    + "changed since this file was last generated");
});

// --- the CLI, guarded like every other argv-reading script here ---

test("generate-consumer-gate.mjs refuses an unknown flag rather than silently ignoring it", () => {
  const script = fileURLToPath(new URL("../../../../scripts/generate-consumer-gate.mjs", import.meta.url));
  let threw = false;
  try {
    execFileSync("node", [script, "--bogus"], { encoding: "utf8", stdio: "pipe" });
  } catch (cause) {
    threw = true;
    const err = cause as { status?: number, stderr?: string };
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), /unknown flag --bogus/);
  }
  assert.ok(threw, "an unknown flag must exit non-zero, not silently run the default");
});
