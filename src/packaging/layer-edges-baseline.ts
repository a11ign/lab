/**
 * THE LAB'S OWN BASELINE OF THE REACHES IT MAKES INTO THE CORE, and the verdict on it (a11ign/a11ign#3904; moved here by a11ign/a11ign#5431).
 *
 * `judgeEdges`, `describeVerdict`, `countByDisposition`, `BASELINE_PATH` and the disposition vocabulary were exports of the core's
 * `packages/guards/src/layer-edges.ts`, which the core deleted at cut 9 (a11ign/a11ign#5087, `23a179418`) together with its own baseline:
 * the core now refuses every reach it finds (ADR 0045 Decision 1 rule 5) and keeps `findEdges` and `describeRefusals`. This repository
 * keeps a baseline of its own (`baselines/layer-edges.baseline.json`, a11ign/a11ign#3505), and `layer-edges.test.ts` judges it, so the
 * judge lives HERE, copied from the core at `23a179418~1` and changed in nothing but its imports. Without it that test did not typecheck
 * at the first core commit past cut 9, and `checks (own)` ran `tsc` over it.
 *
 * WHETHER THIS REPOSITORY SHOULD KEEP A BASELINE AT ALL is ruled KEEP, as a ledger that only shrinks: ADR 0045, section
 * "The lab's own baseline of its reaches" (a11ign/a11ign#5436). The baseline is deleted when it is empty, and that section then ends.
 */
import { EDGE_KINDS, LAYER_PACKAGES, type Edge } from "../../../guards/src/layer-edges.ts";

/** Where the lab's baseline is, from the core's root when the lab is laid under it. */
export const BASELINE_PATH = "packages/lab/baselines/layer-edges.baseline.json";

/**
 * What an edge in the baseline is to become, and the only words the baseline may use (#3501): `cut` the reach goes; `by-name` it becomes a
 * published-package import; `checkout-path` it is resolved through a declared checkout path; `moves-with:<layer>` a test that
 * goes with the code it reads; `owned-by:#<row>` a row that exists decides it. `cut` is a promise and not an exemption: when the reach is cut the
 * edge vanishes and the entry becomes STALE, which is how the cut is noticed.
 */
const DISPOSITION = /^(?:cut|by-name|checkout-path|moves-with:([\w-]+)|owned-by:#\d+)$/;

export type BaselineEntry = Edge & { disposition: string, reason: string };

const keyOf = (e: Edge | undefined) => `${e?.direction} ${e?.kind} ${e?.from} -> ${e?.to}`;

/** Where a `const`-carried path was written and where it is read, as the words a person needs to find both. */
const carriedBy = ({ via }: Edge) => (via === undefined ? "" : `, through a const declared at line ${via.declaredLine} and read at line ${via.readLine}`);

/**
 * The verdict on a set of edges against a baseline: what is new, what no longer exists, and what is malformed.
 * A stale entry is refused for the reason an allowlist the subject can join is: a list that outlives what it
 * lists reads as a boundary that is still there.
 */
export function judgeEdges(edges: Edge[], baseline: unknown): { unlisted: Edge[]; stale: BaselineEntry[]; malformed: string[]; } {
  if (!Array.isArray(baseline)) return { unlisted: edges, stale: [], malformed: ["the baseline is not a JSON array"] };
  const malformed = baseline.flatMap((entry, i) => malformedReasons(entry).map((why) => `entry ${i} (${entry?.from ?? "?"}): ${why}`));
  const listed = new Set(baseline.map((e) => keyOf(e)));
  const present = new Set(edges.map(keyOf));
  return {
    unlisted: edges.filter((e) => !listed.has(keyOf(e))),
    stale: baseline.filter((e) => !present.has(keyOf(e))),
    malformed,
  };
}

/** What is wrong with one baseline entry, as sentences; empty when it is well-formed. */
function malformedReasons(entry: Record<string, string>): string[] {
  const missing = ["from", "to", "kind", "direction", "disposition", "reason"]
    .filter((f) => typeof entry?.[f] !== "string" || entry[f].trim() === "");
  if (missing.length > 0) return [`missing ${missing.join(", ")}`];
  const reasons = [];
  if (!EDGE_KINDS.includes(entry.kind)) reasons.push(`kind "${entry.kind}" is not one of ${EDGE_KINDS.join(", ")}`);
  if (entry.direction !== "in" && entry.direction !== "out") reasons.push(`direction "${entry.direction}" is not "in" or "out"`);
  const dispositionMatch = DISPOSITION.exec(entry.disposition);
  if (dispositionMatch === null) reasons.push(`disposition "${entry.disposition}" is not cut, by-name, checkout-path, moves-with:<layer> or owned-by:#<row>`);
  else if (dispositionMatch[1] !== undefined && !LAYER_PACKAGES.includes(dispositionMatch[1])) {
    reasons.push(`disposition "${entry.disposition}" moves with "${dispositionMatch[1]}", which is not a declared layer (${LAYER_PACKAGES.join(", ")})`);
  }
  return reasons;
}

/** The refusal, as the lines a person reads: what to do about each new edge and each stale entry. */
export function describeVerdict({ unlisted, stale, malformed }: { unlisted: Edge[]; stale: BaselineEntry[]; malformed: string[]; }): string[] {
  return [
    ...unlisted.map((e) => `NEW EDGE ${e.direction}: ${e.from} -> ${e.to} (${e.kind}${carriedBy(e)}). Cut it, or add it to ${BASELINE_PATH} with a disposition and a reason.`),
    ...stale.map((e) => `STALE ENTRY: ${e.from} -> ${e.to} (${e.kind}, ${e.direction}) no longer exists. Remove it from ${BASELINE_PATH}.`),
    ...malformed.map((m) => `MALFORMED: ${m}`),
  ];
}

/** Counts by disposition, for the closing comment on the row that cuts edges: how many the move still has to cut. */
export function countByDisposition(baseline: BaselineEntry[]) {
  const counts: Record<string, number> = {};
  for (const e of baseline) {
    const key = `${e.direction}:${e.disposition.replace(/:#\d+$/, "")}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
