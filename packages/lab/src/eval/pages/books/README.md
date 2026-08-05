# Book-grounded eval pages

Paired good/bad example pages authored from published, expert-reviewed
accessibility references, used to extend the eval beyond the W3C tutorial
baseline (`../tutorials/`). Same principles as that baseline:

- **Authoritative ground truth.** The correct techniques and the failures both
  come from the sources below, with the WCAG success criterion each documents —
  not from our own judgment.
- **Paired.** Each topic has a `*-good.html` (correct technique, must score zero
  findings → precision) and a `*-bad.html` (a documented failure, must be caught
  → recall).
- **Contamination-resistant.** Authored fresh from the guidance.
- **Observable only.** `expect` is limited to what an NVDA read-through (or an
  interaction probe) can actually surface; defensible criterion overlaps go in
  `allow`.

## Sources

- *Web Accessibility Cookbook* — Manuel Matuzović (O'Reilly, 2024). Chapters 3
  (links), 4 (buttons), 9 (forms), 10 (filters / live regions), 11 (tables).
- *Practical Web Accessibility* — Ashley Firth (Apress, 2nd ed. 2024).
  Chapters 4–6 (alt text, custom controls, forms), 15–17 (headings, link text),
  25 (tables).

## Topics

| Topic | File stem | Primary criterion | Documented failure |
|---|---|---|---|
| Link purpose | `links` | 2.4.4 | ambiguous "Click here" / "Read more" / "Go!" link text |
| Descriptive headings | `headings` | 2.4.6 | vague / run-on / non-descriptive headings |
| Alt-text quality | `alt-quality` | 1.1.1 | alt present but a declaration ("A graph about stocks") or generic ("image") — distinct from the *absence* case in `../tutorials/images-bad` |
| Custom controls | `custom-control` | 4.1.2 | icon-only button with no name + `<div>`/`<span>` styled as a control with no role |
| Status messages | `filter-status` | 4.1.3 | filter updates results with no live region → silent on the interaction probe |
| Table semantics | `layout-table` | 1.3.1 | layout table without `role="presentation"` → spurious table semantics announced |

## Status

Captured via the real NVDA worker on 2026-06-29 and tuned against the actual
transcripts. Outcome:

- **Active (4 pairs):** `links` (2.4.4), `headings` (2.4.6), `alt-quality`
  (1.1.1), `custom-control` (4.1.2). Each captured cleanly with the bad page
  surfacing its failure and the good page clean. Tuning surfaced one real rule
  gap: NVDA announces an unnamed icon button as the bare token `"button"` (no
  `￼`) in the control sweep, which `rules.ts` now catches (sweep entries are not
  line-wrapped, so a bare role with no name is unambiguously unnamed).
- **Pending richer capture (2 pairs):** `filter-status` (4.1.3) and
  `layout-table` (1.3.1). Both captured good and bad **identically**, so they
  cannot be scored yet:
  - `filter-status` — `probeForms` does not actuate plain filter `<button>`s, so
    the live-region (non-)announcement is never captured. Needs a probe that
    clicks the filter and snapshots the `spokenPhraseLog` delta.
  - `layout-table` — NVDA browse-mode say-all announces no table semantics for
    the layout table either way; the failure is only visible under
    table-navigation, which our passive read does not perform.

  Their fixtures are intentionally absent, so the runner skips them as pending;
  re-capturing once the probe supports them will activate them with no code
  change.
