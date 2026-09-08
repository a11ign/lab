import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * #491: no public document carried an `actions/checkout` step. A reader copying the documented
 * workflow got an empty workspace, and `setup-node` (inside the Action itself) died on "lock file not
 * found" before NVDA or the page was ever reached -- verified live by the #324 rehearsal, a fresh agent
 * following only three of these documents, three times, on a real Windows runner.
 *
 * `action-smoke.yml` could not have caught this: it runs `uses: ./` with the repository already
 * checked out by the surrounding job, so it never needs a checkout step and never reads what these
 * documents actually say to write. `action-reference.test.ts` proves the `uses:` line resolves; this
 * file proves the step BEFORE it exists at all, which that file cannot see -- it only ever looks for
 * the `a11y-witness` reference itself, not what precedes it.
 *
 * DISCOVERED, NOT TYPED. The first version of this file hand-listed three documents. A live review
 * caught the gap the same day: `packages/cli/README.md` carries a fourth genuine `uses:
 * DanBeckDev/a11y-witness` snippet -- also missing the checkout step -- that the hand-written list never
 * saw, the exact "list nobody updates" shape `cli-flags.test.ts` and `git-spawn-classification.test.ts`
 * were built to end. So this walks every `.md` and `.yml` file in the tree and finds every genuine
 * `uses: <owner>/a11y-witness@<ref>` reference itself, rather than trusting anyone to have listed them
 * all -- a fifth document added tomorrow is caught the same way `packages/cli/README.md` was today.
 *
 * `PLAN.md` mentions this Action in historical prose (the wrong-owner-tag incident, the publish-workflow
 * status) with no `uses:` line and no copyable snippet -- the walk correctly finds nothing there, because
 * finding nothing is not the same as not having looked: the vacuity guard below requires the walk to find
 * a NON-EMPTY, EXPECTED population, so a change to the search pattern that stopped matching anything
 * would fail loudly rather than reporting a clean scan of nothing.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING -- fixed after this file fired a false positive on `#530`
 * within fourteen minutes of merging. `.github/workflows/release.yml` carries a `#` comment describing
 * `consumer-gate.yml`'s own pinned reference (`# #494. \`consumer-gate.yml\`'s own \`uses:
 * DanBeckDev/a11y-witness@<sha>\` step is pinned...`), and the unstripped text match read that PROSE as
 * a real step, then compared its (nonexistent) position against the file's real, correctly-placed
 * `actions/checkout@v4`, reporting checkout as "too late" for a step that was never actually there. A
 * comment is not a use -- `git-spawn-classification.test.ts` names the identical shape and the identical
 * fix (strip first) for the identical reason: "a file that only MENTIONS [the thing] in prose has not
 * done it." `@a11ign/evidence/source-text`'s `stripComments` is JS/TS-shaped (`//`, `/* *\/`) and does
 * not touch YAML's `#`, so `stripYamlComments` below is this file's own, deliberately not a parser: a
 * line's own text past an UNQUOTED, whitespace-or-start-preceded `#` is discarded, which is enough to
 * tell a real `uses:` step from a comment describing one and is applied only to the TEXT-matching pass,
 * never to what is handed to the real YAML parser -- `parse()` already understands `#` comments
 * correctly per spec, and re-implementing that risk corrupting a legitimate multi-line scalar.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Directories the walk never descends into -- build output, dependencies, and generated/historical text. */
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "runs", "coverage", ".changeset", ".venv",
]);

/** Every `.md`/`.yml`/`.yaml` file under `root`, skipping the excluded directories. */
function walkDocs(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) found.push(...walkDocs(join(root, entry.name)));
      continue;
    }
    if (/\.(md|ya?ml)$/.test(entry.name)) found.push(join(root, entry.name));
  }
  return found;
}

/** Matches a real `uses:` line naming this Action under any owner -- the reference itself, not a mention. */
const USES_PATTERN = /uses:\s*\S*\/a11y-witness@\S+/;

/**
 * Discard everything from an UNQUOTED `#` onward on each line -- YAML's own comment rule, applied only
 * to decide whether a line is text worth pattern-matching, never to what gets handed to the real parser.
 * Not a full YAML string-quoting implementation: single-quoted `''` (an escaped quote) and double-quoted
 * `\"`/backslash escapes are honoured, which is the one gap that would otherwise let a quoted URL or
 * password containing `#` truncate a genuine line early.
 */
function stripYamlComments(text: string): string {
  return text.split("\n").map(stripYamlLineComment).join("\n");
}

/** One line of `stripYamlComments` -- split out so the quote-tracking loop stays under the depth limit. */
function stripYamlLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inSingle) {
      if (c === "'" && line[i + 1] === "'") i += 1;
      else if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === "\\") i += 1;
      else if (c === "\"") inDouble = false;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === "\"") inDouble = true;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}

