// #58: every storage/memory accumulator on the control plane gets a lifecycle rule, an owner, or a
// deletion with a reason -- never "we should clean this up" left as an intention. This tests the
// measurement script that both discovers each accumulator and refuses to report an undecided one.
//
// THE MOST VALUABLE THING THIS FILE PROVES IS THE DIST-TRAP DETECTOR'S OWN CORRECTNESS. It went through
// two false-positive rounds while being built: first it flagged @a11ign/control, @a11ign/lab
// and @a11ign/nvda-worker as exposed, because it matched any mention of the package name after
// `from "`, including SUBPATH imports into raw `.mjs` source that this repo deliberately reaches that way
// (ADR 0031: nvda-worker ships with no build step at all). Narrowing to a BARE root-specifier match still
// flagged nvda-worker, because nothing checked whether that package's own root export even resolves into
// `dist/` -- it resolves straight to `src/index.mjs`. Both rounds are pinned here as fixtures so neither
// regresses silently.
//
// #168 CHANGED WHAT "PROTECTED" MEANS. Per-package `prepare: tsc --build` scripts used to be the
// guarantee this check verified -- and they RACED each other during `npm ci` (three packages' own
// `tsconfig.json` reference `evidence`, so npm firing all five workspaces' `prepare` at once could start
// several CONCURRENT `tsc --build` processes writing to `packages/evidence/dist/*`). The guarantee is now
// GLOBAL: the repo ROOT's own `prepare` runs the one, coordinated `npm run build` instead. `fakeRepo`
// below writes a root `package.json` too, so both the protected and unprotected shapes can be driven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  linkState, workspacePackages, packagesImportedByName, distTrapReport, rootPrepareBuildsEverything,
  undecidedRefusal, classifyTmpQuota, readTmpQuota, tmpQuotaRow, QUOTACTL_PY,
} from "../../../agent-org/src/control-plane-hygiene.mjs";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

test("the real repo's dist-trap check finds every package it claims to check, protected by the root's "
  + "own prepare (#168), and none currently exposed", () => {
  const trap = distTrapReport(process.cwd());
  // A floor, not a target -- this repo has 9 workspace packages today; the floor is set below that so
  // adding or retiring a package does not itself break this guard.
  assert.ok(trap.checked >= 5, `expected at least 5 workspace packages checked, found ${trap.checked}`);
  assert.equal(trap.protectedByRoot, true,
    "the real repo's root package.json must declare a prepare that builds everything -- if this is false, "
    + "#168's fix has been reverted or edited into a shape this check no longer recognises");
  assert.deepEqual(trap.exposed.map((p) => p.name), []);
});

test("rootPrepareBuildsEverything: true when prepare invokes npm run build", () => {
  assert.equal(rootPrepareBuildsEverything(process.cwd()), true);
});

test("linkState distinguishes real, symlink, and missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-linkstate-"));
  const real = join(dir, "real");
  const linked = join(dir, "linked");
  mkdirSync(real);
  execFileSync("ln", ["-s", real, linked]);
  assert.equal(linkState(real), "real");
  assert.equal(linkState(linked), "symlink");
  assert.equal(linkState(join(dir, "nope")), "missing");
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Builds a synthetic repo under `os.tmpdir()` with `packages/<name>/package.json` for each spec, a root
 * `package.json` (whose `prepare` either builds everything or does not, per `rootBuildsEverything`), and
 * (optionally) a source file elsewhere importing it -- never the real `docs/board`-style shared fixture,
 * because this one needs a real `git grep`-able tree, so it is a real (if tiny) git repo.
 */
function fakeRepo(rootBuildsEverything: boolean,
  packageSpecs: Array<{ dir: string; name: string; rootExport: string }>,
  importers: Array<{ path: string; line: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-disttrap-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, env: sandboxGitEnv() });
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "fake-root",
    scripts: {
      build: "node scripts/fake-build.mjs",
      prepare: rootBuildsEverything ? "node scripts/fake-hooks.mjs && npm run build" : "node scripts/fake-hooks.mjs",
    },
  }));
  mkdirSync(join(dir, "packages"), { recursive: true });
  for (const spec of packageSpecs) {
    mkdirSync(join(dir, "packages", spec.dir), { recursive: true });
    writeFileSync(join(dir, "packages", spec.dir, "package.json"), JSON.stringify({
      name: spec.name,
      exports: { ".": spec.rootExport },
    }));
  }
  for (const imp of importers) {
    mkdirSync(join(dir, ...imp.path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, imp.path), imp.line);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir, env: sandboxGitEnv() });
  return dir;
}

