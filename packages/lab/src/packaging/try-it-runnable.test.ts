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
import { parse as parseYaml } from "yaml";
import { warnUtmDeprecated } from "../../../worker-fleet/src/utm-deprecated.mjs";
import { DEFAULT_WORKER } from "../../../worker-fleet/src/local-vm.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PAGE = resolve(REPO, "docs/try-it.md");
const page = () => readFileSync(PAGE, "utf8");

/** The runs that REACHED the page, and so the exact size of the checked population (#1060, widened to the
 * full eleven-run measurement by #311's 2026-09-19 reconciliation with #915). */
const REACHING_RUNS = 11;

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
    .filter((line) => /^(npm|npx|pnpm|node|git|cd)\b/.test(line));
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
  assert.ok(commands.some((c) => /^pnpm install\b/.test(c)), "and the install");
  assert.ok(commands.some((c) => /^pnpm run witness\b/.test(c)), "and the command that actually runs it");
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

// #3186: THE PAGE SAID NOTHING WAS PUBLISHED, AND THE REGISTRY HAD SERVED `a11ign@0.1.0` SINCE 2026-09-19.
//
// Nothing checked it: `registry-consumer-gate.yml` ran `npx a11ign <url>` on a Windows runner while the page told a
// stranger it could not be done. Two decisions, both pure over the page's text, so the real page is one more input and
// a fixture that violates the rule proves the rule can fail.
//
// The command is READ FROM THE GATE, not retyped here: a test that spelled out `npx a11ign` itself would stay green
// after the gate moved to another bin, and the page would go on promising the old one.
const REGISTRY_GATE = resolve(REPO, ".github/workflows/registry-consumer-gate.yml");

/** The page's sentences while the package was already on the registry, verbatim, for the positive control. */
const OLD_LINE_34 = "- **Nothing is published to npm yet.** You install from the repository — [the commands are below]"
  + "(#the-other-route-run-it-from-the-repository), and `npx a11ign` will not work yet.";
const OLD_LINE_294 = "It is the same tool; the difference is where the Windows machine comes from. **`npx a11ign` does not work\n"
  + "yet** — nothing is published — so the package comes from a clone.";

const UNPUBLISHED_CLAIMS: readonly RegExp[] = [
  /nothing\s+is\s+published/gi,
  /(?:not|isn't)\s+published(?:\s+to\s+npm)?\s+yet/gi,
  /(?:does|will)\s+not\s+work\s+yet/gi,
];

/**
 * Every claim that the package is unpublished or that `npx a11ign` fails, by the line it STARTS on. The text is read
 * whole because sentences wrap: line 294's `does not work` / `yet` broke across two lines.
 */
export function unpublishedClaims(text: string): { line: number; text: string }[] {
  return UNPUBLISHED_CLAIMS
    .flatMap((pattern) => [...text.matchAll(pattern)].map((m) => ({
      line: text.slice(0, m.index).split("\n").length, text: m[0].replace(/\s+/g, " "),
    })))
    .sort((a, b) => a.line - b.line);
}

/** What a stranger types, taken from the gate's own invocation minus `--no-install`, which is there only because the gate has installed it. */
export function consumerCommand(workflowYaml: string): string {
  const workflow = parseYaml(workflowYaml) as { jobs: Record<string, { steps: { run?: string }[] }> };
  const runs = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.run ?? ""));
  const invocation = /\bnpx\s+(?:--no-install\s+)?(a11ign)\s+"\$\w+"/.exec(runs.join("\n"));
  if (invocation === null) throw new Error("registry-consumer-gate.yml runs no `npx a11ign \"$VAR\"` step, so there is no command to compare the page with");
  return `npx ${invocation[1]}`;
}

/** Whether a line STARTS with the command and a URL: a command in a fence, not prose about one. */
export function statesRoute(text: string, command: string): boolean {
  return text.split("\n").some((line) => line.startsWith(`${command} http`));
}

