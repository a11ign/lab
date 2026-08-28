// @ts-check
/**
 * Say, at the moment somebody starts a capture, whether THIS MACHINE is load-bearing for it.
 *
 * The corpus lives on the lab. A capture driven from anywhere else still runs the screen readers remotely,
 * but the driving host is in the critical path twice, and neither is obvious from the command:
 *
 *   - it SERVES THE CORPUS PAGES to the fleet, because the guests cannot reach the host's localhost — the
 *     run prints `rewrote http://localhost:5050 -> http://<host>:5050` and that is this dependency;
 *   - it DRIVES THE DISPATCH, so when it sleeps the run stops while the workers stay perfectly healthy.
 *
 * Both were measured. `power-guard.mjs` records the second: this Mac ran to 1%, hibernated, and every
 * in-flight capture timed out — the run marked the workers unreachable and it was first misdiagnosed as
 * host memory over-commitment. The guard that came out of that refuses on low battery, which is right and
 * is also the only place the dependency is ever mentioned. A guard that fires without explaining the shape
 * of the thing it is protecting gets an override flag passed to it, which is exactly what happened here on
 * 2026-08-28.
 *
 * And `runs/` on a driving host is a PARTIAL REPLICA. Measured the same day: `check-signals` scored 226 of
 * 1,461 cases locally and 1,303 on the lab at the same commit. Nothing was wrong with the corpus.
 *
 * A WARNING, NOT A REFUSAL. The local route is legitimate — it is the fast way to prove one case — and this
 * project has already learned that a guard blocking a legitimate path gets bypassed wholesale:
 * `A11Y_SKIP_VERIFY=1` was reached for "nine times in one day", disabling four checks that worked to get
 * past one that could not answer its own question. So this names the lab equivalent and gets out of the way.
 */

/** Where the lab keeps its checkout — `lab_repo_path` in `ansible/group_vars/a11y_lab.yml`. */
export const LAB_REPO_PATH = "/opt/a11y";

/**
 * @param {{ cwd: string, servesPages: boolean, labPath?: string }} where
 * @returns {string | null} what to print, or null when this IS the authoritative host
 */
export function nonAuthoritativeHostNotice({ cwd, servesPages, labPath = LAB_REPO_PATH }) {
  if (cwd === labPath || cwd.startsWith(`${labPath}/`)) return null;
  const serving = servesPages
    ? "  - it SERVES THE CORPUS PAGES to the fleet (the guests cannot reach this host's localhost)\n"
    : "";
  return "\nThis machine is load-bearing for this run, and the corpus it writes to is a partial replica:\n"
    + serving
    + "  - it DRIVES THE DISPATCH, so if it sleeps the run stops while the workers stay healthy — measured,\n"
    + "    and first misdiagnosed as the guests failing\n"
    + "  - `runs/` here is whatever was last synced; the lab holds the corpus\n"
    + "The lab can run this without this machine:\n"
    + "  npm run lab:job -- -e job=capture-only -e only=<ids>\n";
}
