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

/**
 * #891: THE TRACKER'S OWN value-class exemption -- narrower than, and separate from, the tree's
 * `(file, value)` EXEMPT table (`tracked-source-leak-guard.test.ts:120-145`), which a tracker body cannot
 * use at all (it has no file to key on). UTM's local VM host-only bridge, documented TWICE in CLAUDE.md
 * as the `npm run capture:check -- --worker=http://192.168.64.x:8765` command, and reachable from nowhere
 * but the single Mac it runs on.
 *
 * `ceo`'s ruling, 2026-09-09: this ONE `/24`, and nothing broader. A value-class exemption is weaker than
 * the tree's key -- the tree can say "this value, in this file" and still catch the SAME value appearing
 * somewhere new; a tracker body exempts the value everywhere it appears, a real loss of resolution taken
 * deliberately because the alternative (refusing every row that quotes CLAUDE.md's own documented
 * command) is a guard people route around. Widening it is a finding for `ceo`, never a local tweak --
 * #705's own lesson is that a broad `EXEMPT` entry is the failure this class produces, not the fix.
 */
const TRACKER_EXEMPT_IPV4_PREFIX = "192.168.64.";

/**
 * Is `value` inside the tracker's one exempt `/24`? String-prefixed rather than full CIDR arithmetic --
 * the ruling is exactly one `/24` on a `192.168.` octet pair the pattern already requires, so the third
 * octet is the only thing left to check, and a literal prefix says so without inventing a general-purpose
 * subnet calculator this repo has no other use for.
 * @param {string} value
 * @returns {boolean}
 */
function isTrackerExemptAddress(value) {
  return value.startsWith(TRACKER_EXEMPT_IPV4_PREFIX);
}

/**
 * #891: THE ONE PLACE that decides whether a body may reach GitHub at all. Every writer wrapper
 * (`row-file`, `pr-open`/`pr-edit`, `tracker-comment`) calls this before its own `gh` call, never a
 * second hand-rolled pattern -- the argument tonight's redaction sweep made directly: a hand-rolled sweep
 * for "addresses" found one of `LEAK_PATTERNS`' three categories and missed the other two (named SSH key
 * files, all four hits) entirely, because the second copy is always narrower than the first.
 *
 * Checked LINE BY LINE, not on the whole collapsed body: the refusal has to name a line a filer can find
 * and fix, and a tracker body is typed prose, not a hard-wrapped Markdown file where a match could
 * legitimately span a line break (the reason `allLeaksIn`'s own callers collapse a whole FILE first).
 * Each line is still whitespace-collapsed on its own, so a leak split across incidental double spaces
 * within one line is not missed.
 *
 * `null` means the body is clear to send.
 *
 * @param {string} body
 * @returns {string | null}
 */
export function leakRefusalReason(body) {
  /** @type {Array<{ line: string; leak: { name: string; value: string } }>} */
  const offenders = [];
  for (const line of body.split("\n")) {
    for (const leak of allLeaksIn(line.replace(/\s+/g, " "))) {
      if (leak.name === "private LAN IPv4 address" && isTrackerExemptAddress(leak.value)) continue;
      offenders.push({ line, leak });
    }
  }
  if (offenders.length === 0) return null;
  const named = offenders
    .map(({ line, leak }) => `  ${leak.name}: "${leak.value}"\n    in: ${line.trim()}`)
    .join("\n");
  return "REFUSING -- this body carries what looks like a real internal detail, and nothing has checked "
    + `the tracker for one before now (#891):\n${named}\n`
    + "The documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and the local VM bridge's "
    + "own /24 (192.168.64.x, CLAUDE.md's documented `capture:check --worker=` command) are allowed and "
    + "never flagged. Replace the real value above and try again.";
}
