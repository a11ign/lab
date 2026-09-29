#!/usr/bin/env node
// COPIED FROM `packages/agent-org/src/board-gates.mjs` at 9eb846790 (#2623, child 5 of #69; ADR 0040
// decision 6's rehearsal run): `field-role.test.ts`'s only use of `board-gates.mjs` is a two-line
// integration check ("the corpus's printed field section must not read as a gate verdict"), not a thing
// about agent-org itself -- ceo's ruling on this row, 2026-09-28, shape 1: relocate the two functions
// `lab` actually uses, mirrored the other way around from #2742's copy of files OUT of the product and
// INTO the tool, rather than widen decision 4's travelling-file set to carry corpus/training domain
// concepts into the extracted package. The tool's own module at its original path keeps its own copy,
// unchanged, and the two are free to drift with no cross-repository pin -- see this row's own extraction
// test for the guard that would have caught this coupling instead of a rehearsal-time crash.
// CHANGED FROM THE ORIGINAL: only `gateVerdicts` and `worstVerdict` are copied; `isConformanceGate`,
// `isRulesRealPagesStage` and `latestVerdictGate` are board-report-domain logic this file never used.
// ==== end of copy header ====
// @ts-check

/** The verdicts a gate PRINTED, quoted from its own output and never retyped.
 *
 * THE BOARD'S DOCUMENT COULD NOT SAY WHETHER A CHECK PASSED. `board-report.mjs` prints the gate's whole
 * output verbatim into the GitHub edition; the PDF quoted only the COMMAND and the capture spread. So the
 * two editions would have disagreed about whether a check passed, and the silent one is the one the board
 * reads -- found 2026-09-07, the day before the first FAIL was due to be recorded.
 *
 * Quoted, never classified. A gate states its own verdict in its own sentence; this returns those
 * sentences. Deciding whether a FAIL blocks anything is a JUDGEMENT and is not derivable from the output,
 * which is why `note` on the entry carries it and why an unexplained FAIL renders as unexplained rather
 * than as an opinion this file invented.
 *
 * @param {string | undefined} gateOutput
 */
export function gateVerdicts(gateOutput) {
  const lines = String(gateOutput ?? "").split("\n");
  /** @type {{ verdict: string, line: string }[]} */
  const found = [];
  for (const raw of lines) {
    const line = raw.trim();
    // A verdict is the word at the head of its own clause, so `RULES: PASS -- ...` and `PASS -- ...`
    // both count and the word inside a sentence ("a page that FAILS this rule") does not.
    const m = /^(?:[A-Za-z: ]{0,24}?\b)?(PASS|FAIL|BLOCKED|INCONCLUSIVE)\b\s*(?:[—-]\s*(.*))?$/.exec(line);
    if (m) found.push({ verdict: m[1], line });
  }
  return found;
}

/** The single worst verdict a gate printed, or null when it printed none.
 * @param {string | undefined} gateOutput */
export function worstVerdict(gateOutput) {
  /** @type {Record<string, number>} */
  const order = { PASS: 0, INCONCLUSIVE: 1, BLOCKED: 2, FAIL: 3 };
  const all = gateVerdicts(gateOutput);
  if (all.length === 0) return null;
  return all.reduce((w, v) => (order[v.verdict] > order[w.verdict] ? v : w), all[0]);
}
