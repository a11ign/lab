/**
 * ENTERING THE CONTROL PLANE'S CHECKOUT IS DISCOVERED BY THE OPERATION, NOT BY THE NAME — because four
 * sweeps by three sessions searched for the name and none of them found the literal that took the fleet
 * down.
 *
 * On 2026-09-08 every fleet play was unreachable. `fleet-playbook.mjs` held `const CHECKOUT = "a11ign"`,
 * moved there by `e435ac17` (the product rename), and `deploy`, `provision`, `recover`, `wake`,
 * `inventory-install` and `control-host-install` all route through it — so each one `cd`-ed into a
 * directory that does not exist. `lab-pipeline.mjs` held the SAME fact as `"/root/a11y-witness"`, and
 * #531 restored that one and missed this one.
 *
 * ## #585: AND THEN THIS GUARD MISSED ONE, FOR THE REASON IT WAS WRITTEN TO FIX
 *
 * The first version of this file keyed on the OPERATION rather than the name, which is right. Its
 * IMPLEMENTATION was narrower than that reasoning in three independent ways, and a third literal for
 * the control plane's checkout sat in `bootstrap-control-plane.sh` invisible to it:
 *
 *     :37    REPO_PATH="${A11Y_REPO_PATH:-$HOME/a11ign}"
 *     :103   git -C "$REPO_PATH" pull --ff-only
 *     :109   cd "$REPO_PATH"
 *
 *   - the walk was `.mjs` and `.ts` ONLY, so a `.sh` was not in the population at all;
 *   - `cd` had to be preceded by a BACKTICK, because the pattern was written for a JavaScript template
 *     literal — so a shell's own `cd "$REPO_PATH"` would not have matched even if the file were walked;
 *   - `git -C` and `git clone <url> <dir>` enter a directory as surely as `cd` does, and were unknown.
 *
 * **A pattern that names a language answers about that language.** That is the same criticism this file
 * levels at a grep for a value, committed inside the guard written against it — `dispatcher` grepped a
 * value, `ceo` scoped to a directory, the orchestrator read one language, and I keyed on JavaScript
 * syntax AROUND an operation and called it operation-keyed.
 *
 * ## So it now asks TWO questions, because one of them could not reach that literal
 *
 *   **Who ENTERS the checkout** — `cd`, `--working-directory=`, `git -C`, `git clone <url> <dir>`, in
 *   any language. Catches a use whose literal lives elsewhere (`cd ${CHECKOUT}`).
 *
 *   **Who NAMES a directory directly under a home root** — `/root`, `$HOME`, `~`, `%USERPROFILE%`,
 *   `$env:USERPROFILE`. Catches the literal itself, which is where `REPO_PATH=` hid: the assignment is
 *   not an operation, and no amount of operation-keying reaches it.
 *
 * Neither question subsumes the other, which is why both are here.
 *
 * ## The boundary, and it is a real one
 *
 * A path under a home root is not automatically THIS machine's. `docs/local-worker-vm.md` names
 * `C:/Users/user/a11ign/` for the deprecated local UTM VM under a placeholder account; nobody has
 * measured that box, and a guard demanding a value for it would be the guess #515 forbids arriving
 * through a guard. Walking `.sh` files brings more of these in, not fewer — they are full of paths
 * belonging to machines outside this fleet. So a segment is either the declared value or CLASSIFIED
 * with the reason it is somebody else's.
 *
 * ## Why a fifth sweep would not have worked either
 *
 * Every earlier search was for a VALUE: `/root/a11ign`, then `packages/`-scoped, then the SSH-key
 * filename. **A grep for a value cannot match the same value in a different shape** — bare, absolute, or
 * embedded in a `cd`. It was found by a play failing.
 *
 * So this test discovers the OPERATION. A name may take any shape; entering a directory takes exactly
 * two forms in this tree — a `cd` in a command string, and `systemd-run --working-directory=`. Every one
 * of them is found and must either interpolate `control-plane-checkout.mjs`'s export or be classified
 * with a reason. A new consumer that writes its own literal fails here by name.
 *
 * ## And the two green checks that could not see it
 *
 * `win_ping` was green 9 of 9 and `fleet:status` passed while every play was unreachable, because
 * NEITHER GOES THROUGH `CHECKOUT` — one is an ansible ping over SSH, the other reads `/health` over
 * HTTP. This repository's own rule is that a verification sharing no failure mode with the action
 * verifies nothing; here two of them said green at once. The acceptance for the fix is therefore
 * `fleet:deploy` reaching the boxes, which is the only thing that traverses the path under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/** The one module that may know the directory's name. */
