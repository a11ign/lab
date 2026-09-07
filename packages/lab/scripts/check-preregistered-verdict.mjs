#!/usr/bin/env node
// DID THE PRE-REGISTERED STATISTIC ACTUALLY ARRIVE? — the check that a run reported the number it said
// it would, rather than a number.
//
//   npm run verdict:preregistered            report, and refuse if a declared statistic is absent
//
// ## The incident (#103)
//
// #22 stated its falsifier in advance and named the statistic that would settle it: *"Per-capture median
// and IQR at each arm, plus wall time. **The verdict is whether the median moved.**"* — with the reason
// beside it: *"stating the falsifier before the run is what makes this a measurement rather than a
// justification."*
//
// **The per-arm median was not recovered.** The run produced a wall-clock-derived proxy, the proxy
// answered the question the same way, and a hardware purchase recommendation turned on it. Nothing in the
// pipeline noticed the pre-registered statistic was missing; a person reading the row did.
//
// ## Why the failure is silent by construction
//
// A run that produces SOMETHING looks like a run that produced THE THING. The proxy is usually
// reasonable, so the result is usually right — which is exactly what makes it dangerous, because it
// trains everyone to accept the substitution. And **the substitution is invisible in the output**: the
// number is there, and only the row says which number it was supposed to be.
//
// This repo already knows the shape as *a check that reports success having examined nothing*. This is a
// check that reports success having examined SOMETHING ELSE.
//
// ## The three outcomes, which is the whole design
//
//   ARRIVED        the declared statistic appears in the recorded output
//   MISSING        it does not — REFUSED, because "the median is missing" and "the median did not move"
//                  are different findings and only one of them is a result. Same rule as BLIND versus
//                  CONTAMINATED in `check-signals`, and as 404 versus 202 on the capture route.
//   PROXY, DECLARED  the entry says outright that it reports a proxy, and for which statistic. Allowed,
//                  and the caveat then travels WITH the number instead of living in an issue comment —
//                  which is where it lived this time.
//
// A run may not be silently proxied and may not be silently short. It may be honestly either.
import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { REPO_ROOT } from "../src/dataset-paths.mjs";
import { gateVerdict, renderVerdict, exitCodeFor } from "../src/gates/verdict.mjs";

// EXIT CODES COME FROM `gateVerdict`, not from a bespoke set, and the mapping is the honest one:
//
//   of        every recorded gate           -- the population a reader might think this covered
//   examined  those DECLARING a statistic   -- the ones this check can actually ask about
//   failures  those that declared and did not report it
//
// So a file where nothing declares one is `examined 0 < of N` -> INCONCLUSIVE, never PASS. That is the
// case this check is in most danger from: an entry that declares nothing must never be counted as one
// that reported everything, and the shared helper puts COVERAGE FIRST for exactly that reason -- its own
// comment says reversing those two lines reproduces the 2-of-48 defect.

/**
 * The verdict on one recorded gate entry.
 *
 * PURE, over the entry rather than over the file, so every outcome is reachable in a test without
 * arranging a real run — which for a scaling shard means hours of fleet time.
 *
 * @param {{command?: string, output?: string, verdictStatistic?: string|string[], proxyFor?: string}} entry
 * @returns {{state: "arrived"|"missing"|"proxy"|"undeclared", why: string}}
 */
export function verdictStatisticState(entry) {
  const declared = [entry?.verdictStatistic ?? []].flat().filter((s) => typeof s === "string" && s.trim());
  if (!declared.length) {
    return { state: "undeclared",
      why: "declares no verdictStatistic, so there is nothing to check it reported" };
  }
  const output = String(entry.output ?? "");
  const absent = declared.filter((token) => !output.toLowerCase().includes(token.toLowerCase()));
  if (!absent.length) return { state: "arrived", why: `output contains ${declared.join(", ")}` };

  // A DECLARED PROXY IS A DIFFERENT OUTCOME FROM A SILENT ONE. The substitution is the thing this check
  // exists to surface, not the thing it forbids: a run that says "I report a wall-clock proxy for the
  // median" has published its own caveat, and the number can be read with it. One that says nothing has
  // published a number that looks like the pre-registered one and is not.
  if (typeof entry.proxyFor === "string" && entry.proxyFor.trim().length > 0) {
    return { state: "proxy",
      why: `does not contain ${absent.join(", ")}, and DECLARES a proxy for ${entry.proxyFor}. The `
        + "caveat travels with the number, which is the honest form of a substitution" };
  }
  return { state: "missing",
    why: `declares ${declared.join(", ")} as the statistic that settles it, and its recorded output does `
      + `not contain ${absent.join(", ")}. "The statistic is missing" and "the statistic did not move" `
      + "are different findings and only one of them is a result -- so this refuses rather than letting "
      + "whatever number the run did produce stand in for the one it promised" };
}

function main() {
  refuseUnknownFlags([], { entry: import.meta.url, command: "npm run verdict:preregistered" });
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, "docs/board/reported.json"), "utf8"));
  const gates = (raw.gates ?? []).filter((g) => g && typeof g === "object");

  const seen = gates.map((entry) => ({ entry, ...verdictStatisticState(entry) }));

  for (const { entry, state, why } of seen) {
    const label = state === "arrived" ? "OK      " : state === "proxy" ? "PROXY   "
      : state === "missing" ? "MISSING " : "(none)  ";
    process.stdout.write(`${label}${entry.command ?? "(no command)"}\n          ${why}\n`);
  }

  const verdict = gateVerdict({
    examined: seen.filter((s) => s.state !== "undeclared").length,
    of: gates.length,
    source: "docs/board/reported.json",
    failures: seen.filter((s) => s.state === "missing").length,
  });
  process.stdout.write(`\n${renderVerdict(verdict)}\n`);
  if (verdict.verdict === "FAIL") {
    process.stderr.write("A run promised a statistic and did not report it. Re-run so the statistic "
      + "exists, or declare a `proxyFor` on the entry so the caveat is published with the number.\n");
  } else if (verdict.verdict === "INCONCLUSIVE") {
    process.stderr.write("Entries that declare no `verdictStatistic` cannot be asked whether they "
      + 'reported it. Add one to a pre-registered measurement:\n'
      + '  { "command": "...", "output": "...", "verdictStatistic": "median" }\n');
  }
  process.exit(exitCodeFor(verdict));
}

if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) main();
