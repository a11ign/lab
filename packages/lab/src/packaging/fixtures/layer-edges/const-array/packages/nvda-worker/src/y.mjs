import { join } from "node:path";
const ROOT = process.cwd();
const A = ["packages/other/src/x.mjs"];
const B = ["packages/nvda-worker/src/own.mjs"];
export const ALL = [...A, ...B];

export const abs = ALL.map((rel) => join(ROOT, rel));
