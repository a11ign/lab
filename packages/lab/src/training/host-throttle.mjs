/**
 * A minimum gap between requests to the SAME publisher, however many workers are running.
 *
 * This replaces a fixed `sleep` between captures, and the difference is the whole point. A global gap is a
 * property of one process: run four of them and the rate a publisher sees quadruples, so politeness
 * silently degrades exactly when the fleet grows. A per-host gap is a property of the PUBLISHER, so the
 * rate each site sees is the same whether one worker is running or twenty. Scaling out stops being a
 * decision anybody has to think about again.
 *
 * ## The reservation must happen BEFORE the await
 *
 * The subtle half. Two workers taking two pages from the same publisher at the same instant both read the
 * same `nextAllowed`, and if each only computed its wait from what it read, both would proceed together —
 * a throttle that permits precisely the burst it exists to prevent, and only under concurrency, which is
 * the condition it was added for. Claiming the slot synchronously before yielding makes the queue serial:
 * the second caller reserves `first + gap` and waits for it.
 *
 * `now` and `sleep` are injected so the behaviour is testable without spending real seconds — a throttle
 * verified by a test that waits is a test nobody runs twice.
 */
/**
 * @param {object} options
 * @param {number} options.minGapMs           minimum interval between requests to one host
 * @param {() => number} [options.now]        injected clock, so tests need not spend real seconds
 * @param {(ms: number) => Promise<unknown>} [options.sleep]
 * @returns {(host: string) => Promise<number>} resolves with the ms waited (0 if it went straight through)
 */
export function createHostThrottle({
  minGapMs,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const nextAllowed = new Map();

  return async function waitTurn(host) {
    const at = now();
    const allowed = nextAllowed.get(host) ?? 0;
    // Reserved synchronously — see above. `Math.max(at, allowed)` restarts the clock from now for a host
    // that has been idle, rather than letting an old timestamp bank up credit for a burst.
    nextAllowed.set(host, Math.max(at, allowed) + minGapMs);
    const wait = allowed - at;
    if (wait > 0) await sleep(wait);
    return wait > 0 ? wait : 0;
  };
}

/**
 * The publisher a URL belongs to. Throttling is per HOST because that is who feels the load.
 *
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  return new URL(url).host;
}