const SOURCE_OF_TRUTH = "packages/control/src/control-plane-checkout.mjs";

/**
 * Entering a directory, in the two forms this tree uses: a `cd` inside a command string, and
 * `systemd-run --working-directory=`. Comments are stripped first — `local-judge.paths.test.ts`
 * discusses a `cd /tmp` in prose, and a file that DESCRIBES entering a directory has not entered one.
 */
const ENTERS_A_DIRECTORY = new RegExp([
  // `cd <dir>`, in ANY language. No backtick: the first version required one, because it was written
  // for a JS template literal, and a shell's own `cd "$REPO_PATH"` therefore never matched.
  String.raw`(?:^|[\s\`"'(])cd\s+([^\s\`"'&;|]+)`,
  String.raw`--working-directory=(\S+)`,
  // `git -C <dir>` and `git clone <url> <dir>` enter a directory as surely as `cd` does. The literal
  // this guard missed was reached by both.
  String.raw`git\s+-C\s+(\S+)`,
  String.raw`git\s+clone\s+(?:--\S+\s+)*\S+\s+(\S+)`,
].join("|"), "g");

/**
 * A directory named DIRECTLY under a home root. The second question, and the one that reaches a literal
 * an operation never touches: `REPO_PATH="${A11Y_REPO_PATH:-$HOME/a11ign}"` is an assignment, so no
 * amount of operation-keying finds it. Five spellings of "home", because a `.sh`, a `.ps1` and a `.cmd`
 * each write it differently.
 */
const UNDER_A_HOME_ROOT = /(?:\/root|\$HOME|~)[/\\]{1,2}([A-Za-z0-9._-]+)/g;

/**
 * The DIRECTORY a `cd` actually enters, past any flags. `guest-run.mjs` writes `cd /d ${GUEST_DIR}` —
 * `/d` is cmd.exe's cross-drive flag, and a first draft of this guard read it as the directory and
 * reported the site as entering `/d`. **A guard fooled by a flag is the same shape-blindness that made
 * every earlier sweep miss `const CHECKOUT = "a11ign"`**, committed inside the guard written against it.
 */
function directoryEntered(argument: string): string {
  const tokens = argument.trim().split(/\s+/).filter((t) => t.length > 0);
  // ANCHORED AT BOTH ENDS. Unanchored, `/[a-zA-Z]` matches the start of `/root` too, so the ssh
  // wrapper's own landing directory was dropped as though it were a flag and the population silently
  // shrank by one. A pattern that matches more than it names is how this guard would come to examine
  // less than it believes -- the failure it exists to catch, one level down.
  return tokens.find((t) => !/^(\/[a-zA-Z]|--?[a-zA-Z][\w-]*)$/.test(t)) ?? "";
}

/**
 * A site is SAFE when the thing it enters interpolates one of the source of truth's exports — matched by
 * the exported NAMES rather than by the value, since the value is exactly what a rename moves.
 */
const EXPORTED_NAMES = ["CONTROL_PLANE_CHECKOUT", "CONTROL_PLANE_CHECKOUT_PATH"];

/** The checkout's NAME, read out of the source of truth rather than repeated here. */
const CHECKOUT_NAME = /export const CONTROL_PLANE_CHECKOUT = "([^"]+)"/
  .exec(readFileSync(`${REPO}${SOURCE_OF_TRUTH}`, "utf8"))?.[1] ?? "";

/**
 * Every site that enters a directory which is NOT the control plane's checkout, each with the reason.
 * A site reaching this list is a decision; a site reaching neither this list nor the source of truth is
 * a FAILURE BY NAME, so "a different directory" and "somebody wrote a second literal" stay different
 * states — which is the distinction that would have caught the outage.
 */
