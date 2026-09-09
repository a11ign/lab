/**
 * `walkTree` -- #795, the gap #794's audit named on the row. #794 fixed and mutation-tested the worked
 * example (`function-size.test.ts`'s own walk, asserting no function node's `.end` reaches literal
 * end-of-file) and found 20 of the other 21 tree-wide guards already carry a `.length >= N` floor on
 * their RESULT. ceo: a floor on the result catches a search that ran correctly and then silently shrank
 * its findings -- it does NOT catch a search that never ran the intended query at all (a wrong root, a
 * pathspec that quietly matches the wrong thing, a leaked `GIT_DIR`). Both failure modes report
 * identically to a `.length >= N` check: fewer files, no distinguishing signal.
 *
 * So the search itself is asserted here, ONCE, in the helper #716/#727 already built -- not re-derived,
 * worded differently, in 20-odd call sites. See `scripts/tree-wide-guard.mjs`'s own header for the
 * cross-check `walkTree` runs internally (git's own pathspec filter against an independent JS `extname`
 * filter over the same unfiltered listing) and why a count alone is not the same claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { walkTree, declareTreeWideGuard, _lsFilesSpawnCountForTests } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file.
declareTreeWideGuard();

const realGitLsFiles = (args: string[]) =>
  execFileSync("git", ["ls-files", ...args], { encoding: "utf8", env: sandboxGitEnv() });

test("kind \"ts\": every returned file really is tracked and really ends in .ts, and the count matches an "
  + "independent, ANCHORED `git ls-files \"packages/lab/src/packaging/*.ts\"` call made outside walkTree "
  + "-- packing root and glob into ONE pathspec, since two separate pathspecs OR rather than AND", () => {
  const found = walkTree({ kind: "ts", roots: ["packages/lab/src/packaging"] });
  assert.ok(found.length > 20, `only ${found.length} .ts file(s) found under packaging/ -- the walk looks broken`);
  assert.ok(found.every((f) => f.path.endsWith(".ts")), "kind \"ts\" must never return a non-.ts path");
  assert.ok(found.every((f) => f.scriptKind === ts.ScriptKind.TS), "every .ts file must carry ScriptKind.TS");

  const independent = realGitLsFiles(["packages/lab/src/packaging/*.ts"]).split("\n").filter(Boolean);
  assert.deepEqual(found.map((f) => f.path).sort(), independent.sort(),
    "walkTree's own returned set must equal a git-ls-files call made independently, outside the helper");
});

test("kind \"mjs\": every file ends in .mjs and carries ScriptKind.JS", () => {
  const found = walkTree({ kind: "mjs", roots: ["scripts"] });
  assert.ok(found.length > 20, `only ${found.length} .mjs file(s) found under scripts/ -- the walk looks broken`);
  assert.ok(found.every((f) => f.path.endsWith(".mjs") && f.scriptKind === ts.ScriptKind.JS));
});

test("kind \"both\": the union of what \"ts\" and \"mjs\" find separately, nothing more and nothing less", () => {
  const roots = ["scripts"];
  const both = walkTree({ kind: "both", roots }).map((f) => f.path).sort();
  const union = [...walkTree({ kind: "ts", roots }), ...walkTree({ kind: "mjs", roots })]
    .map((f) => f.path).sort();
  assert.deepEqual(both, union);
});

test("kind \"all\": no extension filter -- every tracked path under root, .test.ts included", () => {
  const found = walkTree({ kind: "all", roots: ["packages/lab/src/packaging"] });
  assert.ok(found.some((f) => f.path.endsWith(".test.ts")), "kind \"all\" must not silently drop test files");
});

test("#795: kind \"all\" never computes a ScriptKind -- a text-only guard has no use for one, and "
  + "computing it anyway is exactly the unconditional `typescript` load the CPU follow-up traced nine "
  + "seconds to across the ~9 guards that only ever call walkTree with kind \"all\"", () => {
  const found = walkTree({ kind: "all", roots: ["packages/lab/src/packaging"] });
  assert.ok(found.every((f) => f.scriptKind === undefined),
    "kind \"all\" results must never carry a ScriptKind");
});

test("#795 ISOLATED: a FRESH process calling ONLY kind \"all\" never loads typescript at all -- proof, "
  + "not just an undefined field, checked in a real subprocess since this file's OWN earlier tests "
  + "(kind \"ts\"/\"mjs\"/\"both\") have already loaded it by the time this test runs in-process", () => {
  const helperPath = fileURLToPath(new URL("../../../../scripts/tree-wide-guard.mjs", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const script = `
    import { walkTree, _typescriptLoadedForTests } from ${JSON.stringify(helperPath)};
    walkTree({ kind: "all", roots: ["packages/lab/src/packaging"] });
    process.stdout.write(String(_typescriptLoadedForTests()));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script],
    { cwd: repoRoot, encoding: "utf8" });
  assert.equal(out.trim(), "false",
    "a process that only ever asked walkTree for kind \"all\" must never have loaded typescript");
});

test("#795: a repeated call with the SAME argv is served from the per-process cache, not respawned -- "
  + "several real guards ask walkTree for the same roots more than once in one file. A Map's own `.size` "
  + "cannot prove this (`.set` on an existing key does not grow it either way), so this counts the real "
  + "spawns themselves", () => {
  const before = _lsFilesSpawnCountForTests();
  walkTree({ kind: "mjs", roots: ["packages/worker-fleet/src"] });
  const afterFirst = _lsFilesSpawnCountForTests();
  assert.ok(afterFirst > before, "a genuinely new argv must spawn git at least once");
  walkTree({ kind: "mjs", roots: ["packages/worker-fleet/src"] });
  const afterSecond = _lsFilesSpawnCountForTests();
  assert.equal(afterSecond, afterFirst,
    "the identical argv, asked again, must be served from cache -- not spawn git a second time");
});

test("selfPath marks the caller's own file isSelf: true -- named, not silently included or excluded", () => {
  const selfPath = "packages/lab/src/packaging/tree-wide-guard-walk.test.ts";
  const found = walkTree({ kind: "ts", roots: ["packages/lab/src/packaging"], selfPath });
  const self = found.find((f) => f.path === selfPath);
  assert.ok(self, "this file's own path must be in its own walk's results");
  assert.equal(self!.isSelf, true, "the self entry must be marked isSelf: true");
  assert.ok(found.filter((f) => f.path !== selfPath).every((f) => f.isSelf === false),
    "no other entry may be marked isSelf");
});

test("VACUITY FLOOR: zero tracked files under the given roots refuses loudly rather than returning an "
  + "empty, silently-passing result", () => {
  assert.throws(() => walkTree({ kind: "all", roots: ["definitely-not-a-tracked-location-795"] }),
    /zero tracked files/, "an empty root must refuse, not return []");
});

test("unknown kind refuses by name rather than silently matching nothing", () => {
  // @ts-expect-error -- deliberately wrong kind, to prove the runtime check fires even past the type
  assert.throws(() => walkTree({ kind: "yml", roots: ["scripts"] }), /unknown kind "yml"/);
});

test("#795 MUTATION TARGET: when git's own pathspec filter and the independent JS extname filter "
  + "disagree, walkTree refuses rather than silently trusting either one", () => {
  const gitLsFiles = (args: string[]) => {
    // The unfiltered call (no extension arg) answers honestly; the PATHSPEC-filtered call (extension arg
    // present) lies by dropping one real .ts file -- reproducing a pathspec that quietly matches less than
    // it should, which a `.length >= N` floor on the RESULT alone would never distinguish from "there are
    // just fewer files this run".
    const hasExtArg = args.some((a) => a.includes("*."));
    if (!hasExtArg) return "fake/a.ts\nfake/b.ts\nfake/c.mjs\n";
    return "fake/a.ts\n"; // drops fake/b.ts
  };
  assert.throws(() => walkTree({ kind: "ts", roots: ["fake"] }, { gitLsFiles }),
    /disagree/, "a pathspec silently matching fewer files than the JS-side filter must be refused, not "
      + "returned as though it were the true population");
});

test("CONTROL: when both filters agree, the same fixture returns cleanly with no mutation applied", () => {
  const gitLsFiles = (args: string[]) => {
    const hasExtArg = args.some((a) => a.includes("*."));
    return hasExtArg ? "fake/a.ts\n" : "fake/a.ts\nfake/c.mjs\n";
  };
  const found = walkTree({ kind: "ts", roots: ["fake"] }, { gitLsFiles });
  assert.deepEqual(found.map((f) => f.path), ["fake/a.ts"]);
});
