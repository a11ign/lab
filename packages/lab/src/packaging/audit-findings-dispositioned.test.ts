/**
 * `docs/architecture-audit.md` is FROZEN (see its own header, and `architecture-audit-is-frozen.test.ts`):
 * corrections live in `docs/backlog.md`, never as an edit to the audit itself. But `backlog.md`'s own
 * governing rule is "if it is open, it is on this page" — and its own "OPEN — ~38 architecture-audit
 * findings" section admits that roughly fifty of the audit's findings never reached it at all, discovered
 * only because two peer sessions independently tripped over stale rows the same night.
 *
 * §9 ("Duplication with no owner"), §10.1 ("eleven architectural decisions with no ADR") and §7.2 ("Gates
 * that exist and run nowhere automated") are the sections most likely to still read as open to a future
 * reader, because none of them use the audit's own "CLOSED"/"DECIDED" vocabulary consistently — several
 * rows in each are bare descriptions with no verdict at all. This does not ask "are these findings still
 * true" (that is what froze the document in the first place — a snapshot cannot answer that faster than the
 * repo changes). It asks the narrower, MECHANICAL question: can a reader tell a dispositioned finding from
 * an orphaned one, today, without re-deriving it?
 *
 * §7.2 ADDED 2026-09-06 after a narrower, single-channel grep on it reported a row as open that a test had
 * already closed (`git-hooks-installed.test.ts` closes the "no `prepare`/`postinstall`" row, citing this
 * exact section by name) — the same shape §9's "vocabularies" row was found in. That is the THIRD
 * disposition channel this file's dispositions recognise (`"test"`, below), alongside the audit's own text
 * and `docs/backlog.md`: a test that cites the finding and would fail if it recurred.
 *
 * THE FINDINGS ARE DISCOVERED FROM THE DOCUMENT, never hand-listed — a hand-written list cannot see a row
 * added or removed since it was written, which is exactly the shape that let ~38 findings go untracked in
 * the first place. `findingNames` walks every markdown table row inside each section and takes its first
 * cell as the finding's own name; `PINNED_COUNTS` below is the vacuity guard — if the discovery regex ever
 * breaks (a table reformatted, a heading renamed), both counts silently go to zero and every disposition
 * test after it would pass having examined nothing, which is this repo's own most-repeated defect turned
 * on its own tracker.
 *
 * THE DISPOSITION LOOKUP IS HAND-MAINTAINED, and deliberately so — "present in docs/backlog.md" cannot be
 * derived automatically from the audit's own short fact-name, because backlog.md paraphrases rather than
 * quoting. But every entry's claim is CHECKED LIVE against the current files below, never trusted on the
 * strength of having been true once: a `closed-in-place` entry must find its own disposition marker in the
 * audit's current text, a `backlog` entry must find its stated substring in `docs/backlog.md`'s current
 * text, and an `adr` entry must find the stated ADR file on disk. So a reverted fix or an edited-away
 * backlog row fails this test just as loudly as a brand new, never-classified finding does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const AUDIT = readFileSync(`${REPO}docs/architecture-audit.md`, "utf8");
const BACKLOG = readFileSync(`${REPO}docs/backlog.md`, "utf8");

/**
 * Collapsed to single spaces before searching, because this file's prose is hard-wrapped at ~100 columns —
 * "the gate exit-code contract" is a real, present phrase that happens to carry a literal newline between
 * "gate" and "exit-code" in the source. A raw `.includes()` would report that as MISSING and send a reader
 * to "fix" a disposition that was never broken.
 */
const collapsed = (text: string): string => text.replace(/\s+/g, " ");
const BACKLOG_COLLAPSED = collapsed(BACKLOG);

/** The raw text strictly between two literal markers -- refuses rather than silently returning "" if either is gone. */
function between(doc: string, startMarker: string, endMarker: string): string {
  const start = doc.indexOf(startMarker);
  assert.ok(start !== -1, `"${startMarker}" not found in architecture-audit.md -- has this section been `
    + "renamed, moved, or removed? If removed deliberately, delete this test as part of that change.");
  const from = start + startMarker.length;
  const end = doc.indexOf(endMarker, from);
  assert.ok(end !== -1, `"${endMarker}" not found after "${startMarker}" -- the section boundary this test `
    + "relies on has moved");
  return doc.slice(from, end);
}

interface Finding { name: string; raw: string }

/**
 * Every markdown table row's FIRST CELL within a section, in document order, paired with the row's own
 * full text (needed to check for an in-place disposition marker). Skips header and separator rows.
 */
function findingRows(sectionText: string): Finding[] {
  const rows: Finding[] = [];
  for (const line of sectionText.split("\n")) {
    if (!line.startsWith("|") || !line.trimEnd().endsWith("|")) continue;
    const cellMatch = /^\|\s*([^|]+?)\s*\|/.exec(line);
    if (!cellMatch) continue;
    const name = cellMatch[1].trim();
    if (!name || /^-+$/.test(name) || name === "fact" || name === "decision" || name === "gate") continue; // header/separator
    rows.push({ name, raw: line });
  }
  return rows;
}

