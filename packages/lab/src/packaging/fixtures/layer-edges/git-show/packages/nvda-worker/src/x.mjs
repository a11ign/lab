import { execFileSync } from "node:child_process";
// The shape of `git show HEAD:<path>`: a `<rev>:<path>` argument to a spawned program. The program is NOT git, so no
// git-spawn rule reads this file; the guard reads the argument and never runs it.
export const HEAD_TEXT = execFileSync("show-object", ["HEAD:packages/other/src/x.mjs"], { encoding: "utf8" });
