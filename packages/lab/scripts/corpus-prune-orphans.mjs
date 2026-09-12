// @ts-check
// Captures on disk that NO declared page claims — named, classified, and only deleted when asked.
//
//   node scripts/corpus-prune-orphans.mjs            # report; touches nothing
//   node scripts/corpus-prune-orphans.mjs --apply    # delete only the ones it is safe to delete
//
// ## Why this exists
//
// `rules:real-pages` walks `runs/real-page-corpus` and scores every capture a `REAL_PAGES` entry claims.
// On 2026-09-07, 24 captures on disk were claimed by nothing at all. They were invisible: not scored, not
// reported, and — until the freshness line was fixed — counted into the "captures this scored" spread,
// where they made a 46-minute population read as 304 hours and made a clean refresh of every declared
// page appear to make things WORSE. Issue #143.
//
// A count could not answer it, and this is the file that names them.
//
// ## Two causes, and only ONE is safe to delete
//
// **RETIRED** — the publisher moved the page and the declaration followed; the old capture stayed.
// `historicenvironment.scot/visit-a-place/places/edinburgh-castle/` sits beside the declared
// `/visit/all/edinburgh-castle/`, same site, same page, old address. Nothing reads it. Deletable.
//
// **RELOCATED** — the capture IS of a declared page, reached at a different ORIGIN. Every fixture page is
// declared `http://localhost:5050/...` and captured `http://192.0.2.10:5050/...`, because a fleet worker
// cannot reach `localhost` (that resolves to itself). **These must never be deleted** — they are live
// evidence for five criteria, and deleting them would turn a matching bug into a data-loss bug and take
// 2.4.1, 2.4.2, 2.4.3, 2.1.1 and 1.4.13's only real-page grounding with it.
//
// Since #881 `realPageFor` reconciles the ordinary case itself -- a fixture captured at an IPv4 address on
// the declared port and path -- so those ten are no longer orphans and this tool never sees them. What can
// still reach RELOCATED is a page-server capture the matcher does not undo (a named host, another port),
// and the refusal to delete it stands exactly as before.
//
// AND "FIXTURE" IS THE DECLARATION'S ROLE, NOT ITS HOST (#940). The host is `FIXTURE_BASE`, which
// `DATASET_BASE_URL` overrides; deciding from the host alone made every fixture RETIRED -- deleted by
// `--apply` -- the moment that documented variable was set to a non-loopback address.
//
// So the classification is not decoration: it is the difference between tidying and destroying. Anything
// this cannot confidently call RETIRED is reported as UNCLASSIFIED and left alone.
//
// ## It reports by default, and that is not decorum
//
// `runs/` is gitignored and these captures are hours of worker time that cannot be recreated —
// `browserVersion` is a cache key precisely because Edge announces differently across releases, so
// evidence taken under Edge 151 cannot be re-made now 152 ships. `lab:reset` takes the same shape for the
// same reason, and the manual alternative is `rm`, which this repo has no undo for.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
// `pageServerFixtureAtPath` (and `isFixture` behind it) live in the corpus module (#881, #940), because
// `realPageFor` and the gate need them too: a declared FIXTURE is the ONLY case where a differing origin is explained rather than
// coincidental -- a fact about OUR serving arrangement, not something that can happen between two real
// publishers -- and three readers each holding their own copy of it is how they drift.
import {
  REAL_PAGES, realPageFor, pageServerFixtureAtPath,
} from "../src/training/real-page-corpus.mjs";
import { captureAgeLines } from "../src/training/real-page-freshness.mjs";
import { realCorpusRoot, refuseIfRunsReadonly } from "../src/dataset-paths.mjs";

/**
 * What to do with a capture no declared page claims.
 *
 * RELOCATED WINS over RETIRED, and the asymmetry is the whole safety property: a capture whose PATH
 * matches a declared page reached by another route is evidence of a page that is still declared, and
 * calling it retired would delete its only capture.
 *
 * BUT A PATH MATCH ALONE IS NOT THAT EVIDENCE, and the first version of this got it wrong on real data.
 * Run against the authoritative corpus it called `www.nationalarchives.gov.uk/about/` RELOCATED, because
 * the declared `www.gov.scot/about/` shares the path `/about`. **Two unrelated publishers, one ordinary
 * path.** The capture is a genuinely retired nationalarchives URL and the classification said it was a
 * live page reached another way.
 *
 * It failed in the SAFE direction — refusing to delete something it should have offered — which is why it
 * survived the unit tests: every fixture there used paths no other page has. The defect was only visible
 * against 99 real declarations, which is the argument for running a destructive tool in report mode on
 * the real corpus before trusting any of its verdicts.
 *
 * So the origin difference must be EXPLAINED, not merely present. It is explained in exactly one case:
 * the declared page is one of our own fixtures. Between two real hosts, the host IS the identity.
 *
 * WHICH DECLARATIONS ARE FIXTURES IS DECIDED BY `isFixture` -- the page's `role`, with its host a second
 * signal -- and never by the host alone (#940). This used to ask only whether the declaration's host was
 * loopback, and that host comes from `DATASET_BASE_URL`: with it set to any non-loopback address, all ten
 * fixture captures came back RETIRED and `--apply` deleted them.
 *
 * ASKED THROUGH `pageServerFixtureAtPath`, the gate's own lookup: is ANY declaration at this path a fixture.
 * A `path -> page` Map here let the last declaration at a shared path decide, which could call a fixture
 * RETIRED while the gate called it RELOCATED.
 *
 * @param {string} url the capture's own url
 * @param {readonly { url: string, role?: string }[]} declared every declared page
 */
