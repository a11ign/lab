import { readFileSync } from "node:fs";
export const TEXT = readFileSync(new URL("../../other/src/x.mjs", import.meta.url), "utf8");
