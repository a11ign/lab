/**
 * THE FILES OF THE CONTROL LAYER, which `git ls-files` cannot list (a11ign/a11ign#3506, #3972).
 *
 * `packages/control` is a LAID layer of a11ign/control: `scripts/lay-layer.ts` writes `src`, `ansible`, `CLAUDE.md` and `README.md` at the tag `layers.json` pins, `.gitignore`
 * keeps the directory out of the core's index, and so a test that asks git for "every committed Ansible file" finds none of them. The guards over those files
 * (`ansible-yaml-parses`, `powershell-parses`, `checkout-dash-safety`, ...) still apply, because the files are what a worker is played; their population is the laid tree.
 *
 * Staging it in CI the way `packages/lab` is staged was tried and does not work: a tracked directory under `packages/` with no manifest crashes the core's own
 * `packageIndex` (`packages/guards/src/walk-scope-discovery.ts`, which reads `packages/<dir>/package.json` for every directory `knownPackages` finds), and that is seven
 * of `declared-walk-scope`'s tests. So the population is read from DISK, with the one distinction `ansible-yaml-parses` records as the reason it ever used git: what an operator keeps
 * beside the layer (`layers.json`'s `keeps`: `ansible/inventory.yml`, `ansible/*.local.yml`) is untracked state of one machine, absent from CI and present on a host, and is not
 * the subject of any guard here.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { walkTree } from "../../../guards/src/tree-wide-guard.ts";

const LAYER = "packages/control";
const NOT_THE_LAYER_S = /(^|\/)node_modules(\/|$)|(^|\/)\.layer-ref$|^packages\/control\/ansible\/(inventory\.yml|[^/]*\.local\.yml)$/;

/**
 * Every file of the laid layer, repo-relative with `/`, sorted; an absent layer is `[]` (a guard that needs the layer asserts the population non-empty itself).
 * @param repoRoot the checkout the layer is laid in
 */
export function laidControlFiles(repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (NOT_THE_LAYER_S.test(path)) continue;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  try {
    walk(LAYER);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  return found.sort();
}

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** `walkTree`'s tracked paths PLUS the laid control layer's: what a tree-wide guard walked before a11ign/a11ign#3506 took `packages/control` out of the index. */
export const trackedAndLaidPaths = (): string[] => [...walkTree({ kind: "all", roots: [] }).map((file) => file.path), ...laidControlFiles(REPO_ROOT)];
