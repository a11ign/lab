/**
 * The tool's files by path under it (`src/work-gate.mjs`, `host/gh`), for the tests that read agent-org's OWN source: the shape `toolModule`/`toolPath`/`toolUrl` had in the core's
 * `scripts/agent-org-newest-tag.ts` until a11ign/a11ign#4408 removed them in favour of the tool's declared `exports` and `bin`.
 *
 * A name the tool DECLARES (`agent-org/pr-open`) is resolved through its `exports`, as the core does. Most of what these tests read is NOT declared (`work-gate`, `ready-label-audit`, `row-claim`: they
 * test the tool's internals, from this repository), so the rest is a path under the tool, and since agent-org#435 a `src/x.mjs` is a `src/x.ts` there: the file that exists under either extension is
 * the one returned. That second half is the reach the core's `agent-org-src-reach` guard forbids to the core's own files; it is held in THIS file so a rename inside agent-org breaks one place, and
 * the way out is for agent-org to declare what these tests read or to carry the tests itself (a11ign/a11ign#4427).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { toolExportPath, toolRoot } from "../../../scripts/agent-org-newest-tag.ts";

/** The declared export a `src/<name>.mjs|ts` path names, if the tool declares one; `undefined` when it does not. */
function declaredPath(relative: string): string | undefined {
  const name = /^src\/([^/]+)\.(?:mjs|ts)$/.exec(relative)?.[1];
  if (name === undefined) return undefined;
  try {
    return toolExportPath(name);
  } catch {
    // Not declared: the caller falls back to the path. A refusal here is the ordinary answer for an undeclared name, so it is read as "no", not recorded.
    return undefined;
  }
}

/** A file of the tool, by its path under the tool, as a path. */
export function toolPath(relative: string): string {
  const declared = declaredPath(relative);
  if (declared !== undefined) return declared;
  const named = join(toolRoot(), relative);
  const renamed = relative.replace(/\.mjs$/, ".ts");
  return !existsSync(named) && existsSync(join(toolRoot(), renamed)) ? join(toolRoot(), renamed) : named;
}

/** The same file as a `URL`, for `readFileSync(url)`. */
export function toolUrl(relative: string): URL {
  return pathToFileURL(toolPath(relative));
}

/**
 * The gate's source as one text: `src/work-gate.mjs` followed by every non-test file under `src/work-gate/`, sorted, joined with a newline. The
 * tool moved the gate's causes out of its entry (a11ign/a11ign#5152), so a pin on the entry alone reads the gate without them. This is the same
 * text agent-org's own `workGateSource()` (agent-org#1066) gives its tests, read here from the tool at the tag `toolRoot()` names.
 */
export function toolGateSource(): string {
  const entry = readFileSync(toolPath("src/work-gate.mjs"), "utf8");
  const dir = join(toolRoot(), "src", "work-gate");
  const parts = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8"));
  return [entry, ...parts].join("\n");
}

/** A module of the tool, imported. Computed `import()`, so the caller names the shape it uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a computed import has no static shape; every caller destructures what it uses, as it did when the core's untyped .mjs returned any
export function toolModule(relative: string): Promise<any> {
  return import(toolUrl(relative).href);
}
