import { open } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface SentinelOutputResult {
  bytes: number;
  retained_bytes: number;
  truncated: boolean;
  sha256: string;
}

export async function captureSentinelOutput(
  stream: ReadableStream<Uint8Array>,
  path: string,
  sink?: (chunk: Uint8Array) => void,
  maxBytes = 8 * 1024 * 1024,
): Promise<SentinelOutputResult> {
  const handle = await open(path, "w", 0o600);
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let bytes = 0;
  let retained_bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      bytes += value.byteLength;
      hash.update(value);
      sink?.(value);

      if (retained_bytes < maxBytes) {
        const available = maxBytes - retained_bytes;
        const slice = value.byteLength <= available ? value : value.subarray(0, available);
        await handle.write(slice);
        retained_bytes += slice.byteLength;
      }
      if (bytes > maxBytes) {
        truncated = true;
      }
    }
  } finally {
    reader.releaseLock();
    await handle.close();
  }

  return {
    bytes,
    retained_bytes,
    truncated,
    sha256: hash.digest("hex"),
  };
}