const NOT_THE_CONTROL_PLANE_CHECKOUT: Record<string, string> = {
  "/root": "the ssh wrapper's landing directory in `fleet-playbook.mjs`, not the checkout — it is what "
    + "makes the checkout's own `cd` relative, and it is the ssh user's home rather than a path anybody "
    + "renamed",
  "cd": "prose ABOUT the command, in a README's `cd` into ...` sentence -- the pattern catches the word "
    + "following `cd`, and here that word is the next literal in the sentence rather than a directory",
  "repo": "a PLACEHOLDER in `docs/roles/README.md`'s instructions, the shape `<repo>` would have if the "
    + "author had written the angle brackets",
  "checkout": "the same, one line down",
  "a11y-witness/packages/control/ansible": "the copy-paste runbook in `packages/control/ansible/"
    + "README.md`, restored by #554. It names the directory LITERALLY and must: a human pastes it into "
    + "a shell, and a shell cannot import a constant. It is in this list rather than derived, so a "
    + "reader can see that the duplication was decided rather than missed.",
  "$RepoPath": "the WINDOWS worker's checkout, in `stamp-provision-revision.ps1` -- a different "
    + "machine's directory, guarded by `guest-paths-are-measured.test.ts` against a MEASUREMENT taken "
    + "on three real guests (#584). Not this file's fact.",
  "${GUEST_DIR}": "the WINDOWS worker's checkout in `guest-run.mjs` (`C:\\Users\\witness\\...`), a "
    + "different machine's directory. It is the same class as this one and is deliberately NOT fixed "
    + "here: nobody has run `win_stat` against those nine boxes, and restoring a name on sight is the "
    + "act #515 was filed against. Held on #526.",
};

/**
 * This file, excluded from its own walk — the device `git-population-vacuity.test.ts` and
 * `fleet-key-name-is-one-fact.test.ts` both use, for the same reason.
 *
 * `ENTERS_A_DIRECTORY` contains the literal text `--working-directory=(\S+)`, so the pattern matches its
 * own definition and this file reports itself as entering `(\S+)/g;`. The honest classification would be
 * "this is the pattern, not a use of it", which is true and is also a file writing its own exemption
 * into the list it maintains.
 *
 * **AND IT PASSED LOCALLY WHILE FAILING IN CI, for the reason I had documented an hour earlier and then
 * walked into.** `git ls-files` cannot see an UNTRACKED file, so every local run before `git add`
 * examined a population that did not contain this file. CI reads a commit. Run a discovery guard again
 * after committing it — the first run is the one that tells you nothing.
 */
const SELF = "packages/lab/src/packaging/control-plane-checkout-is-one-fact.test.ts";

/**
 * Named files, not a directory -- exempted for the identical reason SELF is, and kept exact rather than
 * a prefix on purpose: "the exemption is the FIELD, not the FILE" above already rejected the broader
 * directory-wide shape once, and a fixtures/ prefix would be that same trade again, one level up.
 *
 * `owned-path-signoff.test.ts`'s fixtures are real PR bodies fetched verbatim (`gh pr view --json body`,
 * #603) so that predicate is verified against text nobody wrote for the test. #584's own body quotes a
 * home-root literal from this file's own subject, one PR before this file existed -- editing the fixture
 * to dodge this guard would make it describe a body nobody actually posted.
 */
const QUOTED_FIXTURE_FILES = new Set([
  "packages/lab/src/packaging/fixtures/pr-584-body.md",
  "packages/lab/src/packaging/fixtures/pr-613-body.md",
]);

/**
 * A RECORD OF THE PAST IS NOT CODE, AND IT IS NOT RENAMED — BUT THE EXEMPTION IS THE FIELD, NOT THE FILE.
 *
 * `docs/board/reported/` holds what an operator actually ran and what it actually printed. One record
 * carries
 *
 *     "command": "ssh <control-plane> 'cd <the control-plane checkout> && git merge --ff-only origin/main'"
 *
 * which is a real `cd` and cannot interpolate anything: it is a quotation, already redacted to
 * placeholders, and editing it would make the record describe a command **nobody ran**. This repository
 * has produced that defect once already — the rename sweep rewrote ten recorded capture URLs (#534) and
 * an npm error transcript quoted in `packages/scorer/tsconfig.json`, both restored to what was recorded.
 *
 * ## Why the exemption is keyed on the FIELD and not the directory
 *
 * The first version of this skipped the whole of `docs/board/reported/`, and that was wrong in a way
 * worth writing down because it *looked* narrow. **It is narrow relative to `docs/`; it is not narrow
 * relative to the record.** A path rule exempts every field a record will ever have — including a future
 * one that genuinely IS a path a tool reads, an artefact location or an output directory. Under it the
 * guard would already be silent about that field and nobody would find out.
 *
 * So the transcript FIELDS are skipped and everything else in the record is still scanned. The coupling
 * that objection avoids — the guard knowing the record's schema — is exactly what makes the exemption
 * narrow: **precision was the thing being traded away, on a guard whose whole value is precision.**
 *
 * A record that cannot be parsed is scanned WHOLE. Failing closed is the only safe direction: a malformed
 * record that silently exempted itself would be an escape hatch anybody could open with a typo.
 *
 * ## The line this is the third instance of
 *
 * **A guard keyed on an OPERATION will find that operation in prose, in records, and on other people's
 * machines, and each of those needs a DIFFERENT answer.** Three today, all of them the guard working:
 * the `.ps1` home roots belonged to the Windows guests and were scoped out (two fleets, two facts); the
 * deprecated local VM's path belongs to a machine nobody has measured, where demanding a value would be
 * the guess #515 forbids arriving through a guard; and this is a quotation, where the only correct edit
 * is none. A guard that answered all three the same way would be wrong three times.
 *
 * ## And the finding that outlives the keying
 *
 * **A pin asserting the wrong half is indistinguishable from a working one until something breaks the
 * half it does not watch.** The first escape-hatch test here asserted that the same text in a SOURCE file
 * is still found — which proves the boundary is not UNLIMITED and says nothing about whether it is
 * NARROW. `npm run mutate`, widening it, reported `THE GUARD DID NOT BITE`. Only the third assertion
 * below — a `cd` in ordinary documentation is still a site to classify — makes a widening fail, and it is
 * needed under either keying.
 */
