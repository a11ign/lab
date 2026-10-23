/**
 * EVERY SCRIPT A MANIFEST SCRIPT OR A WORKFLOW STEP RUNS BY NAME IS A SCRIPT THE MANIFEST HAS (a11ign/a11ign#5185; the core's `package-scripts-resolve.test.ts` is the idea, from #5175/#5087).
 *
 * The core's cut 9 deleted the lab-held scripts and four composites still chained to them, and every guard that read the diff was green: a chain that fails at its third link is not a line
 * the diff touched. The lab had the mirror image, three composites the core's chains used to be that it did not define at all (`release:gate`, `candidate:gate`, `promote:gated`). A missing
 * link is read from the chain here, so it is not a thing a reviewer must remember to run.
 *
 * What is read: the `run` links of every script of the lab's `package.json` (`npm run x`, `pnpm run x`, and `node "$npm_execpath" run x`, which is how a chain reaches pnpm on a host with no
 * `pnpm` on PATH: the lab runs every job as `corepack pnpm run`, #3141), resolved in the manifest that holds the script, and the same links in a workflow step with no `working-directory`.
 * A link that is recursive or filtered (`-r`, `--filter`, `-C`, `--dir`) runs in another manifest and is neither resolved nor guessed at.
 *
 * POSITIVE CONTROL, in this file: the real tree must yield at least FLOOR_OF_LINKS links, among them the three composites' first links, and a planted tree breaks each surface in turn and must
 * be refused naming the caller and the missing script.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { LAB_ROOT } from "../product-checks/lab-sources.ts";

/** The runner, then (group 1) whatever sits between it and `run`, then (group 2) the script. */
const RUN_LINK = /(?:^|[\s'"`(])(?:npm|pnpm|"\$npm_execpath")((?: [^&|;\n'"`]*?)?) run(?:-script)? (?:--silent |-s )?([A-Za-z][\w:.-]*)/g;
/** Words between the runner and `run` that put the script in a manifest other than the one the caller is in. */
const LEAVES_THIS_MANIFEST = /(?:^| )(?:-r|--recursive|-F|--filter|-C|--dir|-w|--workspace-root|exec|dlx)(?: |=|$)/;

type Link = { caller: string; script: string };
type Step = { name?: string; run?: string; "working-directory"?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

/** The scripts a text runs by name, in the manifest it is read from; a link that leaves that manifest is not returned. */
function linksIn(text: string, caller: string): Link[] {
  return [...text.matchAll(RUN_LINK)].filter((m) => !LEAVES_THIS_MANIFEST.test(m[1] ?? "")).map((m) => ({ caller, script: m[2] }));
}

function scriptsOf(root: string): Record<string, string> {
  const path = join(root, "package.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {} : {};
}

/** The links of every workflow step that runs at the root: the file, the job and the step are the caller. */
function workflowLinks(root: string): Link[] {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => /\.ya?ml$/.test(file)).flatMap((file) => {
    const workflow = parseYaml(readFileSync(join(dir, file), "utf8")) as Workflow | null;
    return Object.entries(workflow?.jobs ?? {}).flatMap(([job, { steps }]) => (steps ?? [])
      .filter((step) => typeof step.run === "string" && step["working-directory"] === undefined)
      .flatMap((step) => linksIn(step.run!, `.github/workflows/${file} job ${job}${step.name ? ` step "${step.name}"` : ""}`)));
  });
}

/** Everything a tree runs by name, and every link of it that its manifest does not define: one sentence each. */
function readTree(root: string): { links: Link[]; unresolved: string[] } {
  const scripts = scriptsOf(root);
  const all = [
    ...Object.entries(scripts).flatMap(([name, body]) => linksIn(body, `package.json script ${name}`)),
    ...workflowLinks(root),
  ];
  return {
    links: all,
    unresolved: all.filter((link) => !Object.hasOwn(scripts, link.script))
      .map((link) => `${link.caller} runs \`${link.script}\`, which that manifest does not define`),
  };
}

const FLOOR_OF_LINKS = 20;

test("every script a manifest script or a root workflow step runs by name is one the manifest defines", () => {
  const { links, unresolved } = readTree(LAB_ROOT);
  assert.ok(links.length >= FLOOR_OF_LINKS, `the read found ${links.length} links: it is not reading the manifest`);
  for (const [caller, script] of [["release:gate", "scorer:verify"], ["candidate:gate", "scorer:shortcuts"], ["promote:gated", "candidate:gate"], ["promote:gated", "promote:model"]]) {
    assert.ok(links.some((l) => l.caller === `package.json script ${caller}` && l.script === script),
      `POSITIVE CONTROL: ${caller} must be read as running ${script}, so the check is looking at the composites`);
  }
  assert.deepEqual(unresolved, []);
});

test("the composites end in the lab's own last stage: the gate:core-held refusal is retired (A11-127), so no composite chains to it", () => {
  const scripts = scriptsOf(LAB_ROOT);
  assert.ok(!Object.hasOwn(scripts, "gate:core-held"), "the refusal script is gone");
  assert.match(scripts["release:gate"], /run eval:gate$/);
  assert.match(scripts["candidate:gate"], /run rules:real-pages$/);
  assert.doesNotMatch(JSON.stringify(scripts), /gate:core-held/);
  assert.match(scripts["promote:gated"], /^node "\$npm_execpath" run --silent candidate:gate && node "\$npm_execpath" run --silent promote:model --$/);
});

test("POSITIVE CONTROL: a composite that chains to a missing script and a workflow step that runs one are each REFUSED, naming the caller and the script", () => {
  const root = mkdtempSync(join(tmpdir(), "package-scripts-resolve-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {
    "release:gate": 'node "$npm_execpath" run scorer:verify && node "$npm_execpath" run --silent gate:core-held -- a b',
    "gate:core-held": "node refuse.ts",
    build: 'pnpm -r run build && pnpm --filter inner run elsewhere && node "$npm_execpath" -C inner run elsewhere && pnpm exec tsc',
    prepare: "node hooks.ts && npm run --silent build",
  } }));
  writeFileSync(join(root, ".github/workflows/w.yml"), [
    "jobs:",
    "  a:",
    "    steps:",
    "      - name: gate",
    "        run: pnpm run release:gate && pnpm run lab:job",
    "      - name: elsewhere",
    "        working-directory: core",
    "        run: pnpm run not-at-root",
  ].join("\n"));
  assert.deepEqual(readTree(root).unresolved, [
    "package.json script release:gate runs `scorer:verify`, which that manifest does not define",
    '.github/workflows/w.yml job a step "gate" runs `lab:job`, which that manifest does not define',
  ]);
});
