/**
 * The SIGNAL and the RULE must agree about what a keyboard trap looks like, on every capture on disk.
 *
 * They are the same decision in two languages that cannot import each other: `case-matrix.mjs` runs under
 * plain node (making the corpus generator depend on a build is how a stale `dist` got scored once), and
 * `rules.ts` compiles. CLAUDE.md's remedies for a fact stated twice are, in order: delete a copy, derive
 * one from the other, or pin them equal with a test. The first two are unavailable here, so this is the
 * third — the same shape as `name-normalisation.test.ts`, which failed twice on its first run.
 *
 * ## What it is pinning
 *
 * Two shapes of trap, and the second was a declared blind spot until 2026-08-28:
 *
 *   1. STALLED — the last control repeats consecutively, so Tab stopped moving.
 *   2. A CLOSED CYCLE over a strict SUBSET of the page's controls, which is the modal trap.
 *
 * `keyboard-trap-blur-revalidate`'s comment says the second was unreachable because "a guard that cycles
 * focus among several fields moves focus every press, so it reads as `cycled`, which is exactly what a
 * conformant page's tab order does when it wraps". True of the cycle, not of its contents: a conformant
 * wrap visits everything the page has, a modal cycle visits what the dialog has.
 *
 * Needs `runs/`, so it SKIPS HONESTLY where the corpus is absent rather than passing quietly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ruleFindings } from "@a11y-witness/judge/rules";
// The plain-node corpus module, deliberately not built. No `@ts-expect-error` is needed: `case-matrix.mjs`
// carries `// @ts-check` as of today, so its exports are typed and `tsc` refuses a suppression that
// suppresses nothing.
import { focusIsTrappedIn } from "../training/case-matrix.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT ?? "runs/screenreader-dataset", "captures");

/** Every capture on disk that carries a focus probe — the only ones either side has an opinion about. */
function capturesWithFocus(): { name: string; capture: Record<string, unknown> }[] {
  if (!existsSync(ROOT)) return [];
  const out: { name: string; capture: Record<string, unknown> }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (!name.endsWith(".json")) continue;
    let capture: Record<string, unknown>;
    try {
      capture = JSON.parse(readFileSync(resolve(ROOT, name), "utf8"));
    } catch {
      continue; // a capture that will not parse is `verify.corpus.test.ts`'s business, not this one
    }
    const interaction = capture.interaction as { focusOrder?: unknown } | undefined;
    if (Array.isArray(interaction?.focusOrder)) out.push({ name, capture });
  }
  return out;
}

const CAPTURES = capturesWithFocus();

test("the signal and the rule agree about every focus capture on disk", { skip: CAPTURES.length === 0 && "no runs/ here — run this locally" }, () => {
  const disagreements: string[] = [];
  for (const { name, capture } of CAPTURES) {
    const interaction = capture.interaction as { focusOrder: string[]; dialogEscape?: unknown };
    const structure = capture.structure as { formFields?: string[] } | undefined;
    const signal = focusIsTrappedIn(interaction.focusOrder, structure?.formFields ?? [],
      interaction.dialogEscape);
    const rule = ruleFindings(capture as never).some((f) => f.wcag.startsWith("2.1.2"));
    if (signal !== rule) disagreements.push(`${name}: signal=${signal} rule=${rule}`);
  }
  assert.deepEqual(disagreements, [],
    "the corpus predicate and the shipped rule disagree about a trap. They are one decision written "
      + "twice, and a corpus labelled by one while users are told by the other is the defect this pins");
});

test("both fire on the trapped variant of every trap case, and on neither conformant one", { skip: CAPTURES.length === 0 && "no runs/ here — run this locally" }, () => {
  // THE CONTROL, and this test is worthless without it: two predicates that both answer `false` always
  // agree perfectly. The corpus now holds only the STALLED shape — `keyboard-trap-postcode` and
  // `keyboard-trap-blur-revalidate`. `keyboard-trap-modal-cycle` and the cycling branch that read it were
  // withdrawn on 2026-08-28, after `rules-real-pages` measured 7 new 2.1.2 findings on 86 conformant real
  // pages: a consent banner confines Tab to its own controls while the sweep walks the whole document, so
  // that page and the corpus trap are the same evidence (tfl ring 5 of 28 swept; the case, 3 of 5).
  const fired = CAPTURES.filter(({ capture }) => {
    const interaction = capture.interaction as { focusOrder: string[]; dialogEscape?: unknown };
    const structure = capture.structure as { formFields?: string[] } | undefined;
    return focusIsTrappedIn(interaction.focusOrder, structure?.formFields ?? [],
      interaction.dialogEscape);
  }).map((c) => c.name);

  assert.ok(fired.some((n) => n.startsWith("keyboard-trap-postcode.bad")),
    "the STALLING trap must fire — it is the one shape 2.1.2 can assert from a capture, because a control "
      + "that will not release focus on Tab offers no documented means to leave");
  assert.ok(fired.length > 0,
    "nothing fired at all, so the assertion below about conformant pages is vacuous");
  const conformant = fired.filter((n) => n.includes(".good."));
  assert.deepEqual(conformant, [],
    "a trap reported on a conformant page is an accusation; 2.1.2 is TOTAL — it says a keyboard user "
      + "cannot use the page at all");
});
