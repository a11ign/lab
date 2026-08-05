// capture-books.mjs — capture every book-grounded eval page in one run.
//
// MUST run in an interactive desktop session on the Windows capture VM (NVDA
// needs a real desktop — see README.md). First serve the pages over HTTP so
// Edge can load them, e.g. from the repo root:
//     npx serve src/eval/pages/books -l 5050
// then, in the interactive session:
//     node src/lab/capture-books.mjs http://localhost:5050
//
// Writes src/eval/fixtures/books/<name>.json (the eval fixture shape) for each
// page, so the corresponding EvalCase auto-activates on the next eval run.
//
// Notes:
// - The pages reference assets that 404 (e.g. /charts/revenue.png). That is
//   intended: NVDA still announces the alt text / image role, which is what we
//   judge. Images simply do not render.
// - filter-status-* (4.1.3) and custom-control-* depend on the control/form
//   probe actuating the buttons and capturing the spokenPhraseLog delta. If the
//   probe does not reach a plain <button> (see the README gotchas on "F"/"B"
//   quick-nav), those two fixtures may need a probe tweak — capture the rest
//   first and flag anything that comes back without an interaction delta.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureWithNvda } from "@a11y-witness/nvda-worker";

const BASE = (process.argv[2] || process.env.BOOKS_BASE_URL || "http://localhost:5050").replace(/\/$/, "");
const STEPS = Number(process.env.CAPTURE_STEPS || 150);

// Page stem -> capture task hint (the EvalCase task; helps the interaction probe
// pick a sensible action where the read-through alone is not enough).
const PAGES = [
  "links-good", "links-bad",
  "headings-good", "headings-bad",
  "alt-quality-good", "alt-quality-bad",
  "custom-control-good", "custom-control-bad",
  "filter-status-good", "filter-status-bad",
  "layout-table-good", "layout-table-bad",
];

const OUT_DIR = resolve(process.cwd(), "src/eval/fixtures/books");
mkdirSync(OUT_DIR, { recursive: true });

let ok = 0;
const empty = [];
for (const name of PAGES) {
  const url = `${BASE}/${name}.html`;
  const out = `${OUT_DIR}/${name}.json`;
  try {
    console.log("capturing", url);
    const result = await captureWithNvda(url, { steps: STEPS });
    writeFileSync(out, JSON.stringify(result, null, 2));
    const interactions = result.interaction
      ? result.interaction.stateChanges.length + result.interaction.formChanges.length
      : 0;
    console.log(`WROTE ${out} - ${result.transcript.length} phrases, ${interactions} interaction events`);
    if (result.transcript.length === 0) empty.push(name);
    ok++;
  } catch (e) {
    console.error("CAPTURE_ERROR", name, (e && e.stack) || e);
    empty.push(name);
  }
}

console.log(`\nDone: ${ok}/${PAGES.length} captured.`);
if (empty.length) console.log(`Check these (empty/failed): ${empty.join(", ")}`);