const SECTION_9 = between(AUDIT, "## 9. Duplication with no owner", "\n## 10. The documentation architecture");
const SECTION_10_1 = between(
  AUDIT,
  "### 10.1 CLAUDE.md carries the architecture, and the ADRs do not",
  "\n### 10.2 Trackers and records disagree about what is open",
);
const SECTION_7_2 = between(
  AUDIT,
  "### 7.2 Gates that exist and run nowhere automated — verified",
  "\n### 7.3 Release mechanics — corrected by experiment on 2026-09-05",
);

const FINDINGS_9 = findingRows(SECTION_9);
const FINDINGS_10_1 = findingRows(SECTION_10_1);
const FINDINGS_7_2 = findingRows(SECTION_7_2);

test("VACUITY GUARD -- §9, §10.1 and §7.2 still contain the number of findings this test was written against", () => {
  assert.equal(FINDINGS_9.length, 12,
    `§9 discovery found ${FINDINGS_9.length} row(s), expected 12 -- either a row was added/removed (extend `
    + "DISPOSITIONS below to match) or the discovery regex broke (0 would mean every later test in this "
    + "file passes having examined nothing)");
  assert.equal(FINDINGS_10_1.length, 11,
    `§10.1 discovery found ${FINDINGS_10_1.length} row(s), expected 11 -- same two possibilities as above`);
  assert.equal(FINDINGS_7_2.length, 6,
    `§7.2 discovery found ${FINDINGS_7_2.length} row(s), expected 6 -- same two possibilities as above`);
});

type Disposition =
  | { status: "closed-in-place" }
  | { status: "backlog"; find: string }
  | { status: "adr"; file: string }
  | { status: "test"; file: string; cites: string }
  | { status: "exempt"; reason: string };

/**
 * One entry per finding this test knows about. An UNCLASSIFIED finding fails the coverage test below by
 * name, which is the enforcement mechanism: add a row here, with real evidence, before it can pass.
 */
const DISPOSITIONS: Record<string, Disposition> = {
  // ---------------------------------------------------------------------------------------------- §9 ----
  "where `runs/` and its artefacts live": { status: "closed-in-place" },
  "how to read a capture": {
    status: "backlog",
    find: "Four copies of `readCapture` with differing error semantics",
  },
  "the gate exit-code contract": { status: "backlog", find: "the gate exit-code contract" },
  "argv parsing": { status: "backlog", find: "argv parsing" },
  "environment configuration": { status: "closed-in-place" },
  "the worker port": {
    status: "backlog",
    find: "One worker port declared three times in three languages",
  },
  "the HTTP client": { status: "backlog", find: "raw `fetch` surviving at four call sites" },
  "wake-on-LAN": {
    status: "exempt",
    reason: "the audit's own row already states the verdict: \"two by design (ADR 0012); the packet format "
      + "is fixed by spec\" -- an accepted split, not an unclassified defect",
  },
  provisioning: { status: "closed-in-place" },
  "`provisionRevision`, a capture cache key": {
    status: "backlog",
    find: "provisionRevision` cannot see 5 of 6 `a11y.worker` modules",
  },
  "Windows trimming": {
    status: "backlog",
    find: "Windows-trimming duplicated across three files, no consolidation",
  },
  vocabularies: {
    status: "exempt",
    reason: "closed and enforced by packages/judge/src/vocabulary-parity.test.ts, which cites this exact "
      + "audit row (\"architecture audit §9\") in its own header and either pins equal or deliberately "
      + "excludes all three vocabulary pairs this row names",
  },

  // ------------------------------------------------------------------------------------------- §10.1 ----
  "`.mjs` worker vs `.ts` control plane": { status: "adr", file: "0031-the-worker-ships-plain-mjs-with-no-build-step.md" },
  "the Python scorer boundary, venv, `A11Y_PYTHON`": {
    status: "adr",
    file: "0032-the-scorer-runs-as-a-subprocess-in-a-python-venv.md",
  },
  "the capture cache key's composition": {
    status: "adr",
    file: "0025-the-capture-cache-key-describes-evidence-not-code.md",
  },
  "the HTTP capture protocol: client-minted `captureId`, 404 vs 202, bounded store": {
    status: "adr",
    file: "0026-async-capture-with-a-client-minted-id.md",
  },
  "deprecation of local UTM VMs; bare metal is the capture path": {
    status: "adr",
    file: "0027-bare-metal-fleet-replaces-local-vm-capture.md",
  },
  "guidepup exact pin as evidence": {
    status: "adr",
    file: "0033-guidepup-exact-pin-is-evidence-not-dependency-hygiene.md",
  },
  "the speech channel as a TLS socket; `socket.destroy(err)`": {
    status: "adr",
    file: "0034-the-speech-channel-is-a-socket-forced-to-fail-loud.md",
  },
  "recovery keyed on fault codes": { status: "adr", file: "0028-recovery-keyed-on-fault-codes.md" },
  "browser preset as evidence; Edge preset byte-identical": {
    status: "adr",
    file: "0035-the-browser-preset-is-evidence-not-configuration.md",
  },
  "`ready` vs `ok` readiness semantics": { status: "adr", file: "0029-two-tier-readiness-ready-vs-ok.md" },
  "the fleet must run this checkout before capture": {
    status: "adr",
    file: "0030-fleet-code-parity-is-a-precondition-not-a-cache-key.md",
  },

  // -------------------------------------------------------------------------------------------- §7.2 ----
  "pre-commit and pre-push hooks": {
    status: "test",
    file: "packages/lab/src/packaging/git-hooks-installed.test.ts",
    cites: "gates that exist and run nowhere automated",
  },
  "the 30 pytest files": { status: "backlog", find: "§7.2 no Python in CI" },
  "`scorer:verify`, `release:provenance`, `scorer:migration`, `gate:isolation`": {
    status: "backlog",
    find: "Two dispatch-only gates also moved into `lint.yml`",
  },
  "`capture:check`": {
    status: "backlog",
    find: "no lab job runs `capture:check`'s equivalent against the real fleet",
  },
  "any Ansible check": { status: "backlog", find: "§7.2 no Ansible check anywhere" },
  "the published `dist/cli.js` bin": {
    status: "backlog",
    find: "the published `dist/cli.js` bin is executed by nothing",
  },
};

