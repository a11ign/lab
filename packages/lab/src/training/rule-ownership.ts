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

/** Every record of the subtype is decided by a deterministic rule; the scorer's head is suppressed. */
export type DecidedBy = "rules" | "overlap";

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
  /** Free text or a list of lines. Carried so the file can explain itself where JSON has no comments. */
  note?: string | string[];
}

const DECLARATION = fileURLToPath(new URL("../../rule-ownership.json", import.meta.url));

const CRITERION = /^\d+\.\d+\.\d+$/;
const SUBTYPE_KEY = /^\d+\.\d+\.\d+:[a-z0-9-]+$/;

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
    if (value?.decidedBy !== "rules" && value?.decidedBy !== "overlap") {
      throw new Error(`rule ownership: "${key}" has decidedBy=${JSON.stringify(value?.decidedBy)}; `
        + 'expected "rules" or "overlap". A subtype the model owns is simply absent from this file.');
    }
    if (!CRITERION.test(value.reportsAs ?? "")) {
      throw new Error(`rule ownership: "${key}" has reportsAs=${JSON.stringify(value.reportsAs)}; `
        + "expected a WCAG criterion number such as 4.1.2.");
    }
    owned.set(key, value);
  }
  return owned;
}