export function classifyOrphan(url, declared) {
  if (pageServerFixtureAtPath(url, declared)) {
    return { verdict: "RELOCATED", why: "a declared fixture reached at another origin — see #146, #940; NOT deletable" };
  }
  if (/^https?:\/\//i.test(url)) {
    return { verdict: "RETIRED", why: "no declared page has this url or its path; the declaration moved and this stayed" };
  }
  // A capture with no usable url at all. Rare, and not something to guess about.
  return { verdict: "UNCLASSIFIED", why: "no usable url in the capture, so nothing can be concluded" };
}

/**
 * WHEN each capture this walked was taken — so the report says which corpus it is describing.
 * @type {{ at: string, role: string }[]}
 */
const AGES = [];

/** Every capture on disk that `realPageFor` does not match, with its file, url and verdict. */
export function orphans(root = realCorpusRoot()) {
  const out = [];
  for (const file of readdirSync(root).sort()) {
    if (!file.endsWith(".json")) continue;
    let url;
    try {
      const parsed = JSON.parse(readFileSync(join(root, file), "utf8"));
      url = String((parsed.capture ?? parsed)?.url ?? "");
      if (typeof parsed.capturedAt === "string") {
        AGES.push({ at: parsed.capturedAt, role: parsed.role ?? "no role recorded" });
      }
    } catch {
      // A file that will not parse is not an orphan, it is a damaged capture — a different question, and
      // deleting it on this command's authority would be answering one with the other.
      out.push({ file, url: "", ...classifyOrphan("", REAL_PAGES), unreadable: true });
      continue;
    }
    if (realPageFor(url)) continue;
    out.push({ file, url, ...classifyOrphan(url, REAL_PAGES) });
  }
  return out;
}

/** @param {{file: string, url: string, verdict: string, why: string}[]} found @param {boolean} apply */
function report(found, apply) {
  /** @param {string} v */
  const by = (v) => found.filter((o) => o.verdict === v);
  process.stdout.write(`\n# captures no declared page claims, under ${realCorpusRoot()}\n`);
  process.stdout.write(`  ${found.length} orphan(s): ${by("RETIRED").length} RETIRED, `
    + `${by("RELOCATED").length} RELOCATED, ${by("UNCLASSIFIED").length} UNCLASSIFIED.\n`);
  process.stdout.write(`  ${REAL_PAGES.length} page(s) declared in REAL_PAGES.\n`);
  // WHICH CORPUS THIS IS, before the list. A prune report read a week later, or read on a laptop whose
  // `runs/` is as fresh as its last sync, describes a set that may no longer exist — and this command's
  // whole output is a list of files somebody may be about to delete.
  process.stdout.write(`${captureAgeLines(AGES).join("\n")}\n\n`);
  for (const verdict of ["RELOCATED", "UNCLASSIFIED", "RETIRED"]) {
    const rows = by(verdict);
    if (!rows.length) continue;
    process.stdout.write(`  ${verdict} (${rows.length}) — ${rows[0].why}\n`);
    for (const row of rows) process.stdout.write(`      ${row.file}\n        ${row.url || "(no url)"}\n`);
    process.stdout.write("\n");
  }
  if (!apply) {
    process.stdout.write("  Nothing was deleted. Re-run with --apply to remove the RETIRED ones only.\n"
      + "  RELOCATED captures are NEVER deleted: they are declared pages reached at another origin (#146),\n"
      + "  and they are the only real-page grounding five criteria have.\n"
      + "  AFTERWARDS, re-run `rules:real-pages` and compare: a page silently leaving the corpus is how a\n"
      + "  gate goes quiet, so the findings must be identical either side.\n");
  }
}

function main() {
  refuseUnknownFlags(["--apply"], { entry: import.meta.url, command: "corpus-prune-orphans" });
  const apply = process.argv.includes("--apply");
  const found = orphans();
  report(found, apply);
  if (!apply) return;

  const deletable = found.filter((o) => o.verdict === "RETIRED");
  if (!deletable.length) {
    process.stdout.write("  Nothing classified RETIRED, so nothing was deleted.\n");
    return;
  }
  const root = realCorpusRoot();
  // A11Y_RUNS_READONLY IS HONOURED BEFORE THE FIRST DELETE, not per file: a run that removed six captures
  // and then refused would leave the corpus in a state neither the operator nor the report describes.
  // This is the one command here that destroys evidence, so it is the last place to discover the flag.
  refuseIfRunsReadonly(join(root, deletable[0].file));
  for (const row of deletable) {
    rmSync(join(root, row.file));
    process.stdout.write(`  deleted  ${row.file}\n`);
  }
  process.stdout.write(`\n  ${deletable.length} capture(s) deleted. NOW RE-RUN \`rules:real-pages\` and compare\n`
    + "  the findings against the run before this one. They must be identical.\n");
}

// `pathToFileURL`, never a template literal: concatenation does not percent-encode, so a path with a
// space would make this guard silently never fire.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
