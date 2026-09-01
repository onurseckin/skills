import { afterEach, describe, expect, test } from "bun:test";
import { readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

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
        const remaining = maxBytes - retained_bytes;
        const slice = value.byteLength <= remaining ? value : value.subarray(0, remaining);
        await handle.write(slice);
        retained_bytes += slice.byteLength;
      }
      if (bytes > maxBytes) truncated = true;
    }
  } finally {
    await handle.close();
  }

  return {
    bytes,
    retained_bytes,
    truncated,
    sha256: hash.digest("hex"),
  };
}

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

afterEach(cleanupTempRoots);

describe("sentinel child output capture", () => {
  test("handles an empty output stream", async () => {
    const dir = tempRoot("sentinel-out-empty");
    const logPath = join(dir, "stdout.log");
    const stream = createStream([]);
    const result = await captureSentinelOutput(stream, logPath);

    expect(result).toEqual({
      bytes: 0,
      retained_bytes: 0,
      truncated: false,
      sha256: createHash("sha256").update(new Uint8Array(0)).digest("hex"),
    });
    expect(await readFile(logPath)).toEqual(Buffer.alloc(0));
  });

  test("captures and streams unbudgeted chunks", async () => {
    const dir = tempRoot("sentinel-out-simple");
    const logPath = join(dir, "stdout.log");
    const chunks = [Buffer.from("hello "), Buffer.from("world\n")];
    const seen: string[] = [];
    const stream = createStream(chunks);
    const result = await captureSentinelOutput(stream, logPath, (chunk) => {
      seen.push(Buffer.from(chunk).toString("utf8"));
    });

    expect(seen).toEqual(["hello ", "world\n"]);
    expect(result).toEqual({
      bytes: 12,
      retained_bytes: 12,
      truncated: false,
      sha256: createHash("sha256").update(Buffer.from("hello world\n")).digest("hex"),
    });
    expect(await readFile(logPath, "utf8")).toBe("hello world\n");
  });

  test("truncates output when exceeding the maximum allowed bytes", async () => {
    const dir = tempRoot("sentinel-out-trunc");
    const logPath = join(dir, "stdout.log");
    const chunks = [Buffer.from("12345"), Buffer.from("67890")];
    const stream = createStream(chunks);
    const result = await captureSentinelOutput(stream, logPath, undefined, 7);

    expect(result).toEqual({
      bytes: 10,
      retained_bytes: 7,
      truncated: true,
      sha256: createHash("sha256").update(Buffer.from("1234567890")).digest("hex"),
    });
    expect(await readFile(logPath, "utf8")).toBe("1234567");
  });
});
