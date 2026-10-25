/**
 * WHAT A SET OF REPEATED CAPTURES OF ONE PAGE SAYS: which fields are stable, which vary, and whether the set can be trusted at all (moved here from `repeat-capture.mjs`, A11-263).
 *
 * `repeat-capture` and `gate:stability` ask one question of the same captures, and until the captures came from a fleet job the analysis was welded to the process that took them: it
 * printed with `console.log` and ended the process with `process.exit`, so the gate had to run it as a child and read its stdout. The captures come from the job's manifest now, so the
 * analysis is a pure function of them: it returns the report it would have printed, and the exit code it would have ended with.
 *
 * Deliberately compares CONTENT, not counts. A readiness gate once replaced the first line of every capture with the document title, and every count-based check stayed green.
 */
import { captureIsSelfConsistent } from "@a11ign/evidence/verify";
import { compareIdentity, documentIdentity } from "@a11ign/evidence/document-identity";
import { EVIDENCE_FIELDS, fieldKey, fieldValues } from "../capture/evidence-diff.ts";
import type { Loose } from "../capture/loose.ts";

/**
 * A field as a LIST, whatever it is. One helper rather than `?? []` at every field, because each of those is a branch and eighteen of them took `comparable` past the complexity limit --
 * for no reading benefit, since every line was doing the same thing.
 */
const list = (value: Loose): Loose[] => (Array.isArray(value) ? value : []);

/**
 * The fields worth comparing: everything a dataset signal can read -- DERIVED from `evidence-diff.ts`'s `EVIDENCE_FIELDS`/`fieldValues` rather than a second, hand-maintained list and a
 * second flatten.
 *
 * THE UNIFICATION, and why it replaced two independently-drifting copies: `gate:stability` and `evidence:check` ask the same question of the same captures -- is the evidence the SAME -- and
 * each kept its own answer to "what counts as evidence" and "how do I flatten an object field to compare it". `evidence-diff` gained a `NOT_EVIDENCE_KEYS` deny-list for `atMs` (a wall-clock key
 * inside `focusEvents.log` entries) and `gate:stability` failed on the identical `focusEvents` canaries two hours later, because its OWN `flatten()` never learned of the fix. That is the
 * fact-stated-twice shape at its most expensive: the two gates that decide whether evidence is trustworthy disagreeing about what evidence IS.
 *
 * `transcript` stays this file's own concern: `evidence-diff` compares it separately too (as a SET, with drift named rather than exact-order equality), so it was never part of the shared table.
 */
export function comparable(capture: Loose): Record<string, Loose[]> {
  const out: Record<string, Loose[]> = { transcript: list(capture.transcript) };
  for (const field of EVIDENCE_FIELDS) {
    // `fieldKey`: `[group, name]` keys as it always has, and every other path by its whole name -- a top-level `[name]` (#977) is not `undefined`, and eight `observed.<channel>.asked` (#985) do
    // not collide on `asked`.
    out[fieldKey(field)] = fieldValues(capture, field);
  }
  return out;
}

/**
 * WERE ALL N CAPTURES SERVED THE SAME DOCUMENT? -- #687.
 *
 * This gate's whole premise is "one page, captured repeatedly, compared by CONTENT", and until #687 nothing checked the premise. A canary served a different document -- a consent wall, a
 * sign-in redirect, an outage page -- reports EVERY field unstable, and the reader is sent to look for a nondeterministic probe. Measured on `https://calendly.com/` (#685): two captures eight
 * minutes apart on one worker were served `accounts.google.com`'s sign-in wall and `calendly.com/scheduling`, and every record said `url: "https://calendly.com/"`.
 *
 * Compared PAIRWISE AGAINST THE FIRST rather than by digest equality across the set: identity components are optional, so two captures can be UNCOMPARABLE rather than equal or different, and a
 * set of digests would silently read "unexamined" as "differs". Returns the pairs that DIFFER, never the ones nobody could compare.
 *
 * @returns one entry per capture served a different document, `at` being its 1-based place among the captures given
 */
