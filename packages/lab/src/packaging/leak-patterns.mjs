// @ts-check
/**
 * What a public repo must never carry in tracked prose: real internal addresses, named SSH key files, and
 * the retired `pct exec` container-hop idiom (ADR 0013). This repo went public on 2026-09-06.
 *
 * ONE set, shared by every leak guard in this repo. `docs/roles/memory/nvda-worker-vm-access.md`'s own
 * guard (`roles-memory.test.ts`) and this repo-wide sweep (`tracked-prose-leak-guard.test.ts`) both drive
 * these — never a second, independently-typed copy of the same three regexes, which is exactly the
 * "a fact stated twice, and the copies drifted" shape this repo's own CLAUDE.md names as its most
 * expensive recurring defect.
 */

/** @type {Array<{ name: string; pattern: RegExp }>} */
export const LEAK_PATTERNS = [
  // A REAL IPv4 address has FOUR octets. This used to read `(?:10|192\.168|172\...)\.\d{1,3}\.\d{1,3}`,
  // which requires only THREE for the bare-`10` branch — `10` plus two more groups is `10.x.y`, one
  // octet short of an address, and `\b` after the second `\d{1,3}` is satisfied by any non-word
  // character (a `.` included), so the pattern happily stopped there instead of continuing. Found
  // widening #86's sweep to every tracked file rather than an extension allowlist: an Intel driver INF's
  // Windows platform-version decorations (`NTamd64.10.0.1..17763`) and ordinary npm semver
  // (`package-lock.json`'s `"10.0.0"`) both satisfy three octets and neither is an address. Each branch
  // now spells its own full four-octet shape rather than sharing one truncated suffix.
  { name: "private LAN IPv4 address", pattern:
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { name: "a named SSH private key file", pattern: /~?\/?\.ssh\/[\w.-]+_ed25519\b|~?\/?\.ssh\/id_\w+\b/ },
  { name: "a live pct exec container-hop command", pattern: /\bpct exec \d/ },
];

/**
 * Every match of every pattern in COLLAPSED text, unfiltered by any exemption — the caller applies its
 * own (file, value) allowlist. Shared so `tracked-prose-leak-guard.test.ts` (`.md`) and
 * `tracked-source-leak-guard.test.ts` (`.mjs/.ts/.py/.ps1/.sh/.yml`, #83) walk different populations
 * through the identical matching logic, rather than two copies that can drift.
 *
 * @param {string} text already collapsed (`.replace(/\s+/g, " ")`) so a match split across a hard-wrapped
 *   line is not missed.
 * @returns {Array<{ name: string; value: string }>}
 */
export function allLeaksIn(text) {
  const found = [];
  for (const { name, pattern } of LEAK_PATTERNS) {
    const global = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(global)) found.push({ name, value: match[0] });
  }
  return found;
}
