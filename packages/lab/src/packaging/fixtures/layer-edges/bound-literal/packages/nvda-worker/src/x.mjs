import { readFileSync } from "node:fs";
const SIBLING = "../../other/src/x.mjs";
export const TEXT = readFileSync(new URL(SIBLING, import.meta.url), "utf8");
