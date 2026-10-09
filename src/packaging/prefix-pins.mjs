// @ts-check
/**
 * #2247: THE PINS THAT KEEP A LESSON FROM BEING LOST, AS A TABLE THAT CARRIES ITS OWN TIER.
 *
 * `roles-readme.test.ts` pins sentences of the rules every session loads. What those pins are FOR is that
 * the org did not quietly lose a lesson. What they ENFORCED was that the lesson sits in the loaded file, a
 * stronger claim nobody decided to make, and the one that made compression impossible: a narrative sentence
 * could not move to `docs/operational-lessons.md` without turning a pin red, so the only compression left
 * was deletion. `ceo` ruled the split on 2026-09-23 (#2217, comment 5802922295).
 *
 * ## THE TWO TIERS, AND THE TEST THAT TELLS THEM APART
 *
 * - **IMPERATIVE** -- a session acting WITHOUT this sentence would take the wrong action: the command to
 *   type, the thing to refuse, whose decision it is, the one clause of why that stops the override. It stays
 *   in the loaded file, and a pin on it fails when it moves, whatever the destination holds.
 * - **NARRATIVE** -- EVIDENCE for a rule stated elsewhere: the incident, the measurement, the date, the
 *   issue number. It may live in the loaded file OR in a named destination, and the pin moves with it.
 *
 * **WHEN IN DOUBT A PIN IS IMPERATIVE.** That is the direction that costs bytes rather than a lesson: a
 * mis-tiered narrative pin can be relaxed by a later row, and a mis-tiered imperative one is a rule that
 * left the prefix and is read after the command it governed. Two tiered-imperative pins are the closest calls
 * and are named where they sit.
 *
 * ## WHAT THE SPLIT DOES NOT DO
 *
 * Every pattern is exactly as it was in `roles-readme.test.ts`, and each still fails if its sentence is in
 * NEITHER place. Only the set of files a NARRATIVE pin may be found in widens, and it widens to the named
 * list below, never to a directory. Nothing here moves prose: that is #2217's flow and the adding author's
 * debt.
 *
 * ## THE LIST IS DUPLICATED FROM `rules-files.ts`, AND THE COPY IS PINNED
 *
 * This file is `.mjs` so that plain `node` can import it (the row's Acceptance runs it with no test runner),
 * and plain `node` cannot import `rules-files.ts`. So `LOADED_RULES_FILES` restates it, and
 * `roles-readme.test.ts` asserts the two are equal -- a fact stated twice is guarded rather than trusted.
 * Making `rules-files` an `.mjs` would remove the copy and is outside this row's Region.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export const IMPERATIVE = "imperative";
export const NARRATIVE = "narrative";

/** The entry point every session loads beside the rules. It carries no pin; it is in the denominator. */
const ENTRY_FILE = "CLAUDE.md";

/** Every rules file a session loads. Named, never globbed; mirrors `RULES_FILES` in `rules-files.ts`. */
export const LOADED_RULES_FILES = [
  ".claude/rules/agent-practices.md",
  ".claude/rules/org-routing-and-timers.md",
  ".claude/rules/waiting-conditions.md",
  ".claude/rules/gh-api-budget.md",
  ".claude/rules/main-review-requirement.md",
  ".claude/rules/guards-and-assertions.md",
];

/** The files a NARRATIVE sentence may move to. A list in the tree, not a directory walk. */
export const NARRATIVE_DESTINATIONS = ["docs/operational-lessons.md"];

/**
 * @typedef {{ id: string, tier: "imperative" | "narrative", pattern: RegExp }} Pin
 * `pattern` is matched against WHITESPACE-COLLAPSED text, because the files wrap and a prose pin against a
 * wrapped file matches a line, not a sentence.
 */

