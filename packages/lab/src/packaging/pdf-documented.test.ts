// #2629: THE PDF CAPABILITY IS DISCOVERABLE FROM THE THREE DOCUMENTS A NEW READER OPENS.
//
// `npm run witness -- <url>.pdf` reads a PDF's own accessibility tag tree (#68) and leases no worker, opens no
// browser and drives no NVDA. It shipped on 2026-09-20 and the chairman learned it existed six days later, from
// the code: not one of README.md, docs/try-it.md or docs/getting-started.md said so.
//
// WHAT IS CHECKED AGAINST WHAT. The sentence in each document is checked against the code, not against a copy of
// the code's own comment: `looksLikePdfUrl` is CALLED on the URL forms the prose promises, the rule ids and the
// success criteria the prose names are read from `packages/pdf/src/index.ts`, and the "needs no worker, browser or
// NVDA" claim is read off `runPdfLayer`'s body and off `main`'s ORDER (the PDF branch must come before
// `leaseWorker`, or "no worker" is false however the comment reads).
//
// EVERY RULE IS A FUNCTION OVER TEXT, so it is driven against fixtures that break it (the file's positive control).
// The real documents are then one more input, rather than the only one a "found nothing" could hide behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikePdfUrl } from "../../../pdf/src/index.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(resolve(REPO, path), "utf8");

const DOCUMENTS = ["README.md", "docs/try-it.md", "docs/getting-started.md"];
const CLI_SOURCE = "packages/cli/src/cli.ts";
const PDF_SOURCE = "packages/pdf/src/index.ts";

/** The paragraph that IS the PDF sentence: about a PDF, the tag tree and a `.pdf` URL. Undefined when none is. */
export function pdfParagraph(page: string): string | undefined {
  return page.split(/\n\s*\n/).find((p) => /\bPDF\b/.test(p) && /tag tree/i.test(p) && /\.pdf\b/.test(p));
}

/** `rule -> success criterion`, read from the finding literals the scanner builds. */
export function scannerRules(pdfSource: string): Map<string, string> {
  const pairs = [...pdfSource.matchAll(/rule: "(pdf-[a-z-]+)", wcag: \["([\d.]+)"\]/g)];
  return new Map(pairs.map((m) => [m[1], m[2]]));
}

/** `runPdfLayer`'s own text: from its declaration to the first closing brace in column 0. */
export function runPdfLayerBody(cliSource: string): string {
  const start = cliSource.indexOf("export async function runPdfLayer");
  if (start < 0) return "";
  const end = cliSource.indexOf("\n}\n", start);
  return cliSource.slice(start, end < 0 ? undefined : end);
}

/** Does `main` route a PDF BEFORE it leases a worker? Both must be there, in that order. */
export function routesPdfBeforeLeasing(cliSource: string): boolean {
  const main = cliSource.slice(cliSource.indexOf("async function main()"));
  const pdf = main.indexOf("looksLikePdfUrl(args.url)");
  const lease = main.indexOf("leaseWorker(args)");
  return pdf >= 0 && lease >= 0 && pdf < lease;
}

