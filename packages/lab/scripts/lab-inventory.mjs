// @ts-check
/**
 * What state are the lab's corpus, exports and models actually in?
 *
 *     npm run lab:inventory            # on the lab, or against a local copy of runs/
 *     npm run lab:inventory -- --json
 *     npm run lab:job -- -e job=inventory      # the authoritative answer, where the corpus lives
 *
 * ## Why this exists
 *
 * Every other moving part here has a status command — `fleet:status` for the boxes, `lab:status` for a
 * job, `doctor` for the local environment, `worker:code` for what the guests are running. The corpus and
 * the artefacts trained from it had none, and they are the things everything else exists to produce.
 *
 * The consequence was measured on 2026-08-25: answering "which Edge build is this corpus captured
 * under?", "which schema is this candidate stamped with?" and "is the acceptance export current?" meant
 * opening an SSH shell on the lab and running ad-hoc Python — about eight times in one afternoon. That is
 * the hand-crank this repo removes everywhere else, and it produced its own defect within the hour: a
 * hand-rolled script read the wrong progress field and reported `captured: 0` while `lab:status`
 * correctly reported 85. A one-off script has no tests, no review and no second reader.
 *
 * ## What it answers, and why these four
 *
 * Each one is a question that has cost a run:
 *
 *   - **Is the corpus homogeneous?** `environmentKey` puts browser, screen reader, guidepup, OS and
 *     provisionRevision in the capture cache key precisely because a fleet can differ. A corpus holding
 *     two populations is not comparable evidence, and the symptom is silent: cache misses that read as
 *     ordinary churn. On 2026-08-25 the corpus held FOUR worker-code populations and two Edge builds.
 *   - **Are the exports current?** The featurizer reads a `parsed` block baked in at export time, so an
 *     announcement-grammar change moves the model input without touching a line of Python. A candidate
 *     trained on a stale export is fitted to a parse that no longer exists — and its schema STAMP still
 *     looks right, because a version string is not a content hash.
 *   - **What schema is each model stamped with?** The answer lives in safetensors metadata, not in
 *     `training-report.json`, which is why it was unreadable without a script.
 *   - **Is a schema migration open?** That is what `release:gate` refuses on, and knowing which candidate
 *     could close it is the difference between a retrain and a promote.
 *   - **What has `lab:fetch` left lying around, and how old is it?** Added 2026-09-06, after
 *     `runs/fetched/candidate.dataset-export.jsonl` (a point-in-time snapshot of the SAME canonical
 *     `screenreader-evidence.jsonl` this file already tracks under EXPORTS, fetched once and never
 *     refreshed) disagreed with a same-day `rules-gate.log` about whether 18 records carried a census —
 *     and nothing said which to believe, or that a second, older copy even existed. `runs/fetched/` was
 *     invisible to this tool entirely: a reader got the corpus and export state above, and had no way to
 *     learn that a THIRD copy of related evidence was sitting one directory over, unlabelled as to age or
 *     authority. This does not try to match a fetched file back to the export it came from — `lab-fetch
 *     .yml`'s naming (`<out>.<artifact><ext>`) does not carry that mapping in a form worth re-deriving here
 *     (the destination name is generic; recovering which lab path it names means re-reading the playbook,
 *     which is the two-copies-of-one-fact shape this repo keeps paying for). It reports existence and age,
 *     which is the part that was silently missing, and leaves "is this the same as that export" to the
 *     reader with both ages in front of them instead of neither.
 *
 * ## It refuses to measure a moving target
 *
 * Same guard as `rules:coverage` and `rules:real-pages`, for the same reason: a corpus written in the
 * last few minutes is being rewritten underneath the count, and a number computed from it describes a
 * state that is already gone. Reporting it would be worse than reporting nothing.
 */
import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { REPO_ROOT, runsRoot, realCorpusRoot, datasetRoot } from "../src/dataset-paths.mjs";
import { corpusState } from "../src/training/corpus-settled.mjs";
import { captureAgeLines } from "../src/training/real-page-freshness.mjs";

/**
 * as `doctor`.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--json"], { entry: import.meta.url, command: "npm run lab:inventory" });

const REPO = REPO_ROOT;
const RUNS = runsRoot();
const SHIPPED = resolve(REPO, "packages/scorer/models/screenreader-scorer");
const MIGRATION = resolve(REPO, "packages/scorer/models/schema-migration.json");
const JSON_OUT = process.argv.includes("--json");

/** Below this the corpus is being rewritten and every count describes a state that is already gone. */
/** Enough captures to be worth describing; fewer is a partial copy, not a corpus. */
const PARTIAL_CORPUS = 50;

