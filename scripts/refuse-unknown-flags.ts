// A flag guard with no package dependency, so the corpus-release scripts load from this checkout alone (a11ign/a11ign#5501).
//
// `@a11ign/screenreader-fleet/cli-flags` is the shared form, and it does not resolve here: the nightly unit runs these
// scripts from the lab's own checkout, which holds no `node_modules` and cannot run `pnpm install`. This keeps the one
// behaviour both scripts need -- refuse a flag rather than ignore it, since an ignored `--dry-run` typo performs an upload.
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const nameOf = (argument: string) => argument.split("=")[0];

/**
 * Exits 2 naming each flag not in `known`, but only when `entry` is the file being run: imported by a test or
 * `node -e "import(...)"`, it must not inspect the importing process's flags.
 */
export function refuseUnknownFlags(known: string[], { entry, command }: { entry: string; command?: string }) {
  const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
  if (entry !== invoked) return;
  const accepted = new Set(known.map(nameOf));
  const unknown = process.argv.slice(2)
    .filter((a) => a !== "--" && (a.startsWith("--") || /^-[A-Za-z]/.test(a)))
    .map(nameOf)
    .filter((flag) => !accepted.has(flag));
  if (unknown.length === 0) return;
  for (const flag of unknown) console.error(`  ${command ?? basename(process.argv[1])}: unknown flag ${flag}`);
  console.error(accepted.size === 0 ? "  It takes no flags at all." : `  It takes: ${[...accepted].sort().join(" ")}`);
  console.error("  Refusing rather than ignoring it: an ignored flag runs the default and reports success.");
  process.exit(2);
}
