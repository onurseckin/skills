import { readBoundedBytes, sha256Bytes } from "../core/json.ts";

export function timeoutAfter(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds));
}

export async function settleBounded(
  promises: Promise<unknown>[],
  milliseconds: number,
): Promise<boolean> {
  return await Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
}

export function activityMetadata(path: string, portablePath: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: portablePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}
