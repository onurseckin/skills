export const MIN_POLL_DELAY_MS = 10;
export const MAX_POLL_DELAY_MS = 250;
const BACKOFF_FACTOR = 2;

export function nextPollDelayMs(currentDelayMs: number, discoveredNewDescendant: boolean): number {
  if (discoveredNewDescendant) return MIN_POLL_DELAY_MS;
  return Math.min(Math.round(currentDelayMs * BACKOFF_FACTOR), MAX_POLL_DELAY_MS);
}