const RECORDS_DIR = "docs/board/reported/";

/** The fields of a reported record that hold QUOTED text rather than anything this repository executes. */
const TRANSCRIPT_FIELDS = new Set(["command", "stdout", "stderr", "transcript", "output"]);

/**
 * A record's source with its transcript field VALUES removed, so every other field is still scanned.
 * Anything outside `RECORDS_DIR`, and any record that will not parse, is returned untouched.
 *
 * @param {string} file @param {string} source
 * @returns {string}
 */
export function withoutQuotedTranscripts(file: string, source: string): string {
  if (!file.startsWith(RECORDS_DIR)) return source;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return source;   // fail CLOSED: an unparseable record is scanned whole, never exempted
  }
  const kept: string[] = [];
  const walk = (value: unknown, key: string | null): void => {
    if (key !== null && TRANSCRIPT_FIELDS.has(key)) return;
    if (Array.isArray(value)) { value.forEach((v) => walk(v, key)); return; }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
      return;
    }
    kept.push(String(value));
  };
  walk(parsed, null);
  return kept.join("\n");
}

/**
 * The top-level directories of THIS repository. A relative `cd packages/control/ansible` is a move
 * INSIDE a checkout, not into one — decided by reading the tree rather than by listing the paths that
 * happen to appear in today's docs, which is a list that drifts the moment somebody writes another one.
 */