/** The old sentences at their old line numbers, filler between them: the page at the commit before #3186. */
function pageBefore3186(): string {
  const filler = (count: number): string[] => Array.from({ length: count }, () => "filler");
  return [...filler(33), OLD_LINE_34, ...filler(259), OLD_LINE_294].join("\n");
}

test("#3186 ACCEPTANCE: the page makes no claim that the package is unpublished or that npx does not work", () => {
  assert.deepEqual(unpublishedClaims(page()), []);
});

test("#3186 POSITIVE CONTROL: the sentences as they stood are refused, at lines 34 and 294", () => {
  // The control for the emptiness assertion above. Line 295 is a third claim, `nothing is published`, which the old
  // text also made one line below the wrapped `does not work yet`.
  const refusals = unpublishedClaims(pageBefore3186());
  assert.deepEqual([...new Set(refusals.map((r) => r.line))], [34, 294, 295]);
  assert.ok(refusals.some((r) => r.line === 294 && /does not work yet/.test(r.text)),
    "the claim that wrapped across two lines was missed");
});

test("#3186: each unpublished claim is refused on its own, wrapped or not, and the true sentence is not", () => {
  for (const sentence of ["Nothing is published to npm yet.", "nothing is\npublished", "it is not published yet",
    "`npx a11ign` will not work yet", "`npx a11ign` does not work\nyet"]) {
    assert.ok(unpublishedClaims(`one\ntwo\n${sentence}`).length > 0, `not refused: ${JSON.stringify(sentence)}`);
  }
  assert.deepEqual(unpublishedClaims("npx a11ign works, and the package is published to npm."), []);
});

test("#3186: the command is read from the registry gate, and a gate without one is an error, not an empty answer", () => {
  assert.equal(consumerCommand(readFileSync(REGISTRY_GATE, "utf8")), "npx a11ign");
  assert.throws(() => consumerCommand("jobs:\n  a:\n    steps:\n      - run: echo nothing\n"), /no command to compare/);
});

test("#3186 ACCEPTANCE: the page states the route that works today, and a page without it is refused", () => {
  const command = consumerCommand(readFileSync(REGISTRY_GATE, "utf8"));
  assert.equal(statesRoute(page(), command), true);
  const withoutRoute = page().split("\n").filter((line) => !line.startsWith(command)).join("\n");
  assert.equal(statesRoute(withoutRoute, command), false);
  assert.equal(statesRoute(`prose about ${command} https://example.com`, command), false,
    "a mention in a sentence is not the command a stranger can paste");
});

// #3198: THE PAGE QUOTES THE REFUSAL "EXACTLY ... QUOTED RATHER THAN PARAPHRASED" AND LEFT OUT THE FOUR LINES THE
// CLI PRINTS BEFORE IT. Measured 2026-10-03 with the published `npx a11ign` from an empty directory and no worker: a
// UTM deprecation notice, then `Using http://localhost:8765 (default)`, then the refusal `quoted-cli-output.test.ts`
// already compares. A stranger who typed the page's command got a screen the page had never shown them.
//
// The expected text is DERIVED, never retyped: the notice from `warnUtmDeprecated` itself (its stderr captured), the
// sentence it is called with from the call site in `local-vm.ts`, and the source label from `describeSource` in `cli.ts`.
// A fourth copy of the string here would be the defect this row is about. The refusal stays in its own fence and its
// own test, so the two comparisons do not share a failure.
const LOCAL_VM_SOURCE = resolve(REPO, "packages/worker-fleet/src/local-vm.ts");
const CLI_SOURCE = resolve(REPO, "packages/cli/src/cli.ts");
const REFUSAL_OPENING = "No capture worker answered";

const normalized = (text: string): string => text.trim().replace(/\s+/g, " ");

function firstMatch(source: string, pattern: RegExp, what: string): string {
  const found = source.match(pattern);
  if (!found) throw new Error(`no ${what} found in the CLI's source -- the marker moved, so this test can read nothing`);
  return found[1];
}

function capturedStderr(write: () => void): string {
  const original = process.stderr.write;
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
  try { write(); } finally { process.stderr.write = original; }
  return captured;
}

