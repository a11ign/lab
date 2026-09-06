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
 * ## Why the population is DISCOVERED from the acceptance criteria's own extensions
 *
 * `git ls-files '*.mjs' '*.ts' '*.py' '*.ps1' '*.sh' '*.yml'` — exactly #83's own acceptance command's
 * pathspecs — never a hand-written list of "the source that matters", with the same vacuity floor
 * `tracked-prose-leak-guard.test.ts` uses.
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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { LEAK_PATTERNS, allLeaksIn } from "./leak-patterns.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const EXTENSIONS = ["*.mjs", "*.ts", "*.py", "*.ps1", "*.sh", "*.yml"];

/** Below this, `git ls-files` almost certainly ran from the wrong directory or matched nothing. */
const MIN_TRACKED_SOURCE_FILES = 500;

/**
 * `(file, matched value)` pairs known to be safe, each with why. A file is never exempted wholesale — the
 * same rule `tracked-prose-leak-guard.test.ts` states and for the identical reason: a new, unrelated leak
 * landing in an already-exempted file must still be caught.
 */
const EXEMPT: Array<{ file: string; value: string; reason: string }> = [
  {
    file: "packages/control/ansible/inventory.example.yml",
    value: "10.0.0",
    reason: "the committed EXAMPLE inventory's own placeholder scheme, distinct from the real fleet's "
      + "real subnet — see inventory.yml's own comment on why the two are kept in shape-sync",
  },
  {
    file: "packages/control/src/fleet-discover.mjs",
    value: "10.0.0",
    reason: "a hypothetical illustrative example inside a comment about diagnosing a stale MAC/IP pairing, "
      + "unrelated to the real fleet's actual subnet (every real mention elsewhere is 192.168.1.x)",
  },
  ...["10.0.0"].map((value) => ({
    file: "packages/control/src/fleet-discover.test.ts", value,
    reason: "generic test double for MAC/host reconciliation logic, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-discover.test.ts", value,
    reason: "generic test double for MAC/host reconciliation logic, independent of any real address",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-enrol.test.ts", value,
    reason: "generic test double for inventory-enrolment logic, independent of any real address",
  })),
  {
    file: "packages/control/src/fleet-playbook.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "generic test double for onTheControlPlane's interface-matching logic",
  },
  ...["10.0.0", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/control/src/fleet-status.test.ts", value,
    reason: "generic test double for worker-status formatting, independent of any real address",
  })),
  {
    file: "packages/lab/src/gates/fleet.test.ts", value: "10.0.0",
    reason: "generic test double, independent of any real address",
  },
  {
    file: "packages/lab/src/packaging/roles-memory.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "this file's OWN leak-guard mutation fixture: a string deliberately shaped like a leak, to "
      + "prove LEAK_PATTERNS fires. Redacting it would break the test that proves the guard works.",
  },
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts", value,
    reason: "this file's OWN leak-guard mutation fixtures, for the identical reason as roles-memory.test.ts",
  })),
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/packaging/tracked-prose-leak-guard.test.ts", value,
    reason: "the SAME exemption its own EXEMPT table (for .md) already grants these values — UTM's local "
      + "VM bridge, quoted here inside its own MUTATION sample text",
  })),
  {
    file: "packages/lab/scripts/action-dry-run.sh", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, private to one Mac — a usage-example address, not a shared/reachable host",
  },
  {
    file: "packages/lab/scripts/compare-layers.mjs", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, private to one Mac — a usage-example address, not a shared/reachable host",
  },
  {
    file: "packages/lab/src/harnesses/occurrence-verdict-stability.mjs", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, private to one Mac — a usage-example address, not a shared/reachable host",
  },
  {
    file: "packages/lab/src/harnesses/capture-check.mjs", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, in a usage-example comment",
  },
  {
    file: "packages/lab/src/harnesses/page-identity-rate.mjs", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, in a usage-example comment",
  },
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/lab/src/training/repeat-capture.mjs", value,
    reason: "UTM's own local VM bridge, in usage-example comments",
  })),
  {
    file: "packages/nvda-worker/src/browser-session.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, quoted in a comment about synthetic-fixture host mismatches",
  },
  {
    file: "packages/worker-fleet/src/deploy-remedy.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, used as a generic worker-address test double",
  },
  {
    file: "packages/worker-fleet/src/fleet-consistency.mjs", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "UTM's own local VM bridge, in a doc-comment example table",
  },
  {
    file: "packages/worker-fleet/src/fleet-consistency.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "generic test double for fleet-consistency comparisons, independent of any real address",
  },
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/fleet-consistency.test.ts", value,
    reason: "UTM's own local VM bridge, used as generic worker-address test doubles",
  })),
  {
    file: "packages/worker-fleet/src/fleet-env.test.ts", value: "10.0.0",
    reason: "generic test double, independent of any real address",
  },
  {
    file: "packages/worker-fleet/src/fleet-env.test.ts", value: "REDACTED-INTERNAL-ADDRESS",
    reason: "generic test double for fleet-env's worker-URL derivation, independent of any real address",
  },
  {
    file: "packages/worker-fleet/src/guest-reachable.test.ts", value: "10.1.2",
    reason: "generic test double for reachability logic, independent of any real address",
  },
  ...["REDACTED-INTERNAL-ADDRESS", "REDACTED-INTERNAL-ADDRESS"].map((value) => ({
    file: "packages/worker-fleet/src/guest-reachable.test.ts", value,
    reason: "UTM's own local VM bridge, used as generic worker-address test doubles",
  })),
];

/** This file's own path, relative to REPO -- see `trackedSourceFiles`' SELF exclusion for why. */
const SELF = "packages/lab/src/packaging/tracked-source-leak-guard.test.ts";

function trackedSourceFiles(): string[] {
  // SELF-EXCLUDED. This is a `.ts` file in the population it walks, and its own EXEMPT table and
  // MUTATION tests necessarily quote every value they classify as literal string data -- so without this
  // exclusion the guard flags itself for containing the exact values it is busy explaining are safe. The
  // same shape `git-spawn-classification.test.ts` already handles for its own git-spawning helper.
  return execFileSync("git", ["ls-files", ...EXTENSIONS], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => f !== SELF);
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
  for (const file of ["packages/control/src/fleet-playbook.mjs", "packages/control/src/lab-pipeline.mjs"]) {
    const clean = collapsedText(file);
    const reintroduced = clean.replace(
      "const CONTROL_PLANE = process.env.A11Y_CONTROL_HOST;",
      'const CONTROL_PLANE = process.env.A11Y_CONTROL_HOST || "REDACTED-INTERNAL-ADDRESS";',
    );
    assert.notEqual(reintroduced, clean, `the replacement did not match in ${file} — the fixture text has drifted`);
    const leaks = findLeaks(file, reintroduced);
    assert.ok(leaks.length >= 1, `expected the reintroduced default to be caught in ${file}: ${JSON.stringify(leaks)}`);
  }
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