const readJson = (/** @type {any} */ path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The `representation` a model was trained under, from safetensors METADATA.
 *
 * Not from `training-report.json`, which does not carry it — that is exactly why this question needed a
 * script rather than a `jq`. The format is an 8-byte little-endian header length, then that many bytes of
 * JSON whose `__metadata__` holds the stamps.
 */
function modelSchema(/** @type {any} */ dir) {
  const path = join(dir, "model.safetensors");
  if (!existsSync(path)) return null;
  let fd;
  try {
    fd = openSync(path, "r");
    const size = Buffer.alloc(8);
    readSync(fd, size, 0, 8, 0);
    const length = Number(size.readBigUInt64LE(0));
    const header = Buffer.alloc(length);
    readSync(fd, header, 0, length, 8);
    return JSON.parse(header.toString("utf8")).__metadata__ ?? {};
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const minutesSince = (/** @type {any} */ ms) => (Date.now() - ms) / 60_000;

function newestWrite(/** @type {any} */ dir) {
  let newest = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      newest = Math.max(newest, statSync(join(dir, entry)).mtimeMs);
    }
  } catch {
    return 0;
  }
  return newest;
}

/**
 * The distribution of every field the capture cache keys on. PURE.
 *
 * Reported as a distribution rather than as a verdict, because "the corpus is split" and "the corpus is
 * split 3,168 to 42" are different facts and only the second tells you whether you are looking at a
 * finished migration or a run that died halfway.
 *
 * @param {Array<{environment?: object, provenance?: object}>} captures
 * @returns {Record<string, Record<string, number>>}
 */
export function environmentSpread(captures) {
  const fields = {
    browserVersion: (/** @type {any} */ c) => c.environment?.browserVersion,
    screenReaderVersion: (/** @type {any} */ c) => c.environment?.screenReaderVersion,
    guidepupVersion: (/** @type {any} */ c) => c.environment?.guidepupVersion,
    windowsVersion: (/** @type {any} */ c) => c.environment?.windowsVersion,
    captureProtocol: (/** @type {any} */ c) => c.provenance?.captureProtocol,
    provisionRevision: (/** @type {any} */ c) => c.provenance?.provisionRevision,
    workerCode: (/** @type {any} */ c) => c.provenance?.workerCode,
  };
  /** @type {Record<string, any>} */
  const spread = {};
  for (const [name, read] of Object.entries(fields)) {
    /** @type {Record<string, any>} */
    const counts = {};
    for (const capture of captures) {
      // ABSENT is counted as its own value, never skipped. A field missing from half the corpus is the
      // single most useful thing this report can say — the cache key reads it as "unknown", so those
      // captures can never match a live guest, and the symptom is only ever unexplained cache misses.
      const value = String(read(capture) ?? "(absent)");
      counts[value] = (counts[value] ?? 0) + 1;
    }
    spread[name] = counts;
  }
  return spread;
}

/** Which fields hold more than one value, worst first. PURE. */
export function splitFields(/** @type {any} */ spread) {
  return Object.entries(spread)
    .filter(([, counts]) => Object.keys(counts).length > 1)
    .map(([field, counts]) => ({ field, values: counts, populations: Object.keys(counts).length }))
    .sort((a, b) => b.populations - a.populations);
}

/**
 * `ages` is read from `parsed` BEFORE the `parsed.capture ?? parsed` unwrap below, because that unwrap is
 * what makes real-page captures a hazard here: a real-page file is `{capture, capturedAt, role, ...}`, so
 * unwrapping to `.capture` silently drops the two fields freshness depends on. The dataset corpus has no
 * such wrapper, so this is a no-op for it -- `entries.filter(...)` finds nothing to collect there.
 */
function readCorpus(/** @type {any} */ dir) {
  /** @type {any[]} */
  const captures = [];
  /** @type {{ at: string, role: string }[]} */
  const ages = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // No such directory is the ordinary case off the lab, not an error worth a diagnostic.
    return { captures, files: 0, ages };
  }
  for (const file of files) {
    const parsed = readJson(join(dir, file));
    if (!parsed) continue;
    if (typeof parsed.capturedAt === "string") {
      ages.push({ at: parsed.capturedAt, role: parsed.role ?? "no role recorded" });
    }
    captures.push(parsed.capture ?? parsed);
  }
  return { captures, files: files.length, ages };
}

