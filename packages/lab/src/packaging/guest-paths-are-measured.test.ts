/**
 * A PATH ON A WINDOWS WORKER IS A FACT ABOUT NINE MACHINES, and the rename moved twenty of them across
 * five languages.
 *
 * `e435ac17` rewrote every occurrence of the product's name. `fleet:deploy` at 2026-09-08T20:07:01Z
 * reached all nine boxes for the first time since — `unreachable=0`, SSH held, Ansible ran — and then:
 *
 *     Failed to run: '': Could not find specified -WorkingDirectory 'C:\Users\witness\a11ign'
 *     rc: 2      changed=0 on every host
 *
 * ## The measurement, and the trap inside it
 *
 * Taken on a real guest by the orchestrator, because this session cannot reach one:
 *
 *     Get-ChildItem C:\Users\witness -Directory           ->  no a11y-witness
 *     Get-ChildItem C:\Users\witness -Directory -Force    ->  a11y-witness      <- HIDDEN
 *     Test-Path C:\ProgramData\a11ign                     ->  False
 *     Test-Path C:\ProgramData\a11y-witness               ->  True
 *
 * **The checkout directory is HIDDEN.** A read without `-Force` reports it absent under either name, and
 * would have sent this somewhere else entirely. That is why the sites below were held unfixed through
 * two earlier rows rather than restored on sight — #515's whole thesis is that a sweep cannot tell a
 * name we own from a name we do not, and neither can a guess.
 *
 * ## THE THIRD ROOT, and it is the one with teeth
 *
 * `%LOCALAPPDATA%\a11ign\edge-profile` looked like it might legitimately have followed the rename,
 * since the capture path CREATES that directory rather than cloning it. Measured on **three** guests at
 * 2026-09-08T20:19:45Z — a second and third box precisely because "created at runtime" made a one-box
 * answer plausible:
 *
 *     Test-Path ...\AppData\Local\a11ign\edge-profile          False
 *     Test-Path ...\AppData\Local\a11y-witness\edge-profile    True     (workers 2, 5 and 9)
 *
 * The hypothesis was refuted. The profile predates the rename and the workers have never re-created it.
 *
 * **The deploy failing has been PROTECTING it.** A successful deploy on the renamed tree would have
 * created `a11ign\edge-profile` fresh and COLD on all nine guests — and `provisionRevision` does not
 * hash the profile directory, so nine workers would switch to an unwarmed profile mid-corpus **with no
 * cache-key change to mark it**. `gate:stability` exists because *"probeForms submits forms, so the
 * profile LEARNS"*: the U+FFFC artefact climbed 3% -> 8% -> 31% as a run proceeded, with 26 good/bad
 * pairs disagreeing about it. A pair differing by the state of the measuring tool rather than by
 * accessibility is the one defect this project cannot tolerate, and here it would have arrived through
 * a directory name.
 *
 * ## FIVE INCOMPLETE SWEEPS BY FOUR SESSIONS, all looking for the same thing
 *
 * `dispatcher` grepped `/root/a11ign`; `ceo` scoped to `packages/`; the orchestrator covered
 * `packages/control/src` and `packages/worker-fleet/src` — **JavaScript only**, while the facts that
 * broke live in YAML, `.cmd`, `.ps1` and a Python docstring; my own first grep here used
 * `Users.witness`, which matches `Users\witness` in a `.yml` and MISSES `Users\\witness` in a `.mjs`.
 * Each sweep found a real subset and each reported clean.
 *
 * So this guard keys on the OPERATION — **naming a path under `C:\Users\witness\` or
 * `C:\ProgramData\`** — and walks EVERY tracked text file rather than a language. A path can be written
 * with one backslash or two, single- or double-quoted, in a `Join-Path`, or interpolated into a `.cmd`;
 * it cannot be any of those things without saying `C:\Users\witness` or `C:\ProgramData` first.
 *
 * ## What is deliberately NOT here
 *
 * `%LOCALAPPDATA%\a11ign\{edge,chrome}-profile` — Edge's capture profile, created by the capture path
 * rather than by a clone, and **a different directory with its own `Test-Path` that nobody has run**.
 * It is also a cache key's neighbour: `browser-args.test.ts` asserts the whole command line against a
 * literal precisely because per-flag assertions cannot see a flag that was added. Restoring it on the
 * strength of the checkout's measurement would be assuming that two directories on one machine were
 * renamed together, which is the guess this row exists to refuse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * The two guest roots, and what the directory under each is MEASURED to be called. Not derived from the
 * product's name — that is exactly the derivation that broke — but from a `Test-Path` on a real guest.
 */
