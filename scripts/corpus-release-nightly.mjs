// TRANSITIONAL (a11ign/a11ign#4551): this program is `corpus-release-nightly.ts`. The name stays for ONE release because the core's `package.json` and nightly unit and control's `lab-job.yml` still name it, and a bare
// rename reds the required `own` leg (`referenced-scripts.test.ts` reads the core's `package.json` at `CORE_REF`). Imported, it re-exports the `.ts`. Run as the entry file it RUNS the `.ts` with the
// same arguments, node flags and stdio and exits with its status: the `.ts` is a program only when it is itself the entry file, so a bare re-export would exit 0 having measured nothing. It needs a
// runtime that loads `.ts` (Node 24, upstream Node >= 22.18, tsx): the distro `/usr/bin/node` 22.22.1 does not and stops on the `.ts` import, so a caller that names it must move with the pin.
// Deleted by a11ign/a11ign#4798.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export * from "./corpus-release-nightly.ts";
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.stderr.write("corpus-release-nightly.mjs is now corpus-release-nightly.ts (a11ign/a11ign#4551): this name is deleted at the next lab release; running the .ts\n");
  const run = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(new URL("./corpus-release-nightly.ts", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" });
  if (run.error) throw run.error;
  process.exit(run.status ?? 1);
}