/** An export is STALE when the newest capture is younger than it — the parse baked in predates them. */
function exportState(/** @type {any} */ path, /** @type {any} */ newestCaptureMs) {
  if (!existsSync(path)) return { path: basename(path), present: false };
  const { mtimeMs, size } = statSync(path);
  return {
    path: basename(path),
    present: true,
    writtenMinutesAgo: Math.round(minutesSince(mtimeMs)),
    bytes: size,
    // Compared against the CAPTURES it is derived from, not against the clock. "Two days old" says
    // nothing; "older than the evidence it was built from" says everything.
    stale: newestCaptureMs > 0 && mtimeMs < newestCaptureMs,
  };
}

function models() {
  /** @type {any[]} */
  const found = [];
  const add = (/** @type {any} */ dir, /** @type {any} */ label) => {
    if (!existsSync(dir)) return;
    const meta = modelSchema(dir);
    const report = readJson(join(dir, "training-report.json"));
    found.push({
      name: label,
      schema: meta?.representation ?? "(unstamped)",
      releasable: report?.releasable ?? null,
      acceptanceReport: existsSync(join(dir, "acceptance-report.json")),
      writtenMinutesAgo: existsSync(join(dir, "model.safetensors"))
        ? Math.round(minutesSince(statSync(join(dir, "model.safetensors")).mtimeMs)) : null,
    });
  };
  add(SHIPPED, "shipped");
  try {
    for (const entry of readdirSync(RUNS).filter((e) => e.startsWith("model-")).sort()) {
      add(join(RUNS, entry), entry);
    }
  } catch { /* no runs/ — reported by the caller as a skip */ }
  return found;
}

/** Which candidate, if any, could close an open schema migration. PURE. */
export function migrationVerdict(/** @type {any} */ migration, /** @type {any} */ modelList) {
  if (!migration) return { open: false };
  const pending = migration.pendingSchema;
  const shipped = modelList.find((/** @type {any} */ m) => m.name === "shipped");
  const candidates = modelList.filter((/** @type {any} */ m) => m.name !== "shipped" && m.schema === pending);
  return {
    open: true,
    pendingSchema: pending,
    shippedSchema: shipped?.schema ?? "(unknown)",
    openedAt: migration.openedAt,
    // A candidate carrying the pending schema is NECESSARY and not sufficient: the schema is a version
    // string, so it cannot tell a candidate trained on the current parse from one trained before an
    // announcement-grammar change that moved the features underneath the same version.
    candidatesWithPendingSchema: candidates.map((/** @type {any} */ c) => c.name),
  };
}

/**
 * Everything sitting under `runs/fetched/` — every point-in-time pull `lab:fetch`/`lab:collect-promotion`
 * has ever made, named `<out>.<artifact><ext>` by `lab-fetch.yml`. Reports existence and age ONLY; see this
 * file's header for why it does not attempt to map a name back to the lab path it came from.
 *
 * SORTED OLDEST FIRST, so the file most likely to be silently stale-and-trusted is the one printed first.
 */
export function fetchedArtifacts(/** @type {string} */ dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // no such directory is ordinary -- nothing has been fetched here yet
  }
  return entries
    .map((name) => {
      const stat = statSync(join(dir, name));
      return stat.isFile() ? { name, minutesAgo: Math.round(minutesSince(stat.mtimeMs)), bytes: stat.size } : null;
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.minutesAgo - a.minutesAgo);
}

function collect() {
  const datasetCaptures = join(RUNS, "screenreader-dataset/captures");
  const realPages = realCorpusRoot();
  const newestDataset = newestWrite(datasetCaptures);

  const dataset = readCorpus(datasetCaptures);
  const real = readCorpus(realPages);
  const modelList = models();

  return {
    corpus: {
      dataset: {
        captures: dataset.files,
        newestWrittenMinutesAgo: newestDataset ? Math.round(minutesSince(newestDataset)) : null,
        spread: environmentSpread(dataset.captures),
      },
      realPages: { captures: real.files, spread: environmentSpread(real.captures), ages: real.ages },
    },
    exports: [
      exportState(join(RUNS, "screenreader-dataset/screenreader-evidence.jsonl"), newestDataset),
      exportState(join(RUNS, "screenreader-dataset/with-realism.jsonl"), newestDataset),
      exportState(join(RUNS, "screenreader-acceptance/repeat-1.jsonl"), 0),
      exportState(join(RUNS, "screenreader-acceptance/repeat-2.jsonl"), 0),
    ],
    models: modelList,
    migration: migrationVerdict(readJson(MIGRATION), modelList),
    fetched: fetchedArtifacts(join(RUNS, "fetched")),
  };
}

