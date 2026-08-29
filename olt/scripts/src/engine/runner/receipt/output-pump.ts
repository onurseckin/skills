import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { OutputSummary } from "../types/types";
import type { OutputPumpOptions } from "../types/types";

export async function pumpOutput(
  stream: ReadableStream<Uint8Array>,
  file: FileHandle,
  path: string,
  onActivity: (text: string, bytes: number) => void | Promise<void>,
  options: OutputPumpOptions = {},
): Promise<OutputSummary> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const digest = createHash("sha256");
  let bytes = 0;
  const abort = () =>
    void reader.cancel("command output collection aborted").catch(() => undefined);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw new Error("command output collection aborted");
      const { done, value } = await reader.read();
      if (done) break;
      options.budget?.claim(value.byteLength);
      let offset = 0;
      while (offset < value.byteLength) {
        const result = await file.write(value, offset, value.byteLength - offset);
        if (result.bytesWritten <= 0) throw new Error("log write made no progress");
        offset += result.bytesWritten;
      }
      digest.update(value);
      bytes += value.byteLength;
      await onActivity(decoder.decode(value, { stream: true }), value.byteLength);
    }
    const tail = decoder.decode();
    if (tail) await onActivity(tail, 0);
    await file.sync();
    return { path, bytes, sha256: digest.digest("hex") };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
