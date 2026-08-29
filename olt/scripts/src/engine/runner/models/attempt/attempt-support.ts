import { readBoundedBytes, sha256Bytes } from "../../../../core/json.ts";

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
