/**
 * `--shard=i/n` — split a work list across concurrent runs.
 *
 * Extracted from `capture-real-pages.mjs` so it can be TESTED. It was an inline IIFE that happened to be
 * correct, but "happened to be correct" is not a property you can rely on twice, and Increment 2 of the lab
 * job work adds a second caller that must agree with it exactly. A shard parser that disagrees with itself
 * between two callers either drops pages silently or captures some twice, and both are invisible: 76 of 77
 * looks like 77 unless somebody counts.
 *
 * ## Why sharding rather than a worker pool
 *
 * The real-page capture needs no page server — these are LIVE URLs — so concurrent shards share nothing and
 * cannot contend. The dataset runner needs the pool machinery because it also leases a page server;
 * borrowing that here would be a lot of coupling for no gain.
 *
 * ## Politeness is preserved by the INTERLEAVE, not by the gap
 *
 * The per-shard gap between captures is unchanged, but shards take every nth item, so consecutive requests
 * from one shard go to DIFFERENT publishers. No single publisher sees a faster rate than before — and with
 * roughly one page per publisher, most see exactly one request either way. Note this property depends on
 * the corpus being ordered by publisher rather than grouped: `select` takes index % count, so a corpus that
 * listed ten pages of one site consecutively would hand all ten to the same shard.
 */

/** The whole list, when no shard was asked for. */
const EVERYTHING = Object.freeze({ index: 0, count: 1 });

/**
 * Parse `--shard=i/n` from an argument list.
 *
 * Absent is not an error: it means "do all of it", which is the normal single-runner case. A PRESENT but
 * malformed value is an error, because the alternative is silently doing all of it when somebody asked for
 * a quarter — four runs each capturing everything, which is four times the load on somebody else's site.
 *
 * @param {string[]} argv
 * @returns {{ index: number, count: number }}
 */
export function parseShard(argv) {
  const raw = argv.find((a) => a.startsWith("--shard="))?.slice("--shard=".length);
  if (raw === undefined) return EVERYTHING;

  const parts = raw.split("/");
  const [index, count] = parts.map(Number);
  const valid = parts.length === 2
    && Number.isInteger(index) && Number.isInteger(count)
    && count >= 1 && index >= 0 && index < count;
  if (!valid) throw new Error(`--shard must be i/n with 0 <= i < n, got ${raw}`);
  return { index, count };
}

/**
 * The slice of `items` this shard owns.
 *
 * Every item belongs to exactly one shard and every shard's slices concatenate to the whole list — which is
 * the property the tests assert directly, because it is the one that matters and the one an off-by-one
 * breaks silently.
 *
 * @template T
 * @param {T[]} items
 * @param {{ index: number, count: number }} shard
 * @returns {T[]}
 */
export function shardOf(items, { index, count }) {
  return items.filter((_, position) => position % count === index);
}