/** What `runPdfLayer` must be for "no worker, no browser, no NVDA, and no screen reader run" to be true. */
export function runPdfLayerProblems(cliSource: string): string[] {
  const body = runPdfLayerBody(cliSource);
  const problems: string[] = [];
  if (body === "") problems.push("runPdfLayer is not in the CLI source");
  if (/leaseWorker|runWitness|capturePage/.test(body)) problems.push("runPdfLayer reaches for a worker or a capture");
  if (!/screenReader: "not applicable/.test(body)) problems.push("runPdfLayer no longer reports the screen-reader layer as not applicable");
  if (!routesPdfBeforeLeasing(cliSource)) problems.push("main does not route a PDF before leasing a worker");
  return problems;
}

/** The URL forms the prose promises are accepted, checked by calling the function that accepts them. */
function urlProblems(paragraph: string): string[] {
  const problems: string[] = [];
  const example = paragraph.match(/https?:\/\/[^\s`)]+\.pdf\b/)?.[0];
  if (!example) problems.push("gives no example URL ending in .pdf");
  else if (!looksLikePdfUrl(example)) problems.push(`example ${example} is not a URL looksLikePdfUrl accepts`);
  if (!/path ends in `\.pdf`/.test(paragraph)) problems.push("does not say the URL's path ends in `.pdf`");
  const promised = ["https://example.com/a.PDF", "https://example.com/a.pdf?x=1", "https://example.com/a.pdf#p"];
  if (/\?query/.test(paragraph) && !promised.every(looksLikePdfUrl)) problems.push("promises URL forms looksLikePdfUrl refuses");
  return problems;
}

/** The rule ids named, and the criterion numbers written beside them, must be the scanner's own. */
function ruleProblems(paragraph: string, rules: Map<string, string>): string[] {
  const named = [...paragraph.matchAll(/`(pdf-[a-z-]+)`(?:, ([\d.]+))?/g)];
  const problems: string[] = named
    .filter((m) => !rules.has(m[1]) || (m[2] !== undefined && rules.get(m[1]) !== m[2]))
    .map((m) => `names ${m[1]}${m[2] ? `, ${m[2]}` : ""}, which the scanner does not produce`);
  if (named.length === 0) problems.push("names no pdf- finding");
  return problems;
}

const REQUIRED: Array<[RegExp, string]> = [
  [/`pdf:`/, "does not say what it reports (`pdf:` findings)"],
  [/no worker/i, "does not say it needs no worker"],
  [/no browser/i, "does not say it needs no browser"],
  [/\bNVDA\b/, "does not name NVDA as not needed"],
  [/does not run a screen reader/i, "does not say what it does NOT do (run a screen reader over the document)"],
];

/** Every way a document's PDF sentence is wrong or missing. Empty means it says what the code does. */
export function pdfDocumentationProblems(
  page: string, sources: { pdf: string; cli: string },
): string[] {
  const paragraph = pdfParagraph(page);
  if (paragraph === undefined) return ["no paragraph says a PDF URL is scanned for its tag tree"];
  return [
    ...REQUIRED.filter(([pattern]) => !pattern.test(paragraph)).map(([, why]) => why),
    ...urlProblems(paragraph),
    ...ruleProblems(paragraph, scannerRules(sources.pdf)),
    ...runPdfLayerProblems(sources.cli),
  ];
}

const sources = () => ({ pdf: read(PDF_SOURCE), cli: read(CLI_SOURCE) });

for (const path of DOCUMENTS) {
  test(`${path} says a PDF URL is scanned, what it reports, and what it does not do`, () => {
    assert.deepEqual(pdfDocumentationProblems(read(path), sources()), []);
  });
}

test("POSITIVE CONTROL: the real README has a PDF paragraph, and deleting it is refused", () => {
  const page = read("README.md");
  const paragraph = pdfParagraph(page);
  assert.ok(paragraph, "the population the emptiness assertions above stand on is not empty");
  const without = page.replace(paragraph, "");
  assert.deepEqual(pdfDocumentationProblems(without, sources()), ["no paragraph says a PDF URL is scanned for its tag tree"]);
});

test("each required claim, deleted on its own, is refused for that claim alone", () => {
  const paragraph = pdfParagraph(read("docs/try-it.md")) as string;
  const cuts: Array<[string, RegExp]> = [
    ["`pdf:`", /does not say what it reports/],
    ["no worker", /no worker/],
    ["no browser", /no browser/],
    ["NVDA", /NVDA/],
    ["does not run a screen reader", /does NOT do/],
    ["path ends in `.pdf`", /path ends in/],
  ];
  for (const [cut, why] of cuts) {
    const problems = pdfDocumentationProblems(paragraph.replace(cut, "XXXX"), sources());
    assert.equal(problems.length, 1, `${cut}: ${problems.join(" | ")}`);
    assert.match(problems[0], why);
  }
});

test("a rule id the scanner does not produce, or a wrong criterion beside a real one, is refused", () => {
  const paragraph = pdfParagraph(read("README.md")) as string;
  assert.equal(pdfDocumentationProblems(paragraph.replace("`pdf-untagged`, 1.3.1", "`pdf-untagged`, 2.4.4"), sources()).length, 1);
  assert.equal(pdfDocumentationProblems(paragraph.replace("`pdf-missing-lang`", "`pdf-missing-title`"), sources()).length, 1);
  assert.deepEqual(pdfDocumentationProblems(paragraph, sources()), []);
});

test("an example URL looksLikePdfUrl refuses is refused", () => {
  const paragraph = pdfParagraph(read("docs/try-it.md")) as string;
  const problems = pdfDocumentationProblems(paragraph.replace(/report\.pdf/g, "report.html.pdfx"), sources());
  assert.ok(problems.some((p) => /example URL|gives no example/.test(p)), problems.join(" | "));
});

test("the scanner's rules are read, and there are three (the population the rule check stands on)", () => {
  assert.deepEqual([...scannerRules(read(PDF_SOURCE)).keys()].sort(), ["pdf-figure-no-alt", "pdf-missing-lang", "pdf-untagged"]);
});

test("runPdfLayer is checked for what it does: each way to make 'no worker' false is caught", () => {
  const cli = read(CLI_SOURCE);
  assert.deepEqual(runPdfLayerProblems(cli), []);
  const leasing = cli.replace("const result = await scanPdfTagTree(args.url);", "const lease = await leaseWorker(args);\n  const result = await scanPdfTagTree(args.url);");
  assert.match(runPdfLayerProblems(leasing).join("|"), /worker or a capture/);
  const reordered = cli.replace("if (looksLikePdfUrl(args.url)) { await runPdfLayer(args); return; }\n  const lease = await leaseWorker(args);",
    "const lease = await leaseWorker(args);\n  if (looksLikePdfUrl(args.url)) { await runPdfLayer(args); return; }");
  assert.notEqual(reordered, cli, "the mutation must change the source");
  assert.match(runPdfLayerProblems(reordered).join("|"), /before leasing/);
  const claimsAScreenReader = cli.replace('screenReader: "not applicable', 'screenReader: "NVDA');
  assert.match(runPdfLayerProblems(claimsAScreenReader).join("|"), /not applicable/);
});
