import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { captureSentinelOutput } from "./fixtures/sentinel-output.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe("sentinel child output capture", () => {
  test("handles an empty output stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sentinel-out-empty-"));
    roots.push(dir);
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

  test("persists full output within budget and invokes passthrough sink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sentinel-out-full-"));
    roots.push(dir);
    const logPath = join(dir, "stdout.log");
    const chunk1 = new TextEncoder().encode("hello ");
    const chunk2 = new TextEncoder().encode("world\n");
    const full = new TextEncoder().encode("hello world\n");
    const stream = createStream([chunk1, chunk2]);
    const sinkChunks: Uint8Array[] = [];

    const result = await captureSentinelOutput(
      stream,
      logPath,
      (chunk) => sinkChunks.push(new Uint8Array(chunk)),
      1024,
    );

    expect(result).toEqual({
      bytes: full.byteLength,
      retained_bytes: full.byteLength,
      truncated: false,
      sha256: createHash("sha256").update(full).digest("hex"),
    });
    expect(await readFile(logPath, "utf8")).toBe("hello world\n");
    expect(Buffer.concat(sinkChunks)).toEqual(Buffer.from(full));
  });

  test("truncates file writes at maxBytes while computing full hash and forwarding to sink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sentinel-out-trunc-"));
    roots.push(dir);
    const logPath = join(dir, "stderr.log");
    const chunk1 = new TextEncoder().encode("1234567890");
    const chunk2 = new TextEncoder().encode("abcdefghij");
    const full = new TextEncoder().encode("1234567890abcdefghij");
    const stream = createStream([chunk1, chunk2]);
    const sinkChunks: Uint8Array[] = [];

    const result = await captureSentinelOutput(
      stream,
      logPath,
      (chunk) => sinkChunks.push(new Uint8Array(chunk)),
      15,
    );

    expect(result).toEqual({
      bytes: 20,
      retained_bytes: 15,
      truncated: true,
      sha256: createHash("sha256").update(full).digest("hex"),
    });
    const written = await readFile(logPath, "utf8");
    expect(written).toBe("1234567890abcde");
    expect(Buffer.concat(sinkChunks)).toEqual(Buffer.from(full));
  });
});
