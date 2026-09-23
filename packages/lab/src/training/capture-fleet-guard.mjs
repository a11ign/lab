// @ts-check
/**
 * Refuse to build ONE corpus out of workers running different browsers.
 *
 * `browserVersion` is in the capture cache key precisely because a fleet can run more than one image, and
 * `fleet:status` has reported INCONSISTENT for a long time — but only when a human ran it, and only
 * before a run rather than during one.
 *
 * Measured 2026-08-24: a worker that had been down came back with Edge auto-updated from the pinned
 * .101 to .107 while a corpus run was in flight. The fleet was consistent when the run started and was
 * not when it finished, and nothing noticed. Fifteen pages were captured under the wrong build before I
 * happened to look.
 *
 * Checked at the BOUNDARY of a capture run, for the same reason `assertWorkerUrl` is: the alternative is
 * discovering it in the evidence weeks later, where a split fleet looks like a page that changed. And
 * re-checked after the run, because "consistent when it started" is exactly the claim that failed.
 *
 * FOR TWO MONTHS IT COULD NOT FIRE (#2018). It passed each guest's raw `/health` payload straight to
 * `fleetConsistency`, and `/health` answers `{ ok, screenReader, busy, code, environment }` — no `worker`
 * key. `check()` stores every value as `values[guest.worker]`, so ten guests landed on the single key
 * `undefined`, the map held one entry however many reported, and `consistent` was true for any fleet at
 * all — including the 151-against-150 split this function exists for, and which it had already caught
 * once by hand. Nothing typed it: `fleetConsistency` documents `{worker, environment, policy}` in JSDoc,
 * and a `.mjs` caller is not checked against a `@param`. `fleet-status.mjs` and `doctor.mjs` both build
 * the documented shape; this was the odd one out, so the fix is to join them rather than to loosen the
 * callee.
 *
 * ITS OWN FILE, and that is part of the same fix. It lived in `capture-real-pages.mjs`, whose import
 * closure reaches `dataset-paths.mjs` and therefore the corpus — so the acceptance job, which has no
 * `runs/`, REFUSED to run any test that imported it (`acceptance-commands.mjs`'s closure walk). A guard
 * nothing could test in CI is how this one shipped unable to fire. Nothing here reads the corpus, parses
 * a flag or knows what a role is; it asks the fleet one question.
 *
 * `--allow-mixed-browsers` stays with the flags, in the caller: this function is the check, not the
 * decision to skip it.
 *
 * IT READ `consistent` ALONE, SO A FIELD NOBODY REPORTED WAS AGREEMENT (#2047) — the sixth pass of this
 * family, and the one layer down from where the previous five were fixed. `fleetConsistency` skips an
 * absent value rather than calling it a mismatch, which is right (a rolling deploy must not flag the
 * guest it has not reached yet) and means a field NO guest answers draws no values to disagree about:
 * `mismatches` is empty, `consistent` is true, and it is indistinguishable from a field every guest
 * agreed on. #1997 fixed that in the HEADLINE, #2019 extended it from 0-of-N to k-of-N — and this
 * caller, the one that actually refuses a run, threw `verdict.fields` away and kept reading the boolean.
 *
 * Measured 2026-09-22T23:5xZ on the live fleet: ten guests, `displayMode` reported by 0 of 10 (worker
 * code predating #1953), `fields.unchecked: ["displayMode"]`, and this guard returned SILENTLY on the
 * same fleet the adjacent `npm run fleet:status` called UNKNOWN. Per #1955 those ten boxes genuinely ran
 * two display modes that day — five at 1024x768 and five at 640x480 — so a capture started then would
 * have spread one corpus across both. That is this function's own docstring failure with the axis
 * changed from DRIFTED to NEVER ASKED.
 *
 * THE GATE'S RULE IS THE HEADLINE'S RULE: any `MUST_MATCH` field where `reported < asked` — the same line
 * `fieldCoverageGap` draws in `fleet-status.mjs`, covering #1997's 0-of-N and #2019's k-of-N alike. One
 * rule read in two places, and a future change to either owes the other. A gate looser than the headline
 * would recreate #2047 one release later; the two are NOT shared as code because `fieldCoverageGap`
 * builds an operator's status LINE and this builds a refusal, and `packages/lab` importing
 * `packages/control` is a dependency this repo does not have.
 *
 * WARN-AND-CONTINUE WAS REFUSED, and the reason is what a gate is: in a gate, the reader's takeaway is
 * whether it returns. The override is `allowUncheckedFields` — a SEPARATE waiver from
 * `--allow-mixed-browsers`, because the two say different things. That one says *the guests differ and I
 * accept it*; this says *the guests were never asked*, and folding them would let an operator who
 * accepted a browser split also silently accept an unasked display. Taken as an OPTION rather than read
 * from `process.argv` here, the way `assertFleetRunsThisCheckout` takes `allow:`, so a test can exercise
 * the waived path through this function instead of through a caller-side `if (ALLOW) return;` that CI
 * cannot reach.
 *
 * WHICH IS ALSO WHY `--allow-mixed-browsers` STOPPED BEING A CALL-SITE SKIP. #2018 deliberately left it
 * in `capture-real-pages.mjs` as `if (ALLOW_MIXED) return;`, and that was right while this function made
 * ONE refusal: skipping the call and waiving the check were the same act. They stopped being the same
 * act the moment a second, independent refusal moved in here — an early return at the call site waives
 * both, which is exactly the fold the ruling refused, reached from the other side. A waiver has to be
 * named where the refusals are distinguishable, so both are options on this function now and neither can
 * waive the other.
 */
