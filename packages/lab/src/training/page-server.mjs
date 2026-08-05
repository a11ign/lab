/**
 * The dataset pages, served for the duration of a run — and stopped afterwards.
 *
 * Serving them used to be a manual step (`npx serve runs/screenreader-dataset/pages -l 5050`) that
 * nothing owned. Two consequences, both observed:
 *
 *  - **It leaked.** Four `serve` processes were found running on this host, six days old, only one of
 *    them holding the port. Nothing reaped them because nothing had started them on anyone's behalf.
 *  - **A stray one corrupts a dataset silently.** A leftover server from another directory answers `/`
 *    happily and 404s every case, and a run once reported "Capture complete: 3/3 cases" while every
 *    transcript read "Error code: 404".
 *
 * So a run leases it the way it leases a worker VM: start what is missing, and **put it back as it was
 * found**. A server somebody else started is used and left alone, because a long run must not shut down
 * something another run is using — the same rule, for the same reason, as the VM lease.
 *
 * Housekeeping a human has to remember is housekeeping that does not happen.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { resolve } from "node:path";

// Generous because the first `npx serve` on a busy host has to resolve the package before it binds,
// and this host has had three VMs on it. A too-short window fails the run for a server that was about
// to work, which is strictly worse than waiting.
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;
const PROBE_TIMEOUT_MS = 3_000;
/** After SIGTERM, how long to let `serve` exit before insisting. */
const SHUTDOWN_GRACE_MS = 2_000;

/**
 * Is a server on this port serving OUR pages?
 *
 * Probes a real page, never `/`. "Something answers" is not "our pages are being served", and the
 * difference is the 404-dataset above.
 */
async function servesOurPages(url, probePath) {
  try {
    const response = await fetch(`${url}/${probePath}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false; // not listening yet, or not listening at all
  }
}

async function waitUntilServing(url, probePath, deadline) {
  while (Date.now() < deadline) {
    if (await servesOurPages(url, probePath)) return true;
    await new Promise((done) => setTimeout(done, READY_POLL_MS));
  }
  return false;
}

/**
 * Stop a server we started, and nothing else.
 *
 * `npm exec serve` is a parent shell plus the node process that holds the port, so killing the pid
 * alone orphans the child — which is exactly the shape of the four leaked processes. Spawning
 * detached puts both in their own process group, and a negative pid signals the group.
 */
function stopGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return; // already gone; nothing to insist on
  }
  const insist = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Exited between the SIGTERM and here, which is the outcome we wanted.
    }
  }, SHUTDOWN_GRACE_MS);
  insist.unref();
}

/**
 * Serve `root` on `port` for this run.
 *
 * @param {{ root: string, port: number, probePath: string }} options `probePath` is a page that must
 *   exist, so "serving" means serving the dataset rather than merely holding the port.
 * @returns {Promise<{ url: string, started: boolean, release: () => Promise<void> }>}
 */
export async function leasePageServer({ root, port, probePath }) {
  const url = `http://localhost:${port}`;
  if (await servesOurPages(url, probePath)) {
    process.stderr.write(`Dataset pages already served on :${port}; leaving it as found\n`);
    return { url, started: false, release: async () => {} };
  }

  // Keep the server's own output. Discarding it made a failure to start undiagnosable: all the caller
  // could say was "it did not come up", with no way to tell a port clash from a missing package.
  const logPath = resolve(root, "..", "page-server.log");
  const log = openSync(logPath, "a");
  process.stderr.write(`Serving dataset pages on :${port} (log: ${logPath}) ...\n`);
  const child = spawn("npx", ["serve", resolve(root), "-l", String(port)], {
    stdio: ["ignore", log, log],
    detached: true, // its own process group, so release() cannot orphan the child
  });
  child.on("error", (error) => process.stderr.write(`page server failed to spawn: ${error.message}\n`));
  child.unref();

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    process.stderr.write("Stopping the dataset page server ...\n");
    stopGroup(child);
  };

  // A run that dies still has to clean up, and this is the case that actually leaked: the servers on
  // this host outlived interrupted sessions. `once` so a second signal is not swallowed.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      release().catch(() => {});
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
  process.once("exit", () => stopGroup(child));

  if (!await waitUntilServing(url, probePath, Date.now() + READY_TIMEOUT_MS)) {
    await release();
    throw new Error(
      `page server did not serve ${probePath} on :${port} within ${READY_TIMEOUT_MS} ms. ` +
      `Check ${logPath}. If another process holds that port, it is serving something else — stop it first.`);
  }
  return { url, started: true, release };
}
