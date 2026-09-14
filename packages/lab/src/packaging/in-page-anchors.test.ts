/**
 * #1602: IN-PAGE ANCHOR LINKS -- `scripts/doc-checks/in-page-anchors.mjs`, a check the nightly doc cross-reference
 * report runs.
 *
 * worker-capture typo'd #1600's new README fragment (`…-measurd-on`) and every doc check stayed green: the one
 * anchor rule, `claude-md-links`, reads only CLAUDE.md's `(docs/… .md#anchor)` links. This check reads every
 * `](#anchor)` link in every tracked markdown file against the headings of that same file.
 *
 * Every fixture is a temporary git repository, because the population is `git ls-files`: a plain directory would
 * exercise the refusal, not the rule. Its git calls use `sandboxGitEnv`, so a hook's GIT_DIR cannot aim them at
 * this checkout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { check, inPageAnchorLinks, trackedMarkdown } from "../../../../scripts/doc-checks/in-page-anchors.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const MODULE = join(REPO, "scripts/doc-checks/in-page-anchors.mjs");

/** worker-capture's typo on #1600, as the row quotes it: the real fragment with one letter gone. */
const REAL_FRAGMENT = "what-this-tool-claims-with-the-number-it-was-measured-on";
const TYPO_FRAGMENT = "what-this-tool-claims-with-the-number-it-was-measurd-on";

/** A throwaway git repository holding `tracked` in its index and `untracked` beside it; removed afterwards. */
function withRepo(tracked: Record<string, string>, body: (root: string) => void, untracked: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "in-page-anchors-"));
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  try {
    write(tracked);
    execFileSync("git", ["init", "-q"], { cwd: root, env: sandboxGitEnv(), stdio: "pipe" });
    execFileSync("git", ["add", "--", ...Object.keys(tracked)], { cwd: root, env: sandboxGitEnv(), stdio: "pipe" });
    write(untracked);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The `](#` count, derived by splitting rather than by the module's regex. */
const inPageLinkCount = (text: string) => text.split("](#").length - 1;

test("#1602 MUTATION: worker-capture's typo on a copy of today's README is named by file, line and anchor", () => {
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const link = `](#${REAL_FRAGMENT})`;
  // The mutation needs the link it breaks; without it this test would pass having mutated nothing.
  assert.equal(readme.split(link).length - 1, 1, `README.md no longer links #${REAL_FRAGMENT} exactly once`);
  const mutated = readme.replace(link, `](#${TYPO_FRAGMENT})`);
  const line = readme.slice(0, readme.indexOf(link)).split("\n").length;

  withRepo({ "README.md": mutated }, (root) => {
    assert.deepEqual(check(root).disagreements.map(({ where, reference }) => ({ where, reference })),
      [{ where: `README.md:${line}`, reference: `#${TYPO_FRAGMENT}` }]);
  });
});

test("#1602 CONTROL: the same copy unmutated reads 0 broken, and examined equals the `](#` count derived by split", () => {
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  withRepo({ "README.md": readme }, (root) => {
    const result = check(root);
    assert.deepEqual(result.disagreements, []);
    // EQUALITY, not a floor: the mutation above proves this population holds the link it broke, so a zero here
    // cannot be the module reading nothing.
    assert.equal(result.examined, inPageLinkCount(readme));
    assert.equal(result.unit, "in-page anchor links in 1 tracked markdown files");
  });
});

test("#1602 POPULATION: every tracked markdown file at any depth, never an untracked one or a non-markdown file", () => {
  const broken = "# Title\n\n[gone](#nowhere)\n";
  withRepo({ "a.md": broken, "docs/deep/b.md": broken, "notes.txt": broken }, (root) => {
    assert.deepEqual(trackedMarkdown(root).sort(), ["a.md", "docs/deep/b.md"]);
    const result = check(root);
    assert.deepEqual(result.disagreements.map((d) => d.where).sort(), ["a.md:3", "docs/deep/b.md:3"],
      "the untracked c.md's broken link was read, or a tracked one was missed");
    assert.equal(result.examined, 2);
    assert.equal(result.unit, "in-page anchor links in 2 tracked markdown files");
  }, { "c.md": broken });
});

test("#1602: a link resolves against the file's own headings as `claude-md-links` slugs them, duplicates included", () => {
  const doc = [
    "# The `--json` **flag**", "## Setup", "## Setup",
    "[a](#the---json-flag) [b](#setup) [c](#setup-1) [d](#setup-2)",
  ].join("\n");
  assert.deepEqual(inPageAnchorLinks(doc).map((l) => l.anchor), ["the---json-flag", "setup", "setup-1", "setup-2"]);
  withRepo({ "doc.md": doc }, (root) => {
    // Only the third `Setup` is missing: code spans and bold are stripped and a repeat takes `-1`, as GitHub does.
    assert.deepEqual(check(root).disagreements.map((d) => d.reference), ["#setup-2"]);
  });
});

test("#1602 ONE COPY: the module imports `headingAnchors` from `claude-md-links` and defines no slugger of its own", () => {
  const source = readFileSync(MODULE, "utf8");
  assert.match(source, /^import \{ headingAnchors \} from "\.\/claude-md-links\.mjs";$/m);
  assert.doesNotMatch(source, /function (?:slugify|headingAnchors)\b/, "a second slugger can drift from the pinned one");
});

test("#1602: a directory that is not a git work tree is refused by name, never read as zero files", () => {
  const root = mkdtempSync(join(tmpdir(), "in-page-anchors-plain-"));
  try {
    writeFileSync(join(root, "README.md"), "[gone](#nowhere)\n");
    assert.throws(() => check(root), new RegExp(`^Error: not a git work tree at ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
