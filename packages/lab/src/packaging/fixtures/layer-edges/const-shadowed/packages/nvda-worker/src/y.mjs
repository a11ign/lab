import { readFileSync } from "node:fs";
const P = "../../other/src/x.mjs";
export function harmless() {
  const P = "./own.mjs";
  return readFileSync(new URL(P, import.meta.url), "utf8");
}
export const outer = readFileSync(new URL(P, import.meta.url), "utf8");
