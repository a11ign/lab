import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.cwd();
const SITES = [{ file: "packages/other/src/x.mjs", expect: "packages/nvda-worker/src/own.mjs" }];

for (const { file } of SITES) {
  readFileSync(join(ROOT, file), "utf8");
}
