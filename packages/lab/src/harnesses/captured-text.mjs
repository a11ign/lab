// @ts-check
/**
 * The text a harness capture read, joined for its summary line -- a PURE function, in its own module (#1616).
 *
 * It lives here rather than in `capture-check.mjs` so a test can import it: that module imports `@a11ign/nvda-worker`
 * at top level, which loads `@guidepup/guidepup`, and guidepup throws at import wherever no screen reader exists. So
 * `capture-check.mjs` imports this, and `state-change-after-null.test.ts` imports this directly.
 */
export function capturedText(/** @type {any} */ r) {
  return [
    ...r.transcript,
    ...r.structure.headings, ...r.structure.landmarks, ...r.structure.formFields,
    // #1616: a failed re-read (`after: null`) names its error instead of printing "null".
    ...r.interaction.stateChanges.map((/** @type {any} */ s) => (s.after === null ? `${s.control} [re-read failed: ${s.error ?? "no error recorded"}]` : `${s.control} ${s.after}`)),
    ...r.interaction.formChanges.map((/** @type {any} */ s) => `${s.control} ${s.after}`),
    ...(r.interaction.postSubmitFields ?? []),
  ].join(" | ");
}
