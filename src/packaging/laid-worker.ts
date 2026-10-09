import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A file of the screenreader-worker's SOURCE, read from where the core LAYS it (`packages/nvda-worker/`, `scripts/lay-layer.mjs`), as `laid-control.ts` does for control.
 *
 * The installed package cannot answer: since the worker went flat (a11ign/a11ign#4156) it publishes `dist`, `README.md` and `LICENSE`, so `layerFile` refuses
 * `src/capture-core.mjs` and a `src` beside the resolved `package.json` holds nothing. A test that asserts something about the SOURCE TEXT of a file it cannot import
 * (guidepup throws at module load without a screen reader) reads the laid copy, at the tag the core's lockfile pins (`.layer-ref`) and the same copy the core's own tests
 * import from. It refuses when the layer is not laid; it never falls back to the registry package, which holds no source.
 */
const LAYER = join(fileURLToPath(new URL("../../../../", import.meta.url)), "packages/nvda-worker");

/** The worker's sources went from `.mjs` to `.ts` (a11ign/a11ign#4274 for its `src/`); a caller that names the old spelling is read at the new one rather than refused. */
function laidPath(rel: string): string {
  const named = join(LAYER, rel);
  return !existsSync(named) && rel.endsWith(".mjs") && existsSync(named.replace(/\.mjs$/, ".ts")) ? named.replace(/\.mjs$/, ".ts") : named;
}

/** @param rel a path inside the worker repository, from its root: `src/capture-core.mjs`, `README.md` */
export function workerSource(rel: string): string {
  if (!existsSync(join(LAYER, ".layer-ref"))) throw new Error(`workerSource: the screenreader-worker is not laid at ${LAYER} (no .layer-ref); \`pnpm install\` in the core lays it`);
  const found = laidPath(rel);
  if (!existsSync(found)) throw new Error(`workerSource: the laid worker at ${LAYER} holds no ${rel}`);
  return found;
}
