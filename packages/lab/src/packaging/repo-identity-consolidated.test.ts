/**
 * THIS REPOSITORY'S OWN NAME IS WRITTEN OUT BY HAND IN ~30 PLACES ACROSS ~25 FILES — issue #92, #63's third
 * silent breakage. GitHub redirects the old URL after an org move, so every one of these keeps WORKING
 * while pointing at a name we no longer own, and the gap is found weeks later by someone wondering why a
 * link is dead or a deploy pulled nothing.
 *
 * `scripts/repo-identity.mjs` is the one declared value now. `board-data.mjs` and `row-claim.mjs` import it
 * at runtime and are no longer literals — this file is about the ones that CANNOT import anything:
 * `package.json` `repository` fields, workflow strings, Ansible defaults, and prose. Each is asserted
 * against a constant from `repo-identity.mjs`, so a rename is one edit there plus a single failing test
 * listing every site that still disagrees — never a silent partial rename found later.
 *
 * TWO CONSTANTS, NOT ONE, SINCE #66 (2026-09-07). `REPO` is where `gh`/git actually resolve TODAY — it
 * stays `DanBeckDev/a11y-witness` until #63 really transfers the repository, because every live GitHub
 * API call (`row-claim.mjs`, `board-data.mjs`) would break the instant it named a repository that does
 * not exist yet. `PRODUCT_REPO` is what the product calls itself NOW — `a11ign/a11ign` — and almost every
 * site below checks against it, since #66 renamed the tree's own static prose ahead of the transfer. The
 * sites that must still resolve on GitHub today (every `uses: <repo>@<ref>` Action reference) are the
 * one exception and check `REPO` instead; see `repo-identity.mjs`'s own comment on the split.
 *
 * #569 MOVED THE TWO README BADGE SITES INTO THAT SAME EXCEPTION. #66 classed them with "static prose" --
 * the reasoning that put clone instructions and `package.json` fields under `PRODUCT_REPO` -- but a badge
 * is not prose a reader interprets and forgives; it is an image a browser FETCHES the instant the page
 * renders, before any of the surrounding text explaining the rename is read. The V1 rehearsal found this
 * exactly the way it found the `uses:` line's own #325-era mistakes: reading the document as a stranger
 * would and following what it actually points at, not what it says about itself. `https://github.com/
 * a11ign/a11ign` 404s until #63 lands, so the badges belong with `REPO`, not `PRODUCT_REPO` -- the same
 * "must resolve on GitHub today" test `action-reference.test.ts` already applies to the `uses:` line, one
 * exception wider.
 *
 * WHY A FLAT LIST RATHER THAN A REPO-WIDE REGEX SWEEP. A sweep would need to tell a genuine reference to
 * THIS repository apart from an unrelated `owner/repo`-shaped string (a different project entirely, an
 * example in prose) — the same false-positive risk this project's own leak sweeps have hit repeatedly. A
 * named list is exactly what `backlog-file-facts.test.ts` and `documented-criteria.test.ts` already do for
 * the identical reason: each site is a deliberate claim about ONE place, not a pattern guessed to cover all
 * of them, so a new reference someone adds is invisible here until it is added to this list on purpose —
 * the same trade this repo makes everywhere it already prefers a named check over a blanket one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO, REPO_URL, REPO_GIT_URL, PRODUCT_REPO, PRODUCT_REPO_URL, PRODUCT_GIT_URL }
  from "../../../../scripts/repo-identity.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/**
 * Every literal site the 2026-09-06 audit found, one entry per DISTINCT textual form in that file — some
 * files carry the repo's name in more than one shape (README.md has both a badge URL and an Action
 * `uses:` line) and each shape gets its own entry rather than one loosely-matching pattern per file.
 */