const GUEST_ROOTS = [
  { label: String.raw`C:\Users\witness`, directory: "a11y-witness",
    // One or two backslashes: YAML and `.cmd` write one, JS and Python string literals write two.
    // The `witness` ACCOUNT specifically: that is the account the measurement was taken under. A
    // placeholder account in the deprecated local-UTM-VM docs (`user@vm`, `C:/Users/user/...`) is a
    // different machine class nobody has measured, and matching it here would have this guard demand a
    // value for a box that does not exist -- the guess #515 forbids, arriving through a guard.
    pattern: String.raw`C:[\\/]{1,2}Users[\\/]{1,2}witness[\\/]{1,2}(?!AppData)([A-Za-z0-9._-]+)` },
  { label: String.raw`C:\ProgramData`, directory: "a11y-witness",
    pattern: String.raw`C:\\{1,2}ProgramData\\{1,2}([A-Za-z0-9._-]+)` },
  { label: "%LOCALAPPDATA% (Edge's capture profile)", directory: "a11y-witness",
    // THREE spellings of one root, which is why this is keyed on the root rather than the name:
    // `AppData\Local\` as a literal path, `%LOCALAPPDATA%\` in YAML and prose, and PowerShell's
    // `Join-Path $env:LOCALAPPDATA "..."` with no separator at all.
    pattern: String.raw`(?:AppData\\{1,2}Local\\{1,2}|%LOCALAPPDATA%\\{1,2}|\$env:LOCALAPPDATA\s+")([A-Za-z0-9._-]+)` },
];

/**
 * This file, excluded from its own walk: its header quotes the wrong spelling verbatim, because the
 * incident is unreadable without it. Same device as `git-population-vacuity.test.ts`, and the third time
 * today a guard of mine has discovered itself.
 */
const SELF = "packages/lab/src/packaging/guest-paths-are-measured.test.ts";

/**
 * Named files, not a directory -- same device as SELF above, and kept exact rather than a prefix so a
 * future fixture under this same directory is still examined by default.
 *
 * `owned-path-signoff.test.ts`'s fixtures are real PR bodies fetched verbatim (`gh pr view --json body`,
 * #603) so that predicate is verified against text nobody wrote for the test -- and one of them (#584)
 * quotes THIS ROW's own outage, one PR before this file existed. Rewriting the fixture to dodge this
 * guard would make it describe a body nobody actually posted.
 */
const QUOTED_FIXTURE_FILES = new Set([
  "packages/lab/src/packaging/fixtures/pr-584-body.md",
  "packages/lab/src/packaging/fixtures/pr-613-body.md",
]);

/**
 * Directories under those roots that are NOT the ones measured, each with the reason. A path reaching
 * neither this list nor the measured value FAILS BY NAME.
 */
const OTHER_GUEST_DIRECTORIES: Record<string, string> = {
  "AppData": "the per-user application-data root, not a directory anybody named. What sits UNDER it "
    + "(`AppData\\Local\\a11ign\\edge-profile`, Edge's capture profile) is a different directory with "
    + "its own unrun `Test-Path`, deliberately untouched — see this file's header.",
  "cc.log": "a scratch destination in a runbook's `Copy-Item`, written BY the operator rather than "
    + "existing on the box",
  "log-copy.txt": "the same, in the sibling runbook step",
  "capcheck.cmd": "a FILE the runbook tells the operator to write, not a directory that exists",
  "diagnose-nvda-worker.ps1": "a FILE the runbook copies to the guest, not a directory",
  "guidepup": "guidepup's OWN install root under %LOCALAPPDATA% — where it puts NVDA, and the default "
    + "`GUIDEPUP_SCREEN_READERS_PATH` points at. A dependency's directory, not one this project named",
  "pip": "pip's own cache, in `action.yml`'s cache key",
  "ms-playwright": "Playwright's own browser cache, appearing inside a quoted example path",
  "Temp": "the Windows temp directory, in a runbook path",
  "Programs": "`%LOCALAPPDATA%\\Programs` is Windows' own per-user install root, where `run-server.cmd` "
    + "finds node. Microsoft's directory, not one this project named",
  "ssh": "`C:\\ProgramData\\ssh` is OpenSSH for Windows' own configuration directory — Microsoft's "
    + "path, not one this project named, and `administrators_authorized_keys` lives in it",
  "...": "an ellipsis in prose ABOUT these paths, in this row's own two files. Not a directory; kept "
    + "as a classification rather than by stripping prose, because the walk deliberately reads raw "
    + "source — a comment naming the wrong guest path sends an operator to a box and costs an "
    + "afternoon, exactly as a wrong runbook does.",
};

