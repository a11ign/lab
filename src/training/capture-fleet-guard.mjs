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
import { requestJson } from "@a11ign/screenreader-fleet/worker-http";
import { fleetConsistency, describeMismatches } from "@a11ign/screenreader-fleet/fleet-consistency";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRunRecord, appendRunRecord } from "./capture-run-record.mjs";

/**
 * @typedef {{ file: string, startedAt: string, alreadyExcluded?: import("./capture-run-record.mjs").Exclusion[],
 *   append?: (file: string, text: string) => void, makeDir?: (dir: string) => void }} RunRecordOptions
 */

/**
 * What the guard RUNS to bring an odd box back (#4448), injected the way `exit` is: `lab` does not import
 * `control`, so the production binding (`fleetConvergeCommands`) is argv and the tests hand in a fake.
 *
 * @typedef {{ reassertDisplay: (worker: string, mode: string) => Promise<void>,
 *   patch: (worker: string) => Promise<void> }} Converge
 */

/**
 * One odd box, what was found and what was tried. `action` is null when nothing was run, and `note` says why.
 *
 * @typedef {{ worker: string, field: string, value: string, fleet: string,
 *   action: "reassertDisplay" | "patch" | null, note: string }} Attempt
 */

/** The `MUST_MATCH` fields a box can be walked back to the fleet's value on. Every other field is a human's. */
const DISPLAY_FIELD = "displayMode";
/** `windowsBuild` is row A's name for the field; `windowsVersion` is what `MUST_MATCH` carries until it lands. */
const BUILD_FIELDS = ["windowsBuild", "windowsVersion"];

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
 *   allowUncheckedFields?: boolean, runRecord?: RunRecordOptions, converge?: Converge}} [deps]
 */
