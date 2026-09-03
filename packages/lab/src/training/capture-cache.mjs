// @ts-check
// Should this case be captured again, or is the evidence on disk still valid?
//
// A full dataset run is 1,061 pairs and ~1.5 h across three workers, and almost all of it is
// usually unchanged. `--resume` now validates the pair against the current page hash (and, for
// legacy captures, recomputes the old cache key from the stored worker environment and options).
// That prevents evidence being reused after the PAGE changed, after the capture options changed,
// or after NVDA or Edge was updated underneath it — which is exactly how a dataset quietly stops
// describing the thing it claims to describe.
//
// So the decision is keyed on everything that can change what NVDA says:
//
//   the page files        a byte of markup changes what is announced
//   capture options       the same page read with different probes yields different evidence
//   protocol version      our own meaning-of-the-output version (see CAPTURE_PROTOCOL_VERSION)
//   NVDA + Edge versions  NVDA's wording varies by release; capture-core says so in comments
//   provisioning revision NVDA config, Edge policy and ForegroundLockTimeout all shape the output
//
// Deliberately NOT keyed on the worker's code hash. That hash changes when a comment changes, and
// invalidating 1,061 pairs over a reworded comment is how a cache becomes something people turn
// off. The hash is still recorded, and a hit whose hash differs is reported rather than hidden.
//
// The key lives inside each capture JSON, not in a side index: an index can drift from the files
// it describes, and this cache exists to stop us trusting stale things.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_LENGTH = 16; // enough to be unique across ~2k cases, short enough to read in a log

/**
 * Stable JSON: object key order must not change the key.
 *
 * @param {unknown} value
 * @returns {unknown}  ANNOTATED because it recurses -- without a declared return TypeScript refuses to
 *   infer one at all (TS7023), and the result silently becomes `any`, which is the opposite of what a
 *   function computing a CACHE KEY wants.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(Object.keys(record).sort().map((k) => [k, canonical(record[k])]));
  }
  return value;
}

const sha256 = (/** @type {string} */ input) => createHash("sha256").update(input).digest("hex");

/**
 * Hash every file in a case's page directory.
 *
 * The whole directory rather than just good.html/bad.html: there are no asset files today (all
 * 2,122 page files are HTML) but a fixture that gains an image must invalidate its evidence, and
 * a cache that silently ignores new files is worse than no cache.
 */
/** @param {string} pageDir */
export function hashPageDir(pageDir) {
  const hash = createHash("sha256");
  for (const name of readdirSync(pageDir).sort()) {
    hash.update(name);
    hash.update(readFileSync(resolve(pageDir, name)));
  }
  return hash.digest("hex").slice(0, KEY_LENGTH);
}

/**
 * The environment fields that change captured evidence, taken from the worker's own /health.
 * Missing values become "unknown", which still keys consistently -- two captures from an
 * unreportable worker match each other and nothing else.
 *
 * **The OS is part of this, and was not.** The key covered the screen reader, the browser, the protocol
 * and the provisioning revision -- but not which Windows the guest was running, nor its architecture. A
 * fleet with more than one image therefore wrote into one corpus indistinguishably: a capture from an
 * ARM64 guest on a developer's Mac and one from an x64 guest on a server were, as far as the cache was
 * concerned, the same evidence. Whether NVDA announces identically across those is exactly the question
 * `npm run evidence:check` exists to answer -- and until it has been answered for a given pair of
 * images, the cache must not assume it.
 *
 * `provisionRevision` is an additional guard. Guests created before the stamp was introduced report
 * `"unstamped"` until they are deliberately re-provisioned; current workers read the stamp from their
 * actual checkout, so a later provisioning change invalidates the environment key.
 */
/**
 * @param {{ screenReader?: string, screenReaderVersion?: string, guidepupVersion?: string,
 *           browser?: string, browserVersion?: string, windowsVersion?: string, architecture?: string,
 *           captureProtocol?: string|number, screenReaderSettings?: string,
 *           provisionRevision?: string }} [environment]
 *
 * EVERY FIELD LISTED, because each is a cache key and an absent one silently becomes `"unknown"` -- which
 * is a value two different guests can share. The comments below record what each costs when it is wrong;
 * the type is what stops a NEW field being read here and never reaching the record.
 */
