/**
 * This repo went public on 2026-09-06. Tracked Markdown prose must never carry a real internal network
 * address, a named SSH private key file, or the retired `pct exec` container-hop idiom (ADR 0013,
 * REDACTED the same day) — `inventory.yml` is the one place those facts belong, per this project's own
 * "fact-stated-once" rule.
 *
 * ## Why this reuses `LEAK_PATTERNS` rather than writing a second detector
 *
 * `docs/roles/memory/nvda-worker-vm-access.md` already had a leak guard (`roles-memory.test.ts`, on
 * `agent/contingency-plan`) scoped to one directory. This is the SAME three regexes
 * (`packages/lab/src/packaging/leak-patterns.mjs`), walking every tracked `.md` file instead — a second,
 * independently-typed copy of the rule is exactly the "a fact stated twice, and the copies drifted" shape
 * this repo's own CLAUDE.md names as its most expensive recurring defect. Once `agent/contingency-plan`
 * merges, that test should import the same module rather than keep its own inline array.
 *
 * ## Why the population is DISCOVERED, not hand-listed
 *
 * `git ls-files '*.md'` — never a written-out list of "the docs that matter" — with a vacuity floor, so a
 * broken discovery that silently walks zero files fails loudly rather than reading as a clean sweep.
 *
 * ## Why matches are read from COLLAPSED whole-file text, not line by line
 *
 * A citation, a search target or a mutation target in this repo is as likely to be split across a
 * hard-wrapped line as not (CLAUDE.md itself, repeatedly). None of `LEAK_PATTERNS` contains an internal
 * space except the `pct exec` idiom, so a literal line-by-line scan could miss an address or command
 * wrapped mid-token. Collapsing every run of whitespace to one space before matching removes that failure
 * mode without changing what any pattern means.
 *
 * ## The two exemption channels, and why they are separate
 *
 * `192.168.64.x` is UTM's own local VM bridge — private to a single Mac, not a shared or remotely
 * reachable secret, the same judgement this repo already applies to `127.0.0.1`. Real corpus/fixture data
 * containing a SYNTHETIC address in the same numeric shape as a real one is a different reason entirely.
 * Both are exempted per EXACT (file, matched value) pair with a stated reason — never per file — so a new,
 * unrelated leak landing in an already-exempted file is still caught.
 *
 * **The bound this leaves, written down rather than left to be discovered:** an exemption is scoped to
 * (file, value), not to a position within the file. A genuinely NEW leak in an already-exempted file that
 * happens to reuse the identical numeric value already exempted there would be masked. Narrow — an IPv4
 * address is specific — but real, and worth stating so nobody widens an exemption from a value to a whole
 * file believing the narrower form already has this gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LEAK_PATTERNS } from "./leak-patterns.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Below this, `git ls-files` almost certainly ran from the wrong directory or matched nothing. */
const MIN_TRACKED_MARKDOWN_FILES = 50;

/**
 * `(file, matched value)` pairs known to be safe, each with why. A file is never exempted wholesale.
 */
const EXEMPT: Array<{ file: string; value: string; reason: string }> = [
  {
    file: "CLAUDE.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, private to one Mac — a `capture:check` usage example, not a shared/reachable host",
  },
  {
    file: "PLAN.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, private to one Mac",
  },
  {
    file: "docs/local-worker-vm.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "the whole document is about the local UTM VM; this is its own local-bridge address",
  },
  {
    file: "packages/cli/README.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, used only in a usage example",
  },
  {
    file: "packages/lab/src/training/README.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, used only in usage examples",
  },
  {
    file: "packages/lab/src/training/README.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, used only in usage examples",
  },
  {
    file: "packages/lab/src/training/README.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, used only in usage examples",
  },
  {
    file: "docs/capture-phase-breakdown-audit.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge — a measured composition table of the retired 3-guest local pool",
  },
  {
    file: "docs/capture-phase-breakdown-audit.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge — a measured composition table of the retired 3-guest local pool",
  },
  {
    file: "docs/capture-phase-breakdown-audit.md",
    value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge — a measured composition table of the retired 3-guest local pool",
  },
];

function trackedMarkdownFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Collapsed so a match cannot be defeated by a hard-wrapped line boundary. */
function collapsedText(file: string): string {
  return readFileSync(`${REPO}${file}`, "utf8").replace(/\s+/g, " ");
}

function findLeaks(file: string, text: string) {
  const found: Array<{ name: string; value: string }> = [];
  for (const { name, pattern } of LEAK_PATTERNS) {
    const global = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(global)) {
      const value = match[0];
      const exempt = EXEMPT.some((e) => e.file === file && e.value === value);
      if (!exempt) found.push({ name, value });
    }
  }
  return found;
}

test("the tracked-markdown population is real, not an empty or misrooted discovery", () => {
  const files = trackedMarkdownFiles();
  assert.ok(files.length >= MIN_TRACKED_MARKDOWN_FILES,
    `expected at least ${MIN_TRACKED_MARKDOWN_FILES} tracked .md files, found ${files.length} — ` +
    "a broken discovery examining nothing must fail loudly, not read as a clean sweep");
});

test("no tracked .md file carries a real internal address, key filename, or pct-exec idiom", () => {
  const offenders: string[] = [];
  for (const file of trackedMarkdownFiles()) {
    const leaks = findLeaks(file, collapsedText(file));
    for (const leak of leaks) offenders.push(`${file}: ${leak.name} — "${leak.value}"`);
  }
  assert.deepEqual(offenders, [],
    `found ${offenders.length} unexempted leak(s):\n${offenders.join("\n")}`);
});

test("every EXEMPT entry still matches something real in its file — a stale exemption hides nothing", () => {
  for (const { file, value } of EXEMPT) {
    const text = collapsedText(file);
    assert.ok(text.includes(value),
      `EXEMPT names ${file} -> "${value}", but that file no longer contains it — remove the stale entry`);
  }
});

test("MUTATION: each pattern fires on a synthetic leak of its own shape", () => {
  const samples: Record<string, string> = {
    "private LAN IPv4 address": "reach it at REDACTED-INTERNAL-ADDRESS over ssh",
    "a named SSH private key file": "load ~/.ssh/a11y-fixture_ed25519 first",
    "a live pct exec container-hop command": "run pct exec 121 -- bash -lc 'echo hi'",
  };
  for (const { name, pattern } of LEAK_PATTERNS) {
    const sample = samples[name];
    assert.ok(sample, `no synthetic sample defined for pattern "${name}" — add one so this stays proven`);
    assert.ok(pattern.test(sample), `pattern "${name}" did not fire on its own synthetic leak: "${sample}"`);
  }
});

test("MUTATION: a real leak reintroduced into a currently-clean file is caught", () => {
  const file = "docs/adr/0013-lab-job-control.md";
  const clean = collapsedText(file);
  const reintroduced = clean.replace(
    "ssh root@<the lab's host> 'pct exec <container id>",
    "ssh root@REDACTED-INTERNAL-ADDRESS 'pct exec 121",
  );
  assert.notEqual(reintroduced, clean, "the replacement did not match — the fixture text has drifted");
  const leaks = findLeaks(file, reintroduced);
  assert.ok(leaks.length >= 2,
    `expected the reintroduced address and pct-exec idiom to be caught, found: ${JSON.stringify(leaks)}`);
});