export async function assertOneBrowserAcross(workers, when, deps = {}) {
  const probe = deps.probe ?? healthOfGuest;
  const report = deps.report ?? ((/** @type {string} */ text) => void process.stderr.write(text));
  const exit = deps.exit ?? ((/** @type {number} */ code) => process.exit(code));
  let { guests, verdict, busy } = await readFleet(workers, probe);
  /** @type {Attempt[]} */
  let attempts = [];
  if (!verdict.consistent && !deps.allowMixedBrowsers && deps.converge) {
    // CONVERGE BEFORE REFUSING (#4448), then re-read: the refusal below is about what the fleet is NOW.
    attempts = await convergeOddBoxes(planConvergence(verdict.mismatches, busy), deps.converge);
    if (attempts.some(({ action }) => action !== null)) {
      ({ guests, verdict, busy } = await readFleet(workers, probe));
      report(`\nFLEET CONVERGENCE ${when}: ${describeAttempts(attempts)}\n`);
    }
  }
  // The record is written BEFORE either refusal can exit (#4459), so a run that stops with 3 leaves its
  // fleet behind. Whether this run is refused is decided once, here, and the two checks below act on it.
  const { gaps, refused } = refusalOf(verdict, deps);
  if (deps.runRecord) {
    recordRunStart(deps.runRecord, { workers, answered: guests.map((guest) => guest !== null), refused }, report);
  }
  if (!verdict.consistent && deps.allowMixedBrowsers) {
    report(`\n--allow-mixed-browsers: capturing ${when} across a fleet that does NOT agree: `
      + `${describeMismatches(verdict.mismatches)}\n`);
  } else if (!verdict.consistent) {
    report(`\nFLEET INCONSISTENT ${when}: ${describeMismatches(verdict.mismatches)}\n`
      + "Two browser builds must never write into one corpus — `browserVersion` is in the capture cache\n"
      + "key for exactly this reason, and a split shows up later as evidence that cannot be compared.\n"
      + "Pin the fleet (`provision-role.yml --tags edge`) or run with --allow-mixed-browsers.\n"
      + (attempts.length > 0 ? `Tried before stopping: ${describeAttempts(attempts)}\n` : ""));
    return exit(EXIT_FLEET_INCONSISTENT);
  }
  // AGREEING IS NOT ENOUGH; THEY HAVE TO HAVE BEEN ASKED. Checked only once the mismatch verdict is
  // clean, because a genuine split is the more urgent finding and naming both at once would bury it.
  if (gaps.length === 0) return;
  if (deps.allowUncheckedFields) {
    // SAID LOUDLY, NAMING EACH FIELD AND ITS REPORTER COUNT (#1989). The waiver is the only record this
    // path leaves in the console — the structured record (#4459) says who took part, not what was
    // never asked — so a corpus taken under it must at least have printed what nobody was asked.
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
 * Probe every worker once. `busy` is read off the same `/health`, so "idle" and "what it runs" are one moment.
 *
 * @param {string[]} workers
 * @param {(url: string) => Promise<any>} probe
 */
async function readFleet(workers, probe) {
  /** @type {Map<string, unknown>} */
  const busy = new Map();
  const watching = async (/** @type {string} */ url) => {
    const health = await probe(url);
    busy.set(url, health?.busy);
    return health;
  };
  const guests = await Promise.all(workers.map((url) => guestFrom(url, watching)));
  return { guests, verdict: fleetConsistency(guests.filter((guest) => guest !== null)), busy };
}

/**
 * Decide, for every odd box, what is to be done and why not when nothing is. Pure: `converge` runs it.
 *
 * A box AHEAD of the fleet's build is never repaired (there is no downgrade; `os-rollback.yml` is a human
 * decision), and neither is one with no modal value to be behind, or one that is not provably idle. `busy`
 * must be `false`: a box that did not say is not known to be free of a capture.
 *
 * @param {{ field: string, values: Record<string, unknown> }[]} mismatches
 * @param {Map<string, unknown>} busy
 * @returns {Attempt[]}
 */
function planConvergence(mismatches, busy) {
  return mismatches.flatMap(({ field, values }) => {
    const fleet = modalValue(values);
    if (fleet === null) return [];
    return Object.entries(values).filter(([, value]) => String(value) !== fleet).map(([worker, value]) => {
      const odd = { worker, field, value: String(value), fleet };
      if (field === DISPLAY_FIELD) return { ...odd, action: /** @type {const} */ ("reassertDisplay"), note: "" };
      if (!BUILD_FIELDS.includes(field)) return { ...odd, action: null, note: "not a field the guard repairs" };
      const order = compareBuilds(odd.value, fleet);
      if (order === null) return { ...odd, action: null, note: "build not comparable, left alone" };
      if (order > 0) return { ...odd, action: null, note: "AHEAD of the fleet's build; never downgraded, a human's call (os-rollback.yml)" };
      if (busy.get(worker) !== false) return { ...odd, action: null, note: "not patched: not known to be idle" };
      return { ...odd, action: /** @type {const} */ ("patch"), note: "" };
    });
  });
}

/** The value most guests hold, or null when two values tie for it — a tie has no fleet to converge on. @param {Record<string, unknown>} values */
function modalValue(values) {
  const counts = new Map();
  for (const value of Object.values(values)) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}

/**
 * Order two Windows builds by their trailing dotted number (`... 10.0.22621.4317`), -1 behind, 1 ahead.
 * Null when either has none: unreadable is not "behind".
 *
 * @param {string} box
 * @param {string} fleet
 */
function compareBuilds(box, fleet) {
  const parts = (/** @type {string} */ text) => /(\d+(?:\.\d+)+)\s*$/.exec(text)?.[1].split(".").map(Number) ?? null;
  const [a, b] = [parts(box), parts(fleet)];
  if (a === null || b === null) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * Run what the plan chose, one action per box and kind, and say what each came to. A failed command is an
 * outcome to print, not a reason to stop: the re-read decides whether the box is back.
 *
 * @param {Attempt[]} plan
 * @param {Converge} converge
 * @returns {Promise<Attempt[]>}
 */
async function convergeOddBoxes(plan, converge) {
  const done = new Set();
  const results = [];
  for (const step of plan) {
    const key = `${step.action}:${step.worker}`;
    if (step.action === null || done.has(key)) { results.push(step); continue; }
    done.add(key);
    try {
      if (step.action === "patch") await converge.patch(step.worker);
      else await converge.reassertDisplay(step.worker, step.fleet);
      results.push({ ...step, note: `ran ${step.action}` });
    } catch (error) {
      results.push({ ...step, note: `${step.action} FAILED: ${/** @type {Error} */ (error).message}` });
    }
  }
  return results;
}

/** One line per box: where it is, where the fleet is, and what was tried. @param {Attempt[]} attempts */
function describeAttempts(attempts) {
  return attempts.map(({ worker, field, value, fleet, note }) =>
    `${worker} ${field}=${value} (fleet ${fleet}): ${note}`).join("; ");
}

/**
 * The production binding of `Converge`: the commands an operator would type, run from the core checkout.
 * `nameOf` maps the guard's worker URL to the inventory name `--limit` takes; an unknown box throws and
 * so is reported as a failed attempt rather than guessed at. Pinned by argv in the test.
 *
 * @param {{ nameOf: (url: string) => string | null, cwd: string,
 *   run?: (argv: string[], cwd: string) => Promise<void> }} options
 * @returns {Converge}
 */
export function fleetConvergeCommands({ nameOf, cwd, run = runCommand }) {
  const limit = (/** @type {string} */ url) => {
    const name = nameOf(url);
    if (name === null) throw new Error(`no inventory name known for ${url}`);
    return `--limit=${name}`;
  };
  return {
    patch: async (worker) => run(["npm", "run", "fleet:patch", "--", "--apply", limit(worker)], cwd),
    reassertDisplay: async (worker, mode) =>
      run(["npm", "run", "fleet:provision", "--", `--display-mode=${mode}`, limit(worker)], cwd),
  };
}

/** @param {string[]} argv @param {string} cwd */
async function runCommand([file, ...args], cwd) {
  await promisify(execFile)(file, args, { cwd });
}

/**
 * Whether the two refusals below will stop this run, decided once so the record and the checks cannot disagree.
 * The coverage gaps are read only once the mismatch verdict is clean or waived, as the checks themselves do.
 *
 * @param {{ consistent: boolean, fields?: Parameters<typeof fieldCoverageGaps>[0] }} verdict
 * @param {{ allowMixedBrowsers?: boolean, allowUncheckedFields?: boolean }} waivers
 */
function refusalOf(verdict, { allowMixedBrowsers, allowUncheckedFields }) {
  const split = !verdict.consistent && !allowMixedBrowsers;
  const gaps = split ? [] : fieldCoverageGaps(verdict.fields);
  return { gaps, refused: split || (gaps.length > 0 && !allowUncheckedFields) };
}

/**
 * Append this run's fleet to `runs/capture-runs.jsonl` (#4459), before the guard can exit.
 *
 * `readyCount` is what THIS probe saw answer, counted before any exclusion. The workers the caller left out
 * ahead of the guard (asleep, or down after the wake step) arrive as `alreadyExcluded` because only the caller
 * saw them; a worker that does not answer the probe itself is `down`. A refused run took part with nobody, and
 * the boxes that answered are `inconsistent` rather than guessed at: which one is the odd one out is a human's
 * call, and the next run's shorter list is the exclusion.
 *
 * A record that cannot be written is REPORTED and the run goes on: stopping a capture over its own bookkeeping
 * would punish the run for the absence this record exists to end, but it is never silent.
 *
 * @param {RunRecordOptions} options
 * @param {{ workers: string[], answered: boolean[], refused: boolean }} fleet
 * @param {(text: string) => void} report
 */
function recordRunStart(options, { workers, answered, refused }, report) {
  const ready = workers.filter((_, i) => answered[i]);
  const down = workers.filter((_, i) => !answered[i]);
  const record = buildRunRecord({
    startedAt: options.startedAt,
    readyCount: ready.length,
    participants: refused ? [] : ready,
    excluded: [
      ...(options.alreadyExcluded ?? []),
      ...down.map((worker) => ({ worker, reason: /** @type {const} */ ("down") })),
      ...(refused ? ready.map((worker) => ({ worker, reason: /** @type {const} */ ("inconsistent") })) : []),
    ],
  });
  try {
    appendRunRecord(record, options.file, { append: options.append, makeDir: options.makeDir });
  } catch (error) {
    report(`\nCAPTURE RUN RECORD NOT WRITTEN to ${options.file}: ${/** @type {Error} */ (error).message}\n`);
  }
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
