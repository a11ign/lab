// #1060: CAN A READER GET FROM `docs/try-it.md` TO A RUN, AND DO ITS NUMBERS AGREE WITH EACH OTHER?
//
// This is the page the project sends evaluators to. Two things on it stopped the evaluation, and both
// were found by the #915 rehearsal -- by following the page rather than by reading it.
//
// 1. IT OFFERED THE CLI AND NEVER OPENED IT. The page said "Nothing is published to npm yet. You install
//    from the repository" and then contained NO COMMANDS AT ALL -- one match across the whole page for
//    `npm`, `npx`, `git clone` or a fenced shell block, and it was that sentence. Its single link into the
//    README went to `## Using it`, past `### Locally instead` where the commands are.
//
// 2. ITS TIMING PROMISE WAS REFUTED BY THE NUMBERS IN ITS OWN SENTENCE. "Expect five to eight minutes ...
//    4 m 38 s, 4 m 50 s and 7 m 54 s ... within a few percent of each other." Two of the three cited
//    figures were below the floor it promised, and 278 s to 474 s is SEVENTY PER CENT apart. The claim was
//    made twice on the page, so a correction had two places to reach.
//
// WHY THE ASSERTIONS ARE PURE OVER AN INJECTED PAGE. A test that only read the real file could not tell
// "the page is correct" from "the parser found nothing to check" -- the two produce the same zero. Every
// rule below is a function over text, driven against synthetic pages that violate it, and the real page is
// then one more input rather than the only one.
//
// AND WHY THE TIMING BLOCK IS DELIMITED. The page has to be able to QUOTE a figure outside the range -- the
// consent-banner failure at 3 m 45 s is a finding and must stay quotable. A whole-page scan cannot tell a
// claim from a counter-example, so the checked population is marked and the explanation of the markers sits
// OUTSIDE them: a range named in a sentence about the old range is exactly what a text check cannot tell
// from the claim itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PAGE = resolve(REPO, "docs/try-it.md");
const page = () => readFileSync(PAGE, "utf8");

/** The runs that REACHED the page, and so the exact size of the checked population (#1060). */
const REACHING_RUNS = 5;

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Fenced blocks whose first token is something a shell would execute — never a prose mention. */
export function runnableCommands(text: string): string[] {
  // EVERY FENCE IS MATCHED AND THEN FILTERED BY LANGUAGE -- never "only the fences I want".
  //
  // The first attempt skipped a ```yaml opener by not listing `yaml`, so the regex then matched that
  // block's CLOSING fence as an opening one and returned the PROSE BETWEEN two code blocks as a block.
  // Two blocks on a page with five, and the wrong text for both. A scanner that ignores a delimiter it
  // does not care about loses its place in the file; one that reads every delimiter and discards by
  // label cannot.
  const blocks = [...text.matchAll(/^```([a-z]*)[ \t]*\n([\s\S]*?)^```/gm)]
    .filter((m) => ["", "bash", "sh", "console"].includes(m[1]))
    .map((m) => m[2]);
  return blocks.flatMap((b) => b.split("\n"))
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => /^(npm|npx|node|git|cd)\b/.test(line));
}

/**
 * The MEASUREMENT LIST only -- the figures enumerated after the "Measured on N real-page runs" clause,
 * up to the sentence that ends it.
 *
 * NOT every figure in the block, which is a different quantity and the one I first pinned by mistake:
 * `4 m 38 s` appears twice inside the markers, once as a measurement and once in the sentence naming the
 * floor, so a count of occurrences said SIX for five runs. Pinning that number would have pinned "how
 * often a figure is mentioned", which no one is trying to hold.
 */
export function measuredRuns(block: string): number[] {
  const list = /Measured on [^:]*:([\s\S]*?)\*\*/.exec(block)?.[1] ?? "";
  return figureSeconds(list);
}

