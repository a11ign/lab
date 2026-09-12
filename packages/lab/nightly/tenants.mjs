// @ts-check
// command: (not a command) the named manifest of the nightly-only population, pinned by nightly-only-path.test.ts
/**
 * #1149: WHO LIVES IN THE NIGHTLY-ONLY PATH, BY NAME.
 *
 * `#1135` moved this population off the pull-request path, and the only things holding its size were
 * `test:nightly --min=1` and a `nightly.length > 0` vacuity guard. **Both pass at N−1.** A tenant deleted,
 * moved back, or renamed to something the glob misses leaves silently, and the nightly job goes on
 * reporting green over whatever remains — the population shrinking is exactly the failure a floor cannot
 * see, because a floor records what someone last typed rather than what was counted.
 *
 * `ceo` ruled against a ratchet for that reason (#1149, 2026-09-12). **A number bumped by hand is
 * satisfied by the shrinkage it exists to catch.** A manifest of NAMES is not: a tenant that leaves must
 * be removed from here by the hand that removed it, in a diff a reviewer sees twice.
 *
 * **THE TWO-FILE EDIT IS THE PRODUCT, NOT A COST.** This repository files "a fact stated twice with
 * nothing comparing the copies" more than any other shape, and this is deliberately that shape — made
 * safe by the one sanctioned remedy: the copies are **pinned equal in both directions** by
 * `nightly-only-path.test.ts`. A tenant on disk that is not named here fails; a name here with no file
 * fails. **If that pin is ever relaxed to one direction, this justification expires with it** — a
 * one-directional pin is satisfied by an empty manifest, which is the vacuity this exists to close
 * reappearing one level up.
 *
 * Paths are relative to the repository root, as the walk reports them.
 */
export const NIGHTLY_TENANTS = Object.freeze([
  "packages/lab/nightly/bounded-window-reads.test.ts",
  "packages/lab/nightly/isolation-gate-real-consumer.test.ts",
]);
