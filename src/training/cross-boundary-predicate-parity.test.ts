// THE PRECEDENT EVERYBODY CITES WAS ITSELF UNPINNED.
//
// `media-signal-parity.test.ts` pinned `autoplayUncontrollable`/`addAutoplayingAudio` equal, on the
// deliberate-duplication basis stated there: `packages/lab`'s corpus generator runs under plain node, and
// depending on a `packages/judge` build to reach it is how a stale `dist` scored the wrong rules once
// already (`name-normalisation.test.ts`'s own incident). That basis was justified by citing TWO older
// duplications across the same boundary -- and neither was pinned. This file is the third tier
// (CLAUDE.md's remedy order: delete a copy, else derive one, else pin them equal with a test) for both:
//
//   contextChanged (judge/rules.ts)          <-> contextChangedOn (lab/signal-predicates.mjs)
//   focusRevealUndismissable (judge/rules.ts) <-> focusPanelUndismissable (lab/signal-predicates.mjs)
//   sameControlAnnounced + addSilentStateChanges (judge/rules.ts) <-> stateChangeIsSilent (lab/signal-predicates.mjs), #1496
//   addStaleRouteTitle (judge/rules.ts) <-> routeTitleIsStale (lab/signal-predicates.mjs), #1867
//
// #1498 DELETED ONE COPY of the third pair's identity step, CLAUDE.md's first-preference remedy: `sameControlAnnounced`
// is defined once, in `@a11ign/evidence`, and both sides import it. That is asserted by name at the end of this file.
// The pairs stay, because the STATE step after identity is still two implementations and still pinned equal here.
//
// Neither judge-side function is exported -- both are called only through `ruleFindings`, so this drives
// the SHIPPED entry point rather than reaching into module internals; same for `signalMatches` on the lab
// side. Same import shape as `media-signal-parity.test.ts`: `../../../judge/src/rules.js` by RELATIVE
// PATH, resolving to TypeScript SOURCE, never `@a11ign/judge/rules` (which resolves to `dist` and
// would defeat the point of a test that exists to catch drift between two files).
//
// DO NOT CHANGE EITHER IMPLEMENTATION HERE. This pins them equal; it does not unify them -- the package
// boundary is deliberate and ADR-backed (see this file's own citation above).
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import ts from "typescript";

import { signalMatches } from "./signal-predicates.mjs";
import { ruleFindings } from "../../../judge/src/rules.js";

/** The minimal capture shape `ruleFindings` needs to not throw on an unrelated rule's unconditional read. */
function captureWithInteraction(interaction: Record<string, unknown>): Record<string, unknown> {
  return { transcript: [], structure: {}, interaction, media: [] };
}

// --- Pair 1: contextChanged / contextChangedOn -- drives 3.2.1 On Focus / 3.2.2 On Input ---
//
// Both criteria call the SAME predicate on two different channels (`focusContext`, `typedFeedback`); the
// predicate does not know or care which. So parity is proven once, through one channel position
// (`focusContext` / 3.2.1) -- testing the other position would re-test the call site, not the predicate.

type Channel = { titleBefore?: string | null; titleAfter?: string | null; error?: string } | undefined;

function ruleContextChanged(channel: Channel): boolean {
  const findings = ruleFindings(captureWithInteraction({ focusContext: channel }) as never);
  return findings.some((f) => f.wcag?.startsWith("3.2.1"));
}

function signalContextChanged(channel: Channel): boolean {
  return signalMatches(captureWithInteraction({ focusContext: channel }), { type: "focus-context-change" });
}

const CONTEXT_CASES: { name: string; channel: Channel }[] = [
  { name: "titles differ -- a real context change", channel: { titleBefore: "Search", titleAfter: "No results" } },
  { name: "titles are identical -- no change", channel: { titleBefore: "Search", titleAfter: "Search" } },
  { name: "channel absent entirely -- the probe was never asked", channel: undefined },
  { name: "channel carries an error -- not a stable measurement", channel: { titleBefore: "A", titleAfter: "B", error: "timeout" } },
  { name: "titleBefore is the null sentinel -- nothing was focused/typed", channel: { titleBefore: null, titleAfter: "B" } },
  { name: "titleAfter is the null sentinel", channel: { titleBefore: "A", titleAfter: null } },
  { name: "both empty strings -- a real non-change, not an absence", channel: { titleBefore: "", titleAfter: "" } },
  { name: "empty to non-empty -- still a real change", channel: { titleBefore: "", titleAfter: "B" } },
];