/** Seconds for every `N m N s` figure in `text`. */
export function figureSeconds(text: string): number[] {
  return [...text.matchAll(/(\d+)\s*m\s*(\d+)\s*s/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
}

/** Every `<word> to <word> minutes` range in `text`, as [lowSeconds, highSeconds]. */
export function statedRanges(text: string): [number, number][] {
  const words = Object.keys(WORD_NUMBERS).join("|");
  return [...text.matchAll(new RegExp(`\\b(${words})\\s+to\\s+(${words})\\s+minutes\\b`, "gi"))]
    .map((m) => [WORD_NUMBERS[m[1].toLowerCase()] * 60, WORD_NUMBERS[m[2].toLowerCase()] * 60]);
}

/** The text between the TIMING markers, or null when the page carries none. */
export function timingBlock(text: string): string | null {
  const m = /<!--\s*TIMING:BEGIN\s*-->([\s\S]*?)<!--\s*TIMING:END\s*-->/.exec(text);
  return m === null ? null : m[1];
}

/** Figures in the block that fall outside the range the block itself states. */
export function figuresOutsideRange(block: string): number[] {
  const ranges = statedRanges(block);
  if (ranges.length === 0) return figureSeconds(block); // a block promising nothing cannot hold a figure
  const [low, high] = ranges[0];
  return figureSeconds(block).filter((s) => s < low || s > high);
}

test("#1060 ACCEPTANCE: the page carries a runnable install command and a runnable run command", () => {
  const commands = runnableCommands(page());
  assert.ok(commands.some((c) => /^git clone\b/.test(c)),
    "a reader told to install from the repository needs the clone, not a sentence saying to");
  assert.ok(commands.some((c) => /^npm install\b/.test(c)), "and the install");
  assert.ok(commands.some((c) => /^npm run witness\b/.test(c)), "and the command that actually runs it");
});

test("#1060 POSITIVE CONTROL: prose about installing does not count as a command", () => {
  // The page as it was: the sentence, and nothing else. If this returns a command the rule is a
  // word-search and the whole assertion above is satisfied by the defect it exists to catch.
  const prose = "- **Nothing is published to npm yet.** You install from the repository.\n"
    + "Run `npm install` when you have cloned it.\n";
  assert.deepEqual(runnableCommands(prose), [],
    "an inline mention and a backticked word are not a fenced command");
  assert.deepEqual(runnableCommands("```bash\nnpm install\n```"), ["npm install"],
    "and a fenced one is -- or the rule is satisfied by nothing at all");
});

test("#1060 ACCEPTANCE: every figure in the timing block is inside the range the block promises", () => {
  const block = timingBlock(page());
  assert.ok(block !== null, "the timing claim must be inside markers, or its population is the whole page");
  assert.equal(statedRanges(block).length, 1, "exactly one range in the block -- two is the drift itself");
  assert.deepEqual(figuresOutsideRange(block), [],
    "a promised floor with figures below it is the defect #915 found: the evidence refutes the claim "
    + "in the same sentence");
});

test("#1060 MUTATION TARGET: the containment rule catches the page as it was", () => {
  const asItWas = "**Expect five to eight minutes for a real page.** Measured on three dissimilar real "
    + "pages (#311): 4 m 38 s, 4 m 50 s and 7 m 54 s.";
  assert.deepEqual(figuresOutsideRange(asItWas), [278, 290],
    "both figures under the five-minute floor must be named -- this is the rule proved on the real defect, "
    + "not on a fixture invented to pass it");
  const corrected = asItWas.replace("five to eight", "four to eight");
  assert.deepEqual(figuresOutsideRange(corrected), [], "and the correction must clear it");
});

test("#1060: the checked population is PINNED, because the author chooses what goes inside the markers", () => {
  // worker-capture's finding on #1062, reproduced before it was fixed: move `4 m 38 s` out of the block
  // and add "A further run took 1 m 02 s." after TIMING:END, and the suite was **24 pass / 0 fail**. The
  // figure establishing the floor left the checked set, a figure under a quarter of the stated minimum
  // appeared on the page, and nothing said anything.
  //
  // WHAT THE MARKERS BOUGHT AND WHAT THEY COST. They let the page quote the 3 m 45 s consent failure as
  // the failure it is -- real evidence a reader needs. But an exemption with no bound is a guard people
  // route around, which is exactly why `ceo` bounded #891's address exemption to one `/24` and nothing
  // broader. Here the bound is the COUNT: the population is five long and enumerable, so it is pinned
  // exactly rather than floored.
  //
  // The over-broad alternative -- every duration figure on the page must be inside the block -- was
  // considered and rejected: it refuses the consent-banner quote, and an over-broad guard here is worse
  // than the gap it closes.
  const block = timingBlock(page());
  assert.ok(block !== null);
  const measured = measuredRuns(block!);
  assert.equal(measured.length, REACHING_RUNS,
    `the measurement list must hold exactly ${REACHING_RUNS} runs. Removing one silently shrinks the `
    + "population every other assertion here is computed over; adding one means a new measurement, which "
    + "is a deliberate edit to this number and to the prose beside it");
  // AND THE PROSE COUNT, because "five real-page runs" is a claim about the list that follows it. Pinning
  // the list without pinning the word leaves the two free to drift, which is this repo's most expensive
  // recurring shape and the reason the range is pinned across its two copies four tests down.
  assert.equal(WORD_NUMBERS[/on (\w+) real-page runs/.exec(block!)?.[1]?.toLowerCase() ?? ""], measured.length,
    "the number spelled in the sentence and the number of figures after it are the same number");
});

test("#1060: the floor the prose names is the smallest figure in the block", () => {
  // Pinning the count stops the population shrinking; it does not stop a swap. "the fastest run that
  // reached the page was 4 m 38 s" is a claim ABOUT the figures beside it, so it is checked against them
  // rather than left as prose that happens to be true today.
  const block = timingBlock(page());
  assert.ok(block !== null);
  const stated = figureSeconds(/the fastest run that\s+reached the page was ([^-]+)/.exec(block!)?.[1] ?? "");
  assert.equal(stated.length, 1, "the block states one fastest figure");
  // AGAINST THE MEASUREMENT LIST, NOT AGAINST EVERY FIGURE IN THE BLOCK. The first version compared the
  // stated floor to `min(figureSeconds(block))` -- and the floor sentence's own figure is IN the block, so
  // the minimum could never exceed it and the assertion could never fail. Proved by mutation: swapping
  // `4 m 38 s` for `5 m 10 s` in the measurement list was 0 red, because the sentence's own copy kept the
  // minimum at 278. A check whose input contains its own claim is the fixture-names-itself shape, two
  // tests after the comment warning about it.
  assert.equal(stated[0], Math.min(...measuredRuns(block!)),
    "the named floor and the smallest MEASURED run are the same number, or the prose is describing a run "
    + "that is no longer in the set");
});

test("#1060: the range is stated more than once, and every statement agrees", () => {
  // The old claim appeared twice, so a fix had two places to reach and could land in one. The block is
  // the source; any other range on the page must match it rather than be checked independently.
  const text = page();
  const block = timingBlock(text);
  assert.ok(block !== null);
  const [canonical] = statedRanges(block);
  const everywhere = statedRanges(text);
  assert.ok(everywhere.length >= 2, "this only means anything while the page states the range twice");
  for (const range of everywhere) {
    assert.deepEqual(range, canonical, "a second copy of the range that disagrees with the checked one is "
      + "the shape this repo calls a fact stated twice, and the copies drifted");
  }
});

test("#1060: a spread claimed in prose matches the figures it is claimed about", () => {
  // "within a few percent of each other" sat beside 278 s and 474 s -- seventy per cent apart. The
  // replacement states a number, so the number is checked rather than the adjective.
  const block = timingBlock(page());
  assert.ok(block !== null);
  const seconds = figureSeconds(block);
  const spread = Math.round((Math.max(...seconds) / Math.min(...seconds) - 1) * 100);
  const claimed = /\b(\w+)\s+per\s+cent\s+longer\b/i.exec(block!);
  assert.ok(claimed !== null, "the block states a spread");
  const stated = WORD_NUMBERS[claimed![1].toLowerCase()] ?? Number(claimed![1]);
  const asTens = /seventy/i.test(claimed![1]) ? 70 : stated;
  assert.ok(Math.abs(asTens - spread) <= 1,
    `the block says ${claimed![1]} per cent and its own figures say ${spread}`);
  assert.ok(!/within a few percent/i.test(block!),
    "the phrase that was refuted by the numbers beside it must not come back");
});

test("#1060: every link and anchor on the page resolves", () => {
  // Replaces the acceptance's "the link to the README's local instructions resolves to the section that
  // holds them": the commands are now ON this page, so there is no such link to check. The general rule
  // is stronger and covers the two anchors the new section adds.
  const text = page();
  const slugs = new Set([...text.matchAll(/^#{1,6} (.+)$/gm)]
    .map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-")));
  const broken: string[] = [];
  for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (link.startsWith("#")) { if (!slugs.has(link.slice(1))) broken.push(link); continue; }
    if (!link.startsWith("./") && !link.startsWith("../")) continue;
    const file = link.split("#")[0];
    const target = link.startsWith("../") ? resolve(REPO, file.slice(3)) : resolve(REPO, "docs", file.slice(2));
    if (!existsSync(target)) broken.push(link);
  }
  assert.deepEqual(broken, [], "a page that sends a reader somewhere must send them somewhere that exists");
});