import { requestJson } from "@a11ign/worker-fleet/worker-http";
import { fleetConsistency, describeMismatches } from "@a11ign/worker-fleet/fleet-consistency";

/** One guest's `/health` is a cheap read, and a box that needs longer than this is not one to capture on. */
const HEALTH_TIMEOUT_MS = 10_000;

/** The run stops rather than writing two browser builds into one corpus — `docs/gate-exit-codes.md`. */
export const EXIT_FLEET_INCONSISTENT = 3;

/**
 * Ask every worker what it is running, and stop the run if they do not agree.
 *
 * `deps` exists so a test can drive THIS FUNCTION rather than a pure helper beside it — the same reason
 * `fleetStatus` takes one. The defect lived entirely in the object built out of a `/health` payload, so a
 * test that stubs `fleetConsistency`, or re-derives the guests itself, holds everything except the line
 * that was wrong. Production passes nothing and the defaults are the real probe, stderr and exit.
 *
 * @param {string[]} workers
 * @param {string} when — "before the run" / "by the END of the run", quoted into the refusal
 * @param {{probe?: (url: string) => Promise<any>, report?: (text: string) => void,
 *   exit?: (code: number) => void, allowMixedBrowsers?: boolean,
 *   allowUncheckedFields?: boolean}} [deps]
 */
export async function assertOneBrowserAcross(workers, when, deps = {}) {
  const probe = deps.probe ?? healthOfGuest;
  const report = deps.report ?? ((/** @type {string} */ text) => void process.stderr.write(text));
  const exit = deps.exit ?? ((/** @type {number} */ code) => process.exit(code));
  const guests = await Promise.all(workers.map((url) => guestFrom(url, probe)));
  // `!== null` rather than `Boolean`: a filter cannot narrow unless it says what it tests, and typing the
  // guests is the whole point of this fix — a `.filter(Boolean)` here leaves the array `(guest|null)[]`,
  // which is how a wrongly-shaped guest reached `fleetConsistency` unchecked in the first place.
  const verdict = fleetConsistency(guests.filter((guest) => guest !== null));
  if (!verdict.consistent && deps.allowMixedBrowsers) {
    report(`\n--allow-mixed-browsers: capturing ${when} across a fleet that does NOT agree: `
      + `${describeMismatches(verdict.mismatches)}\n`);
  } else if (!verdict.consistent) {
    report(`\nFLEET INCONSISTENT ${when}: ${describeMismatches(verdict.mismatches)}\n`
      + "Two browser builds must never write into one corpus — `browserVersion` is in the capture cache\n"
      + "key for exactly this reason, and a split shows up later as evidence that cannot be compared.\n"
      + "Pin the fleet (`provision-role.yml --tags edge`) or run with --allow-mixed-browsers.\n");
    return exit(EXIT_FLEET_INCONSISTENT);
  }
  // AGREEING IS NOT ENOUGH; THEY HAVE TO HAVE BEEN ASKED. Checked only once the mismatch verdict is
  // clean, because a genuine split is the more urgent finding and naming both at once would bury it.
  const gaps = fieldCoverageGaps(verdict.fields);
  if (gaps.length === 0) return;
  if (deps.allowUncheckedFields) {
    // SAID LOUDLY, NAMING EACH FIELD AND ITS REPORTER COUNT (#1989). The waiver is the only record this
    // path leaves — `capture-real-pages.mjs` writes no structured run record here — so a corpus taken
    // under it must at least have printed what nobody was asked.
    report(`\n--allow-unchecked-fields: capturing ${when} WITHOUT having asked `
      + `${gaps.length === 1 ? "one field" : `${gaps.length} fields`} of every guest: `
      + `${describeCoverageGaps(gaps)}.\nThese guests are being treated as interchangeable on evidence `
      + "nobody collected.\n");
    return;
  }
  report(`\nFLEET COVERAGE UNKNOWN ${when}: ${describeCoverageGaps(gaps)}.\n`
    + "A field no guest reports draws no values to disagree about, so it reads exactly like a field every\n"
    + "guest agrees on — these boxes are not known to be interchangeable, they were never asked. The\n"
    + "fleet ran two display modes under exactly this silence (#1955), and a corpus captured across both\n"
    + "cannot be compared.\n"
    + "Deploy the fleet (`npm run fleet:deploy`), take the field out of `MUST_MATCH`, or run with\n"
    + "--allow-unchecked-fields.\n");
  exit(EXIT_FLEET_INCONSISTENT);
}