test("contextChanged (rule) and contextChangedOn (signal) agree on every title-diff shape", () => {
  for (const { name, channel } of CONTEXT_CASES) {
    const rule = ruleContextChanged(channel);
    const signal = signalContextChanged(channel);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

// --- Pair 2: focusRevealUndismissable / focusPanelUndismissable -- drives 1.4.13 Content on Hover or Focus ---

type Reveal = { revealed?: boolean | null; focusHeld?: boolean; dismissed?: boolean | null } | undefined;

function ruleFocusUndismissable(reveal: Reveal): boolean {
  const findings = ruleFindings(captureWithInteraction({ focusReveal: reveal }) as never);
  return findings.some((f) => f.wcag?.startsWith("1.4.13"));
}

function signalFocusUndismissable(reveal: Reveal): boolean {
  return signalMatches(captureWithInteraction({ focusReveal: reveal }), { type: "focus-panel-undismissable" });
}

const REVEAL_CASES: { name: string; reveal: Reveal }[] = [
  { name: "revealed, focus held, not dismissed -- the failing case", reveal: { revealed: true, focusHeld: true, dismissed: false } },
  { name: "revealed and dismissed -- the remedy demonstrated", reveal: { revealed: true, focusHeld: true, dismissed: true } },
  { name: "revealed but focus moved away -- mechanism not demonstrated by this evidence", reveal: { revealed: true, focusHeld: false, dismissed: false } },
  { name: "content never revealed at all", reveal: { revealed: false, focusHeld: true, dismissed: false } },
  { name: "revealed is the null sentinel -- census could not answer", reveal: { revealed: null, focusHeld: true, dismissed: false } },
  { name: "dismissed is the null sentinel -- census could not answer", reveal: { revealed: true, focusHeld: true, dismissed: null } },
  { name: "focusReveal absent entirely -- the probe never ran", reveal: undefined },
];

test("focusRevealUndismissable (rule) and focusPanelUndismissable (signal) agree on every census shape", () => {
  for (const { name, reveal } of REVEAL_CASES) {
    const rule = ruleFocusUndismissable(reveal);
    const signal = signalFocusUndismissable(reveal);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

// --- Pair 3 (#1496): sameControlAnnounced + addSilentStateChanges / stateChangeIsSilent -- 4.1.2 state-change-silent ---
//
// The lab release gate at `3bf5b8a4` REFUSED at stage 8 because the lab copy lacked the rule's identity step (#812).
// On the GOOD page of all five `disclosure-focus-moves-to-collapsed-sibling` cases, focus moved to a different
// collapsed control: the rule added nothing, and the signal fired, which is CONTAMINATED. Both sides now ask identity
// before state. This pins that they AGREE on every shape in STATE_CASES. Since #1498 the identity step is ONE
// implementation (the last two tests), and since #1583 the state step agrees too: the two differences once named here,
// and six more shapes with the same two causes, are ordinary agree-cases below.

type StateChange = { control: string; after: string; afterSource: string };

const focusRead = (control: string, after: string): StateChange => ({ control, after, afterSource: "focus" });

function ruleStateChangeSilent(change: StateChange): boolean {
  const findings = ruleFindings(captureWithInteraction({ stateChanges: [change] }) as never);
  return findings.some((f) => f.wcag?.startsWith("4.1.2"));
}

function signalStateChangeSilent(change: StateChange, control: string): boolean {
  return signalMatches(captureWithInteraction({ stateChanges: [change] }), { type: "state-change-silent", control });
}

const STATE_CASES: { name: string; change: StateChange; control: string }[] = [
  { name: "the release gate's GOOD page (recorded, #915): focus moved to a DIFFERENT collapsed control",
    change: focusRead("Show delivery options, button, collapsed", "Show opening hours, button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "the SAME control, still collapsed after activation -- the failure",
    change: focusRead("Show delivery options, button, collapsed", "Show delivery options, button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "+also-fake-heading-unnamed-graphic's second good-page entry (recorded, #915): collapsed -> expanded",
    change: focusRead("Reference notes archive, button, collapsed", "Reference notes archive, button, focused, expanded"),
    control: "Reference notes archive" },
  { name: "the same control, expanded -> expanded",
    change: focusRead("Show delivery options, button, expanded", "Show delivery options, button, focused, expanded"),
    control: "Show delivery options" },
  { name: "unnamed on both sides -- an empty name is not an identity",
    change: focusRead("button, collapsed", "button, focused, collapsed"), control: "button" },
  { name: "named before, unnamed after -- identity cannot be established",
    change: focusRead("Show delivery options, button, collapsed", "button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "the same NAME under a different role ('button' -> 'menu button') -- identity is the name, not the role",
    change: focusRead("Platform, button, collapsed", "Platform, menu button, focused, collapsed"), control: "Platform" },
];

test("#1496: stateChangeIsSilent (signal) and addSilentStateChanges (rule) agree on every identity shape", () => {
  for (const { name, change, control } of STATE_CASES) {
    const rule = ruleStateChangeSilent(change);
    const signal = signalStateChangeSilent(change, control);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

/**
 * #1583: THE STATE STEP, ALIGNED. The signal used to call "silent" what the rule does not, for two causes: it had no
 * role gate (the rule's positive `ENTER_ACTIVATES`), and it counted any state word on either side (the rule counts only
 * collapsed/expanded, on both sides). #1496 named two shapes; the same two causes made six more. Each is the SAME control
 * re-read with focus on it, so identity holds and only the state step decides.
 */
const ALIGNED_BY_1583: { name: string; change: StateChange; control: string; silent: boolean }[] = [
  { name: "(a) a combo box that stays collapsed after Enter -- the role gate",
    change: focusRead("Passenger type, combo box, collapsed", "Passenger type, combo box, focused, collapsed"),
    control: "Passenger type", silent: false },
  { name: "(b) the same control with NO state word after activation -- a state on both sides",
    change: focusRead("Show delivery options, button, collapsed", "Show delivery options, button, focused"),
    control: "Show delivery options", silent: false },
  { name: "a button pressed -> pressed -- pressed is not an expandable state",
    change: focusRead("Bold, button, pressed", "Bold, button, focused, pressed"), control: "Bold", silent: false },
  { name: "a checkbox checked -> checked -- checked is not an expandable state",
    change: focusRead("Remember me, checkbox, checked", "Remember me, checkbox, focused, checked"),
    control: "Remember me", silent: false },
  { name: "a checkbox not checked -> not checked",
    change: focusRead("Remember me, checkbox, not checked", "Remember me, checkbox, focused, not checked"),
    control: "Remember me", silent: false },
  { name: "a menu button collapsed -> collapsed -- not in the rule's positive role list (a stated limit, see the PR)",
    change: focusRead("Account, menu button, collapsed", "Account, menu button, focused, collapsed"),
    control: "Account", silent: false },
  { name: "a link collapsed -> collapsed -- Enter on a link is not a toggle",
    change: focusRead("More, link, collapsed", "More, link, focused, collapsed"), control: "More", silent: false },
  { name: "a button open -> open -- open is not an expandable state",
    change: focusRead("Filters, button, open", "Filters, button, focused, open"), control: "Filters", silent: false },
  // THE CONTROLS: the aligned gates still let the failure through, and still refuse what never was one.
  { name: "CONTROL: a tab collapsed -> collapsed is SILENT -- a role the gate admits",
    change: focusRead("Details, tab, collapsed", "Details, tab, focused, collapsed"), control: "Details", silent: true },
  { name: "CONTROL: a toggle button pressed -> pressed is not",
    change: focusRead("Mute, toggle button, pressed", "Mute, toggle button, focused, pressed"), control: "Mute",
    silent: false },
  { name: "CONTROL: a button collapsed -> expanded changed state, so it is not",
    change: focusRead("Show delivery options, button, collapsed", "Show delivery options, button, focused, expanded"),
    control: "Show delivery options", silent: false },
  { name: "CONTROL: no state before, collapsed after is not",
    change: focusRead("Show delivery options, button", "Show delivery options, button, focused, collapsed"),
    control: "Show delivery options", silent: false },
];

test("#1583: signal and rule give the SAME answer on every state-step shape, and it is the expected one", () => {
  for (const { name, change, control, silent } of ALIGNED_BY_1583) {
    assert.equal(ruleStateChangeSilent(change), silent, `${name}: the RULE's answer moved`);
    assert.equal(signalStateChangeSilent(change, control), silent,
      `${name}: the signal says ${!silent}, the rule says ${silent} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

// --- Pair 4 (#1867): addStaleRouteTitle / routeTitleIsStale -- drives 2.4.2 Page Titled ---
//
// The heading-equality guard both sides used to trust alone: a held-steady SITE-CHROME heading read as
// "nothing navigated" even when the title differed and NVDA's own document-change confirmation
// (`route.navigated`, real since #1850) said otherwise. #1867 fixed `rules.ts`; the reviewer on PR #1871
// found `signal-predicates.mjs`'s independently-maintained twin still trusted the heading proxy alone on
// the exact same shape, so product-manager widened the Region to cover it too. This pins the two agree.

type RouteChange = {
  control?: string | null; titleBefore?: string | null; titleAfter?: string | null;
  headingBefore?: string | null; headingAfter?: string | null; navigated?: boolean; error?: string;
} | undefined;

function ruleStaleRouteTitle(route: RouteChange): boolean {
  const findings = ruleFindings(captureWithInteraction({ routeChange: route }) as never);
  return findings.some((f) => f.wcag?.startsWith("2.4.2"));
}

function signalStaleRouteTitle(route: RouteChange): boolean {
  return signalMatches(captureWithInteraction({ routeChange: route }), { type: "route-title-stale" });
}

const ROUTE_CASES: { name: string; route: RouteChange }[] = [
  { name: "heading changed, title stale -- the original failing shape",
    route: { control: "Next", headingBefore: "Welcome", headingAfter: "Account", titleBefore: "Home", titleAfter: "Home" } },
  { name: "heading changed, title also changed -- no failure",
    route: { control: "Next", headingBefore: "Welcome", headingAfter: "Account", titleBefore: "Home", titleAfter: "Account" } },
  { name: "#1867: heading held steady, navigation confirmed, title stale -- the missed finding",
    route: { control: "Continue", headingBefore: "Vehicle tax", headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Tax your vehicle", navigated: true } },
  { name: "heading held steady, navigation confirmed, title DID change -- not a failure",
    route: { control: "Continue", headingBefore: "Vehicle tax", headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Confirm details", navigated: true } },
  { name: "heading held steady, navigation NOT confirmed -- a same-page control, nothing to judge",
    route: { control: "Show details", headingBefore: "Vehicle tax", headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Tax your vehicle", navigated: false } },
  { name: "heading held steady, navigated unset (unprobed for it) -- same as false, nothing to judge",
    route: { control: "Show details", headingBefore: "Vehicle tax", headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Tax your vehicle" } },
  { name: "route absent entirely -- the probe never ran", route: undefined },
  { name: "route carries an error -- not a stable measurement",
    route: { control: "Next", headingBefore: "A", headingAfter: "B", titleBefore: "T", titleAfter: "T", error: "timeout" } },
  { name: "control is the null sentinel -- probe reached the end of the links",
    route: { control: null, headingBefore: "A", headingAfter: "B", titleBefore: "T", titleAfter: "T" } },
  // #1867 round 2 (reviewer's second NOT CONVINCED, PR #1871 at 91fd865e): both headings unread must not
  // read as "the heading changed" -- a reachable shape since `headingBefore`/`headingAfter` are
  // `string | null` and an empty string is a plain falsy read, not a sentinel unique to a fixture.
  // Positive control for the case below: the "#1867: heading held steady, navigation confirmed, title
  // stale" case just above is the identical shape with both headings actually read, and it still reaches
  // the stale-title finding -- proving the guard below is reachable rather than vacuously always-false.
  { name: "#1867 round 2: both headings are empty strings, navigation confirmed, title stale -- an unread "
      + "heading is not evidence a navigation happened",
    route: { control: "Continue", headingBefore: "", headingAfter: "", titleBefore: "Tax your vehicle",
      titleAfter: "Tax your vehicle", navigated: true } },
  { name: "#1867 round 2: headingBefore is the null sentinel, navigation NOT confirmed, title stale -- a "
      + "failed before-read must not be read as 'the heading changed'",
    route: { control: "Continue", headingBefore: null, headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Tax your vehicle", navigated: false } },
  { name: "#1867 round 2 POSITIVE CONTROL: same shape with a REAL heading change instead of a null read -- "
      + "a heading that actually changed is evidence enough on its own, no navigated needed",
    route: { control: "Continue", headingBefore: "Welcome", headingAfter: "Vehicle tax",
      titleBefore: "Tax your vehicle", titleAfter: "Tax your vehicle", navigated: false } },
  // #1867 round 3 (reviewer's third NOT CONVINCED, PR #1871 at 3f2ff8f9): neither a missing title read nor
  // page furniture is evidence the title held steady -- `routeTitleIsStale` had no equivalent to
  // `rules.ts`'s title-read guard or its furniture guard (`looksLikeFurnitureNotNavigation`) until this
  // round. Positive control for all three cases below: the reviewer's own reproduction shape with an
  // ordinary control and both titles actually read, which still reaches the stale-title finding.
  { name: "#1867 round 3 POSITIVE CONTROL: an ordinary control, both titles read and equal -- a real stale "
      + "title must still be asserted, this is a narrowing, not a mute",
    route: { control: "Next", headingBefore: "Welcome", headingAfter: "Latest",
      titleBefore: "Home", titleAfter: "Home", navigated: true } },
  { name: "#1867 round 3: control announces \"opens in a new tab\", title stale -- a new-tab link is not "
      + "evidence THIS document navigated (reviewer's reproduction, PR #1871 at 3f2ff8f9)",
    route: { control: "Cookie policy, opens in a new tab, link", headingBefore: "Welcome", headingAfter: "Latest",
      titleBefore: "Home", titleAfter: "Home", navigated: true } },
  { name: "#1867 round 3: a heading inside a dialog container, title stale -- a modal opening is not "
      + "evidence THIS document navigated",
    route: { control: "Manage cookies, link", headingBefore: "Welcome",
      headingAfter: "dialog, Manage your cookie preferences, heading, level 1",
      titleBefore: "Home", titleAfter: "Home", navigated: true } },
  { name: "#1867 round 3: both titles are the null sentinel, heading changed -- an unread title is not "
      + "evidence it held steady (reviewer's title-read reproduction, PR #1871 at 3f2ff8f9)",
    route: { control: "Next", headingBefore: "Welcome", headingAfter: "Latest",
      titleBefore: null, titleAfter: null, navigated: true } },
];

test("#1867: addStaleRouteTitle (rule) and routeTitleIsStale (signal) agree on every route-change shape", () => {
  for (const { name, route } of ROUTE_CASES) {
    const rule = ruleStaleRouteTitle(route);
    const signal = signalStaleRouteTitle(route);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

// --- #1583: the signal's COPIES of the rule's two gates are the rule's lists ---

/**
 * The string members of `const <name> = new Set([...])` in a source file, or null when no such declaration exists.
 * Parsed, not grepped: a list split across lines and a type annotation (`ReadonlySet<string>`) both have to read.
 */
function setLiteral(file: string, text: string, name: string): string[] | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  let found: string[] | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      && node.initializer && ts.isNewExpression(node.initializer) && node.initializer.arguments?.length === 1
      && ts.isArrayLiteralExpression(node.initializer.arguments[0])) {
      found = node.initializer.arguments[0].elements.filter(ts.isStringLiteral).map((element) => element.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const readRepo = (file: string) => readFileSync(new URL(file, new URL("../../../../", import.meta.url)), "utf8");

/** What one side has that the other does not, both ways, for a failure message that names the entry. */
function setDifference(rule: readonly string[], signal: readonly string[]): string {
  const onlyRule = rule.filter((entry) => !signal.includes(entry));
  const onlySignal = signal.filter((entry) => !rule.includes(entry));
  return `only in rules.ts: ${JSON.stringify(onlyRule)}; only in signal-predicates.mjs: ${JSON.stringify(onlySignal)}`;
}

test("#1583 CONTROL: the list reader finds a planted Set in either language, and sees an added entry", () => {
  assert.deepEqual(setLiteral("p.ts", 'const ENTER_ACTIVATES: ReadonlySet<string> = new Set([\n  "button", "tab",\n]);', "ENTER_ACTIVATES"),
    ["button", "tab"]);
  assert.deepEqual(setLiteral("p.mjs", 'const ENTER_ACTIVATES = new Set(["button", "tab", "menu button"]);', "ENTER_ACTIVATES"),
    ["button", "tab", "menu button"]);
  assert.equal(setLiteral("p.mjs", "const OTHER = new Set([]);", "ENTER_ACTIVATES"), null, "an absent declaration reads null");
});

test("#1583: the signal's ENTER_ACTIVATES and EXPANDABLE_STATES are EQUAL, as sets, to the rule's", () => {
  // The behaviour pins above cover twelve shapes; a role added to ONE copy -- `menu button`, say -- needs no new shape
  // to be a drift. This pins the lists themselves, read as source because the signal cannot import rules.ts.
  const rules = readRepo("packages/judge/src/rules.ts");
  const signal = readRepo("packages/lab/src/training/signal-predicates.mjs");
  for (const name of ["ENTER_ACTIVATES", "EXPANDABLE_STATES"]) {
    const ruleList = setLiteral("rules.ts", rules, name);
    const signalList = setLiteral("signal-predicates.mjs", signal, name);
    assert.ok(ruleList && ruleList.length > 0, `rules.ts no longer declares ${name} as a Set literal -- this pin reads nothing`);
    assert.ok(signalList && signalList.length > 0, `signal-predicates.mjs no longer declares ${name} as a Set literal`);
    assert.deepEqual([...signalList].sort(), [...ruleList].sort(),
      `${name} drifted between the rule and the signal's copy -- ${setDifference(ruleList, signalList)}`);
  }
});

// --- #1498: the identity step is ONE implementation, not two agreeing ---

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONSUMERS = ["packages/judge/src/rules.ts", "packages/lab/src/training/signal-predicates.mjs"];

/** Every local definition of `sameControlAnnounced` in a file (by line), and whether it imports it from @a11ign/evidence. */
function sameControlSources(file: string, text: string): { definitions: number[]; imported: boolean } {
  const kind = file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const definitions: number[] = [];
  let imported = false;
  const visit = (node: ts.Node) => {
    const declares = ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node);
    if (declares && node.name && ts.isIdentifier(node.name) && node.name.text === "sameControlAnnounced") {
      definitions.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    const fromEvidence = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "@a11ign/evidence";
    const bindings = fromEvidence ? node.importClause?.namedBindings : undefined;
    if (bindings && ts.isNamedImports(bindings)
      && bindings.elements.some((element) => (element.propertyName ?? element.name).text === "sameControlAnnounced")) {
      imported = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { definitions, imported };
}

test("#1498 CONTROL: a local copy of sameControlAnnounced is found by name, in either language", () => {
  const copied = 'import { parseAnnouncement } from "@a11ign/evidence";\nfunction sameControlAnnounced(control, after) {}\n';
  const found = sameControlSources("planted.mjs", copied);
  assert.equal(found.definitions.length, 1, "a function declaration in a .mjs consumer");
  assert.equal(found.imported, false);
  const shadowed = 'import { sameControlAnnounced as shared } from "@a11ign/evidence";\nconst sameControlAnnounced = shared;\n';
  assert.equal(sameControlSources("planted.ts", shadowed).definitions.length, 1, "a const beside the import, in .ts");
});

test("#1498: sameControlAnnounced is ONE implementation -- both consumers import it from @a11ign/evidence and define none", () => {
  for (const file of CONSUMERS) {
    const { definitions, imported } = sameControlSources(file, readFileSync(new URL(file, REPO_ROOT), "utf8"));
    assert.deepEqual(definitions, [], `${file} defines its own sameControlAnnounced at line ${definitions.join(", ")}: `
      + "a DUPLICATE of @a11ign/evidence's -- import it instead (#1498)");
    assert.equal(imported, true, `${file} no longer imports sameControlAnnounced from @a11ign/evidence`);
  }
  // THE POSITIVE CONTROL for the empty lists above: the same reader finds the one real definition.
  const home = "packages/evidence/src/announcement.ts";
  assert.equal(sameControlSources(home, readFileSync(new URL(home, REPO_ROOT), "utf8")).definitions.length, 1,
    `the reader finds the one definition in ${home}`);
});