const ALL_FINDINGS = [...FINDINGS_9, ...FINDINGS_10_1, ...FINDINGS_7_2];

test("every discovered §9/§10.1 finding has an entry in DISPOSITIONS", () => {
  const unclassified = ALL_FINDINGS.filter((f) => !(f.name in DISPOSITIONS)).map((f) => f.name);
  assert.deepEqual(unclassified, [],
    "the finding(s) above have no entry in this file's DISPOSITIONS table -- each is either a NEW finding "
    + "this audit gained since this test was written, or an existing one that was reworded. Classify it: "
    + "mark it closed-in-place in architecture-audit.md's own text, point at (or add) a row in "
    + "docs/backlog.md, cite an ADR, or record it exempt with a reason -- then add it here with that "
    + "evidence.");
});

/** Words this document already uses for an in-place verdict -- see the frozen header's own vocabulary. */
const IN_PLACE_MARKER = /\b(CLOSED|DECIDED|MEASURED|CORRECTED|REFUTED)\b/;

for (const finding of ALL_FINDINGS) {
  const disposition = DISPOSITIONS[finding.name];
  if (!disposition) continue; // reported by the coverage test above; do not also fail here with no detail

  test(`"${finding.name}" -- ${disposition.status}`, () => {
    if (disposition.status === "closed-in-place") {
      assert.match(finding.raw, IN_PLACE_MARKER,
        `"${finding.name}" is classified closed-in-place, but its current row in architecture-audit.md no `
        + `longer carries one of ${IN_PLACE_MARKER} -- either the row was edited (the audit is meant to be `
        + "FROZEN; check nobody un-froze it) or this classification is stale and the finding needs a real "
        + "disposition instead");
    } else if (disposition.status === "backlog") {
      assert.ok(BACKLOG_COLLAPSED.includes(collapsed(disposition.find)),
        `"${finding.name}" is classified as tracked in docs/backlog.md via the substring "${disposition.find}"`
        + ", which is no longer present there (checked whitespace-insensitive) -- the backlog row may have "
        + "been reworded, removed, or this was never verified against real text");
    } else if (disposition.status === "adr") {
      const path = `${REPO}docs/adr/${disposition.file}`;
      assert.ok(existsSync(path),
        `"${finding.name}" is classified as closed by ${disposition.file}, which does not exist under `
        + "docs/adr/ -- the ADR may have been renamed or renumbered");
    } else if (disposition.status === "test") {
      const path = `${REPO}${disposition.file}`;
      assert.ok(existsSync(path),
        `"${finding.name}" is classified as closed by ${disposition.file}, which no longer exists -- the `
        + "test may have been renamed, moved, or deleted");
      // Strip block-comment `*` decoration before collapsing whitespace, or a wrapped citation like
      // "gates that exist\n * and run nowhere automated" collapses to "...exist * and..." with the
      // asterisk still splitting it, and a real citation reads as absent.
      const contents = collapsed(readFileSync(path, "utf8").replace(/^\s*\*\s?/gm, " "));
      assert.ok(contents.toLowerCase().includes(collapsed(disposition.cites).toLowerCase()),
        `${disposition.file} no longer cites "${disposition.cites}" (checked whitespace-insensitive, since `
        + "this repo hard-wraps prose) -- it may have been rewritten to close a different finding, in which "
        + `case "${finding.name}" needs a real disposition again`);
    } else {
      assert.ok(disposition.reason && disposition.reason.length > 20,
        `"${finding.name}" is classified exempt with no real reason recorded -- state why it needs neither `
        + "a backlog row nor an in-place closure, or reclassify it");
    }
  });
}
