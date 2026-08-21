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
import { openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
 * WHO IS STILL USING THIS SERVER — a refcount on disk, because the rule above was only half implemented.
 *
 * The header says "a long run must not shut down something another run is using". That protected the
 * ADOPTER (which releases with a no-op) and not the STARTER, which stopped the server on exit whatever else
 * had joined since. Measured 2026-08-21: a 48-capture `evidence:check` adopted a server, a one-case capture
 * run that had started it finished first and killed it, and the remaining 46 captures read a dead port. They
 * still "succeeded" -- Edge serves its own error page -- so the check reported 2 compared of 48 and, before
 * the fix in evidence-diff.mjs, called that "safe to ship".
 *
 * `serverPid` is recorded so that ANY holder can be the one to stop it. Without that, the last run standing
 * is often an adopter with no child handle, and the server outlives every run that wanted it -- which is the
 * leak this module was written to end, arriving from the other side.
 *
 * Liveness is checked with `kill(pid, 0)` on every read, so a crashed holder cannot pin a server forever.
 * That is the property that makes a crash safe: the file is a hint, and the process table is the truth.
 */
/** Exported for the test: the fault is a two-process interleaving, and the bookkeeping is where it lives. */
export function holdersPath(root) {
  return resolve(root, "..", "page-server.holders.json");
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ONLY `ESRCH` means gone. `EPERM` means the process exists and is not ours to signal -- and after pid
    // reuse a recorded holder can be somebody else's process entirely. Reading EPERM as dead would let this
    // run decide it is the last one out and stop a server another run is still using, which is the exact
    // fault the refcount exists to prevent, reintroduced one level down.
    return error?.code !== "ESRCH";
  }
};

export function readHolders(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { serverPid: null, holders: [] }; // absent or unreadable both mean "nobody has registered"
  }
  const holders = (parsed.holders ?? []).filter((pid) => Number.isInteger(pid) && isAlive(pid));
  // A dead serverPid means the file outlived its server, so it describes nothing.
  const serverPid = Number.isInteger(parsed.serverPid) && isAlive(parsed.serverPid) ? parsed.serverPid : null;
  return { serverPid, holders };
}

/** Atomic, so a concurrent reader never sees half a file. Same temp+rename as capture-progress.mjs. */
function writeHolders(path, state) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state) + "\n", "utf8");
  renameSync(temp, path);
}

export function joinHolders(root, serverPid) {
  const path = holdersPath(root);
  const state = readHolders(path);
  writeHolders(path, {
    serverPid: serverPid ?? state.serverPid,
    holders: [...new Set([...state.holders, process.pid])],
  });
}

/**
 * Leave, and say whether the server is now unused.
 *
 * Synchronous throughout because an `exit` handler cannot await, and the exit path is the one that actually
 * leaked processes.
 */
export function leaveHolders(root) {
  const path = holdersPath(root);
  const state = readHolders(path);
  const remaining = state.holders.filter((pid) => pid !== process.pid);
  if (remaining.length) {
    writeHolders(path, { serverPid: state.serverPid, holders: remaining });
    return { lastOut: false, serverPid: state.serverPid, remaining };
  }
  try {
    unlinkSync(path);
  } catch { /* another run removed it first, which is the same outcome */ }
  return { lastOut: true, serverPid: state.serverPid, remaining };
}

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
  return stopPid(child.pid);
}

/**
 * Stop a server by pid, for a holder that did not spawn it.
 *
 * Split out because the last run standing is often an ADOPTER, which has no child handle -- and before the
 * refcount there was no path by which it could clean up, so the alternative to killing somebody else's
 * server was leaking it.
 */
function stopPid(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return; // already gone; nothing to insist on
  }
  const insist = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
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
    // REGISTER even when adopting, and release by leaving rather than by doing nothing. The no-op release
    // was correct about not stopping somebody else's server and wrong about the consequence: an unregistered
    // adopter is invisible, so the run that started the server tore it down on exit while this one was still
    // capturing. Registering makes "somebody is still using it" a fact on disk instead of an assumption.
    process.stderr.write(`Dataset pages already served on :${port}; joining as a holder\n`);
    joinHolders(root, null);
    const releaseAdopted = async () => {
      const { lastOut, serverPid } = leaveHolders(root);
      // The last one out turns the lights off even if it did not start the server -- otherwise the starter
      // (which left it running BECAUSE we were holding it) is gone and nothing owns the process.
      if (lastOut && serverPid) stopPid(serverPid);
    };
    process.once("exit", () => { leaveHolders(root); });
    return { url, started: false, release: releaseAdopted };
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

  joinHolders(root, child.pid);

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    const { lastOut, remaining } = leaveHolders(root);
    if (!lastOut) {
      // The case this whole refcount exists for. Stopping here killed a concurrent run's pages mid-capture.
      process.stderr.write(`Leaving the dataset page server up: ${remaining.length} other run(s) `
        + `still holding it (pid ${remaining.join(", ")})\n`);
      return;
    }
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
  // On a crash, stop it only if nobody else is holding it. Leaking a server another run needs is the
  // lesser fault -- and `readHolders` filters dead pids, so a crashed holder cannot pin it forever.
  process.once("exit", () => {
    if (leaveHolders(root).lastOut) stopGroup(child);
  });

  if (!await waitUntilServing(url, probePath, Date.now() + READY_TIMEOUT_MS)) {
    await release();
    throw new Error(
      `page server did not serve ${probePath} on :${port} within ${READY_TIMEOUT_MS} ms. ` +
      `Check ${logPath}. If another process holds that port, it is serving something else — stop it first.`);
  }
  return { url, started: true, release };
}
