import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.cwd();
const SIBLING = "packages/other/src/x.mjs";

export const label = "reads a sibling package's file, a few lines below where it is named";
export const TEXT = readFileSync(join(ROOT, SIBLING), "utf8");
