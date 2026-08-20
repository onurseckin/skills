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

export function activityMetadata(path: string, portablePath: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: portablePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}
