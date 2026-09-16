/**
 * #83: `tracked-prose-leak-guard.test.ts` was scoped to `.md` — per its OWN brief's wording, "prose" — and
 * a real fleet address sat the whole time in a SOURCE COMMENT, in `worker-http.mjs`, outside that
 * population entirely. The sweep was correct and complete against the population it was given; the
 * population was narrower than the exposure. **The scope gap was the finding, not a missed regex.**
 *
 * ## Why a blanket redaction of every hit would have been exactly wrong
 *
 * Measured before writing this file, not estimated: the private-LAN-IPv4 pattern alone matches 41
 * (file, value) pairs across 21 tracked source files. Classifying each by hand found:
 *
 *   - a handful of REAL addresses, all fixed as part of #83 rather than exempted here — two of them were
 *     not even in a comment: `fleet-playbook.mjs` and `lab-pipeline.mjs` hardcoded the real control-plane
 *     address as a silent fallback default (`control-plane-host.mjs` now refuses instead of guessing),
 *     and roughly a dozen `.test.ts` files reused the SAME real worker octets named in this repo's own
 *     `CLAUDE.md` incident record (`.107`, `.59`, `.175`, `.224`) as their fixture data — not independently
 *     chosen doubles, evidently copied from real output when the tests were written. All were replaced
 *     with values from the RFC 5737 documentation range (`203.0.113.0/24`), which cannot resolve to
 *     anything real and is reserved for exactly this.
 *   - `192.168.64.x` is UTM's own local VM bridge, private to a single Mac — the SAME judgement
 *     `tracked-prose-leak-guard.test.ts`'s own EXEMPT table already makes, reused here rather than
 *     re-litigated.
 *   - `10.0.0.x` / `10.1.2.x` are deliberate placeholder schemes (the committed EXAMPLE inventory, a
 *     hypothetical illustration in a comment, and generic test doubles for MAC/host reconciliation logic)
 *     with no correlation to anything real.
 *   - Two `.test.ts` files ARE the leak guards' own mutation fixtures (`roles-memory.test.ts`,
 *     `tracked-prose-leak-guard.test.ts`) — synthetic strings deliberately SHAPED like a leak, to prove
 *     detection fires. Redacting those would break the thing proving this guard works.
 *
 * A regex cannot make any of these calls, which is why this is a table with a reason on every row, never
 * a bare list — the same discipline `tracked-prose-leak-guard.test.ts` already established. Reused rather
 * than duplicated: `allLeaksIn` (`leak-patterns.mjs`) is the one matcher both files drive.
 *
 * ## #119: this file's IPv4-pattern EXEMPT entries are now the ONLY copy
 *
 * Every one of `tracked-prose-leak-guard.test.ts`'s ten `.md` EXEMPT entries was already duplicated here
 * (verified by diffing both tables, not assumed), so #119 narrowed that file to stop checking the IPv4
 * pattern at all rather than fold anything in — there was nothing left to fold. That file still exists,
 * scoped to the two patterns this file deliberately excludes (see below); it is not redundant, only
 * narrower than it used to be.
 *
 * ## Why the population is EVERY TRACKED FILE, not an extension allowlist (#86)
 *
 * This file used to walk `git ls-files '*.mjs' '*.ts' '*.py' '*.ps1' '*.sh' '*.yml'` — #83's own
 * acceptance command's pathspecs. Two real addresses survived one door along: a control-plane host
 * hardcoded in `autounattend.xml`'s PXE bootstrap URL, and a lab address baked into two captured
 * eval fixtures (`.json`). **The SAME shape as #83's own finding, one file type over** — an extension
 * list is a claim about where the exposure can be, and that claim was wrong twice. Now `git ls-files`
 * with no pathspec at all — every tracked, non-binary file — with the same vacuity floor as before.
 * "Binary" is the standard NUL-byte-in-the-first-8000-bytes heuristic (`looksBinary`), the same one
 * git itself uses, so a genuine asset (this repo has exactly one) is skipped rather than decoded as
 * garbage text and matched against nothing meaningful.
 *
 * ## A regex bug the widened sweep surfaced, unrelated to scope
 *
 * `LEAK_PATTERNS`'s private-LAN-IPv4 pattern required only THREE octets for its bare-`10` branch —
 * `10` plus two `\d{1,3}` groups is `10.x.y`, one short of a real address — because `\b` is satisfied
 * by any non-word character, `.` included, so the match simply stopped early. Widening the population
 * exposed it at scale: an Intel driver INF's Windows platform-version decorations
 * (`NTamd64.10.0.1..17763`) and ordinary npm semver in `package-lock.json` (`"10.0.0"`) both satisfy
 * three octets and neither is an address — 444 and ~30 false matches respectively, gone entirely once
 * `leak-patterns.mjs`'s pattern was corrected to spell each branch's own full four-octet shape. Fixed
 * there rather than here, since every consumer (`tracked-prose-leak-guard.test.ts`,
 * `roles-memory.test.ts`) shares the one matcher and the bug reached all three.
 *
 * ## A redaction choice that broke a DIFFERENT test, found only by running the full suite
 *
 * `menus-good.json`/`menus-bad.json` carried a real leaked address (`REDACTED-INTERNAL-ADDRESS`, the lab's own LAN
 * IP) in the eval fixtures' `url` field. The first fix used an RFC 5737 documentation-range value
 * (`203.0.113.20`) — correct for a value nobody must ever act on, and wrong here specifically:
 * `rule-coverage-populations.test.ts` classifies a fixture as "real evidence of a live website" purely
 * from that URL's host, excluding `192.168.x` by name but not `203.0.113.x`, so the RFC 5737 swap
 * silently promoted two page-server captures into the population that test exists to keep narrow —
 * `npm test` failed on a file this row never touched. Replaced instead with `REDACTED-INTERNAL-ADDRESS`, the same
 * UTM-bridge placeholder every sibling `tutorials/*.json` fixture already carries (both are exempted
 * below on that basis), which is excluded by that regex and consistent with the other ten files in the
 * same directory rather than a one-off deviation.
 *
 * Separately: the issue that filed this row suggested `git grep -nE '\b(10|192\.168|...)...'` as a
 * manual verification command. On this git build (`git version 2.50.1`, Apple Git), `-E` does not
 * support `\b` as a word boundary the way GNU grep or a JS `RegExp` does — the suggested command
 * matches NOTHING, silently, even against a file containing the exact address it names. `-P` (PCRE)
 * works. Not this file's mechanism (it uses `allLeaksIn`'s JS `RegExp`, unaffected), but worth knowing
 * before anyone runs that command by hand and reads a clean sweep as proof.
 *
 * ## Scoped to the IPv4 pattern only — #83's own acceptance command, not all of `LEAK_PATTERNS`
 *
 * Running `allLeaksIn` unfiltered against this population also fires the SSH-key-filename pattern, widely
 * — `~/.ssh/a11y-pve_ed25519`, `~/.ssh/a11y-witness_ed25519` and similar appear as hardcoded fallback
 * DEFAULTS (`process.env.A11Y_PVE_KEY || "..."`, the identical shape #83's CONTROL_PLANE fix removed) in
 * roughly a dozen files across `packages/control` and `packages/worker-fleet`. That is real and worth
 * fixing, but it is a DIFFERENT class of exposure from a real fleet ADDRESS — #83's own title and
 * acceptance command are about the IPv4 pattern specifically — and each hardcoded key-path default needs
 * the same care `control-plane-host.mjs` took (confirm nothing depends on the silent fallback before
 * removing it) across roughly a dozen call sites. Filed separately rather than folded in here, the same
 * deliberate split #83 itself draws against #78: same class of exposure, different decision, different cost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LEAK_PATTERNS, allLeaksIn } from "./leak-patterns.mjs";
import { declareTreeWideGuard, walkTree } from "../../../guards/src/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Below this, `git ls-files` almost certainly ran from the wrong directory or matched nothing. */
const MIN_TRACKED_SOURCE_FILES = 500;

