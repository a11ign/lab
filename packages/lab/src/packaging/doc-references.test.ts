/**
 * Every path the top-level docs point at must exist.
 *
 * The package split moved `worker-ctl.sh` into `packages/worker-fleet/src/local-worker/` and left three
 * README links behind at `scripts/local-worker/`. Nothing noticed, because a wrong path in Markdown is not a
 * broken build — it is a reader following an instruction that silently cannot work, in the file a newcomer
 * reads first.
 *
 * This is the same reasoning as `spawned-paths.test.ts` applied to prose: a path in a string is a claim, and
 * an unverified claim about the filesystem rots the moment a file moves. Checking it by hand found it once;
 * this is so nobody has to remember to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

/** The documents a reader is most likely to follow an instruction from. */
const DOCS = ["README.md", "RELEASE.md", "PLAN.md", "CLAUDE.md"];

/**
 * Two shapes, both of which are claims about the filesystem:
 *   - a relative Markdown link, `(./path/to/thing)`
 *   - a backticked repo path, `` `packages/…` ``, which is how this repo cites files in prose
 *
 * Bare prose words are deliberately NOT matched. A regex loose enough to catch every mention would flag
 * ordinary English, and a check that cries wolf gets deleted — which costs more than the bug it prevents.
 */
const REFERENCE = /\(\.\/([A-Za-z0-9._/-]+)\)|`((?:docs|packages|scripts|\.github)\/[A-Za-z0-9._/-]+)`/g;

/** Glob-ish citations name a set, not a file, so they cannot be resolved by existence. */
const isPattern = (path: string): boolean => path.includes("*");

test("every path cited by the top-level docs exists", () => {
  const broken: string[] = [];
  let checked = 0;

  for (const doc of DOCS) {
    const full = join(repo, doc);
    assert.ok(existsSync(full), `${doc} is itself missing — this test's own subject`);
    const text = readFileSync(full, "utf8");
    const seen = new Set<string>();
    for (const match of text.matchAll(REFERENCE)) {
      const path = match[1] ?? match[2];
      if (isPattern(path) || seen.has(path)) continue;
      seen.add(path);
      checked += 1;
      if (!existsSync(join(repo, path))) broken.push(`${doc}: ${path}`);
    }
  }

  // Guard the guard. If the regex stops matching, this test passes having examined nothing — the exact
  // failure mode that let 604 silent probe crashes and a green corpus coexist for a whole dataset.
  assert.ok(checked > 30, `the scan only resolved ${checked} references; it is broken, not clean`);

  assert.deepEqual(broken, [],
    `${broken.length} doc reference(s) point at nothing — a reader following these gets a dead end:\n  `
    + broken.join("\n  "));
});
