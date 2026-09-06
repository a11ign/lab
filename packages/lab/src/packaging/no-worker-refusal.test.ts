/**
 * A FIRST-TIME USER WITH NO WORKER CONFIGURED MUST BE REFUSED IN SECONDS, NOT LEFT SILENT FOR TEN MINUTES.
 *
 * Measured by the orchestrator: with no `A11Y_WORKER`, no `inventory.yml` declared and no local VM,
 * `leaseWorker` resolves `{worker: "http://localhost:8765", source: "default"}` -- a GUESS, not a fact.
 * `ECONNREFUSED` is in `TRANSIENT_NETWORK_CODES` (correct for a real worker that dropped one socket), so
 * `captureTolerantly`'s lost-acceptance recovery loops for the full `CAPTURE_CLIENT_TIMEOUT_MS` (620 s)
 * against an address nothing has ever answered. A first run prints "Scanning ..." and then nothing for
 * over ten minutes.
 *
 * The fix (`cli.ts`) is not in the retry classification -- both are correct for the case they were built
 * for. It is asking, once, whether anything is even there BEFORE committing to that budget, and only when
 * `source === "default"`: an explicit `--worker`/`A11Y_WORKER` keeps the full recovery, because naming a
 * worker is a statement it exists.
 *
 * THIS TEST DRIVES THE BUILT, PACKED, INSTALLED BIN -- not the source file -- because the bug this guards
 * against is exactly the shape `docs/proving-a-gate.md` names: a correct remedy on a path a real user
 * reaches and a test never did. Reusing `scripts/isolation-gate.mjs`'s pack-and-install machinery rather
 * than a fresh copy is deliberate for a second reason: a REAL isolated install is the only way to prove
 * `source` resolves to `"default"` without touching `packages/control/ansible/inventory.yml` at all --
 * that file is a shared, tracked, currently-in-use production artefact (a live fleet recapture depends on
 * it), and `@a11y-witness/control` is private and never part of any published tarball, so an isolated
 * install structurally cannot see it. `inventoryWorkerUrls()`'s `readFileSync` fails with a real ENOENT,
 * exactly as it would for any real external consumer -- this is not evasion, it is the realistic case.
 *
 * NEVER points at a real worker: the probe target is `http://127.0.0.1:${CLOSED_PORT}`, verified closed
 * immediately before each run by attempting a real connection first. If something answers there (a local
 * worker VM happens to be running on this exact machine), the test SKIPS rather than silently passing or
 * failing for the wrong reason -- proceeding would either hit a real service or prove nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { internalDependencies } from "../../../../scripts/isolation-gate.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI_DIR = join(REPO, "packages/cli");
const CLOSED_PORT = 8765; // the real, hardcoded DEFAULT_WORKER port -- this IS the bug's actual address

/** True if something answers on 127.0.0.1:port within a short window. */
function somethingIsListening(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: timeoutMs });
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
    socket.once("error", () => resolvePromise(false));
  });
}

/** Pack the CLI and its internal dependency closure into a throwaway consumer directory, and install it. */
function packAndInstall(): string {
  const consumer = mkdtempSync(join(tmpdir(), "a11y-no-worker-refusal-"));
  const dirs = [CLI_DIR, ...internalDependencies(CLI_DIR)];
  const tarballs = dirs.map((source) =>
    join(consumer, basename(
      execFileSync("npm", ["pack", "--silent", "--pack-destination", consumer], { cwd: source, encoding: "utf8" })
        .trim().split("\n").pop()!)));
  execFileSync("npm", ["init", "-y"], { cwd: consumer, stdio: "ignore" });
  // --omit=optional: axe/playwright are never reached before the refusal this test checks for.
  execFileSync("npm", ["install", "--silent", "--no-workspaces", "--omit=optional", ...tarballs],
    { cwd: consumer, stdio: "ignore" });
  return consumer;
}

