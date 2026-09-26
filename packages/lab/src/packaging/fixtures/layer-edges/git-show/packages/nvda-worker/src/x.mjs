import { execFileSync } from "node:child_process";
// eslint-disable-next-line local/git-spawn-scrubbed -- a fixture the guard READS and never runs
export const HEAD_TEXT = execFileSync("git", ["show", "HEAD:packages/other/src/x.mjs"], { encoding: "utf8" });