export function servedDifferentDocuments(captures: Loose[]): { at: number; differing: Loose[] }[] {
  if (captures.length < 2) return [];
  const first = documentIdentity(captures[0]);
  const differed: { at: number; differing: Loose[] }[] = [];
  for (let i = 1; i < captures.length; i += 1) {
    const result = compareIdentity(first, documentIdentity(captures[i]));
    if (result.verdict === "DIFFERENT_DOCUMENT") differed.push({ at: i + 1, differing: result.differing });
  }
  return differed;
}

/** What a report is written into: the lines of stdout and the lines of stderr, in the order they were printed. */
export type ReportLines = { out: string[]; err: string[] };

/**
 * Field by field, is the evidence identical across runs? Returns how many varied, and writes a line for each field.
 *
 * It is a real concern rather than a slice taken to satisfy the complexity gate: this is the comparison the whole tool exists to make. Everything around it is deciding WHICH captures are
 * eligible to be compared.
 */
export function compareFields(usable: Record<string, Loose[]>[], lines: ReportLines): number {
  let unstable = 0;
  for (const field of Object.keys(usable[0] ?? {})) {
    const distinct = new Set(usable.map((r) => JSON.stringify(r[field])));
    const counts = usable.map((r) => (r[field] ?? []).length).join(",");
    if (distinct.size === 1) {
      lines.out.push(`  STABLE    ${field.padEnd(13)} ${(usable[0]?.[field] ?? []).length} item(s), identical every time`);
      continue;
    }
    unstable += 1;
    lines.out.push(`  VARIES    ${field.padEnd(13)} counts ${counts} across runs`);
    // Show the variants, because "it varies" is not actionable and the difference usually names the cause -- a missing header, a truncated walk, a lagging announcement.
    for (const shape of distinct) {
      const parsed = JSON.parse(shape) as Loose[];
      lines.out.push(`      ${parsed.length}: ${JSON.stringify(parsed).slice(0, 110)}`);
    }
  }
  return unstable;
}

/** Which captures were served another document, and what that does to everything printed after it. */
function servedDifferentlyLines(servedDifferently: { at: number; differing: Loose[] }[], out: string[]): void {
  // PRINTED BEFORE the field list, because it changes what the field list MEANS. Every field varying across two different documents is the expected result, not a finding about a probe.
  for (const { at, differing } of servedDifferently) {
    out.push(`  DIFFERENT DOCUMENT  capture ${at} was not served the page capture 1 was: `
      + differing.map((d) => `${d.component} ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`).join("; "));
  }
  if (servedDifferently.length) {
    out.push("  ^ the instability above is a fact about the PAGE, not about this pipeline. Settle which document you meant to capture before reading any field as unstable.");
  }
}

/** The transport lines the report always printed. The fleet job service sends the captures now and its records carry no count of either, so they say so rather than a zero. */
export const TRANSPORT_NOT_REPORTED = [
  "sockets recovered: not reported (the fleet job service sends the captures, and its records carry no transport count)",
  "polls survived: not reported (the fleet job service sends the captures, and its records carry no transport count)",
];

export type RepeatReport = {
  /** The report, as it would have been printed. */
  stdout: string;
  stderr: string;
  /** 0 when every compared field is stable and nothing was empty, errored, rejected or served another document; else 1. */
  exit: number;
  /** How many captures were usable (read the page and traversed it). */
  usable: number;
  /** True when fewer than two were usable: nothing was compared, and the run says so rather than passing. */
  tooFew: boolean;
};

/**
 * The verdict over a set of repeated captures.
 *
 * @param raw the captures that came back, in order
 * @param errors one line for each capture that did not, as `<n>: <why>`
 * @param times how many captures were asked for
 * @param reuse whether the screen reader was reused between them (the report says which)
 * @param outDir where the raw captures were kept
 */