/** The installed bin's real path, read from the installed package's own manifest rather than guessed. */
function installedBinPath(consumer: string): string {
  const pkg = JSON.parse(readFileSync(
    join(consumer, "node_modules/a11y-witness/package.json"), "utf8")) as { bin: Record<string, string> };
  return join(consumer, "node_modules/a11y-witness", pkg.bin["a11y-witness"]);
}

/**
 * How long a trivial process takes before this host is called DEGRADED rather than the bin called hung.
 *
 * Measured baseline on a healthy host: `node -e ""` costs ~0.3 s. 5 s is ~16x that, so it cannot be
 * reached by ordinary variance -- if booting an empty node takes five seconds, nothing running on this
 * machine is being measured fairly.
 */
const CONTROL_DEGRADED_MS = 5_000;

/**
 * How long a trivial process ACTUALLY takes, right now — the control, run only after the bound expired.
 *
 * IT IS A PROXY AND THE DIFFERENCE MATTERS. This measures node BOOT, not the bin: there is no
 * `--help`/`--version` fast path in `cli.ts`, so the bin cannot be used as its own control without
 * re-running the thing under test. So it answers *"could this host run ANYTHING in that window"*, not
 * *"could this host run the thing under test"*. That is enough to separate a starved host from a hung
 * process, and it is not enough to conclude the bin would have finished — do not widen the inference.
 */
function controlSpawnMs(cwd: string): Promise<number> {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["-e", ""], { cwd, stdio: "ignore" });
    child.once("exit", () => resolvePromise(Date.now() - startedAt));
    child.once("error", () => resolvePromise(Date.now() - startedAt));
  });
}

/**
 * Run the installed bin against the closed port, with a HARD WALL-CLOCK BOUND -- never the 620 s the old
 * code would actually take. If the process has not exited by `boundMs`, it is killed and reported as
 * "did not exit", which is exactly how this test proves it can see the hang (run it against the pre-fix
 * source with a short bound and it reports precisely that).
 *
 * ## A TIMEOUT ALONE CANNOT SAY WHY, so it no longer tries — issue #51
 *
 * The bound expiring has two causes and they need opposite responses: the bin hung (the defect), or this
 * host could not run it in the window (nothing to do with the bin). The old message asserted the first
 * -- *"this is the exact hang this test exists to catch"* -- about something it had no way to
 * distinguish, and it fails hardest exactly when the host is degraded, which is when a gate you cannot
 * trust is worst. `orchestrator` measured it passing alone twice and failing inside the suite's own
 * concurrency: the failure tracks CONTENTION, not duration.
 *
 * So on timeout — and only on timeout, so a healthy run never pays for it — a CONTROL is measured. A fast
 * control forces the failure path exactly as before; a slow one is positive evidence that the host, not
 * the bin, is the reason. **The skip therefore fires on EVIDENCE, never on absence**, which is what stops
 * it becoming a check that never runs.
 */
function runBinBounded(binPath: string, cwd: string, boundMs: number):
  Promise<{ exited: boolean; code: number | null; stderr: string; controlMs: number | null }> {
  return new Promise((resolvePromise) => {
    // The page URL is irrelevant -- the refusal fires in `main()` before any page is ever fetched. A real,
    // syntactically valid URL avoids the argument being misread as related to the WORKER address, which
    // is resolved entirely separately (and never touches this URL).
    const child = spawn(process.execPath, [binPath, "https://example.com/", "--task", "check"],
      { cwd, env: { ...process.env, A11Y_WORKER: undefined, A11Y_LOCAL_VM: "0" }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    // THE TIMEOUT CLAIMS THE VERDICT BEFORE IT AWAITS ANYTHING, and this flag is why.
    //
    // `child.kill("SIGKILL")` MAKES THE CHILD EXIT, so the `exit` handler below fires from the kill
    // itself. While the timeout path was synchronous that did not matter -- it had already resolved. Once
    // it awaits the control (~300 ms), the exit-from-kill wins the race and a bin that was KILLED reports
    // `exited: true`: a false pass on exactly the hang this test exists to catch. Found by mutation, not
    // by reading, when a forced 1 ms bound failed for the wrong reason.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // The control runs HERE and nowhere else: after the bound expired, before any verdict is formed.
      void controlSpawnMs(cwd).then((controlMs) => resolvePromise({ exited: false, code: null, stderr, controlMs }));
    }, boundMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) return; // this exit IS the kill above; the timeout owns the answer
      // `controlMs: null` on the happy path is "not measured", not "measured as fast" -- the distinction
      // this file exists to keep.
      resolvePromise({ exited: true, code, stderr, controlMs: null });
    });
  });
}

