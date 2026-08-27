/**
 * `rules:coverage` must count every population that holds REAL evidence — not one directory.
 *
 * `2.4.4` reported `38x on the corpus, 0x on a real page — assumptions untested` for as long as that audit
 * has existed, and `docs/known-gaps.md` recorded the remedy as "a real page that exhibits it, not a change
 * to the rule". Both halves of that were wrong, and finding out took an audit rather than an argument:
 *
 *   - The corpus ALREADY held such a page. `nvda-w3c-bad-before.json` is a real capture of
 *     `w3.org/WAI/demos/bad/before/home.html`, which carries two links both announced `"Click here, link"`
 *     in one paragraph — WCAG F63, and the exact shape the rule's own message describes.
 *   - The rule ALREADY fired on it. Verified offline before anything was changed.
 *
 * What was missing was neither the page nor the rule but the COUNT: "real" meant `runs/real-page-corpus`,
 * and the eval fixtures — captures of live websites, held out for judge quality — were invisible to it.
 * So the audit reported an untested assumption that had been tested the whole time, which is strictly
 * worse than reporting nothing: it sent the next reader to find a page that was already there.
 *
 * This is the same defect as the census that never reached the exporter, one layer further out. The lesson
 * recorded then was that "the rule never fired" and "the rule never had its evidence" are different
 * answers. This is a third: **the rule fired where nobody counted.**
 *
 * Two assertions, because the fix has two halves that fail independently. The first pins the CLAIM — that
 * this rule has real evidence at all — and would survive any refactor of the audit. The second pins the
 * DISCRIMINATOR, which is the part that can rot quietly: it is keyed on the capture's own URL, so a
 * fixture directory that later gains an authored page cannot inflate the real-page count.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ruleFindings } from "@a11y-witness/judge/rules";

const FIXTURES = fileURLToPath(new URL("../eval/fixtures/", import.meta.url));

function captureFrom(path: string): { url?: string; transcript?: unknown } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { capture?: unknown };
  return (parsed.capture ?? parsed) as { url?: string; transcript?: unknown };
}

test("2.4.4 fires on a capture of a real website, not only on generated pages", () => {
  const capture = captureFrom(join(FIXTURES, "nvda", "nvda-w3c-bad-before.json"));
  // The premise first. Asserting the finding without this would pass just as happily against a fixture
  // that had been replaced, which is the "a test written against a shape you did not verify" trap.
  assert.equal(capture.url, "https://www.w3.org/WAI/demos/bad/before/home.html");

  // The audit wraps captures in `withCensus` before scoring; 2.4.4 reads `structure.links` and never
  // the census, so the raw capture exercises the same path here. A rule that DID read the census would
  // need the wrapper, and would silently find nothing without it — the 1.3.1 defect exactly.
  const findings = ruleFindings(capture as never);
  const vague = findings.filter((f) => String(f.wcag).startsWith("2.4.4"));
  assert.ok(vague.length > 0, "2.4.4 must fire on w3.org/WAI/demos/bad/before/home.html");
  // The EVIDENCE, not just the count — a rule firing for some other reason would satisfy a count.
  assert.match(String(vague[0].evidence), /click here/i);
});

test("only captures of live websites count as real evidence — the URL decides, never the directory", () => {
  const authored: string[] = [];
  const real: string[] = [];
  for (const dir of ["nvda", "tutorials", "books"]) {
    for (const entry of readdirSync(join(FIXTURES, dir)).filter((f) => f.endsWith(".json"))) {
      const { url } = captureFrom(join(FIXTURES, dir, entry));
      let host = "";
      try {
        const parsed = new URL(String(url));
        host = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : "";
      } catch {
        host = ""; // "tutorial: forms-bad (authored from W3C guidance)" is not a URL and says so
      }
      (host && !/^(localhost$|127\.|10\.|192\.168\.|169\.254\.)/.test(host) ? real : authored).push(entry);
    }
  }
  // `books` are `file:///` captures and `tutorials` are authored pages plus two served from the lab's own
  // page server over http — so a scheme check alone would admit them. Counting either as real evidence is
  // the opposite error to the one this fixes, and equally invisible.
  assert.ok(real.length > 0, "the nvda fixtures are captures of live sites and must be recognised as such");
  assert.ok(authored.length > 0, "authored fixtures must NOT be recognised as real pages");
  assert.ok(real.every((f) => f.startsWith("nvda-")), `only nvda fixtures are real, got ${real.join(", ")}`);
});
