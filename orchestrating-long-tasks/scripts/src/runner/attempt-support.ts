import { readBoundedBytes, sha256Bytes } from "../core/json.ts";

/**
 * Both bounds clear their timer in `finally`. `Promise.race` does not cancel the losing promise, so
 * a timer left armed keeps the event loop alive for its full duration after the command has already
 * finished — the runner would idle for the whole drain budget on every successful attempt.
 */
export async function raceWithTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function settleBounded(
  promises: Promise<unknown>[],
  milliseconds: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(promises).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `Promise.all([trackerReady, raced])` rejects the instant `raced` rejects, without waiting for
 * `trackerReady` to settle — so a near-instant failure (e.g. the output-quota check) could reach
 * the failure path before `attemptIntent.bindRoot` ever ran, leaving the attempt's root identity
 * unbound and forcing cleanup to withhold termination. `.finally` always waits out a pending
 * promise it returns, so chaining it here guarantees `trackerReady`'s binding side effect has
 * already happened by the time `outcome` resolves or rejects — its own rejection is swallowed
 * since only the side effect (not its result) matters here, and `outcome`'s rejection must still
 * win so the real failure reason is preserved.
 */
export async function settleTrackerBeforeOutcome<T>(
  outcome: Promise<T>,
  trackerReady: Promise<unknown>,
): Promise<T> {
  return outcome.finally(() => trackerReady.catch(() => undefined));
}

export function activityMetadata(path: string, portablePath: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: portablePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}
