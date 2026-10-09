// @ts-check
/**
 * How much of a conformant page's review load is the same referral said again? (a11ign/a11ign#4241, #4084 outcome 4)
 *
 *   node packages/lab/scripts/referral-repeat-share.mjs <judgment-or-referrals.json> [...]
 *
 * ## Why this exists
 *
 * The evaluator's complaint was review load: 395 referrals on 40 conformant pages, each needing a person. Whether
 * to group repeats in `summary.ts` and `report.ts` depends on how many of them ARE repeats, and nothing measured it.
 * This prints that number so the grouping row is decided on it, not on a guess.
 *
 * ## What counts
 *
 * A REFERRAL is a (criterion, quoted text) pair a person is asked to look at. A REPEAT is a referral whose pair
 * already appeared EARLIER ON THE SAME PAGE: the first sighting is the one a reader has to read, so only the
 * later ones are load that grouping would remove. The share is repeats over ALL referrals, and the total is the
 * sum over pages, never the mean of per-page shares (a page with one referral would weigh as much as a page with
 * thirty).
 *
 * ## Input
 *
 * Either the calibration sweep's one file, `{ "pages": [{ "url", "findings": [...] }] }` (`runs/abstention/
 * calibration-judgments.json`, a11ign/a11ign#4293), or one JSON file per page, either `{ "referrals": [{ "criterion", "text" }] }` or a recorded `Judgment`, whose
 * `findings` are referrals unless `mapping` is `conformance` (an absent `mapping` is `secondary`, so a model
 * finding is a referral). A `cantTell` outcome carries a reason and no quoted text; it is one per criterion, so it
 * cannot repeat, and is read here only when given as a `referrals` entry with its reason as `text`.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

/** The repeat share at or above which grouping repeats cuts the load by a fifth (the row's own threshold). */
export const GROUPING_THRESHOLD = 0.2;

/** @typedef {{ criterion: string, text: string }} Referral */
/** @typedef {{ page: string, referrals: readonly Referral[] }} PageReferrals */

/**
 * `"1.3.1 Info and Relationships"` and `"1.3.1"` are one criterion; whitespace in the quote is layout, not content.
 * @param {Referral} referral @returns {string}
 */
export function referralKey(referral: Referral): string {
  const criterion = String(referral.criterion).trim().split(/\s+/)[0];
  const text = String(referral.text ?? "").replace(/\s+/g, " ").trim();
  return JSON.stringify([criterion, text]);
}

/**
 * @param {readonly Referral[]} referrals
 * @returns {{ referrals: number, repeats: number, share: number }}
 */
export function pageShare(referrals: readonly Referral[]): { referrals: number; repeats: number; share: number; } {
  const seen = new Set();
  let repeats = 0;
  for (const referral of referrals) {
    const key = referralKey(referral);
    if (seen.has(key)) repeats++;
    seen.add(key);
  }
  // A page with no referrals has no share to report: 0, not 0/0.
  return { referrals: referrals.length, repeats, share: referrals.length === 0 ? 0 : repeats / referrals.length };
}

/**
 * @param {readonly PageReferrals[]} pages
 * @returns {{ pages: ({ page: string } & ReturnType<typeof pageShare>)[], total: { pages: number, referrals: number, repeats: number, share: number } }}
 */
export function repeatShare(pages: readonly PageReferrals[]): { pages: ({ page: string; } & ReturnType<typeof pageShare>)[]; total: { pages: number; referrals: number; repeats: number; share: number; }; } {
  const perPage = pages.map(({ page, referrals }) => ({ page, ...pageShare(referrals) }));
  const referrals = perPage.reduce((sum, page) => sum + page.referrals, 0);
  const repeats = perPage.reduce((sum, page) => sum + page.repeats, 0);
  return { pages: perPage, total: { pages: pages.length, referrals, repeats, share: referrals === 0 ? 0 : repeats / referrals } };
}

/**
 * Referrals out of one recorded file. A `Judgment`'s finding is a referral unless it ASSERTS (`mapping: "conformance"`).
 * @param {any} record @returns {Referral[]}
 */
export function referralsOf(record: any): Referral[] {
  if (Array.isArray(record?.referrals)) return record.referrals;
  if (!Array.isArray(record?.findings)) throw new Error("neither `referrals` nor `findings` is an array");
  return record.findings
    .filter((/** @type {any} */ finding: any) => finding.mapping !== "conformance")
    .map((/** @type {any} */ finding: any) => ({ criterion: finding.wcag, text: finding.evidence }));
}

/** @param {number} share @returns {string} */
const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** @param {ReturnType<typeof repeatShare>} result @returns {string} */
export function render(result: ReturnType<typeof repeatShare>): string {
  const lines = result.pages.map((p) => `${p.page}\t${p.referrals}\t${p.repeats}\t${percent(p.share)}`);
  const { total } = result;
  const side = total.share >= GROUPING_THRESHOLD ? "AT OR ABOVE" : "BELOW";
  return [
    "page\treferrals\trepeats\trepeat share",
    ...lines,
    `TOTAL\t${total.referrals}\t${total.repeats}\t${percent(total.share)}\t(${total.pages} pages; ${side} the ${percent(GROUPING_THRESHOLD)} line)`,
  ].join("\n");
}

/**
 * One file is one page, or, for the calibration sweep's `calibration-judgments.json` (#4293), a `pages` array of
 * records that each carry their own `url`.
 * @param {any} record @param {string} file @returns {PageReferrals[]}
 */
export function pagesOf(record: any, file: string): PageReferrals[] {
  if (!Array.isArray(record?.pages)) return [{ page: basename(file, ".json"), referrals: referralsOf(record) }];
  return record.pages.map((/** @type {any} */ page: any, /** @type {number} */ index: number) => ({
    page: String(page?.url ?? `${basename(file, ".json")}[${index}]`),
    referrals: referralsOf(page),
  }));
}

/** @param {readonly string[]} files @returns {PageReferrals[]} */
function readPages(files: readonly string[]): PageReferrals[] {
  return files.flatMap((file) => {
    try {
      return pagesOf(JSON.parse(readFileSync(file, "utf8")), file);
    } catch (cause) {
      throw new Error(`cannot read referrals from ${file}`, { cause });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: referral-repeat-share.ts <judgment-or-referrals.json> [...]");
    process.exit(2);
  }
  console.log(render(repeatShare(readPages(files))));
}
