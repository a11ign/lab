/**
 * Read the ONE declaration of who decides what — `packages/lab/rule-ownership.json`.
 *
 * The file itself carries the argument for why it exists; this module is only the reader, and it is a
 * module rather than a few lines inside `score-rules.ts` so the validation can be unit-tested. A script
 * that reads the corpus and calls `process.exit` on its own top level cannot be imported by a test.
 *
 * Every failure here THROWS. The temptation is to fall back to an empty map so a gate still runs, and
 * this repo has already paid for that shape twice: `stamp-provision-revision.ps1` filtered its missing
 * inputs away and produced a stamp describing nothing, and a `ruleOwned` passed as `[]` made a
 * documented guard inert for the whole life of the corpus. A declaration that cannot be read is not an
 * empty declaration.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `rules` — every record is decided by a deterministic rule; the scorer's head is suppressed.
 * `overlap` — the rules decide a subset and the model owns the rest, so neither layer may be silenced.
 * `unavailable` — NEITHER layer can decide it, because the evidence cannot express the failure. Those
 *   records are excluded from the model entirely, so the gate asserts they are ABSENT from the export.
 */
export type DecidedBy = "rules" | "overlap" | "unavailable";

export interface Ownership {
  /**
   * `rules` — the rules decide every record, exactly, and the judge suppresses the model for it.
   * `overlap` — the rules decide a deliberate SUBSET and the model owns the rest, so neither layer
   * may be silenced. The distinction is not cosmetic: suppressing the model on an `overlap` subtype
   * would hand the majority of its records to nobody.
   */
  decidedBy: DecidedBy;
  /**
   * The criterion the RULE reports it under, which is not always the criterion the subtype is named
   * for. An unnamed form field is `3.3.2:unnamed-form-field` in the corpus and a 4.1.2 finding from
   * the rules; both readings are correct, and the gate cannot check the rule fired without the map.
   */
  reportsAs: string;
  /**
   * `false` — this subtype gets no trained head at all, whatever its `decidedBy` or the corpus says.
   *
   * Named for what is true of every entry that sets it, not for either one's own situation: the rules
   * decide the subtype and the trainer must not fit a head for it. Two different reasons currently use
   * this — `1.4.2:autoplay-uncontrollable` has no corpus case yet (a head with zero positives is not a
   * head), and `2.4.7:focus-removed-on-receipt` has nine, all sharing every feature with `2.1.1`'s own
   * positives (a free veto in the making, ADR 0015's own shape) — which is exactly why the field means
   * "no head", not "no corpus case": `corpusCase: false` would be false of the second entry.
   *
   * ABSENT means a head IS fitted, same as every other field here — this is never written `true`.
   * Removes the entry from `train-screenreader-model.py`'s per-criterion subtype lists (so no head is
   * fitted, whatever the corpus contains) and from the "must be present" half of the ownership gate (so
   * a subtype with no corpus case yet does not crash the trainer for being declared and unfulfilled).
   * `why` is REQUIRED alongside it — see that field.
   */
  modelHead?: false;
  /**
   * REQUIRED when `modelHead` is `false`; meaningless otherwise. Distinct from `note`: `note` explains
   * the ownership decision in general, `why` explains SPECIFICALLY why no head may exist, because the
   * two entries that need this field need opposite explanations and a reader must not have to guess
   * which applies from `note`'s prose.
   */
  why?: string;
  /** Free text or a list of lines. Carried so the file can explain itself where JSON has no comments. */
  note?: string | string[];
}

const DECLARATION = fileURLToPath(new URL("../../rule-ownership.json", import.meta.url));

const DECIDED_BY = new Set<DecidedBy>(["rules", "overlap", "unavailable"]);

const CRITERION = /^\d+\.\d+\.\d+$/;
const SUBTYPE_KEY = /^\d+\.\d+\.\d+:[a-z0-9-]+$/;

/**
 * The `modelHead`/`why` half of one entry's validation, split out purely to keep `readRuleOwnership`'s
 * complexity under gate — it is not a second concept, it is the same one written out.
 */
function assertModelHeadIsValid(key: string, value: Ownership): void {
  if (!("modelHead" in value)) return;
  if (value.modelHead !== false) {
    throw new Error(`rule ownership: "${key}".modelHead=${JSON.stringify(value.modelHead)}; the only `
      + "value this ever takes is `false` — absence means a head IS fitted, the same convention as "
      + "every other field here.");
  }
  if (typeof value.why !== "string" || !value.why.trim()) {
    throw new Error(`rule ownership: "${key}" sets modelHead: false with no "why". Two entries can `
      + "set this field for opposite reasons — no corpus case yet, or a head that would be a free "
      + "veto — and a reader must not have to guess which; state it.");
  }
}

/** Parse and validate the declaration. Throws — see the module comment. */
export function readRuleOwnership(path: string = DECLARATION): Map<string, Ownership> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`rule ownership: cannot read ${path}. This declares which subtypes the `
      + "deterministic rules decide; without it neither the rule gate nor the trainer knows the "
      + "boundary, and guessing one is how the two sides drifted apart in the first place.", { cause });
  }
  const parsed = JSON.parse(raw) as { subtypes?: Record<string, Ownership> };
  const subtypes = parsed.subtypes;
  if (!subtypes || typeof subtypes !== "object") {
    throw new Error(`rule ownership: ${path} has no "subtypes" object.`);
  }
  const owned = new Map<string, Ownership>();
  for (const [key, value] of Object.entries(subtypes)) {
    if (!SUBTYPE_KEY.test(key)) {
      throw new Error(`rule ownership: "${key}" is not a corpus subtype key. Keys are the dataset's own `
        + `\`target.subtypes\` vocabulary — "4.1.2:regex", not "regex" — because a bare family name is `
        + "ambiguous: `regex` is a different subtype under 2.4.4, 2.4.6 and 4.1.2.");
    }
    if (!DECIDED_BY.has(value?.decidedBy as DecidedBy)) {
      throw new Error(`rule ownership: "${key}" has decidedBy=${JSON.stringify(value?.decidedBy)}; `
        + `expected one of ${[...DECIDED_BY].join(", ")}. A subtype the model owns is simply absent `
        + "from this file.");
    }
    if (!CRITERION.test(value.reportsAs ?? "")) {
      throw new Error(`rule ownership: "${key}" has reportsAs=${JSON.stringify(value.reportsAs)}; `
        + "expected a WCAG criterion number such as 4.1.2.");
    }
    assertModelHeadIsValid(key, value);
    owned.set(key, value);
  }
  return owned;
}
