/**
 * `rules:gate` and `rules:real-pages` read one corpus through two different paths, and until 2026-09-06
 * only one side said so. `export-screenreader-dataset.mjs` bakes `ruleEvidence: oracleCounts(capture)` at
 * EXPORT time, so `rules:gate` (`score-rules.ts`) scores a census frozen under whatever trust rule was
 * current when the export ran. `rules:real-pages` (`check-real-page-findings.ts`) reads the captures
 * directly and sees a capture-layer change immediately.
 *
 * MEASURED (docs/backlog.md): after the census trust-rule tightening merged, every rule finding across
 * all 2,796 exported records was byte-identical -- 1,398 conformant, 10 with a finding, same per-criterion
 * counts -- while the same change demonstrably altered what a capture-reading rule concludes. That
 * presents as THE FIX APPEARING NOT TO WORK: land a capture-layer fix, run `rules:gate`, see no movement,
 * conclude the fix is wrong, and be wrong.
 *
 * DISCOVERY, not a hand-written pair of paths: both scripts are resolved from `package.json`'s own
 * `rules:gate`/`rules:real-pages` entries, the same way a caller actually reaches them (`npm run ...`), so
 * a rename of either script is a discovery failure this test's own vacuity guard catches rather than a
 * silent pass over stale paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

const PACKAGE_SCRIPTS = JSON.parse(read("package.json")).scripts as Record<string, string>;

/** The `.ts`/`.mjs` file an `npm run <name>` command ultimately invokes -- a direct `tsx`/`node` call for both gates. */
function resolvedScriptFile(npmScript: string): string | undefined {
  const command = PACKAGE_SCRIPTS[npmScript];
  if (!command) return undefined;
  const token = command.split(/\s+/).find((t) => t.endsWith(".ts") || t.endsWith(".mjs"));
  return token;
}

const GATES: Record<string, string> = {
  "rules:gate": "rules:real-pages",
  "rules:real-pages": "rules:gate",
};

test("both gate scripts are found -- vacuity guard for the discovery itself", () => {
  const resolved = Object.keys(GATES).map(resolvedScriptFile).filter((p): p is string => p !== undefined);
  assert.equal(resolved.length, 2,
    `resolved ${resolved.length} of 2 expected gate script(s) (${resolved.join(", ")}) -- either a package.json `
    + "script was renamed, or this resolver's assumption (a direct tsx/node call naming a .ts/.mjs file) no "
    + "longer holds; fix the resolver, do not relax the count");
});

/**
 * The name of a function whose EXECUTABLE body (comments stripped first, for the identical reason
 * `exit-code-contract.test.ts`/`cli-flags.test.ts` strip them: a file that only MENTIONS something in
 * prose has not done it) mentions both `sibling` and the EXPORT/CAPTURES mechanism -- DISCOVERED by
 * scanning every top-level function, not assumed to be a particular identifier. Undefined if none exists.
 *
 * Comments are stripped for THIS search too, not only for the call-site count below: both files' own
 * docstrings name the sibling function BY IDENTIFIER as a cross-reference ("see score-rules.ts's own
 * reportWhichPathThisGateRead"), which is exactly the prose-mention shape that must not count as content.
 */
function divergenceFunctionName(executable: string, sibling: string): string | undefined {
  const starts = [...executable.matchAll(/^function (\w+)\(/gm)];
  for (let i = 0; i < starts.length; i += 1) {
    const [, name] = starts[i];
    const bodyStart = starts[i].index ?? 0;
    const bodyEnd = starts[i + 1]?.index ?? executable.length;
    const body = executable.slice(bodyStart, bodyEnd);
    if (body.includes(sibling) && /\bEXPORT\b/.test(body) && /\bCAPTURES?\b/.test(body)) return name;
  }
  return undefined;
}

test("each gate states which path it read and which sibling gate reads the other -- AND CALLS IT", () => {
  // Naming the sibling and the EXPORT/CAPTURES mechanism inside a function nobody calls is dead
  // documentation: it reads as present to a text search and never reaches anyone running the gate. So this
  // requires the discovered function's name to appear a SECOND time in the EXECUTABLE source -- its
  // declaration plus at least one call site -- not merely that the words exist somewhere, comments
  // (including a docstring naming the function itself as a cross-reference) included.
  const missing: string[] = [];
  for (const [npmScript, sibling] of Object.entries(GATES)) {
    const file = resolvedScriptFile(npmScript);
    assert.ok(file, `could not resolve a script file for 'npm run ${npmScript}'`);
    const executable = stripComments(read(file));
    const fnName = divergenceFunctionName(executable, sibling);
    if (!fnName) {
      missing.push(`${file} (npm run ${npmScript}): no function states both its sibling '${sibling}' and `
        + "the EXPORT-vs-CAPTURES divergence in its executable code");
      continue;
    }
    const occurrences = executable.split(fnName).length - 1;
    if (occurrences < 2) {
      missing.push(`${file} (npm run ${npmScript}): '${fnName}' states the divergence but is never CALLED `
        + `(found ${occurrences} occurrence(s) in executable code -- only its own declaration)`);
    }
  }
  assert.deepEqual(missing, [],
    "these gates must each state which path they read and that the sibling gate reads the other, AND "
    + "actually reach that statement at runtime, or the divergence goes silent again on whichever side "
    + `nobody happens to run:\n${missing.map((m) => `  ${m}`).join("\n")}`);
});