/** Every fenced ```yaml block in a markdown file, as raw text. A `.yml` file's whole text is one block. */
function candidateBlocks(file: string, text: string): string[] {
  if (!/\.md$/.test(file)) return [text];
  return [...text.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * The steps array of a parsed block, wherever it lives -- a full workflow nests it under
 * `jobs.<name>.steps`, while `docs/github-action.md`'s excerpt has a bare top-level `steps:` because it
 * is a job BODY rather than a complete workflow. Both are legitimate shapes for a documented snippet.
 */
function stepsOf(parsed: unknown): Step[] | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const doc = parsed as { steps?: Step[]; jobs?: Record<string, { steps?: Step[] }> };
  if (Array.isArray(doc.steps)) return doc.steps;
  for (const job of Object.values(doc.jobs ?? {})) {
    if (Array.isArray(job.steps)) return job.steps;
  }
  return null;
}

/** The block, from a file's candidate blocks, that actually references this Action -- and its steps. */
function actionBlockSteps(file: string, text: string): Step[] | null {
  for (const block of candidateBlocks(file, text)) {
    // Matched against the STRIPPED text, so a comment describing another file's `uses:` line -- #530's
    // exact shape -- is never mistaken for a real one. `block` itself (unstripped) still goes to the
    // real YAML parser below, which already understands `#` comments correctly.
    if (!USES_PATTERN.test(stripYamlComments(block))) continue;
    const steps = stepsOf(parse(block));
    if (steps) return steps;
  }
  return null;
}

/** Every file under the repo carrying a genuine `uses:` reference to this Action, found by walking. */
function documentsReferencingTheAction(): string[] {
  return walkDocs(REPO)
    .filter((file) => USES_PATTERN.test(stripYamlComments(readFileSync(file, "utf8"))))
    .map((file) => relative(REPO, file))
    .sort();
}

test("the vacuity guard: the walk finds a real, non-empty population of documents", () => {
  const found = documentsReferencingTheAction();
  assert.ok(found.length >= 4,
    `found only ${found.length} document(s) referencing this Action (${found.join(", ")}) -- the `
    + "2026-09-08 audit found 5; a shrunk count means the search pattern stopped matching, not that "
    + "the tree needs fewer references fixed");
});

test("every documented workflow snippet checks out the caller's repository before using this Action", () => {
  const missing: string[] = [];
  for (const file of documentsReferencingTheAction()) {
    const text = readFileSync(join(REPO, file), "utf8");
    const steps = actionBlockSteps(file, text);
    if (!steps) {
      missing.push(`${file}: matched the uses: pattern but no parseable steps block was found around it`);
      continue;
    }
    const actionIndex = steps.findIndex((s) => /a11y-witness/.test(s.uses ?? ""));
    const checkoutIndex = steps.findIndex((s) => /^actions\/checkout@/.test(s.uses ?? ""));
    if (checkoutIndex === -1) {
      missing.push(`${file}: no actions/checkout step in the documented workflow`);
    } else if (checkoutIndex > actionIndex) {
      missing.push(`${file}: actions/checkout appears AFTER the a11y-witness step, which is too late -- `
        + "the workspace is still empty when this Action runs");
    }
  }
  assert.deepEqual(missing, [],
    "a reader copying the documented workflow exactly gets an empty workspace, which is #491's own "
    + "finding, reproduced structurally rather than by running a real workflow:\n" + missing.join("\n"));
});

test("MUTATION TARGET: a snippet missing the checkout step is caught, not silently accepted", () => {
  const withoutCheckout = `jobs:\n  a11y:\n    steps:\n      - uses: DanBeckDev/a11y-witness@main\n`
    + "        with:\n          url: https://example.com\n";
  const steps = stepsOf(parse(withoutCheckout));
  assert.ok(steps);
  const hasCheckout = steps!.some((s) => /^actions\/checkout@/.test(s.uses ?? ""));
  assert.equal(hasCheckout, false, "the fixture itself must lack a checkout step, or this proves nothing");
});

test("CONTROL: a snippet with the checkout step first passes the same check", () => {
  const withCheckout = "jobs:\n  a11y:\n    steps:\n      - uses: actions/checkout@v4\n"
    + "      - uses: DanBeckDev/a11y-witness@main\n        with:\n          url: https://example.com\n";
  const steps = stepsOf(parse(withCheckout));
  assert.ok(steps);
  const actionIndex = steps!.findIndex((s) => /a11y-witness/.test(s.uses ?? ""));
  const checkoutIndex = steps!.findIndex((s) => /^actions\/checkout@/.test(s.uses ?? ""));
  assert.ok(checkoutIndex !== -1 && checkoutIndex < actionIndex);
});

test("MUTATION: a uses: line inside a # comment is not mistaken for a real step -- #530's exact shape", () => {
  // The real text from .github/workflows/release.yml on #530's branch: a comment describing a DIFFERENT
  // file's pinned reference, sitting above this file's own real (and correctly ordered) checkout step.
  const commentOnly = "jobs:\n  release:\n    steps:\n"
    + "      # #494. `consumer-gate.yml`'s own `uses: DanBeckDev/a11y-witness@<sha>` step is pinned to a "
    + "LITERAL sha\n"
    + "      - uses: actions/checkout@v4\n"
    + "      - run: npm run build\n";
  const steps = actionBlockSteps("release.yml", commentOnly);
  assert.equal(steps, null,
    "a uses: reference inside a # comment must not register as a real a11y-witness step -- this fixture "
    + "is not a documented consumer snippet at all, and returning steps here reproduces #530's false "
    + "positive: a real checkout compared against a step that was never actually there");
});

test("PROOF: a prose-only mention (no uses: line) is correctly found by no candidate block", () => {
  const proseOnly = "The Action was documented as `a11ign/a11ign@v1` in two files.";
  assert.equal(USES_PATTERN.test(proseOnly), false,
    "a bare mention of the Action's name, with no uses: line, must not be treated as a documented "
    + "workflow snippet -- PLAN.md relies on exactly this distinction");
});
