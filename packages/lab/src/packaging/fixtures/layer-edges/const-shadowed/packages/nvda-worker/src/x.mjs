import { readFileSync } from "node:fs";
export function inner() {
  const P = "../../other/src/x.mjs";
  return readFileSync(new URL(P, import.meta.url), "utf8");
}
const P = "./own.mjs";
export const own = readFileSync(new URL(P, import.meta.url), "utf8");
