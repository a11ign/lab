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
  extractDocumentedJobsBlock, pinActionRef, substituteTarget, extractJobName,
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

// --- buildConsumerGateWorkflow: no double "jobs:" key, references the REAL job name ---

test("buildConsumerGateWorkflow: does not duplicate the jobs: key the extracted block already carries", () => {
  const jobsYaml = "jobs:\n  a11y:\n    runs-on: windows-2022\n    steps:\n      - uses: x/y@z";
  const workflow = buildConsumerGateWorkflow(jobsYaml);
  const jobsKeyCount = (workflow.match(/^jobs:$/gm) ?? []).length;
  assert.equal(jobsKeyCount, 1, "exactly one top-level jobs: key -- MUTATION target for the double-key bug "
    + "this generator shipped with on its first draft");
});

test("buildConsumerGateWorkflow: the verify job's needs: references the job name that was actually extracted", () => {
  const workflow = buildConsumerGateWorkflow(
    "jobs:\n  screen-reader:\n    runs-on: windows-2022\n    steps:\n      - uses: x/y@z");
  assert.match(workflow, /needs: \[screen-reader\]/);
  assert.match(workflow, /needs\.screen-reader\.result/);
});

test("buildConsumerGateWorkflow: adds no permissions: block -- README never mentions one, and the report "
  + "lands in the job summary regardless", () => {
  const workflow = buildConsumerGateWorkflow("jobs:\n  a11y:\n    runs-on: windows-2022\n    steps: []");
  assert.doesNotMatch(workflow, /^permissions:/m);
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
  // A real STEP, not the generator's own header prose (which names "actions/checkout" by name while
  // explaining why this workflow has none) -- a bare substring match on that prose is exactly the false
  // positive this assertion tripped on its first run.
  assert.doesNotMatch(workflow, /- uses: actions\/checkout/,
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
  const stripSha = (t: string) => t.replace(/uses: DanBeckDev\/a11y-witness@\S+/, "uses: DanBeckDev/a11y-witness@<sha>");
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
