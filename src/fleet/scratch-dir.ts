/**
 * A TEST'S TEMP DIRECTORY, AND ITS REMOVAL, IN ONE PLACE (A11-263), for the tests of the fleet client.
 *
 * `mkdtempSync` with no remover is how /tmp ran out of inodes (the lab's `test-tmp.ts` explains); the core's helper is the one the lab's older tests import, and each of
 * those imports is an edge to a file outside this repository that `layer-edges.baseline.json` has to carry. These tests need only the part that matters, an after-hook
 * that removes what was made, so it is stated here, under `node:` modules alone.
 */
import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const owned = new Set<string>();

/** A new directory under `os.tmpdir()`, removed when this file's tests are done. Registered at import, because a runner takes a hook only while a file is being collected. */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  owned.add(dir);
  return dir;
}

after(() => {
  for (const dir of owned) rmSync(dir, { recursive: true, force: true });
  owned.clear();
});