/**
 * A report is READ, often through `| head` or `| grep`, and a closed pipe must not look like a crash.
 *
 * Node raises EPIPE as an unhandled `error` event on stdout and exits with a stack trace, so
 * `npm run lab:inventory | head` printed a `write EPIPE` dump under perfectly good output. A diagnostic
 * that appears to crash when you page it is one people stop running.
 */
process.stdout.on("error", (error) => {
  if (/** @type {any} */ (error).code !== "EPIPE") throw error;
  process.exit(0);
});

function line(text = "") {
  process.stdout.write(`${text}\n`);
}

function reportSpread(/** @type {any} */ label, /** @type {any} */ count, /** @type {any} */ spread) {
  const splits = splitFields(spread);
  line(`  ${label}: ${count} capture(s)`);
  if (!count) return;
  if (!splits.length) {
    line("    HOMOGENEOUS — every cache-key field holds one value across the corpus");
    return;
  }
  line(`    SPLIT across ${splits.length} field(s) — these captures are not comparable evidence:`);
  for (const { field, values } of splits) {
    const detail = Object.entries(values).sort((a, b) => b[1] - a[1])
      .map(([value, n]) => `${value}=${n}`).join("  ");
    line(`      ${field.padEnd(20)} ${detail}`);
  }
}

/**
 * WHERE this was read, and whether that place is the authority.
 *
 * Added because the first run of this tool lied by omission on its own author's laptop: it reported "NO
 * candidate carries it yet" — true of the local copy, and false on the lab, which holds a v15 candidate.
 * That is this repo's oldest rule pointed at a new tool: *a number is only as good as what it was
 * computed from, so make every reported number carry that.*
 *
 * The lab checkout is `/opt/a11y` (`group_vars/a11y_lab.yml: lab_repo_path`). Anywhere else is a copy,
 * and `runs/` is gitignored — so a local copy is only ever as fresh as its last sync, and is missing
 * `runs/model-*` entirely unless somebody fetched them.
 */
const LAB_REPO_PATH = "/opt/a11y";
const onTheLab = () => REPO.replace(/\/$/, "") === LAB_REPO_PATH;

function reportProvenance(/** @type {any} */ state) {
  line(`\nREAD FROM  ${RUNS}`);
  if (onTheLab()) {
    line("  This IS the lab, so these are the authoritative numbers.");
    return;
  }
  const oldest = state.corpus.dataset.newestWrittenMinutesAgo;
  line("  This is NOT the lab — `runs/` is gitignored, so this is a copy, only as fresh as its last sync,");
  line("  and it carries no `runs/model-*` unless somebody fetched them. Treat every count below as being");
  line("  about THIS MACHINE.");
  if (oldest !== null && oldest > 60) {
    line(`  Its newest capture is ${(oldest / 60).toFixed(1)} h old.`);
  }
  line("  The authoritative answer:  npm run lab:job -- -e job=inventory");
}

/**
 * `runs/fetched/` printed by NAME and AGE only — this file's header says why it stops there. NONE of
 * these is authoritative, and none of them refreshes itself: a fetch made hours ago and an export made
 * since sit side by side with nothing to tell them apart except the timestamp this prints. That is the gap
 * this section exists to close — see EXPORTS above and `lab:job -e job=inventory` for what to trust
 * instead of guessing from a filename.
 */
function reportFetched(/** @type {any[]} */ fetched) {
  line("\nFETCHED  (runs/fetched/ — point-in-time pulls from `lab:fetch`/`lab:collect-promotion`, never "
    + "refreshed after)");
  if (!fetched.length) {
    line("  (nothing fetched here)");
    return;
  }
  line("  NONE of these is authoritative, and a name here does not say which lab path or which export it");
  line("  came from — compare its age against EXPORTS above, or ask the lab: npm run lab:job -- -e job=inventory");
  for (const f of fetched) {
    line(`  ${f.name.padEnd(40)} ${(f.bytes / 1e6).toFixed(1)} MB, fetched ${f.minutesAgo} min ago`);
  }
}

/**
 * Refuse to report, and say which refusal it is. Returns an exit code, or null to carry on.
 *
 * IN FLUX and NOTHING TO READ are different answers and must not collapse into one: the first means
 * "ask again shortly", the second means "you are on the wrong machine".
 */
