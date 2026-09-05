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
 * Run the installed bin against the closed port, with a HARD WALL-CLOCK BOUND -- never the 620 s the old
 * code would actually take. If the process has not exited by `boundMs`, it is killed and reported as
 * "did not exit", which is exactly how this test proves it can see the hang (run it against the pre-fix
 * source with a short bound and it reports precisely that).
 */
function runBinBounded(binPath: string, cwd: string, boundMs: number):
  Promise<{ exited: boolean; code: number | null; stderr: string }> {
  return new Promise((resolvePromise) => {
    // The page URL is irrelevant -- the refusal fires in `main()` before any page is ever fetched. A real,
    // syntactically valid URL avoids the argument being misread as related to the WORKER address, which
    // is resolved entirely separately (and never touches this URL).
    const child = spawn(process.execPath, [binPath, "https://example.com/", "--task", "check"],
      { cwd, env: { ...process.env, A11Y_WORKER: undefined, A11Y_LOCAL_VM: "0" }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise({ exited: false, code: null, stderr });
    }, boundMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ exited: true, code, stderr });
    });
  });
}

test("a run with nothing configured and nothing listening refuses in seconds, not 620s", async () => {
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
    const result = await runBinBounded(binPath, consumer, 15_000);

    assert.ok(result.exited,
      "the bin did NOT exit within 15s -- this is the exact hang this test exists to catch. If this fires "
      + "against a build that includes the fix, the fix regressed; if it fires against the unfixed source, "
      + "the test is doing its job (see cli.ts's refuseIfNothingListening)");
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
