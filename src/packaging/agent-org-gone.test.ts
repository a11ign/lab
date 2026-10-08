/**
 * #2976 (cut-over 5 of 6): `packages/agent-org/` LEFT THIS REPOSITORY, and this file refuses its return.
 *
 * The tool lives in `a11ign/agent-org` and is installed here as a pinned dependency (`package.json`). A tracked path under
 * the old directory is a second copy that would shadow nothing and drift from the real one, so any such path is refused,
 * naming where a change to the tool goes.
 *
 * THE CONTROL: the same refusal over a fixture list holding such a path. A guard that has only ever passed has not been
 * shown able to fail, and an empty fixture would pass it, so the fixture is asserted to contain the refused path first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// This file's population is the whole tracked tree, declared by a call rather than inferred from its source.
declareTreeWideGuard();

const GONE = "packages/agent-org/";

/** The refusal for `paths`, or null when none of them lies under the removed directory. */
function refusalFor(paths: readonly string[]): string | null {
  const returned = paths.filter((path) => path.startsWith(GONE));
  if (returned.length === 0) return null;
  return `${returned.length} tracked path(s) under ${GONE}, which left this repository in #2976: change the tool in `
    + `a11ign/agent-org (https://github.com/a11ign/agent-org) and bump the pinned dependency. First: ${returned[0]}`;
}

test("the real tree tracks nothing under packages/agent-org/", () => {
  const tracked = walkTree({ kind: "all", roots: [] }).map((file) => file.path);
  // Positive control for the emptiness below: the walk read a real tree, not an empty or wrong one.
  assert.ok(tracked.length > 1000, "the walk read far fewer tracked paths than this repository has: it is broken, and an empty walk passes");
  assert.equal(refusalFor(tracked), null);
});

test("control: a fixture tree with a path under packages/agent-org/ is REFUSED, naming the path and a11ign/agent-org", () => {
  const fixture = ["README.md", "packages/lab/src/a.ts", "packages/agent-org/src/row-claim.mjs"];
  assert.ok(fixture.some((path) => path.startsWith(GONE)), "the fixture holds the refused path, so it cannot pass vacuously");
  const refusal = refusalFor(fixture);
  assert.match(refusal ?? "", /packages\/agent-org\/src\/row-claim\.mjs/);
  assert.match(refusal ?? "", /a11ign\/agent-org/);
});

test("control: the prefix ends at its slash, so a sibling directory and a mention are not the directory", () => {
  assert.equal(refusalFor(["packages/agent-organiser/src/x.mjs", "docs/agent-org.md", ".agent-org/project.json"]), null);
});
