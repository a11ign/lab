/**
 * Write a JSON file so a reader never sees half of one.
 *
 * Temp-then-rename, because `rename(2)` within a filesystem is atomic: a reader sees the old file or the
 * new one, never a truncated prefix. A plain `writeFileSync` is not — the process can die between the
 * `open` that truncates and the `write` that fills, and what survives is an empty or partial file that
 * still parses as "a capture that produced nothing", which in this project is a FINDING rather than a
 * fault. That is the distinction the whole diagnostics model exists to protect.
 *
 * The risk is not theoretical: lab jobs run under `systemd-run --property=RuntimeMaxSec`, so a job that
 * overruns is killed mid-syscall by design.
 *
 * Extracted from `capture-progress.mjs`, which had it privately, rather than copied — a second
 * implementation of "write this safely" is a fact stated twice, and this repo's record on those is that
 * they drift silently.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}
