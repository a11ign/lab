import { existsSync } from "node:fs";

/**
 * The program a one-release `.mjs` shim stands for (a11ign/a11ign#4551), or `path` itself when it is not one.
 *
 * A shim is a NAME that the core's `package.json` and control's `lab-job.yml` still spell, never a program: it re-exports and, as the
 * entry file, spawns its `.ts`. A test that walks `scripts/` would count it as a script (its `process.exit` makes it one with an
 * exit-code contract, and its source carries no verdict), and a test that follows a caller's spelling would read the shim's source
 * where it means the program's. Both read the `.ts`. Deleted with the shims (a11ign/a11ign#4798).
 */
export function programBehind(path: string): string {
  const program = path.replace(/\.mjs$/, ".ts");
  return path.endsWith(".mjs") && existsSync(program) ? program : path;
}

export function isTransitionalShim(path: string): boolean {
  return programBehind(path) !== path;
}