/** Every tracked text file — every language, because the sweep that looked at one language missed four. */
function trackedText(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((f) => f !== SELF && !QUOTED_FIXTURE_FILES.has(f) && !f.includes("/dist/") && !f.startsWith("runs/"))
    .filter((f) => /\.(ts|mjs|js|yml|yaml|sh|ps1|cmd|py|md|json|service|xml)$/.test(f));
}

/**
 * Every `<root>\<segment>` this tree names, as `[file, root, segment]`. Both escapings are accepted in
 * one pattern — a single backslash as YAML and `.cmd` write it, or a doubled one as JS and Python string
 * literals do — because the escaping is exactly the difference my own first sweep tripped on.
 */
/**
 * Every directory named under one root in one file. A trailing dot is a SENTENCE'S full stop, never part
 * of the name — Windows forbids a directory ending in `.`, so `...\guidepup.` in prose is `guidepup`
 * followed by punctuation, and without the trim the same directory reports under two names of which one
 * can never be classified. An EMPTY segment is what a prose ellipsis leaves behind once the dots are
 * trimmed: nothing is named, so there is nothing to classify.
 */
function segmentsUnder(source: string, pattern: string): string[] {
  return [...source.matchAll(new RegExp(pattern, "g"))]
    .map((m) => m[1].replace(/\.+$/, ""))
    .filter((segment) => segment !== "");
}

/** Every `<root>\<segment>` this tree names, as `[file, root label, segment]`. */
function guestPathsNamed(): Array<[string, string, string]> {
  const found: Array<[string, string, string]> = [];
  for (const file of trackedText()) {
    const source = read(file);
    for (const { label, pattern } of GUEST_ROOTS) {
      for (const segment of segmentsUnder(source, pattern)) found.push([file, label, segment]);
    }
  }
  return found;
}

test("the guest roots' contents are named from a MEASUREMENT, and every site agrees with it -- across "
  + "every language, because the sweep that looked at JavaScript alone missed YAML, .cmd, .ps1 and a "
  + "Python docstring", () => {
  const named = guestPathsNamed();
  assert.ok(named.length >= 15,
    `only ${named.length} guest path(s) found -- the discovery is broken, and a check that passes having `
    + "examined nothing is what let five sweeps report clean (20+ on 2026-09-08)");

  const wrong = named
    .filter(([, root, segment]) => {
      const expected = GUEST_ROOTS.find((g) => g.label === root)?.directory;
      return segment !== expected && !(segment in OTHER_GUEST_DIRECTORIES);
    })
    .map(([file, root, segment]) => `${file}: ${root}\\${segment}`);
  assert.deepEqual(wrong, [],
    "these name a directory under a guest root that is neither the MEASURED one nor a classified other. "
    + "A path on a worker is a fact about nine machines: settle it with `Test-Path` on a real guest "
    + "(with `-Force` -- the checkout directory is HIDDEN) before changing a line here.");
});

test("the measured values are recorded as measurements, not derived from the product's name -- the "
  + "derivation that broke the fleet", () => {
  for (const { label, directory } of GUEST_ROOTS) {
    assert.ok(directory.length > 0, `${label} has no measured directory name`);
  }
  assert.ok(read(SELF).includes("Test-Path C:\\ProgramData\\a11y-witness"),
    "the header must keep the command and its output, so the next reader can see WHERE the value came "
    + "from rather than trusting this list");
});
