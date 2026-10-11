/**
 * The lab's OWN source files, for the product checks that used to walk `packages/` in the core.
 *
 * Those checks asked a question about every file in the core's tree and answered it for the lab's files among
 * them. A repository does not read another's source (ADR 0045, Decision 1 rule 2), so each check that arrived
 * here asks the same question of this repository's tree, from this file's location, and the core keeps the part
 * of the walk that is its own.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** The lab's root: two directories above `src/product-checks`, wherever the repository is checked out or laid. */
export const LAB_ROOT = resolve(import.meta.dirname, "../..");

const NOT_SOURCE = new Set(["node_modules", "dist", "__pycache__", ".git"]);
const A_TEST = /\.test\.(ts|mjs)$|(^|\/)test_[^/]*\.py$|_test\.py$/;

/** Every non-test file under `roots` (relative to the lab root) whose name matches `extensions`, absolute and sorted. */
export function labSources(extensions: RegExp, roots: readonly string[] = ["src", "scripts"]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name)) walk(path);
      } else if (extensions.test(entry.name) && !A_TEST.test(path)) {
        found.push(path);
      }
    }
  };
  for (const root of roots) walk(join(LAB_ROOT, root));
  return found.sort();
}