/**
 * `(file, matched value)` pairs known to be safe, each with why. A file is never exempted wholesale — the
 * same rule `tracked-prose-leak-guard.test.ts` states and for the identical reason: a new, unrelated leak
 * landing in an already-exempted file must still be caught.
 */
const EXEMPT: Array<{ file: string; value: string; reason: string }> = [
  // === UTM's local VM bridge (192.168.64.x), private to a single Mac -- #83's own EXEMPT
  // table already made this call; reused here across every new file type it now appears in,
  // rather than re-litigated per file.
  // #1240: the `capture:check` example that carries this address moved out of root CLAUDE.md with
  // "Verifying changes". The exemption follows the TEXT, not the filename it used to be under -- an
  // exemption left pointing at a file the value no longer appears in is debris that hides nothing.
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: ".github/CLAUDE.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "PLAN.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "docs/capture-phase-breakdown-audit.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "docs/local-worker-vm.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/cli/README.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/scripts/action-dry-run.sh", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/scripts/compare-layers.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/alt-quality-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/alt-quality-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/custom-control-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/custom-control-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/filter-status-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/headings-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/headings-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/links-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/books/links-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/carousels-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/carousels-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/disclosure-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/disclosure-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/forms-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/forms-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/forms-validation-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/forms-validation-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/images-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/images-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  // menus-{good,bad} carried a REAL leaked address (REDACTED-INTERNAL-ADDRESS, #86) before this row -- fixed by
  // replacing it with the same UTM-bridge placeholder every sibling tutorial fixture already uses,
  // not an RFC 5737 value: rule-coverage-populations.test.ts classifies a fixture as "real evidence of
  // a live website" from its URL's host alone, and its exclusion regex knows 192.168.x but not
  // 203.0.113.x -- an RFC 5737 replacement here silently promoted these two page-server captures into
  // the real-page population the audit exists to keep narrow. Found by running the full suite, not by
  // inspection.
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/menus-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/menus-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/structure-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/structure-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/tables-bad.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/eval/fixtures/tutorials/tables-good.json", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/harnesses/capture-check.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/harnesses/occurrence-verdict-stability.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/harnesses/page-identity-rate.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/training/README.md", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/training/repeat-capture.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/nvda-worker/src/browser-session.test.ts", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/deploy-remedy.test.ts", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/fleet-consistency.mjs", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/fleet-consistency.test.ts", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/guest-reachable.test.ts", value,
    reason: "UTM's own local VM bridge, private to a single Mac",
  })),

  // === The committed EXAMPLE inventory's own placeholder scheme (#86 widened the sweep to
  // .yml's full tracked population; already implicitly safe, now explicit).
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/ansible/inventory.example.yml", value,
    reason: "the committed EXAMPLE inventory's own placeholder scheme, distinct from the real fleet's "
      + "real subnet — see inventory.yml's own comment on why the two are kept in shape-sync",
  })),

  // === This file's OWN leak-guard mutation fixtures -- synthetic strings deliberately shaped
  // like a leak, to prove LEAK_PATTERNS fires. Redacting them would break the proof.
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/packaging/roles-memory.test.ts", value,
    reason: "this file's OWN leak-guard mutation fixture: a string deliberately shaped like a leak, "
      + "to prove LEAK_PATTERNS fires. Redacting it would break the test that proves the guard works.",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts", value,
    reason: "this file's OWN CONTROL case proving the IPv4 pattern is deliberately out of scope there "
      + "(#119) — a synthetic value shaped like a leak, never a real address.",
  })),

  // === Generic test doubles for fleet/worker/enrolment logic, independent of any real address.
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-discover.mjs", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-discover.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-enrol.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-playbook.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-status.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/gates/fleet.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/fleet-consistency.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/fleet-env.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/guest-reachable.test.ts", value,
    reason: "generic test double, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/packaging/history-secret-scan.test.ts", value,
    reason: "generic test double, independent of any real address -- the fixture history-secret-scan.mjs "
      + "exists to FIND this exact shape, so its own test necessarily embeds one",
  })),

];

