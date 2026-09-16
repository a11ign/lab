/**
 * This repo went public on 2026-09-06. Tracked Markdown prose must never carry a named SSH private key
 * file or the retired `pct exec` container-hop idiom (ADR 0013, REDACTED the same day) — `inventory.yml`
 * is the one place those facts belong, per this project's own "fact-stated-once" rule.
 *
 * ## NARROWED 2026-09-07 (#119): the IPv4 pattern moved to `tracked-source-leak-guard.test.ts`
 *
 * This file used to check all three `LEAK_PATTERNS` against `.md` files. #86 widened
 * `tracked-source-leak-guard.test.ts` to walk EVERY tracked, non-binary file — which necessarily includes
 * every `.md` file this guard also walks — so the two files' IPv4 checks were a strict duplicate: same
 * matcher, same population (for `.md`), two independently-drifting `EXEMPT` tables. Verified before
 * narrowing, not assumed: every one of this file's ten `EXEMPT` entries was already present, value for
 * value, in the source guard's own table.
 *
 * **What did NOT move, and why this file still exists rather than being deleted:**
 * `tracked-source-leak-guard.test.ts` is deliberately scoped to the IPv4 pattern ONLY — its own header
 * says so, citing #83's acceptance command — and files the other two patterns' repo-wide sweep as future
 * work (#85, for the SSH-key-filename shape specifically). So as of this narrowing, this file is the ONLY
 * guard checking the SSH-key-filename and `pct exec` patterns anywhere in the tree, even though it only
 * checks them on `.md`. Deleting this file rather than narrowing it would have silently dropped that
 * coverage — the exact "a remedy applied at one call site when the behaviour reaches several" shape this
 * repo keeps finding, arriving in a leak guard's own scope this time.
 *
 * ## Why this reuses `LEAK_PATTERNS` rather than writing a second detector
 *
 * `docs/roles/memory/nvda-worker-vm-access.md` already had a leak guard (`roles-memory.test.ts`) scoped to
 * one directory. This is the SAME regexes (`packages/lab/src/packaging/leak-patterns.mjs`), walking every
 * tracked `.md` file instead — a second, independently-typed copy of the rule is exactly the "a fact
 * stated twice, and the copies drifted" shape this repo's own CLAUDE.md names as its most expensive
 * recurring defect.
 *
 * ## Why the population is DISCOVERED, not hand-listed
 *
 * `git ls-files '*.md'` — never a written-out list of "the docs that matter" — with a vacuity floor, so a
 * broken discovery that silently walks zero files fails loudly rather than reading as a clean sweep.
 *
 * ## Why matches are read from COLLAPSED whole-file text, not line by line
 *
 * A citation, a search target or a mutation target in this repo is as likely to be split across a
 * hard-wrapped line as not (CLAUDE.md itself, repeatedly). The `pct exec` idiom contains an internal
 * space, so a literal line-by-line scan could miss it wrapped mid-token. Collapsing every run of
 * whitespace to one space before matching removes that failure mode without changing what the pattern
 * means.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LEAK_PATTERNS, allLeaksIn } from "./leak-patterns.mjs";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Below this, `git ls-files` almost certainly ran from the wrong directory or matched nothing. */
const MIN_TRACKED_MARKDOWN_FILES = 50;

/** The IPv4 pattern is `tracked-source-leak-guard.test.ts`'s job now — see this file's header (#119). */
const IN_SCOPE = ["a named SSH private key file", "a live pct exec container-hop command"];

function trackedMarkdownFiles(): string[] {
  return walkTree({ kind: "all", roots: [] }).map((f) => f.path).filter((f) => f.endsWith(".md"));
}

/** Collapsed so a match cannot be defeated by a hard-wrapped line boundary. */
function collapsedText(file: string): string {
  return readFileSync(`${REPO}${file}`, "utf8").replace(/\s+/g, " ");
}

function findLeaks(text: string) {
  return allLeaksIn(text).filter(({ name }) => IN_SCOPE.includes(name));
}

test("the tracked-markdown population is real, not an empty or misrooted discovery", () => {
  const files = trackedMarkdownFiles();
  assert.ok(files.length >= MIN_TRACKED_MARKDOWN_FILES,
    `expected at least ${MIN_TRACKED_MARKDOWN_FILES} tracked .md files, found ${files.length} — ` +
    "a broken discovery examining nothing must fail loudly, not read as a clean sweep");
});

test("no tracked .md file carries a named SSH key file or a pct-exec idiom", () => {
  const offenders: string[] = [];
  for (const file of trackedMarkdownFiles()) {
    const leaks = findLeaks(collapsedText(file));
    for (const leak of leaks) offenders.push(`${file}: ${leak.name} — "${leak.value}"`);
  }
  assert.deepEqual(offenders, [],
    `found ${offenders.length} unexempted leak(s):\n${offenders.join("\n")}`);
});

test("MUTATION: each in-scope pattern fires on a synthetic leak of its own shape", () => {
  const samples: Record<string, string> = {
    "a named SSH private key file": "load ~/.ssh/a11y-fixture_ed25519 first",
    "a live pct exec container-hop command": "run pct exec 121 -- bash -lc 'echo hi'",
  };
  for (const name of IN_SCOPE) {
    const pattern = LEAK_PATTERNS.find((p) => p.name === name)?.pattern;
    assert.ok(pattern, `LEAK_PATTERNS no longer declares "${name}" — this guard's scope has drifted`);
    const sample = samples[name];
    assert.ok(sample, `no synthetic sample defined for pattern "${name}" — add one so this stays proven`);
    assert.ok(pattern!.test(sample), `pattern "${name}" did not fire on its own synthetic leak: "${sample}"`);
  }
});

test("MUTATION: a real pct-exec idiom reintroduced into a currently-clean file is caught", () => {
  const file = "docs/adr/0013-lab-job-control.md";
  const clean = collapsedText(file);
  const reintroduced = clean.replace(
    "ssh root@<the lab's host> 'pct exec <container id>",
    "ssh root@<the lab's host> 'pct exec 121",
  );
  assert.notEqual(reintroduced, clean, "the replacement did not match — the fixture text has drifted");
  const leaks = findLeaks(reintroduced);
  assert.ok(leaks.length >= 1,
    `expected the reintroduced pct-exec idiom to be caught, found: ${JSON.stringify(leaks)}`);
});

test("CONTROL: the IPv4 pattern is deliberately out of scope here — see tracked-source-leak-guard.test.ts", () => {
  const leaks = findLeaks("reach it at REDACTED-INTERNAL-ADDRESS over ssh");
  assert.deepEqual(leaks, [], "the IPv4 pattern must not fire here; it would be a second, drifting check");
});
