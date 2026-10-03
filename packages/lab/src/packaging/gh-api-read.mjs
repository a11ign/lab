// @ts-check
/**
 * One `gh api` read that keeps "refused" apart from "could not look" (#3123).
 *
 * `404` and `403` from GitHub's protection endpoints mean ABSENT OR FORBIDDEN, so a caller that must not read
 * "I may not look" as "there is nothing there" needs the three outcomes separate, and never an empty catch.
 * It lives in its own module because the test that uses it only reaches `gh` in an opt-in live read: spawning
 * it from the test file itself would charge that test a token it does not need to run.
 */
import { execFileSync } from "node:child_process";

/** @typedef {{ kind: "ok", value: unknown } | { kind: "refused" } | { kind: "unreadable", why: string }} GhRead */

const REFUSED_STATUSES = new Set(["403", "404"]);

/**
 * @param {string} path a REST path, e.g. `repos/<owner>/<name>/rules/branches/main`
 * @returns {GhRead}
 */
export function ghApiRead(path) {
  try {
    const out = execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { kind: "ok", value: JSON.parse(out) };
  } catch (cause) {
    const stderr = String(/** @type {{ stderr?: unknown }} */ (cause).stderr ?? "");
    const status = /HTTP (\d{3})/.exec(stderr)?.[1];
    return status !== undefined && REFUSED_STATUSES.has(status)
      ? { kind: "refused" }
      : { kind: "unreadable", why: stderr.trim() || String(cause) };
  }
}
