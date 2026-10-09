/**
 * The shape the JSDoc said was `any`, kept as it was said (a11ign/a11ign#4277).
 *
 * These files walk parsed JSON (a capture, a training report, a verdict) by field names held in data, or take a value
 * whose shape the caller owns. The `.mjs` declared that `any`, and the conversion keeps the declaration rather than
 * inventing a shape no test pins. One name carries it, so the rule that forbids `any` is switched off in ONE line with
 * the reason beside it, and narrowing a use means replacing `Loose` there and nowhere else.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the declared shape of parsed JSON read by field path; see above
export type Loose = any;