/**
 * The fields this verdict did not actually ask of every guest — `fieldCoverageGap`'s rule, in a gate.
 *
 * `reported < asked` covers both halves of the family in one line: #1997's field that NOBODY answered
 * (`reported === 0`) and #2019's field that only some did. They are not split into two clauses here as
 * the headline splits them, because the headline's split serves the REMEDY (a field at 0 sends a reader
 * to the field, a field at k sends them to the boxes) and both remedies are already on the refusal.
 *
 * NO COVERAGE SUPPLIED IS THE SAME CANNOT-ASK, not a pass — a callee that answered with a pre-#2019
 * shape has not told us how many guests reported anything, so it cannot rule the gap out. `[]` coverage
 * is different and is genuinely no objection: `fleetConsistency` returns it for a fleet of fewer than
 * two guests, where there is nobody to be interchangeable with and coverage is not a question yet.
 *
 * @param {{ coverage?: { field: string, reported: number, asked: number }[] } | undefined} fields
 * @returns {{ field: string, reported: number, asked: number }[]}
 */
function fieldCoverageGaps(fields) {
  if (fields?.coverage === undefined) return [{ field: "(no coverage supplied)", reported: 0, asked: 0 }];
  return fields.coverage.filter(({ reported, asked }) => reported < asked);
}

/**
 * Each gap as `field (k of N reported it)` — named with its count, never counted.
 *
 * "1 field was not compared" sends the reader back to this command; `displayMode (0 of 10 reported it)`
 * tells them which field and how many boxes owe an answer, which is the finding.
 *
 * @param {{ field: string, reported: number, asked: number }[]} gaps
 */
function describeCoverageGaps(gaps) {
  return gaps.map(({ field, reported, asked }) => `${field} (${reported} of ${asked} reported it)`).join(", ");
}

/**
 * One guest, in the shape `fleetConsistency` documents — or nothing at all.
 *
 * @param {string} url
 * @param {(url: string) => Promise<any>} probe
 */
async function guestFrom(url, probe) {
  try {
    const health = await probe(url);
    // NAMED BY WORKER, which is what makes a verdict possible at all: the values `fleetConsistency`
    // compares are keyed by `worker`, and `describeMismatches` reads those same keys to say WHICH box
    // drifted. `policy: undefined` rather than null, exactly as `fleet-status.mjs` passes it — the field
    // is optional and means "this probe collected no policy block", which is true here since `/health`
    // carries none. `null` would claim we collected an empty one.
    return health ? { worker: url, environment: health.environment, policy: undefined } : null;
  } catch {
    // Unreachable is not INCONSISTENT. A box that is asleep contributes no evidence and no mismatch,
    // and treating silence as a fault is how a check earns a reputation for crying wolf.
    return null;
  }
}

/** The real `/health` read, which `deps.probe` replaces in a test. @param {string} url */
async function healthOfGuest(url) {
  return (await requestJson(`${url}/health`, { timeoutMs: HEALTH_TIMEOUT_MS })).json ?? null;
}