/** This file's own path, relative to REPO -- see `trackedSourceFiles`' SELF exclusion for why. */
const SELF = "packages/lab/src/packaging/tracked-source-leak-guard.test.ts";

/**
 * The standard "does this look binary" heuristic -- the first 8000 bytes contain a NUL byte -- which is
 * the same test git's own `buffer_is_binary` uses internally. Read as raw bytes, never as UTF-8: decoding
 * a genuinely binary file as text can throw, or worse, silently produce garbage that happens not to throw
 * and is then scanned for nothing meaningful.
 */
function looksBinary(absolutePath: string): boolean {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(8000);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

function trackedSourceFiles(): string[] {
  // EVERY TRACKED FILE, not an extension allowlist (#86). #83 scoped this to `.mjs .ts .py .ps1 .sh .yml`
  // and two real addresses survived one door along, in `.xml` and `.json` -- the THIRD time this repo's
  // most-recorded defect (a population narrower than the exposure) has shown up in this one
  // investigation. The remedy #86 names is to sweep everything and classify by CONTENT, with any
  // exclusion an explicit, reasoned exemption rather than a list of what to look at.
  //
  // SELF-EXCLUDED. This is a `.ts` file in the population it walks, and its own EXEMPT table and
  // MUTATION tests necessarily quote every value they classify as literal string data -- so without this
  // exclusion the guard flags itself for containing the exact values it is busy explaining are safe. The
  // same shape `git-spawn-classification.test.ts` already handles for its own git-spawning helper.
  return walkTree({ kind: "all", roots: [], selfPath: SELF }).map((f) => f.path)
    .filter((f) => f !== SELF)
    .filter((f) => !looksBinary(`${REPO}${f}`));
}

/** Collapsed so a match cannot be defeated by a wrapped comment or a multi-line template literal. */
function collapsedText(file: string): string {
  return readFileSync(`${REPO}${file}`, "utf8").replace(/\s+/g, " ");
}

/** Only the pattern #83 is about — see this file's header for why the other two are out of scope here. */
const IN_SCOPE = "private LAN IPv4 address";

function findLeaks(file: string, text: string) {
  return allLeaksIn(text)
    .filter((leak) => leak.name === IN_SCOPE)
    .filter(({ value }) => !EXEMPT.some((e) => e.file === file && e.value === value));
}

test("the tracked-source population is real, not an empty or misrooted discovery", () => {
  const files = trackedSourceFiles();
  assert.ok(files.length >= MIN_TRACKED_SOURCE_FILES,
    `expected at least ${MIN_TRACKED_SOURCE_FILES} tracked source files, found ${files.length} — ` +
    "a broken discovery examining nothing must fail loudly, not read as a clean sweep");
});

test("no tracked source file carries a real internal LAN address (#83's own acceptance pattern)", () => {
  const offenders: string[] = [];
  for (const file of trackedSourceFiles()) {
    const leaks = findLeaks(file, collapsedText(file));
    for (const leak of leaks) offenders.push(`${file}: ${leak.name} — "${leak.value}"`);
  }
  assert.deepEqual(offenders, [],
    `found ${offenders.length} unexempted leak(s) — classify each as real (fix it) or synthetic (add to `
    + `EXEMPT with why):\n${offenders.join("\n")}`);
});

test("every EXEMPT entry still matches something real in its file — a stale exemption hides nothing", () => {
  for (const { file, value } of EXEMPT) {
    const text = collapsedText(file);
    assert.ok(text.includes(value),
      `EXEMPT names ${file} -> "${value}", but that file no longer contains it — remove the stale entry`);
  }
});

test("every EXEMPT entry names a file this discovery actually walks", () => {
  const files = new Set(trackedSourceFiles());
  for (const { file } of EXEMPT) {
    assert.ok(files.has(file), `EXEMPT names ${file}, which is not among the tracked source files walked`);
  }
});

test("MUTATION: a real leak reintroduced into a currently-clean source file is caught", () => {
  const file = "packages/worker-fleet/src/host-address.mjs";
  const clean = collapsedText(file);
  const reintroduced = clean.replace(
    "against a bare-metal worker on the fleet's own LAN",
    "against a bare-metal worker at REDACTED-INTERNAL-ADDRESS",
  );
  assert.notEqual(reintroduced, clean, "the replacement did not match — the fixture text has drifted");
  const leaks = findLeaks(file, reintroduced);
  assert.ok(leaks.length >= 1, `expected the reintroduced address to be caught, found: ${JSON.stringify(leaks)}`);
});

test("MUTATION: the hardcoded control-plane fallback this row removed does not silently come back", () => {
  // #285: `CONTROL_PLANE` stopped being a bare `= process.env.A11Y_CONTROL_HOST` at import time -- it is
  // now resolved by `requireControlPlaneHost()` inside `main()`, so a reintroduced fallback would sit on
  // THAT line instead. The detector this test proves is unchanged (`findLeaks` scans the whole collapsed
  // file for a private-LAN IPv4 literal, not this one line specifically) -- only the fixture moved with it.
  for (const file of ["packages/control/src/fleet-playbook.mjs", "packages/control/src/lab-pipeline.mjs"]) {
    const clean = collapsedText(file);
    const reintroduced = clean.replace(
      "CONTROL_PLANE = requireControlPlaneHost();",
      'CONTROL_PLANE = requireControlPlaneHost() || "REDACTED-INTERNAL-ADDRESS";',
    );
    assert.notEqual(reintroduced, clean, `the replacement did not match in ${file} — the fixture text has drifted`);
    const leaks = findLeaks(file, reintroduced);
    assert.ok(leaks.length >= 1, `expected the reintroduced default to be caught in ${file}: ${JSON.stringify(leaks)}`);
  }
});

test("MUTATION: removing an EXEMPT entry the #119 fold inherited from the prose guard fails, by name", () => {
  // #119 narrowed tracked-prose-leak-guard.test.ts to stop checking the IPv4 pattern, on the strength that
  // every one of its ten EXEMPT entries was already present here — verified by diffing both tables, not
  // assumed. This proves the inheritance is load-bearing rather than decorative: drop one entry from a
  // COPY of EXEMPT and confirm the file it names starts reading as an offender again, by that exact name.
  const file = ".github/CLAUDE.md";  // #1240: follows the text, not the old filename
  const value = "REDACTED-INTERNAL-ADDRESS";
  assert.ok(EXEMPT.some((e) => e.file === file && e.value === value),
    `fixture assumption broke: ${file} -> "${value}" is no longer in EXEMPT`);
  const withoutInheritedEntry = EXEMPT.filter((e) => !(e.file === file && e.value === value));
  const leaksIfDropped = allLeaksIn(collapsedText(file))
    .filter((leak) => leak.name === IN_SCOPE)
    .filter(({ value: v }) => !withoutInheritedEntry.some((e) => e.file === file && e.value === v));
  assert.ok(leaksIfDropped.some((l) => l.value === value),
    `dropping ${file} -> "${value}" from EXEMPT did not surface it as an offender -- the guard is not `
    + "actually reading this entry, or the file no longer contains the value");
});

test("every LEAK_PATTERNS entry is exercised by at least one EXEMPT or MUTATION case here", () => {
  // A pattern this file never triggers, even via mutation, is a pattern this guard has not proven it can
  // see for the SOURCE population — the same "a guard must be shown to fail before it is trusted" rule.
  const exercised = new Set(EXEMPT.map((e) => e.value));
  const ipv4Exercised = [...exercised].some((v) => /^\d/.test(v));
  assert.ok(ipv4Exercised, "no EXEMPT entry exercises the private-LAN-IPv4 pattern");
  assert.ok(LEAK_PATTERNS.some((p) => p.name === "private LAN IPv4 address"),
    "LEAK_PATTERNS no longer declares the pattern this file was written to close a scope gap for");
});
