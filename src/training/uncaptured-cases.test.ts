import test from "node:test";
import assert from "node:assert/strict";
import { reportUncapturedCases } from "./export-screenreader-dataset.mjs";

/**
 * "Nobody captured it" and "the evidence was unusable" must not print the same nothing.
 *
 * The per-case line always said which it was. It is invisible in practice: the pipeline runner tails each
 * stage to six lines, so with 54 acceptance cases the reason never reaches the log.
 *
 * Measured cost, 2026-09-02: five new HELD-OUT cases were written and committed, `everything` was
 * dispatched twice, and both times it stopped at `acceptance` with `3.3.3: fewer than 3 acceptance
 * positives` — which reads as "your corpus is thin" when the truth was "nobody captured it". NEITHER
 * `everything` NOR `--pipeline=full` runs `capture-acceptance`; both only export. Two different faults
 * printing one sentence is this repo's most-recorded diagnostic defect.
 */
function captureOutput(fn: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try { fn(); } finally { console.log = original; }
  return lines.join("\n");
}

const MISSING = "capture is missing, empty, or does not match current page/provenance";

test("a summary with no missing captures says nothing at all", () => {
  // Silence is right here: every skip had a real reason, and a report that always fires is noise that
  // gets filtered out — which is how the per-case line came to be unread in the first place.
  assert.equal(captureOutput(() => reportUncapturedCases({ reasons: {} })), "");
  assert.equal(captureOutput(() => reportUncapturedCases({ reasons: { "bad signal was not observable in NVDA output": 4 } })), "",
    "an unobservable signal is evidence about the case, not a missing capture");
});

test("missing captures are named as ABSENT, not as unusable evidence", () => {
  const out = captureOutput(() => reportUncapturedCases({ reasons: { [MISSING]: 5 } }));
  assert.match(out, /5 case\(s\)/, "the count must be stated — 'some' sends you looking");
  assert.match(out, /ABSENT, not because the/, "and it must say which of the two faults this is");
  assert.match(out, /too few positives/,
    "it must name the symptom seen DOWNSTREAM, because that is the message somebody will be holding");
});

test("for the held-out set it names all three jobs, because the chain runs none of them", () => {
  const before = process.env.DATASET_KIND;
  process.env.DATASET_KIND = "acceptance";
  try {
    const out = captureOutput(() => reportUncapturedCases({ reasons: { [MISSING]: 5 } }));
    assert.match(out, /generate-acceptance/);
    assert.match(out, /capture-acceptance\b/);
    assert.match(out, /capture-acceptance-2/, "the evaluator reads BOTH repeats; naming one is a half-fix");
    assert.match(out, /neither `everything` nor `--pipeline=full` does it for you/i,
      "say WHY it is not already done, or the next person assumes the chain covers it as I did");
  } finally {
    if (before === undefined) delete process.env.DATASET_KIND; else process.env.DATASET_KIND = before;
  }
});

test("for the training corpus it names the training capture instead", () => {
  const before = process.env.DATASET_KIND;
  delete process.env.DATASET_KIND;
  try {
    const out = captureOutput(() => reportUncapturedCases({ reasons: { [MISSING]: 2 } }));
    assert.match(out, /training:capture/);
    assert.doesNotMatch(out, /capture-acceptance/, "the training corpus IS captured by its own chain");
  } finally {
    if (before !== undefined) process.env.DATASET_KIND = before;
  }
});
