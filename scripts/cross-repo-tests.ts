/**
 * Which of the lab's test files read OUTSIDE the lab's own tree (a11ign/a11ign#4588, chairman, 2026-10-09).
 *
 * `ci.yml` splits its tests by this: the REQUIRED leg runs the rest, and a NON-REQUIRED `cross-repo` leg runs these, so a test whose verdict moves with another repository's
 * tree (the core's workflows and baselines, the tool at its newest tag) reports without blocking a lab pull request. Two copy-drift tests of that kind made one lab head pass at 13:47Z
 * and fail at 15:08Z with no change to the lab, and the lab's last merge was 13:21Z.
 *
 * A file is cross-repo when it does either of:
 *   - resolves a path above the lab root (`new URL("../../../../", import.meta.url)`, `resolve(import.meta.dirname, "../../..")`): a READ of the core's or another layer's files.
 *     An `import ... from "../../../guards/x.ts"` is NOT counted: that is code from the core at the sha `CORE_REF` pins, which does not move under a pull request;
 *   - uses the tool (`toolModule`, `toolPath`, `toolUrl`, `toolRoot`, `toolExportPath`, `tool-source`): agent-org at its NEWEST tag, which does.
 *
 * Usage: `node scripts/cross-repo-tests.ts` prints the file names, one per line. With `--scope=own|cross-repo` it prints the `rstest` selection for that scope on one line
 * (`own`: every test file but these, as `--include` and `--exclude`; `cross-repo`: these, as `--include`), each path under `packages/lab/`, where `ci.yml` lays the lab.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LAID_AT = "packages/lab";
const TEST_ROOTS = ["src", "scripts", "tests", "nightly"];
const TEST_FILE = /\.test\.ts$/;
/** A relative path handed to a URL or a path join: the shapes that READ a file, as opposed to an `import` specifier. */
const PATH_READ = /(?:new URL\(\s*|resolve\(\s*import\.meta\.dirname,\s*|join\(\s*import\.meta\.dirname,\s*|resolve\(\s*__dirname,\s*)["'`]((?:\.\.\/)+[^"'`]*|\.\.)["'`]/g;
const TOOL_USE = /\b(?:toolModule|toolPath|toolUrl|toolRoot|toolExportPath)\b|tool-source/;

/** The relative paths `source` reads that land above `root`, for a file at `file` (relative to `root`). */
function outsideReads(source: string, file: string, root: string): string[] {
  const inside = (target: string) => target === root || target.startsWith(root + sep);
  return [...source.matchAll(PATH_READ)].map((match) => match[1]).filter((name) => !inside(resolve(root, dirname(file), name)));
}

/** Why `source` (a test file at `file` under `root`) is cross-repo, or an empty list when it is not. */
export function crossRepoReasons(source: string, file: string, root: string = LAB_ROOT): string[] {
  const reasons = outsideReads(source, file, root).map((name) => `reads ${name}`);
  return TOOL_USE.test(source) ? [...reasons, "uses the tool"] : reasons;
}

/** Every test file under the lab, relative to `root`, sorted. */
export function testFiles(root: string = LAB_ROOT): string[] {
  const found = TEST_ROOTS.flatMap((dir) => {
    try {
      return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((name) => join(dir, name));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(`cannot list ${dir} under ${root}`, { cause });
    }
  });
  return found.filter((file) => TEST_FILE.test(file) && !file.split(sep).includes("node_modules")).sort();
}

/** The test files that read outside the lab's tree, relative to `root`, sorted. */
export function crossRepoTests(root: string = LAB_ROOT): string[] {
  return testFiles(root).filter((file) => crossRepoReasons(readFileSync(join(root, file), "utf8"), file, root).length > 0);
}

/** The `rstest` arguments for a scope, each path under where `ci.yml` lays the lab. */
export function rstestSelection(scope: "own" | "cross-repo", root: string = LAB_ROOT): string[] {
  const cross = crossRepoTests(root).map((file) => `${LAID_AT}/${file.split(sep).join("/")}`);
  return scope === "cross-repo" ? cross.flatMap((file) => ["--include", file]) : ["--include", `${LAID_AT}/**/*.test.ts`, ...cross.flatMap((file) => ["--exclude", file])];
}

function main(): void {
  const scope = process.argv.find((arg) => arg.startsWith("--scope="))?.slice("--scope=".length);
  if (scope === undefined) return void console.log(crossRepoTests().join("\n"));
  if (scope !== "own" && scope !== "cross-repo") throw new Error(`--scope is own or cross-repo, not ${scope}`);
  console.log(rstestSelection(scope).join(" "));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