/**
 * RENAMED 2026-09-06 (#51). It read *"refuses in seconds, not 620s"*, which is a stronger claim than the
 * bound enforces -- and after raising the bound to 120 s the name would have asserted one thing while the
 * code enforced another, in the two places most likely to be read separately. The name is what a future
 * reader trusts when deciding whether the bound is too loose, so it now says what is actually proven:
 * the run TERMINATES far below `CAPTURE_CLIENT_TIMEOUT_MS`, and refuses rather than exiting 0.
 *
 * The *seconds* property was never what this bound tested. A tighter assertion for it would need the
 * healthy-path timing to be stable enough to hold, which under this suite's own concurrency it is not --
 * which is the whole of #51.
 */
test("a run with nothing configured and nothing listening REFUSES, far below the 620s it used to take", async () => {
  if (!existsSync(join(CLI_DIR, "package.json"))) {
    assert.fail("packages/cli/package.json is gone -- this test's target moved");
  }
  if (await somethingIsListening(CLOSED_PORT)) {
    // Something real is on the default port on THIS machine (a local worker VM, most likely) -- proceeding
    // would either hit it or prove nothing about the refusal path. Skip rather than guess.
    return;
  }

  const consumer = packAndInstall();
  try {
    const binPath = installedBinPath(consumer);
    assert.ok(existsSync(binPath), `installed bin not found at ${binPath} -- the pack/install failed silently`);

    // 15s is generous against the old code's 620s and tight against the fix's near-instant refusal --
    // an ECONNREFUSED on a closed port returns in milliseconds, not the 5s probe budget's ceiling.
    // 120 s, raised from 15 s. `captureTolerantly` loops for the full CAPTURE_CLIENT_TIMEOUT_MS (620 s),
    // so this is still 5.2x clear of the defect and under a fifth of it -- nothing the test could catch is
    // given up. The bound was never really "15 s"; it was "anything under about ten minutes", which is why
    // there is room. Raising it makes the control path below RARE rather than routine; it does not make
    // the verdict honest on its own, which is what the control is for.
    const boundMs = 120_000;
    const result = await runBinBounded(binPath, consumer, boundMs);

    if (!result.exited && result.controlMs !== null && result.controlMs > CONTROL_DEGRADED_MS) {
      // INCONCLUSIVE -- neither a pass nor a failure, and LOUD so it is countable. If this line appears
      // often, that is a fact about the host worth acting on, and it can be grepped for.
      console.log(`    INCONCLUSIVE: the bin did not exit within ${boundMs}ms, but a trivial process took `
        + `${result.controlMs}ms (healthy is ~300ms). This host could not run ANYTHING in that window, so `
        + "this run says nothing about whether the bin hung -- see issue #51.");
      return;
    }

    assert.ok(result.exited,
      `the bin did NOT exit within ${boundMs}ms, and a control process ran promptly `
      + `(${result.controlMs}ms), so the host was fine and the bin genuinely did not terminate. If this `
      + "fires against a build that includes the fix, the fix regressed; if it fires against the unfixed "
      + "source, the test is doing its job (see cli.ts's refuseIfNothingListening)");
    assert.notEqual(result.code, 0,
      `the bin exited 0 with nothing listening -- it must refuse. stderr: ${result.stderr}`);
    assert.match(result.stderr, /A11Y_WORKER/,
      `the refusal must name A11Y_WORKER so the user knows the remedy. stderr: ${result.stderr}`);
    assert.match(result.stderr, /getting-started\.md/,
      `the refusal must point at docs/getting-started.md. stderr: ${result.stderr}`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