// #647: THE QUESTION A NEW ENTRY MUST ANSWER, ASKED HERE SO IT CANNOT BE SKIPPED.
//
// "Does something -- a human copying a command verbatim, or a machine with no human in the loop --
// RESOLVE this URL as a normal, unmediated step of using this repository TODAY, before the transfer?"
// If yes: REPO. If the site is prose a reader reads, interprets and would naturally substitute the
// current name into (a name mentioned in passing, a metadata field nobody automatically visits, a
// hyperlink a reader consciously chooses to click and can recover from if it 404s): PRODUCT_REPO is
// correct, and stays correct until the transfer catches up to it.
//
// This is NOT a human-vs-machine test on its own -- a badge's `<img src>` is auto-fetched by GitHub's
// renderer with no human choice involved, but so is `git clone <url>` when a reader follows a getting-
// started guide's own literal first step verbatim; both fail exactly the same way, silently, for exactly
// the same reason. What both share, and what a clicked hyperlink to a security-advisory form does NOT,
// is that nothing in between the text and the resolution attempt is a DECISION -- copy-paste-execute has
// no interpretive step for a reader to notice the org does not exist yet and substitute the real name.
//
// Found by AUDITING every site the 2026-09-06 classification pass produced against this question, not by
// re-deriving the population -- #643 (`worker_repo_url`, an `ansible`-executed git clone target) and #569
// (README's badge images) were the two known instances that prompted this row; auditing the remaining
// ~28 turned up FOUR MORE of the identical shape, all copy-paste-execute bootstrap commands in getting-
// started guides (`git clone`, `curl -fsSL ... | bash`, `irm ... | iex`) that #66's original pass filed
// under "clone instructions" -- correctly grouped with badges as PRODUCT_REPO territory in general, but
// wrong for these specific instances because, like the badges, they are executed without a reader ever
// being asked to notice the substitution.
const SITES: Array<{ file: string; expect: string }> = [
  // #569: AUTO-FETCHED by GitHub's own renderer the instant anyone views this page -- the same "must
  // resolve today" shape as the `uses:` line two lines down, not the static prose PRODUCT_REPO covers.
  { file: "README.md", expect: `${REPO_URL}/actions/workflows/lint.yml/badge.svg` },
  { file: "README.md", expect: `${REPO_URL}/actions/workflows/capture-regression.yml/badge.svg` },
  { file: "README.md", expect: `uses: ${REPO}@main` },
  // A hyperlink a reader consciously clicks, and can recover from (try another reporting channel) if it
  // 404s -- PRODUCT_REPO stands, per the header question above.
  { file: "SECURITY.md", expect: `${PRODUCT_REPO_URL}/security/advisories/new` },
  // COPY-PASTE-EXECUTE: `bash <(curl -fsSL <url>)` on the line right below this URL. A reader follows the
  // control-plane setup guide's literal step, verbatim; nothing prompts them to notice the org is not
  // live yet.
  { file: "docs/control-plane-proxmox.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-control-plane.sh" },
  { file: "docs/backlog-ready.md", expect: `${PRODUCT_REPO_URL}/issues` },
  { file: "docs/try-it.md", expect: `uses: ${REPO}@main` },
  // COPY-PASTE-EXECUTE: the getting-started guide's own literal step 1 (`git clone <url>`, then `cd` into
  // the directory that command actually creates).
  { file: "docs/getting-started.md", expect: `git clone ${REPO_URL}.git` },
  { file: "docs/getting-started.md", expect: "cd a11y-witness" },
  { file: "docs/getting-started.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-windows-worker.ps1" },
  { file: "docs/github-action.md", expect: `uses: ${REPO}@main` },
  { file: "docs/github-action.md", expect: `uses: ${REPO}@<sha>` },
  // REPO, not PRODUCT_REPO -- docs/backlog.md is one of #66's explicit exclusions (historical narrative,
  // never rewritten to match the present), so this link correctly still points at the pre-rename repo.
  { file: "docs/backlog.md", expect: `${REPO_URL}/issues` },
  { file: "docs/nvda-worker-runbook.md",
    expect: `raw.githubusercontent.com/${REPO}/main/packages/worker-fleet/src/provisioning/`
      + "bootstrap-windows-worker.ps1" },
  // NOT `docs/board/README.md`'s own `--repo` line -- DELIBERATELY, #647. The functional defect the old
  // entry here was pinning (a documented `gh --repo a11ign/a11ign` command that would have failed for
  // anyone who pasted it) was already fixed by removing the `--repo` argument entirely; the file's only
  // remaining occurrence of the literal is PROSE recounting that fix ("This line carried `--repo
  // a11ign/a11ign`..."), which the old `expect` string matched by coincidence -- the identical "a mention
  // is not a use" shape `docs/board/reported.json`'s exclusion below already documents. Nothing here is
  // executed, requested or followed; re-adding a pinned literal would verify the prose still narrates the
  // fix rather than that any live reference still agrees with `repo-identity.mjs`.
  // NOT `docs/board/reported.json` -- DELIBERATELY, issue #283. It carried this literal once, inside one
  // achievement's evidence prose ("GitHub Issues and milestones on DanBeckDev/a11y-witness" -- quoting
  // the achievement's actual wording at the time, before #66; not rewritten to match the present), and #270
  // correctly retired that achievement once its cited issue closed. Unlike every other site in this list,
  // the mention was INCIDENTAL rather than functional: nothing here is executed, requested or followed --
  // it is authored, narrative content that turns over daily as achievements are added and retired, and
  // the repo's name was never load-bearing in it. Re-adding a literal (in a NEW field, purely to satisfy
  // this test) would be content whose only purpose is to make a grep pass -- a smaller version of exactly
  // the fabrication `reported.json`'s own header exists to prevent, and it would leave this test *looking*
  // like it verifies something real about a file that does not depend on the repo's name at all. If a
  // future field in this file is ever actually CONSUMED under the repo's name (a computed URL, a value fed
  // to `gh --repo`), add it back as a live site then -- not as a standing anchor with no functional reader.
  { file: "docs/roles/memory/github-is-the-tracker.md", expect: `GitHub Issues on ${PRODUCT_REPO}` },
  { file: "docs/roles/README.md", expect: `\`${PRODUCT_REPO}\`` },
  { file: "docs/roles/memory/org-shape-second-orchestrator.md", expect: `a Project on ${PRODUCT_REPO}` },
  { file: "examples/workflow.yml", expect: `uses: ${REPO}@main` },
  { file: "packages/nvda-worker/package.json", expect: PRODUCT_GIT_URL },
  // COPY-PASTE-EXECUTE, same shape as docs/getting-started.md above.
  { file: "packages/nvda-worker/src/README.md", expect: `git clone ${REPO_URL}.git` },
  { file: "packages/nvda-worker/src/README.md", expect: "cd a11y-witness" },
  { file: "packages/worker-fleet/package.json", expect: PRODUCT_GIT_URL },
  { file: "packages/evidence/README.md", expect: `(${PRODUCT_REPO_URL})` },
  { file: "packages/evidence/package.json", expect: PRODUCT_GIT_URL },
  { file: "packages/cli/package.json", expect: PRODUCT_GIT_URL },
  { file: "packages/cli/README.md", expect: `uses: ${REPO}@main` },
  { file: "packages/scorer/package.json", expect: PRODUCT_GIT_URL },
  { file: "packages/judge/package.json", expect: PRODUCT_GIT_URL },
  // OPERATIONAL, not documentary (#604) -- so REPO, exactly like the `uses:` lines above and for a
  // stronger reason. This value is handed to `git clone` on a box being provisioned; it is not something
  // a human reads and updates. It was classified as a PRODUCT_REPO site by the 2026-09-06 audit, which
  // is a decision rather than an oversight, and this changes the decision: a badge that 404s is a broken
  // image, while this 404s the provisioning of a new worker. `fleet:deploy` pulls into a checkout the
  // guest already has, so the fleet runs and only GROWING it fails -- invisible until somebody needs
  // capacity, which is the worst shape a configuration fault can have.
  { file: "packages/control/ansible/roles/worker/defaults/main.yml",
    expect: `worker_repo_url: ${REPO_GIT_URL}` },
  { file: "packages/control/ansible/collections/ansible_collections/a11y/worker/galaxy.yml",
    expect: `repository: ${PRODUCT_REPO_URL}` },
  { file: ".github/ISSUE_TEMPLATE/config.yml", expect: `${PRODUCT_REPO_URL}/security/advisories/new` },
  { file: ".github/ISSUE_TEMPLATE/config.yml", expect: `${PRODUCT_REPO_URL}/blob/main/README.md#licence` },
];