const REPO_SUBDIRECTORIES = new Set(
  execFileSync("git", ["ls-files"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean).map((f) => f.split("/")[0]),
);

function trackedSource(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((f) => f !== SELF && !QUOTED_FIXTURE_FILES.has(f) && !f.includes("/dist/") && !f.startsWith("runs/"))
    // EVERY tracked text file, not a language. The `.mjs`/`.ts` walk is what hid a `.sh`, and narrowing
    // a walk to the languages you expect is the shape this whole file is about.
    .filter((f) => /\.(ts|mjs|js|yml|yaml|sh|ps1|cmd|py|md|json|service|xml)$/.test(f));
}

/**
 * The entry sites in ONE file's source, with the quoted-records boundary applied. Extracted so the
 * boundary is testable against a string rather than only against whatever happens to be on disk today --
 * a test that can only observe the tree cannot show that the rule is about RECORDS rather than about the
 * particular text one record happens to contain.
 */
export function entrySitesIn(file: string, source: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const m of stripComments(withoutQuotedTranscripts(file, source)).matchAll(ENTERS_A_DIRECTORY)) {
    const target = directoryEntered((m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/[`"'].*$/, ""));
    // An EMPTY target is `--working-directory=` appearing as a searched-for string rather than as a
    // built command (`lab-job.test.ts` slices argv between two such markers). Nothing is entered, so
    // there is nothing to classify -- recorded here rather than silently dropped.
    if (target !== "") found.push([file, target]);
  }
  return found;
}

/** Every discovered site: `[file, whatItEnters]`, one row per occurrence. */
function entrySites(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  // ONE reader for the real tree and for the tests, so the field exemption cannot be applied in one and
  // not the other -- the fact-stated-twice shape, which this file would be a poor place to commit.
  for (const file of trackedSource()) found.push(...entrySitesIn(file, read(file)));
  return found;
}

test("the source of truth exports the two shapes its consumers need, and the name is a fact about a "
  + "machine rather than about this repository", () => {
  const source = read(SOURCE_OF_TRUTH);
  for (const name of EXPORTED_NAMES) {
    assert.match(source, new RegExp(`export const ${name}\\b`),
      `${SOURCE_OF_TRUTH} no longer exports ${name} -- this guard's source of truth has moved and the `
      + "guard must move with it, rather than quietly asserting over nothing");
  }
});

test("every site that ENTERS a directory either interpolates the source of truth or is classified -- "
  + "keyed on the operation, because every sweep that searched for the NAME missed the literal that "
  + "took the fleet down", () => {
  const sites = entrySites();
  assert.ok(!sites.some(([file]) => file === SELF), "SELF must not reach the population");
  assert.ok(read(SELF).includes("--working-directory="),
    "SELF is excluded because its own pattern contains the text it searches for. If that stops being "
    + "true, delete the exclusion rather than carrying an exemption nothing needs.");
  assert.ok(sites.length >= 8,
    `only ${sites.length} entry site(s) found across the tree -- the discovery is broken, and a check `
    + "that passes having examined nothing is the defect this file exists to prevent (10 on 2026-09-08)");

  const unclassified = sites.filter(([file, target]) => {
    // A target that CANNOT be the control plane's checkout, decided by shape rather than by listing
    // every literal. The checkout is `/root/<name>` or the bare `<name>` reached from `/root`; none of
    // these three can be that, and enumerating them one at a time would be a list that drifts.
    if (target.startsWith("/tmp/")) return false;              // a throwaway directory
    if (target.startsWith("$(")) return false;                 // a computed path, e.g. $(mktemp -d)
    if (REPO_SUBDIRECTORIES.has(target.split("/")[0])) return false;  // a path INSIDE a checkout
    if (target.startsWith("..")) return false;                 // a move BETWEEN directories, not into one
    // A token with no name character in it is punctuation the pattern caught mid-expression -- a Jinja
    // `{{` or a JS `},`. A directory cannot be named that, and classifying it as one would put nonsense
    // in a list whose whole value is that every row is a decision somebody made.
    if (!/[A-Za-z0-9_~$%.]/.test(target)) return false;
    const name = /^\$\{([A-Za-z_$][\w$]*)\}/.exec(target)?.[1];
    if (name && EXPORTED_NAMES.includes(name)) return false;
    if (target in NOT_THE_CONTROL_PLANE_CHECKOUT) return false;
    // A local alias is fine ONLY if THIS file derives it from the source of truth. Reading the site's
    // OWN file matters: the first draft read `sites[0]`'s, which answered about a neighbouring file --
    // this repository's most-repeated shape, committed inside the guard written against it.
    return !(name && new RegExp(`\\b${name}\\s*=\\s*(${EXPORTED_NAMES.join("|")})\\b`).test(read(file)));
  }).map(([file, target]) => `${file}: enters ${target}`);
  assert.deepEqual(unclassified, [],
    `these sites enter a directory that is neither the control plane's checkout (from ${SOURCE_OF_TRUTH}) `
    + `nor a classified other one. If this is a SECOND literal for the checkout, derive it from the `
    + `source of truth -- that is the whole reason this file exists. If it is a different directory, add `
    + `it to NOT_THE_CONTROL_PLANE_CHECKOUT with the reason.`);
});

/**
 * Directories under a home root that are NOT the control plane's checkout, each with the reason. This is
 * the boundary the header names: a path under `$HOME` is not automatically THIS machine's, and a guard
 * demanding a value for a box nobody has measured is the guess #515 forbids arriving through a guard.
 */
const OTHER_HOME_DIRECTORIES: Record<string, string> = {
  ".ssh": "OpenSSH's own directory. `fleet-key-name-is-one-fact.test.ts` owns what is inside it.",
  ".claude": "Claude Code's own state directory, on whichever machine a session runs.",
  ".local": "the XDG user data root -- `~/.local/bin`, where pipx and friends install.",
  ".ansible": "Ansible's own cache, in `requirements.yml`'s documented paths.",
  ".npm": "npm's cache, in `action.yml`'s cache key.",
  "Library": "macOS's per-user library, in the board scripts' log paths.",
  "Documents": "macOS's Documents folder -- the chairman's board-reports directory lives under it.",
  "AppData": "Windows' per-user application data, in `action.yml` and the guest paths #584 owns.",
  "a11y-worker-vm": "the DEPRECATED local UTM VM's bundle in `docs/local-worker-vm.md`. A machine class "
    + "nobody has measured, under a placeholder account -- see the boundary in this file's header.",
  "g": "`~/g` in a `claude-md-links.test.ts` fixture, a two-character stand-in for a path, not a "
    + "directory anybody has.",
};

test("THE EXEMPTION IS THE FIELD, NOT THE FILE -- a quoted `command` in a reported record is not a use, "
  + "and the SAME text in any other field of the SAME record still is. That second case is the one that "
  + "decides path-keying against field-keying, and a path rule cannot see it", () => {
  const record = "docs/board/reported/gates/x.json";
  // The real record's own text, verbatim: a command an operator ran on 2026-09-08, redacted to
  // placeholders. It cannot interpolate the source of truth, because it is a quotation of something that
  // already happened -- and editing it would make the record describe a command nobody ran.
  const ran = "ssh <control-plane> 'cd <the control-plane checkout> && git merge --ff-only origin/main'";

  assert.deepEqual(entrySitesIn(record, JSON.stringify({ gate: "g", command: ran })), [],
    "a transcript field is a quotation, not a use");

  assert.notDeepEqual(entrySitesIn(record, JSON.stringify({ gate: "g", artefactDir: ran })), [],
    "THE DECIDING CASE. A field that is not a transcript is a path a tool reads, and it must still be "
    + "classified. Under a path rule the guard is already silent about every future field of every "
    + "reported record -- narrow relative to `docs/`, not narrow relative to the RECORD, and nobody "
    + "finds out");

  assert.notDeepEqual(entrySitesIn("packages/control/src/x.mjs", `\`${ran}\``), [],
    "the same text in a source file is a use, and always was");

  // Without this line the assertions above pass with the exemption widened to every doc: they prove the
  // boundary is not UNLIMITED and say nothing about whether it is NARROW. `npm run mutate` reported
  // exactly that, as THE GUARD DID NOT BITE rather than as a failure -- a pin asserting the wrong half
  // is indistinguishable from a working one until something breaks the half it does not watch.
  assert.notDeepEqual(entrySitesIn("docs/roles/README.md", `\`${ran}\``), [],
    "a `cd` in ordinary documentation is still a site to classify");

  assert.notDeepEqual(entrySitesIn(record, `{ not json at all: cd /root/whatever &&`), [],
    "an unparseable record is scanned WHOLE. Failing closed is the only safe direction: a record that "
    + "exempted itself by being malformed would be an escape hatch anybody could open with a typo");
});

test("no file names a directory under a home root that should be the checkout -- the SECOND question, "
  + "and the only one that reaches an ASSIGNMENT: `REPO_PATH=\"${A11Y_REPO_PATH:-$HOME/a11ign}\"` is not "
  + "an operation, so no amount of operation-keying finds it", () => {
  const named: string[] = [];
  for (const file of trackedSource()) {
    for (const m of stripComments(read(file)).matchAll(UNDER_A_HOME_ROOT)) {
      const segment = m[1].replace(/\.+$/, "");
      if (segment === "") continue;
      if (segment === CHECKOUT_NAME) continue;
      if (segment in OTHER_HOME_DIRECTORIES) continue;
      named.push(`${file}: ~/${segment}`);
    }
  }
  assert.deepEqual([...new Set(named)].sort(), [],
    "these name a directory directly under a home root that is neither the control plane's checkout "
    + `(${CHECKOUT_NAME}, from ${SOURCE_OF_TRUTH}) nor a classified other. If it is another literal for `
    + "the checkout, derive it from the source of truth; if it belongs to a different machine, say so in "
    + "OTHER_HOME_DIRECTORIES -- a path under a home root is not automatically this machine's.");
});

test("both consumers reach the checkout through the source of truth, and neither holds its own literal "
  + "-- the two files that held two shapes of one fact, with only one of them restored", () => {
  for (const consumer of ["packages/control/src/fleet-playbook.mjs", "packages/control/src/lab-pipeline.mjs"]) {
    const source = read(consumer);
    assert.match(source, /from "\.\/control-plane-checkout\.mjs"/,
      `${consumer} no longer imports the source of truth. If it stopped entering the checkout, remove `
      + "its entry here; if it grew its own literal, that is the outage again.");
    assert.ok(!/=\s*["']\/?root?\/?a11[a-z-]*["']/.test(stripComments(source)),
      `${consumer} assigns a bare checkout literal again -- the exact shape that made every fleet play `
      + "unreachable on 2026-09-08");
  }
});
