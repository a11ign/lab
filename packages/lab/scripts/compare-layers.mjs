// Which findings can ONLY the screen-reader layer produce?
//
//   node scripts/compare-layers.mjs '[["https://example.com","Complete the checkout"]]'
//
// This exists because the project's central claim -- that driving a real screen reader finds failures a
// rule scanner cannot -- was asserted for a long time and never demonstrated side by side. Every finding
// on the first six real sites tested was one axe ALSO caught (1.1.1, 3.3.2, 4.1.2 unnamed controls), which
// is not evidence for the claim even though none of it was wrong.
//
// Measured on the dataset's own pages, both layers on the same URL:
//
//   disclosure-state-silent/bad   ours [4.1.2]  axe []   heard "Travel advice, button, collapsed"
//   filter-status-silent/bad      ours [4.1.3]  axe []   heard {"control":"Show bags, button","after":""}
//   form-error-silent/bad         ours [3.3.1]  axe []   heard no error after submitting
//
// axe can see that `aria-expanded` EXISTS; it cannot see that it never CHANGES. A filter that silently
// rewrites its results and a validation error that only turns red are both invisible to a static DOM
// inspection. That is the difference, and this script is how to re-check it rather than trust it.
//
// On the six real sites tried so far (BBC, DuckDuckGo, Wikipedia, MDN, gov.uk, Hacker News) the dynamic
// behaviour was CORRECT -- DuckDuckGo announced all 10 disclosures and 7 activations properly -- so no
// unique finding appeared. That is a result about those sites, not about the tool, and it is also six real
// sites with no false positive on the interaction criteria.
//
// The interaction criteria are the answer in principle: 4.1.3 (something changed, nothing announced),
// 3.3.1 (error shown but not announced), 4.1.2 state-change-silent (a disclosure whose state never
// updates). axe inspects a static DOM and cannot observe any of them. This prints our findings beside
// axe's for the same page so the difference is a fact rather than a claim.
import { execFileSync } from "node:child_process";
const sites = JSON.parse(process.argv[2]);
for (const [url, task] of sites) {
  let out;
  try {
    out = execFileSync("npx", ["tsx", "src/cli.ts", url, "--task", task, "--probe-forms", "--json"], {
      env: { ...process.env, JUDGE_BACKEND: "local", A11Y_WORKER: "http://REDACTED-INTERNAL-ADDRESS:8765", A11Y_PYTHON: ".venv/bin/python" },
      encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
    });
  } catch (e) { console.log(`\n── ${url}\n   FAILED ${String(e.message).slice(0, 90)}`); continue; }
  const d = JSON.parse(out);
  if (d.captureVerified === false) { console.log(`\n── ${url}\n   capture unverified — skipped`); continue; }
  const ours = d.verdict.findings.map((f) => f.wcag.match(/\d+\.\d+\.\d+/)?.[0]).filter(Boolean);
  const axe = [...new Set((d.ruleBased ?? []).flatMap((v) => v.wcag ?? []))];
  const onlyOurs = ours.filter((c) => !axe.includes(c));
  const i = d.interaction ?? {};
  console.log(`\n── ${url}`);
  console.log(`   announcements ${d.transcript?.length ?? 0} · activated ${(i.formChanges ?? []).length} · disclosures ${(i.stateChanges ?? []).length} · navigated ${i.navigatedOnSubmit ? "yes" : "no"}`);
  console.log(`   ours: ${JSON.stringify(ours)}   axe: ${JSON.stringify(axe)}`);
  console.log(`   ONLY the screen reader: ${onlyOurs.length ? JSON.stringify(onlyOurs) : "(none)"}`);
  for (const f of d.verdict.findings) {
    if (!onlyOurs.includes(f.wcag.match(/\d+\.\d+\.\d+/)?.[0])) continue;
    console.log(`      [${f.severity}] ${f.wcag}`);
    console.log(`         heard: ${JSON.stringify(f.evidence).slice(0, 150)}`);
  }
}
