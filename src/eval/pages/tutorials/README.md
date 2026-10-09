# W3C tutorial baseline

Paired good/bad example pages authored from the
[W3C WAI Tutorials](https://www.w3.org/WAI/tutorials/), used as an eval baseline.

Why this is a good baseline:

- **Authoritative ground truth.** The correct techniques and the failures both
  come from W3C's tutorials, not from our own judgment. We are not grading
  ourselves.
- **Paired.** Each topic has a `*-good.html` (correct technique, must score
  zero findings → precision) and a `*-bad.html` (a documented failure, must be
  caught → recall).
- **Contamination-resistant.** The HTML is authored fresh from the guidance, so
  no model has memorized these exact pages.
- **Covers the observable categories.** Images (1.1.1), forms (3.3.2 / 4.1.2),
  page structure (1.3.1), and data tables (1.3.1) — the WCAG failures a
  screen-reader read-through can actually detect.

Each page is captured through the real NVDA worker into
`../../fixtures/tutorials/*.json`, and scored by the cases in `../../cases.ts`.

To extend: add a topic from the tutorials (e.g. menus, carousels), author a
good/bad pair here, capture it, and add the cases. Keep the `expect` set to the
criteria observable in the transcript; put defensible criterion overlaps (e.g.
an alt-less image link is both 1.1.1 and 4.1.2) in `allow`.
