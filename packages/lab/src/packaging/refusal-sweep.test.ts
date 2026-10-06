/**
 * #2940 (finishing #2823's sweep): A REFUSAL THAT SAYS "TELL X" REACHES X ONLY IF SOMETHING DELIVERS IT.
 *
 * A line of tool output that tells a session, or the chairman, to do something is a wait written as prose, and
 * `waiting-conditions.md` says nothing in this org reads comments. #2823 swept the files the WORKFLOWS run for
 * the verbs `tell|ask|route to|send to|message` followed straight away by a session name, found nothing, and
 * was wrong twice over: a refusal printed by a tool a SESSION runs (`fleet-status.mjs`, `fleet-playbook.mjs`) was
 * never in its scope, and `Report it to the chairman` / `tell the chairman by another route` matched none of
 * its grammar. Both are fixtures below, verbatim as they read before this row, so the scanner is shown to FIND
 * the lines it once missed.
 *
 * LIFTED OUT of `work-gate.test.ts`, whose import closure needs `history`, which the acceptance job lacks: a
 * test command naming that file is refused there. This file imports nothing from `work-gate.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toolPath } from "../../../../scripts/agent-org-newest-tag.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

// ---- the grammar -------------------------------------------------------------------------------------------------

const SESSION_NAME = "(?:product-manager|orchestrator|ceo|chairman|reviewer(?:-\\d+|-<n>)?|worker-(?:\\d+|<n>))";
const TELLING_VERB = "(?:report(?:s|ed|ing)?|tell(?:s|ing)?|told|ask(?:s|ed|ing)?|escalat(?:e|es|ed|ing)|rout(?:e|es|ed|ing)"
  + "|send(?:s|ing)?|sent|messag(?:e|es|ed|ing)|notif(?:y|ies|ied|ying)|go(?:es|ing)?)";
/** A verb, then what a sentence puts between it and the one told: "it/them/this", "to", "the", a backtick. */
const SESSION_NAMING_REFUSAL = new RegExp(
  "\\b" + TELLING_VERB + "\\s+(?:(?:it|them|this|that|these|those)\\s+)?(?:to\\s+)?(?:the\\s+)?`?" + SESSION_NAME + "\\b", "i");