test("MUTATION-shaped: a bare-imported, dist-exporting package is EXPOSED when the root's prepare does "
  + "NOT build everything", () => {
  const dir = fakeRepo(false,
    [{ dir: "exposed-pkg", name: "@fake/exposed-pkg", rootExport: "./dist/index.js" }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/exposed-pkg";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.equal(trap.protectedByRoot, false);
  assert.deepEqual(trap.exposed.map((p) => p.name), ["@fake/exposed-pkg"]);
  rmSync(dir, { recursive: true, force: true });
});

test("the identical package is NOT exposed once the root's prepare builds everything (#168's fix)", () => {
  const dir = fakeRepo(true,
    [{ dir: "safe-pkg", name: "@fake/safe-pkg", rootExport: "./dist/index.js" }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/safe-pkg";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.equal(trap.protectedByRoot, true);
  assert.deepEqual(trap.exposed, []);
  rmSync(dir, { recursive: true, force: true });
});

test("a SUBPATH import into raw source is never flagged, even unprotected -- ADR 0031's shape", () => {
  const dir = fakeRepo(false,
    [{ dir: "mjs-pkg", name: "@fake/mjs-pkg", rootExport: "./src/index.mjs" }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/mjs-pkg/some-subpath.mjs";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.deepEqual(trap.exposed, [],
    "a subpath import must never be read as needing the ROOT export's dist -- this was this check's own first false positive");
  rmSync(dir, { recursive: true, force: true });
});

test("a SUBPATH-ONLY import of a package whose root DOES export dist/ is not flagged as bare-imported", () => {
  // Isolates the quote-boundary check from rootExportsDist: this package WOULD be exposed if bare-
  // imported while unprotected, so if the subpath match were sloppy (missing the closing quote) this is
  // the fixture that would catch it -- the previous test's fixture could not, because its own
  // rootExportsDist was already false for an unrelated reason.
  const dir = fakeRepo(false,
    [{ dir: "dist-pkg-subpath-only", name: "@fake/dist-pkg-subpath-only", rootExport: "./dist/index.js" }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/dist-pkg-subpath-only/deep.js";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.deepEqual(trap.exposed, [],
    "a subpath-only import must not count as a BARE import of the package, even when the root export is dist/");
  rmSync(dir, { recursive: true, force: true });
});

test("a package whose root export never resolves into dist/ is never flagged, even bare-imported and unprotected", () => {
  const dir = fakeRepo(false,
    [{ dir: "src-only", name: "@fake/src-only", rootExport: "./src/index.mjs" }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/src-only";\n' }],
  );
  assert.deepEqual(distTrapReport(dir).exposed, [],
    "a package with no dist in its own root export needs no install-time build guarantee at all -- this "
    + "was the SECOND false positive found building this check");
  rmSync(dir, { recursive: true, force: true });
});

test("a package only ever imported from its own directory is not counted as needed by others", () => {
  const dir = fakeRepo(false,
    [{ dir: "self-only", name: "@fake/self-only", rootExport: "./dist/index.js" }],
    [{ path: "packages/self-only/src/self-test.ts", line: 'import { x } from "@fake/self-only";\n' }],
  );
  assert.deepEqual(workspacePackages(dir).map((p) => p.name), ["@fake/self-only"]);
  assert.deepEqual([...packagesImportedByName(dir, workspacePackages(dir))], [],
    "a package importing only ITSELF must not count as needed by another package");
  rmSync(dir, { recursive: true, force: true });
});

// #655: the refusal must NAME the undecided row(s), not just count them -- a reader who follows the
// message exactly must be able to find the row without re-reading the whole table above it.
test("MUTATION TARGET: undecidedRefusal names the undecided row's OWN label, not just a count", () => {
  const rows: Array<[string, string, string]> = [
    ["Worktrees registered", "12", "RULE: prune stale/fully-merged trees regularly."],
    ["Some accumulator", "3 GB", "TODO: we should clean this up at some point"],
  ];
  const refusal = undecidedRefusal(rows);
  assert.ok(refusal, "a row with only an intention must refuse");
  assert.match(refusal as string, /Some accumulator/,
    "the refusal must name the specific undecided row, not just say how many");
  assert.doesNotMatch(refusal as string, /Worktrees registered/,
    "the refusal must not name a row that HAS a real decision");
});

test("undecidedRefusal returns null when every row has a real decision", () => {
  const rows: Array<[string, string, string]> = [
    ["Worktrees registered", "12", "RULE: prune stale/fully-merged trees regularly."],
    ["Disk free", "800 GB", "Informational only -- not an accumulator, no rule needed at current scale."],
  ];
  assert.equal(undecidedRefusal(rows), null);
});

// #2300 (pnpm 3/6 of #57): the symlink stopped being a choice the day a worktree could get its own install in
// seconds, and both places that state the rule -- this page and the script that regenerates it -- said the
// opposite until then. Each is read as TEXT, because the rows are built inside `main()` and printing them would
// need the live host's worktrees.
const HYGIENE_SOURCES = ["docs/control-plane-hygiene.md", "packages/agent-org/src/control-plane-hygiene.mjs"]
  .map((rel) => ({ rel, text: readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8") }));

test("#2300: neither the hygiene page nor its report calls the symlink deliberate, or pnpm post-publish", () => {
  for (const { rel, text } of HYGIENE_SOURCES) {
    assert.doesNotMatch(text, /deliberately post-publish|Structural fix is `pnpm`/i, `${rel} still defers pnpm`);
    assert.doesNotMatch(text, /symlink to the primary's INSTEAD only when/, `${rel} still offers the symlink as a choice`);
  }
});

test("#2300: both name the pnpm install, and the page carries a MEASURED residual count with its command and commit", () => {
  // The positive control for the two emptiness assertions above: the corrected text is present, not merely
  // the old text absent -- an emptied file would pass those.
  for (const { rel, text } of HYGIENE_SOURCES) assert.match(text, /pnpm install --frozen-lockfile/, rel);
  const page = HYGIENE_SOURCES[0].text;
  assert.match(page, /MEASURED: \d+ of \d+ registered worktrees\*\*, read at `[0-9a-f]{7,}`/);
  assert.match(page, /npm run hygiene:report/);
});

// #2220: `/tmp` on the agent host is a `usrquota` tmpfs, and `df` said 80% / 3.1 GB free while a 50 MB write
// was refused. Every reading below is a fixture handed to the classifier: a test that shelled out to the real
// /tmp would report whatever the host happens to be that minute, and CI's /tmp has no usrquota at all.
const GIB = 1024 ** 3;
const MOUNT_WITH_QUOTA = "rw,nosuid,nodev,size=15797356k,nr_inodes=1048576,inode64,usrquota";
const LIMIT_GIB = 12;
const KIB_PER_GIB = 1024 ** 2;
/** A user `fraction` of the way into a 12 GiB limit (hard and soft alike, as on the agent host). */
const quotaAt = (fraction: number) =>
  ({ hardKb: LIMIT_GIB * KIB_PER_GIB, softKb: LIMIT_GIB * KIB_PER_GIB, usedBytes: fraction * LIMIT_GIB * GIB });
const readingOf = (over: Record<string, unknown>) =>
  ({ mountOptions: MOUNT_WITH_QUOTA, quota: quotaAt(0.1), quotaError: null, dfFreeBytes: 3.1 * GIB, ...over }) as
    Parameters<typeof classifyTmpQuota>[0];

test("#2220: a user AT its quota is EXHAUSTED while the filesystem still has 3.1 GB free -- df is not the verdict", () => {
  const verdict = classifyTmpQuota(readingOf({ quota: quotaAt(1), dfFreeBytes: 3.1 * GIB }));
  assert.equal(verdict.state, "EXHAUSTED");
  assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(1.1), dfFreeBytes: 3.1 * GIB })).state, "EXHAUSTED");
  // The same quota reading with every df figure changed must not move the verdict: it is never consulted.
  for (const dfFreeBytes of [0, 3.1 * GIB, null]) {
    assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(1), dfFreeBytes })).state, "EXHAUSTED");
    assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(0.1), dfFreeBytes })).state, "OK");
  }
});