export function analyseRepeats(
  { raw, errors, times, reuse, outDir }: { raw: Loose[]; errors: string[]; times: number; reuse: boolean; outDir: string },
): RepeatReport {
  const runs = raw.map(comparable);
  const lines: ReportLines = { out: [], err: [] };
  // A capture with no phrases heard nothing at all -- the known ForegroundLockTimeout/foreground flake. It is a failure, and it is a DIFFERENT failure from a probe that varies. Comparing it
  // against real captures would report every field as unstable and bury the question being asked. So it is excluded from the comparison and named loudly, never quietly dropped.
  const empty = runs.filter((r) => (r.transcript ?? []).length === 0);
  // Captures the PRODUCTION pipeline would reject must not be compared here. `captureIsSelfConsistent` catches a capture whose read-through announced a heading while the heading sweep found
  // none -- the page was not traversed. The dataset runner already rejects and retries those, so comparing them here reports instability that a real run would never have accepted. Indexed
  // against `raw`, because the gate reads `capture.structure.headings` and `runs` holds the FLATTENED comparison shape where that path does not exist.
  const traversed = runs.map((r, i) => (r.transcript ?? []).length > 0 && captureIsSelfConsistent(raw[i] as never));
  const inconsistent = runs.filter((r, i) => (r.transcript ?? []).length > 0 && !traversed[i]);
  const usable = runs.filter((_, i) => traversed[i]);
  // THE PREMISE, CHECKED. Indexed against `raw` for the same reason `traversed` is: identity reads the capture's diagnostic marks, which the flattened comparison shape does not carry.
  const servedDifferently = servedDifferentDocuments(raw.filter((_, i) => traversed[i]));

  if (usable.length < 2) {
    lines.err.push(`\nOnly ${usable.length} usable capture(s); nothing to compare.`);
    if (empty.length) lines.err.push(`  ${empty.length} returned 0 phrases (the foreground flake)`);
    for (const e of errors) lines.err.push(`  ${e}`);
    return { stdout: "", stderr: `${lines.err.join("\n")}\n`, exit: 1, usable: usable.length, tooFew: true };
  }

  lines.out.push(`\n${usable.length}/${times} usable`
    + (empty.length ? `, ${empty.length} empty` : "")
    + (inconsistent.length ? `, ${inconsistent.length} rejected (not traversed)` : "")
    + (errors.length ? `, ${errors.length} failed` : "")
    + ` (${reuse ? "reused" : "fresh"} NVDA each time)\n`);

  const unstable = compareFields(usable, lines);

  servedDifferentlyLines(servedDifferently, lines.out);
  for (const e of errors) lines.out.push(`  FAILED    ${e}`);
  if (empty.length) {
    lines.out.push(`  EMPTY     ${empty.length} capture(s) heard nothing at all — the foreground flake, excluded from the comparison above because it would mark every field unstable`);
  }
  // ALWAYS PRINTED, including the zero. A line that appears only when something happened cannot tell "nothing happened" from "nobody looked" -- the distinction every diagnostic mark in this
  // repo exists to preserve. These two cannot be counted any more (the service owns the transport), so they say NOT REPORTED, which `gate:stability` already reads as "the metric is missing,
  // which is not the same as zero".
  lines.out.push(...TRANSPORT_NOT_REPORTED);
  lines.out.push(`\nraw captures kept in ${outDir} (diagnostics included)`);
  lines.out.push(unstable === 0 ? "All compared fields are stable." : `${unstable} field(s) vary on an unchanged page.`);
  // A varying field is a failure: evidence that depends on timing rather than on the page. An empty capture or an error is a failure too, just a different one -- so every one of them fails the
  // run. They are DIFFERENT failures, which is why each is printed above under its own name rather than summed. A capture served another document fails the run like the others: this gate must
  // not report a canary STABLE, or usefully unstable, over a page it was never given.
  const failures = [unstable, errors.length, empty.length, inconsistent.length, servedDifferently.length];
  return { stdout: `${lines.out.join("\n")}\n`, stderr: "", exit: failures.some((n) => n > 0) ? 1 : 0, usable: usable.length, tooFew: false };
}