/** The lines the CLI writes before the refusal on a run with no worker named and no fleet configured. */
function preambleFromSource(): string {
  const caller = firstMatch(readFileSync(LOCAL_VM_SOURCE, "utf8"), /warnUtmDeprecated\("([^"]+)"\)/, "warnUtmDeprecated call");
  const label = firstMatch(readFileSync(CLI_SOURCE, "utf8"),
    /function describeSource[\s\S]*?return "([^"]+)";\s*\}/, "describeSource fallback label");
  return `${capturedStderr(() => warnUtmDeprecated(caller))}Using ${DEFAULT_WORKER} (${label})`;
}

/** Every fenced block on the page, in order, read line by line: a closing fence is not mistaken for an opening one. */
function fencedBlocks(pageText: string): string[] {
  const blocks: string[] = [];
  let open: string[] | undefined;
  for (const line of pageText.split("\n")) {
    if (open === undefined && line.startsWith("```")) open = [];
    else if (open !== undefined && line === "```") { blocks.push(open.join("\n")); open = undefined; }
    else if (open !== undefined) open.push(line);
  }
  return blocks;
}

/** The fenced block that opens the quote, or undefined: the one that comes BEFORE the refusal's own fence. */
function preambleQuote(pageText: string): string | undefined {
  const blocks = fencedBlocks(pageText);
  const refusalAt = blocks.findIndex((body) => body.startsWith(REFUSAL_OPENING));
  return blocks.slice(0, Math.max(refusalAt, 0)).find((body) => body.startsWith("DEPRECATED"));
}

function quotesPreamble(pageText: string, expected: string): boolean {
  const quoted = preambleQuote(pageText);
  return quoted !== undefined && normalized(quoted) === normalized(expected);
}

test("#3198 ACCEPTANCE: the page quotes the lines the CLI prints before the refusal", () => {
  assert.equal(quotesPreamble(page(), preambleFromSource()), true,
    "docs/try-it.md's first fenced quote is not what the CLI prints before `No capture worker answered` -- update the page");
});

test("#3198 POSITIVE CONTROL: the expected text is the real notice, and a page without it is refused", () => {
  const expected = preambleFromSource();
  assert.match(expected, /^DEPRECATED: this run \(no worker named, no fleet configured\) manages a local UTM worker VM\./);
  assert.match(expected, /\nUsing http:\/\/localhost:8765 \(default\)$/);
  const quote = preambleQuote(page());
  assert.ok(quote !== undefined, "the real page has no preamble fence for the control to drop");
  const dropped = page().replace(`\`\`\`\n${quote}\n\`\`\``, "");
  assert.notEqual(dropped, page(), "the fixture dropped nothing");
  assert.equal(quotesPreamble(dropped, expected), false, "a page with the preamble dropped was accepted");
});

test("#3198: a quote missing either half of the preamble, or one that changed a word, is refused", () => {
  const expected = preambleFromSource();
  const fence = (body: string): string => `\`\`\`\n${body}\n\`\`\`\n\n\`\`\`\n${REFUSAL_OPENING} at x\n\`\`\``;
  const [notice, using] = [expected.split("\nUsing ")[0], `Using ${expected.split("\nUsing ")[1]}`];
  assert.equal(quotesPreamble(fence(expected), expected), true, "the exact text was refused");
  assert.equal(quotesPreamble(fence(notice), expected), false, "the `Using` line was not required");
  assert.equal(quotesPreamble(fence(using), expected), false, "the notice was not required");
  assert.equal(quotesPreamble(fence(expected.replace("UTM", "VM")), expected), false, "a changed word was accepted");
});

test("#3198: a preamble fence AFTER the refusal is not the quote of what comes first", () => {
  const expected = preambleFromSource();
  const after = `\`\`\`\n${REFUSAL_OPENING} at x\n\`\`\`\n\n\`\`\`\n${expected}\n\`\`\``;
  assert.equal(quotesPreamble(after, expected), false);
});