test("#2220: fine, constrained and exhausted are three different answers, split at 90% and 100%", () => {
  assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(0.8) })).state, "OK");
  assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(0.9) })).state, "CONSTRAINED");
  assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(0.999) })).state, "CONSTRAINED");
  assert.equal(classifyTmpQuota(readingOf({ quota: quotaAt(1) })).state, "EXHAUSTED");
});

test("#2220: NOT MEASURABLE is never OK -- no usrquota, no limit for the user, and every unreadable part", () => {
  const noQuotaMount = classifyTmpQuota(readingOf({ mountOptions: "rw,nosuid,nodev,size=15797356k", quota: null }));
  assert.equal(noQuotaMount.state, "NOT MEASURABLE");
  assert.match(noQuotaMount.detail, /no usrquota/);
  // A mount whose option list merely CONTAINS the word inside another option's value must not be read as
  // declaring the quota: match the option, not the substring.
  assert.equal(classifyTmpQuota(readingOf({ mountOptions: "rw,context=usrquota_t" })).state, "NOT MEASURABLE");
  assert.equal(classifyTmpQuota(readingOf({ quota: { hardKb: 0, softKb: 0, usedBytes: GIB } })).state, "NOT MEASURABLE");
  assert.equal(classifyTmpQuota(readingOf({ quota: null, quotaError: "quotactl_fd: Function not implemented" })).state,
    "NOT MEASURABLE");
  const unreadable = classifyTmpQuota(readingOf({ mountOptions: null, quota: null, quotaError: "findmnt failed: ENOENT" }));
  assert.equal(unreadable.state, "NOT MEASURABLE");
  assert.match(unreadable.detail, /findmnt failed/, "the reason must reach the report, or the reader cannot act on it");
});