export function environmentKey(environment = {}) {
  return {
    screenReader: `${environment.screenReader ?? "NVDA"}/${environment.screenReaderVersion ?? "unknown"}`,
    // The DRIVER, not just the screen reader. guidepup parses NVDA's speech before we ever see it, and
    // 0.29.2 -> 0.31.0 changed the parse: an object placeholder that intermittently surfaced as U+FFFC
    // ("Postcode, edit, ￼") now renders consistently as an empty segment. Same NVDA, same page, same
    // browser, different evidence -- so two guests on different guidepup versions must never share a
    // cache entry. Found the hard way: the upgrade fixed a 7% nondeterminism and changed every form
    // transcript while doing it.
    driver: `guidepup/${environment.guidepupVersion ?? "unknown"}`,
    browser: `${environment.browser ?? "unknown"}/${environment.browserVersion ?? "unknown"}`,
    os: `${environment.windowsVersion ?? "unknown"}/${environment.architecture ?? "unknown"}`,
    captureProtocol: environment.captureProtocol ?? "unknown",
    // WHICH NVDA SETTINGS THE CAPTURE WAS TAKEN UNDER, and it belongs here for the same reason `driver`
    // does: it changes what NVDA SAYS before this project ever sees it.
    //
    // `reportLanguage` is on by decision from 2026-09-03. At NVDA's default a 3.1.2 failure is announced
    // as a change of VOICE and no text, so a pipeline that captures speech as text is blind to it; with
    // the setting on NVDA speaks the language and it lands in the transcript. A capture taken before that
    // and one taken after are therefore different evidence, and reusing the first for the second is the
    // exact blend this key exists to prevent.
    //
    // `"default"` for a guest that predates the field — NOT "unknown". The absent value is a FACT here:
    // every capture taken before this existed was taken at NVDA's defaults, and saying so is more useful
    // than saying we cannot tell. It still differs from the new digest, so nothing blends.
    screenReaderSettings: environment.screenReaderSettings ?? "default",
    provisionRevision: environment.provisionRevision ?? "unstamped",
  };
}

/** The identity of a capture: same key means the same evidence should result. */
/**
 * @param {{ caseId: string, pageHash: string, options?: Record<string, unknown>,
 *           environment?: Parameters<typeof environmentKey>[0] }} input
 */
export function cacheKey({ caseId, pageHash, options, environment }) {
  return sha256(JSON.stringify(canonical({
    caseId,
    pages: pageHash,
    options,
    environment: environmentKey(environment),
  }))).slice(0, KEY_LENGTH);
}

/**
 * Attach the key and the environment that produced this capture, so the next run can compare.
 *
 * @param {object} capture
 * @param {{ key: string, pageHash?: string|null, options: object, environment: object, worker?: string|null }} provenance
 */
/**
 * @param {{ capturedAt?: string, [key: string]: unknown }} capture
 * @param {{ key: string, pageHash?: string|null, options?: Record<string, unknown>,
 *           environment?: (Parameters<typeof environmentKey>[0] & { workerCode?: string }) | null,
 *           worker?: string|null }} stamp
 *
 * `workerCode` is on the ENVIRONMENT here and deliberately not on `environmentKey`'s input: it is
 * recorded and never keyed, for the reason the header gives -- it changes when a comment changes, and
 * invalidating 1,061 pairs over a reworded comment is how a cache gets switched off. The type says which
 * side of that line each field is on.
 */
export function stampProvenance(capture, { key, pageHash = null, options, environment, worker = null }) {
  return {
    ...capture,
    provenance: {
      cacheKey: key,
      pageHash,
      capturedAt: capture.capturedAt,
      // Which guest produced this. Not part of the key -- workers are meant to be
      // interchangeable, and keying on it would stop the pool sharing evidence -- but without it
      // a slow phase cannot be attributed to a machine after the fact.
      worker,
      options,
      // The code hash is recorded but NOT part of the key -- see the header.
      workerCode: environment?.workerCode ?? "unknown",
      captureProtocol: environment?.captureProtocol ?? "unknown",
      provisionRevision: environment?.provisionRevision ?? "unstamped",
    },
  };
}

/** @param {string} captureRoot @param {string} caseId @param {string} variant */
function readCapture(captureRoot, caseId, variant) {
  try {
    return JSON.parse(readFileSync(resolve(captureRoot, `${caseId}.${variant}.json`), "utf8"));
  } catch {
    // Absent or unreadable both mean "no usable evidence", and the caller only needs that.
    return null;
  }
}

const isUsable = (/** @type {Record<string, any>|null} */ capture) =>
  capture?.screenReader === "NVDA" && Array.isArray(capture.transcript) && capture.transcript.length > 0;

/**
 * Reuse the pair on disk, or recapture it?
 *
 * All-or-nothing across both variants, never one of them. A pair is only comparable if both halves
 * came from the same screen reader on the same machine (see captureAcrossPool), so reusing a cached
 * `good` beside a freshly captured `bad` would compare two NVDA instances and call the difference
 * evidence.
 *
 * @returns {{reuse: boolean, reason: string, staleCode: string|null}}
 */
/** @param {{ captureRoot: string, caseId: string, key: string }} request */
export function cacheDecision({ captureRoot, caseId, key }) {
  const captures = ["good", "bad"].map((v) => readCapture(captureRoot, caseId, v));
  if (!captures.every(isUsable)) return { reuse: false, reason: "no usable pair on disk", staleCode: null };

  const keys = captures.map((c) => c.provenance?.cacheKey);
  if (keys.some((k) => !k)) return { reuse: false, reason: "captured before the cache existed", staleCode: null };
  if (!keys.every((k) => k === key)) return { reuse: false, reason: "page, options or environment changed", staleCode: null };

  // Reused evidence produced by different capture code is legitimate -- the protocol version says
  // the meaning is unchanged -- but it is worth saying out loud rather than discovering later.
  const codes = new Set(captures.map((c) => c.provenance?.workerCode));
  const staleCode = codes.size === 1 ? [...codes][0] : [...codes].join(",");
  return { reuse: true, reason: "unchanged", staleCode };
}