/** Every line of `text` that is code or a string, not a comment (a comment never reaches a log), that tells a session. */
function sessionNamingLines(text: string): { line: number; text: string }[] {
  return text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter(({ text: t }) => !/^(\/\/|\*|\/\*|#)/.test(t) && SESSION_NAMING_REFUSAL.test(t));
}

// ---- the scope ---------------------------------------------------------------------------------------------------

const SOURCE_EXTENSION = /\.(?:mjs|js|ts|sh|yml)$/;
const NOT_SOURCE = /(?:\.test\.|[\\/](?:test|tests|fixtures?|node_modules|dist)[\\/])/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Files the workflows run directly: `node <file>` / `tsx <file>`, wherever they live. */
function workflowRunScripts(): string[] {
  const scripts = new Set<string>();
  for (const w of readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"))) {
    for (const m of readFileSync(join(WORKFLOWS_DIR, w), "utf8").matchAll(/\b(?:node|tsx)\s+([\w./-]+\.(?:mjs|ts))/g)) {
      if (existsSync(join(REPO_ROOT, m[1]))) scripts.add(join(REPO_ROOT, m[1]));
    }
  }
  return [...scripts];
}

/**
 * EVERY non-test source that can emit a refusal: `packages/<p>/src`, `packages/<p>/scripts`, `scripts/`, the workflows, and
 * whatever the workflows run. #2823's scope was the last two alone, which is why a tool a session runs was never read.
 */
function refusalSourceFiles(): string[] {
  const packages = readdirSync(join(REPO_ROOT, "packages")).flatMap((p) =>
    [join(REPO_ROOT, "packages", p, "src"), join(REPO_ROOT, "packages", p, "scripts")]);
  const files = [...packages, join(REPO_ROOT, "scripts"), WORKFLOWS_DIR].flatMap(walk).concat(workflowRunScripts());
  return [...new Set(files)].filter((f) => SOURCE_EXTENSION.test(f) && !NOT_SOURCE.test(relative(REPO_ROOT, f)));
}

function readLines(files: string[]): { file: string; text: string }[] {
  return files.map((f) => ({ file: relative(REPO_ROOT, f), text: readFileSync(f, "utf8") }));
}

/** `file:text` for every telling line in `sources`. */
function hitsIn(sources: { file: string; text: string }[]): string[] {
  return sources.flatMap(({ file, text }) => sessionNamingLines(text).map((h) => `${file}:${h.text}`));
}

// ---- the accounting ----------------------------------------------------------------------------------------------

/** `file:phrase` -> the gate cause that wakes that session for it. A refusal on this list has an owner the org WILL wake. */
const MAPPED_TO_A_CAUSE: Record<string, string> = {};
/**
 * SHRINK-ONLY: `file:phrase` -> why no delivery is owed. Adding one is a decision, and `EXEMPT_CEILING` is pinned to this
 * list's length so that growing it shows in the diff as a raised number, and shrinking it lowers one.
 */
const EXEMPT_WITH_A_REASON: Record<string, string> = {};
const EXEMPT_CEILING = 0;

const isAccounted = (hit: string, key: string) => hit.startsWith(key.split(":")[0] + ":") && hit.includes(key.split(":").slice(1).join(":"));

/** The hits nobody owns: neither mapped to a cause nor exempt. */
function unaccounted(hits: string[], keys: string[]): string[] {
  return hits.filter((hit) => !keys.some((key) => isAccounted(hit, key)));
}

/** What is wrong with an exemption map: a reason too short to be one. */
function reasonProblems(exempt: Record<string, string>): string[] {
  return Object.entries(exempt).filter(([, why]) => why.trim().length <= 20).map(([key]) => `${key} needs a reason`);
}

/**
 * What is wrong with a mapping: a cause the gate does not declare. READ AS TEXT from `cause-declaration.mjs` in the installed
 * tool (reached by path), never imported.
 */
const DECLARED_CAUSES_SOURCE = readFileSync(toolPath("src/cause-declaration.mjs"), "utf8");
function causeProblems(mapped: Record<string, string>): string[] {
  return Object.entries(mapped).filter(([, cause]) => !DECLARED_CAUSES_SOURCE.includes(`"${cause}"`))
    .map(([key, cause]) => `${key} -> ${cause} is not a declared cause`);
}

// ---- the positive controls ---------------------------------------------------------------------------------------

test("#2940: the scanner FINDS the wordings #2823's grammar missed, verbatim as they read before this row", () => {
  const before = [
    "  OFF it is a walk to the machine. Report it to the chairman by inventory name before anything else is tried.",
    "      + \"IF YOUR OWN SHELL IS FAILING WITH ENOSPC you cannot fix this from here: tell the chairman by another \"",
    "    \"  An OFF box goes to the chairman by inventory name before anything else is tried on it; one\",",
    "  \"  Tell `product-manager`: GitHub resolved no closing reference for any recent PR.\",",
  ];
  for (const line of before) assert.equal(sessionNamingLines(line).length, 1, line);
});

test("#2940: every telling verb, with and without the words a sentence puts between it and the session", () => {
  for (const verb of ["report", "tell", "ask", "escalate", "route", "send", "message", "notify", "Notified", "escalated", "routed", "sent"]) {
    for (const rest of ["ceo", "`product-manager`", "to orchestrator", "it to the chairman", "them to `ceo`", "the chairman", "worker-12", "reviewer-<n>"]) {
      assert.equal(sessionNamingLines(`console.log("${verb} ${rest}");`).length, 1, `${verb} ${rest}`);
    }
  }
  assert.equal(sessionNamingLines("console.log(\"the box goes to the chairman\")").length, 1);
});

test("#2940: a comment is not a refusal, and naming a session is not telling it", () => {
  for (const line of ["// Tell `product-manager` -- a comment reaches no log", " * Report it to the chairman", "# ask ceo"]) {
    assert.equal(sessionNamingLines(line).length, 0, line);
  }
  for (const line of ["console.log('the ceo ruled it')", "const orchestrator = 1;", "console.log('reviewer-3 approved')"]) {
    assert.equal(sessionNamingLines(line).length, 0, line);
  }
});

test("#2940: the scope reaches the tools a SESSION runs, not only the files a workflow runs", () => {
  const files = refusalSourceFiles().map((f) => relative(REPO_ROOT, f));
  assert.ok(files.length > 300, "the population is real");
  for (const must of ["packages/control/src/fleet-status.mjs", "packages/control/src/fleet-playbook.mjs"]) {
    assert.ok(files.includes(must), `${must} is in the walk`);
  }
  assert.ok(files.some((f) => f.startsWith(".github/workflows/")), "and the workflows still are");
  assert.ok(!files.some((f) => /\.test\./.test(f)), "no test file is a refusal");
});

// ---- the sweep ---------------------------------------------------------------------------------------------------

test("#2940 sweep: every refusal that tells a session or the chairman is mapped to a cause or exempt with a reason", () => {
  const sources = readLines(refusalSourceFiles());
  assert.ok(sources.reduce((n, s) => n + s.text.split("\n").length, 0) > 50_000, "the scan reads a real population of lines");
  const hits = hitsIn(sources);
  const keys = [...Object.keys(MAPPED_TO_A_CAUSE), ...Object.keys(EXEMPT_WITH_A_REASON)];
  assert.deepEqual(unaccounted(hits, keys), [],
    "a refusal nobody is woken by is a wait written as prose: wire it to a delivery that exists, or exempt it with a reason");
  for (const key of keys) assert.ok(hits.some((hit) => isAccounted(hit, key)), `${key} is stale: no refusal says it any more`);
});

test("#2940 sweep: a planted new \"Tell `product-manager` ...\" in a tool file makes it red, and an exemption makes it green again", () => {
  const planted = [{ file: "packages/control/src/fleet-status.mjs", text: "  \"  Tell `product-manager` the box is off.\"," }];
  const hits = hitsIn(planted);
  assert.equal(unaccounted(hits, Object.keys(EXEMPT_WITH_A_REASON)).length, 1);
  assert.equal(unaccounted(hits, ["packages/control/src/fleet-status.mjs:Tell `product-manager` the box"]).length, 0, "the control for the red above");
  assert.equal(unaccounted(hits, ["packages/control/src/fleet-playbook.mjs:Tell `product-manager` the box"]).length, 1,
    "an exemption for a DIFFERENT file does not cover it");
});

test("#2940 sweep: an exemption with no reason is refused, and a mapping to an undeclared cause is refused", () => {
  assert.deepEqual(reasonProblems({ "a.mjs:tell ceo": "" }), ["a.mjs:tell ceo needs a reason"]);
  assert.deepEqual(reasonProblems({ "a.mjs:tell ceo": "too short" }), ["a.mjs:tell ceo needs a reason"]);
  assert.deepEqual(reasonProblems(EXEMPT_WITH_A_REASON), [], "the real list passes the check the planted ones fail");
  assert.deepEqual(causeProblems({ "a.mjs:tell ceo": "no-such-cause" }), ["a.mjs:tell ceo -> no-such-cause is not a declared cause"]);
  assert.deepEqual(causeProblems({ "a.mjs:tell ceo": "closes-unresolved-repo-wide" }), [], "the control: a real cause is accepted");
  assert.deepEqual(causeProblems(MAPPED_TO_A_CAUSE), []);
});

test("#2940 sweep: the exemption ceiling only moves down, because it is pinned to the list and not above it", () => {
  assert.equal(Object.keys(EXEMPT_WITH_A_REASON).length, EXEMPT_CEILING,
    "adding an exemption raises this number, and a reviewer sees it; removing one must lower it");
});