test("#2220: the smaller of a hard and a soft limit is the limit that refuses the write", () => {
  const soft = { hardKb: LIMIT_GIB * KIB_PER_GIB, softKb: LIMIT_GIB / 2 * KIB_PER_GIB, usedBytes: 0.6 * LIMIT_GIB * GIB };
  assert.equal(classifyTmpQuota(readingOf({ quota: soft })).state, "EXHAUSTED");
});

test("#2220: readTmpQuota reads through its injected exec and reports what it could not read as null, not as a guess", () => {
  const answers: Record<string, string | Error> = {
    findmnt: MOUNT_WITH_QUOTA + "\n",
    python3: JSON.stringify({ hardKb: 12637884, softKb: 12637884, usedBytes: 10359521280 }),
  };
  const exec = ((cmd: string) => { const a = answers[cmd]; if (a instanceof Error) throw a; return a; }) as never;
  const ok = readTmpQuota("/tmp", exec);
  assert.equal(ok.mountOptions, MOUNT_WITH_QUOTA);
  assert.deepEqual(ok.quota, { hardKb: 12637884, softKb: 12637884, usedBytes: 10359521280 });
  assert.equal(classifyTmpQuota(ok).state, "OK");

  answers.python3 = JSON.stringify({ error: "Operation not permitted" });
  const refused = readTmpQuota("/tmp", exec);
  assert.equal(refused.quota, null);
  assert.equal(refused.quotaError, "quotactl_fd: Operation not permitted");

  answers.python3 = new Error("spawn python3 ENOENT");
  assert.match(readTmpQuota("/tmp", exec).quotaError as string, /python3 quotactl_fd failed: spawn python3 ENOENT/);

  answers.findmnt = new Error("spawn findmnt ENOENT");
  const noMount = readTmpQuota("/tmp", exec);
  assert.equal(noMount.mountOptions, null);
  assert.equal(classifyTmpQuota(noMount).state, "NOT MEASURABLE");
});

test("#2220: the quotactl script is real Python that answers in JSON on ANY host, quota or none", () => {
  // The injected exec above never runs the script, so a syntax error in it would pass every case there. CI's
  // /tmp has no usrquota, so the answer is an error object there and numbers on the agent host: both are shaped.
  const out = execFileSync("python3", ["-c", QUOTACTL_PY, tmpdir(), String(process.getuid?.() ?? 0)], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.ok(typeof parsed.error === "string" || (typeof parsed.hardKb === "number" && typeof parsed.usedBytes === "number"),
    `unexpected quotactl answer: ${out}`);
});

test("#2220: the report row carries the verdict, the df contrast, a rule the report accepts, and reads via `read`", () => {
  let asked = "";
  const [label, measured, rule] = tmpQuotaRow((path) => { asked = path; return readingOf({ quota: quotaAt(1) }); });
  assert.equal(asked, "/tmp");
  assert.match(label, /\/tmp user quota/);
  assert.match(measured, /^EXHAUSTED -- .*100%.*; df shows 3174 MB free$/);
  assert.equal(undecidedRefusal([[label, measured, rule]]), null, "the row must state a decision, not an intention");
  const [, unmeasured] = tmpQuotaRow(() => readingOf({ mountOptions: "rw", quota: null }));
  assert.match(unmeasured, /^NOT MEASURABLE -- the mount declares no usrquota/);
});

test("#2220: the hygiene page records the /tmp quota row, and the reporter's rule says to read the quota", () => {
  const [page, script] = HYGIENE_SOURCES;
  assert.match(page.text, /\*\*`\/tmp` user quota\*\*/);
  assert.match(page.text, /never `df`/);
  assert.match(script.text, /tmpQuotaRow\(\)/, "main() must actually put the row in the report");
});
