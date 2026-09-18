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
  // EMPTY SINCE 2026-09-18, AND THE EMPTINESS IS THE POINT. Every entry here was a file allowed to carry
  // UTM's local VM bridge address (192.168.64.x). #63's history purge replaced every RFC 1918 address in
  // the tree with `REDACTED-INTERNAL-ADDRESS`, so not one tracked file carries a private address any more
  // -- verified by the tree-wide control below, which is where this emptiness is proven rather than
  // assumed. This guard's own rule applies to itself: "an exemption left pointing at a file the value no
  // longer appears in is debris that hides nothing."
  //
  // THE PURGE ALSO REWROTE THIS TABLE, which is why it had to be read rather than trusted. Every `value`
  // here became the literal string `REDACTED-INTERNAL-ADDRESS`, so the exemptions stopped naming anything
  // and this file's own mutation tests stopped having an address to fire on -- a guard neutered by the
  // sweep it exists to make safe. Anything that must BE private-shaped is now built from octets (see
  // `privateAddress`), so no future text rewrite can quietly do it again.
  //
  // A new leak still needs a new entry, with its reason, exactly as before.
];

/**
 * A private-LAN address, BUILT FROM OCTETS so no text rewrite can neuter it.
 *
 * Writing one out is what left this file unable to prove its own pattern fires: #63's purge rewrote the
 * literals, the mutation tests then injected the string `REDACTED-INTERNAL-ADDRESS`, and `findLeaks`
 * correctly found nothing. A built address survives any `--replace-text` pass, and `tracked-source-leak-
 * guard` refusing a literal one in this very file is the other half of why it has to be built.
 */
const privateAddress = (...octets: number[]) => octets.join(".");

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
    `against a bare-metal worker at ${privateAddress(192, 168, 64, 1)}`,
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
      `CONTROL_PLANE = requireControlPlaneHost() || "${privateAddress(10, 0, 0, 7)}";`,
    );
    assert.notEqual(reintroduced, clean, `the replacement did not match in ${file} — the fixture text has drifted`);
    const leaks = findLeaks(file, reintroduced);
    assert.ok(leaks.length >= 1, `expected the reintroduced default to be caught in ${file}: ${JSON.stringify(leaks)}`);
  }
});

/**
 * THE CONTROL ON AN EMPTY `EXEMPT`, and this repository's own rule for one: an emptiness assertion names
 * where its positive control lives, and the writer has to be able to point at it. EXEMPT is empty because
 * the tree genuinely carries no private address -- not because the table drifted, and not because the
 * guard stopped looking. This measures the first claim directly.
 *
 * It replaces a test that dropped one EXEMPT entry and checked the file it named read as an offender
 * again. That proved the inheritance from `tracked-prose-leak-guard` was load-bearing; with no entries
 * and no addresses left in the tree, it had no subject. The MUTATION tests above are what now prove the
 * pattern can fire at all.
 */
test("EXEMPT is empty because the TREE is clean -- not because the table drifted", () => {
  // NOT A SECOND SWEEP. "no tracked source file carries a real internal LAN address" above already walks
  // the population and is where this emptiness is MEASURED; re-walking it here would be the
  // fact-stated-twice shape this repository keeps finding in its own tooling. This states the other half:
  // that an empty table is the correct reading of that sweep rather than a table that quietly rotted.
  assert.deepEqual(EXEMPT, [],
    "an entry here while that sweep is green is the debris this table's own rule refuses -- an exemption "
    + "pointing at a value the file no longer contains hides nothing and outlives its reason. When a new "
    + "leak is genuinely synthetic, add it back WITH its address built from octets, never written out.");
});

test("every LEAK_PATTERNS entry is exercised by at least one EXEMPT or MUTATION case here", () => {
  // A pattern this file never triggers, even via mutation, is a pattern this guard has not proven it can
  // see for the SOURCE population — the same "a guard must be shown to fail before it is trusted" rule.
  // EXERCISED BY MUTATION, NOT BY EXEMPT (2026-09-18). This read EXEMPT for a value starting with a
  // digit, which worked only while some file was allowed to carry an address. The purge emptied that
  // table, so the pattern is now proven by the two MUTATION cases above -- which is the stronger proof
  // anyway: an exemption shows the guard TOLERATES a value, a mutation shows it CATCHES one.
  const injected = privateAddress(192, 168, 64, 1);
  assert.ok(findLeaks("packages/worker-fleet/src/host-address.mjs", `x ${injected} y`).length >= 1,
    "nothing here exercises the private-LAN-IPv4 pattern -- a pattern this file never triggers is one "
    + "the guard has not proven it can see for the SOURCE population");
  assert.ok(LEAK_PATTERNS.some((p) => p.name === "private LAN IPv4 address"),
    "LEAK_PATTERNS no longer declares the pattern this file was written to close a scope gap for");
});
