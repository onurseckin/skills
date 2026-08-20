/**
 * Cadence for `DescendantTracker`'s periodic ancestry re-scan.
 *
 * A fixed-interval poll spawns a full `ps` subprocess every tick for the entire lifetime of every
 * attempt, whether or not anything changed. Under real multi-agent concurrency — many attempts
 * running at once, each with its own tracker — that is a genuine fork storm on the host, not just
 * a slow test suite. Backing off geometrically while nothing new is discovered, and resetting to
 * the floor the instant a new descendant appears, keeps the poll sharp exactly when the tracker's
 * guarantee depends on it (a descendant must be seen while its parent is still alive, before an
 * intermediate exit severs the ancestry link) and idle otherwise.
 */
export const MIN_POLL_DELAY_MS = 10;
export const MAX_POLL_DELAY_MS = 250;
const BACKOFF_FACTOR = 2;

/**
 * `discoveredNewDescendant` reports whether the capture just completed grew the tracked set.
 * Growth means the ancestry walk is actively finding structure — stay at the floor so the next
 * fork-then-quick-exit is not missed. No growth means the walk is idle — stretch the interval so
 * an idle attempt (the common case: a long-running command with no forking) does not spawn `ps`
 * needlessly, capped so detection latency never grows unbounded.
 */
export function nextPollDelayMs(currentDelayMs: number, discoveredNewDescendant: boolean): number {
  if (discoveredNewDescendant) return MIN_POLL_DELAY_MS;
  return Math.min(Math.round(currentDelayMs * BACKOFF_FACTOR), MAX_POLL_DELAY_MS);
}