test("every literal site still names this repository, agreeing with repo-identity.mjs", () => {
  const bad: string[] = [];
  const cache = new Map<string, string>();
  for (const { file, expect } of SITES) {
    let text = cache.get(file);
    if (text === undefined) {
      text = readFileSync(path.join(ROOT, file), "utf8");
      cache.set(file, text);
    }
    if (!text.includes(expect)) bad.push(`${file}: does not contain "${expect}"`);
  }
  assert.deepEqual(bad, [],
    "these sites disagree with repo-identity.mjs -- either they were not updated when the name last "
    + `changed, or this list itself has drifted from what the files actually say. Most sites check `
    + `PRODUCT_REPO ("${PRODUCT_REPO}"), the name the product now uses in its own static prose; the `
    + `\`uses:\` Action-reference sites check REPO ("${REPO}") instead, since #66 deliberately keeps `
    + "those resolving on GitHub today until #325 moves the repository:\n" + bad.join("\n"));
});

test("the vacuity guard: this list is not empty and each file it names exists", () => {
  assert.ok(SITES.length >= 30, `only ${SITES.length} sites declared -- the 2026-09-06 audit found ~30; `
    + "a shrunk list examining less than the audit found would pass by looking at fewer things, not by "
    + "the repository needing fewer references fixed");
  const files = [...new Set(SITES.map((s) => s.file))];
  for (const file of files) {
    assert.doesNotThrow(() => readFileSync(path.join(ROOT, file), "utf8"),
      `${file} is named in SITES but does not exist -- a renamed or deleted file leaves a stale entry `
      + "that can never fail honestly");
  }
});

test("board-data.mjs and row-claim.mjs DERIVE the name rather than restating it as a literal", () => {
  // The two runtime consumers this repo already had. Checked by IMPORT rather than by literal, because
  // that is the whole point of the split: these two no longer carry a copy for repo-identity-drift to
  // catch, and a test asserting a literal here would be re-introducing the duplicate this row removes.
  for (const file of ["scripts/board-data.mjs", "scripts/row-claim.mjs"]) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    assert.match(text, /from ["']\.\/repo-identity\.mjs["']/,
      `${file} must import REPO from repo-identity.mjs rather than declaring its own copy`);
    assert.ok(!new RegExp(`["']${REPO.replace(/[/.]/g, "\\$&")}["']`).test(text),
      `${file} still declares the repository name as its own string literal`);
  }
});