function refusal(/** @type {any} */ state) {
  // ASK THE RUN, DO NOT GUESS FROM THE CLOCK. This used to compare the newest capture's age against a ten
  // minute constant, which is the PROXY `corpus-settled.mjs` was written to replace and its header names
  // the failure exactly: "A capture that finished cleanly thirty seconds ago is settled, and the audit
  // refuses for another nine and a half minutes."
  //
  // Measured 2026-09-06, which is why this changed: a 1,645-case recapture finished with
  // `Result=success`, `finishedAt` written, 0 failed — and `lab:inventory` refused two minutes later with
  // IN FLUX. The corpus was not moving; the file was merely young. That refusal blocked the audit the run
  // had just been completed FOR.
  //
  // `corpusState` reads the run's own `finishedAt`/`updatedAt` and falls back to the clock only when a
  // copy carries no progress file — which is the honest use of the proxy rather than the primary test. It
  // also distinguishes ABANDONED, which the age comparison could never see: a run that died mid-write
  // ages past ten minutes and then reads as settled, so a half-written corpus was measured as a whole one.
  const settle = corpusState({ datasetRoots: [datasetRoot()], evidenceDirs: [runsRoot()] });
  if (settle.blocking) {
    line(`\n  ${settle.state === "abandoned" ? "ABANDONED" : "IN FLUX"} — ${settle.why}`);
    line("  Every count below would describe a state that has already changed, so this refuses to report");
    line("  one. Watch it with `npm run lab:status -- -e job=<name>`.");
    return 2;
  }
  if (!state.corpus.dataset.captures && !state.corpus.realPages.captures) {
    line("\n  SKIPPED: no captures under runs/ — this reads the corpus, and the lab holds it.");
    line("  `npm run lab:job -- -e job=inventory` asks the box that has it.");
    return 0;
  }
  return null;
}

function reportMigration(/** @type {any} */ state) {
  line("\nSCHEMA MIGRATION");
  if (!state.migration.open) {
    line("  none open — nothing here blocks release:gate.");
    return;
  }
  line(`  OPEN since ${state.migration.openedAt}: ${state.migration.shippedSchema} -> `
    + `${state.migration.pendingSchema}`);
  line("  release:gate refuses while this is open, and closing it means promoting weights stamped");
  line(`  ${state.migration.pendingSchema} and deleting schema-migration.json in the same commit.`);
  const ready = state.migration.candidatesWithPendingSchema;
  if (ready.length) {
    line(`  Candidate(s) already carrying it: ${ready.join(", ")}`);
  } else if (onTheLab()) {
    line("  NO candidate carries it yet — train one first.");
  } else {
    // The distinction that made this tool wrong on its first run. "None here" and "none anywhere" are
    // different answers, and reporting the first as the second is this repo's most-named defect.
    line("  No candidate HERE carries it — but this machine has no `runs/model-*` to speak of, so that");
    line("  says nothing about the lab. Ask it: npm run lab:job -- -e job=inventory");
  }
  if (ready.length) {
    line("  A matching schema is NECESSARY, not sufficient: it is a version string, so it cannot tell a");
    line("  candidate trained on the current parse from one trained before the grammar moved underneath it.");
    line("  Check the exports above are current before trusting any candidate.");
  }
}

function main() {
  const state = collect();

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    process.exit(0);
  }

  const declined = refusal(state);
  if (declined !== null) process.exit(declined);

  reportProvenance(state);
  line("\nCORPUS");
  reportSpread("dataset", state.corpus.dataset.captures, state.corpus.dataset.spread);
  reportSpread("real pages", state.corpus.realPages.captures, state.corpus.realPages.spread);
  if (state.corpus.realPages.captures) {
    for (const l of captureAgeLines(state.corpus.realPages.ages)) line(l);
  }
  if (state.corpus.dataset.captures && state.corpus.dataset.captures < PARTIAL_CORPUS) {
    line("    NOTE: too few captures to be the authoritative corpus — this looks like a partial copy.");
  }

  line("\nEXPORTS  (stale = older than the captures it was built from)");
  for (const e of state.exports) {
    if (!e.present) { line(`  ${e.path.padEnd(28)} MISSING`); continue; }
    line(`  ${e.path.padEnd(28)} ${e.stale ? "STALE" : "current"}  `
      + `${((e.bytes ?? 0) / 1e6).toFixed(1)} MB, written ${e.writtenMinutesAgo} min ago`);
  }

  line("\nMODELS  (schema is read from safetensors metadata, not from training-report.json)");
  for (const m of state.models) {
    line(`  ${m.name.padEnd(26)} ${String(m.schema).padEnd(30)}`
      + `${m.acceptanceReport ? "acceptance ✓" : "no acceptance report"}`);
  }

  reportFetched(state.fetched);

  reportMigration(state);
  line("");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