/** @type {Pin[]} */
export const PINS = [
  // --- #1157: the emptiness assertion and where its positive control lives ---
  { id: "emptiness.positive-control", tier: IMPERATIVE,
    pattern: /an emptiness assertion names where its positive control lives/i },
  { id: "emptiness.point-at-it", tier: IMPERATIVE, pattern: /point at it/i },
  { id: "emptiness.call-population", tier: NARRATIVE, pattern: /64 derive from a CALL|64 call-derived/i },

  // --- #1967: the broken gauge and the instrument that replaces it ---
  { id: "gauge.never-endpoint", tier: IMPERATIVE, pattern: /never decide anything from `gh api rate_limit`/i },
  { id: "gauge.instrument", tier: IMPERATIVE, pattern: /read `X-Ratelimit-\*` off a real call/i },
  { id: "gauge.command", tier: IMPERATIVE, pattern: /gh api graphql[^`]*-i/ },
  { id: "gauge.headers-on-403", tier: IMPERATIVE, pattern: /headers come back on the 403/i },
  { id: "gauge.per-token-per-resource", tier: IMPERATIVE, pattern: /per TOKEN and per RESOURCE/i },
  { id: "gauge.which-pool-is-spent", tier: IMPERATIVE, pattern: /spend GRAPHQL|spends CORE/ },
  { id: "gauge.sanity-check-on-core", tier: IMPERATIVE, pattern: /a sanity check on core is not a sanity check/i },
  { id: "gauge.same-token-same-second", tier: NARRATIVE, pattern: /same token, same second/i },

  // --- #2076: the empty-guard, written where a session loads it before typing the command ---
  { id: "click-through.principle", tier: IMPERATIVE,
    pattern: /an approval prompt a human learns to click through is worse than no prompt/i },
  { id: "click-through.remedy", tier: IMPERATIVE, pattern: /rm -f "\$\{D:\?\}"\/\*\.md/ },
  { id: "click-through.why-it-works", tier: IMPERATIVE, pattern: /abort on an unset or empty variable/i },
  // CLOSE CALL, kept imperative: without it a reader hunts for the override, which is the wrong action.
  { id: "click-through.bypass-survives", tier: IMPERATIVE, pattern: /dangerously-skip-permissions/ },
  { id: "click-through.shape-not-effect", tier: IMPERATIVE,
    pattern: /when a command is refused for its SHAPE rather than its EFFECT, change the shape/i },
  { id: "click-through.not-an-override", tier: IMPERATIVE,
    pattern: /reaching for an override, or asking a human to approve it again, both leave the next session to rediscover the same refusal/i },
  { id: "click-through.several-times", tier: NARRATIVE, pattern: /several times in one morning/i },
  { id: "click-through.cheaper-to-ignore", tier: IMPERATIVE,
    pattern: /makes the unavoidable ones cheaper to ignore/i },
  // CLOSE CALL, kept imperative: it tells a reader not to go hunting for offenders that are not there.
  { id: "click-through.prevention", tier: IMPERATIVE, pattern: /prevention rather than cleanup/i },
  { id: "click-through.quoting-is-half", tier: IMPERATIVE,
    pattern: /quoting alone defuses the BARE-VARIABLE case, and buys nothing once a glob is attached/i },
  { id: "click-through.glob-trigger", tier: IMPERATIVE, pattern: /the moment a glob joins the variable/i },
  { id: "click-through.grep-undercounts", tier: NARRATIVE,
    pattern: /puts a `--` where the regex expects the target/i },

  // --- #2025: which account this session is spending ---
  { id: "identity.default-is-a-person", tier: IMPERATIVE,
    pattern: /the default `~\/\.config\/gh` authenticates as a person \(`DanBeckDev`\)/i },
  { id: "identity.workers-is-the-bot", tier: IMPERATIVE,
    pattern: /`GH_CONFIG_DIR=\/home\/agent\/workers\/gh` as `a11ign-ai-workers`/ },
  { id: "identity.which-unit-sets-it", tier: NARRATIVE,
    pattern: /which is what `a11ign-work-tick\.service` sets/i },
  { id: "identity.the-refusal", tier: IMPERATIVE,
    pattern: /you must not switch to the other config to get past your own limit/i },
  { id: "identity.attribution-is-the-ground", tier: IMPERATIVE,
    pattern: /one export changes who every subsequent write is attributed to/i },
  { id: "identity.whose-decision", tier: IMPERATIVE,
    pattern: /that disposition is `ceo`'s \(`lane:ceo`, #916\) rather than yours/i },
  { id: "identity.wait-out-your-reset", tier: IMPERATIVE, pattern: /wait out your own reset/i },
  { id: "identity.routing-wrapper", tier: IMPERATIVE,
    pattern: /is a ROUTING WRAPPER ahead of `\/usr\/bin\/gh`/ },
  { id: "identity.agents-are-never-the-human", tier: IMPERATIVE,
    pattern: /an agent workspace gets the workers config, or the leads config when it is in `~\/leads\/workspaces\.txt` \(w6 w2 w5\); NO agent gets the person's/ },
  { id: "identity.the-third-account", tier: IMPERATIVE,
    pattern: /`\/home\/agent\/leads\/gh` as `a11ign-ai-leads`/ },
  { id: "identity.units-declare-it", tier: IMPERATIVE,
    pattern: /No workspace id means a person, so a systemd unit must DECLARE `GH_CONFIG_DIR`/ },
  { id: "identity.name-the-account-first", tier: IMPERATIVE,
    pattern: /run `gh api user --jq \.login` first, then the headers/i },
  { id: "identity.path-decides-the-pool", tier: IMPERATIVE, pattern: /PATH and workspace id decide the pool/i },

  // --- #2093: two surfaces carry the review requirement ---
  { id: "review.two-surfaces", tier: IMPERATIVE,
    pattern: /TWO SURFACES CARRY THE REQUIREMENT, and a reading of one is not a reading of the other/i },
  { id: "review.ruleset-id", tier: IMPERATIVE, pattern: /`merge-queue-main` ruleset \(id `23681721`\)/ },
  { id: "review.exemptions-do-not-compose", tier: IMPERATIVE,
    pattern: /requirements compose and exemptions do not/i },
  { id: "review.classic-is-enumerable", tier: IMPERATIVE,
    pattern: /the only surface whose exemption list can be ENUMERATED rather than merely queried for one identity/i },
  { id: "review.pick-your-instrument", tier: IMPERATIVE,
    pattern: /PICK THE INSTRUMENT BY WHAT YOU HOLD, AND SAY WHICH ONE YOU USED/i },
  { id: "review.admin-instrument", tier: IMPERATIVE,
    pattern: /`branches\/main\/protection`, behind `A11Y_CHECK_BRANCH_PROTECTION=1`/ },
  { id: "review.cheap-instrument", tier: IMPERATIVE,
    pattern: /`rules\/branches\/main` plus `rulesets\/\{id\}`, behind `A11Y_CHECK_MAIN_RULESET=1`/ },
  { id: "review.bounded-claim", tier: IMPERATIVE,
    pattern: /`current_user_can_bypass: "never"` answers FOR ME ALONE and does not mean nobody is exempt/i },
  { id: "review.absence-is-not-emptiness", tier: IMPERATIVE,
    pattern: /its absence means "you may not look", never "the list is empty"/i },
  { id: "review.cannot-tell-stands", tier: IMPERATIVE,
    pattern: /`CANNOT_TELL` stands unchanged as the verdict for/i },
  { id: "review.not-acceptable-by-being-cheap", tier: NARRATIVE,
    pattern: /does not become acceptable by being cheap/i },

  // --- #2223: the scratchpad is shared by every session, and a full one fails without saying why ---
  { id: "scratchpad.no-self-capture", tier: IMPERATIVE,
    pattern: /never capture output into a directory you are also reading/i },
  { id: "scratchpad.no-large-artefacts", tier: IMPERATIVE,
    pattern: /no virtualenvs, wheels, weights or fetched corpora in the scratchpad/i },
  // The clause of why that lets a session recognise the failure: it arrives as empty output or ENOSPC, not as a message about the disk.
  { id: "scratchpad.full-is-unlabelled", tier: IMPERATIVE,
    pattern: /a full one shows as empty output or ENOSPC/i },
];

/** The pin with this id. Throws on an unknown id: a pin that is not there must never read as one that passes. */
export function pinById(/** @type {string} */ id) {
  const pin = PINS.find((candidate) => candidate.id === id);
  if (pin === undefined) throw new Error(`no pin named ${id} in prefix-pins.mjs`);
  return pin;
}

/** The pattern of the pin with this id, for the code that mutates or reuses it. */
export const pinPattern = (/** @type {string} */ id) => pinById(id).pattern;

/** The files a pin subject is read from: the loaded rules, then the named narrative destinations. */
export const pinCorpusFiles = () => [...LOADED_RULES_FILES, ...NARRATIVE_DESTINATIONS];

const readRepoFile = (/** @type {string} */ rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Whitespace-collapsed, the form every pattern is written against. */
export const flatten = (/** @type {string} */ text) => text.replace(/\s+/g, " ");

/**
 * @typedef {{ loaded: string, destinations: string }} PinSubject
 * The two halves a pin is matched against, both whitespace-collapsed.
 */

/** @returns {PinSubject} the loaded rules and the narrative destinations, read from disk. */
export function readPinSubject() {
  const joined = (/** @type {string[]} */ files) => flatten(files.map(readRepoFile).join("\n"));
  return { loaded: joined(LOADED_RULES_FILES), destinations: joined(NARRATIVE_DESTINATIONS) };
}

/**
 * THE ASYMMETRY THAT IS THE WHOLE RULING. An IMPERATIVE pin is matched against the loaded rules ALONE; a
 * NARRATIVE pin against the loaded rules PLUS the destinations. If both tiers accepted either file the split
 * would be a no-op that reads as a compression licence.
 *
 * @param {Pin} pin
 * @param {PinSubject} subject
 */
export const textForPin = (pin, subject) =>
  pin.tier === NARRATIVE ? `${subject.loaded}\n${subject.destinations}` : subject.loaded;

/**
 * Collapse whitespace as `flatten` does, and remember where each collapsed character came from, so a span
 * found in the collapsed text can be counted in the ORIGINAL file's bytes.
 * @param {string} text
 */
function flattenWithOrigin(text) {
  let flat = "";
  /** @type {number[]} */
  const origin = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace && inSpace) continue;
    flat += isSpace ? " " : text[i];
    origin.push(i);
    inSpace = isSpace;
  }
  return { flat, origin };
}

/** Above this a code point is a surrogate PAIR: two UTF-16 units, so two indices of `text`. */
const LAST_BMP_CODE_POINT = 0xffff;

/** Bytes (UTF-8) of the characters `covered` marks -- an em dash is three, so length would under-read. */
function coveredBytes(/** @type {string} */ text, /** @type {Uint8Array} */ covered) {
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const codePoint = /** @type {number} */ (text.codePointAt(i));
    if (covered[i] === 1) bytes += Buffer.byteLength(String.fromCodePoint(codePoint));
    i += codePoint > LAST_BMP_CODE_POINT ? 2 : 1;
  }
  return bytes;
}

/**
 * Bytes of `text` that at least one match of any of `patterns` covers, counted ONCE each. The patterns are
 * matched against the whitespace-collapsed text and the spans are carried back to the original, so the count
 * is of the file as it sits on disk.
 *
 * @param {string} text
 * @param {RegExp[]} patterns
 */
export function coveredByPatterns(text, patterns) {
  const covered = new Uint8Array(text.length);
  const { flat, origin } = flattenWithOrigin(text);
  for (const pattern of patterns) {
    const everywhere = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    for (const match of flat.matchAll(everywhere)) {
      if (match[0].length === 0) continue;
      covered.fill(1, origin[match.index], origin[match.index + match[0].length - 1] + 1);
    }
  }
  return coveredBytes(text, covered);
}

/**
 * THE MEASUREMENT: how many bytes of the loaded set some pin's match covers.
 *
 * **A UNION, NOT A SUM.** Two pins can cover the same words, and a sum over matches over-reads exactly where
 * the pins are densest -- the direction that would flatter the ruling. Each byte is counted once per figure,
 * so `byTier` figures can add up to MORE than `total` where an imperative and a narrative pin overlap.
 *
 * **IT COUNTS THE MATCHED PHRASE, NOT THE SENTENCE OR THE SECTION AROUND IT,** so it is a FLOOR on what a pin
 * protects and never an estimate of it. **IT COUNTS THIS TABLE'S PINS ONLY** -- the ones `roles-readme.test.ts`
 * asserts. Any other test that pins the loaded set is outside it, so this cannot confirm or refute a
 * whole-tree figure. Only the rules files are matched against (that is what the pins are asserted on);
 * `CLAUDE.md` is in the denominator because a session pays for it, and carries no pin.
 *
 * @returns {{ total: number, byTier: Record<string, number>, byFile: Record<string, number>,
 *   loadedSetBytes: number }}
 */
export function pinnedProseReading() {
  const patternsOf = (/** @type {Pin[]} */ pins) => pins.map((pin) => pin.pattern);
  /** @type {Record<string, number>} */
  const byTier = { [IMPERATIVE]: 0, [NARRATIVE]: 0 };
  /** @type {Record<string, number>} */
  const byFile = {};
  for (const file of LOADED_RULES_FILES) {
    const text = readRepoFile(file);
    byFile[file] = coveredByPatterns(text, patternsOf(PINS));
    for (const tier of [IMPERATIVE, NARRATIVE]) {
      byTier[tier] += coveredByPatterns(text, patternsOf(PINS.filter((pin) => pin.tier === tier)));
    }
  }
  const total = Object.values(byFile).reduce((sum, bytes) => sum + bytes, 0);
  return { total, byTier, byFile, loadedSetBytes: loadedSetBytes() };
}

/** Bytes of what every session loads before it can act: `CLAUDE.md` plus the named rules. */
export const loadedSetBytes = () =>
  [ENTRY_FILE, ...LOADED_RULES_FILES].reduce((sum, file) => sum + statSync(join(REPO_ROOT, file)).size, 0);

/** The union figure the row's Acceptance asks for. */
export const pinnedProseBytes = () => pinnedProseReading().total;
